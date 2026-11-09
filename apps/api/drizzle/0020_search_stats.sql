CREATE TABLE "search_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"normalized_text" text NOT NULL,
	"text" text NOT NULL,
	"city_id" uuid,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_history_user_query_uniq" UNIQUE NULLS NOT DISTINCT("user_id","normalized_text","city_id")
);
--> statement-breakpoint
CREATE TABLE "search_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_text" text NOT NULL,
	"text" text NOT NULL,
	"city_id" uuid,
	"hits" integer DEFAULT 1 NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"last_searched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_queries_normalized_city_uniq" UNIQUE NULLS NOT DISTINCT("normalized_text","city_id")
);
--> statement-breakpoint
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_queries" ADD CONSTRAINT "search_queries_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_history_user_recent_idx" ON "search_history" USING btree ("user_id","searched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "search_queries_popular_idx" ON "search_queries" USING btree ("hits" DESC NULLS LAST,"last_searched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "search_queries_city_idx" ON "search_queries" USING btree ("city_id");