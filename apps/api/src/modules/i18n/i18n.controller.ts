import { Controller, Get, Headers, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { messagesQuerySchema, type MessagesQuery } from '@app/contracts';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { RawResponse } from '../../common/interceptors/response-envelope.interceptor.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
// I18nService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { I18nService } from './i18n.service.js';

/**
 * Public i18n endpoints (B1.12).
 *  - GET /i18n/languages        — active languages (60 s cache + ETag)
 *  - GET /i18n/messages/:locale — message bundle (ETag / 304, CDN-friendly
 *    Cache-Control; unknown or INACTIVE locale → 404). Raw JSON response so
 *    the 304 has no body and the bundle is served exactly as cached.
 */
@Controller('i18n')
export class I18nController {
  constructor(private readonly i18n: I18nService) {}

  @Public()
  @RateLimit({ name: 'i18n.languages', limit: 60, windowSec: 60 })
  @Get('languages')
  async languages(@Res({ passthrough: true }) res: Response) {
    const items = await this.i18n.getLanguages(true);
    const etag = `W/"${Buffer.from(JSON.stringify(items)).toString('base64url').slice(0, 24)}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    return { items };
  }

  @Public()
  @RateLimit({ name: 'i18n.messages', limit: 120, windowSec: 60 })
  @Get('messages/:locale')
  @RawResponse()
  async messages(
    @Param('locale') locale: string,
    @Query(new ZodValidationPipe(messagesQuerySchema)) query: MessagesQuery,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const namespaces = query.namespaces ? query.namespaces.split(',') : undefined;
    const bundle = await this.i18n.getBundle(locale, namespaces);
    if (!bundle) {
      res.status(404).json({
        ok: false,
        error: {
          code: 'NOT_FOUND',
          messageKey: 'errors.not_found',
          message: `Unknown or inactive locale: ${locale}`,
          requestId: res.getHeader('x-request-id') ?? '',
        },
      });
      return;
    }

    res.setHeader('ETag', `"${bundle.version}"`);
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    if (ifNoneMatch && ifNoneMatch.replace(/^W\//, '').replaceAll('"', '') === bundle.version) {
      res.status(304);
      res.end();
      return;
    }
    res.status(200).json(bundle);
  }
}
