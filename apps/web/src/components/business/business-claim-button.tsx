'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Modal, useModalState } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-context';
import { useUploadMedia } from '@/lib/api/account';
import { apiFetch } from '@/lib/api/client';
import { businessClaimSchema } from '@app/contracts';

/**
 * Ownership claim (F4.10) — shown on an unclaimed business page. An
 * authenticated visitor opens a modal with the evidence textarea (20–2000
 * chars, free text) and an optional `claim_document` upload (the mediaId
 * feeds `documentMediaId`), then POSTs to `/businesses/:id/claims` (B4.9).
 * The claim is `pending` until a moderator reviews it. Anonymous visitors see
 * a login prompt instead of the button.
 *
 * Client component: modal + upload + submit are interactive state.
 */
export interface BusinessClaimButtonProps {
  businessId: string;
}

export function BusinessClaimButton({ businessId }: BusinessClaimButtonProps) {
  const t = useTranslations('claim');
  const { status } = useAuth();
  const upload = useUploadMedia();
  const { open, openModal, closeModal } = useModalState();

  const [evidence, setEvidence] = useState('');
  const [documentMediaId, setDocumentMediaId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (status !== 'authenticated') {
    return (
      <div
        className="rounded-lg border border-border-subtle bg-surface-alt p-3 text-center"
        data-testid="claim-gate"
      >
        <p className="text-xs text-muted">{t('loginRequired')}</p>
        <Link href="/login" className="text-xs text-primary underline underline-offset-2">
          {t('button')}
        </Link>
      </div>
    );
  }

  async function onDocument(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const media = await upload.mutate(file, 'claim_document');
      setDocumentMediaId(media.id);
    } catch {
      setError(t('error'));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (evidence.trim().length < 20 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/businesses/${businessId}/claims`, businessClaimSchema, {
        method: 'POST',
        body: {
          evidence: evidence.trim(),
          documentMediaId: documentMediaId ?? undefined,
        },
      });
      setSuccess(true);
    } catch {
      setError(t('error'));
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div
        className="rounded-lg border border-border-subtle bg-surface-alt p-3"
        data-testid="claim-success"
      >
        <p className="text-xs text-text">{t('success')}</p>
      </div>
    );
  }

  const inputClass = 'rounded border border-border-subtle bg-surface px-3 py-2 text-sm';

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-lg border border-primary bg-surface px-3 py-1.5 text-xs font-medium text-primary transition-opacity hover:opacity-90"
        data-testid="claim-button"
      >
        {t('button')}
      </button>
      <Modal
        open={open}
        onOpenChange={(o) => (o ? openModal() : closeModal())}
        size="md"
        title={t('title')}
      >
        <form onSubmit={submit} className="flex flex-col gap-3" data-testid="claim-form">
          <label className="flex flex-col gap-1 text-sm text-text">
            <span>{t('evidenceLabel')}</span>
            <textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder={t('evidencePlaceholder')}
              minLength={20}
              maxLength={2000}
              rows={4}
              className={inputClass}
              data-testid="claim-evidence"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-text">
            <span>{t('receiptLabel')}</span>
            <input
              type="file"
              onChange={onDocument}
              disabled={upload.isPending}
              className="text-sm"
              data-testid="claim-document"
            />
            {upload.isPending ? (
              <span className="text-xs text-muted">{t('submitting')}</span>
            ) : null}
          </label>
          {error ? (
            <p className="text-xs text-danger" data-testid="claim-error">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={evidence.trim().length < 20 || submitting}
            className="self-start rounded-lg bg-primary px-4 py-2 text-sm text-on-primary disabled:opacity-60"
            data-testid="claim-submit"
          >
            {submitting ? t('submitting') : t('submit')}
          </button>
        </form>
      </Modal>
    </>
  );
}
