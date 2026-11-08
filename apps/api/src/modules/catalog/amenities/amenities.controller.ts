import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { Public } from '../../../common/decorators/public.decorator.js';
import { RateLimit } from '../../../common/decorators/rate-limit.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AmenitiesService } from './amenities.service.js';

/** Public amenity endpoints (B2.3). Cached 60 s + ETag/304. */
@Controller()
export class AmenitiesController {
  constructor(private readonly amen: AmenitiesService) {}

  @Public()
  @Get('amenities')
  @RateLimit({ name: 'catalog.amenities', limit: 120, windowSec: 60 })
  async list(
    @Query('categorySlug') categorySlug: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const items = await this.amen.listPublicAmenities(categorySlug);
    const etag = `"${createHash('sha1').update(JSON.stringify(items)).digest('hex').slice(0, 16)}"`;
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.status(304);
      return undefined;
    }
    return { items };
  }
}
