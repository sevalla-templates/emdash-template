/**
 * Production entrypoint: Astro's standalone Node handler behind a header guard.
 *
 * Sevalla (via Cloudflare) passes a client-supplied `X-Forwarded-Host` through
 * unchanged, and Astro prefers it over `Host` when building `Astro.url`. A
 * request with `X-Forwarded-Host: evil.example` would then render canonical,
 * Open Graph and media links pointing at evil.example, and with Edge Caching
 * that response would be served to every visitor. `Host` is safe: Cloudflare
 * routes on it, so it is always one of this app's domains. Dropping the
 * forwarded host makes Astro fall back to it.
 *
 * The scheme still comes from `X-Forwarded-Proto`, which Sevalla sets itself.
 */

import http from "node:http";

process.env.ASTRO_NODE_AUTOSTART = "disabled";
const { handler } = await import("./dist/server/entry.mjs");

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

const server = http.createServer((req, res) => {
	delete req.headers["x-forwarded-host"];
	handler(req, res);
});

server.listen(port, host, () => {
	console.log(`[server] Listening on http://${host}:${port}`);
});

// Finish in-flight requests when Sevalla replaces the pod during a deploy.
for (const signal of ["SIGTERM", "SIGINT"]) {
	process.once(signal, () => {
		console.log(`[server] ${signal} received, shutting down`);
		server.close(() => process.exit(0));
		server.closeIdleConnections();
		setTimeout(() => process.exit(0), 10_000).unref();
	});
}
