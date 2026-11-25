import { Module, type Provider } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { ReviewsModule } from '../reviews/reviews.module.js';
import { QaModule } from '../qa/qa.module.js';
import { AiCallsRepository, AI_CALLS_REPOSITORY } from './ai-calls.repository.js';
import {
  AiReviewSummariesRepository,
  AI_REVIEW_SUMMARIES_REPOSITORY,
} from './ai-review-summaries.repository.js';
import { AiFaqAnswersRepository, AI_FAQ_ANSWERS_REPOSITORY } from './ai-faq-answers.repository.js';
import {
  AiFraudScoresRepository,
  AI_FRAUD_SCORES_REPOSITORY,
} from './ai-fraud-scores.repository.js';
import { AiAdminController } from './ai-admin.controller.js';
import { AiReviewSummaryController } from './ai-review-summary.controller.js';
import { AiFaqAnswerController } from './ai-faq-answer.controller.js';
import { AiFraudScoreController } from './ai-fraud-score.controller.js';
import { RecommendationController } from './recommendation.controller.js';
import { RecommendationService } from './recommendation.service.js';
import {
  RecommendationRepository,
  RECOMMENDATION_REPOSITORY,
} from './recommendation.repository.js';
import { AiService } from './ai.service.js';
import { ReviewSummaryService } from './review-summary.service.js';
import { ReviewSummarySubscriber } from './review-summary.subscriber.js';
import { FaqAnswerService } from './faq-answer.service.js';
import { FaqAnswerSubscriber } from './faq-answer.subscriber.js';
import { FraudScoreService } from './fraud-score.service.js';
import { FraudScoreSubscriber } from './fraud-score.subscriber.js';
import { AI_DRIVER } from './ai-driver.interface.js';
import { FakeAiDriver } from './fake-ai.driver.js';
import { OpenAiDriver } from './openai-ai.driver.js';
import { RuleAiDriver } from './rule-ai.driver.js';

/**
 * AI module (Phase 9). Wires:
 *  - the three drivers + AiService + the admin controller (A9.1 + A9.7);
 *  - the review-summary sub-feature (A9.3);
 *  - the FAQ-answer sub-feature (A9.4).
 *
 * `SettingsModule` is imported so SettingsService is available. `ReviewsModule`
 * + `QaModule` are imported so the FAQ service can read the question body +
 * recent reviews. No circular deps: neither ReviewsModule nor QaModule
 * imports AiModule.
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

const faqAnswersRepositoryProvider: Provider = {
  provide: AI_FAQ_ANSWERS_REPOSITORY,
  useClass: AiFaqAnswersRepository,
};

const fraudScoresRepositoryProvider: Provider = {
  provide: AI_FRAUD_SCORES_REPOSITORY,
  useClass: AiFraudScoresRepository,
};

const recommendationsRepositoryProvider: Provider = {
  provide: RECOMMENDATION_REPOSITORY,
  useClass: RecommendationRepository,
};

@Module({
  imports: [SettingsModule, ReviewsModule, QaModule],
  controllers: [
    AiAdminController,
    AiReviewSummaryController,
    AiFaqAnswerController,
    AiFraudScoreController,
    RecommendationController,
  ],
  providers: [
    driverProvider,
    callsRepositoryProvider,
    summariesRepositoryProvider,
    faqAnswersRepositoryProvider,
    fraudScoresRepositoryProvider,
    recommendationsRepositoryProvider,
    FakeAiDriver,
    OpenAiDriver,
    RuleAiDriver,
    AiService,
    ReviewSummaryService,
    ReviewSummarySubscriber,
    FaqAnswerService,
    FaqAnswerSubscriber,
    FraudScoreService,
    FraudScoreSubscriber,
    RecommendationService,
  ],
  exports: [
    AiService,
    ReviewSummaryService,
    FaqAnswerService,
    FraudScoreService,
    RecommendationService,
  ],
})
export class AiModule {}
