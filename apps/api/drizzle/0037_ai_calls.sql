-- A9.1 — AI module: ai_calls log table + supporting enums.
-- One row per driver call (the audit trail + the monthly budget source).

CREATE TYPE "public"."ai_call_feature" AS ENUM(
  'review_summary',
  'faq_auto_answer',
  'recommendation',
  'fraud_toxicity',
  'admin_test'
);

CREATE TYPE "public"."ai_call_driver" AS ENUM('fake', 'openai', 'rule');

CREATE TYPE "public"."ai_call_error_code" AS ENUM(
  'AI_DISABLED',
  'AI_BUDGET_EXHAUSTED',
  'AI_DRIVER_FAILED',
  'AI_INVALID_RESPONSE',
  'AI_NO_CREDENTIALS'
);

CREATE TABLE IF NOT EXISTS "public"."ai_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "feature" "public"."ai_call_feature" NOT NULL,
  "driver" "public"."ai_call_driver" NOT NULL,
  "model" varchar(100),
  "ok" boolean NOT NULL,
  "prompt_tokens" integer DEFAULT 0 NOT NULL,
  "completion_tokens" integer DEFAULT 0 NOT NULL,
  "latency_ms" integer DEFAULT 0 NOT NULL,
  "error_code" "public"."ai_call_error_code",
  "error_message" text,
  "prompt_excerpt" text NOT NULL,
  "completion_excerpt" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "ai_calls_prompt_tokens_nonneg" CHECK ("prompt_tokens" >= 0),
  CONSTRAINT "ai_calls_completion_tokens_nonneg" CHECK ("completion_tokens" >= 0),
  CONSTRAINT "ai_calls_latency_nonneg" CHECK ("latency_ms" >= 0),
  CONSTRAINT "ai_calls_ok_error_consistency"
    CHECK (("ok" AND "error_code" IS NULL) OR (NOT "ok" AND "error_code" IS NOT NULL)),
  CONSTRAINT "ai_calls_prompt_excerpt_len" CHECK (char_length("prompt_excerpt") BETWEEN 1 AND 200),
  CONSTRAINT "ai_calls_completion_excerpt_len" CHECK (char_length("completion_excerpt") BETWEEN 1 AND 200),
  CONSTRAINT "ai_calls_error_message_len"
    CHECK ("error_message" IS NULL OR char_length("error_message") BETWEEN 1 AND 1000)
);

CREATE INDEX IF NOT EXISTS "ai_calls_created_idx" ON "public"."ai_calls" ("created_at" DESC, "id");
CREATE INDEX IF NOT EXISTS "ai_calls_monthly_spend_idx" ON "public"."ai_calls" ("ok", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "ai_calls_feature_idx" ON "public"."ai_calls" ("feature", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "ai_calls_driver_idx" ON "public"."ai_calls" ("driver", "created_at" DESC);
