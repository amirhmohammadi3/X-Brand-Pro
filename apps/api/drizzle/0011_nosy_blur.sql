CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" jsonb NOT NULL,
	"center" "geography(Point, 4326)" NOT NULL,
	"bbox" jsonb,
	"timezone" text DEFAULT 'Asia/Tehran' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cities_slug_unique" UNIQUE("slug"),
	CONSTRAINT "cities_name_has_fa" CHECK ("cities"."name" ? 'fa')
);
--> statement-breakpoint
CREATE TABLE "neighborhoods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" jsonb NOT NULL,
	"center" "geography(Point, 4326)" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "neighborhoods_city_slug_unique" UNIQUE("city_id","slug"),
	CONSTRAINT "neighborhoods_name_has_fa" CHECK ("neighborhoods"."name" ? 'fa')
);
--> statement-breakpoint
ALTER TABLE "neighborhoods" ADD CONSTRAINT "neighborhoods_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cities_center_idx" ON "cities" USING gist ("center");--> statement-breakpoint
CREATE INDEX "neighborhoods_center_idx" ON "neighborhoods" USING gist ("center");