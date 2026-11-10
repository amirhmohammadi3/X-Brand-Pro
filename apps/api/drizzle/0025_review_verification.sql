ALTER TABLE "reviews" ADD COLUMN "receipt_media_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "checkin_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "checkin_lat" double precision;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "checkin_lng" double precision;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_receipt_media_id_media_files_id_fk" FOREIGN KEY ("receipt_media_id") REFERENCES "public"."media_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_checkin_tri_state" CHECK (("reviews"."checkin_at" IS NULL) = ("reviews"."checkin_lat" IS NULL) AND ("reviews"."checkin_lat" IS NULL) = ("reviews"."checkin_lng" IS NULL));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_checkin_lat_range" CHECK ("reviews"."checkin_lat" IS NULL OR ("reviews"."checkin_lat" BETWEEN -90 AND 90));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_checkin_lng_range" CHECK ("reviews"."checkin_lng" IS NULL OR ("reviews"."checkin_lng" BETWEEN -180 AND 180));