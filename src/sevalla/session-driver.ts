/**
 * Astro session driver backed by the managed PostgreSQL database.
 *
 * EmDash keeps signed-in users in the Astro session. On Node the default
 * session store is the local filesystem, which does not survive a redeploy and
 * is not shared between instances, so editors would be logged out on every
 * deploy and bounced between pods when the web process is scaled out. Storing
 * sessions in the same Postgres database keeps the container stateless and
 * needs no extra service.
 *
 * Implements the unstorage driver interface that Astro session drivers use.
 */

import { defineDriver } from "unstorage";

import { closePool, getPool } from "./pg";

interface SessionDriverOptions {
	/** Table that holds the sessions. Created on first use. */
	table?: string;
	/** Rows untouched for this many days are pruned. */
	pruneAfterDays?: number;
}

const TABLE_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;
/** Probability that a write also prunes stale rows (amortised cleanup). */
const PRUNE_PROBABILITY = 0.01;

export default defineDriver((options: SessionDriverOptions = {}) => {
	const table = options.table ?? "sevalla_astro_sessions";
	if (!TABLE_NAME_PATTERN.test(table)) {
		throw new Error(`[sevalla] Invalid session table name: ${table}`);
	}
	const pruneAfterDays = options.pruneAfterDays ?? 30;

	let ready: Promise<void> | undefined;

	async function query<R extends Record<string, unknown>>(text: string, values: unknown[] = []) {
		ready ??= getPool()
			.query(
				`CREATE TABLE IF NOT EXISTS ${table} (
					key text PRIMARY KEY,
					value text NOT NULL,
					updated_at timestamptz NOT NULL DEFAULT now()
				)`,
			)
			.then(() => undefined)
			.catch((error: unknown) => {
				ready = undefined;
				throw error;
			});
		await ready;
		return getPool().query<R>(text, values);
	}

	return {
		name: "sevalla-postgres-sessions",
		async hasItem(key) {
			const result = await query(`SELECT 1 FROM ${table} WHERE key = $1`, [key]);
			return (result.rowCount ?? 0) > 0;
		},
		async getItem(key) {
			const result = await query<{ value: string }>(
				`SELECT value FROM ${table} WHERE key = $1`,
				[key],
			);
			return result.rows[0]?.value ?? null;
		},
		async setItem(key, value) {
			await query(
				`INSERT INTO ${table} (key, value, updated_at) VALUES ($1, $2, now())
				 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
				[key, value],
			);
			if (Math.random() < PRUNE_PROBABILITY) {
				await query(
					`DELETE FROM ${table} WHERE updated_at < now() - make_interval(days => $1)`,
					[pruneAfterDays],
				);
			}
		},
		async removeItem(key) {
			await query(`DELETE FROM ${table} WHERE key = $1`, [key]);
		},
		async getKeys(base) {
			const result = await query<{ key: string }>(
				`SELECT key FROM ${table} WHERE key LIKE $1`,
				[`${(base ?? "").replaceAll(/[\\%_]/g, "\\$&")}%`],
			);
			return result.rows.map((row) => row.key);
		},
		async clear() {
			await query(`DELETE FROM ${table}`);
		},
		async dispose() {
			ready = undefined;
			await closePool();
		},
	};
});
