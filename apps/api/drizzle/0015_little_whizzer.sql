CREATE TABLE "business_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"open_time" time(0) NOT NULL,
	"close_time" time(0) NOT NULL,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_hours_weekday_range" CHECK ("business_hours"."weekday" between 1 and 7)
);
--> statement-breakpoint
CREATE TABLE "business_special_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"date" date NOT NULL,
	"closed" boolean NOT NULL,
	"intervals" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_special_days" ADD CONSTRAINT "business_special_days_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_hours_biz_weekday_idx" ON "business_hours" USING btree ("business_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "business_special_days_biz_date_unq" ON "business_special_days" USING btree ("business_id","date");--> statement-breakpoint
CREATE INDEX "business_special_days_biz_date_idx" ON "business_special_days" USING btree ("business_id","date");