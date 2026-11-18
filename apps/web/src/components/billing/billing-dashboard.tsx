'use client';

/**
 * BillingDashboard (F8.1) — the `/dashboard/:businessId/billing` body.
 *
 * The owner's billing view: the current plan badge + limits (or the free-tier
 * fallback), the plan catalog with a checkout flow, and the invoice history.
 *
 * Checkout flow:
 *   1. click "Choose plan" on a plan card → opens the checkout modal;
 *   2. confirm → `useUpsertSubscription()` drafts a pending_payment sub + an
 *      invoice, returns a payment descriptor;
 *   3. `useCreatePayment()` with a fresh idempotencyKey → returns a gatewayed
 *      payment (authority + gatewayUrl);
 *   4. redirect to `payment.gatewayUrl` (the Zarinpal sandbox URL, or
 *      `about:blank` for the fake driver — which routes straight to the
 *      callback page that verifies);
 *   5. the gateway redirects back to `/[locale]/payments/callback?id=…` → the
 *      callback page verifies + routes back here.
 *
 * The cancel button calls `useCancelSubscription()` (the period runs out, no
 * renew). Amounts are in Tomans (integer) — formatted with `formatPrice`.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, CreditCard, Crown, Inbox, Receipt, Sparkles, X } from 'lucide-react';
import { randomUUID } from '../../lib/uuid';
import {
  type BillingInterval,
  type Invoice,
  type Plan,
  type PlanTier,
  type Subscription,
} from '@app/contracts';
import { createFormatters } from '../../lib/format';
import {
  useCancelSubscription,
  useCreatePayment,
  useInvoices,
  usePlans,
  useSubscription,
  useUpsertSubscription,
} from '../../lib/api/billing';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Heading, Modal, Spinner, Tabs, Text, useModalState } from '../ui';

/** The plan card icon per tier (the catalog row). */
const TIER_ICON: Record<PlanTier, typeof Crown> = {
  free: Check,
  starter: Sparkles,
  pro: Crown,
  enterprise: CreditCard,
};

export function BillingDashboard({ businessId }: { businessId: string }) {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const locale = useLocale();
  const { formatNumber } = createFormatters(locale);
  const formatPrice = (tomans: number) => `${formatNumber(tomans)} ${tRoot('common.currency.toman')}`;
  const [interval, setInterval] = useState<BillingInterval>('monthly');

  const { plans, isPending: plansPending, error: plansError } = usePlans();
  const { subscription, limits, isPending: subPending } = useSubscription(businessId);
  const [invoicePage, setInvoicePage] = useState(1);
  const { items: invoices, totalPages: invoiceTotalPages, isPending: invoicesPending } = useInvoices(businessId, invoicePage);

  const activeTier = subscription?.planTier ?? 'free';

  return (
    <div className="space-y-8">
      <Heading level="h1">{t('billing.title')}</Heading>

      {/* Current plan + limits */}
      <CurrentPlanCard
        tier={activeTier}
        subscription={subscription}
        limits={limits}
        isPending={subPending}
        businessId={businessId}
      />

      {/* Plan catalog */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Heading level="h2">{t('billing.plans.title')}</Heading>
          <Tabs
            value={interval}
            onValueChange={(v) => setInterval(v as BillingInterval)}
            tabs={[
              { value: 'monthly', label: t('billing.plan.interval.monthly') },
              { value: 'yearly', label: t('billing.plan.interval.yearly') },
            ]}
          />
        </div>
        {plansPending ? (
          <Spinner />
        ) : plansError ? (
          <ErrorState error={t('common.error')} />
        ) : plans.length === 0 ? (
          <EmptyState icon={Inbox} title={t('billing.plans.empty')} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                interval={interval}
                isCurrent={plan.tier === activeTier}
                formatPrice={formatPrice}
                businessId={businessId}
              />
            ))}
          </div>
        )}
      </section>

      {/* Invoice history */}
      <section className="space-y-4">
        <Heading level="h2">{t('billing.invoice.list')}</Heading>
        {invoicesPending ? (
          <Spinner />
        ) : invoices.length === 0 ? (
          <EmptyState icon={Receipt} title={t('billing.invoice.empty')} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-2 text-start">{t('billing.invoice.number')}</th>
                    <th className="p-2 text-start">{t('billing.invoice.amount')}</th>
                    <th className="p-2 text-start">{t('billing.invoice.period')}</th>
                    <th className="p-2 text-start">{t('billing.invoice.status.title')}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <InvoiceRow key={inv.id} invoice={inv} formatPrice={formatPrice} />
                  ))}
                </tbody>
              </table>
            </div>
            {invoiceTotalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={invoicePage <= 1}
                  onClick={() => setInvoicePage((p) => Math.max(1, p - 1))}
                >
                  {t('common.prev')}
                </Button>
                <Text size="sm">
                  {invoicePage} / {invoiceTotalPages}
                </Text>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={invoicePage >= invoiceTotalPages}
                  onClick={() => setInvoicePage((p) => Math.min(invoiceTotalPages, p + 1))}
                >
                  {t('common.next')}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** The current-plan card: the tier badge + the limits grid + the cancel button. */
function CurrentPlanCard({
  tier,
  subscription,
  limits,
  isPending,
  businessId,
}: {
  tier: PlanTier;
  subscription: Subscription | null;
  limits: { galleryPhotos: number; menuItems: number; videos: boolean; ai: boolean; ads: boolean; adCampaigns: number };
  isPending: boolean;
  businessId: string;
}) {
  const t = useTranslations('dashboard');
  const cancel = useCancelSubscription(businessId);
  const [confirming, setConfirming] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant={tier === 'free' ? 'neutral' : 'success'}>
              {t(`billing.plan.${tier}.name`)}
            </Badge>
            {subscription && (
              <Text size="sm" muted>
                {t(`billing.subscription.status.${subscription.status}` as 'billing.subscription.status.active')}
              </Text>
            )}
          </div>
          {subscription && subscription.status === 'active' && !confirming && (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              {t('billing.subscription.cancel')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {isPending ? (
          <Spinner />
        ) : (
          <>
            {subscription ? (
              <Text size="sm" muted>
                {t('billing.subscription.period', {
                  start: new Date(subscription.currentPeriodStart).toLocaleDateString(),
                  end: new Date(subscription.currentPeriodEnd).toLocaleDateString(),
                })}
              </Text>
            ) : (
              <Text size="sm" muted>
                {t('billing.subscription.none')}
              </Text>
            )}
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <LimitChip label={t('billing.plan.limits.galleryPhotos', { count: limits.galleryPhotos })} ok={limits.galleryPhotos > 0} />
              <LimitChip label={t('billing.plan.limits.menuItems', { count: limits.menuItems })} ok={limits.menuItems > 0} />
              <LimitChip label={t('billing.plan.limits.videos')} ok={limits.videos} />
              <LimitChip label={t('billing.plan.limits.ai')} ok={limits.ai} />
              <LimitChip label={t('billing.plan.limits.ads')} ok={limits.ads} />
              <LimitChip label={t('billing.plan.limits.adCampaigns', { count: limits.adCampaigns })} ok={limits.adCampaigns > 0} />
            </div>
            {confirming && (
              <div className="mt-4 flex items-center gap-2">
                <Text size="sm">{t('billing.subscription.cancel')}?</Text>
                <Button
                  variant="danger"
                  size="sm"
                  loading={cancel.isPending}
                  onClick={async () => {
                    await cancel.mutateAsync();
                    setConfirming(false);
                  }}
                >
                  {t('common.confirm')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

/** A limit chip with a check/cross icon. */
function LimitChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <Check className="h-4 w-4 text-success" />
      ) : (
        <X className="h-4 w-4 text-muted" />
      )}
      <Text size="sm">{label}</Text>
    </div>
  );
}

/** A plan card in the catalog with a checkout button. */
function PlanCard({
  plan,
  interval,
  isCurrent,
  formatPrice,
  businessId,
}: {
  plan: Plan;
  interval: BillingInterval;
  isCurrent: boolean;
  formatPrice: (n: number) => string;
  businessId: string;
}) {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const Icon = TIER_ICON[plan.tier];
  const price = interval === 'yearly' ? plan.priceYearly : plan.priceMonthly;
  const checkout = useCheckoutFlow(businessId);
  const modal = useModalState();

  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <Heading level="h3">{t(`billing.plan.${plan.tier}.name`)}</Heading>
        </div>
        <div className="mt-4">
          <span className="text-2xl font-bold">{price === 0 ? tRoot('common.free') : formatPrice(price)}</span>
          <Text size="sm" muted>
            {' / '}
            {interval === 'yearly' ? t('billing.plan.interval.yearly') : t('billing.plan.interval.monthly')}
          </Text>
        </div>
        <div className="mt-4 space-y-1">
          <LimitChip label={t('billing.plan.limits.galleryPhotos', { count: plan.limits.galleryPhotos })} ok={plan.limits.galleryPhotos > 0} />
          <LimitChip label={t('billing.plan.limits.menuItems', { count: plan.limits.menuItems })} ok={plan.limits.menuItems > 0} />
          {plan.limits.videos && <LimitChip label={t('billing.plan.limits.videos')} ok />}
          {plan.limits.ai && <LimitChip label={t('billing.plan.limits.ai')} ok />}
          {plan.limits.ads && <LimitChip label={t('billing.plan.limits.ads')} ok />}
          {plan.limits.adCampaigns > 0 && (
            <LimitChip label={t('billing.plan.limits.adCampaigns', { count: plan.limits.adCampaigns })} ok />
          )}
        </div>
        <div className="mt-4">
          {isCurrent ? (
            <Button variant="secondary" disabled className="w-full">
              {t('billing.plan.cta.current')}
            </Button>
          ) : (
            <Button
              className="w-full"
              loading={checkout.isPending}
              onClick={() => modal.openModal()}
            >
              {t('billing.plan.cta.subscribe')}
            </Button>
          )}
        </div>
      </CardBody>
      <Modal
        open={modal.isOpen}
        onOpenChange={(open) => (open ? modal.openModal() : modal.closeModal())}
        size="sm"
        title={t('billing.plan.cta.subscribe')}
      >
        <div className="space-y-4">
          <Text size="sm">
            {t(`billing.plan.${plan.tier}.name`)} — {formatPrice(price)}
          </Text>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => modal.closeModal()}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={checkout.isPending}
              onClick={async () => {
                await checkout.run({ planId: plan.id, interval });
                modal.closeModal();
              }}
            >
              {t('billing.plan.cta.subscribe')}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

/** A checkout flow: upsert-subscription → create-payment → redirect. */
function useCheckoutFlow(businessId: string) {
  const upsert = useUpsertSubscription(businessId);
  const createPayment = useCreatePayment();
  const isPending = upsert.isPending || createPayment.isPending;

  const run = async (body: { planId: string; interval: BillingInterval }) => {
    const result = await upsert.mutateAsync(body);
    const payment = await createPayment.mutateAsync({
      idempotencyKey: randomUUID(),
      amount: result.payment.amount,
      purpose: 'subscription',
      purposeId: result.payment.purposeId,
      description: result.payment.description,
    });
    // Redirect to the gateway URL (about:blank for the fake driver → the
    // callback page handles the verify; a real gateway redirects back).
    const locale = document.documentElement.lang || 'fa';
    if (payment.gatewayUrl && payment.gatewayUrl !== 'about:blank') {
      window.location.href = payment.gatewayUrl;
    } else {
      // The fake driver: route straight to the callback page (it verifies).
      window.location.href = `/${locale}/payments/callback?id=${payment.id}`;
    }
  };

  return { run, isPending };
}

/** An invoice row in the history table. */
function InvoiceRow({ invoice, formatPrice }: { invoice: Invoice; formatPrice: (n: number) => string }) {
  const t = useTranslations('dashboard');
  const statusKey = invoice.paymentStatus ?? 'pending';
  const variant =
    invoice.paymentStatus === 'verified' ? 'success' : invoice.paymentStatus === 'failed' ? 'danger' : 'neutral';
  return (
    <tr className="border-b">
      <td className="p-2 font-mono text-xs">{invoice.number}</td>
      <td className="p-2">{formatPrice(invoice.amount)}</td>
      <td className="p-2 text-xs">
        {new Date(invoice.periodStart).toLocaleDateString()} → {new Date(invoice.periodEnd).toLocaleDateString()}
      </td>
      <td className="p-2">
        <Badge variant={variant}>{t(`billing.invoice.status.${statusKey}` as 'billing.invoice.status.pending')}</Badge>
      </td>
    </tr>
  );
}
