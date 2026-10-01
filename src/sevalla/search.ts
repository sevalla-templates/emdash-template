/**
 * PostgreSQL full-text search for the blog.
 *
 * EmDash's built-in `search()` uses SQLite FTS5 and returns nothing on
 * PostgreSQL, so the search page and header box use this instead. It ranks
 * published posts by title (A), excerpt (B) and body text (C), where the body
 * text is pulled out of the Portable Text JSON (`$.**.text`) so markup keys
 * never match.
 *
 * Good for blogs with thousands of posts. For much larger sites, add an
 * expression GIN index or a generated tsvector column (see README).
 */

import { getPool } from "./pg";

export interface SearchResult {
	id: string;
	slug: string | null;
	title: string;
	/** HTML-safe snippet; matched terms are wrapped in <mark>. */
	snippet: string;
}

const TS_CONFIG_PATTERN = /^[a-z_]+$/;
const START = "\u0002";
const STOP = "\u0003";

function textSearchConfig(): string {
	const config = process.env.SEARCH_TS_CONFIG ?? "english";
	return TS_CONFIG_PATTERN.test(config) ? config : "english";
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function highlight(raw: string): string {
	return escapeHtml(raw).replaceAll(START, "<mark>").replaceAll(STOP, "</mark>");
}

export async function searchPosts(query: string, limit = 30): Promise<SearchResult[]> {
	const terms = query.trim().slice(0, 200);
	if (!terms) return [];

	const { rows } = await getPool().query<{
		id: string;
		slug: string | null;
		title: string;
		snippet: string | null;
	}>(
		`WITH q AS (SELECT websearch_to_tsquery($1::regconfig, $2) AS query)
		 SELECT p.id, p.slug, p.title,
		        ts_headline($1::regconfig, concat_ws(' ', p.excerpt, body.text), q.query,
		          'StartSel=${START}, StopSel=${STOP}, MaxWords=30, MinWords=12, MaxFragments=1')
		          AS snippet
		 FROM ec_posts p
		 CROSS JOIN q
		 CROSS JOIN LATERAL (
		   SELECT string_agg(t #>> '{}', ' ') AS text
		   FROM jsonb_path_query(coalesce(p.content::jsonb, '[]'::jsonb), 'strict $.**.text') AS t
		 ) body
		 CROSS JOIN LATERAL (
		   SELECT setweight(to_tsvector($1::regconfig, coalesce(p.title, '')), 'A')
		       || setweight(to_tsvector($1::regconfig, coalesce(p.excerpt, '')), 'B')
		       || setweight(to_tsvector($1::regconfig, coalesce(body.text, '')), 'C') AS doc
		 ) d
		 WHERE p.status = 'published'
		   AND p.deleted_at IS NULL
		   AND d.doc @@ q.query
		 ORDER BY ts_rank(d.doc, q.query) DESC, p.published_at DESC
		 LIMIT $3`,
		[textSearchConfig(), terms, limit],
	);

	return rows.map((row) => ({
		id: row.id,
		slug: row.slug,
		title: row.title,
		snippet: row.snippet ? highlight(row.snippet) : "",
	}));
}
