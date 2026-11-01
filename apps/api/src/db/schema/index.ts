/**
 * Schema barrel — the ONLY place drizzle-kit reads table definitions from.
 *
 * One file per domain is added by the prompt that owns that domain (e.g.
 * `users.ts` by B1.2, `businesses.ts` by B2.4) and re-exported here. Never
 * import a schema file from another module directly; import through this
 * barrel (or from `src/db/schema` when declaring a foreign key, as AGENTS.md
 * allows).
 */
export * from './settings.js';
export * from './sessions.js';
export * from './otp.js';
export * from './users.js';
export * from './oauth.js';
