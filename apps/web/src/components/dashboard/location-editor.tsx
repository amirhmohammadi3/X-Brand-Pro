'use client';

/**
 * LocationEditor (F7.2) — the map section of
 * `/dashboard/:businessId/profile`.
 *
 * The F3.2 `LocationPicker` (self-hosted PMTiles, no external tiles) centered
 * on the business's current location. Picking a new point PATCHes
 * `/businesses/:id` with `{ location: { lat, lng } }`. The API re-validates
 * the point against the city bbox (422 `location` field error surfaced
 * inline) — the picker itself runs without a bbox here so a business whose
 * city bbox isn't loaded still lets the owner drag the marker.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BusinessDetail, GeoPoint, UpdateBusinessBody } from '@app/contracts';
import { LocationPicker } from '../map/location-picker';
import { useUpdateBusiness } from '../../lib/api/businesses';
import { isApiRequestError } from '../../lib/api/errors';
import { translateIssue } from '../../lib/forms/translate-issue';
import { useToast } from '../ui/toast';
import { Button, Card, CardBody, CardHeader, Heading } from '../ui';

export function LocationEditor({ business }: { business: BusinessDetail }) {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const toast = useToast();
  const updateMutation = useUpdateBusiness(business.id);
  const [pending, setPending] = useState<GeoPoint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialCenter: [number, number] = [business.location.lng, business.location.lat];

  const onSave = async () => {
    if (!pending) return;
    setError(null);
    const body: UpdateBusinessBody = { location: pending };
    try {
      await updateMutation.mutateAsync(body);
      setPending(null);
      toast.success(t('location.saved'));
    } catch (err) {
      if (!isApiRequestError(err)) {
        setError(tRoot('errors.internal_error'));
        return;
      }
      const fields = updateMutation.fieldErrors(err);
      const first = fields.location?.[0];
      if (first) {
        setError(translateIssue(tRoot, first));
        return;
      }
      setError(translateIssue(tRoot, { message: err.messageKey }));
    }
  };

  return (
    <Card>
      <CardHeader>
        <Heading level="h2" className="text-base">
          {t('location.title')}
        </Heading>
      </CardHeader>
      <CardBody>
        <p className="mb-3 text-sm text-text-subtle">{t('location.description')}</p>
        <LocationPicker initialCenter={initialCenter} onSelect={(point) => setPending(point)} />
        {pending && (
          <p className="mt-3 text-sm text-text-subtle">
            {t('location.pending', { lat: pending.lat.toFixed(5), lng: pending.lng.toFixed(5) })}
          </p>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end">
          <Button
            onClick={onSave}
            disabled={!pending}
            loading={updateMutation.isPending}
            variant="primary"
          >
            {t('location.save')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
