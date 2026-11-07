'use client';

/**
 * ProfileForm (F1.9) — the `/account/profile` body.
 *
 * Sections:
 *  - avatar block: pick/drop an image (client-side type+size guard matching
 *    the server avatar limits), upload with progress, set as avatar, remove
 *    with a confirm modal;
 *  - identity: display name + bio (with counter);
 *  - username: read-only with a «change» action opening a modal that explains
 *    the 30-day cooldown and renders the server's retry date in Jalali (fa);
 *  - contact: email/phone with verified/unverified badges and a verify link.
 *
 * Optimistic updates are NOT used for profile text (waits for the server); the
 * avatar remove is the one optimistic spot (the header updates via the seeded
 * `qk.auth.me()` cache on success).
 */
import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { updateProfileBodySchema } from '@app/contracts';
import { useAuth } from '../../lib/auth/auth-context';
import { createFormatters } from '../../lib/format';
import { isApiRequestError } from '../../lib/api/errors';
import {
  AVATAR_ACCEPTED_MIMES,
  AVATAR_MAX_BYTES,
  useChangeUsername,
  useRemoveAvatar,
  useSetAvatar,
  useUpdateProfile,
  useUploadMedia,
} from '../../lib/api/account';
import { Field, Input, Textarea, FileDropzone } from '../ui/form';
import { Avatar, Badge, Button, Modal, Spinner, useModalState, useToast } from '../ui';

export function ProfileForm() {
  const { user } = useAuth();
  const t = useTranslations('account.profile');
  const tRoot = useTranslations();
  const locale = useLocale();
  const { formatDate } = createFormatters(locale);
  const toast = useToast();

  const updateProfile = useUpdateProfile();
  const upload = useUploadMedia();
  const setAvatar = useSetAvatar();
  const removeAvatar = useRemoveAvatar();
  const changeUsername = useChangeUsername();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [bioError, setBioError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // username change modal
  const usernameModal = useModalState();
  const [newUsername, setNewUsername] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);

  if (!user) return <Spinner aria-label={tRoot('common.loading')} />;

  const handleProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (updateProfile.isPending) return;
    setNameError(null);
    setBioError(null);
    setFormError(null);

    const parsed = updateProfileBodySchema.safeParse({
      displayName,
      bio: bio.length === 0 ? null : bio,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === 'displayName') setNameError(tRoot('validation.required'));
        if (issue.path[0] === 'bio') setBioError(tRoot(issue.message));
      }
      return;
    }
    try {
      await updateProfile.mutateAsync(parsed.data);
      toast.success(t('saved'));
    } catch (err) {
      if (!isApiRequestError(err)) {
        setFormError(tRoot('errors.internal_error'));
        return;
      }
      const fields = updateProfile.fieldErrors(err);
      if (fields.displayName?.[0]) setNameError(tRoot(issueKey(fields.displayName[0])));
      if (fields.bio?.[0]) setBioError(tRoot(issueKey(fields.bio[0])));
      if (err.code !== 'VALIDATION_FAILED') setFormError(tRoot(err.messageKey) ?? t('serverError'));
    }
  };

  const handleAvatarChange = async (files: File[]): Promise<void> => {
    setAvatarError(null);
    const file = files[0];
    if (!file) return;
    if (!AVATAR_ACCEPTED_MIMES.includes(file.type)) {
      setAvatarError(t('avatarTypeError'));
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError(t('avatarTooLarge'));
      return;
    }
    try {
      const media = await upload.mutate(file, 'avatar');
      await setAvatar.mutateAsync({ mediaId: media.id });
      toast.success(t('avatarUpdated'));
    } catch (err) {
      setAvatarError(
        isApiRequestError(err) ? (tRoot(err.messageKey) ?? t('avatarError')) : t('avatarError'),
      );
    }
  };

  const usernameModalState = useModalState();
  const handleRemoveAvatar = async (): Promise<void> => {
    usernameModalState.closeModal();
    try {
      await removeAvatar.mutateAsync();
      toast.success(t('avatarRemoved'));
    } catch (err) {
      toast.error(
        isApiRequestError(err) ? (tRoot(err.messageKey) ?? t('avatarError')) : t('avatarError'),
      );
    }
  };

  const handleUsernameSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (changeUsername.isPending) return;
    setUsernameError(null);
    try {
      await changeUsername.mutateAsync({ username: newUsername });
      toast.success(t('usernameChanged'));
      setNewUsername('');
      usernameModal.closeModal();
    } catch (err) {
      if (!isApiRequestError(err)) {
        setUsernameError(tRoot('errors.internal_error'));
        return;
      }
      const retryAt = (err.details as { retryAt?: string } | undefined)?.retryAt;
      if (retryAt) {
        setUsernameError(t('usernameCooldown', { date: formatDate(retryAt) }));
        return;
      }
      if (changeUsername.isRateLimited(err)) {
        setUsernameError(tRoot('auth.rateLimited'));
        return;
      }
      const fields = changeUsername.fieldErrors(err);
      if (fields.username?.[0]) {
        setUsernameError(tRoot(issueKey(fields.username[0])));
        return;
      }
      setUsernameError(tRoot(err.messageKey) ?? t('serverError'));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-text">{t('title')}</h1>

      {/* Avatar block */}
      <section
        aria-labelledby="avatar-heading"
        className="rounded-md border border-border bg-surface p-4"
      >
        <h2 id="avatar-heading" className="mb-3 text-sm font-medium text-text">
          {t('avatarTitle')}
        </h2>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar
            src={user.avatarUrl ?? undefined}
            name={user.displayName ?? user.username}
            size="lg"
          />
          <div className="flex-1">
            <FileDropzone
              accept={[...AVATAR_ACCEPTED_MIMES]}
              maxSize={AVATAR_MAX_BYTES}
              onChange={handleAvatarChange}
              name="avatar"
              disabled={upload.isPending || setAvatar.isPending}
            />
            {upload.progress ? (
              <p className="mt-2 text-xs text-text-subtle" aria-live="polite">
                {t('avatarUploading', { percent: String(upload.progress.percent) })}
              </p>
            ) : null}
            {avatarError ? (
              <p role="alert" className="mt-2 text-xs text-danger">
                {avatarError}
              </p>
            ) : null}
            {user.avatarUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-3 text-danger"
                onClick={usernameModalState.openModal}
              >
                {t('avatarRemove')}
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {/* Identity form */}
      <form onSubmit={handleProfileSubmit} className="flex flex-col gap-4" noValidate>
        <Field name="displayName" label={t('nameLabel')} error={nameError ?? undefined} required>
          {(props) => (
            <Input
              {...props}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              autoComplete="name"
            />
          )}
        </Field>
        <Field name="bio" label={t('bioLabel')} error={bioError ?? undefined}>
          {(props) => (
            <Textarea
              {...props}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={300}
              showCounter
              rows={3}
            />
          )}
        </Field>
        {formError ? (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        ) : null}
        <Button type="submit" loading={updateProfile.isPending} className="self-start">
          {t('save')}
        </Button>
      </form>

      {/* Username */}
      <section
        aria-labelledby="username-heading"
        className="rounded-md border border-border bg-surface p-4"
      >
        <h2 id="username-heading" className="mb-2 text-sm font-medium text-text">
          {t('usernameLabel')}
        </h2>
        <div className="flex items-center justify-between gap-3">
          <code dir="ltr" className="rounded bg-surface-alt px-2 py-1 text-sm text-text">
            {user.username}
          </code>
          <Button type="button" variant="secondary" size="sm" onClick={usernameModal.openModal}>
            {t('usernameChange')}
          </Button>
        </div>

        <Modal
          open={usernameModal.isOpen}
          onOpenChange={usernameModal.setOpen}
          title={t('usernameModalTitle')}
          description={t('usernameModalBody')}
        >
          <form onSubmit={handleUsernameSubmit} className="flex flex-col gap-3" noValidate>
            <Field
              name="newUsername"
              label={t('usernameLabel')}
              error={usernameError ?? undefined}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  dir="ltr"
                  autoComplete="username"
                />
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={usernameModal.closeModal}>
                {tRoot('common.cancel')}
              </Button>
              <Button type="submit" loading={changeUsername.isPending}>
                {t('usernameSubmit')}
              </Button>
            </div>
          </form>
        </Modal>
      </section>

      {/* Contact + verification */}
      <section
        aria-labelledby="contact-heading"
        className="rounded-md border border-border bg-surface p-4"
      >
        <h2 id="contact-heading" className="mb-3 text-sm font-medium text-text">
          {t('contactTitle')}
        </h2>
        <ul className="flex flex-col gap-3 text-sm">
          <li className="flex items-center justify-between gap-3">
            <span dir="ltr" className="text-text">
              {user.email ?? t('noEmail')}
            </span>
            <VerifyBadge verified={user.emailVerified} kind="email" t={t} />
          </li>
          <li className="flex items-center justify-between gap-3">
            <span dir="ltr" className="text-text">
              {user.phone ?? t('noPhone')}
            </span>
            <VerifyBadge verified={user.phoneVerified} kind="phone" t={t} />
          </li>
        </ul>
        {!user.emailVerified || !user.phoneVerified ? (
          <Link
            href="/verify"
            className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline"
          >
            {t('verifyAction')}
          </Link>
        ) : null}
      </section>

      {/* Remove-avatar confirm */}
      <Modal
        open={usernameModalState.isOpen}
        onOpenChange={usernameModalState.setOpen}
        title={t('avatarRemoveConfirm')}
        size="sm"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={usernameModalState.closeModal}>
              {tRoot('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={removeAvatar.isPending}
              onClick={handleRemoveAvatar}
            >
              {t('avatarRemove')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">{t('avatarRemoveBody')}</p>
      </Modal>
    </div>
  );
}

function issueKey(issue: string | { key: string; params?: Record<string, unknown> }): string {
  return typeof issue === 'string' ? issue : issue.key;
}

function VerifyBadge({
  verified,
  kind,
  t,
}: {
  verified: boolean;
  kind: 'email' | 'phone';
  t: ReturnType<typeof useTranslations>;
}) {
  if (verified) {
    return (
      <Badge variant="success" leadingIcon={CheckCircle2}>
        {t('verified')}
      </Badge>
    );
  }
  return (
    <Badge variant="warning" leadingIcon={AlertCircle}>
      {kind === 'email' ? t('emailUnverified') : t('phoneUnverified')}
    </Badge>
  );
}
