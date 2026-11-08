CREATE TABLE "amenities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" jsonb NOT NULL,
	"icon" text DEFAULT 'wifi' NOT NULL,
	"group" text DEFAULT 'general' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "amenities_slug_unique" UNIQUE("slug"),
	CONSTRAINT "amenities_name_has_fa" CHECK ("amenities"."name" ? 'fa'),
	CONSTRAINT "amenities_group_enum" CHECK ("amenities"."group" in ('general','food','payment','accessibility','family','comfort'))
);
--> statement-breakpoint
CREATE TABLE "category_amenities" (
	"category_id" uuid NOT NULL,
	"amenity_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_amenities_pk" PRIMARY KEY("category_id","amenity_id")
);
--> statement-breakpoint
ALTER TABLE "category_amenities" ADD CONSTRAINT "category_amenities_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_amenities" ADD CONSTRAINT "category_amenities_amenity_id_amenities_id_fk" FOREIGN KEY ("amenity_id") REFERENCES "public"."amenities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_amenities_category_sort_idx" ON "category_amenities" USING btree ("category_id","sort_order");