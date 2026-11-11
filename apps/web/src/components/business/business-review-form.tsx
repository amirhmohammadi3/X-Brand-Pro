'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Rating } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-context';
import { useUploadMedia } from '@/lib/api/account';
import { apiFetch } from '@/lib/api/client';
import { reviewSchema } from '@app/contracts';

/**
 * Review submission form (F4.5) — rating + body + optional photo + optional
 * geo/time check-in, posted to `POST /businesses/:id/reviews` (B4.1).
 *
 * Auth gate: the endpoint is user-scoped (`reviews.write` rate limit, fail-
 * closed), so an anonymous visitor sees a login prompt instead of the form.
 * The photo uploads via `useUploadMedia` (kind `review_photo`, multipart with
 * progress — the one non-JSON call in the app) and its `mediaId` feeds the
 * review body. The check-in requests `navigator.geolocation` and stamps `at`
 * = now; the server validates the geo/time window against the business
 * location (B4.6). On success the review is `pending` (B4.5 spam filter) →
 * the success copy explains it appears once approved, so no list refresh.
 *
 * Client component: every field is interactive state. Field-level server
 * errors (VALIDATION_FAILED envelope) surface as the form-level error string
 * (a per-field wiring is F4.6's scope alongside vote/report).
 */
export interface BusinessReviewFormProps {
  businessId: string;
}

export function BusinessReviewForm({ businessId }: BusinessReviewFormProps) {
  const t = useTranslations('businessPage.reviews');
  const { status } = useAuth();
  const upload = useUploadMedia();

  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [photoMediaId, setPhotoMediaId] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [checkinEnabled, setCheckinEnabled] = useState(false);
  const [checkin, setCheckin] = useState<{ lat: number; lng: number; at: string } | null>(null);
  const [checkinLocating, setCheckinLocating] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (status === 'loading') {
    return null;
  }

  if (status === 'anonymous') {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-lg border border-border-subtle bg-surface-alt p-4 text-center"
        data-testid="business-review-form-gate"
      >
        <p className="text-sm text-muted">{t('form.loginRequired')}</p>
        <Link href="/login" className="text-sm text-primary underline underline-offset-4">
          {t('form.login')}
        </Link>
      </div>
    );
  }

  async function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const media = await upload.mutate(file, 'review_photo');
      setPhotoMediaId(media.id);
      if (typeof URL.createObjectURL === 'function') {
        setPhotoPreview(URL.createObjectURL(file));
      }
    } catch {
      setError(t('form.error'));
    }
  }

  function removePhoto() {
    setPhotoMediaId(null);
    setPhotoPreview(null);
  }

  function onCheckinToggle(enabled: boolean) {
    setCheckinEnabled(enabled);
    setCheckinError(null);
    if (!enabled) {
      setCheckin(null);
      return;
    }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setCheckinError(t('form.checkinUnavailable'));
      return;
    }
    setCheckinLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCheckin({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          at: new Date().toISOString(),
        });
        setCheckinLocating(false);
      },
      () => {
        setCheckinError(t('form.checkinDenied'));
        setCheckinLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating === 0 || body.length < 10 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/businesses/${businessId}/reviews`, reviewSchema, {
        method: 'POST',
        body: {
          rating,
          body,
          photoMediaId: photoMediaId ?? undefined,
          checkin: checkin ?? undefined,
        },
      });
      setSuccess(true);
      setRating(0);
      setBody('');
      setPhotoMediaId(null);
      setPhotoPreview(null);
      setCheckin(null);
      setCheckinEnabled(false);
    } catch {
      setError(t('form.error'));
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div
        className="rounded-lg border border-border-subtle bg-surface-alt p-4"
        data-testid="business-review-form-success"
      >
        <p className="text-sm text-text">{t('form.success')}</p>
      </div>
    );
  }

  const canSubmit = rating > 0 && body.length >= 10 && !submitting && !upload.isPending;

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4"
      data-testid="business-review-form"
    >
      <h3 className="text-base font-semibold text-text">{t('form.title')}</h3>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-text">{t('form.ratingLabel')}</span>
        {/* The Rating input is half-step (0.5…5), but the review rating is an
         * integer (1…5) per createReviewBodySchema — round to the nearest star. */}
        <Rating value={rating} readOnly={false} onValueChange={(v) => setRating(Math.round(v))} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm text-text">{t('form.bodyLabel')}</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('form.bodyPlaceholder')}
          minLength={10}
          maxLength={2000}
          rows={4}
          className="rounded border border-border-subtle bg-surface px-3 py-2 text-sm text-text"
          data-testid="business-review-form-body"
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-sm text-text">{t('form.photoLabel')}</span>
        {photoPreview !== null ? (
          <div className="flex items-center gap-2">
            <img src={photoPreview} alt="" className="h-16 w-16 rounded object-cover" />
            <button
              type="button"
              onClick={removePhoto}
              className="text-xs text-primary underline underline-offset-2"
              data-testid="business-review-form-photo-remove"
            >
              {t('form.photoRemove')}
            </button>
          </div>
        ) : (
          <input
            type="file"
            accept="image/*"
            onChange={onPhotoChange}
            disabled={upload.isPending}
            className="text-sm text-text"
            data-testid="business-review-form-photo"
          />
        )}
        {upload.isPending ? (
          <span className="text-xs text-muted">{t('form.photoUploading')}</span>
        ) : null}
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={checkinEnabled}
          onChange={(e) => onCheckinToggle(e.target.checked)}
          data-testid="business-review-form-checkin"
        />
        <span className="text-sm text-text">{t('form.checkinLabel')}</span>
      </label>
      {checkinLocating ? (
        <span className="text-xs text-muted">{t('form.checkinLocating')}</span>
      ) : null}
      {checkinError ? (
        <span className="text-xs text-danger" data-testid="business-review-form-checkin-error">
          {checkinError}
        </span>
      ) : null}

      {error ? (
        <p className="text-xs text-danger" data-testid="business-review-form-error">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-60"
        data-testid="business-review-form-submit"
      >
        {submitting ? t('form.submitting') : t('form.submit')}
      </button>
    </form>
  );
}
