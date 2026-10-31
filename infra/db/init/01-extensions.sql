-- 01-extensions.sql — enable required extensions in the dev database.
-- Run automatically by the postgres image entrypoint on first boot only.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
