'use client';

/**
 * ServicesEditor (F7.5) — the `/dashboard/:businessId/bookings` "services" tab.
 *
 * The owner's bookable offerings: name, description, slot rules (duration,
 * step, capacity, party bounds) and the policy numbers (min lead, cancel
 * window, booking horizon). Every row is independently edited (PATCH-emulation
 * via `POST /bookings/services/:id`); new services are created via `POST
 * /bookings/services/:businessId`. Deleting a service cascades its bookings
 * (the FK keeps history), so a `ConfirmDialog` guards it.
 *
 * The bounds mirror `BOOKING_*` constants (single source of truth in
 * contracts) — the inputs' min/max keep the form from sending the API a value
 * it would reject anyway.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  BOOKING_ADVANCE_MAX,
  BOOKING_CAPACITY_MAX,
  BOOKING_DURATION_MAX,
  BOOKING_DURATION_MIN,
  BOOKING_PARTY_MAX,
  BOOKING_POLICY_MINUTES_MAX,
  BOOKING_SLOT_STEP_MAX,
  BOOKING_SLOT_STEP_MIN,
  type BookingService,
  type CreateBookingServiceBody,
  type UpdateBookingServiceBody,
} from '@app/contracts';
import {
  useCreateBookingService,
  useDeleteBookingService,
  useOwnerBookingServices,
  useUpdateBookingService,
} from '../../lib/api/dashboard-bookings';
import { isApiRequestError } from '../../lib/api/errors';
import { translateIssue } from '../../lib/forms/translate-issue';
import { useToast } from '../ui/toast';
import { ConfirmDialog } from '../ui/confirm-dialog';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Heading,
  IconButton,
  Input,
  Spinner,
  SubmitButton,
} from '../ui';

interface ServiceFormState {
  name: string;
  description: string;
  durationMinutes: number;
  slotStepMinutes: number;
  capacity: number;
  minPartySize: number;
  maxPartySize: number;
  minLeadMinutes: number;
  cancelWindowMinutes: number;
  maxAdvanceDays: number;
  isActive: boolean;
  sortOrder: number;
}

function emptyForm(): ServiceFormState {
  return {
    name: '',
    description: '',
    durationMinutes: 60,
    slotStepMinutes: 30,
    capacity: 1,
    minPartySize: 1,
    maxPartySize: 10,
    minLeadMinutes: 60,
    cancelWindowMinutes: 120,
    maxAdvanceDays: 30,
    isActive: true,
    sortOrder: 0,
  };
}

function fromService(svc: BookingService): ServiceFormState {
  return {
    name: svc.name,
    description: svc.description ?? '',
    durationMinutes: svc.durationMinutes,
    slotStepMinutes: svc.slotStepMinutes,
    capacity: svc.capacity,
    minPartySize: svc.minPartySize,
    maxPartySize: svc.maxPartySize,
    minLeadMinutes: svc.minLeadMinutes,
    cancelWindowMinutes: svc.cancelWindowMinutes,
    maxAdvanceDays: svc.maxAdvanceDays,
    isActive: svc.isActive,
    sortOrder: svc.sortOrder,
  };
}

export function ServicesEditor({ businessId }: { businessId: string }) {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const toast = useToast();
  const { services, isPending, error } = useOwnerBookingServices(businessId);
  const createMutation = useCreateBookingService(businessId);
  const updateMutation = useUpdateBookingService(businessId);
  const deleteMutation = useDeleteBookingService(businessId);

  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<ServiceFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function startCreate() {
    setForm(emptyForm());
    setFormError(null);
    setEditing('new');
  }
  function startEdit(svc: BookingService) {
    setForm(fromService(svc));
    setFormError(null);
    setEditing(svc.id);
  }
  function cancel() {
    setEditing(null);
    setFormError(null);
  }
  function set<K extends keyof ServiceFormState>(key: K, value: ServiceFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const body: CreateBookingServiceBody = {
      name: form.name.trim(),
      description: form.description.trim() === '' ? undefined : form.description.trim(),
      durationMinutes: form.durationMinutes,
      slotStepMinutes: form.slotStepMinutes,
      capacity: form.capacity,
      minPartySize: form.minPartySize,
      maxPartySize: form.maxPartySize,
      minLeadMinutes: form.minLeadMinutes,
      cancelWindowMinutes: form.cancelWindowMinutes,
      maxAdvanceDays: form.maxAdvanceDays,
      isActive: form.isActive,
      sortOrder: form.sortOrder,
    };
    try {
      if (editing === 'new') {
        await createMutation.mutateAsync(body);
        toast.success(t('bookings.services.created'));
      } else if (editing) {
        const patch: UpdateBookingServiceBody = body;
        await updateMutation.mutateAsync({ serviceId: editing, body: patch });
        toast.success(t('bookings.services.updated'));
      }
      setEditing(null);
    } catch (err) {
      if (!isApiRequestError(err)) {
        setFormError(tRoot('errors.internal_error'));
        return;
      }
      setFormError(translateIssue(tRoot, { message: err.messageKey }));
    }
  }

  async function doDelete() {
    if (!confirmDeleteId) return;
    try {
      await deleteMutation.mutateAsync(confirmDeleteId);
      toast.success(t('bookings.services.deleted'));
    } catch (err) {
      toast.error(
        isApiRequestError(err)
          ? translateIssue(tRoot, { message: err.messageKey })
          : tRoot('errors.internal_error'),
      );
    } finally {
      setConfirmDeleteId(null);
    }
  }

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner aria-label={t('bookings.services.loading')} />
      </div>
    );
  }
  if (error) {
    return <ErrorState error={error} />;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="dashboard-bookings-services">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Heading level="h2" className="text-lg">
            {t('bookings.services.title')}
          </Heading>
          <p className="text-sm text-text-subtle">{t('bookings.services.subtitle')}</p>
        </div>
        <Button onClick={startCreate} variant="primary" disabled={editing === 'new'}>
          <Plus className="size-4" aria-hidden />
          {t('bookings.services.add')}
        </Button>
      </div>

      {services.length === 0 && editing !== 'new' ? (
        <EmptyState
          icon={Plus}
          title={t('bookings.services.emptyTitle')}
          description={t('bookings.services.emptyMessage')}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {services.map((svc) => (
            <li key={svc.id}>
              <Card>
                <CardBody className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text">{svc.name}</span>
                      {svc.isActive ? (
                        <Badge variant="success">{t('bookings.services.isActive')}</Badge>
                      ) : null}
                    </div>
                    <span className="text-xs text-text-subtle">
                      {t('bookings.services.duration')}: {svc.durationMinutes} ·{' '}
                      {t('bookings.services.capacity')}: {svc.capacity} ·{' '}
                      {t('bookings.services.maxParty')}: {svc.maxPartySize}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton
                      icon={Pencil}
                      aria-label={t('bookings.services.edit')}
                      onClick={() => startEdit(svc)}
                      variant="ghost"
                      size="sm"
                    />
                    <IconButton
                      icon={Trash2}
                      aria-label={t('bookings.services.delete')}
                      onClick={() => setConfirmDeleteId(svc.id)}
                      variant="ghost"
                      size="sm"
                    />
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <ServiceForm
          form={form}
          set={set}
          isNew={editing === 'new'}
          onSubmit={onSubmit}
          onCancel={cancel}
          pending={createMutation.isPending || updateMutation.isPending}
          formError={formError}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
        title={t('bookings.services.delete')}
        description={t('bookings.services.confirmDelete')}
        confirmLabel={t('bookings.services.delete')}
        cancelLabel={t('bookings.services.cancel')}
        destructive
        onConfirm={doDelete}
      />
    </div>
  );
}

interface ServiceFormProps {
  form: ServiceFormState;
  set: <K extends keyof ServiceFormState>(key: K, value: ServiceFormState[K]) => void;
  isNew: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  pending: boolean;
  formError: string | null;
}

function ServiceForm({
  form,
  set,
  isNew,
  onSubmit,
  onCancel,
  pending,
  formError,
}: ServiceFormProps) {
  const t = useTranslations('dashboard');
  return (
    <Card>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <Field name="svc-name" label={t('bookings.services.name')}>
            {(props) => (
              <Input
                {...props}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
                maxLength={120}
              />
            )}
          </Field>
          <Field name="svc-description" label={t('bookings.services.description')}>
            {(props) => (
              <Input
                {...props}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                maxLength={500}
              />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field name="svc-duration" label={t('bookings.services.duration')}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  dir="ltr"
                  value={String(form.durationMinutes)}
                  onChange={(e) => set('durationMinutes', Number(e.target.value))}
                  min={BOOKING_DURATION_MIN}
                  max={BOOKING_DURATION_MAX}
                  required
                />
              )}
            </Field>
            <Field name="svc-slot-step" label={t('bookings.services.slotStep')}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  dir="ltr"
                  value={String(form.slotStepMinutes)}
                  onChange={(e) => set('slotStepMinutes', Number(e.target.value))}
                  min={BOOKING_SLOT_STEP_MIN}
                  max={BOOKING_SLOT_STEP_MAX}
                  required
                />
              )}
            </Field>
            <Field name="svc-capacity" label={t('bookings.services.capacity')}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  dir="ltr"
                  value={String(form.capacity)}
                  onChange={(e) => set('capacity', Number(e.target.value))}
                  min={1}
                  max={BOOKING_CAPACITY_MAX}
                  required
                />
              )}
            </Field>
            <Field name="svc-min-party" label={t('bookings.services.minParty')}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  dir="ltr"
                  value={String(form.minPartySize)}
                  onChange={(e) => set('minPartySize', Number(e.target.value))}
                  min={1}
                  max={BOOKING_PARTY_MAX}
                  required
                />
              )}
            </Field>
            <Field name="svc-max-party" label={t('bookings.services.maxParty')}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  dir="ltr"
                  value={String(form.maxPartySize)}
                  onChange={(e) => set('maxPartySize', Number(e.target.value))}
                  min={1}
                  max={BOOKING_PARTY_MAX}
                  required
                />
              )}
            </Field>
            <Field name="svc-min-lead" label={t('bookings.services.minLead')}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  dir="ltr"
                  value={String(form.minLeadMinutes)}
                  onChange={(e) => set('minLeadMinutes', Number(e.target.value))}
                  min={0}
                  max={BOOKING_POLICY_MINUTES_MAX}
                  required
                />
              )}
            </Field>
            <Field name="svc-cancel-window" label={t('bookings.services.cancelWindow')}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  dir="ltr"
                  value={String(form.cancelWindowMinutes)}
                  onChange={(e) => set('cancelWindowMinutes', Number(e.target.value))}
                  min={0}
                  max={BOOKING_POLICY_MINUTES_MAX}
                  required
                />
              )}
            </Field>
            <Field name="svc-max-advance" label={t('bookings.services.maxAdvance')}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  dir="ltr"
                  value={String(form.maxAdvanceDays)}
                  onChange={(e) => set('maxAdvanceDays', Number(e.target.value))}
                  min={1}
                  max={BOOKING_ADVANCE_MAX}
                  required
                />
              )}
            </Field>
            <Field name="svc-sort-order" label={t('bookings.services.sortOrder')}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  dir="ltr"
                  value={String(form.sortOrder)}
                  onChange={(e) => set('sortOrder', Number(e.target.value))}
                />
              )}
            </Field>
          </div>
          <Checkbox
            id="svc-active"
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
            label={t('bookings.services.isActive')}
          />
          {formError ? (
            <FormError
              errors={[
                { name: 'svc-form', label: t('bookings.services.title'), message: formError },
              ]}
            />
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t('bookings.services.cancel')}
            </Button>
            <SubmitButton loading={pending}>
              {isNew ? t('bookings.services.add') : t('bookings.services.save')}
            </SubmitButton>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
