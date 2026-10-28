// server/lib/restricted-dtu-summarize.js
//
// Plan + apply the summary-only migration for stored DTUs that hold
// restricted-outlet article text (the set counted by
// news-outlet-policy's countRestrictedFullTextDtus — the match here IS
// that function's per-DTU rule, restrictedFullTextHit, not a fork).
//
// For each matched DTU the `after` shape is enforceSummaryOnly's output
// (headline + Source:/Published:/Link: + a validated Concord summary when
// one exists) plus migration stamps in meta. A summary comes only from:
//   1. an already-stored Concord summary (news-summarizer store, or a DTU
//      field marked summaryBy:"concord") that passes validateConcordSummary
//      against the DTU's own outlet text;
//   2. a fresh summarizer run (the script's --summarize step queues the
//      pending items and runs runSummaryBatch, then re-plans);
//   3. otherwise NO summary line: meta.summaryPending = true and the item
//      is queued for a summary (queuePlanSummaries / the script).
// A truncated copy of the outlet's text is NEVER used as a summary.
//
// Idempotent: a migrated DTU no longer matches restrictedFullTextHit, so
// a second plan finds 0.

import { writeFileSync } from "node:fs";
import {
  restrictedFullTextHit,
  dtuTextFields,
  enforceSummaryOnly,
  validateConcordSummary,
} from "./news-outlet-policy.js";
import { summaryForItem, queueItemForSummary } from "./news-summarizer.js";

export function dtuTextChars(d) {
  return dtuTextFields(d).reduce((n, t) => n + String(t || "").length, 0);
}

function longestText(d) {
  return dtuTextFields(d).reduce((a, b) => (String(b).length > String(a).length ? b : a), "");
}

function storedSummary(title, url) {
  try { return summaryForItem(title, url); } catch { return null; }
}

function concordCandidates(d, getSummary, title, url) {
  const out = [];
  try {
    const s = typeof getSummary === "function" ? getSummary(title, url) : null;
    if (s) out.push(s);
  } catch { /* the summarizer store is optional */ }
  if (d?.summaryBy === "concord" && typeof d.summary === "string") out.push(d.summary);
  if (d?.meta?.summaryBy === "concord") {
    if (typeof d.meta?.summary === "string") out.push(d.meta.summary);
    if (typeof d.human?.summary === "string") out.push(d.human.summary);
    if (typeof d.data?.summary === "string") out.push(d.data.summary);
  }
  return out;
}

/**
 * Pure plan. Returns one entry per matched DTU:
 * { id, host, tier, url, title, summaryPending, before, after }.
 * `before` is the input object (never mutated); `after` is a fresh object.
 * @param {Iterable<object>} dtus
 * @param {{ getSummary?: (title:string, url:string) => string|null, now?: () => string }} [opts]
 */
export function planRestrictedSummaryOnly(dtus, { getSummary = storedSummary, now = () => new Date().toISOString() } = {}) {
  const plans = [];
  for (const d of dtus || []) {
    const hit = restrictedFullTextHit(d);
    if (!hit) continue;
    const title = String(d.title || "");
    const outletText = longestText(d);
    let summary = null;
    for (const candidate of concordCandidates(d, getSummary, title, hit.u)) {
      const v = validateConcordSummary(candidate, outletText);
      if (v.ok) { summary = v.summary; break; }
    }
    const enforced = enforceSummaryOnly(d, { concordSummary: summary });
    const after = {
      ...enforced,
      meta: {
        ...enforced.meta,
        summaryOnlyMigratedAt: now(),
        ...(summary ? {} : { summaryPending: true }),
      },
    };
    plans.push({
      id: String(d.id || ""),
      host: hit.host,
      tier: hit.tier,
      url: hit.u,
      title,
      summaryPending: !summary,
      before: d,
      after,
    });
  }
  return plans;
}

/** Queue every summary-pending plan item for a Concord summary. Returns how many were queued. */
export function queuePlanSummaries(plans, queue = queueItemForSummary) {
  let queued = 0;
  for (const p of plans || []) {
    if (!p.summaryPending) continue;
    try {
      if (queue({ title: p.title, url: p.url, description: longestText(p.before), source: "restricted-dtu-migration" })) queued++;
    } catch { /* queueing is best-effort */ }
  }
  return queued;
}

function defaultWriteBackup(backupPath, backup) {
  if (!backupPath) throw new Error("a backup path is required when applying");
  writeFileSync(backupPath, JSON.stringify(backup, null, 2), "utf8");
  return backupPath;
}

/**
 * Read dtu_store, plan, and (when apply) back up + rewrite the matched rows.
 * Dry-run writes nothing and needs no backup. Apply writes the backup of the
 * ORIGINAL row payloads BEFORE any update and refuses if that write fails;
 * the updates then run in a single transaction.
 * @returns {{dryRun:boolean, count:number, byHost:object, ids:string[],
 *   sample:Array<{id:string,title:string,beforeChars:number,afterChars:number}>,
 *   plans:Array, applied:number, backupPath?:string}}
 */
export function applyRestrictedSummaryOnly(db, {
  apply = false,
  backupPath = null,
  writeBackup = defaultWriteBackup,
  getSummary,
  now,
} = {}) {
  const rows = db.prepare("SELECT id, data, tags FROM dtu_store").all();
  const dtus = [];
  const rawById = new Map();
  for (const row of rows) {
    try {
      const d = JSON.parse(row.data);
      if (d && d.id) { dtus.push(d); rawById.set(String(row.id), row); }
    } catch { /* corrupt row stays untouched */ }
  }
  const plans = planRestrictedSummaryOnly(dtus, { getSummary, now });
  const byHost = {};
  for (const p of plans) byHost[p.host] = (byHost[p.host] || 0) + 1;
  const sample = plans.slice(0, 5).map((p) => ({
    id: p.id, title: p.title, beforeChars: dtuTextChars(p.before), afterChars: dtuTextChars(p.after),
  }));
  const base = { dryRun: !apply, count: plans.length, byHost, ids: plans.map((p) => p.id), sample, plans };
  if (!apply) return { ...base, applied: 0 };

  const backup = {
    createdAt: new Date().toISOString(),
    kind: "restricted-dtu-summary-only-backup",
    rows: plans.map((p) => {
      const row = rawById.get(p.id);
      return { id: p.id, data: row.data, tags: row.tags };
    }),
  };
  const writtenTo = writeBackup(backupPath, backup); // throws -> refuse before touching the DB

  const update = db.prepare("UPDATE dtu_store SET data = ?, tags = ?, updated_at = ? WHERE id = ?");
  const tx = db.transaction((items) => {
    let n = 0;
    for (const p of items) {
      update.run(
        JSON.stringify(p.after),
        JSON.stringify(Array.isArray(p.after.tags) ? p.after.tags : []),
        new Date().toISOString(),
        p.id,
      );
      n++;
    }
    return n;
  });
  const applied = tx(plans);
  return { ...base, applied, backupPath: writtenTo };
}

/** Write a backup's original rows back, byte-identical `data`/`tags`. One transaction. */
export function restoreRestrictedBackup(db, backup) {
  const rows = Array.isArray(backup?.rows) ? backup.rows : [];
  const update = db.prepare("UPDATE dtu_store SET data = ?, tags = ?, updated_at = ? WHERE id = ?");
  const exists = db.prepare("SELECT id FROM dtu_store WHERE id = ?");
  const tx = db.transaction((items) => {
    let n = 0;
    for (const r of items) {
      if (!r || typeof r.data !== "string") continue;
      if (!exists.get(r.id)) continue;
      update.run(r.data, r.tags, new Date().toISOString(), r.id);
      n++;
    }
    return n;
  });
  return { restored: tx(rows) };
}
