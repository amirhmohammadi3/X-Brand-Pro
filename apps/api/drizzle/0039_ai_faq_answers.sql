-- A9.4 — AI FAQ answers: one draft per question, owner publishes or dismisses.

CREATE TABLE IF NOT EXISTS "public"."ai_faq_answers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "question_id" uuid NOT NULL,
  "draft" text NOT NULL,
  "driver" varchar(20) NOT NULL,
  "model" varchar(100),
  "prompt_version" integer DEFAULT 1 NOT NULL,
  "published" boolean DEFAULT false NOT NULL,
  "dismissed" boolean DEFAULT false NOT NULL,
  "stale" boolean DEFAULT false NOT NULL,
  "prompt_tokens" integer DEFAULT 0 NOT NULL,
  "completion_tokens" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "ai_faq_answers_question_id_fkey"
    FOREIGN KEY ("question_id") REFERENCES "public"."business_questions"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_faq_answers_question_uniq"
  ON "public"."ai_faq_answers" ("question_id");
CREATE INDEX IF NOT EXISTS "ai_faq_answers_review_idx"
  ON "public"."ai_faq_answers" ("published", "dismissed", "updated_at");
CREATE INDEX IF NOT EXISTS "ai_faq_answers_version_idx"
  ON "public"."ai_faq_answers" ("prompt_version");
