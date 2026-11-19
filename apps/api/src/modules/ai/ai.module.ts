import { Module, type Provider } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { ReviewsModule } from '../reviews/reviews.module.js';
import { AiCallsRepository, AI_CALLS_REPOSITORY } from './ai-calls.repository.js';
import {
  AiReviewSummariesRepository,
  AI_REVIEW_SUMMARIES_REPOSITORY,
} from './ai-review-summaries.repository.js';
import { AiAdminController } from './ai-admin.controller.js';
import { AiReviewSummaryController } from './ai-review-summary.controller.js';
import { AiService } from './ai.service.js';
import { ReviewSummaryService } from './review-summary.service.js';
import { ReviewSummarySubscriber } from './review-summary.subscriber.js';
import { AI_DRIVER } from './ai-driver.interface.js';
import { FakeAiDriver } from './fake-ai.driver.js';
import { OpenAiDriver } from './openai-ai.driver.js';
import { RuleAiDriver } from './rule-ai.driver.js';

/**
 * AI module (Phase 9). Wires the three drivers + the service + the
 * repository + the admin controller + the A9.3 review-summary
 * sub-feature (repository + service + controller + reviews-event
 * subscriber). The drivers are all provided as plain classes so the
 * service can inject any of them (the configured driver is selected by
 * the service at call time, reading the `ai.driver` setting).
 *
 * `SettingsModule` is imported so SettingsService is available — the
 * services read 12 + 3 settings keys on every call (through the cache).
 *
 * `ReviewsModule` is imported so `ReviewsService.listForSummary` is
 * available — the ReviewSummaryService reads the latest approved reviews
 * to build the LLM prompt. There is NO circular dependency: ReviewsModule
 * does not import AiModule.
 */
const driverProvider: Provider = {
  provide: AI_DRIVER,
  useFactory: () => {
    return new FakeAiDriver();
  },
};

const callsRepositoryProvider: Provider = {
  provide: AI_CALLS_REPOSITORY,
  useClass: AiCallsRepository,
};

const summariesRepositoryProvider: Provider = {
  provide: AI_REVIEW_SUMMARIES_REPOSITORY,
  useClass: AiReviewSummariesRepository,
};

@Module({
  imports: [SettingsModule, ReviewsModule],
  controllers: [AiAdminController, AiReviewSummaryController],
  providers: [
    driverProvider,
    callsRepositoryProvider,
    summariesRepositoryProvider,
    FakeAiDriver,
    OpenAiDriver,
    RuleAiDriver,
    AiService,
    ReviewSummaryService,
    ReviewSummarySubscriber,
  ],
  exports: [AiService, ReviewSummaryService],
})
export class AiModule {}
