import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
// Value import (not type-only): Nest reads the constructor parameter type at
// runtime via emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  CreateReportBody,
  Report,
  ReportListResult,
  ReportStatus,
  ReportTarget,
  ResolveReportBody,
} from '@app/contracts';
import {
  MODERATION_REPOSITORY,
  type ModerationRepositoryLike,
  type ReportWithMeta,
} from './moderation.repository.js';
import type { BusinessActor } from '../business/business-access.js';

/** Domain events (AGENTS.md 6) — hooks for the B4.5 spam filter and notification prompts. */
export const MODERATION_EVENTS = {
  /** A user flagged content — the B4.5 velocity filter watches report bursts. */
  created: 'report.created',
  /** A moderator resolved a report (status actually changed). */
  resolved: 'report.resolved',
} as const;

function notFoundException(what: string, id: string): HttpException {
  return new HttpException(
    {
      code: 'NOT_FOUND' as const,
      messageKey: 'errors.not_found',
      message: `${what} ${id} not found`,
      details: { entity: what.toLowerCase(), id },
    },
    HttpStatus.NOT_FOUND,
  );
}

function conflictException(message: string, details?: unknown): HttpException {
  return new HttpException(
    {
      code: 'CONFLICT' as const,
      messageKey: 'errors.conflict',
      message,
      details,
    },
    HttpStatus.CONFLICT,
  );
}

/**
 * Abuse reports + the moderation queue (B4.4). Rules:
 * - ANY authenticated user may report a review or a reply (the target must
 *   EXIST — 404, never leaking which kind was wrong; a hard-deleted target
 *   cannot be reported, its reports survive instead);
 * - ONE report per reporter per target — a repeat is 409 (the abuse signal
 *   is cross-user report VOLUME, never a single account pumping rows);
 * - the queue and the decisions are `reviews.manage`-only (moderator/admin);
 * - a resolution always stamps reviewed_by + reviewed_at; the event fires
 *   only when the STATUS actually changed (a note-only edit re-resolves
 *   quietly);
 * - reports on since-deleted content stay in the queue for the moderator to
 *   dismiss — the trail of WHY content vanished outlives the content.
 */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(MODERATION_REPOSITORY) private readonly repo: ModerationRepositoryLike,
    private readonly events: EventEmitter2,
  ) {}

  async createReport(user: BusinessActor, input: CreateReportBody): Promise<{ report: Report }> {
    const exists =
      input.targetType === 'review'
        ? await this.repo.reviewExists(input.targetId)
        : await this.repo.replyExists(input.targetId);
    if (!exists) {
      // Same 404 for review and reply — never leak the target's kind/state.
      throw notFoundException('Report target', input.targetId);
    }
    const duplicate = await this.repo.findReportByReporterAndTarget(
      input.targetType,
      input.targetId,
      user.id,
    );
    if (duplicate) {
      throw conflictException('You have already reported this content', {
        reportId: duplicate.id,
      });
    }
    const row = await this.repo.insertReport({
      targetType: input.targetType,
      targetId: input.targetId,
      reporterUserId: user.id,
      category: input.category,
      details: input.details ?? null,
    });
    this.events.emit(MODERATION_EVENTS.created, {
      reportId: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      reporterUserId: user.id,
      category: row.category,
    });
    return { report: this.toReport(row) };
  }

  /** The moderation queue — defaults to the PENDING triage when no status is given. */
  async listReports(query: {
    status?: ReportStatus;
    page: number;
    pageSize: number;
  }): Promise<ReportListResult> {
    const result = await this.repo.listReports(query.status, query.page, query.pageSize);
    return {
      items: result.items.map((row) => this.toReport(row)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / query.pageSize),
      },
    };
  }

  /**
   * Resolve a report: `reviewed` (seen, no violation), `dismissed` (no
   * action needed) or `actioned` (the violation WAS handled — the takedown
   * itself rides the B4.1/B4.3 delete endpoints; the report records it).
   * `pending` is deliberately unreachable here — a decision leaves the
   * queue. Re-resolving to the SAME status updates the note/decision stamps
   * but emits nothing (no notification churn).
   */
  async resolveReport(
    reportId: string,
    moderator: BusinessActor,
    input: ResolveReportBody,
  ): Promise<{ report: Report }> {
    const row = await this.repo.findReportById(reportId);
    if (!row) throw notFoundException('Report', reportId);
    // Captured BEFORE the write — the resolution overwrites the row's status.
    const from = row.status;
    const changed = from !== input.status;
    const updated = await this.repo.resolveReport(reportId, {
      status: input.status,
      reviewedBy: moderator.id,
      ...(input.resolutionNote !== undefined ? { resolutionNote: input.resolutionNote } : {}),
    });
    if (!updated) throw notFoundException('Report', reportId);
    if (changed) {
      this.events.emit(MODERATION_EVENTS.resolved, {
        reportId,
        targetType: updated.targetType,
        targetId: updated.targetId,
        from,
        to: updated.status,
        moderatorId: moderator.id,
      });
    }
    return { report: this.toReport(updated) };
  }

  /** Map a joined row to the contract shape (dates to ISO strings). */
  private toReport(row: ReportWithMeta): Report {
    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      reporterUserId: row.reporterUserId,
      reporterUsername: row.reporterUsername,
      category: row.category,
      details: row.details,
      status: row.status,
      reviewedBy: row.reviewedBy,
      resolutionNote: row.resolutionNote,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** The report target kinds the create endpoint accepts (type re-export anchor). */
export type { ReportTarget };
