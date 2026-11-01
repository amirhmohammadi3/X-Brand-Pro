CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_reason" text;--> statement-breakpoint
CREATE INDEX "users_username_trgm_idx" ON "users" USING gin (lower("username") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_email_trgm_idx" ON "users" USING gin (lower("email") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_display_name_trgm_idx" ON "users" USING gin (lower("display_name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");