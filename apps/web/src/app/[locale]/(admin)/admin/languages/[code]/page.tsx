import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { languageSchema, type Language } from '@app/contracts';
import { requireUser } from '@/lib/auth/guard';
import { PageHeader } from '@/components/layout/page-header';
import { apiFetchServer } from '@/lib/api/server';
import { TranslationsEditor } from './translations-editor';

const languageListSchema = z.object({ items: z.array(languageSchema) });

/** Minimal Language-shaped stub — the editor reads `code` and `dir` only. */
function languageStub(code: string): Language {
  return {
    code,
    nameNative: code,
    nameEn: code,
    dir: 'rtl',
    isDefault: false,
    isActive: true,
    sortOrder: 100,
  };
}

/**
 * `/admin/languages/[code]` (F2.3) — the translation editor for one locale.
 * The language display name resolves server-side from the (small) full
 * list — the admin API has no single-language GET; an unknown code 404s
 * via that lookup, and an API outage degrades to the bare code.
 */
export default async function AdminTranslationsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  await requireUser({ roles: ['admin', 'super_admin'], pathname: '/admin/languages' });
  const tLanguages = await getTranslations('admin.languages');
  const tTranslations = await getTranslations('admin.translations');

  let language = languageStub(code);
  try {
    const result = await apiFetchServer('/admin/i18n/languages', languageListSchema);
    const found = result.data.items.find((l) => l.code === code);
    if (!found) notFound();
    language = found;
  } catch {
    // API down — keep the stub; the editor's own queries retry/refetch.
  }
  const displayName = `${language.nameNative} (${language.code})`;

  return (
    <div className="space-y-4">
      <PageHeader
        title={tTranslations('page.title', { name: displayName })}
        description={tTranslations('page.description')}
      />
      <p className="sr-only">{tLanguages('page.title')}</p>
      <TranslationsEditor language={language} />
    </div>
  );
}
