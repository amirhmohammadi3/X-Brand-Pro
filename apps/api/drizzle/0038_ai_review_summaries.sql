-- A9.3 — AI review summaries: one row per business, regenerated on review
-- changes (debounced) + on admin demand + on prompt-version bump.

CREATE TABLE IF NOT EXISTS "public"."ai_review_summaries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "business_id" uuid NOT NULL,
  "summary" text NOT NULL,
  "driver" varchar(20) NOT NULL,
  "model" varchar(100),
  "prompt_version" integer DEFAULT 1 NOT NULL,
  "stale" boolean DEFAULT false NOT NULL,
  "prompt_tokens" integer DEFAULT 0 NOT NULL,
  "completion_tokens" integer DEFAULT 0 NOT NULL,
  "review_count" integer DEFAULT 0 NOT NULL,
  "review_avg_rating" integer,
  "last_error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "ai_review_summaries_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_review_summaries_business_uniq"
  ON "public"."ai_review_summaries" ("business_id");
CREATE INDEX IF NOT EXISTS "ai_review_summaries_stale_idx"
  ON "public"."ai_review_summaries" ("stale", "updated_at");
CREATE INDEX IF NOT EXISTS "ai_review_summaries_version_idx"
  ON "public"."ai_review_summaries" ("prompt_version");
