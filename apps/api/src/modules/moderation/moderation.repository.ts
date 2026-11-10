import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { users } from '../../db/schema/users.js';
import { reviewReplies, reviews, contentReports } from '../../db/schema/reviews.js';
import type { ReportCategory, ReportStatus, ReportTarget } from '@app/contracts';

/** DI token for the moderation repository (tests bind a fake). */
export const MODERATION_REPOSITORY = Symbol('MODERATION_REPOSITORY');

/** A report row joined with the reporter's username (queue rows show who reported). */
export interface ReportWithMeta {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  reporterUserId: string;
  reporterUsername: string;
  category: ReportCategory;
  details: string | null;
  status: ReportStatus;
  reviewedBy: string | null;
  resolutionNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportPage {
  items: ReportWithMeta[];
  total: number;
}

/** The narrow fake-able surface consumed by ModerationService. */
export interface ModerationRepositoryLike {
  insertReport(input: {
    targetType: ReportTarget;
    targetId: string;
    reporterUserId: string;
    category: ReportCategory;
    details: string | null;
  }): Promise<ReportWithMeta>;
  findReportById(reportId: string): Promise<ReportWithMeta | null>;
  /** The one-per-reporter dedupe lookup (unique index target). */
  findReportByReporterAndTarget(
    targetType: ReportTarget,
    targetId: string,
    reporterUserId: string,
  ): Promise<ReportWithMeta | null>;
  /** The queue: explicit status filter, OLDEST first (triage order). */
  listReports(
    status: ReportStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<ReportPage>;
  /** The moderator's decision — always stamps reviewed_by/reviewed_at. */
  resolveReport(
    reportId: string,
    patch: { status: ReportStatus; reviewedBy: string; resolutionNote?: string | null },
  ): Promise<ReportWithMeta | null>;

  // ── Polymorphic target existence (no FK can span two tables) ──────────
  reviewExists(reviewId: string): Promise<boolean>;
  replyExists(replyId: string): Promise<boolean>;
}

const REPORT_SELECT = {
  id: contentReports.id,
  targetType: contentReports.targetType,
  targetId: contentReports.targetId,
  reporterUserId: contentReports.reporterUserId,
  reporterUsername: users.username,
  category: contentReports.category,
  details: contentReports.details,
  status: contentReports.status,
  reviewedBy: contentReports.reviewedBy,
  resolutionNote: contentReports.resolutionNote,
  reviewedAt: contentReports.reviewedAt,
  createdAt: contentReports.createdAt,
  updatedAt: contentReports.updatedAt,
};

/**
 * Moderation persistence (B4.4) over `content_reports` (migration 0024).
 * The queue list orders OLDEST first (content_reports_status_created_idx —
 * the triage index mirrors reviews_status_created_idx from B4.1). Target
 * existence is validated here with index-only existence SELECTs — the
 * polymorphic target cannot be a real FK (see the schema comment).
 */
@Injectable()
export class ModerationRepository implements ModerationRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  private async findReport(where: unknown): Promise<ReportWithMeta | null> {
    const rows = await this.client.db
      .select(REPORT_SELECT)
      .from(contentReports)
      .innerJoin(users, eq(users.id, contentReports.reporterUserId))
      .where(where as never)
      .limit(1);
    return rows[0] ?? null;
  }

  async insertReport(input: {
    targetType: ReportTarget;
    targetId: string;
    reporterUserId: string;
    category: ReportCategory;
    details: string | null;
  }): Promise<ReportWithMeta> {
    const inserted = await this.client.db
      .insert(contentReports)
      .values({
        targetType: input.targetType,
        targetId: input.targetId,
        reporterUserId: input.reporterUserId,
        category: input.category,
        ...(input.details !== null ? { details: input.details } : {}),
      })
      .returning({ id: contentReports.id });
    const row = inserted[0];
    if (!row) throw new Error('content_reports insert returned no rows');
    const created = await this.findReport(eq(contentReports.id, row.id));
    if (!created) throw new Error('content report vanished after insert');
    return created;
  }

  async findReportById(reportId: string): Promise<ReportWithMeta | null> {
    return this.findReport(eq(contentReports.id, reportId));
  }

  async findReportByReporterAndTarget(
    targetType: ReportTarget,
    targetId: string,
    reporterUserId: string,
  ): Promise<ReportWithMeta | null> {
    return this.findReport(
      and(
        eq(contentReports.targetType, targetType),
        eq(contentReports.targetId, targetId),
        eq(contentReports.reporterUserId, reporterUserId),
      ),
    );
  }

  async listReports(
    status: ReportStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<ReportPage> {
    const where =
      status === undefined
        ? eq(contentReports.status, 'pending')
        : eq(contentReports.status, status);
    const items = await this.client.db
      .select(REPORT_SELECT)
      .from(contentReports)
      .innerJoin(users, eq(users.id, contentReports.reporterUserId))
      .where(where)
      .orderBy(asc(contentReports.createdAt), asc(contentReports.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totals = await this.client.db.select({ n: count() }).from(contentReports).where(where);
    return { items, total: totals[0]?.n ?? 0 };
  }

  async resolveReport(
    reportId: string,
    patch: { status: ReportStatus; reviewedBy: string; resolutionNote?: string | null },
  ): Promise<ReportWithMeta | null> {
    await this.client.db
      .update(contentReports)
      .set({
        status: patch.status,
        reviewedBy: patch.reviewedBy,
        ...(patch.resolutionNote !== undefined && patch.resolutionNote !== null
          ? { resolutionNote: patch.resolutionNote }
          : {}),
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(contentReports.id, reportId));
    return this.findReport(eq(contentReports.id, reportId));
  }

  /** index-only existence probe off the primary key. */
  async reviewExists(reviewId: string): Promise<boolean> {
    const rows = await this.client.db
      .select({ id: reviews.id })
      .from(reviews)
      .where(eq(reviews.id, reviewId))
      .limit(1);
    return rows.length > 0;
  }

  async replyExists(replyId: string): Promise<boolean> {
    const rows = await this.client.db
      .select({ id: reviewReplies.id })
      .from(reviewReplies)
      .where(eq(reviewReplies.id, replyId))
      .limit(1);
    return rows.length > 0;
  }
}
