/**
 * Small PostgreSQL pool for the template's own queries (sessions, search,
 * health checks). EmDash keeps its own pool for content queries.
 */

import pg from "pg";

import { databaseUrl } from "./env";

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
	if (!pool) {
		pool = new pg.Pool({
			connectionString: databaseUrl(),
			max: 3,
			connectionTimeoutMillis: 10_000,
		});
		pool.on("error", (error) => {
			console.error(`[sevalla] PostgreSQL idle client error: ${error.message}`);
		});
	}
	return pool;
}

export async function closePool(): Promise<void> {
	await pool?.end();
	pool = undefined;
}
