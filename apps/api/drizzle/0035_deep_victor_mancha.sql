CREATE TYPE "public"."ad_placement" AS ENUM('search_top', 'home_slot', 'category_top');--> statement-breakpoint
CREATE TYPE "public"."billing_interval" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'pending_payment', 'active', 'paused', 'ended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('fake', 'zarinpal_sandbox');--> statement-breakpoint
CREATE TYPE "public"."payment_purpose" AS ENUM('subscription', 'ads', 'topup');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'gatewayed', 'verified', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('free', 'starter', 'pro', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "ad_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"placements" varchar(60) NOT NULL,
	"budget_total" integer NOT NULL,
	"budget_remaining" integer NOT NULL,
	"daily_cap" integer NOT NULL,
	"cpc" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"headline" varchar(120),
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"payment_id" uuid,
	"payment_status" "payment_status",
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_campaigns_budget_pos" CHECK (budget_total > 0),
	CONSTRAINT "ad_campaigns_budget_remaining_nonneg" CHECK (budget_remaining >= 0),
	CONSTRAINT "ad_campaigns_daily_cap_pos" CHECK (daily_cap > 0),
	CONSTRAINT "ad_campaigns_cpc_pos" CHECK (cpc > 0),
	CONSTRAINT "ad_campaigns_schedule_order" CHECK (ends_on >= starts_on),
	CONSTRAINT "ad_campaigns_counters_nonneg" CHECK (impressions >= 0 AND clicks >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"subscription_id" uuid,
	"plan_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'IRT' NOT NULL,
	"interval" "billing_interval" NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"payment_id" uuid,
	"payment_status" "payment_status",
	"purpose" "payment_purpose" NOT NULL,
	"number" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_amount_nonneg" CHECK (amount >= 0),
	CONSTRAINT "invoices_period_order" CHECK (period_end > period_start)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"business_id" uuid,
	"amount" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'IRT' NOT NULL,
	"purpose" "payment_purpose" NOT NULL,
	"purpose_id" uuid NOT NULL,
	"description" varchar(200) NOT NULL,
	"provider" "payment_provider" DEFAULT 'fake' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"authority" varchar(200),
	"reference_id" varchar(200),
	"gateway_url" varchar(500),
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_pos" CHECK (amount > 0)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier" "plan_tier" NOT NULL,
	"name_key" varchar(80) NOT NULL,
	"price_monthly" integer DEFAULT 0 NOT NULL,
	"price_yearly" integer DEFAULT 0 NOT NULL,
	"limits" varchar(1000) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_price_monthly_nonneg" CHECK (price_monthly >= 0),
	CONSTRAINT "plans_price_yearly_nonneg" CHECK (price_yearly >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_tier" "plan_tier" NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"interval" "billing_interval" DEFAULT 'monthly' NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_period_order" CHECK (current_period_end > current_period_start)
);
--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_campaigns_business_idx" ON "ad_campaigns" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "ad_campaigns_status_idx" ON "ad_campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ad_campaigns_schedule_idx" ON "ad_campaigns" USING btree ("starts_on","ends_on");--> statement-breakpoint
CREATE INDEX "invoices_business_idx" ON "invoices" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "invoices_period_idx" ON "invoices" USING btree ("period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_unq" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_key_unq" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_business_idx" ON "payments" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "payments_purpose_idx" ON "payments" USING btree ("purpose","purpose_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_tier_active_unq" ON "plans" USING btree ("tier") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "plans_sort_idx" ON "plans" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_business_active_unq" ON "subscriptions" USING btree ("business_id") WHERE status IN ('active', 'past_due');--> statement-breakpoint
CREATE INDEX "subscriptions_business_idx" ON "subscriptions" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "subscriptions_period_end_idx" ON "subscriptions" USING btree ("current_period_end");