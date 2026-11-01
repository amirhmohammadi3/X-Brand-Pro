import { z } from 'zod';
import { uuidSchema } from './primitives.js';

/**
 * Media (B1.9): kinds, per-kind upload limits and response schemas shared by
 * the API (upload/serving) and the web client. Every future consumer
 * (avatars, business photos, review photos, chat attachments) imports from
 * here — never re-declare sizes or kinds by hand.
 */

export const MEDIA_KINDS = [
  'avatar',
  'business_photo',
  'review_photo',
  'menu_photo',
  'claim_document',
  'message_attachment',
  'verification_receipt',
] as const;

export const mediaKindSchema = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof mediaKindSchema>;

/** Max upload size in bytes per kind (B1.9). */
export const MEDIA_MAX_BYTES: Readonly<Record<MediaKind, number>> = {
  avatar: 2 * 1024 * 1024,
  business_photo: 10 * 1024 * 1024,
  review_photo: 10 * 1024 * 1024,
  menu_photo: 10 * 1024 * 1024,
  verification_receipt: 10 * 1024 * 1024,
  message_attachment: 10 * 1024 * 1024,
  claim_document: 15 * 1024 * 1024,
};

/** Largest per-kind cap — the multer memory limit for the upload route. */
export const MEDIA_MAX_BYTES_ANY = Math.max(...Object.values(MEDIA_MAX_BYTES));

/**
 * Re-encoded image mime (the ONLY image output format after processing) and
 * the image inputs accepted before re-encoding. `image/gif` and `image/svg+xml`
 * are deliberately absent: SVG can carry scripts, GIF is not needed.
 */
export const PROCESSED_IMAGE_MIME = 'image/webp';
export const ACCEPTED_IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;
/** Extra raw-storage mimes for document-ish kinds (stored untouched). */
export const ACCEPTED_DOCUMENT_MIMES = ['application/pdf'] as const;

/** Kinds whose keys may be served from the PUBLIC `/media/*` route. */
export const PUBLIC_MEDIA_KINDS = [
  'avatar',
  'business_photo',
  'review_photo',
  'menu_photo',
] as const;
export type PublicMediaKind = (typeof PUBLIC_MEDIA_KINDS)[number];

export const isPublicMediaKind = (kind: MediaKind): kind is PublicMediaKind =>
  (PUBLIC_MEDIA_KINDS as readonly string[]).includes(kind);

/**
 * The stored (post-processing) representation of a media file: images are
 * always re-encoded to WebP, document kinds keep their original bytes.
 */
export const storedMimeSchema = z.enum([PROCESSED_IMAGE_MIME, ...ACCEPTED_DOCUMENT_MIMES]);

export const uploadMediaResponseSchema = z.object({
  id: uuidSchema,
  kind: mediaKindSchema,
  /** Public URL of the stored file (`MEDIA_PUBLIC_BASE/<key>`). */
  url: z.string().min(1),
  /** Thumbnail URL; null for raw-stored documents. */
  thumbUrl: z.string().nullable(),
  mime: storedMimeSchema,
  sizeBytes: z.number().int().min(1),
  width: z.number().int().min(1).nullable(),
  height: z.number().int().min(1).nullable(),
});
export type UploadMediaResponse = z.infer<typeof uploadMediaResponseSchema>;
