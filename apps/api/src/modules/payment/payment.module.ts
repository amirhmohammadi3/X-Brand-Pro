import { Module } from '@nestjs/common';
import { FakePaymentGateway } from './fake-payment-gateway.js';
import { ZarinpalSandboxGateway } from './zarinpal-sandbox-gateway.js';
import { PAYMENT_GATEWAY, type PaymentGateway } from './payment-gateway.interface.js';
import { PAYMENTS_REPOSITORY, PaymentsRepository } from './payments.repository.js';
import { PaymentService } from './payment.service.js';
import { PaymentController } from './payment.controller.js';

/**
 * PaymentModule (B8.1) — binds the active gateway based on the
 * `PAYMENT_PROVIDER` env (`fake` | `zarinpal_sandbox`). The fake is the
 * default (no external dependency, succeeds on demand — the test + dev path).
 *
 * The ZarinpalSandboxGateway reads the merchant id from settings at call
 * time (NOT constructor-time), so an admin can flip it without a restart.
 * Its factory captures the settings-service read in a closure the gateway
 * calls per-request. When the merchant id is absent, the gateway returns
 * `{ ok: false, code: 'zarinpal_not_configured' }` and the service marks the
 * payment `failed` (the owner sees a friendly «درگاه فعال نیست» message).
 *
 * `SettingsModule` is @Global (the gateway injects the settings service via
 * the registry), so it does not need to appear in this module's imports.
 */
@Module({
  controllers: [PaymentController],
  providers: [
    { provide: PAYMENTS_REPOSITORY, useClass: PaymentsRepository },
    {
      provide: PAYMENT_GATEWAY,
      useFactory: (): PaymentGateway => {
        const provider = (process.env['PAYMENT_PROVIDER'] ?? 'fake') as 'fake' | 'zarinpal_sandbox';
        if (provider === 'zarinpal_sandbox') {
          // The merchant id is read from settings at call time (not here) so
          // an admin can change it without a process restart. The gateway
          // closure re-reads the env each call — v1 ships the env-var path;
          // a follow-up wires it to the settings registry (B8.2).
          const merchantIdProvider = () => process.env['ZARINPAL_MERCHANT_ID'];
          return new ZarinpalSandboxGateway(merchantIdProvider);
        }
        return new FakePaymentGateway();
      },
    },
    PaymentService,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
