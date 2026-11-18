'use client';

/**
 * CampaignsDashboard (F8.2) — the `/dashboard/:businessId/campaigns` body.
 *
 * The owner's ad campaigns view: a "Create campaign" button that opens a form
 * modal (name, placements, budget, daily cap, CPC, schedule, headline), the
 * campaign list (status badge + budget remaining + a stats expandable), and
 * the per-campaign stats (impressions/clicks/ctr/spent/days).
 *
 * Lifecycle: the create returns a `draft` campaign. The owner clicks "Pay" →
 * `useCampaignCheckout()` runs prepare-payment → create-payment → redirect.
 * After the gateway verify, `AdsService.onPaymentVerified` flips the campaign
 * to `active`. The owner can pause/resume/end/archive via the status dropdown.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Megaphone, Pause, Play, BarChart3, CreditCard, Plus } from 'lucide-react';
import {
  AD_PLACEMENTS,
  type AdPlacement,
  type Campaign,
  type CreateCampaignBody,
} from '@app/contracts';
import { createFormatters } from '../../lib/format';
import {
  useCampaignCheckout,
  useCampaigns,
  useCampaignStats,
  useCreateCampaign,
  useUpdateCampaignStatus,
} from '../../lib/api/campaigns';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Heading, Modal, Spinner, Text, useModalState } from '../ui';

export function CampaignsDashboard({ businessId }: { businessId: string }) {
  const t = useTranslations('dashboard');
  const [page] = useState(1);
  const { items: campaigns, isPending, error } = useCampaigns(businessId, page);
  const createModal = useModalState();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <Heading level="h1">{t('campaigns.title')}</Heading>
        <Button onClick={() => createModal.openModal()}>
          <Plus className="h-4 w-4" />
          {t('campaigns.create')}
        </Button>
      </div>

      {isPending ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={t('common.error')} />
      ) : campaigns.length === 0 ? (
        <EmptyState icon={Megaphone} title={t('campaigns.empty')} />
      ) : (
        <div className="space-y-4">
          {campaigns.map((c) => (
            <CampaignCard key={c.id} campaign={c} businessId={businessId} />
          ))}
        </div>
      )}

      <CreateCampaignModal
        businessId={businessId}
        open={createModal.isOpen}
        onOpenChange={(o) => (o ? createModal.openModal() : createModal.closeModal())}
      />
    </div>
  );
}

/** A campaign card: status + budget + the actions + the expandable stats. */
function CampaignCard({ campaign, businessId }: { campaign: Campaign; businessId: string }) {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const locale = useLocale();
  const { formatNumber } = createFormatters(locale);
  const formatPrice = (tomans: number) => `${formatNumber(tomans)} ${tRoot('common.currency.toman')}`;
  const updateStatus = useUpdateCampaignStatus(businessId);
  const checkout = useCampaignCheckout(businessId);
  const [showStats, setShowStats] = useState(false);

  const statusVariant =
    campaign.status === 'active' ? 'success' : campaign.status === 'ended' || campaign.status === 'archived' ? 'neutral' : 'warning';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant as 'success' | 'neutral' | 'warning'}>
              {t(`ads.campaign.status.${campaign.status}`)}
            </Badge>
            <Heading level="h3">{campaign.name}</Heading>
          </div>
          <div className="flex items-center gap-2">
            {campaign.status === 'draft' && (
              <Button
                size="sm"
                loading={checkout.isPending}
                onClick={() => checkout.run(campaign.id)}
              >
                <CreditCard className="h-4 w-4" />
                {t('ads.campaign.checkout')}
              </Button>
            )}
            {campaign.status === 'active' && (
              <Button
                size="sm"
                variant="ghost"
                loading={updateStatus.isPending}
                onClick={() =>
                  updateStatus.mutateAsync({ campaignId: campaign.id, body: { status: 'paused' } })
                }
              >
                <Pause className="h-4 w-4" />
                {t('ads.campaign.status.paused')}
              </Button>
            )}
            {campaign.status === 'paused' && (
              <Button
                size="sm"
                variant="ghost"
                loading={updateStatus.isPending}
                onClick={() =>
                  updateStatus.mutateAsync({ campaignId: campaign.id, body: { status: 'active' } })
                }
              >
                <Play className="h-4 w-4" />
                {t('ads.campaign.status.active')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setShowStats((s) => !s)}>
              <BarChart3 className="h-4 w-4" />
              {t('campaigns.stats')}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardBody>
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t('ads.campaign.budgetTotal')} value={formatPrice(campaign.budgetTotal)} />
          <Stat
            label={t('ads.campaign.budgetRemaining')}
            value={formatPrice(campaign.budgetRemaining)}
          />
          <Stat label={t('ads.campaign.cpc')} value={formatPrice(campaign.cpc)} />
          <Stat
            label={t('ads.campaign.schedule')}
            value={`${campaign.startsOn} → ${campaign.endsOn}`}
          />
        </div>
        {campaign.headline && (
          <Text size="sm" muted className="mt-3">
            {t('ads.campaign.headline')}: {campaign.headline}
          </Text>
        )}
        {showStats && <CampaignStats campaignId={campaign.id} />}
      </CardBody>
    </Card>
  );
}

/** A stat label + value. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" muted>
        {label}
      </Text>
      <Text size="sm">{value}</Text>
    </div>
  );
}

/** The expandable stats panel for a campaign. */
function CampaignStats({ campaignId }: { campaignId: string }) {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const locale = useLocale();
  const { formatNumber } = createFormatters(locale);
  const formatPrice = (tomans: number) => `${formatNumber(tomans)} ${tRoot('common.currency.toman')}`;
  const { stats, isPending } = useCampaignStats(campaignId);

  if (isPending) return <Spinner />;
  if (!stats) return null;
  const ctrPct = stats.impressions > 0 ? Math.round(stats.ctr * 1000) / 10 : 0;

  return (
    <div className="mt-4 border-t pt-4">
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('ads.campaign.stats.impressions')} value={formatNumber(stats.impressions)} />
        <Stat label={t('ads.campaign.stats.clicks')} value={formatNumber(stats.clicks)} />
        <Stat label={t('ads.campaign.stats.ctr')} value={`${formatNumber(ctrPct)}%`} />
        <Stat label={t('ads.campaign.stats.spent')} value={formatPrice(stats.spent)} />
      </div>
    </div>
  );
}

/** The create-campaign form modal. */
function CreateCampaignModal({
  businessId,
  open,
  onOpenChange,
}: {
  businessId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('dashboard');
  const create = useCreateCampaign(businessId);
  const [form, setForm] = useState<CreateCampaignBody>({
    businessId,
    name: '',
    placements: ['search_top'],
    budgetTotal: 100_000,
    dailyCap: 20_000,
    cpc: 1_000,
    startsOn: new Date().toISOString().slice(0, 10),
    endsOn: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    headline: undefined,
  });

  const togglePlacement = (p: AdPlacement) => {
    setForm((f) => ({
      ...f,
      placements: f.placements.includes(p)
        ? f.placements.filter((x) => x !== p)
        : [...f.placements, p],
    }));
  };

  const submit = async () => {
    await create.mutateAsync(form);
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="md" title={t('campaigns.create')}>
      <div className="space-y-4">
        <Field label={t('ads.campaign.name')}>
          <input
            className="w-full rounded border p-2"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </Field>
        <Field label={t('ads.campaign.placements')}>
          <div className="flex flex-wrap gap-2">
            {AD_PLACEMENTS.map((p) => (
              <label key={p} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={form.placements.includes(p)}
                  onChange={() => togglePlacement(p)}
                />
                <Text size="sm">{t(`ads.placement.${p}`)}</Text>
              </label>
            ))}
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ads.campaign.budgetTotal')}>
            <input
              type="number"
              className="w-full rounded border p-2"
              value={form.budgetTotal}
              onChange={(e) => setForm((f) => ({ ...f, budgetTotal: Number(e.target.value) }))}
            />
          </Field>
          <Field label={t('ads.campaign.dailyCap')}>
            <input
              type="number"
              className="w-full rounded border p-2"
              value={form.dailyCap}
              onChange={(e) => setForm((f) => ({ ...f, dailyCap: Number(e.target.value) }))}
            />
          </Field>
          <Field label={t('ads.campaign.cpc')}>
            <input
              type="number"
              className="w-full rounded border p-2"
              value={form.cpc}
              onChange={(e) => setForm((f) => ({ ...f, cpc: Number(e.target.value) }))}
            />
          </Field>
          <Field label={t('ads.campaign.headline')}>
            <input
              className="w-full rounded border p-2"
              value={form.headline ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value || undefined }))}
            />
          </Field>
          <Field label={t('ads.campaign.startsOn')}>
            <input
              type="date"
              className="w-full rounded border p-2"
              value={form.startsOn}
              onChange={(e) => setForm((f) => ({ ...f, startsOn: e.target.value }))}
            />
          </Field>
          <Field label={t('ads.campaign.endsOn')}>
            <input
              type="date"
              className="w-full rounded border p-2"
              value={form.endsOn}
              onChange={(e) => setForm((f) => ({ ...f, endsOn: e.target.value }))}
            />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} onClick={submit}>
            {t('campaigns.create')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** A form field wrapper (label + child). */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <Text size="xs" muted>
        {label}
      </Text>
      {children}
    </label>
  );
}
