/**
 * Runtime environment helpers shared by the Sevalla integration modules.
 *
 * Everything here reads `process.env` when it is called (at request or boot
 * time), never at build time, so one image can be promoted between
 * environments without a rebuild.
 */

/**
 * PostgreSQL connection string. Prefers `DATABASE_URL` (what `emdash migrate`
 * reads); falls back to the `DB_URL` key or the `DB_HOST`/`DB_PORT`/`DB_USER`/
 * `DB_PASSWORD`/`DB_NAME` keys that a Sevalla internal connection can add.
 */
export function databaseUrl(): string {
	const env = process.env;
	const url = env.DATABASE_URL || env.DB_URL || fromParts(env);
	if (!url) {
		throw new Error(
			"[sevalla] DATABASE_URL is not set. Add the Sevalla PostgreSQL database to this " +
				"application as an internal connection and expose its connection URL as " +
				"DATABASE_URL. See README.md.",
		);
	}
	return url;
}

function fromParts(env: NodeJS.ProcessEnv): string | undefined {
	const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = env;
	if (!DB_HOST || !DB_USER || !DB_NAME) return undefined;
	const auth = `${encodeURIComponent(DB_USER)}${DB_PASSWORD ? `:${encodeURIComponent(DB_PASSWORD)}` : ""}`;
	return `postgres://${auth}@${DB_HOST}:${DB_PORT || "5432"}/${encodeURIComponent(DB_NAME)}`;
}

export function intEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const value = Number.parseInt(raw, 10);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}
