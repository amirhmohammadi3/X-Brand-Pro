'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { Button } from '../ui';
import { Modal } from '../ui/modal';

export interface LoginRequiredPromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * `LoginRequiredPrompt` (F1.8). A Modal for later features that hit a
 * guest-only boundary ("bookmark this", "write a review", …): it explains
 * that logging in is required and offers login — carrying the CURRENT page
 * as `?next=` so the user lands back where they started — plus a register
 * shortcut. Rendering it is the caller's decision; this component only
 * owns the copy and the two buttons.
 */
export function LoginRequiredPrompt({ open, onOpenChange }: LoginRequiredPromptProps) {
  const t = useTranslations('auth.prompt');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const next = encodeURIComponent(pathname ?? '/');

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      description={t('description')}
      size="sm"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button variant="secondary" onClick={() => router.push(`/register?next=${next}`)}>
            {t('register')}
          </Button>
          <Button variant="primary" onClick={() => router.push(`/login?next=${next}`)}>
            {t('login')}
          </Button>
        </div>
      }
    />
  );
}
