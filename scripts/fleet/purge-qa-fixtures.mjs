#!/usr/bin/env node
/**
 * purge-qa-fixtures.mjs — FIX-feed-007 identification pass (DRY-RUN ONLY).
 *
 * Founder ruling (DUTCH-DECISIONS-46, 2026-11-14): "purge QA fixture posts
 * from prod public feed (Dutch-approved; do via a reviewed script with
 * dry-run first)." This script is the dry-run half of that ruling. It
 * identifies the QA fixture posts in the canonical social store and reports
 * exactly what a purge would touch. It never modifies anything:
 *
 *   - the database is opened READ-ONLY (node:sqlite, readOnly: true);
 *   - the file contains no write statements of any kind — the only SQL in
 *     it is SELECT; verify by grepping this file for any write-statement
 *     keyword in capitals: the count is zero, this header included;
 *   - --apply exists only to refuse: it prints why and exits 2. The purge
 *     itself is a separate, separately-reviewed step that fires only on
 *     Ramaj's word after he has seen this dry run's output.
 *
 * DATA SHAPE (verified against the tree, 2026-11-14):
 *   - social_post_records (migration 482) is the canonical post store:
 *     id · user_id · content · privacy · created_at (TEXT) · payload_json
 *     (the full post object; carries username / displayName / title).
 *   - social_posts (migration 315) is the short mirror; a purge must account
 *     for both, so this pass reports how many selected ids appear there.
 *   - users (migration 001) maps id -> username when the payload has none.
 *
 * SELECTION CRITERIA (tiered for precision; a post is SELECTED when any
 * SELECT tier matches):
 *   Tier A — QA author. The resolved author handle (payload username, else
 *     the users table) matches, case-insensitively: prefix "zuko_qa",
 *     prefix "qa_sweep", or exactly "tester" — the fleet QA accounts of
 *     record (the ticket's walk account is zuko_qa_t1; qa_sweep_c/d are the
 *     sweep accounts). Extend at run time with --qa-handle / --qa-user-id.
 *   Tier B — fixture marker. The post's content or title contains one of
 *     the conservative phrases in FIXTURE_PHRASES (extend with --marker).
 *     The bare word "fixture" NEVER selects on its own: a sports post
 *     about a fixture is a real post and must survive.
 * FLAG-REVIEW (reported, NEVER selected — a human decides):
 *   - date anomalies: created_at, or any ISO date inside the payload, with
 *     year <= 2021 or >= 2040 (the ticket's 2020 / 2042 event fixtures),
 *     on posts no SELECT tier matched;
 *   - duplicate clusters: the same author posting identical content 3+
 *     times, among posts no SELECT tier matched.
 *
 * PRIVACY OF THE REPORT: content excerpts (<= 80 chars) are printed only
 * for SELECTED posts (fleet QA / marker text). Flag-review samples carry
 * id, author and reason only — never another user's words.
 *
 * USAGE:
 *   node scripts/fleet/purge-qa-fixtures.mjs --db /path/to/concord.db [--sample 25] [--json]
 *                                            [--qa-handle h]... [--qa-user-id id]... [--marker phrase]...
 * Exit codes: 0 dry run complete · 1 usage / IO error · 2 --apply refusal.
 */

import { DatabaseSync } from "node:sqlite";

const QA_HANDLE_PREFIXES = ["zuko_qa", "qa_sweep"];
const QA_HANDLE_EXACT = ["tester"];
const FIXTURE_PHRASES = [
  "qa fixture",
  "fixture post",
  "test fixture",
  "fixture test",
  "test post",
  "lorem ipsum",
  "sweep fixture",
];
const DATE_YEAR_MIN_OK = 2022; // years below this are anomalous
const DATE_YEAR_MAX_OK = 2039; // years above this are anomalous

function parseArgs(argv) {
  const args = { db: null, sample: 25, json: false, apply: false, qaHandles: [], qaUserIds: [], markers: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") args.db = argv[++i];
    else if (a === "--sample") args.sample = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (a === "--json") args.json = true;
    else if (a === "--apply") args.apply = true;
    else if (a === "--qa-handle") args.qaHandles.push(String(argv[++i] || "").toLowerCase());
    else if (a === "--qa-user-id") args.qaUserIds.push(String(argv[++i] || ""));
    else if (a === "--marker") args.markers.push(String(argv[++i] || "").toLowerCase());
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

function yearsIn(text) {
  const years = [];
  const re = /(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])/g;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) years.push(parseInt(m[1], 10));
  return years;
}

function yearOfCreatedAt(value) {
  if (value == null) return null;
  const s = String(value).trim();
  const iso = s.match(/^(20\d{2})-/);
  if (iso) return parseInt(iso[1], 10);
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) {
    const ms = n > 1e12 ? n : n * 1000;
    const y = new Date(ms).getUTCFullYear();
    if (y >= 2000 && y <= 2100) return y;
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("Usage: node purge-qa-fixtures.mjs --db <path> [--sample N] [--json] [--qa-handle h]... [--qa-user-id id]... [--marker phrase]...");
    return 0;
  }
  if (args.apply) {
    console.error("REFUSED: this script is the dry-run identification pass for FIX-feed-007 and never modifies the database. The purge is a separate reviewed step that fires only on Ramaj's word after he has seen the dry run. Re-run without --apply.");
    return 2;
  }
  if (!args.db) {
    console.error("error: --db <path> is required");
    return 1;
  }

  let db;
  try {
    db = new DatabaseSync(args.db, { readOnly: true });
  } catch (err) {
    console.error(`error: cannot open ${args.db} read-only: ${err.message}`);
    return 1;
  }

  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
  );
  if (!tables.has("social_post_records")) {
    console.error("error: social_post_records not found — this is not a Concord database at migration 482+.");
    return 1;
  }

  const userHandles = new Map();
  if (tables.has("users")) {
    try {
      for (const row of db.prepare("SELECT id, username FROM users").all()) {
        if (row.id && row.username) userHandles.set(String(row.id), String(row.username));
      }
    } catch { /* users table shape differs; payload usernames still apply */ }
  }

  const mirrorIds = new Set();
  if (tables.has("social_posts")) {
    for (const row of db.prepare("SELECT id FROM social_posts").all()) mirrorIds.add(String(row.id));
  }

  const qaHandles = new Set([...QA_HANDLE_EXACT, ...args.qaHandles]);
  const qaUserIds = new Set(args.qaUserIds);
  const phrases = [...FIXTURE_PHRASES, ...args.markers].filter(Boolean);

  const isQaHandle = (handle) => {
    if (!handle) return false;
    const h = String(handle).toLowerCase();
    return qaHandles.has(h) || QA_HANDLE_PREFIXES.some((p) => h.startsWith(p));
  };

  const rows = db.prepare("SELECT id, user_id, content, privacy, created_at, payload_json FROM social_post_records").all();

  const selected = [];
  const reviewDates = [];
  const unselectedForDupes = [];
  let unparseable = 0;

  for (const row of rows) {
    let payload = null;
    try { payload = row.payload_json ? JSON.parse(row.payload_json) : null; } catch { unparseable++; }
    const handle = payload?.username || userHandles.get(String(row.user_id)) || null;
    const content = String(row.content || payload?.content || payload?.body || "");
    const title = String(payload?.title || "");
    const hay = `${title}\n${content}`.toLowerCase();

    const tiers = [];
    if (isQaHandle(handle) || qaUserIds.has(String(row.user_id))) tiers.push("A:qa-author");
    if (phrases.some((p) => hay.includes(p))) tiers.push("B:fixture-marker");

    if (tiers.length > 0) {
      selected.push({
        id: String(row.id),
        author: handle || String(row.user_id || "unknown"),
        created_at: row.created_at,
        privacy: row.privacy || payload?.privacy || "public",
        tiers,
        excerpt: content.replace(/\s+/g, " ").slice(0, 80),
        inMirror: mirrorIds.has(String(row.id)),
      });
      continue;
    }

    const years = [...new Set([yearOfCreatedAt(row.created_at), ...yearsIn(row.payload_json)].filter((y) => y != null))];
    if (years.some((y) => y < DATE_YEAR_MIN_OK || y > DATE_YEAR_MAX_OK)) {
      reviewDates.push({ id: String(row.id), author: handle || String(row.user_id || "unknown"), years });
    }
    unselectedForDupes.push({ id: String(row.id), author: handle || String(row.user_id || "unknown"), key: `${row.user_id}\n${content.trim().toLowerCase()}` });
  }

  const dupeGroups = new Map();
  for (const p of unselectedForDupes) {
    if (!p.key.endsWith("\n") && p.key.split("\n")[1]) {
      if (!dupeGroups.has(p.key)) dupeGroups.set(p.key, []);
      dupeGroups.get(p.key).push(p);
    }
  }
  const reviewDupes = [...dupeGroups.values()].filter((g) => g.length >= 3);

  const tierA = selected.filter((s) => s.tiers.includes("A:qa-author")).length;
  const tierB = selected.filter((s) => s.tiers.includes("B:fixture-marker")).length;
  const tierBoth = selected.filter((s) => s.tiers.length === 2).length;
  const privacyBreakdown = {};
  for (const s of selected) privacyBreakdown[s.privacy] = (privacyBreakdown[s.privacy] || 0) + 1;
  const mirrorCount = selected.filter((s) => s.inMirror).length;
  const dupePosts = reviewDupes.reduce((n, g) => n + g.length, 0);

  const report = {
    mode: "DRY-RUN (read-only; nothing modified)",
    db: args.db,
    scanned: rows.length,
    unparseablePayloads: unparseable,
    selected: selected.length,
    tierA_qaAuthor: tierA,
    tierB_fixtureMarker: tierB,
    tierBoth: tierBoth,
    selectedPrivacy: privacyBreakdown,
    selectedAlsoInSocialPostsMirror: mirrorCount,
    flagReview: {
      dateAnomalies: reviewDates.length,
      duplicateGroups: reviewDupes.length,
      duplicatePosts: dupePosts,
    },
    sampleSelected: selected.slice(0, args.sample),
    sampleDateAnomalies: reviewDates.slice(0, args.sample).map((r) => ({ id: r.id, author: r.author, years: r.years })),
    sampleDuplicateGroups: reviewDupes.slice(0, args.sample).map((g) => ({ author: g[0].author, count: g.length, ids: g.map((p) => p.id) })),
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`FIX-feed-007 dry run — ${report.mode}`);
    console.log(`db: ${report.db}`);
    console.log(`posts scanned: ${report.scanned} (unparseable payloads: ${report.unparseablePayloads})`);
    console.log(`SELECTED for purge: ${report.selected}  [tier A qa-author: ${tierA} · tier B fixture-marker: ${tierB} · both: ${tierBoth}]`);
    console.log(`selected privacy: ${JSON.stringify(privacyBreakdown)} · also in social_posts mirror: ${mirrorCount}`);
    console.log(`FLAG-REVIEW (never selected): date anomalies ${report.flagReview.dateAnomalies} · duplicate groups ${report.flagReview.duplicateGroups} (${dupePosts} posts)`);
    console.log(`\nsample selected (up to ${args.sample}):`);
    for (const s of report.sampleSelected) console.log(`  ${s.id} · @${s.author} · ${s.created_at} · ${s.tiers.join("+")} · "${s.excerpt}"`);
    console.log(`\nsample date anomalies (id · author · years):`);
    for (const r of report.sampleDateAnomalies) console.log(`  ${r.id} · @${r.author} · ${r.years.join(",")}`);
    console.log(`\nsample duplicate groups (author · count · ids):`);
    for (const g of report.sampleDuplicateGroups) console.log(`  @${g.author} · x${g.count} · ${g.ids.join(", ")}`);
    console.log(`\nNothing was modified. The purge fires only on Ramaj's word, as a separate reviewed step.`);
  }
  db.close();
  return 0;
}

process.exit(main());
