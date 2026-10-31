CREATE TYPE "public"."otp_channel" AS ENUM('sms', 'email');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('login', 'verify_email', 'verify_phone', 'reset_password', 'change_email', 'change_phone');--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"channel" "otp_channel" NOT NULL,
	"target" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet",
	"user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otp_target_purpose_created_idx" ON "otp_codes" USING btree ("target","purpose","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "otp_expires_at_idx" ON "otp_codes" USING btree ("expires_at");