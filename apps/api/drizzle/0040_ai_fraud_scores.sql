-- A9.6 — AI fraud/toxicity scores: one row per review, score 0..1 + signals.

CREATE TABLE IF NOT EXISTS "public"."ai_fraud_scores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "review_id" uuid NOT NULL,
  "score" double precision NOT NULL,
  "driver" varchar(20) NOT NULL,
  "model" varchar(100),
  "prompt_version" integer DEFAULT 1 NOT NULL,
  "stale" boolean DEFAULT false NOT NULL,
  "signals" text,
  "prompt_tokens" integer DEFAULT 0 NOT NULL,
  "completion_tokens" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "ai_fraud_scores_review_id_fkey"
    FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE CASCADE,
  CONSTRAINT "ai_fraud_scores_score_range" CHECK ("score" BETWEEN 0 AND 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_fraud_scores_review_uniq"
  ON "public"."ai_fraud_scores" ("review_id");
CREATE INDEX IF NOT EXISTS "ai_fraud_scores_score_idx"
  ON "public"."ai_fraud_scores" ("score" DESC);
CREATE INDEX IF NOT EXISTS "ai_fraud_scores_version_idx"
  ON "public"."ai_fraud_scores" ("prompt_version");
