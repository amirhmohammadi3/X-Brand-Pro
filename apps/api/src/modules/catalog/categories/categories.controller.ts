import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { Public } from '../../../common/decorators/public.decorator.js';
import { RateLimit } from '../../../common/decorators/rate-limit.decorator.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CategoriesService } from './categories.service.js';

/**
 * Public category endpoints (B2.2). Anonymous reads of the active two-level
 * tree. The tree is cached 60 s (server-side via CacheService, client-side via
 * Cache-Control + ETag with 304 negotiation).
 */
@Controller()
export class CategoriesController {
  constructor(private readonly cats: CategoriesService) {}

  @Public()
  @Get('categories')
  @RateLimit({ name: 'catalog.categories', limit: 120, windowSec: 60 })
  async list(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const items = await this.cats.listPublicTree();
    return this.withCache(req, res, { items });
  }

  @Public()
  @Get('categories/:slug')
  @RateLimit({ name: 'catalog.category', limit: 120, windowSec: 60 })
  async getOne(@Param('slug') slug: string) {
    return this.cats.getPublicCategory(slug);
  }

  private withCache<T>(req: Request, res: Response, body: T): T | undefined {
    const etag = `"${createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 16)}"`;
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.status(304);
      return undefined;
    }
    return body;
  }
}
