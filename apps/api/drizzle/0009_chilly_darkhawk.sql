CREATE TABLE "theme_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"names" jsonb NOT NULL,
	"tokens" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_builtin" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "theme_packs" ADD CONSTRAINT "theme_packs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;