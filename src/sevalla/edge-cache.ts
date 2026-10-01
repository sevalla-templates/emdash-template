/**
 * Astro cache provider for Sevalla's Cloudflare-backed edge cache.
 *
 * - Pages that pass EmDash cache hints to `Astro.cache.set()` get a shared
 *   `Cache-Control` (`s-maxage` + `stale-while-revalidate`), so Sevalla's
 *   Edge Caching serves them from Cloudflare's network without touching Node.
 *   Routes that never call `Astro.cache.set()` (the admin, APIs, previews)
 *   get no shared caching from this provider.
 * - When an editor publishes, edits or deletes anything, EmDash calls
 *   `cache.invalidate()`, which purges the application's edge cache through
 *   the Sevalla API (see ./purge.ts).
 * - A response is never marked shareable when the request carried a session
 *   cookie or the response sets a cookie: themes may render signed-in details
 *   (the comment form prints the user's name and email), and those must not
 *   be stored for everyone.
 */

import type { CacheOptions, CacheProviderFactory } from "astro";
import { setConditionalHeaders } from "astro/cache/provider-utils";

import { intEnv } from "./env";
import { schedulePurge } from "./purge";

interface SevallaEdgeCacheConfig {
	/** Default edge TTL in seconds when a route sets no `maxAge`. */
	maxAge?: number;
	/** Default stale-while-revalidate window in seconds. */
	swr?: number;
	/** Request cookies that mark a personalised (never shared) response. */
	privateCookies?: string[];
}

const DEFAULT_PRIVATE_COOKIES = ["astro-session", "emdash-edit-mode"];

const sevallaEdgeCache: CacheProviderFactory<SevallaEdgeCacheConfig> = (config) => {
	const maxAge = intEnv("EDGE_CACHE_MAX_AGE", config?.maxAge ?? 3600);
	const swr = intEnv("EDGE_CACHE_SWR", config?.swr ?? 86_400);
	const privateCookies = config?.privateCookies ?? DEFAULT_PRIVATE_COOKIES;

	function isPersonalised(request: Request, response: Response): boolean {
		if (response.headers.has("set-cookie")) return true;
		const cookie = request.headers.get("cookie");
		if (!cookie) return false;
		return cookie
			.split(";")
			.some((pair) => privateCookies.includes(pair.split("=", 1)[0]?.trim() ?? ""));
	}

	return {
		name: "sevalla-edge-cache",

		setHeaders(options: CacheOptions) {
			const headers = new Headers();
			const ttl = options.maxAge ?? maxAge;
			if (ttl === 0) return headers;
			const stale = options.swr ?? swr;
			// Browsers revalidate every time (max-age=0); the edge keeps its copy
			// until the next purge or until s-maxage runs out.
			headers.set(
				"Cache-Control",
				`public, max-age=0, s-maxage=${ttl}${stale > 0 ? `, stale-while-revalidate=${stale}` : ""}`,
			);
			setConditionalHeaders(headers, options);
			return headers;
		},

		async onRequest({ request }, next) {
			const response = await next();
			const cacheControl = response.headers.get("cache-control") ?? "";
			if (cacheControl.includes("s-maxage=") && isPersonalised(request, response)) {
				response.headers.set("Cache-Control", "private, no-store");
			}
			return response;
		},

		async invalidate() {
			schedulePurge();
		},
	};
};

export default sevallaEdgeCache;
