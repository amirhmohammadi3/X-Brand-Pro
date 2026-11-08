CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"icon" text DEFAULT 'store' NOT NULL,
	"color" text,
	"kind" text DEFAULT 'none' NOT NULL,
	"supports_reservation" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug"),
	CONSTRAINT "categories_name_has_fa" CHECK ("categories"."name" ? 'fa'),
	CONSTRAINT "categories_kind_enum" CHECK ("categories"."kind" in ('menu', 'services', 'none'))
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_parent_sort_idx" ON "categories" USING btree ("parent_id","sort_order");