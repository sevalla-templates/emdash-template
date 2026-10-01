import { fileURLToPath } from "node:url";

import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig, fontProviders } from "astro/config";
import emdash, { s3 } from "emdash/astro";
import { postgres } from "emdash/db";

// Local development: load .env into process.env (the Sevalla runtime injects
// real environment variables instead, and the Docker image ships no .env).
try {
	process.loadEnvFile?.(".env");
} catch {
	// No .env file — fine.
}

const sevalla = (file) => fileURLToPath(new URL(`./src/sevalla/${file}`, import.meta.url));

export default defineConfig({
	output: "server",
	adapter: node({
		mode: "standalone",
	}),

	// Sevalla terminates TLS at Cloudflare and forwards over HTTP. Trusting the
	// forwarded proto/host lets Astro (and EmDash's CSRF/origin checks) see the
	// public https:// URL instead of http://localhost:8080.
	security: {
		allowedDomains: [{ protocol: "https" }],
	},

	// Shared session store in Postgres (see src/sevalla/session-driver.ts).
	session: {
		driver: { entrypoint: sevalla("session-driver.ts") },
	},

	// Sevalla Edge Caching for rendered pages, purged when content changes
	// (see src/sevalla/edge-cache.ts). TTLs can be tuned at runtime with
	// EDGE_CACHE_MAX_AGE / EDGE_CACHE_SWR.
	cache: {
		provider: {
			name: "sevalla-edge-cache",
			entrypoint: sevalla("edge-cache.ts"),
			config: { maxAge: 3600, swr: 86400 },
		},
	},

	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			// Sevalla managed PostgreSQL. The connection string is read from
			// DATABASE_URL at runtime by src/sevalla/database.ts, so the build
			// needs no credentials. `emdash migrate` reads the same variable.
			database: {
				...postgres({ pool: { max: 10, connectionTimeoutMillis: 10_000 } }),
				entrypoint: sevalla("database.ts"),
			},
			// Sevalla Object Storage (S3-compatible). Every field is resolved from
			// the S3_* environment variables when the server starts.
			storage: s3(),
			// Public HTML is identical for every visitor, so the edge cache stays
			// effective; editors get an "Edit" pill that loads a fresh, uncached view.
			toolbar: "client",
			// Client IP for auth rate limits and comment throttling. Cloudflare
			// (in front of every Sevalla app) sets CF-Connecting-IP.
			trustedProxyHeaders: ["cf-connecting-ip", "x-real-ip"],
			// Purges the edge cache when scheduled posts go live (src/sevalla/plugin.ts).
			plugins: [
				{
					id: "sevalla-edge-cache",
					version: "1.0.0",
					format: "native",
					entrypoint: sevalla("plugin.ts"),
				},
			],
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-body",
			weights: [400, 500, 600, 700],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500],
			fallbacks: ["monospace"],
		},
	],
	devToolbar: { enabled: false },
});
