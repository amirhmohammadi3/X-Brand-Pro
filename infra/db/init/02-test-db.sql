-- 02-test-db.sql — create the test database with the same extensions.
-- Run automatically by the postgres image entrypoint on first boot only.
-- NOTE: must CREATE the database before \connect (otherwise \connect fails).

CREATE DATABASE app_test OWNER app;
\connect app_test

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
