CREATE TYPE "public"."business_status" AS ENUM('draft', 'pending', 'active', 'suspended', 'rejected', 'closed');--> statement-breakpoint
CREATE TABLE "business_amenities" (
	"business_id" uuid NOT NULL,
	"amenity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_amenities_pk" PRIMARY KEY("business_id","amenity_id")
);
--> statement-breakpoint
CREATE TABLE "business_categories" (
	"business_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_categories_pk" PRIMARY KEY("business_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_alt" text,
	"description" text,
	"city_id" uuid NOT NULL,
	"neighborhood_id" uuid,
	"primary_category_id" uuid NOT NULL,
	"address" text NOT NULL,
	"location" "geography(Point, 4326)" NOT NULL,
	"price_level" smallint,
	"phone" text,
	"whatsapp" text,
	"telegram" text,
	"instagram" text,
	"website" text,
	"email" text,
	"status" "business_status" DEFAULT 'pending' NOT NULL,
	"owner_id" uuid,
	"created_by" uuid,
	"is_claimed" boolean DEFAULT false NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"avg_rating" numeric(3, 2) DEFAULT '0' NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"cover_media_id" uuid,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"rejection_reason" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "businesses_slug_unique" UNIQUE("slug"),
	CONSTRAINT "businesses_avg_rating_range" CHECK ("businesses"."avg_rating" between 0 and 5),
	CONSTRAINT "businesses_review_count_nonneg" CHECK ("businesses"."review_count" >= 0),
	CONSTRAINT "businesses_active_requires_published" CHECK ("businesses"."status" <> 'active' or "businesses"."published_at" is not null),
	CONSTRAINT "businesses_source_enum" CHECK ("businesses"."source" in ('manual', 'import'))
);
--> statement-breakpoint
ALTER TABLE "business_amenities" ADD CONSTRAINT "business_amenities_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_amenities" ADD CONSTRAINT "business_amenities_amenity_id_amenities_id_fk" FOREIGN KEY ("amenity_id") REFERENCES "public"."amenities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_categories" ADD CONSTRAINT "business_categories_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_categories" ADD CONSTRAINT "business_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_neighborhood_id_neighborhoods_id_fk" FOREIGN KEY ("neighborhood_id") REFERENCES "public"."neighborhoods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_primary_category_id_categories_id_fk" FOREIGN KEY ("primary_category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_cover_media_id_media_files_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_amenities_amenity_idx" ON "business_amenities" USING btree ("amenity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_categories_one_primary" ON "business_categories" USING btree ("business_id") WHERE "business_categories"."is_primary";--> statement-breakpoint
CREATE INDEX "business_categories_category_idx" ON "business_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "businesses_location_idx" ON "businesses" USING gist ("location");--> statement-breakpoint
CREATE INDEX "businesses_city_status_cat_idx" ON "businesses" USING btree ("city_id","status","primary_category_id");--> statement-breakpoint
CREATE INDEX "businesses_neighborhood_idx" ON "businesses" USING btree ("neighborhood_id");--> statement-breakpoint
CREATE INDEX "businesses_owner_idx" ON "businesses" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "businesses_status_created_idx" ON "businesses" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_active_city_rating_idx" ON "businesses" USING btree ("city_id","avg_rating" DESC NULLS LAST) WHERE status = 'active' and deleted_at is null;