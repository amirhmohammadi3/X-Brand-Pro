CREATE TABLE "favorite_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorite_items_note_len" CHECK ("favorite_items"."note" IS NULL OR char_length("favorite_items"."note") BETWEEN 1 AND 280)
);
--> statement-breakpoint
CREATE TABLE "favorite_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorite_lists_name_len" CHECK (char_length("favorite_lists"."name") BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "favorite_items" ADD CONSTRAINT "favorite_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_items" ADD CONSTRAINT "favorite_items_list_id_favorite_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."favorite_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_items" ADD CONSTRAINT "favorite_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_lists" ADD CONSTRAINT "favorite_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_items_one_per_user" ON "favorite_items" USING btree ("user_id","business_id");--> statement-breakpoint
CREATE INDEX "favorite_items_list_idx" ON "favorite_items" USING btree ("list_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "favorite_items_business_idx" ON "favorite_items" USING btree ("business_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_lists_one_default_per_user" ON "favorite_lists" USING btree ("user_id") WHERE "favorite_lists"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "favorite_lists_user_name_unq" ON "favorite_lists" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "favorite_lists_user_idx" ON "favorite_lists" USING btree ("is_default","user_id","created_at" DESC NULLS LAST,"id");