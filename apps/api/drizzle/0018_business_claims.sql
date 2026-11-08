CREATE TYPE "public"."business_claim_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "business_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"claimant_user_id" uuid NOT NULL,
	"status" "business_claim_status" DEFAULT 'pending' NOT NULL,
	"evidence" text NOT NULL,
	"document_media_id" uuid,
	"reviewed_by" uuid,
	"admin_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_claims" ADD CONSTRAINT "business_claims_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_claims" ADD CONSTRAINT "business_claims_claimant_user_id_users_id_fk" FOREIGN KEY ("claimant_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_claims" ADD CONSTRAINT "business_claims_document_media_id_media_files_id_fk" FOREIGN KEY ("document_media_id") REFERENCES "public"."media_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_claims" ADD CONSTRAINT "business_claims_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_claims_one_pending" ON "business_claims" USING btree ("business_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "business_claims_claimant_idx" ON "business_claims" USING btree ("claimant_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "business_claims_status_created_idx" ON "business_claims" USING btree ("status","created_at" DESC NULLS LAST);