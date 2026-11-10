CREATE TYPE "public"."report_category" AS ENUM('spam', 'offensive', 'false_info', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('pending', 'reviewed', 'dismissed', 'actioned');--> statement-breakpoint
CREATE TYPE "public"."report_target_type" AS ENUM('review', 'reply');--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "report_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"category" "report_category" NOT NULL,
	"details" text,
	"status" "report_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"resolution_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_reports_details_len" CHECK ("content_reports"."details" IS NULL OR char_length("content_reports"."details") BETWEEN 2 AND 1000),
	CONSTRAINT "content_reports_note_len" CHECK ("content_reports"."resolution_note" IS NULL OR char_length("content_reports"."resolution_note") BETWEEN 2 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "moderator_note" text;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_reports_one_per_reporter" ON "content_reports" USING btree ("target_type","target_id","reporter_user_id");--> statement-breakpoint
CREATE INDEX "content_reports_status_created_idx" ON "content_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "content_reports_target_idx" ON "content_reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "content_reports_reporter_idx" ON "content_reports" USING btree ("reporter_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderator_note_len" CHECK ("reviews"."moderator_note" IS NULL OR char_length("reviews"."moderator_note") BETWEEN 2 AND 1000);