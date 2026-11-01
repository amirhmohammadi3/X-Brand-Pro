import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { type AuthenticatedHttpRequest } from '../auth/jwt-auth.guard.js';
import {
  adminTranslationDeleteQuerySchema,
  adminTranslationsQuerySchema,
  createLanguageBodySchema,
  importResultSchema,
  importTranslationsBodySchema,
  updateLanguageBodySchema,
  upsertTranslationsBodySchema,
  type AdminTranslationDeleteQuery,
  type AdminTranslationsListResponse,
  type AdminTranslationsQuery,
  type CreateLanguageBody,
  type ImportResult,
  type ImportTranslationsBody,
  type Language,
  type UpdateLanguageBody,
  type UpsertTranslationsBody,
} from '@app/contracts';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AUDIT_SERVICE, type AuditService } from '../audit/audit.service.js';
import { computeBundleVersion, containsHtml, sanitizeTranslationValue } from './i18n.bundle.js';
// I18nService is constructor-injected by class type: Nest reads its type at
// runtime from emitDecoratorMetadata — value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { I18nService } from './i18n.service.js';
import { I18N_REPOSITORY, type I18nRepository } from './i18n.repository.js';

function unprocessable(message: string, details?: unknown): HttpException {
  return new HttpException(
    { code: 'UNPROCESSABLE', message, details },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

/** AuditRequestInfo from an authenticated request (typed headers need normalizing). */
function auditRequestInfo(req: AuthenticatedHttpRequest): {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
} {
  const ua = req.headers['user-agent'];
  const rid = req.headers['x-request-id'];
  return {
    ip: req.ip ?? null,
    userAgent: Array.isArray(ua) ? (ua[0] ?? null) : (ua ?? null),
    requestId: typeof rid === 'string' ? rid : null,
  };
}

/**
 * Admin i18n management (B1.12). Permission `i18n.manage`, audit logged.
 * Invariants enforced here (422 UNPROCESSABLE otherwise):
 *  - the default language cannot be deactivated
 *  - `fa` can never be deactivated or deleted
 *  - translation values never contain HTML tags (control chars are stripped)
 */
@Controller('admin/i18n')
@RequirePermissions('i18n.manage')
export class I18nAdminController {
  constructor(
    private readonly i18n: I18nService,
    @Inject(I18N_REPOSITORY) private readonly repo: I18nRepository,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  @Get('languages')
  @RateLimit({ name: 'admin.i18n.read', limit: 60, windowSec: 60, scope: 'user' })
  async listAllLanguages(): Promise<{ items: Language[] }> {
    return { items: await this.i18n.getLanguages(false) };
  }

  @Post('languages')
  @RateLimit({ name: 'admin.i18n.write', limit: 60, windowSec: 60, scope: 'user' })
  async createLanguage(
    @Req() req: AuthenticatedHttpRequest,
    @Body(new ZodValidationPipe(createLanguageBodySchema)) body: CreateLanguageBody,
  ): Promise<Language> {
    const created = await this.repo.createLanguage(body);
    await this.i18n.invalidateLanguageList();
    this.audit.log({
      actor: { id: req.user?.id ?? null, role: req.user?.role ?? null },
      action: 'i18n.language.create',
      entityType: 'language',
      entityId: created.code,
      after: created,
      request: auditRequestInfo(req),
    });
    return toLanguageDto(created);
  }

  @Patch('languages/:code')
  @RateLimit({ name: 'admin.i18n.write', limit: 60, windowSec: 60, scope: 'user' })
  async updateLanguage(
    @Req() req: AuthenticatedHttpRequest,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(updateLanguageBodySchema)) body: UpdateLanguageBody,
  ): Promise<Language> {
    const before = await this.repo.findLanguage(code);
    if (!before) {
      throw unprocessable(`Unknown language: ${code}`);
    }
    if (body.isActive === false && before.isDefault) {
      throw unprocessable('The default language cannot be deactivated');
    }
    if (body.isActive === false && code === 'fa') {
      throw unprocessable('The fa language cannot be deactivated');
    }

    const updated = await this.repo.updateLanguage(code, body);
    if (!updated) {
      throw unprocessable(`Unknown language: ${code}`);
    }
    await this.i18n.invalidateLanguageList();
    this.audit.log({
      actor: { id: req.user?.id ?? null, role: req.user?.role ?? null },
      action: 'i18n.language.update',
      entityType: 'language',
      entityId: code,
      before: {
        isActive: before.isActive,
        isDefault: before.isDefault,
        sortOrder: before.sortOrder,
      },
      after: {
        isActive: updated.isActive,
        isDefault: updated.isDefault,
        sortOrder: updated.sortOrder,
      },
      request: auditRequestInfo(req),
    });
    return toLanguageDto(updated);
  }

  @Delete('languages/:code')
  @RateLimit({ name: 'admin.i18n.write', limit: 60, windowSec: 60, scope: 'user' })
  async deleteLanguage(
    @Req() req: AuthenticatedHttpRequest,
    @Param('code') code: string,
  ): Promise<{ deleted: boolean }> {
    if (code === 'fa') {
      throw unprocessable('The fa language cannot be deleted');
    }
    const language = await this.repo.findLanguage(code);
    if (!language) {
      throw unprocessable(`Unknown language: ${code}`);
    }
    if (language.isDefault) {
      throw unprocessable('The default language cannot be deleted — switch the default first');
    }
    const deleted = await this.repo.deleteLanguage(code);
    await this.i18n.invalidateLanguageList();
    this.audit.log({
      actor: { id: req.user?.id ?? null, role: req.user?.role ?? null },
      action: 'i18n.language.delete',
      entityType: 'language',
      entityId: code,
      request: auditRequestInfo(req),
    });
    return { deleted };
  }

  @Get('translations')
  @RateLimit({ name: 'admin.i18n.read', limit: 60, windowSec: 60, scope: 'user' })
  async listTranslations(
    @Query(new ZodValidationPipe(adminTranslationsQuerySchema))
    query: AdminTranslationsQuery,
  ): Promise<AdminTranslationsListResponse> {
    const def = await this.i18n.getDefaultLocale();
    const page = await this.repo.listTranslationsPage(query.locale, {
      q: query.q,
      namespace: query.namespace,
      missing: query.missing === 'true',
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: page.items.map((item) => ({
        key: item.key,
        value: item.value,
        // For non-missing listings include the default-locale reference value.
        defaultValue: item.defaultValue ?? (query.locale === def ? item.value : null),
        updatedAt: item.updatedAt ? item.updatedAt.toISOString() : null,
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: page.total,
        totalPages: Math.ceil(page.total / query.pageSize),
      },
    };
  }

  @Put('translations')
  @RateLimit({ name: 'admin.i18n.write', limit: 60, windowSec: 60, scope: 'user' })
  async upsertTranslations(
    @Req() req: AuthenticatedHttpRequest,
    @Body(new ZodValidationPipe(upsertTranslationsBodySchema)) body: UpsertTranslationsBody,
  ): Promise<{ updated: number }> {
    const language = await this.repo.findLanguage(body.locale);
    if (!language) {
      throw unprocessable(`Unknown language: ${body.locale}`);
    }
    const entries = body.entries.map((entry) => {
      const value = sanitizeTranslationValue(entry.value);
      if (containsHtml(value)) {
        throw unprocessable(`HTML is not allowed in translation values (${entry.key})`, {
          key: entry.key,
        });
      }
      return { key: entry.key, value };
    });
    await this.repo.upsertTranslations(body.locale, entries, req.user?.id ?? null);
    await this.i18n.invalidateTranslations(body.locale);
    this.audit.log({
      actor: { id: req.user?.id ?? null, role: req.user?.role ?? null },
      action: 'i18n.translation.upsert',
      entityType: 'translation',
      entityId: body.locale,
      after: { keys: entries.map((e) => e.key) },
      request: auditRequestInfo(req),
    });
    return { updated: entries.length };
  }

  @Delete('translations')
  @RateLimit({ name: 'admin.i18n.write', limit: 60, windowSec: 60, scope: 'user' })
  async deleteTranslation(
    @Req() req: AuthenticatedHttpRequest,
    @Query(new ZodValidationPipe(adminTranslationDeleteQuerySchema))
    query: AdminTranslationDeleteQuery,
  ): Promise<{ deleted: boolean }> {
    const deleted = await this.repo.deleteTranslation(query.locale, query.key);
    await this.i18n.invalidateTranslations(query.locale);
    this.audit.log({
      actor: { id: req.user?.id ?? null, role: req.user?.role ?? null },
      action: 'i18n.translation.delete',
      entityType: 'translation',
      entityId: `${query.locale}:${query.key}`,
      request: auditRequestInfo(req),
    });
    return { deleted };
  }

  /** JSON download: EVERY key of the default locale, '' where the target is missing. */
  @Get('export/:locale')
  @RateLimit({ name: 'admin.i18n.read', limit: 30, windowSec: 60, scope: 'user' })
  async exportLocale(@Param('locale') locale: string, @Res() res: Response): Promise<void> {
    const language = await this.repo.findLanguage(locale);
    if (!language) {
      throw unprocessable(`Unknown language: ${locale}`);
    }
    const def = await this.i18n.getDefaultLocale();
    const [target, defaults] = await Promise.all([
      this.repo.listAllTranslations(locale),
      this.repo.listAllTranslations(def),
    ]);
    const messages: Record<string, string> = {};
    for (const key of Object.keys(defaults).sort()) {
      messages[key] = locale === def ? (defaults[key] ?? '') : (target[key] ?? '');
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${locale}.json"`);
    res.setHeader('X-Bundle-Version', computeBundleVersion(messages));
    res.status(200).send(JSON.stringify(messages, null, 2));
  }

  @Post('import')
  @RateLimit({ name: 'admin.i18n.write', limit: 30, windowSec: 60, scope: 'user' })
  async importTranslations(
    @Req() req: AuthenticatedHttpRequest,
    @Body(new ZodValidationPipe(importTranslationsBodySchema)) body: ImportTranslationsBody,
  ): Promise<ImportResult> {
    const language = await this.repo.findLanguage(body.locale);
    if (!language) {
      throw unprocessable(`Unknown language: ${body.locale}`);
    }
    const def = await this.i18n.getDefaultLocale();
    const existing = await this.repo.listAllTranslations(body.locale);
    const defaults = body.locale === def ? existing : await this.repo.listAllTranslations(def);

    const toInsert: Array<{ key: string; value: string }> = [];
    const toUpdate: Array<{ key: string; value: string }> = [];
    let skipped = 0;

    for (const [rawKey, rawValue] of Object.entries(body.messages)) {
      const value = sanitizeTranslationValue(rawValue);
      // Import follows the same value rules as manual edits.
      if (containsHtml(value)) {
        throw unprocessable(`HTML is not allowed in translation values (${rawKey})`, {
          key: rawKey,
        });
      }
      if (body.mode === 'fill_missing') {
        if (existing[rawKey] !== undefined) {
          skipped += 1;
          continue;
        }
        toInsert.push({ key: rawKey, value });
      } else if (existing[rawKey] === undefined && defaults[rawKey] === undefined) {
        // overwrite mode still refuses keys the platform does not know at all:
        // imports synchronize EXISTING keys, they do not create arbitrary ones.
        skipped += 1;
        continue;
      } else {
        toUpdate.push({ key: rawKey, value });
      }
    }

    const entries = [...toInsert, ...toUpdate];
    if (entries.length > 0) {
      await this.repo.upsertTranslations(body.locale, entries, req.user?.id ?? null);
      await this.i18n.invalidateTranslations(body.locale);
    }
    this.audit.log({
      actor: { id: req.user?.id ?? null, role: req.user?.role ?? null },
      action: 'i18n.translations.import',
      entityType: 'translation',
      entityId: body.locale,
      after: { mode: body.mode, inserted: toInsert.length, updated: toUpdate.length, skipped },
      request: auditRequestInfo(req),
    });
    return importResultSchema.parse({
      inserted: toInsert.length,
      updated: toUpdate.length,
      skipped,
    });
  }
}

function toLanguageDto(row: {
  code: string;
  nameNative: string;
  nameEn: string;
  dir: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}): Language {
  return {
    code: row.code,
    nameNative: row.nameNative,
    nameEn: row.nameEn,
    dir: row.dir === 'rtl' ? 'rtl' : 'ltr',
    isDefault: row.isDefault,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}
