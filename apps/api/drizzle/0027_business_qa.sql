CREATE TYPE "public"."qa_status" AS ENUM('approved', 'pending', 'rejected');--> statement-breakpoint
CREATE TABLE "business_questions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "business_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "body" text NOT NULL,
        "status" "qa_status" DEFAULT 'approved' NOT NULL,
        "edited_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "business_questions_body_len" CHECK (char_length("business_questions"."body") BETWEEN 10 AND 500)
);--> statement-breakpoint
ALTER TABLE "business_questions" ADD CONSTRAINT "business_questions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_questions" ADD CONSTRAINT "business_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_questions_business_list_idx" ON "business_questions" USING btree ("business_id","status","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "business_questions_user_idx" ON "business_questions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "business_questions_status_created_idx" ON "business_questions" USING btree ("status","created_at" ASC);--> statement-breakpoint
CREATE TABLE "business_answers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "question_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "body" text NOT NULL,
        "edited_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "business_answers_body_len" CHECK (char_length("business_answers"."body") BETWEEN 2 AND 1000)
);--> statement-breakpoint
ALTER TABLE "business_answers" ADD CONSTRAINT "business_answers_question_id_business_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."business_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_answers" ADD CONSTRAINT "business_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_answers_one_per_question" ON "business_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "business_answers_user_idx" ON "business_answers" USING btree ("user_id","created_at" DESC NULLS LAST);