CREATE TYPE "public"."media_kind" AS ENUM('avatar', 'business_photo', 'review_photo', 'menu_photo', 'claim_document', 'message_attachment', 'verification_receipt');--> statement-breakpoint
CREATE TABLE "media_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"kind" "media_kind" NOT NULL,
	"key" text NOT NULL,
	"thumb_key" text,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"attached_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "media_files_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_media_id" uuid;--> statement-breakpoint
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_files_owner_created_idx" ON "media_files" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "media_files_unattached_idx" ON "media_files" USING btree ("attached_at") WHERE attached_at is null;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_media_id_media_files_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media_files"("id") ON DELETE set null ON UPDATE no action;