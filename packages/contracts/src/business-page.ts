import { z } from 'zod';
import { businessDetailSchema, businessPhotoSchema } from './business.js';
import { hoursResponseSchema } from './hours.js';
import { menuResponseSchema } from './menu.js';
import { reviewSchema } from './reviews.js';
import { pageMetaSchema, pageQuerySchema } from './pagination.js';

/**
 * B4.9 — the ONE aggregate read the F4.1 business page needs for first
 * paint: the business detail, its weekly hours (with the open-now status),
 * the gallery, the menu, the first page of approved reviews, the approved
 * question count (the full Q&A list is its own paginated endpoint) and the
 * schema.org JSON-LD object the page injects as
 * `<script type="application/ld+json">` for SEO.
 *
 * Everything is composed from the ALREADY-public endpoints' services — the
 * aggregate leaks nothing new: the visibility gate is exactly
 * `BusinessesService.getBusinessDetail`'s (active for guests; non-active
 * visible only to the owner / a `businesses.manage` holder, 404 otherwise —
 * existence is never leaked).
 */

/**
 * The embedded reviews page: default 5, max 20 — the full paginated list
 * (and the moderation status filter) remains GET /businesses/:id/reviews' job.
 */
export const businessPageQuerySchema = pageQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(20).default(5),
});
export type BusinessPageQuery = z.infer<typeof businessPageQuerySchema>;

/** First page of approved reviews + the exact list meta (total/totalPages). */
export const businessPageReviewsSchema = z.object({
  items: z.array(reviewSchema),
  meta: pageMetaSchema,
});
export type BusinessPageReviews = z.infer<typeof businessPageReviewsSchema>;

/** Q&A summary — the count the page header renders; the list itself is paginated separately. */
export const businessPageQuestionsSchema = z.object({
  total: z.number().int().min(0),
});
export type BusinessPageQuestions = z.infer<typeof businessPageQuestionsSchema>;

/**
 * The schema.org object is OPEN (record of unknown) on the wire — the
 * builder owns the shape (see businesses-jsonld.ts) and the server always
 * emits `@context` + `@type`; the web client injects it verbatim.
 */
export const businessJsonLdSchema = z.record(z.string(), z.unknown());
export type BusinessJsonLd = z.infer<typeof businessJsonLdSchema>;

export const businessPageSchema = z.object({
  business: businessDetailSchema,
  hours: hoursResponseSchema,
  photos: z.array(businessPhotoSchema),
  menu: menuResponseSchema,
  reviews: businessPageReviewsSchema,
  questions: businessPageQuestionsSchema,
  jsonLd: businessJsonLdSchema,
});
export type BusinessPage = z.infer<typeof businessPageSchema>;
