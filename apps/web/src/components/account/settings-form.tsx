'use client';

/**
 * SettingsForm (F1.9) — the `/account/settings` body.
 *
 * Four sections, each in its own card:
 *  - password: change (when the account already has one) or set the first
 *    password (OTP/Google accounts); client-side rule + confirmation check,
 *    server field errors via `fieldErrors`;
 *  - google: linked state read from `useOAuthAccounts`; unlink with the
 *    `LAST_LOGIN_METHOD` (422) error mapped to a friendly «set a password
 *    first» message;
 *  - sessions: list from `useSessions` with device summary, masked IP, created
 *    (Jalali in fa) and last-used (relative) via `formatDate`/`formatRelative`;
 *    revoke one (confirm modal) or all-others;
 *  - delete: danger modal requiring the user to type `DELETE` (and the password
 *    when the account has one); on success the auth cache is cleared and the
 *    user is redirected to `/` with a toast.
 *
 * Optimistic updates are not used anywhere here — every action waits for the
 * server and surfaces success/failure through toasts and inline errors.
 */
import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { changePasswordBodySchema, deleteAccountBodySchema } from '@app/contracts';
import { useAuth } from '../../lib/auth/auth-context';
import { createFormatters } from '../../lib/format';
import { isApiRequestError } from '../../lib/api/errors';
import {
  useChangePassword,
  useDeleteAccount,
  useLogoutAll,
  useOAuthAccounts,
  useRevokeSession,
  useSessions,
  useUnlinkOAuth,
} from '../../lib/api/account';
import { Field, Input } from '../ui/form';
import { Badge, Button, Modal, Spinner, useModalState, useToast } from '../ui';

export function SettingsForm() {
  const { user, logout } = useAuth();
  const t = useTranslations('account.settings');
  const tRoot = useTranslations();
  const locale = useLocale();
  const { formatDate, formatRelative } = createFormatters(locale);
  const toast = useToast();
  const router = useRouter();

  const changePassword = useChangePassword();
  const deleteAccount = useDeleteAccount();
  const revokeSession = useRevokeSession();
  const logoutAll = useLogoutAll();
  const unlinkOAuth = useUnlinkOAuth();
  const { sessions, isPending: sessionsPending } = useSessions();
  const { accounts: oauthAccounts } = useOAuthAccounts();

  const hasPassword = user?.hasPassword ?? false;

  // password section state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [newError, setNewError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [passwordFormError, setPasswordFormError] = useState<string | null>(null);

  // unlink-google confirm modal
  const unlinkModal = useModalState();

  // revoke-one confirm modal (holds the session id being revoked)
  const revokeModal = useModalState();
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);

  // revoke-all-others confirm modal
  const revokeAllModal = useModalState();

  // delete-account modal
  const deleteModal = useModalState();
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!user) return <Spinner aria-label={tRoot('common.loading')} />;

  const googleAccount = oauthAccounts.find((a) => a.provider === 'google') ?? null;
  const sessionList = sessions ?? [];
  const otherSessions = sessionList.filter((s) => !s.current);

  // --- password -------------------------------------------------------------
  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (changePassword.isPending) return;
    setCurrentError(null);
    setNewError(null);
    setConfirmError(null);
    setPasswordFormError(null);

    if (newPassword !== confirmPassword) {
      setConfirmError(t('password.mismatch'));
      return;
    }
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setNewError(t('password.weak'));
      return;
    }
    const body: { currentPassword?: string; newPassword: string } = hasPassword
      ? { currentPassword, newPassword }
      : { newPassword };
    const parsed = changePasswordBodySchema.safeParse(body);
    if (!parsed.success) {
      setPasswordFormError(t('serverError'));
      return;
    }
    try {
      await changePassword.mutateAsync(parsed.data);
      toast.success(hasPassword ? t('password.changed') : t('password.set'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      if (!isApiRequestError(err)) {
        setPasswordFormError(tRoot('errors.internal_error'));
        return;
      }
      if (changePassword.isRateLimited(err)) {
        setPasswordFormError(tRoot('auth.rateLimited'));
        return;
      }
      const fields = changePassword.fieldErrors(err);
      if (fields.currentPassword?.[0]) {
        setCurrentError(tRoot(issueKey(fields.currentPassword[0])) ?? t('serverError'));
      }
      if (fields.newPassword?.[0]) {
        setNewError(tRoot(issueKey(fields.newPassword[0])) ?? t('password.weak'));
      }
      if (err.code !== 'VALIDATION_FAILED') {
        setPasswordFormError(tRoot(err.messageKey) ?? t('serverError'));
      }
    }
  };

  // --- unlink google --------------------------------------------------------
  const openUnlinkModal = () => {
    if (!googleAccount || unlinkOAuth.isPending) return;
    unlinkModal.openModal();
  };
  const handleUnlinkGoogle = async () => {
    if (!googleAccount) return;
    try {
      await unlinkOAuth.mutateAsync(googleAccount.id);
      unlinkModal.closeModal();
      toast.success(t('google.unlinked'));
    } catch (err) {
      unlinkModal.closeModal();
      if (isApiRequestError(err) && err.code === 'LAST_LOGIN_METHOD') {
        toast.error(t('google.lastMethodError'));
        return;
      }
      toast.error(
        isApiRequestError(err) ? (tRoot(err.messageKey) ?? t('serverError')) : t('serverError'),
      );
    }
  };

  // --- revoke one session ---------------------------------------------------
  const openRevokeModal = (id: string) => {
    if (revokeSession.isPending) return;
    setRevokeTarget(id);
    revokeModal.openModal();
  };
  const handleRevoke = async () => {
    if (!revokeTarget) return;
    const id = revokeTarget;
    try {
      await revokeSession.mutateAsync(id);
      toast.success(t('sessions.revoked'));
    } catch (err) {
      toast.error(
        isApiRequestError(err) ? (tRoot(err.messageKey) ?? t('serverError')) : t('serverError'),
      );
    } finally {
      revokeModal.closeModal();
      setRevokeTarget(null);
    }
  };

  // --- revoke all other sessions -------------------------------------------
  const handleRevokeAll = async () => {
    try {
      await logoutAll.mutateAsync();
      toast.success(t('sessions.revokedAll'));
    } catch (err) {
      toast.error(
        isApiRequestError(err) ? (tRoot(err.messageKey) ?? t('serverError')) : t('serverError'),
      );
    } finally {
      revokeAllModal.closeModal();
    }
  };

  // --- delete account -------------------------------------------------------
  const handleDeleteSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (deleteAccount.isPending) return;
    setDeleteError(null);
    if (deleteConfirm !== 'DELETE') {
      setDeleteError(t('delete.typeMismatch'));
      return;
    }
    if (hasPassword && deletePassword.length === 0) {
      setDeleteError(tRoot('validation.required'));
      return;
    }
    const body: { password?: string; confirm: 'DELETE' } = hasPassword
      ? { password: deletePassword, confirm: 'DELETE' }
      : { confirm: 'DELETE' };
    const parsed = deleteAccountBodySchema.safeParse(body);
    if (!parsed.success) {
      setDeleteError(t('serverError'));
      return;
    }
    try {
      await deleteAccount.mutateAsync(parsed.data);
      deleteModal.closeModal();
      toast.success(t('delete.deleted'));
      await logout();
      router.replace('/');
    } catch (err) {
      if (isApiRequestError(err) && err.code === 'LAST_LOGIN_METHOD') {
        setDeleteError(t('google.lastMethodError'));
        return;
      }
      if (!isApiRequestError(err)) {
        setDeleteError(tRoot('errors.internal_error'));
        return;
      }
      const fields = deleteAccount.fieldErrors(err);
      if (fields.password?.[0]) {
        setDeleteError(tRoot(issueKey(fields.password[0])) ?? t('serverError'));
      } else {
        setDeleteError(tRoot(err.messageKey) ?? t('serverError'));
      }
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-text">{t('title')}</h1>

      {/* Password section */}
      <section
        aria-labelledby="password-heading"
        className="rounded-md border border-border bg-surface p-4"
      >
        <h2 id="password-heading" className="mb-1 text-sm font-medium text-text">
          {t('password.title')}
        </h2>
        <p className="mb-3 text-xs text-text-subtle">
          {hasPassword ? t('password.hasPasswordIntro') : t('password.setIntro')}
        </p>
        <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4" noValidate>
          {hasPassword ? (
            <Field
              name="currentPassword"
              label={t('password.currentLabel')}
              error={currentError ?? undefined}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  dir="ltr"
                />
              )}
            </Field>
          ) : null}
          <Field
            name="newPassword"
            label={t('password.newLabel')}
            error={newError ?? undefined}
            required
          >
            {(props) => (
              <Input
                {...props}
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                dir="ltr"
              />
            )}
          </Field>
          <Field
            name="confirmPassword"
            label={t('password.confirmLabel')}
            error={confirmError ?? undefined}
            required
          >
            {(props) => (
              <Input
                {...props}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                dir="ltr"
              />
            )}
          </Field>
          {passwordFormError ? (
            <p role="alert" className="text-sm text-danger">
              {passwordFormError}
            </p>
          ) : null}
          <Button type="submit" loading={changePassword.isPending} className="self-start">
            {hasPassword ? t('password.submit') : t('password.submitSet')}
          </Button>
        </form>
      </section>

      {/* Google section */}
      <section
        aria-labelledby="google-heading"
        className="rounded-md border border-border bg-surface p-4"
      >
        <h2 id="google-heading" className="mb-3 text-sm font-medium text-text">
          {t('google.title')}
        </h2>
        <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            {googleAccount ? (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant="success">{t('google.linked')}</Badge>
                  <span dir="ltr" className="text-text-subtle">
                    {googleAccount.email ?? '—'}
                  </span>
                </div>
                <p className="text-xs text-text-subtle">
                  {t('google.linkedAs', { email: googleAccount.email ?? '—' })}
                </p>
              </>
            ) : (
              <>
                <Badge variant="neutral">{t('google.notLinked')}</Badge>
                <p className="text-xs text-text-subtle">{t('google.notLinkedBody')}</p>
              </>
            )}
          </div>
          {googleAccount ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-danger"
              onClick={openUnlinkModal}
              disabled={unlinkOAuth.isPending}
            >
              {t('google.unlink')}
            </Button>
          ) : null}
        </div>
      </section>

      {/* Sessions section */}
      <section
        aria-labelledby="sessions-heading"
        className="rounded-md border border-border bg-surface p-4"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="sessions-heading" className="text-sm font-medium text-text">
            {t('sessions.title')}
          </h2>
          {otherSessions.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-danger"
              onClick={revokeAllModal.openModal}
              disabled={logoutAll.isPending}
            >
              {t('sessions.revokeAll')}
            </Button>
          ) : null}
        </div>
        {sessionsPending && sessionList.length === 0 ? (
          <Spinner aria-label={tRoot('common.loading')} />
        ) : sessionList.length === 0 ? (
          <p className="text-sm text-text-subtle">{t('sessions.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {sessionList.map((session) => (
              <li
                key={session.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-text">
                      {summarizeDevice(session.userAgent, t('sessions.unknownDevice'))}
                    </span>
                    {session.current ? (
                      <Badge variant="primary">{t('sessions.current')}</Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-subtle">
                    <span dir="ltr">{session.ip ?? '—'}</span>
                    <span>
                      {t('sessions.created')}: {formatDate(session.createdAt)}
                    </span>
                    <span>
                      {t('sessions.lastUsed')}: {formatRelative(session.lastUsedAt)}
                    </span>
                  </div>
                </div>
                {!session.current ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    onClick={() => openRevokeModal(session.id)}
                    disabled={revokeSession.isPending}
                  >
                    {t('sessions.revoke')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Delete account section */}
      <section
        aria-labelledby="delete-heading"
        className="rounded-md border border-danger bg-surface p-4"
      >
        <h2 id="delete-heading" className="mb-2 text-sm font-medium text-danger">
          {t('delete.title')}
        </h2>
        <p className="mb-3 text-sm text-text">{t('delete.intro')}</p>
        <Button type="button" variant="danger" onClick={deleteModal.openModal}>
          {t('delete.submit')}
        </Button>
      </section>

      {/* Unlink-google confirm */}
      <Modal
        open={unlinkModal.isOpen}
        onOpenChange={unlinkModal.setOpen}
        title={t('google.unlinkConfirm')}
        size="sm"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={unlinkModal.closeModal}>
              {tRoot('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={unlinkOAuth.isPending}
              onClick={handleUnlinkGoogle}
            >
              {t('google.unlink')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">{t('google.unlinkBody')}</p>
      </Modal>

      {/* Revoke-one confirm */}
      <Modal
        open={revokeModal.isOpen}
        onOpenChange={revokeModal.setOpen}
        title={t('sessions.revokeConfirm')}
        size="sm"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={revokeModal.closeModal}>
              {tRoot('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={revokeSession.isPending}
              onClick={handleRevoke}
            >
              {t('sessions.revoke')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">{t('sessions.revokeConfirmBody')}</p>
      </Modal>

      {/* Revoke-all confirm */}
      <Modal
        open={revokeAllModal.isOpen}
        onOpenChange={revokeAllModal.setOpen}
        title={t('sessions.revokeConfirm')}
        size="sm"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={revokeAllModal.closeModal}>
              {tRoot('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={logoutAll.isPending}
              onClick={handleRevokeAll}
            >
              {t('sessions.revokeAll')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">{t('sessions.revokeConfirmBody')}</p>
      </Modal>

      {/* Delete-account modal */}
      <Modal
        open={deleteModal.isOpen}
        onOpenChange={deleteModal.setOpen}
        title={t('delete.confirmTitle')}
      >
        <form onSubmit={handleDeleteSubmit} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-text">{t('delete.confirmBody')}</p>
          <Field
            name="deleteConfirm"
            label={t('delete.confirmLabel')}
            error={deleteError ?? undefined}
            required
          >
            {(props) => (
              <Input
                {...props}
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                dir="ltr"
                autoComplete="off"
              />
            )}
          </Field>
          {hasPassword ? (
            <Field
              name="deletePassword"
              label={t('delete.passwordLabel')}
              error={undefined}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  autoComplete="current-password"
                  dir="ltr"
                />
              )}
            </Field>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={deleteModal.closeModal}>
              {tRoot('common.cancel')}
            </Button>
            <Button type="submit" variant="danger" loading={deleteAccount.isPending}>
              {t('delete.submit')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/** Map a raw User-Agent string to a short «Browser · OS» label (F1.9). */
function summarizeDevice(ua: string | null, fallback: string): string {
  if (!ua) return fallback;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} · ${os}` : browser;
}

function issueKey(issue: string | { key: string; params?: Record<string, unknown> }): string {
  return typeof issue === 'string' ? issue : issue.key;
}
