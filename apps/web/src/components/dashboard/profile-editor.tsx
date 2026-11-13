'use client';

/**
 * ProfileEditor (F7.2) — the profile + contacts section of
 * `/dashboard/:businessId/profile`.
 *
 * A react-hook-form + Zod form over the editable scalar + contact fields
 * (name, alt name, description, phone, whatsapp, telegram, instagram,
 * website, email, address, price level, tags). On submit it builds a partial
 * `UpdateBusinessBody` (empty strings → null, tags split on comma) and PATCHes
 * `/businesses/:id`. The API re-validates with the shared
 * `updateBusinessBodySchema` (Iranian phones, handles, URLs) and per-field
 * errors come back through `setServerErrors`. Category/amenity editing is a
 * follow-up (the registration wizard owns the create-time join tables).
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import type { BusinessDetail, UpdateBusinessBody } from '@app/contracts';
import { isApiRequestError } from '../../lib/api/errors';
import { translateIssue } from '../../lib/forms/translate-issue';
import { useUpdateBusiness } from '../../lib/api/businesses';
import { useToast } from '../ui/toast';
import { Card, CardBody, CardHeader, Heading } from '../ui';
import { Field, Input, Select, SubmitButton, Textarea, useZodForm } from '../ui/form';

const profileFormSchema = z.object({
  name: z.string().min(1, 'validation.required').max(200, 'validation.max'),
  nameAlt: z.string().max(200, 'validation.max'),
  description: z.string().max(5000, 'validation.max'),
  address: z.string().min(1, 'validation.required').max(500, 'validation.max'),
  phone: z.string(),
  whatsapp: z.string(),
  telegram: z.string(),
  instagram: z.string(),
  website: z.string(),
  email: z.string(),
  priceLevel: z.string(), // '' | '1'..'4'
  tags: z.string(), // comma-separated
});

type ProfileValues = z.infer<typeof profileFormSchema>;

function emptyToNull(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

/** Build the PATCH body from the form values: empty → null, tags split. */
export function buildUpdateBody(form: ProfileValues): UpdateBusinessBody {
  const tags = form.tags
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length >= 1 && t.length <= 60);
  return {
    name: form.name.trim(),
    nameAlt: emptyToNull(form.nameAlt),
    description: emptyToNull(form.description),
    address: form.address.trim(),
    phone: emptyToNull(form.phone),
    whatsapp: emptyToNull(form.whatsapp),
    telegram: emptyToNull(form.telegram),
    instagram: emptyToNull(form.instagram),
    website: emptyToNull(form.website),
    email: emptyToNull(form.email),
    priceLevel: form.priceLevel === '' ? null : (Number(form.priceLevel) as 1 | 2 | 3 | 4),
    tags,
  };
}

const PRICE_OPTIONS = [
  { value: '', labelKey: 'profile.priceNone' },
  { value: '1', labelKey: 'profile.price1' },
  { value: '2', labelKey: 'profile.price2' },
  { value: '3', labelKey: 'profile.price3' },
  { value: '4', labelKey: 'profile.price4' },
];

export function ProfileEditor({ business }: { business: BusinessDetail }) {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const toast = useToast();
  const updateMutation = useUpdateBusiness(business.id);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setServerErrors,
  } = useZodForm(profileFormSchema, {
    defaultValues: {
      name: business.name,
      nameAlt: business.nameAlt ?? '',
      description: business.description ?? '',
      address: business.address,
      phone: business.phone ?? '',
      whatsapp: business.whatsapp ?? '',
      telegram: business.telegram ?? '',
      instagram: business.instagram ?? '',
      website: business.website ?? '',
      email: business.email ?? '',
      priceLevel: business.priceLevel === null ? '' : String(business.priceLevel),
      tags: business.tags.join(', '),
    },
  });

  const fieldMessage = (message: unknown): string | undefined =>
    typeof message === 'string' ? translateIssue(tRoot, { message }) : undefined;

  const onSubmit = handleSubmit(async (form) => {
    setFormError(null);
    try {
      await updateMutation.mutateAsync(buildUpdateBody(form));
      toast.success(t('profile.saved'));
    } catch (err) {
      if (!isApiRequestError(err)) {
        setFormError(tRoot('errors.internal_error'));
        return;
      }
      const fields = updateMutation.fieldErrors(err);
      if (Object.keys(fields).length > 0) {
        setServerErrors(fields);
        return;
      }
      setFormError(translateIssue(tRoot, { message: err.messageKey }));
    }
  });

  return (
    <Card>
      <CardHeader>
        <Heading level="h2" className="text-base">
          {t('profile.title')}
        </Heading>
      </CardHeader>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field
            name="name"
            label={t('profile.name')}
            required
            error={fieldMessage(errors.name?.message)}
          >
            {(props) => <Input {...props} {...register('name')} type="text" />}
          </Field>
          <Field
            name="nameAlt"
            label={t('profile.nameAlt')}
            error={fieldMessage(errors.nameAlt?.message)}
          >
            {(props) => (
              <Input
                {...props}
                {...register('nameAlt')}
                type="text"
                dir="ltr"
                className="text-start"
              />
            )}
          </Field>
          <Field
            name="description"
            label={t('profile.description')}
            error={fieldMessage(errors.description?.message)}
          >
            {(props) => <Textarea {...props} {...register('description')} rows={4} />}
          </Field>
          <Field
            name="address"
            label={t('profile.address')}
            required
            error={fieldMessage(errors.address?.message)}
          >
            {(props) => <Input {...props} {...register('address')} type="text" />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="phone"
              label={t('profile.phone')}
              error={fieldMessage(errors.phone?.message)}
            >
              {(props) => (
                <Input
                  {...props}
                  {...register('phone')}
                  type="tel"
                  dir="ltr"
                  className="text-start"
                />
              )}
            </Field>
            <Field
              name="whatsapp"
              label={t('profile.whatsapp')}
              error={fieldMessage(errors.whatsapp?.message)}
            >
              {(props) => (
                <Input
                  {...props}
                  {...register('whatsapp')}
                  type="tel"
                  dir="ltr"
                  className="text-start"
                />
              )}
            </Field>
            <Field
              name="telegram"
              label={t('profile.telegram')}
              error={fieldMessage(errors.telegram?.message)}
            >
              {(props) => (
                <Input
                  {...props}
                  {...register('telegram')}
                  type="text"
                  dir="ltr"
                  className="text-start"
                />
              )}
            </Field>
            <Field
              name="instagram"
              label={t('profile.instagram')}
              error={fieldMessage(errors.instagram?.message)}
            >
              {(props) => (
                <Input
                  {...props}
                  {...register('instagram')}
                  type="text"
                  dir="ltr"
                  className="text-start"
                />
              )}
            </Field>
            <Field
              name="website"
              label={t('profile.website')}
              error={fieldMessage(errors.website?.message)}
            >
              {(props) => (
                <Input
                  {...props}
                  {...register('website')}
                  type="url"
                  dir="ltr"
                  className="text-start"
                />
              )}
            </Field>
            <Field
              name="email"
              label={t('profile.email')}
              error={fieldMessage(errors.email?.message)}
            >
              {(props) => (
                <Input
                  {...props}
                  {...register('email')}
                  type="email"
                  dir="ltr"
                  className="text-start"
                />
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="priceLevel"
              label={t('profile.priceLevel')}
              error={fieldMessage(errors.priceLevel?.message)}
            >
              {(props) => (
                <Select
                  {...props}
                  options={PRICE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                  {...register('priceLevel')}
                />
              )}
            </Field>
            <Field
              name="tags"
              label={t('profile.tags')}
              hint={t('profile.tagsHint')}
              error={fieldMessage(errors.tags?.message)}
            >
              {(props) => (
                <Input
                  {...props}
                  {...register('tags')}
                  type="text"
                  dir="ltr"
                  className="text-start"
                />
              )}
            </Field>
          </div>
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <div className="flex justify-end">
            <SubmitButton loading={isSubmitting || updateMutation.isPending}>
              {t('profile.save')}
            </SubmitButton>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
