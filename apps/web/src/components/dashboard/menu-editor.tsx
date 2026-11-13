'use client';

/**
 * MenuEditor (F7.3) — the `/dashboard/:businessId/menu` body.
 *
 * The owner's menu: named sections, each holding items (name, optional
 * description, optional price in Rials, availability). The whole menu is
 * replaced atomically on save (`PUT /businesses/:id/menu` — the payload
 * snapshot BECOMES the menu; rows are recreated, ids server-issued). The
 * B2.8 caps (`MENU_MAX_SECTIONS = 20`, `MENU_MAX_ITEMS_PER_SECTION = 50`,
 * `MENU_PRICE_MAX`) are enforced by the API; the editor disables add-buttons
 * at the section cap. Prices are entered in Toman (the UI unit) and converted
 * to Rials (×10) for the payload — the API's money unit is Rials (AGENTS.md 6).
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import {
  MENU_MAX_ITEMS_PER_SECTION,
  MENU_MAX_SECTIONS,
  type MenuResponse,
  type MenuSectionInput,
  type ReplaceMenuBody,
} from '@app/contracts';
import { useReplaceMenu } from '../../lib/api/business-menu';
import { isApiRequestError } from '../../lib/api/errors';
import { translateIssue } from '../../lib/forms/translate-issue';
import { createFormatters } from '../../lib/format';
import { useLocale } from 'next-intl';
import { useToast } from '../ui/toast';
import { Card, CardBody, CardHeader, Heading, IconButton } from '../ui';
import { SubmitButton } from '../ui/form';

interface ItemState {
  name: string;
  description: string;
  /** Toman string (UI unit); '' = not priced. Converted to Rials ×10 on save. */
  price: string;
  isAvailable: boolean;
}

interface SectionState {
  name: string;
  items: ItemState[];
}

function toToman(priceRials: number | null | undefined): string {
  if (priceRials === null || priceRials === undefined) return '';
  return String(Math.round(priceRials / 10));
}

function fromResponse(menu: MenuResponse | null): SectionState[] {
  if (!menu) return [];
  return menu.sections.map((s) => ({
    name: s.name,
    items: s.items.map((it) => ({
      name: it.name,
      description: it.description ?? '',
      price: toToman(it.price),
      isAvailable: it.isAvailable,
    })),
  }));
}

/** Build the replace body from the editor state (Toman → Rials, empty → null). */
export function buildMenuBody(sections: SectionState[]): ReplaceMenuBody {
  const out: MenuSectionInput[] = sections
    .filter((s) => s.name.trim().length > 0 || s.items.some((i) => i.name.trim().length > 0))
    .map((s) => ({
      name: s.name.trim(),
      items: s.items
        .filter((i) => i.name.trim().length > 0)
        .map((i) => {
          const toman = i.price.trim();
          const rials = toman === '' ? null : Math.round(Number(toman) * 10);
          return {
            name: i.name.trim(),
            description: i.description.trim() === '' ? null : i.description.trim(),
            price: Number.isNaN(rials as number) ? null : rials,
            isAvailable: i.isAvailable,
          };
        }),
    }));
  return { sections: out };
}

export function MenuEditor({
  businessId,
  initialMenu,
}: {
  businessId: string;
  initialMenu: MenuResponse | null;
}) {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const locale = useLocale();
  const { formatNumber } = createFormatters(locale);
  const toast = useToast();
  const replaceMutation = useReplaceMenu(businessId);
  const [formError, setFormError] = useState<string | null>(null);

  const initial = useMemo(() => fromResponse(initialMenu), [initialMenu]);
  const [sections, setSections] = useState<SectionState[]>(initial);

  const addSection = () =>
    setSections((prev) =>
      prev.length >= MENU_MAX_SECTIONS ? prev : [...prev, { name: '', items: [] }],
    );

  const removeSection = (idx: number) => setSections((prev) => prev.filter((_, i) => i !== idx));

  const setSectionName = (idx: number, name: string) =>
    setSections((prev) => prev.map((s, i) => (i === idx ? { ...s, name } : s)));

  const addItem = (sIdx: number) =>
    setSections((prev) =>
      prev.map((s, i) =>
        i === sIdx
          ? s.items.length >= MENU_MAX_ITEMS_PER_SECTION
            ? s
            : {
                ...s,
                items: [...s.items, { name: '', description: '', price: '', isAvailable: true }],
              }
          : s,
      ),
    );

  const removeItem = (sIdx: number, iIdx: number) =>
    setSections((prev) =>
      prev.map((s, i) => (i === sIdx ? { ...s, items: s.items.filter((_, j) => j !== iIdx) } : s)),
    );

  const setItem = (sIdx: number, iIdx: number, patch: Partial<ItemState>) =>
    setSections((prev) =>
      prev.map((s, i) =>
        i === sIdx
          ? { ...s, items: s.items.map((it, j) => (j === iIdx ? { ...it, ...patch } : it)) }
          : s,
      ),
    );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await replaceMutation.mutateAsync(buildMenuBody(sections));
      toast.success(t('menu.saved'));
    } catch (err) {
      if (!isApiRequestError(err)) {
        setFormError(tRoot('errors.internal_error'));
        return;
      }
      setFormError(translateIssue(tRoot, { message: err.messageKey }));
    }
  };

  return (
    <Card>
      <CardHeader>
        <Heading level="h2" className="text-base">
          {t('menu.title')}
        </Heading>
      </CardHeader>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {sections.length === 0 && <p className="text-sm text-text-subtle">{t('menu.empty')}</p>}
          {sections.map((section, sIdx) => (
            <div key={sIdx} className="rounded-md border border-border-subtle p-3">
              <div className="mb-3 flex items-center gap-2">
                <input
                  value={section.name}
                  onChange={(e) => setSectionName(sIdx, e.target.value)}
                  placeholder={t('menu.sectionName')}
                  className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-text"
                />
                <IconButton
                  icon={Trash2}
                  aria-label={t('menu.removeSection')}
                  onClick={() => removeSection(sIdx)}
                  variant="ghost"
                  size="sm"
                />
              </div>
              <div className="space-y-2">
                {section.items.map((item, iIdx) => (
                  <div key={iIdx} className="rounded-md bg-surface-alt p-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={item.name}
                        onChange={(e) => setItem(sIdx, iIdx, { name: e.target.value })}
                        placeholder={t('menu.itemName')}
                        className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
                      />
                      <label className="flex items-center gap-1 text-xs text-text-subtle">
                        <input
                          type="checkbox"
                          checked={item.isAvailable}
                          onChange={(e) => setItem(sIdx, iIdx, { isAvailable: e.target.checked })}
                        />
                        {t('menu.available')}
                      </label>
                      <IconButton
                        icon={Trash2}
                        aria-label={t('menu.removeItem')}
                        onClick={() => removeItem(sIdx, iIdx)}
                        variant="ghost"
                        size="sm"
                      />
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        value={item.description}
                        onChange={(e) => setItem(sIdx, iIdx, { description: e.target.value })}
                        placeholder={t('menu.itemDescription')}
                        className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
                      />
                      <input
                        type="number"
                        min={0}
                        value={item.price}
                        onChange={(e) => setItem(sIdx, iIdx, { price: e.target.value })}
                        placeholder={t('menu.priceToman')}
                        dir="ltr"
                        className="w-28 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
                      />
                    </div>
                  </div>
                ))}
                {section.items.length < MENU_MAX_ITEMS_PER_SECTION && (
                  <button
                    type="button"
                    onClick={() => addItem(sIdx)}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <Plus className="size-4" aria-hidden />
                    {t('menu.addItem')}
                  </button>
                )}
              </div>
            </div>
          ))}
          {sections.length < MENU_MAX_SECTIONS && (
            <button
              type="button"
              onClick={addSection}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <Plus className="size-4" aria-hidden />
              {t('menu.addSection')}
            </button>
          )}
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">
              {t('menu.sectionsCount', { count: formatNumber(sections.length) })}
            </p>
            <SubmitButton loading={replaceMutation.isPending}>{t('menu.save')}</SubmitButton>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
