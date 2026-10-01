/**
 * PostgreSQL runtime dialect for EmDash that reads its connection at runtime.
 *
 * EmDash serializes the options passed to `postgres({...})` into the build, so
 * `postgres({ connectionString: process.env.DATABASE_URL })` would either bake
 * the secret into the image or (in a secret-free Docker build) bake `undefined`.
 * This module is wired in as the adapter's runtime entrypoint instead, so the
 * image stays credential-free and Sevalla injects `DATABASE_URL` at boot.
 */

import { createDialect as createPostgresDialect } from "emdash/db/postgres";

import { databaseUrl } from "./env";

type PostgresConfig = Parameters<typeof createPostgresDialect>[0];

export function createDialect(config: PostgresConfig) {
	return createPostgresDialect({ ...config, connectionString: databaseUrl() });
}
