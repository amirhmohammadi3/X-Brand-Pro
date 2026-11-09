ALTER TABLE "cities" ADD COLUMN "name_fa" text GENERATED ALWAYS AS (name ->> 'fa') STORED;--> statement-breakpoint
ALTER TABLE "neighborhoods" ADD COLUMN "name_fa" text GENERATED ALWAYS AS (name ->> 'fa') STORED;--> statement-breakpoint
ALTER TABLE "amenities" ADD COLUMN "name_fa" text GENERATED ALWAYS AS (name ->> 'fa') STORED;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "name_fa" text GENERATED ALWAYS AS (name ->> 'fa') STORED;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "name_normalized" text;--> statement-breakpoint
UPDATE "businesses" SET "name_normalized" = "name" WHERE "name_normalized" IS NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce(name_normalized, name)), 'A')
      || setweight(to_tsvector('simple', coalesce(name_alt, '')), 'B')
      || setweight(to_tsvector('simple', coalesce(description, '')), 'C')
      || to_tsvector('simple', coalesce(address, ''))
    ) STORED;--> statement-breakpoint
CREATE INDEX "cities_name_fa_trgm_idx" ON "cities" USING gin ("name_fa" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "neighborhoods_name_fa_trgm_idx" ON "neighborhoods" USING gin ("name_fa" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "amenities_name_fa_trgm_idx" ON "amenities" USING gin ("name_fa" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "categories_name_fa_trgm_idx" ON "categories" USING gin ("name_fa" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "businesses_search_vector_idx" ON "businesses" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "businesses_name_trgm_idx" ON "businesses" USING gin ("name_normalized" gin_trgm_ops);