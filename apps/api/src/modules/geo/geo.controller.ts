import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GeoService } from './geo.service.js';

/**
 * Public geo endpoints (B2.1). Anonymous reads of active cities and
 * neighborhoods. The city list is cached 60 s (server-side via CacheService,
 * client-side via Cache-Control + ETag with 304 negotiation).
 */
@Controller()
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Public()
  @Get('cities')
  @RateLimit({ name: 'geo.cities', limit: 120, windowSec: 60 })
  async listCities(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const items = await this.geo.listPublicCities();
    return this.withCache(req, res, { items });
  }

  @Public()
  @Get('cities/:slug')
  @RateLimit({ name: 'geo.city', limit: 120, windowSec: 60 })
  async getCity(@Param('slug') slug: string) {
    return this.geo.getPublicCity(slug);
  }

  @Public()
  @Get('cities/:slug/neighborhoods')
  @RateLimit({ name: 'geo.neighborhoods', limit: 120, windowSec: 60 })
  async listNeighborhoods(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('slug') slug: string,
  ) {
    const items = await this.geo.listPublicNeighborhoods(slug);
    return this.withCache(req, res, { items });
  }

  /** Set Cache-Control + a stable ETag; answer 304 when the client has it. */
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
