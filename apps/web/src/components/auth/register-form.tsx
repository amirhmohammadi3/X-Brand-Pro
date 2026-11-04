'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { z } from 'zod';
import { emailSchema, iranMobileSchema, type CurrentUser, type RegisterBody } from '@app/contracts';
import { AuthProvider } from '../../lib/auth/auth-context';
import { qk } from '../../lib/api/qk';
import { isApiRequestError } from '../../lib/api/errors';
import { useRegister } from '../../lib/api/auth';
import { useZodForm } from '../ui/form/use-zod-form';
import { translateIssue } from '../../lib/forms/translate-issue';
import { AuthCard } from './auth-card';
import { SegmentedControl } from './segmented-control';
import { VerificationBanner } from './verification-banner';
import { Button, Checkbox, Field, Input, PasswordInput, PhoneInput, Text } from '../ui';

/**
 * Client-side mirror of the register contract with translation-KEY messages
 * (F1.4 convention). The API re-validates with the shared `registerBodySchema`
 * and its per-field errors come back through `setServerErrors`.
 */
const USERNAME_FORMAT = 'auth.register.usernameFormat';
const PASSWORD_FORMAT = 'auth.register.passwordFormat';

const registerSchema = z
  .object({
    username: z
      .string()
      .min(3, USERNAME_FORMAT)
      .max(30, USERNAME_FORMAT)
      .regex(/^[a-z][a-z0-9_]*$/, USERNAME_FORMAT),
    password: z
      .string()
      .min(8, PASSWORD_FORMAT)
      .max(128, PASSWORD_FORMAT)
      .regex(/[A-Za-z]/, PASSWORD_FORMAT)
      .regex(/\d/, PASSWORD_FORMAT),
    fullName: z.string(),
    contact: z.enum(['none', 'email', 'phone']),
    email: z.string(),
    phone: z.string(),
    acceptTerms: z.boolean().refine((v) => v, { message: 'auth.register.acceptRequired' }),
  })
  .superRefine((v, ctx) => {
    if (v.contact === 'email' && !emailSchema.safeParse(v.email).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'validation.email' });
    }
    if (v.contact === 'phone' && !iranMobileSchema.safeParse(v.phone).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phone'], message: 'validation.phone' });
    }
  });

type RegisterValues = z.infer<typeof registerSchema>;
type ContactChoice = RegisterValues['contact'];

/** True when the username satisfies the display format (live hint). */
export function isUsernameFormatValid(value: string): boolean {
  return value.length >= 3 && /^[a-z][a-z0-9_]*$/.test(value);
}

/**
 * `RegisterForm` (F1.8) — the `/register` page body.
 *
 *  - username with a LIVE format hint (validity feedback while typing — the
 *    availability itself is only checked on submit; the API's 409 lands on
 *    the field, no keystroke probing);
 *  - password with the shared strength meter;
 *  - optional contact (none / email / phone) with the "verify later from the
 *    account" note;
 *  - mandatory accept-terms checkbox linking the F10.6 legal pages;
 *  - on success the visitor is logged in (cookies set by the API, auth cache
 *    seeded) and the page shows the verification nudge banner.
 */
export function RegisterForm() {
  const t = useTranslations('auth.register');
  const tRoot = useTranslations();
  const queryClient = useQueryClient();
  const registerMutation = useRegister();

  const [registered, setRegistered] = useState<CurrentUser | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
    setServerErrors,
  } = useZodForm(registerSchema, {
    defaultValues: {
      username: '',
      password: '',
      fullName: '',
      contact: 'none',
      email: '',
      phone: '',
      acceptTerms: false,
    },
  });

  const values = watch();
  const usernameLive = values.username.length > 0;

  const onSubmit = handleSubmit(async (form) => {
    setFormError(null);
    const body: RegisterBody = {
      username: form.username.trim().toLowerCase(),
      password: form.password,
      ...(form.fullName.trim().length > 0 ? { fullName: form.fullName.trim() } : {}),
      ...(form.contact === 'email' ? { email: form.email.trim() } : {}),
      ...(form.contact === 'phone' ? { phone: form.phone.trim() } : {}),
    };
    try {
      const result = await registerMutation.mutateAsync(body);
      queryClient.setQueryData(qk.auth.me(), result.user);
      setRegistered(result.user);
    } catch (err) {
      if (!isApiRequestError(err)) {
        setFormError(tRoot('errors.internal_error'));
        return;
      }
      if (err.code === 'CONFLICT') {
        // Availability is deliberately checked only here (on submit).
        setError('username', { type: 'server', message: 'auth.register.usernameTaken' });
        return;
      }
      const fields = registerMutation.fieldErrors(err);
      if (Object.keys(fields).length > 0) {
        setServerErrors(fields);
        return;
      }
      setFormError(translateIssue(tRoot, { message: err.messageKey }));
    }
  });

  if (registered !== null) {
    return (
      <AuthCard title={t('successTitle')}>
        <div className="flex flex-col items-start gap-3">
          <CheckCircle2 size={32} className="text-success" aria-hidden="true" />
          <Text as="p" size="sm" muted>
            {t('successDescription')}
          </Text>
          {/* The visitor is now logged in: mount a provider around the nudge
              so it reads the fresh auth state without a refetch. */}
          <AuthProvider initialUser={registered} initialApiError={false}>
            <div className="w-full">
              <VerificationBanner />
            </div>
          </AuthProvider>
          <Button variant="secondary" asChild>
            <Link href="/">{t('goHome')}</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  const fieldMessage = (message: unknown): string | undefined =>
    typeof message === 'string' ? translateIssue(tRoot, { message }) : undefined;

  return (
    <AuthCard title={t('title')} subtitle={t('subtitle')}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <Field
          name="username"
          label={t('usernameLabel')}
          required
          error={fieldMessage(errors.username?.message)}
          hint={
            usernameLive ? (
              isUsernameFormatValid(values.username.trim().toLowerCase()) ? (
                <span className="text-success">{t('usernameOk')}</span>
              ) : (
                t('usernameHint')
              )
            ) : (
              t('usernameHint')
            )
          }
        >
          {(props) => (
            <Input
              {...props}
              {...register('username')}
              type="text"
              dir="ltr"
              className="text-start"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          )}
        </Field>

        <Field
          name="password"
          label={t('passwordLabel')}
          required
          error={fieldMessage(errors.password?.message)}
        >
          {(props) => (
            <PasswordInput
              {...props}
              {...register('password')}
              showStrength
              autoComplete="new-password"
            />
          )}
        </Field>

        <Field
          name="fullName"
          label={t('fullNameLabel')}
          error={fieldMessage(errors.fullName?.message)}
        >
          {(props) => (
            <Input {...props} {...register('fullName')} type="text" autoComplete="name" />
          )}
        </Field>

        <div className="flex flex-col gap-1">
          <span className="mb-1 block text-sm font-medium text-text">{t('contactLabel')}</span>
          <SegmentedControl
            label={t('contactLabel')}
            value={values.contact}
            onValueChange={(choice) => setValue('contact', choice, { shouldValidate: false })}
            options={[
              { value: 'none' as ContactChoice, label: t('contactNone') },
              { value: 'email' as ContactChoice, label: t('contactEmail') },
              { value: 'phone' as ContactChoice, label: t('contactPhone') },
            ]}
          />
          <p className="mt-1 text-xs text-text-subtle">{t('verificationNote')}</p>
        </div>

        {values.contact === 'email' ? (
          <Field name="email" label={t('emailLabel')} error={fieldMessage(errors.email?.message)}>
            {(props) => (
              <Input
                {...props}
                {...register('email')}
                type="email"
                dir="ltr"
                className="text-start"
                autoComplete="email"
              />
            )}
          </Field>
        ) : null}

        {values.contact === 'phone' ? (
          <Field name="phone" label={t('phoneLabel')} error={fieldMessage(errors.phone?.message)}>
            {(props) => (
              <PhoneInput
                {...props}
                value={values.phone}
                onValueChange={(phone) => setValue('phone', phone, { shouldValidate: false })}
              />
            )}
          </Field>
        ) : null}

        <div className="flex flex-col gap-1">
          <Checkbox
            {...register('acceptTerms')}
            label={t.rich('acceptTerms', {
              terms: (chunks) => (
                <Link
                  href="/p/terms"
                  className="text-primary underline-offset-4 hover:underline"
                  target="_blank"
                >
                  {chunks}
                </Link>
              ),
              privacy: (chunks) => (
                <Link
                  href="/p/privacy"
                  className="text-primary underline-offset-4 hover:underline"
                  target="_blank"
                >
                  {chunks}
                </Link>
              ),
            })}
          />
          {errors.acceptTerms !== undefined ? (
            <p role="alert" className="text-xs text-danger">
              {fieldMessage(errors.acceptTerms.message)}
            </p>
          ) : null}
        </div>

        {formError !== null ? (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        ) : null}

        <Button type="submit" block loading={isSubmitting || registerMutation.isPending}>
          {t('submit')}
        </Button>
      </form>
    </AuthCard>
  );
}
