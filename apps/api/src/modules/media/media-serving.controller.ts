import { Controller, Get, Inject, NotFoundException, Req, Res } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { PublicMediaKind } from '@app/contracts';
import { PUBLIC_MEDIA_KINDS } from '@app/contracts';
import { RawResponse } from '../../common/interceptors/response-envelope.interceptor.js';
import { Public } from '../../common/decorators/public.decorator.js';
import type { MediaRepositoryLike } from './media.repository.js';
import { MEDIA_REPOSITORY } from './media.repository.js';
import type { StorageDriver } from '../storage/storage.driver.js';
import { STORAGE_DRIVER } from '../storage/storage.driver.js';

/** Cache for a year — keys contain a fresh uuid, content never changes. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

interface ParsedRange {
  start: number;
  end?: number;
}

/**
 * Public media serving (B1.9): GET /media/<key> streams stored files straight
 * from the driver. Lives OUTSIDE /api/v1 (global-prefix exclude) so urls are
 * stable `/media/...`. Only PUBLIC kinds (avatar, business_photo,
 * review_photo, menu_photo) are servable here — claim documents, verification
 * receipts and message attachments are private and will be served by the
 * endpoints of the prompts that own them; their keys 404 here.
 *
 * `@RawResponse()` keeps the envelope interceptor away from the stream;
 * `@Res()` (non-passthrough) hands the raw express response to this handler.
 */
@Controller('media')
export class MediaServingController {
  constructor(
    @Inject(MEDIA_REPOSITORY) private readonly repo: MediaRepositoryLike,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  @Public()
  @Get('*splat')
  @RawResponse()
  async serve(@Req() req: Request, @Res() res: Response) {
    // Key = everything after "/media/" (Nest route params split on "/").
    const raw = req.path.replace(/^\/media\//, '');
    let key: string;
    try {
      key = decodeURIComponent(raw);
    } catch {
      throw new NotFoundException();
    }
    if (key.length === 0 || key.includes('\\') || key.split('/').includes('..')) {
      throw new NotFoundException();
    }
    // Private kinds never resolve on this route, even if a key leaks.
    const kindPrefix = key.split('/')[0] as PublicMediaKind;
    if (!(PUBLIC_MEDIA_KINDS as readonly string[]).includes(kindPrefix)) {
      throw new NotFoundException();
    }

    const row = await this.repo.findByKey(key);
    if (!row || row.deletedAt) throw new NotFoundException();
    if (!(PUBLIC_MEDIA_KINDS as readonly string[]).includes(row.kind)) {
      throw new NotFoundException();
    }

    const size = row.sizeBytes;
    const etag = `"${createHash('sha256').update(`${row.key}:${size}`).digest('hex')}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': CACHE_CONTROL });
      res.end();
      return;
    }

    const range = this.parseRange(req.headers.range, size);
    const baseHeaders: Record<string, string | number> = {
      'Content-Type': row.mime,
      'Cache-Control': CACHE_CONTROL,
      ETag: etag,
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    };

    if (range === 'invalid') {
      res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }

    if (range) {
      const end = range.end ?? size - 1;
      const { stream } = await this.storage.getStream(key, { start: range.start, end });
      res.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes ${range.start}-${end}/${size}`,
        'Content-Length': end - range.start + 1,
      });
      stream.pipe(res);
      stream.on('error', () => res.destroy());
      return;
    }

    const { stream } = await this.storage.getStream(key);
    res.writeHead(200, { ...baseHeaders, 'Content-Length': size });
    stream.pipe(res);
    stream.on('error', () => res.destroy());
  }

  /**
   * Single-range `bytes=start-end|start-|-suffix` parser. Returns null when
   * the header is absent, 'invalid' for malformed/out-of-bounds ranges.
   */
  private parseRange(header: string | undefined, size: number): ParsedRange | null | 'invalid' {
    if (!header) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match) return 'invalid';
    const [, startRaw, endRaw] = match;
    if (startRaw === '' && endRaw === '') return 'invalid';
    if (startRaw === '') {
      // suffix range: last N bytes
      const suffix = Number(endRaw);
      if (suffix <= 0 || size === 0) return 'invalid';
      const start = Math.max(0, size - suffix);
      return { start };
    }
    const start = Number(startRaw);
    if (start >= size) return 'invalid';
    const end = endRaw === '' ? undefined : Number(endRaw);
    if (end !== undefined && end < start) return 'invalid';
    return { start, end };
  }
}
