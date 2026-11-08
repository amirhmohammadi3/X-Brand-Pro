CREATE TABLE "business_menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" bigint,
	"photo_media_id" uuid,
	"is_available" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_menu_items_price_nonneg" CHECK ("business_menu_items"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "business_menu_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_menu_items" ADD CONSTRAINT "business_menu_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_menu_items" ADD CONSTRAINT "business_menu_items_section_id_business_menu_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."business_menu_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_menu_items" ADD CONSTRAINT "business_menu_items_photo_media_id_media_files_id_fk" FOREIGN KEY ("photo_media_id") REFERENCES "public"."media_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_menu_sections" ADD CONSTRAINT "business_menu_sections_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_menu_items_section_sort_idx" ON "business_menu_items" USING btree ("section_id","sort_order");--> statement-breakpoint
CREATE INDEX "business_menu_items_biz_idx" ON "business_menu_items" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "business_menu_sections_biz_sort_idx" ON "business_menu_sections" USING btree ("business_id","sort_order");