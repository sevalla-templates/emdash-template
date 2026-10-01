/**
 * EmDash plugin that purges Sevalla's edge cache when content goes live or
 * comes down outside an editor request.
 *
 * Admin and API writes already invalidate through the Astro cache provider
 * (./edge-cache.ts). Scheduled publishing, however, runs on EmDash's
 * in-process timer with no request, so nothing would purge the edge cache and
 * a scheduled post would only appear once cached pages expire. These hooks
 * cover that path; overlapping purges are coalesced by ./purge.ts.
 */

import { definePlugin } from "emdash";

import { schedulePurge } from "./purge";

export const SEVALLA_PLUGIN_ID = "sevalla-edge-cache";
export const SEVALLA_PLUGIN_VERSION = "1.0.0";

export function createPlugin() {
	return definePlugin({
		id: SEVALLA_PLUGIN_ID,
		version: SEVALLA_PLUGIN_VERSION,
		capabilities: ["content:read"],
		hooks: {
			"content:afterPublish": async () => {
				schedulePurge();
			},
			"content:afterUnpublish": async () => {
				schedulePurge();
			},
		},
	});
}

export default createPlugin;
