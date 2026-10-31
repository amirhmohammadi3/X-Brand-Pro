# DATA MODEL

PostgreSQL with PostGIS, pg_trgm, unaccent. Schema files live in `apps/api/src/db/schema/<domain>.ts`; migrations in `apps/api/drizzle`. Every executing prompt that changes the schema appends or updates its tables here.

Block format (one per table):

```text
### <table_name>
- Module: <module>             - Prompt: <ID>
- Purpose: <one line>
- Columns of note: <name type constraint meaning>, one per line
- Indexes: <name: columns, type (btree/gist/gin/unique), reason>
- Constraints: <checks, foreign keys with on delete behavior>
- Retention: <soft delete, purge job, or keep forever>
```

## Extensions and conventions

- Extensions: postgis, pg_trgm, unaccent (created in migration 0000 and in `infra/db/init`).
- Conventions are in AGENTS.md section 6 (uuid primary keys, UTC timestamptz, money in Rials as bigint, jsonb localized text, geography(Point,4326)).

## Tables

(none yet; the first entries are added by prompt B0.2 and B1.1)
