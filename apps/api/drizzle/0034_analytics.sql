CREATE TYPE "public"."analytics_event_type" AS ENUM('business_view', 'call_click', 'direction_click', 'share_click', 'impression');--> statement-breakpoint
CREATE TABLE "analytics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"date" date NOT NULL,
	"event_type" "analytics_event_type" NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_daily_count_nonneg" CHECK ("analytics_daily"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"event_type" "analytics_event_type" NOT NULL,
	"date" date NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_bucket_unq" ON "analytics_daily" USING btree ("business_id","date","event_type");--> statement-breakpoint
CREATE INDEX "analytics_daily_series_idx" ON "analytics_daily" USING btree ("business_id","event_type","date");--> statement-breakpoint
CREATE INDEX "analytics_events_rollup_idx" ON "analytics_events" USING btree ("business_id","date","event_type");--> statement-breakpoint
CREATE INDEX "analytics_events_date_idx" ON "analytics_events" USING btree ("date");