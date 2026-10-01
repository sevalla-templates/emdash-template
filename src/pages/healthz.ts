import type { APIRoute } from "astro";

import { getPool } from "../sevalla/pg";

/**
 * Health probe for Sevalla's readiness / liveness checks.
 *
 * `GET /healthz` checks that the process serves requests (use it for the
 * liveness probe). `GET /healthz?db=1` also round-trips PostgreSQL, for a
 * readiness probe that keeps a pod out of rotation until the database is
 * reachable.
 */
export const GET: APIRoute = async ({ url }) => {
	const headers = { "Cache-Control": "no-store", "Content-Type": "application/json" };

	if (!url.searchParams.has("db")) {
		return new Response(JSON.stringify({ status: "ok" }), { headers });
	}

	try {
		await getPool().query("SELECT 1");
		return new Response(JSON.stringify({ status: "ok", db: "ok" }), { headers });
	} catch {
		return new Response(JSON.stringify({ status: "error", db: "unreachable" }), {
			status: 503,
			headers,
		});
	}
};
