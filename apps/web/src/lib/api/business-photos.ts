'use client';

/**
 * Business gallery API hooks (F7.3). The owner dashboard's gallery editor
 * reads the gallery (`GET /businesses/:id/photos`) and attaches / reorders /
 * covers / deletes photos. Uploads go through B1.9's `uploadMedia`
 * (`kind: business_photo`); the returned media id is then attached here.
 *
 * Cache strategy: `useBusinessPhotos(id)` is keyed per business; every write
 * (attach/reorder/cover/delete) invalidates the photos key AND the business
 * detail (the cover/thumb on the summary + the page aggregate depend on the
 * gallery).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  attachBusinessPhotoBodySchema,
  businessPhotosResultSchema,
  reorderBusinessPhotosBodySchema,
  setBusinessCoverBodySchema,
  type BusinessPhoto,
  type BusinessPhotosResult,
} from '@app/contracts';
import { apiFetch } from './client';
import { useApiMutation } from './use-api-mutation';
import { qk } from './qk';

/** `GET /businesses/:id/photos` — the gallery, ordered by `sortOrder`. */
export function useBusinessPhotos(businessId: string | null | undefined): {
  photos: BusinessPhoto[];
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<BusinessPhotosResult>({
    queryKey: qk.businesses.photos(businessId ?? ''),
    queryFn: async () => {
      const result = await apiFetch(
        `/businesses/${businessId as string}/photos`,
        businessPhotosResultSchema,
      );
      return result.data;
    },
    enabled: Boolean(businessId),
    staleTime: 30_000,
  });
  return { photos: query.data?.items ?? [], isPending: query.isPending, error: query.error };
}

/** `POST /businesses/:id/photos` — attach an uploaded media id to the gallery. */
export function useAttachPhoto(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (mediaId: string) => {
      const body = { mediaId };
      void attachBusinessPhotoBodySchema.parse(body);
      const result = await apiFetch(
        `/businesses/${businessId}/photos`,
        businessPhotosResultSchema,
        {
          method: 'POST',
          body,
        },
      );
      return result.data;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: qk.businesses.photos(businessId) });
        void queryClient.invalidateQueries({ queryKey: qk.businesses.detail(businessId) });
      },
    },
  );
}

/** `DELETE /businesses/:id/photos/:photoId` — remove a gallery entry. */
export function useDeletePhoto(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (photoId: string) => {
      const result = await apiFetch(
        `/businesses/${businessId}/photos/${photoId}`,
        businessPhotosResultSchema,
        {
          method: 'DELETE',
        },
      );
      return result.data;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: qk.businesses.photos(businessId) });
        void queryClient.invalidateQueries({ queryKey: qk.businesses.detail(businessId) });
      },
    },
  );
}

/** `PUT /businesses/:id/photos/order` — full-array permutation of the gallery. */
export function useReorderPhotos(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (photoIds: string[]) => {
      const body = { photoIds };
      void reorderBusinessPhotosBodySchema.parse(body);
      const result = await apiFetch(
        `/businesses/${businessId}/photos/order`,
        businessPhotosResultSchema,
        { method: 'PUT', body },
      );
      return result.data;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: qk.businesses.photos(businessId) });
      },
    },
  );
}

/** `PUT /businesses/:id/photos/cover` — set the cover to one of the gallery's media ids. */
export function useSetCover(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (mediaId: string) => {
      const body = { mediaId };
      void setBusinessCoverBodySchema.parse(body);
      const result = await apiFetch(
        `/businesses/${businessId}/photos/cover`,
        businessPhotosResultSchema,
        { method: 'PUT', body },
      );
      return result.data;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: qk.businesses.photos(businessId) });
        void queryClient.invalidateQueries({ queryKey: qk.businesses.detail(businessId) });
      },
    },
  );
}

/** Re-exported for the editor's upload step (kind business_photo). */
export type { BusinessPhoto };
