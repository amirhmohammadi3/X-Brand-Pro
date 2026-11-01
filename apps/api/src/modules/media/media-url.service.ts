import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';

/**
 * Builds public URLs for stored media keys in ONE place (B1.10). Every
 * consumer (profile avatarUrl today, business photos later) goes through
 * this service so the URL scheme (`MEDIA_PUBLIC_BASE/<key>`) lives here.
 */
@Injectable()
export class MediaUrlService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Public URL for a storage key. Returns null for a null key (unset). */
  urlFor(key: string | null | undefined): string | null {
    if (!key) return null;
    const base = this.config.mediaPublicBase.replace(/\/+$/, '');
    return `${base}/${key}`;
  }

  /** Prefers the thumbnail when one exists, else the main file. */
  urlForMedia(media: { key: string; thumbKey: string | null }): string | null {
    return this.urlFor(media.thumbKey ?? media.key);
  }
}
