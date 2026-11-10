import { describe, expect, it, vi } from 'vitest';
import {
  ModerationService,
  MODERATION_EVENTS,
} from '../src/modules/moderation/moderation.service.js';
import type {
  ModerationRepositoryLike,
  ReportWithMeta,
} from '../src/modules/moderation/moderation.repository.js';
import type { ReportCategory, ReportStatus, ReportTarget } from '@app/contracts';

/**
 * B4.4 ModerationService — the report/queue business rules, DB-free: the
 * polymorphic target existence gate, the one-report-per-reporter dedupe
 * (409), the resolution stamping + the event contract. The repository SQL
 * (unique index, triage ordering) is integration-tested against Docker per
 * the Follow-up; the HTTP layer (RBAC, audit, rate limits) is covered in
 * moderation.api.spec.ts.
 */

const REPORTER = { id: '22222222-2222-4222-8222-222222222222', role: 'user' };
const MODERATOR = { id: '47474747-4747-4747-8474-474747474747', role: 'moderator' };
const REVIEW_ID = '55555555-5555-4555-8555-555555555555';
const REPLY_ID = '99999999-9999-4999-8999-999999999999';

function reportRow(overrides: Partial<ReportWithMeta> = {}): ReportWithMeta {
  return {
    id: 'aaaaaaa1-0000-4000-8000-000000000001',
    targetType: 'review' as ReportTarget,
    targetId: REVIEW_ID,
    reporterUserId: REPORTER.id,
    reporterUsername: 'reporter',
    category: 'spam' as ReportCategory,
    details: null,
    status: 'pending' as ReportStatus,
    reviewedBy: null,
    resolutionNote: null,
    reviewedAt: null,
    createdAt: new Date('2026-11-11T08:00:00Z'),
    updatedAt: new Date('2026-11-11T08:00:00Z'),
    ...overrides,
  };
}

/** In-memory repo mirroring the SQL semantics the service relies on. */
function makeRepo(
  reports: ReportWithMeta[] = [],
  existing: { reviews: string[]; replies: string[] } = {
    reviews: [REVIEW_ID],
    replies: [REPLY_ID],
  },
) {
  const rows = new Map(reports.map((r) => [r.id, r]));
  let seq = 100;
  const repo = {
    async reviewExists(reviewId: string) {
      return existing.reviews.includes(reviewId);
    },
    async replyExists(replyId: string) {
      return existing.replies.includes(replyId);
    },
    async insertReport(input: {
      targetType: ReportTarget;
      targetId: string;
      reporterUserId: string;
      category: ReportCategory;
      details: string | null;
    }) {
      const row = reportRow({
        id: `aaaaaaa1-0000-4000-8000-${(seq += 1).toString().padStart(12, '0')}`,
        targetType: input.targetType,
        targetId: input.targetId,
        reporterUserId: input.reporterUserId,
        reporterUsername: 'reporter',
        category: input.category,
        details: input.details,
      });
      rows.set(row.id, row);
      return row;
    },
    async findReportById(id: string) {
      return rows.get(id) ?? null;
    },
    async findReportByReporterAndTarget(
      targetType: ReportTarget,
      targetId: string,
      reporterUserId: string,
    ) {
      for (const r of rows.values()) {
        if (
          r.targetType === targetType &&
          r.targetId === targetId &&
          r.reporterUserId === reporterUserId
        ) {
          return r;
        }
      }
      return null;
    },
    async listReports(status: ReportStatus | undefined, page: number, pageSize: number) {
      // Default queue view: PENDING only, OLDEST first (triage order).
      const wanted = status ?? 'pending';
      const items = [...rows.values()]
        .filter((r) => r.status === wanted)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
    },
    async resolveReport(
      id: string,
      patch: { status: ReportStatus; reviewedBy: string; resolutionNote?: string | null },
    ) {
      const row = rows.get(id);
      if (!row) return null;
      Object.assign(row, {
        status: patch.status,
        reviewedBy: patch.reviewedBy,
        ...(patch.resolutionNote !== undefined && patch.resolutionNote !== null
          ? { resolutionNote: patch.resolutionNote }
          : {}),
        reviewedAt: new Date(),
        updatedAt: new Date(),
      });
      return row;
    },
  };
  return repo as unknown as ModerationRepositoryLike & {
    rows: Map<string, ReportWithMeta>;
  };
}

function makeService(repo = makeRepo()) {
  const events = { emit: vi.fn() };
  const svc = new ModerationService(repo as ModerationRepositoryLike, events as never);
  return { svc, events, repo };
}

const CREATE = { targetType: 'review' as const, targetId: REVIEW_ID, category: 'spam' as const };

describe('ModerationService.createReport (B4.4)', () => {
  it('creates a pending report and emits report.created', async () => {
    const { svc, events } = makeService();
    const res = await svc.createReport(REPORTER, CREATE);
    expect(res.report.status).toBe('pending');
    expect(res.report.targetType).toBe('review');
    expect(res.report.details).toBeNull();
    expect(events.emit).toHaveBeenCalledWith(MODERATION_EVENTS.created, {
      reportId: res.report.id,
      targetType: 'review',
      targetId: REVIEW_ID,
      reporterUserId: REPORTER.id,
      category: 'spam',
    });
  });

  it('accepts a reply target and stores the details payload', async () => {
    const { svc } = makeService();
    const res = await svc.createReport(REPORTER, {
      targetType: 'reply',
      targetId: REPLY_ID,
      category: 'offensive',
      details: 'پاسخ توهین‌آمیز است.',
    });
    expect(res.report.targetType).toBe('reply');
    expect(res.report.details).toBe('پاسخ توهین‌آمیز است.');
  });

  it('404s an unknown target — the same code for review and reply (no kind leak)', async () => {
    const { svc } = makeService(makeRepo([], { reviews: [REVIEW_ID], replies: [] }));
    await expect(
      svc.createReport(REPORTER, { ...CREATE, targetType: 'reply', targetId: REPLY_ID }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('404s a target that no longer exists (hard-deleted content cannot be reported)', async () => {
    const { svc } = makeService(makeRepo([], { reviews: [], replies: [] }));
    await expect(svc.createReport(REPORTER, CREATE)).rejects.toMatchObject({ status: 404 });
  });

  it('409s a second report from the SAME reporter on the SAME target', async () => {
    const { svc } = makeService();
    await svc.createReport(REPORTER, CREATE);
    await expect(svc.createReport(REPORTER, CREATE)).rejects.toMatchObject({ status: 409 });
  });

  it('accepts the same target from a DIFFERENT reporter — volume is the signal', async () => {
    const { svc } = makeService();
    await svc.createReport(REPORTER, CREATE);
    const res = await svc.createReport(
      { id: '33333333-3333-4333-8333-333333333333', role: 'user' },
      CREATE,
    );
    expect(res.report.reporterUserId).toBe('33333333-3333-4333-8333-333333333333');
  });
});

describe('ModerationService.listReports (B4.4)', () => {
  it('defaults to the PENDING triage, oldest first', async () => {
    const rows = [
      reportRow({
        id: 'aaaaaaa1-0000-4000-8000-000000000002',
        createdAt: new Date('2026-11-11T07:00:00Z'),
      }),
      reportRow({
        id: 'aaaaaaa1-0000-4000-8000-000000000003',
        status: 'dismissed' as ReportStatus,
      }),
    ];
    const { svc } = makeService(makeRepo(rows));
    const queue = await svc.listReports({ page: 1, pageSize: 20 });
    expect(queue.meta.total).toBe(1);
    expect(queue.items[0]?.id).toBe('aaaaaaa1-0000-4000-8000-000000000002');
  });

  it('respects an explicit ?status= filter with page meta', async () => {
    const rows = [
      reportRow({ id: 'aaaaaaa1-0000-4000-8000-000000000002', status: 'actioned' as ReportStatus }),
      reportRow({ id: 'aaaaaaa1-0000-4000-8000-000000000003', status: 'actioned' as ReportStatus }),
    ];
    const { svc } = makeService(makeRepo(rows));
    const queue = await svc.listReports({ status: 'actioned', page: 1, pageSize: 20 });
    expect(queue.meta).toMatchObject({ total: 2, totalPages: 1, page: 1 });
  });
});

describe('ModerationService.resolveReport (B4.4)', () => {
  it('stamps reviewed_by/reviewed_at and emits report.resolved on a status change', async () => {
    const { svc, events } = makeService(makeRepo([reportRow()]));
    const res = await svc.resolveReport('aaaaaaa1-0000-4000-8000-000000000001', MODERATOR, {
      status: 'actioned',
      resolutionNote: 'نظر حذف شد',
    });
    expect(res.report.status).toBe('actioned');
    expect(res.report.reviewedBy).toBe(MODERATOR.id);
    expect(res.report.reviewedAt).not.toBeNull();
    expect(res.report.resolutionNote).toBe('نظر حذف شد');
    expect(events.emit).toHaveBeenCalledWith(MODERATION_EVENTS.resolved, {
      reportId: 'aaaaaaa1-0000-4000-8000-000000000001',
      targetType: 'review',
      targetId: REVIEW_ID,
      from: 'pending',
      to: 'actioned',
      moderatorId: MODERATOR.id,
    });
  });

  it('a same-status re-resolve updates the stamps but emits NOTHING', async () => {
    const row = reportRow({ status: 'dismissed' as ReportStatus });
    const { svc, events } = makeService(makeRepo([row]));
    const res = await svc.resolveReport(row.id, MODERATOR, { status: 'dismissed' });
    expect(res.report.status).toBe('dismissed');
    expect(res.report.reviewedBy).toBe(MODERATOR.id);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('404s an unknown report', async () => {
    const { svc } = makeService();
    await expect(
      svc.resolveReport('aaaaaaa1-0000-4000-8000-000000000099', MODERATOR, {
        status: 'dismissed',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
