ALTER TABLE "users" ADD COLUMN "reputation_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "is_first" boolean DEFAULT false NOT NULL;