CREATE TYPE "public"."booking_cancel_actor" AS ENUM('user', 'business', 'system');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'rejected', 'cancelled', 'no_show', 'completed');--> statement-breakpoint
CREATE TABLE "booking_closed_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_closed_days_note_len" CHECK ("booking_closed_days"."note" IS NULL OR char_length("booking_closed_days"."note") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "booking_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"slot_step_minutes" integer DEFAULT 30 NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"min_party_size" integer DEFAULT 1 NOT NULL,
	"max_party_size" integer DEFAULT 10 NOT NULL,
	"min_lead_minutes" integer DEFAULT 60 NOT NULL,
	"cancel_window_minutes" integer DEFAULT 120 NOT NULL,
	"max_advance_days" integer DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_services_name_len" CHECK (char_length("booking_services"."name") BETWEEN 1 AND 120),
	CONSTRAINT "booking_services_description_len" CHECK ("booking_services"."description" IS NULL OR char_length("booking_services"."description") BETWEEN 1 AND 500),
	CONSTRAINT "booking_services_duration_range" CHECK ("booking_services"."duration_minutes" BETWEEN 15 AND 720),
	CONSTRAINT "booking_services_slot_step_range" CHECK ("booking_services"."slot_step_minutes" BETWEEN 5 AND 120),
	CONSTRAINT "booking_services_capacity_range" CHECK ("booking_services"."capacity" BETWEEN 1 AND 200),
	CONSTRAINT "booking_services_party_min_range" CHECK ("booking_services"."min_party_size" BETWEEN 1 AND 50),
	CONSTRAINT "booking_services_party_max_range" CHECK ("booking_services"."max_party_size" BETWEEN 1 AND 50),
	CONSTRAINT "booking_services_party_order" CHECK ("booking_services"."min_party_size" <= "booking_services"."max_party_size"),
	CONSTRAINT "booking_services_lead_range" CHECK ("booking_services"."min_lead_minutes" BETWEEN 0 AND 10080),
	CONSTRAINT "booking_services_cancel_window_range" CHECK ("booking_services"."cancel_window_minutes" BETWEEN 0 AND 10080),
	CONSTRAINT "booking_services_advance_range" CHECK ("booking_services"."max_advance_days" BETWEEN 1 AND 365)
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_time" time(0) NOT NULL,
	"end_time" time(0) NOT NULL,
	"party_size" integer NOT NULL,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"note" text,
	"code" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"no_show_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_actor" "booking_cancel_actor",
	"cancel_reason" text,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_party_size_min" CHECK ("bookings"."party_size" >= 1),
	CONSTRAINT "bookings_end_after_start" CHECK ("bookings"."end_time" > "bookings"."start_time"),
	CONSTRAINT "bookings_note_len" CHECK ("bookings"."note" IS NULL OR char_length("bookings"."note") BETWEEN 1 AND 500),
	CONSTRAINT "bookings_contact_name_len" CHECK ("bookings"."contact_name" IS NULL OR char_length("bookings"."contact_name") BETWEEN 1 AND 80),
	CONSTRAINT "bookings_contact_phone_len" CHECK ("bookings"."contact_phone" IS NULL OR char_length("bookings"."contact_phone") BETWEEN 4 AND 20),
	CONSTRAINT "bookings_cancel_reason_len" CHECK ("bookings"."cancel_reason" IS NULL OR char_length("bookings"."cancel_reason") BETWEEN 1 AND 300),
	CONSTRAINT "bookings_code_format" CHECK ("bookings"."code" ~ '^[A-Z0-9]{6,10}$')
);
--> statement-breakpoint
ALTER TABLE "booking_closed_days" ADD CONSTRAINT "booking_closed_days_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_booking_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."booking_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_closed_days_biz_date_unq" ON "booking_closed_days" USING btree ("business_id","date");--> statement-breakpoint
CREATE INDEX "booking_services_biz_active_idx" ON "booking_services" USING btree ("business_id","is_active","sort_order","id");--> statement-breakpoint
CREATE INDEX "booking_services_biz_idx" ON "booking_services" USING btree ("business_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "bookings_slot_scan_idx" ON "bookings" USING btree ("service_id","date","start_time");--> statement-breakpoint
CREATE INDEX "bookings_user_idx" ON "bookings" USING btree ("user_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "bookings_biz_date_idx" ON "bookings" USING btree ("business_id","date","status");--> statement-breakpoint
CREATE INDEX "bookings_biz_start_idx" ON "bookings" USING btree ("business_id","date","start_time","id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_biz_code_unq" ON "bookings" USING btree ("business_id","code");