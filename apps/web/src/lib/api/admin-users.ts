import { useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { z } from 'zod';
import {
  adminUserListResponseSchema,
  adminUserSchema,
  banBodySchema,
  changeRoleBodySchema,
  type AdminUser,
  type AdminUserListResponse,
  type BanBody,
  type ChangeRoleBody,
} from '@app/contracts';
import { apiFetch } from './client';
import { qk } from './qk';
import { useApiMutation } from './use-api-mutation';

/**
 * Admin users hooks (F2.5) — the B1.14 `users.read`/`users.manage` API.
 * The list is server-paginated and server-filtered (trigram search over
 * username/display name, role/status filters); every management mutation
 * invalidates the current list view. Hierarchy rules (self-target, rank,
 * last super_admin, users.assign_admin) are enforced SERVER-side and the
 * UI only mirrors the common cases.
 */

export interface AdminUsersFilter {
  q?: string;
  role?: string;
  status?: string;
  page: number;
  pageSize: number;
}

/** `GET /admin/users` — one page of the registry with sessions counts. */
export function useAdminUsers(filter: AdminUsersFilter) {
  return useQuery<AdminUserListResponse>({
    queryKey: qk.admin.users.list(filter),
    queryFn: async () => {
      const result = await apiFetch('/admin/users', adminUserListResponseSchema, {
        query: {
          page: filter.page,
          pageSize: filter.pageSize,
          ...(filter.q && filter.q.trim() ? { q: filter.q.trim() } : {}),
          ...(filter.role ? { role: filter.role } : {}),
          ...(filter.status ? { status: filter.status } : {}),
        },
      });
      return result.data;
    },
    staleTime: 10_000,
  });
}

/** `PATCH /admin/users/:id/role` — role change (revokes sessions). */
export function useChangeUserRole(): UseMutationResult<
  AdminUser,
  Error,
  { id: string; body: ChangeRoleBody }
> {
  const queryClient = useQueryClient();
  return useApiMutation<AdminUser, { id: string; body: ChangeRoleBody }>(
    async ({ id, body }) => {
      const parsed = changeRoleBodySchema.parse(body);
      const result = await apiFetch(`/admin/users/${id}/role`, adminUserSchema, {
        method: 'PATCH',
        body: parsed,
      });
      return result.data;
    },
    {
      onSuccess: (user) =>
        invalidateAll(queryClient, [qk.admin.users.all(), qk.admin.users.detail(user.id)]),
    },
  );
}

/** `POST /admin/users/:id/ban` — block with a mandatory reason. */
export function useBanUser(): UseMutationResult<AdminUser, Error, { id: string; body: BanBody }> {
  const queryClient = useQueryClient();
  return useApiMutation<AdminUser, { id: string; body: BanBody }>(
    async ({ id, body }) => {
      const parsed = banBodySchema.parse(body);
      const result = await apiFetch(`/admin/users/${id}/ban`, adminUserSchema, {
        method: 'POST',
        body: parsed,
      });
      return result.data;
    },
    {
      onSuccess: (user) =>
        invalidateAll(queryClient, [qk.admin.users.all(), qk.admin.users.detail(user.id)]),
    },
  );
}

/** `POST /admin/users/:id/unban`. */
export function useUnbanUser(): UseMutationResult<AdminUser, Error, string> {
  const queryClient = useQueryClient();
  return useApiMutation<AdminUser, string>(
    async (id) => {
      const result = await apiFetch(`/admin/users/${id}/unban`, adminUserSchema, {
        method: 'POST',
      });
      return result.data;
    },
    {
      onSuccess: (user) =>
        invalidateAll(queryClient, [qk.admin.users.all(), qk.admin.users.detail(user.id)]),
    },
  );
}

/** `POST /admin/users/:id/revoke-sessions` — force-logout everywhere. */
export function useRevokeSessions(): UseMutationResult<{ ok: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useApiMutation<{ ok: boolean }, string>(
    async (id) => {
      const result = await apiFetch(
        `/admin/users/${id}/revoke-sessions`,
        z.object({ ok: z.boolean() }),
        {
          method: 'POST',
        },
      );
      return result.data;
    },
    {
      onSuccess: (_result, id) =>
        invalidateAll(queryClient, [qk.admin.users.all(), qk.admin.users.detail(id)]),
    },
  );
}

function invalidateAll(
  queryClient: ReturnType<typeof useQueryClient>,
  keys: ReadonlyArray<readonly unknown[]>,
): void {
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: key });
}
