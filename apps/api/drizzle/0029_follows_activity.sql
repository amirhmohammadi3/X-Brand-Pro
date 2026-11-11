CREATE TYPE "public"."activity_type" AS ENUM('review.created', 'question.created', 'question.answered', 'favorite.added');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" "activity_type" NOT NULL,
	"business_id" uuid,
	"subject_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follower_id" uuid NOT NULL,
	"business_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_one_target" CHECK (num_nonnulls("follows"."business_id", "follows"."user_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_actor_created_idx" ON "activity_events" USING btree ("actor_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "activity_events_business_created_idx" ON "activity_events" USING btree ("business_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_events_subject_idx" ON "activity_events" USING btree ("type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "follows_business_unq" ON "follows" USING btree ("follower_id","business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "follows_user_unq" ON "follows" USING btree ("follower_id","user_id");--> statement-breakpoint
CREATE INDEX "follows_follower_idx" ON "follows" USING btree ("follower_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "follows_business_idx" ON "follows" USING btree ("business_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "follows_target_user_idx" ON "follows" USING btree ("user_id","created_at" DESC NULLS LAST);