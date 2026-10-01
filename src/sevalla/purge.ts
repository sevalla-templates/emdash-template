/**
 * Purges Sevalla's edge cache (and CDN cache) for this application through
 * the Sevalla API.
 *
 * Sevalla purges the whole application cache at once, so bursts of content
 * changes are coalesced: the first change in a quiet period purges after a
 * short debounce, and anything arriving while a purge is in flight or within
 * the minimum interval triggers exactly one follow-up purge.
 *
 * The state lives on globalThis so the cache provider and the EmDash plugin
 * share one purger even if the bundler places them in different chunks.
 */

const PURGE_DEBOUNCE_MS = 1500;
const PURGE_MIN_INTERVAL_MS = 10_000;

interface PurgerState {
	timer: ReturnType<typeof setTimeout> | undefined;
	lastPurge: number;
	warned: boolean;
}

const STATE_KEY = Symbol.for("sevalla.edge-cache.purger");
const globalState = globalThis as typeof globalThis & { [STATE_KEY]?: PurgerState };
const state: PurgerState = (globalState[STATE_KEY] ??= {
	timer: undefined,
	lastPurge: 0,
	warned: false,
});

/** Schedule a purge of the application's edge cache. Never throws. */
export function schedulePurge(): void {
	if (state.timer) return;
	const wait = Math.max(PURGE_DEBOUNCE_MS, state.lastPurge + PURGE_MIN_INTERVAL_MS - Date.now());
	state.timer = setTimeout(() => void purge(), wait);
	state.timer.unref?.();
}

async function purge(): Promise<void> {
	state.timer = undefined;
	const appId = process.env.SEVALLA_APP_ID;
	// SEVALLA_API_TOKEN is the name the Sevalla CLI uses; accept either.
	const apiKey = process.env.SEVALLA_API_KEY || process.env.SEVALLA_API_TOKEN;
	if (!appId || !apiKey) {
		if (!state.warned) {
			state.warned = true;
			console.warn(
				"[sevalla] Content changed but SEVALLA_APP_ID / SEVALLA_API_KEY are not set, so the " +
					"edge cache was not purged. Cached pages update when their s-maxage expires.",
			);
		}
		return;
	}

	state.lastPurge = Date.now();
	const apiUrl = process.env.SEVALLA_API_URL ?? "https://api.sevalla.com/v3";
	try {
		const response = await fetch(
			`${apiUrl}/applications/${encodeURIComponent(appId)}/purge-cache`,
			{
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
				signal: AbortSignal.timeout(10_000),
			},
		);
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			console.error(
				`[sevalla] Edge cache purge failed: HTTP ${response.status} ${body.slice(0, 300)}`,
			);
			return;
		}
		console.info("[sevalla] Edge cache purge requested");
	} catch (error) {
		console.error("[sevalla] Edge cache purge failed:", error);
	}
}
