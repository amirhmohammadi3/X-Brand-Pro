import { Module } from '@nestjs/common';
import { BILLING_REPOSITORY, BillingRepository } from './billing.repository.js';
import { BillingService } from './billing.service.js';
import { BillingController } from './billing.controller.js';

/**
 * BillingModule (B8.2) — plans catalog, per-business subscription, invoices.
 *
 * The plan catalog is seeded by the seeder (free/starter/pro); the admin can
 * deactivate (hide) a tier without deleting it. The subscription upsert is the
 * core: cancel any existing active subscription, insert a new
 * `pending_payment` one, draft an invoice. The PaymentService calls
 * `onPaymentVerified` when the subscription payment verifies → settles the
 * invoice + flips the subscription to `active`.
 *
 * `DrizzleClient` is @Global so the repository injects it without an import.
 */
@Module({
  controllers: [BillingController],
  providers: [
    { provide: BILLING_REPOSITORY, useClass: BillingRepository },
    BillingService,
  ],
  exports: [BillingService],
})
export class BillingModule {}
