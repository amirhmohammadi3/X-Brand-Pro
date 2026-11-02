'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import {
  Field,
  Input,
  PhoneInput,
  OtpInput,
  PasswordInput,
  Textarea,
  Select,
  Checkbox,
  RadioGroup,
  Switch,
  FormError,
  SubmitButton,
  FileDropzone,
  CopyField,
  useZodForm,
  type FormErrorEntry,
} from '../../../../components/ui';
import { Card, CardBody, CardHeader, Heading } from '../../../../components/ui';

// Schema uses translation KEYS as messages (F1.4 convention), with params for
// the parametric rules. The Field components resolve them at display time.
const formSchema = z.object({
  name: z.string().min(1, { message: 'validation.required' }),
  email: z
    .string()
    .min(1, { message: 'validation.required' })
    .email({ message: 'validation.email' }),
  phone: z.string().min(1, { message: 'validation.required' }),
  password: z.string().min(8, { message: 'validation.password' }),
  otp: z.string().length(6, { message: 'validation.min' }),
  bio: z.string().max(200, { message: 'validation.max' }).optional(),
  role: z.string().min(1, { message: 'validation.required' }),
  agree: z.literal(true, { errorMap: () => ({ message: 'validation.required' }) }),
});

type FormValues = z.infer<typeof formSchema>;

/**
 * Form playground (F1.4) rendered inside /dev/ui. Demonstrates:
 *  - a valid, controlled form wired through `useZodForm`;
 *  - inline validation on blur + re-validation on change;
 *  - a button to inject synthetic server field-errors via `setServerErrors`
 *    (the first invalid field is focused and the error is announced);
 *  - disabled and readonly variants of each control;
 *  - PhoneInput with Persian-digit input, OtpInput paste/auto-advance,
 *    PasswordInput strength meter, Textarea auto-grow + counter.
 */
export function FormPlayground() {
  const t = useTranslations('validation');
  const tForm = useTranslations('form');
  const [files, setFiles] = useState<File[]>([]);
  const [submitted, setSubmitted] = useState<FormValues | null>(null);

  const form = useZodForm(formSchema, {
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      password: '',
      otp: '',
      bio: '',
      role: '',
      agree: false as unknown as true,
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setServerErrors,
  } = form;

  const onSubmit = handleSubmit(async (values) => {
    await new Promise((r) => setTimeout(r, 400));
    setSubmitted(values);
  });

  const injectServerError = () => {
    // Synthetic server field-errors, as if the API returned VALIDATION_FAILED
    // with a `details.fields` map. Keys are translation keys.
    setServerErrors({
      email: ['validation.email'],
      phone: ['validation.phone'],
    });
  };

  const fieldLabels: Record<string, string> = {
    name: tForm('playground.name'),
    email: tForm('playground.email'),
    phone: tForm('playground.phone'),
    password: tForm('playground.password'),
    otp: tForm('playground.otp'),
    bio: tForm('playground.bio'),
    role: tForm('playground.role'),
    agree: tForm('playground.agree'),
  };

  const errorEntries: FormErrorEntry[] = Object.entries(errors)
    .filter(([, err]) => err?.message)
    .map(([name, err]) => ({
      name,
      label: fieldLabels[name] ?? name,
      message: err.message as string,
    }));

  return (
    <Card>
      <CardHeader>
        <Heading level="h2">{tForm('playground.title')}</Heading>
      </CardHeader>
      <CardBody className="space-y-6">
        {errorEntries.length > 0 ? <FormError errors={errorEntries} /> : null}

        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <Field
            name="name"
            label={tForm('playground.name')}
            required
            error={errors.name ? t('required') : undefined}
          >
            {(p) => <Input {...p} {...register('name')} placeholder="مثال: سارا" />}
          </Field>

          <Field
            name="email"
            label={tForm('playground.email')}
            required
            error={errors.email ? t('email') : undefined}
          >
            {(p) => (
              <Input
                {...p}
                {...register('email')}
                type="email"
                dir="ltr"
                placeholder="name@example.com"
              />
            )}
          </Field>

          <Field
            name="phone"
            label={tForm('playground.phone')}
            required
            error={errors.phone ? t('phone') : undefined}
          >
            {(p) => (
              <PhoneInput
                {...p}
                value={form.watch('phone') ?? ''}
                onValueChange={(v) => form.setValue('phone', v, { shouldValidate: true })}
              />
            )}
          </Field>

          <Field
            name="password"
            label={tForm('playground.password')}
            required
            error={errors.password ? t('password', { min: 8 }) : undefined}
          >
            {(p) => <PasswordInput {...p} {...register('password')} placeholder="حداقل ۸ نویسه" />}
          </Field>

          <Field
            name="otp"
            label={tForm('playground.otp')}
            error={errors.otp ? t('min', { min: 6 }) : undefined}
          >
            {(p) => (
              <OtpInput
                {...p}
                length={6}
                value={form.watch('otp') ?? ''}
                onChange={(v) => form.setValue('otp', v, { shouldValidate: true })}
              />
            )}
          </Field>

          <Field
            name="bio"
            label={tForm('playground.bio')}
            error={errors.bio ? t('max', { max: 200 }) : undefined}
          >
            {(p) => (
              <Textarea
                {...p}
                {...register('bio')}
                maxLength={200}
                rows={3}
                placeholder="چند خط درباره خودتان"
              />
            )}
          </Field>

          <Field
            name="role"
            label={tForm('playground.role')}
            required
            error={errors.role ? t('required') : undefined}
          >
            {(p) => (
              <Select
                {...p}
                {...register('role')}
                placeholder={tForm('playground.rolePlaceholder')}
                options={[
                  { value: 'owner', label: tForm('playground.roleOwner') },
                  { value: 'staff', label: tForm('playground.roleStaff') },
                  { value: 'customer', label: tForm('playground.roleCustomer') },
                ]}
              />
            )}
          </Field>

          <Checkbox
            {...register('agree')}
            label={tForm('playground.agree')}
            description={tForm('playground.agreeDesc')}
          />
          {errors.agree ? (
            <p role="alert" className="text-xs text-danger">
              {t('required')}
            </p>
          ) : null}

          <RadioGroup
            name="contactPref"
            label={tForm('playground.contactPref')}
            defaultValue="sms"
            options={[
              { value: 'sms', label: tForm('playground.contactSms') },
              { value: 'email', label: tForm('playground.contactEmail') },
              { value: 'call', label: tForm('playground.contactCall') },
            ]}
          />

          <Switch
            checked
            onChange={() => {}}
            label={tForm('playground.newsletter')}
            description={tForm('playground.newsletterDesc')}
          />

          <Field name="files" label={tForm('playground.files')}>
            {() => (
              <FileDropzone
                multiple
                accept={['image/png', 'image/jpeg']}
                maxSize={2 * 1024 * 1024}
                value={files}
                onChange={setFiles}
              />
            )}
          </Field>

          <Field name="referral" label={tForm('playground.referral')}>
            {(p) => <CopyField {...p} value="XBRAND-2026-A1B2" dir="ltr" />}
          </Field>

          <div className="flex flex-wrap gap-3">
            <SubmitButton loading={isSubmitting}>{tForm('playground.submit')}</SubmitButton>
            <button
              type="button"
              onClick={injectServerError}
              className="rounded-md border border-border px-4 py-2 text-sm text-text hover:bg-surface-alt"
            >
              {tForm('playground.injectServerError')}
            </button>
            <button
              type="button"
              onClick={() => form.reset()}
              className="rounded-md border border-border px-4 py-2 text-sm text-text hover:bg-surface-alt"
            >
              {tForm('playground.reset')}
            </button>
          </div>
        </form>

        {submitted ? (
          <pre className="rounded-md bg-surface-alt p-3 text-xs overflow-auto" dir="ltr">
            {JSON.stringify(submitted, null, 2)}
          </pre>
        ) : null}

        {/* Disabled + readonly variants */}
        <div className="space-y-4 border-t border-border-subtle pt-4">
          <Heading level="h3">{tForm('playground.statesTitle')}</Heading>
          <Field name="disabled-name" label={tForm('playground.name')}>
            {(p) => <Input {...p} value="غیرفعال" disabled />}
          </Field>
          <Field name="readonly-name" label={tForm('playground.name')}>
            {(p) => <Input {...p} value="فقط‌خواندنی" readOnly />}
          </Field>
        </div>
      </CardBody>
    </Card>
  );
}
