'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui';
import { LocationPicker } from '@/components/map/location-picker';
import { useAuth } from '@/lib/auth/auth-context';
import { apiFetch } from '@/lib/api/client';
import { pickLocalized } from '@/lib/localized';
import {
  amenitySchema,
  businessDetailSchema,
  neighborhoodSchema,
  publicCategoryNodeSchema,
  publicCitySchema,
  type Amenity,
  type CreateBusinessBody,
  type Neighborhood,
  type PublicCategoryLeaf,
  type PublicCategoryNode,
  type PublicCity,
} from '@app/contracts';
import { z } from 'zod';

/**
 * Business registration wizard (F4.10) — a 3-step form posting to
 * `POST /businesses` (B2.6). New businesses start `pending` (admin approval).
 *
 * Step 1 identity (name, alt name, description, primary + secondary
 * categories, tags, price level); step 2 location (city → neighborhood,
 * address, map picker — the F3.2 LocationPicker reuses the self-hosted
 * tiles); step 3 contact + amenities, then submit. On success the created
 * BusinessDetail (with its slug) is returned → redirect to the business page.
 *
 * Auth-gated (the endpoint is user-scoped). Cities/categories/amenities are
 * the public catalog reads; neighborhoods load by city slug on change.
 */
type Step = 0 | 1 | 2;

interface FormState {
  name: string;
  nameAlt: string;
  description: string;
  primaryCategoryId: string;
  categoryIds: string[];
  tags: string;
  priceLevel: string; // '' | '1'..'4'
  cityId: string;
  neighborhoodId: string;
  address: string;
  location: { lat: number; lng: number } | null;
  phone: string;
  whatsapp: string;
  telegram: string;
  instagram: string;
  website: string;
  email: string;
  amenityIds: string[];
}

const EMPTY: FormState = {
  name: '',
  nameAlt: '',
  description: '',
  primaryCategoryId: '',
  categoryIds: [],
  tags: '',
  priceLevel: '',
  cityId: '',
  neighborhoodId: '',
  address: '',
  location: null,
  phone: '',
  whatsapp: '',
  telegram: '',
  instagram: '',
  website: '',
  email: '',
  amenityIds: [],
};

export function BusinessRegistrationWizard() {
  const t = useTranslations('register');
  const locale = useLocale();
  const { status } = useAuth();
  const router = useRouter();

  const [cities, setCities] = useState<PublicCity[]>([]);
  const [categories, setCategories] = useState<PublicCategoryNode[]>([]);
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [catalogError, setCatalogError] = useState(false);

  const [step, setStep] = useState<Step>(0);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);

  // Load the public catalog once.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, cats, a] = await Promise.all([
          apiFetch('/cities', z.object({ items: z.array(publicCitySchema) })),
          apiFetch('/categories', z.object({ items: z.array(publicCategoryNodeSchema) })),
          apiFetch('/amenities', z.object({ items: z.array(amenitySchema) })),
        ]);
        if (!alive) return;
        setCities(c.data.items);
        setCategories(cats.data.items);
        setAmenities(a.data.items);
      } catch {
        if (alive) setCatalogError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const flatCats = useMemo<PublicCategoryLeaf[]>(
    () => categories.flatMap((c) => [c, ...c.children]),
    [categories],
  );
  const selectedCity = useMemo(
    () => cities.find((c) => c.id === form.cityId) ?? null,
    [cities, form.cityId],
  );

  // Neighborhoods load when the city changes.
  useEffect(() => {
    if (!selectedCity) {
      setNeighborhoods([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const { data } = await apiFetch(
          `/cities/${selectedCity.slug}/neighborhoods`,
          z.object({ items: z.array(neighborhoodSchema) }),
        );
        if (alive) setNeighborhoods(data.items);
      } catch {
        if (alive) setNeighborhoods([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedCity]);

  if (status === 'loading') return null;
  if (status === 'anonymous') {
    return (
      <div
        className="rounded-lg border border-border-subtle bg-surface-alt p-6 text-center"
        data-testid="register-gate"
      >
        <p className="text-sm text-muted">{t('loginRequired')}</p>
        <Link
          href="/login"
          className="mt-2 inline-block text-sm text-primary underline underline-offset-4"
        >
          {t('login')}
        </Link>
      </div>
    );
  }
  if (catalogError) {
    return <p className="text-sm text-muted">{t('error')}</p>;
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setStepError(null);
  }

  function validateStep(s: Step): boolean {
    if (s === 0) {
      if (form.name.trim() === '' || form.primaryCategoryId === '') {
        setStepError(t('error'));
        return false;
      }
    }
    if (s === 1) {
      if (form.cityId === '' || form.address.trim() === '' || form.location === null) {
        setStepError(t('error'));
        return false;
      }
    }
    return true;
  }

  function next() {
    if (!validateStep(step)) return;
    setStep((s) => (s < 2 ? ((s + 1) as Step) : s));
  }
  function back() {
    setStepError(null);
    setStep((s) => (s > 0 ? ((s - 1) as Step) : s));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const tags = form.tags
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    const body: CreateBusinessBody = {
      name: form.name.trim(),
      nameAlt: form.nameAlt.trim() === '' ? null : form.nameAlt.trim(),
      description: form.description.trim() === '' ? null : form.description.trim(),
      cityId: form.cityId,
      neighborhoodId: form.neighborhoodId === '' ? null : form.neighborhoodId,
      primaryCategoryId: form.primaryCategoryId,
      categoryIds: form.categoryIds.length > 0 ? form.categoryIds : undefined,
      amenityIds: form.amenityIds.length > 0 ? form.amenityIds : undefined,
      address: form.address.trim(),
      location: form.location!,
      priceLevel: form.priceLevel === '' ? null : Number(form.priceLevel),
      tags: tags.length > 0 ? tags : undefined,
      phone: form.phone.trim() === '' ? null : form.phone.trim(),
      whatsapp: form.whatsapp.trim() === '' ? null : form.whatsapp.trim(),
      telegram: form.telegram.trim() === '' ? null : form.telegram.trim(),
      instagram: form.instagram.trim() === '' ? null : form.instagram.trim(),
      website: form.website.trim() === '' ? null : form.website.trim(),
      email: form.email.trim() === '' ? null : form.email.trim(),
    };
    try {
      const { data } = await apiFetch('/businesses', businessDetailSchema, {
        method: 'POST',
        body,
      });
      router.push(`/business/${data.slug}`);
    } catch {
      setError(t('error'));
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = 'rounded border border-border-subtle bg-surface px-3 py-2 text-sm text-text';
  const labelClass = 'flex flex-col gap-1 text-sm text-text';

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6" data-testid="register-wizard">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text">{t('title')}</h1>
        <span className="text-xs text-muted">
          {t('step', { n: step + 1, total: 3 })} —{' '}
          {t(`steps.${['identity', 'location', 'contact'][step]}` as 'identity')}
        </span>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        {/* ── Step 0: identity ─────────────────────────────────────────── */}
        {step === 0 ? (
          <div className="flex flex-col gap-4" data-testid="register-step-identity">
            <label className={labelClass}>
              <span>{t('fields.name')}</span>
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder={t('fields.namePlaceholder')}
                data-testid="register-name"
              />
            </label>
            <label className={labelClass}>
              <span>{t('fields.nameAlt')}</span>
              <input
                className={inputClass}
                value={form.nameAlt}
                onChange={(e) => set('nameAlt', e.target.value)}
              />
            </label>
            <label className={labelClass}>
              <span>{t('fields.description')}</span>
              <textarea
                className={inputClass}
                rows={3}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder={t('fields.descriptionPlaceholder')}
              />
            </label>
            <label className={labelClass}>
              <span>{t('fields.primaryCategory')}</span>
              <select
                className={inputClass}
                value={form.primaryCategoryId}
                onChange={(e) => set('primaryCategoryId', e.target.value)}
                data-testid="register-primary-category"
              >
                <option value="">{t('fields.selectCategory')}</option>
                {flatCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {pickLocalized(c.name, locale)}
                  </option>
                ))}
              </select>
            </label>
            <div className={labelClass}>
              <span>{t('fields.secondaryCategories')}</span>
              <div className="flex flex-wrap gap-2">
                {flatCats
                  .filter((c) => c.id !== form.primaryCategoryId)
                  .map((c) => {
                    const checked = form.categoryIds.includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            set(
                              'categoryIds',
                              e.target.checked
                                ? [...form.categoryIds, c.id]
                                : form.categoryIds.filter((x) => x !== c.id),
                            )
                          }
                        />
                        <span>{pickLocalized(c.name, locale)}</span>
                      </label>
                    );
                  })}
              </div>
            </div>
            <label className={labelClass}>
              <span>{t('fields.tags')}</span>
              <input
                className={inputClass}
                value={form.tags}
                onChange={(e) => set('tags', e.target.value)}
              />
            </label>
            <label className={labelClass}>
              <span>{t('fields.priceLevel')}</span>
              <select
                className={inputClass}
                value={form.priceLevel}
                onChange={(e) => set('priceLevel', e.target.value)}
                data-testid="register-price"
              >
                <option value="">{t('fields.priceNone')}</option>
                <option value="1">{t('fields.price1')}</option>
                <option value="2">{t('fields.price2')}</option>
                <option value="3">{t('fields.price3')}</option>
                <option value="4">{t('fields.price4')}</option>
              </select>
            </label>
          </div>
        ) : null}

        {/* ── Step 1: location ─────────────────────────────────────────── */}
        {step === 1 ? (
          <div className="flex flex-col gap-4" data-testid="register-step-location">
            <label className={labelClass}>
              <span>{t('fields.city')}</span>
              <select
                className={inputClass}
                value={form.cityId}
                onChange={(e) => {
                  set('cityId', e.target.value);
                  set('neighborhoodId', '');
                }}
                data-testid="register-city"
              >
                <option value="">{t('fields.selectCity')}</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {pickLocalized(c.name, locale)}
                  </option>
                ))}
              </select>
            </label>
            {neighborhoods.length > 0 ? (
              <label className={labelClass}>
                <span>{t('fields.neighborhood')}</span>
                <select
                  className={inputClass}
                  value={form.neighborhoodId}
                  onChange={(e) => set('neighborhoodId', e.target.value)}
                  data-testid="register-neighborhood"
                >
                  <option value="">{t('fields.selectNeighborhood')}</option>
                  {neighborhoods.map((n) => (
                    <option key={n.id} value={n.id}>
                      {pickLocalized(n.name, locale)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className={labelClass}>
              <span>{t('fields.address')}</span>
              <input
                className={inputClass}
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                placeholder={t('fields.addressPlaceholder')}
                data-testid="register-address"
              />
            </label>
            <div className={labelClass}>
              <span>{t('fields.location')}</span>
              <span className="text-xs text-muted">{t('fields.locationHint')}</span>
              <LocationPicker
                cityBbox={selectedCity?.bbox ?? null}
                onSelect={(point) => set('location', point)}
              />
            </div>
          </div>
        ) : null}

        {/* ── Step 2: contact + amenities ──────────────────────────────── */}
        {step === 2 ? (
          <div className="flex flex-col gap-4" data-testid="register-step-contact">
            <label className={labelClass}>
              <span>{t('fields.phone')}</span>
              <input
                className={inputClass}
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className={labelClass}>
                <span>{t('fields.whatsapp')}</span>
                <input
                  className={inputClass}
                  value={form.whatsapp}
                  onChange={(e) => set('whatsapp', e.target.value)}
                />
              </label>
              <label className={labelClass}>
                <span>{t('fields.telegram')}</span>
                <input
                  className={inputClass}
                  value={form.telegram}
                  onChange={(e) => set('telegram', e.target.value)}
                />
              </label>
              <label className={labelClass}>
                <span>{t('fields.instagram')}</span>
                <input
                  className={inputClass}
                  value={form.instagram}
                  onChange={(e) => set('instagram', e.target.value)}
                />
              </label>
              <label className={labelClass}>
                <span>{t('fields.website')}</span>
                <input
                  className={inputClass}
                  value={form.website}
                  onChange={(e) => set('website', e.target.value)}
                />
              </label>
              <label className={labelClass}>
                <span>{t('fields.email')}</span>
                <input
                  className={inputClass}
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </label>
            </div>
            <div className={labelClass}>
              <span>{t('fields.amenities')}</span>
              <div className="flex flex-wrap gap-2">
                {amenities.map((a) => {
                  const checked = form.amenityIds.includes(a.id);
                  return (
                    <label key={a.id} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          set(
                            'amenityIds',
                            e.target.checked
                              ? [...form.amenityIds, a.id]
                              : form.amenityIds.filter((x) => x !== a.id),
                          )
                        }
                      />
                      <span>{pickLocalized(a.name, locale)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {stepError ? (
          <p className="text-xs text-danger" data-testid="register-step-error">
            {stepError}
          </p>
        ) : null}
        {error ? (
          <p className="text-xs text-danger" data-testid="register-error">
            {error}
          </p>
        ) : null}

        {/* nav */}
        <div className="flex items-center justify-between">
          {step > 0 ? (
            <Button type="button" variant="secondary" onClick={back} data-testid="register-back">
              {t('back')}
            </Button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <Button type="button" onClick={next} data-testid="register-next">
              {t('next')}
            </Button>
          ) : (
            <Button type="submit" disabled={submitting} data-testid="register-submit">
              {submitting ? t('submitting') : t('submit')}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
