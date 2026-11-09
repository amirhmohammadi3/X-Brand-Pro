'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Ban, KeyRound, Search, ShieldCheck, UserCog } from 'lucide-react';
import { z } from 'zod';
import { USER_ROLES, USER_STATUSES, type AdminUser, type UserRole } from '@app/contracts';
import {
  useAdminUsers,
  useBanUser,
  useChangeUserRole,
  useRevokeSessions,
  useUnbanUser,
} from '@/lib/api/admin-users';
import { AdminTable } from '@/components/admin/admin-table';
import { StringSelect, translateIssue } from '@/components/admin/admin-forms';
import { useAuth } from '@/lib/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';
import { Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { toDisplayDigits } from '@/lib/forms/digits';
import { isApiRequestError } from '@/lib/api/errors';

const PAGE_SIZE = 20;

const roleOptions = USER_ROLES.map((r) => ({ value: r, label: r }));
const statusOptions = USER_STATUSES.map((s) => ({ value: s, label: s }));

const searchSchema = z.string().trim().max(200, 'admin.users.tooLong');
const banReasonSchema = z
  .string()
  .trim()
  .min(3, 'admin.users.reasonMin')
  .max(500, 'admin.users.reasonMax');

type ListFilter = { q?: string; role?: string; status?: string; page: number };

/**
 * `/admin/users` (F2.5) — the user registry over the B1.14 API: server
 * search (trigram) + role/status filters + server pagination; role change,
 * ban (reason mandatory) / unban and revoke-sessions actions. Self-actions
 * are disabled (the server re-checks every hierarchy rule). Moderators see
 * the page read-only: the write actions need `users.manage` and the API
 * answers 403 — the buttons are hidden for them via the permission mirror.
 */
export function UsersAdmin() {
  const t = useTranslations('admin.users');
  const tForm = useTranslations('admin.form');
  const toast = useToast();
  const { user: me } = useAuth();

  const [searchInput, setSearchInput] = useState('');
  const [filter, setFilter] = useState<ListFilter>({ page: 1 });
  const [roleFor, setRoleFor] = useState<AdminUser | null>(null);
  const [banFor, setBanFor] = useState<AdminUser | null>(null);
  const [unbanFor, setUnbanFor] = useState<AdminUser | null>(null);
  const [revokeFor, setRevokeFor] = useState<AdminUser | null>(null);

  const users = useAdminUsers({ ...filter, pageSize: PAGE_SIZE });
  const changeRole = useChangeUserRole();
  const ban = useBanUser();
  const unban = useUnbanUser();
  const revoke = useRevokeSessions();

  // Moderator holds users.read only; admin+ hold users.manage (UI mirror).
  const canManage = me?.role === 'admin' || me?.role === 'super_admin';

  const rows = useMemo(() => users.data?.items ?? [], [users.data]);
  const meta = users.data?.meta;

  const applySearch = () => {
    const parsed = searchSchema.safeParse(searchInput);
    if (!parsed.success) {
      toast.error(t('tooLong'));
      return;
    }
    setFilter((prev) => ({ ...prev, q: parsed.data || undefined, page: 1 }));
  };

  const shortDate = (iso: string | null) => (iso ? toDisplayDigits(iso.slice(0, 10), 'fa') : '—');

  return (
    <>
      <AdminTable<AdminUser>
        columns={[
          {
            id: 'user',
            header: t('colUser'),
            cell: (row) => (
              <div>
                <span className="font-medium">{row.displayName ?? row.username}</span>
                <span className="block text-xs text-text-subtle" dir="ltr">
                  @{row.username}
                </span>
              </div>
            ),
          },
          {
            id: 'contact',
            header: t('colContact'),
            cell: (row) => (
              <span className="block max-w-44 truncate text-xs text-text-subtle" dir="ltr">
                {row.email ?? row.phone ?? '—'}
              </span>
            ),
          },
          {
            id: 'role',
            header: t('colRole'),
            cell: (row) => <Badge variant="neutral">{t(`role.${row.role}`)}</Badge>,
          },
          {
            id: 'status',
            header: t('colStatus'),
            cell: (row) => (
              <div>
                <Badge variant={row.status === 'active' ? 'neutral' : 'danger'}>
                  {t(`status.${row.status}`)}
                </Badge>
                {row.bannedReason ? (
                  <span
                    className="mt-1 block max-w-40 truncate text-xs text-text-subtle"
                    title={row.bannedReason}
                  >
                    {row.bannedReason}
                  </span>
                ) : null}
              </div>
            ),
          },
          {
            id: 'meta',
            header: t('colMeta'),
            cell: (row) => (
              <span className="text-xs text-text-subtle">
                {t('sessionsCount', { count: toDisplayDigits(String(row.sessionsCount), 'fa') })}
                {' · '}
                {shortDate(row.lastLoginAt)}
              </span>
            ),
          },
          ...(canManage
            ? [
                {
                  id: 'actions' as const,
                  header: t('actionsLabel'),
                  cell: (row: AdminUser) => {
                    const isSelf = row.id === me?.id;
                    return (
                      <div className="flex items-center gap-1">
                        <IconButton
                          icon={UserCog}
                          aria-label={t('changeRoleLabel')}
                          disabled={isSelf}
                          onClick={() => setRoleFor(row)}
                        />
                        {row.status === 'blocked' ? (
                          <IconButton
                            icon={ShieldCheck}
                            aria-label={t('unbanLabel')}
                            onClick={() => setUnbanFor(row)}
                          />
                        ) : (
                          <IconButton
                            icon={Ban}
                            aria-label={t('banLabel')}
                            disabled={isSelf || row.role === 'super_admin'}
                            onClick={() => setBanFor(row)}
                          />
                        )}
                        <IconButton
                          icon={KeyRound}
                          aria-label={t('revokeLabel')}
                          disabled={isSelf}
                          onClick={() => setRevokeFor(row)}
                        />
                      </div>
                    );
                  },
                },
              ]
            : []),
        ]}
        rows={rows}
        total={meta?.total ?? 0}
        loading={users.isPending}
        error={users.error}
        onRetry={() => void users.refetch()}
        page={meta?.page ?? filter.page}
        pageSize={PAGE_SIZE}
        onPageChange={(page) => setFilter((prev) => ({ ...prev, page }))}
        rowKey={(row) => row.id}
        emptyTitle={t('empty')}
        toolbar={
          <>
            <div className="relative w-full max-w-xs">
              <Search
                size={16}
                aria-hidden
                className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-muted"
              />
              <Input
                aria-label={t('searchPlaceholder')}
                placeholder={t('searchPlaceholder')}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applySearch();
                  }
                }}
                className="ps-9"
              />
            </div>
            <StringSelect
              id="roleFilter"
              label={t('colRole')}
              value={filter.role ?? ''}
              onChange={(v) => setFilter((prev) => ({ ...prev, role: v || undefined, page: 1 }))}
              options={[{ value: '', label: t('filterAll') }, ...roleOptions]}
            />
            <StringSelect
              id="statusFilter"
              label={t('colStatus')}
              value={filter.status ?? ''}
              onChange={(v) => setFilter((prev) => ({ ...prev, status: v || undefined, page: 1 }))}
              options={[{ value: '', label: t('filterAll') }, ...statusOptions]}
            />
          </>
        }
      />

      {roleFor ? (
        <RoleModal
          user={roleFor}
          onClose={() => setRoleFor(null)}
          onSave={async (role) => {
            try {
              await changeRole.mutateAsync({ id: roleFor.id, body: { role } });
              toast.success(t('roleChanged', { name: roleFor.username, role: t(`role.${role}`) }));
              setRoleFor(null);
            } catch (err) {
              toast.error(isApiRequestError(err) ? err.message : tForm('saveFailed'));
            }
          }}
        />
      ) : null}

      {banFor ? (
        <BanModal
          user={banFor}
          onClose={() => setBanFor(null)}
          onSave={async (reason) => {
            try {
              await ban.mutateAsync({ id: banFor.id, body: { reason } });
              toast.success(t('banned', { name: banFor.username }));
              setBanFor(null);
            } catch (err) {
              toast.error(isApiRequestError(err) ? err.message : tForm('saveFailed'));
            }
          }}
        />
      ) : null}

      <ConfirmDialog
        open={unbanFor !== null}
        onOpenChange={(open) => !open && setUnbanFor(null)}
        title={unbanFor ? t('unbanTitle', { name: unbanFor.username }) : ''}
        description={unbanFor ? t('unbanBody', { name: unbanFor.username }) : undefined}
        confirmLabel={t('unbanLabel')}
        cancelLabel={tForm('cancel')}
        onConfirm={async () => {
          if (!unbanFor) return;
          try {
            await unban.mutateAsync(unbanFor.id);
            toast.success(t('unbanned', { name: unbanFor.username }));
          } catch (err) {
            toast.error(isApiRequestError(err) ? err.message : tForm('saveFailed'));
          } finally {
            setUnbanFor(null);
          }
        }}
      />

      <ConfirmDialog
        open={revokeFor !== null}
        onOpenChange={(open) => !open && setRevokeFor(null)}
        title={revokeFor ? t('revokeTitle', { name: revokeFor.username }) : ''}
        description={revokeFor ? t('revokeBody', { name: revokeFor.username }) : undefined}
        confirmLabel={t('revokeLabel')}
        cancelLabel={tForm('cancel')}
        destructive
        onConfirm={async () => {
          if (!revokeFor) return;
          try {
            await revoke.mutateAsync(revokeFor.id);
            toast.success(t('revoked', { name: revokeFor.username }));
          } catch (err) {
            toast.error(isApiRequestError(err) ? err.message : tForm('saveFailed'));
          } finally {
            setRevokeFor(null);
          }
        }}
      />
    </>
  );
}

/** The role-change modal (admin/super_admin grant rules live server-side). */
function RoleModal({
  user,
  onClose,
  onSave,
}: {
  user: AdminUser;
  onClose: () => void;
  onSave: (role: UserRole) => Promise<void>;
}) {
  const t = useTranslations('admin.users');
  const tForm = useTranslations('admin.form');
  const tRoot = useTranslations();
  const [role, setRole] = useState<UserRole>(user.role);
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('roleTitle', { name: user.username })}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = z
            .custom<UserRole>((v) => USER_ROLES.includes(v as UserRole))
            .safeParse(role);
          if (!parsed.success) {
            setError('validation.required');
            return;
          }
          void onSave(parsed.data);
        }}
      >
        <StringSelect
          id="role"
          label={t('colRole')}
          value={role}
          onChange={(v) => setRole(v as UserRole)}
          options={roleOptions}
          error={translateIssue(tRoot, error)}
        />
        <p className="text-xs text-text-subtle">{t('roleHint')}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {tForm('cancel')}
          </Button>
          <Button type="submit">{tForm('save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** The ban modal: reason mandatory (≥3 chars), indefinite by default. */
function BanModal({
  user,
  onClose,
  onSave,
}: {
  user: AdminUser;
  onClose: () => void;
  onSave: (reason: string) => Promise<void>;
}) {
  const t = useTranslations('admin.users');
  const tForm = useTranslations('admin.form');
  const tRoot = useTranslations();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('banTitle', { name: user.username })}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = banReasonSchema.safeParse(reason);
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message);
            return;
          }
          void onSave(parsed.data);
        }}
      >
        <Field name="reason" label={t('reasonLabel')} required error={translateIssue(tRoot, error)}>
          {(props) => (
            <Input
              {...props}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
            />
          )}
        </Field>
        <p className="text-xs text-text-subtle">{t('banHint')}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {tForm('cancel')}
          </Button>
          <Button type="submit" variant="danger">
            {t('banLabel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
