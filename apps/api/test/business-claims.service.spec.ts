import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { MediaFileRow } from '../src/db/schema/media.js';
import { ClaimsService } from '../src/modules/business/claims/claims.service.js';
import type {
  ClaimWithMedia,
  ClaimsRepositoryLike,
} from '../src/modules/business/claims/claims.repository.js';
import type { MediaRepositoryLike } from '../src/modules/media/media.repository.js';
import type { MediaService } from '../src/modules/media/media.service.js';
import type { MediaUrlService } from '../src/modules/media/media-url.service.js';
import type { CreateBusinessClaimBody, ReviewBusinessClaimBody } from '@app/contracts';

/**
 * ClaimsService unit tests (B2.9) — the claim lifecycle exercised without a
 * database via hand-written fakes: filing on an unclaimed business only, one
 * pending claim per business, document validation (kind claim_document,
 * ownership, attachment), admin approve (ownership assignment captured) /
 * reject (note required), claimant cancel (own pending only).
 */

const BIZ = randomUUID();
const USER = { id: randomUUID(), role: 'user' };
const ADMIN = { id: randomUUID(), role: 'admin' };
const DOC_ID = randomUUID();
const EVIDENCE = 'سند مالکیت این کسب‌وکار به نام من است و مدارک آن را پیوست کرده‌ام.';

function mediaRow(overrides: Partial<MediaFileRow> = {}): MediaFileRow {
  return {
    id: DOC_ID,
    ownerUserId: USER.id,
    kind: 'claim_document',
    key: 'claim_document/2026/11/x.pdf',
    thumbKey: null,
    mime: 'application/pdf',
    sizeBytes: 5000,
    width: null,
    height: null,
    attachedAt: null,
    createdAt: new Date('2026-11-09T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function claimRow(overrides: Partial<ClaimWithMedia> = {}): ClaimWithMedia {
  return {
    id: randomUUID(),
    businessId: BIZ,
    claimantUserId: USER.id,
    status: 'pending',
    evidence: EVIDENCE,
    documentMediaId: null,
    documentKey: null,
    reviewedBy: null,
    adminNote: null,
    decidedAt: null,
    createdAt: new Date('2026-11-09T00:00:00Z'),
    ...overrides,
  };
}

/** In-memory fake of the claims repository; records approve/reject/cancel calls. */
function makeClaimsFake(
  opts: {
    business?: { ownerId: string | null; isClaimed: boolean } | null;
    pending?: ClaimWithMedia | null;
    claims?: ClaimWithMedia[];
  } = {},
) {
  const business =
    opts.business !== undefined ? opts.business : { ownerId: null, isClaimed: false };
  const claims = new Map<string, ClaimWithMedia>();
  for (const c of opts.claims ?? []) claims.set(c.id, c);
  const calls = { approve: 0, rejected: 0, cancelled: 0 };

  // Simulate the repository's state transitions so post-review re-reads work.
  const applyReview = (id: string, patch: Partial<ClaimWithMedia>) => {
    const row = claims.get(id);
    if (row) Object.assign(row, patch);
  };

  const fake: ClaimsRepositoryLike = {
    findBusinessContext: vi.fn(async (id: string) =>
      id === BIZ && business ? { ...business, deletedAt: null } : null,
    ),
    findPendingByBusiness: vi.fn(async () => opts.pending ?? null),
    findById: vi.fn(async (id: string) => claims.get(id) ?? null),
    listByBusiness: vi.fn(async () => [...claims.values()]),
    listByClaimant: vi.fn(async (uid: string) =>
      [...claims.values()].filter((c) => c.claimantUserId === uid),
    ),
    insert: vi.fn(async (input) => {
      const row = claimRow({
        businessId: input.businessId,
        claimantUserId: input.claimantUserId,
        evidence: input.evidence,
        documentMediaId: input.documentMediaId,
        // Emulate the joined media key so documentUrl resolves like the real repo.
        documentKey: input.documentMediaId ? 'claim_document/2026/11/x.pdf' : null,
      });
      claims.set(row.id, row);
      return row;
    }),
    approve: vi.fn(async (id: string, reviewedBy: string, businessId: string, uid: string) => {
      calls.approve++;
      applyReview(id, { status: 'approved', reviewedBy, decidedAt: new Date() });
      if (business) {
        business.ownerId = uid;
        business.isClaimed = true;
      }
      void businessId;
    }),
    reject: vi.fn(async (id: string, reviewedBy: string, adminNote: string) => {
      calls.rejected++;
      applyReview(id, { status: 'rejected', reviewedBy, adminNote, decidedAt: new Date() });
    }),
    cancel: vi.fn(async (id: string) => {
      calls.cancelled++;
      applyReview(id, { status: 'cancelled', decidedAt: new Date() });
    }),
  };
  return { fake, claims, calls, businessRef: () => business };
}

function makeMediaFake(byId: Map<string, MediaFileRow>) {
  const repo = {
    insert: vi.fn(),
    findById: vi.fn(async (id: string) => byId.get(id) ?? null),
    findByKey: vi.fn(async () => null),
    markAttached: vi.fn(async () => null),
    softDelete: vi.fn(async () => null),
    findUnattachedOlderThan: vi.fn(async () => []),
    deleteRow: vi.fn(),
    findSoftDeletedBefore: vi.fn(async () => []),
  } as unknown as MediaRepositoryLike;
  const service = {
    markAttached: vi.fn(async () => undefined),
    deleteOwned: vi.fn(async () => undefined),
  } as unknown as MediaService;
  const urls = {
    urlFor: (key: string | null | undefined) => (key ? `https://media.test/${key}` : null),
  } as unknown as MediaUrlService;
  return { repo, service, urls };
}

function makeService(opts?: {
  business?: { ownerId: string | null; isClaimed: boolean } | null;
  pending?: ClaimWithMedia | null;
  claims?: ClaimWithMedia[];
  media?: MediaFileRow[];
}) {
  const claimsRepo = makeClaimsFake(opts);
  const map = new Map<string, MediaFileRow>();
  for (const m of opts?.media ?? []) map.set(m.id, m);
  const media = makeMediaFake(map);
  const svc = new ClaimsService(claimsRepo.fake, media.repo, media.service, media.urls);
  return { svc, claimsRepo, media };
}

const createBody = (overrides: Partial<CreateBusinessClaimBody> = {}): CreateBusinessClaimBody => ({
  evidence: EVIDENCE,
  ...overrides,
});

describe('ClaimsService.create (B2.9)', () => {
  it('files a pending claim on an unclaimed business', async () => {
    const { svc } = makeService();
    const claim = await svc.create(BIZ, USER, createBody());
    expect(claim.status).toBe('pending');
    expect(claim.claimantUserId).toBe(USER.id);
    expect(claim.evidence).toBe(EVIDENCE);
    expect(claim.documentUrl).toBeNull();
  });

  it('409s when the caller already owns the business', async () => {
    const { svc } = makeService({ business: { ownerId: USER.id, isClaimed: true } });
    await expect(svc.create(BIZ, USER, createBody())).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s when the business is claimed by someone else', async () => {
    const { svc } = makeService({ business: { ownerId: randomUUID(), isClaimed: true } });
    await expect(svc.create(BIZ, USER, createBody())).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s when a pending claim already exists', async () => {
    const { svc } = makeService({ pending: claimRow() });
    await expect(svc.create(BIZ, USER, createBody())).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s a missing business', async () => {
    const { svc } = makeService({ business: null });
    await expect(svc.create(BIZ, USER, createBody())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s a deleted/unknown document media', async () => {
    const { svc } = makeService({ media: [mediaRow({ deletedAt: new Date() })] });
    await expect(
      svc.create(BIZ, USER, createBody({ documentMediaId: DOC_ID })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('422s a non-claim_document kind', async () => {
    const { svc } = makeService({ media: [mediaRow({ kind: 'business_photo' })] });
    await expect(
      svc.create(BIZ, USER, createBody({ documentMediaId: DOC_ID })),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('403s a document the caller does not own', async () => {
    const { svc } = makeService({ media: [mediaRow({ ownerUserId: randomUUID() })] });
    await expect(
      svc.create(BIZ, USER, createBody({ documentMediaId: DOC_ID })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('409s an already-attached document', async () => {
    const { svc } = makeService({ media: [mediaRow({ attachedAt: new Date() })] });
    await expect(
      svc.create(BIZ, USER, createBody({ documentMediaId: DOC_ID })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('marks the document attached after the claim insert', async () => {
    const doc = mediaRow();
    const { svc, media } = makeService({ media: [doc] });
    const claim = await svc.create(BIZ, USER, createBody({ documentMediaId: DOC_ID }));
    expect(claim.documentUrl).toBe('https://media.test/claim_document/2026/11/x.pdf');
    expect(media.service.markAttached).toHaveBeenCalledWith(DOC_ID, USER.id);
  });
});

describe('ClaimsService.review (B2.9)', () => {
  it('approve: closes the claim and lands ownership (repository tx captured)', async () => {
    const claim = claimRow();
    const { svc, claimsRepo } = makeService({ claims: [claim] });
    const res = await svc.review(claim.id, ADMIN, { decision: 'approve' });
    expect(res.status).toBe('approved');
    expect(res.reviewedBy).toBe(ADMIN.id);
    expect(claimsRepo.calls.approve).toBe(1);
    expect(claimsRepo.businessRef()?.ownerId).toBe(USER.id);
    expect(claimsRepo.businessRef()?.isClaimed).toBe(true);
  });

  it('approve: 409s when the business got claimed in the meantime', async () => {
    const claim = claimRow();
    const { svc } = makeService({
      claims: [claim],
      business: { ownerId: randomUUID(), isClaimed: true },
    });
    await expect(svc.review(claim.id, ADMIN, { decision: 'approve' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('reject: stores the admin note', async () => {
    const claim = claimRow();
    const { svc, claimsRepo } = makeService({ claims: [claim] });
    const body: ReviewBusinessClaimBody = { decision: 'reject', adminNote: 'مدرک کافی نیست' };
    const res = await svc.review(claim.id, ADMIN, body);
    expect(res.status).toBe('rejected');
    expect(res.adminNote).toBe('مدرک کافی نیست');
    expect(claimsRepo.calls.rejected).toBe(1);
  });

  it('reject: 422s without the note (service-side re-check)', async () => {
    const claim = claimRow();
    const { svc } = makeService({ claims: [claim] });
    await expect(svc.review(claim.id, ADMIN, { decision: 'reject' })).rejects.toMatchObject({
      status: 422,
    });
  });

  it('409s a claim that is not pending', async () => {
    const claim = claimRow({ status: 'rejected', adminNote: 'x', decidedAt: new Date() });
    const { svc } = makeService({ claims: [claim] });
    await expect(svc.review(claim.id, ADMIN, { decision: 'approve' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404s an unknown claim', async () => {
    const { svc } = makeService();
    await expect(svc.review(randomUUID(), ADMIN, { decision: 'approve' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ClaimsService.cancel (B2.9)', () => {
  it("cancels the claimant's own pending claim", async () => {
    const claim = claimRow();
    const { svc, claimsRepo } = makeService({ claims: [claim] });
    const res = await svc.cancel(claim.id, USER);
    expect(res.status).toBe('cancelled');
    expect(claimsRepo.calls.cancelled).toBe(1);
  });

  it("403s a stranger cancelling someone else's claim", async () => {
    const claim = claimRow();
    const { svc } = makeService({ claims: [claim] });
    await expect(svc.cancel(claim.id, { id: randomUUID(), role: 'user' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('409s a decided claim', async () => {
    const claim = claimRow({ status: 'approved', reviewedBy: ADMIN.id, decidedAt: new Date() });
    const { svc } = makeService({ claims: [claim] });
    await expect(svc.cancel(claim.id, USER)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ClaimsService.listMine / listByBusiness (B2.9)', () => {
  it("lists the caller's claims only", async () => {
    const mine = claimRow();
    const theirs = claimRow({ claimantUserId: randomUUID() });
    const { svc } = makeService({ claims: [mine, theirs] });
    const items = await svc.listMine(USER);
    expect(items.map((c) => c.id)).toEqual([mine.id]);
  });

  it('lists the business claim history', async () => {
    const { svc, claimsRepo } = makeService();
    const claim = claimRow();
    claimsRepo.claims.set(claim.id, claim);
    const items = await svc.listByBusiness(BIZ);
    expect(items).toHaveLength(1);
  });
});
