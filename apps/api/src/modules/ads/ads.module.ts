import { Module } from '@nestjs/common';
import { ADS_REPOSITORY, AdsRepository } from './ads.repository.js';
import { AdsService } from './ads.service.js';
import { AdDeliveryService } from './ad-delivery.service.js';
import { AdsController } from './ads.controller.js';

/**
 * AdsModule (B8.3/B8.4) — campaign CRUD + delivery pacing + ad injection.
 *
 * The campaign lifecycle: draft → pending_payment → active → paused → ended →
 * archived. The owner creates a draft, the checkout flips it to
 * pending_payment (a payment intent with purpose='ads'), the
 * `onPaymentVerified` settle hook flips it to active. The ad-injection path
 * (B8.4) reads active campaigns eligible for a placement; each impression/click
 * debits the budget atomically (a race never over-spends).
 *
 * `AdDeliveryService` (B8.4) is exported so the SearchService can inject
 * sponsored hits into the natural results.
 *
 * `DrizzleClient` is @Global so the repository injects it without an import.
 */
@Module({
  controllers: [AdsController],
  providers: [
    { provide: ADS_REPOSITORY, useClass: AdsRepository },
    AdsService,
    AdDeliveryService,
  ],
  exports: [AdsService, AdDeliveryService],
})
export class AdsModule {}
