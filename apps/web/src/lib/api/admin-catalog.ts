import { useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { z } from 'zod';
import {
  adminCitySchema,
  adminCategorySchema,
  amenitySchema,
  neighborhoodSchema,
  setCategoryAmenitiesBodySchema,
  type AdminCity,
  type AdminCategory,
  type Amenity,
  type Neighborhood,
  type CreateCityBody,
  type UpdateCityBody,
  type CreateNeighborhoodBody,
  type UpdateNeighborhoodBody,
  type CreateCategoryBody,
  type UpdateCategoryBody,
  type CreateAmenityBody,
  type UpdateAmenityBody,
  type SetCategoryAmenitiesBody,
  type SetActiveCityBody,
} from '@app/contracts';
import { apiFetch } from './client';
import { qk } from './qk';
import { useApiMutation } from './use-api-mutation';

/**
 * Admin catalog hooks (F2.2) — cities, neighborhoods, categories and
 * amenities against the `catalog.manage` admin API (B2.1–B2.3). Lists are
 * small (a handful of cities/roots; ≤ a few hundred amenities) so they load
 * whole (no pagination) and every mutation invalidates the domain key.
 * Every list is schema-validated by `apiFetch` so a contract drift fails
 * loudly instead of rendering garbage.
 */

const okSchema = z.object({ ok: z.boolean() });
const items = <T extends z.ZodTypeAny>(schema: T) => z.object({ items: z.array(schema) });

function invalidateCatalog(
  queryClient: ReturnType<typeof useQueryClient>,
  keys: ReadonlyArray<readonly unknown[]>,
): void {
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: key });
}

// ─── cities ───────────────────────────────────────────────────────────────

/** `GET /admin/cities` — every city with its neighborhood/business counts. */
export function useAdminCities() {
  return useQuery<AdminCity[]>({
    queryKey: qk.admin.catalog.cities(),
    queryFn: async () => {
      const result = await apiFetch('/admin/cities', items(adminCitySchema));
      return result.data.items;
    },
    staleTime: 30_000,
  });
}

export function useCreateCity(): UseMutationResult<AdminCity, Error, CreateCityBody> {
  const queryClient = useQueryClient();
  return useApiMutation<AdminCity, CreateCityBody>(
    async (body) => {
      const result = await apiFetch('/admin/cities', adminCitySchema, { method: 'POST', body });
      return result.data;
    },
    {
      onSuccess: () => invalidateCatalog(queryClient, [qk.admin.catalog.cities()]),
    },
  );
}

export function useUpdateCity(): UseMutationResult<
  AdminCity,
  Error,
  { id: string; body: UpdateCityBody }
> {
  const queryClient = useQueryClient();
  return useApiMutation<AdminCity, { id: string; body: UpdateCityBody }>(
    async ({ id, body }) => {
      const result = await apiFetch(`/admin/cities/${id}`, adminCitySchema, {
        method: 'PATCH',
        body,
      });
      return result.data;
    },
    {
      onSuccess: () =>
        invalidateCatalog(queryClient, [qk.admin.catalog.cities(), qk.admin.catalog.categories()]),
    },
  );
}

export function useDeleteCity(): UseMutationResult<{ ok: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useApiMutation<{ ok: boolean }, string>(
    async (id) => {
      const result = await apiFetch(`/admin/cities/${id}`, okSchema, { method: 'DELETE' });
      return result.data;
    },
    {
      onSuccess: () => invalidateCatalog(queryClient, [qk.admin.catalog.cities()]),
    },
  );
}

export function useSetCityActive(): UseMutationResult<
  AdminCity,
  Error,
  SetActiveCityBody & { id: string }
> {
  const queryClient = useQueryClient();
  return useApiMutation<AdminCity, SetActiveCityBody & { id: string }>(
    async ({ id, ...body }) => {
      const result = await apiFetch(`/admin/cities/${id}/active`, adminCitySchema, {
        method: 'PUT',
        body,
      });
      return result.data;
    },
    {
      onSuccess: () => invalidateCatalog(queryClient, [qk.admin.catalog.cities()]),
    },
  );
}

// ─── neighborhoods ────────────────────────────────────────────────────────

/** `GET /admin/cities/:cityId/neighborhoods`. */
export function useAdminNeighborhoods(cityId: string) {
  return useQuery<Neighborhood[]>({
    queryKey: qk.admin.catalog.neighborhoods(cityId),
    queryFn: async () => {
      const result = await apiFetch(
        `/admin/cities/${cityId}/neighborhoods`,
        items(neighborhoodSchema),
      );
      return result.data.items;
    },
    enabled: cityId.length > 0,
    staleTime: 30_000,
  });
}

export function useCreateNeighborhood(
  cityId: string,
): UseMutationResult<Neighborhood, Error, CreateNeighborhoodBody> {
  const queryClient = useQueryClient();
  return useApiMutation<Neighborhood, CreateNeighborhoodBody>(
    async (body) => {
      const result = await apiFetch(`/admin/cities/${cityId}/neighborhoods`, neighborhoodSchema, {
        method: 'POST',
        body,
      });
      return result.data;
    },
    {
      onSuccess: () =>
        invalidateCatalog(queryClient, [
          qk.admin.catalog.neighborhoods(cityId),
          qk.admin.catalog.cities(),
        ]),
    },
  );
}

export function useUpdateNeighborhood(
  cityId: string,
): UseMutationResult<Neighborhood, Error, { id: string; body: UpdateNeighborhoodBody }> {
  const queryClient = useQueryClient();
  return useApiMutation<Neighborhood, { id: string; body: UpdateNeighborhoodBody }>(
    async ({ id, body }) => {
      const result = await apiFetch(
        `/admin/cities/${cityId}/neighborhoods/${id}`,
        neighborhoodSchema,
        {
          method: 'PATCH',
          body,
        },
      );
      return result.data;
    },
    {
      onSuccess: () =>
        invalidateCatalog(queryClient, [
          qk.admin.catalog.neighborhoods(cityId),
          qk.admin.catalog.cities(),
        ]),
    },
  );
}

export function useDeleteNeighborhood(
  cityId: string,
): UseMutationResult<{ ok: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useApiMutation<{ ok: boolean }, string>(
    async (id) => {
      const result = await apiFetch(`/admin/cities/${cityId}/neighborhoods/${id}`, okSchema, {
        method: 'DELETE',
      });
      return result.data;
    },
    {
      onSuccess: () =>
        invalidateCatalog(queryClient, [
          qk.admin.catalog.neighborhoods(cityId),
          qk.admin.catalog.cities(),
        ]),
    },
  );
}

// ─── categories ───────────────────────────────────────────────────────────

/** `GET /admin/categories` — flat list with child/business counts. */
export function useAdminCategories() {
  return useQuery<AdminCategory[]>({
    queryKey: qk.admin.catalog.categories(),
    queryFn: async () => {
      const result = await apiFetch('/admin/categories', items(adminCategorySchema));
      return result.data.items;
    },
    staleTime: 30_000,
  });
}

export function useCreateCategory(): UseMutationResult<AdminCategory, Error, CreateCategoryBody> {
  const queryClient = useQueryClient();
  return useApiMutation<AdminCategory, CreateCategoryBody>(
    async (body) => {
      const result = await apiFetch('/admin/categories', adminCategorySchema, {
        method: 'POST',
        body,
      });
      return result.data;
    },
    {
      onSuccess: () => invalidateCatalog(queryClient, [qk.admin.catalog.categories()]),
    },
  );
}

export function useUpdateCategory(): UseMutationResult<
  AdminCategory,
  Error,
  { id: string; body: UpdateCategoryBody }
> {
  const queryClient = useQueryClient();
  return useApiMutation<AdminCategory, { id: string; body: UpdateCategoryBody }>(
    async ({ id, body }) => {
      const result = await apiFetch(`/admin/categories/${id}`, adminCategorySchema, {
        method: 'PATCH',
        body,
      });
      return result.data;
    },
    {
      onSuccess: () => invalidateCatalog(queryClient, [qk.admin.catalog.categories()]),
    },
  );
}

export function useDeleteCategory(): UseMutationResult<{ ok: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useApiMutation<{ ok: boolean }, string>(
    async (id) => {
      const result = await apiFetch(`/admin/categories/${id}`, okSchema, { method: 'DELETE' });
      return result.data;
    },
    {
      onSuccess: () => invalidateCatalog(queryClient, [qk.admin.catalog.categories()]),
    },
  );
}

// ─── amenities ────────────────────────────────────────────────────────────

/** `GET /admin/amenities`. */
export function useAdminAmenities() {
  return useQuery<Amenity[]>({
    queryKey: qk.admin.catalog.amenities(),
    queryFn: async () => {
      const result = await apiFetch('/admin/amenities', items(amenitySchema));
      return result.data.items;
    },
    staleTime: 30_000,
  });
}

export function useCreateAmenity(): UseMutationResult<Amenity, Error, CreateAmenityBody> {
  const queryClient = useQueryClient();
  return useApiMutation<Amenity, CreateAmenityBody>(
    async (body) => {
      const result = await apiFetch('/admin/amenities', amenitySchema, { method: 'POST', body });
      return result.data;
    },
    {
      onSuccess: () =>
        invalidateCatalog(queryClient, [
          qk.admin.catalog.amenities(),
          qk.admin.catalog.categories(),
        ]),
    },
  );
}

export function useUpdateAmenity(): UseMutationResult<
  Amenity,
  Error,
  { id: string; body: UpdateAmenityBody }
> {
  const queryClient = useQueryClient();
  return useApiMutation<Amenity, { id: string; body: UpdateAmenityBody }>(
    async ({ id, body }) => {
      const result = await apiFetch(`/admin/amenities/${id}`, amenitySchema, {
        method: 'PATCH',
        body,
      });
      return result.data;
    },
    {
      onSuccess: () =>
        invalidateCatalog(queryClient, [
          qk.admin.catalog.amenities(),
          qk.admin.catalog.categories(),
        ]),
    },
  );
}

export function useDeleteAmenity(): UseMutationResult<{ ok: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useApiMutation<{ ok: boolean }, string>(
    async (id) => {
      const result = await apiFetch(`/admin/amenities/${id}`, okSchema, { method: 'DELETE' });
      return result.data;
    },
    {
      onSuccess: () =>
        invalidateCatalog(queryClient, [
          qk.admin.catalog.amenities(),
          qk.admin.catalog.categories(),
        ]),
    },
  );
}

// ─── category ↔ amenity mapping (B2.3) ────────────────────────────────────

/** `GET /admin/categories/:id/amenities` — the ids mapped to one category. */
export function useCategoryAmenityIds(categoryId: string) {
  return useQuery<{ items: string[] }>({
    queryKey: qk.admin.catalog.categoryAmenities(categoryId),
    queryFn: async () => {
      const result = await apiFetch(
        `/admin/categories/${categoryId}/amenities`,
        z.object({ items: z.array(z.string()) }),
      );
      return result.data;
    },
    enabled: categoryId.length > 0,
    staleTime: 30_000,
  });
}

export function useSetCategoryAmenities(
  categoryId: string,
): UseMutationResult<{ ok: boolean }, Error, SetCategoryAmenitiesBody> {
  const queryClient = useQueryClient();
  return useApiMutation<{ ok: boolean }, SetCategoryAmenitiesBody>(
    async (body) => {
      const parsed = setCategoryAmenitiesBodySchema.parse(body);
      const result = await apiFetch(`/admin/categories/${categoryId}/amenities`, okSchema, {
        method: 'PUT',
        body: parsed,
      });
      return result.data;
    },
    {
      onSuccess: () =>
        invalidateCatalog(queryClient, [
          qk.admin.catalog.categoryAmenities(categoryId),
          qk.admin.catalog.categories(),
        ]),
    },
  );
}
