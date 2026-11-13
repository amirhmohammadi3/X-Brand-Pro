'use client';

/**
 * GalleryEditor (F7.3) — the `/dashboard/:businessId/gallery` body.
 *
 * The owner's photo gallery: upload (B1.9 `POST /media/upload` with kind
 * `business_photo` → attach via `POST /businesses/:id/photos`), reorder with
 * up/down arrows (`PUT /businesses/:id/photos/order` — a full-array
 * permutation), set the cover (`PUT /businesses/:id/photos/cover`) and delete
 * (`DELETE /businesses/:id/photos/:photoId`). The B2.7 cap
 * (`BUSINESS_MAX_PHOTOS = 10`) is enforced by the API (422) and mirrored here
 * (the upload button disables at the cap). Every write invalidates the
 * gallery + detail so the cover/thumb on the overview tracks.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowLeft, ImagePlus, Star, Trash2 } from 'lucide-react';
import { BUSINESS_MAX_PHOTOS, type BusinessPhoto } from '@app/contracts';
import { uploadMedia } from '../../lib/api/account';
import {
  useAttachPhoto,
  useBusinessPhotos,
  useDeletePhoto,
  useReorderPhotos,
  useSetCover,
} from '../../lib/api/business-photos';
import { isApiRequestError } from '../../lib/api/errors';
import { translateIssue } from '../../lib/forms/translate-issue';
import { useToast } from '../ui/toast';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Heading,
  IconButton,
  Spinner,
} from '../ui';
import { FileDropzone } from '../ui/form';

export function GalleryEditor({ businessId }: { businessId: string }) {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const toast = useToast();
  const { photos, isPending, error } = useBusinessPhotos(businessId);
  const attachMutation = useAttachPhoto(businessId);
  const deleteMutation = useDeletePhoto(businessId);
  const reorderMutation = useReorderPhotos(businessId);
  const coverMutation = useSetCover(businessId);
  const [file, setFile] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const atCap = photos.length >= BUSINESS_MAX_PHOTOS;

  const onUpload = async () => {
    if (file.length === 0 || atCap) return;
    setUploadError(null);
    setUploading(true);
    try {
      const media = await uploadMedia(file[0] as File, 'business_photo');
      await attachMutation.mutateAsync(media.id);
      setFile([]);
      toast.success(t('gallery.attached'));
    } catch (err) {
      setUploadError(
        isApiRequestError(err)
          ? translateIssue(tRoot, { message: err.messageKey })
          : tRoot('errors.internal_error'),
      );
    } finally {
      setUploading(false);
    }
  };

  const onMove = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= photos.length) return;
    const ids = photos.map((p) => p.id);
    [ids[idx], ids[target]] = [ids[target] as string, ids[idx] as string];
    try {
      await reorderMutation.mutateAsync(ids);
    } catch (err) {
      toast.error(
        isApiRequestError(err)
          ? translateIssue(tRoot, { message: err.messageKey })
          : tRoot('errors.internal_error'),
      );
    }
  };

  const onSetCover = async (photo: BusinessPhoto) => {
    try {
      await coverMutation.mutateAsync(photo.mediaId);
      toast.success(t('gallery.coverSet'));
    } catch (err) {
      toast.error(
        isApiRequestError(err)
          ? translateIssue(tRoot, { message: err.messageKey })
          : tRoot('errors.internal_error'),
      );
    }
  };

  const onDelete = async (photo: BusinessPhoto) => {
    try {
      await deleteMutation.mutateAsync(photo.id);
      toast.success(t('gallery.deleted'));
    } catch (err) {
      toast.error(
        isApiRequestError(err)
          ? translateIssue(tRoot, { message: err.messageKey })
          : tRoot('errors.internal_error'),
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <Heading level="h2" className="text-base">
          {t('gallery.title')}
        </Heading>
      </CardHeader>
      <CardBody>
        <p className="mb-3 text-sm text-text-subtle">
          {t('gallery.capHint', { count: BUSINESS_MAX_PHOTOS })}
        </p>

        {/* Upload — disabled at the B2.7 cap. */}
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <FileDropzone
              accept={['image/png', 'image/jpeg', 'image/webp']}
              maxSize={10 * 1024 * 1024}
              value={file}
              onChange={setFile}
              disabled={atCap}
            />
          </div>
          <Button
            onClick={onUpload}
            disabled={file.length === 0 || atCap || uploading}
            loading={uploading}
            variant="primary"
          >
            <ImagePlus className="size-4" aria-hidden />
            {t('gallery.upload')}
          </Button>
        </div>
        {atCap && <p className="mb-3 text-sm text-warning">{t('gallery.atCap')}</p>}
        {uploadError && <p className="mb-3 text-sm text-danger">{uploadError}</p>}

        {/* Gallery list. */}
        {isPending ? (
          <div className="flex items-center gap-2 text-text-subtle">
            <Spinner size="sm" /> <span className="text-sm">{t('loading')}</span>
          </div>
        ) : error ? (
          <ErrorState error={error} />
        ) : photos.length === 0 ? (
          <EmptyState
            icon={ImagePlus}
            title={t('gallery.empty')}
            description={t('gallery.emptyHint')}
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="gallery-grid">
            {photos.map((photo, idx) => (
              <li
                key={photo.id}
                className="overflow-hidden rounded-md border border-border-subtle bg-surface"
              >
                <div className="flex aspect-[4/3] items-center justify-center bg-surface-alt">
                  <img
                    src={photo.url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 p-2">
                  <div className="flex items-center gap-1">
                    <IconButton
                      icon={ArrowLeft}
                      aria-label={t('gallery.moveUp')}
                      onClick={() => onMove(idx, -1)}
                      variant="ghost"
                      size="sm"
                      disabled={idx === 0 || reorderMutation.isPending}
                    />
                    <IconButton
                      icon={ArrowDown}
                      aria-label={t('gallery.moveDown')}
                      onClick={() => onMove(idx, 1)}
                      variant="ghost"
                      size="sm"
                      disabled={idx === photos.length - 1 || reorderMutation.isPending}
                    />
                    <button
                      type="button"
                      onClick={() => onSetCover(photo)}
                      disabled={coverMutation.isPending}
                      className="inline-flex items-center gap-1 text-xs text-text-subtle hover:text-primary disabled:opacity-50"
                    >
                      <Star className="size-4" aria-hidden />
                      {t('gallery.setCover')}
                    </button>
                  </div>
                  <IconButton
                    icon={Trash2}
                    aria-label={t('gallery.delete')}
                    onClick={() => onDelete(photo)}
                    variant="ghost"
                    size="sm"
                    disabled={deleteMutation.isPending}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        {photos.length > 0 && (
          <p className="mt-3 text-xs text-muted">{t('gallery.count', { count: photos.length })}</p>
        )}
      </CardBody>
    </Card>
  );
}
