#!/usr/bin/env node
/**
 * Apply EmDash core migrations non-interactively, for a Sevalla Job process
 * that runs "Before deployment" (start command: `npm run migrate`).
 *
 * `emdash migrate` refuses to apply without a TTY unless it is given the
 * fingerprint of the target database. In a release job the target is, by
 * definition, the DATABASE_URL injected into this app, so this script reads
 * the fingerprint from `--status` and passes it straight back.
 *
 * Without a Job, the web process applies pending migrations on first request
 * (EmDash's default `auto` mode), so this script is optional.
 */

import { spawnSync } from "node:child_process";

// Same fallbacks as src/sevalla/env.ts: `emdash migrate` only reads DATABASE_URL.
const { DB_URL, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
process.env.DATABASE_URL ||=
	DB_URL ||
	(DB_HOST && DB_USER && DB_NAME
		? `postgres://${encodeURIComponent(DB_USER)}${DB_PASSWORD ? `:${encodeURIComponent(DB_PASSWORD)}` : ""}@${DB_HOST}:${DB_PORT || "5432"}/${encodeURIComponent(DB_NAME)}`
		: "");

if (!process.env.DATABASE_URL) {
	console.error("[migrate] DATABASE_URL is not set.");
	process.exit(1);
}

function emdash(args, { capture = false } = {}) {
	const result = spawnSync("npx", ["--no-install", "emdash", "migrate", ...args], {
		encoding: "utf8",
		stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
	});
	if (result.error) throw result.error;
	return result;
}

const status = emdash(["--status", "--json"], { capture: true });
if (status.status !== 0) process.exit(status.status ?? 1);

const report = JSON.parse(
	status.stdout
		.split("\n")
		.filter((line) => line.startsWith("{"))
		.at(-1) ?? "{}",
);
const fingerprint = report.target?.fingerprint;
if (!fingerprint) {
	console.error("[migrate] Could not read the target fingerprint from `emdash migrate --status`.");
	process.exit(1);
}

console.log(`[migrate] Target: ${report.target.kind} ${report.target.label}`);
const apply = emdash(["--expected-target-fingerprint", fingerprint]);
process.exit(apply.status ?? 1);
