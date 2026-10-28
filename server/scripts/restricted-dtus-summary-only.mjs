#!/usr/bin/env node
/**
 * Rewrite stored DTUs that hold restricted-outlet article text into the
 * summary-only shape (headline + Source:/Published:/Link: + a validated
 * Concord summary when one exists). The match is the read-only audit rule
 * in lib/news-outlet-policy.js (countRestrictedFullTextDtus), so the set
 * migrated here is exactly the set the audit counts.
 *
 * Run only with the backend stopped. The live server keeps DTUs in memory
 * and would overwrite the rows on its next save.
 *
 * Dry-run by default: prints {dryRun, count, byHost, ids, sample} and
 * writes nothing. `--apply` first writes a JSON backup of every matched
 * row's original data/tags, then updates the rows in one transaction;
 * it requires CONCORD_ADMIN_CONFIRM=1. `--restore <backup.json>` writes
 * the originals back (also requires CONCORD_ADMIN_CONFIRM=1).
 * `--summarize` (with --apply) first queues the summary-pending DTUs and
 * runs one news-summarizer batch against the utility brain so stored
 * Concord summaries can be picked up; anything still without a validated
 * summary is migrated with meta.summaryPending = true instead.
 * Idempotent: a second run finds 0.
 *
 *   node server/scripts/restricted-dtus-summary-only.mjs
 *   CONCORD_ADMIN_CONFIRM=1 node server/scripts/restricted-dtus-summary-only.mjs --apply
 *   CONCORD_ADMIN_CONFIRM=1 node server/scripts/restricted-dtus-summary-only.mjs --apply --summarize --max 48
 *   CONCORD_ADMIN_CONFIRM=1 node server/scripts/restricted-dtus-summary-only.mjs --restore ./restricted-dtu-backup-20261028-0900.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  planRestrictedSummaryOnly,
  queuePlanSummaries,
  applyRestrictedSummaryOnly,
  restoreRestrictedBackup,
} from "../lib/restricted-dtu-summarize.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const summarize = args.includes("--summarize");
const restoreIdx = args.indexOf("--restore");
const restorePath = restoreIdx >= 0 ? args[restoreIdx + 1] : null;
const backupIdx = args.indexOf("--backup");
const maxIdx = args.indexOf("--max");
const maxSummarize = maxIdx >= 0 ? Math.max(1, Number(args[maxIdx + 1]) || 48) : 48;

if ((apply || restorePath) && process.env.CONCORD_ADMIN_CONFIRM !== "1") {
  console.error("Refusing to write without CONCORD_ADMIN_CONFIRM=1 (admin-only). Dry-run is the default.");
  process.exit(2);
}
if (restorePath && apply) {
  console.error("Pass either --apply or --restore, not both.");
  process.exit(2);
}

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};
const backupPath = backupIdx >= 0 ? args[backupIdx + 1] : `./restricted-dtu-backup-${stamp()}.json`;

const { default: Database } = await import("better-sqlite3");
const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(here, "..", "data", "concord.db");
const db = new Database(dbPath, { readonly: !(apply || restorePath) });
try {
  if (restorePath) {
    const backup = JSON.parse(fs.readFileSync(restorePath, "utf8"));
    const result = restoreRestrictedBackup(db, backup);
    console.log(JSON.stringify({ restored: result.restored, from: restorePath, dbPath }));
  } else {
    let summarizeReport = null;
    if (summarize) {
      // Pre-plan to find the pending set, queue it, and run one batch.
      // The apply step re-plans afterwards, so summaries stored by the
      // batch are picked up; anything still pending migrates without a
      // summary line and keeps meta.summaryPending.
      const rows = db.prepare("SELECT id, data FROM dtu_store").all();
      const dtus = [];
      for (const row of rows) {
        try { const d = JSON.parse(row.data); if (d && d.id) dtus.push(d); } catch { /* skip corrupt */ }
      }
      const pending = planRestrictedSummaryOnly(dtus).filter((p) => p.summaryPending).slice(0, maxSummarize);
      const queued = queuePlanSummaries(pending);
      const { runSummaryBatch } = await import("../lib/news-summarizer.js");
      const { BRAIN_CONFIG } = await import("../lib/brain-config.js");
      const util = BRAIN_CONFIG?.brains?.utility || BRAIN_CONFIG?.utility || {};
      const base = String(util.url || "http://localhost:11434").replace(/\/+$/, "");
      const model = util.model || "qwen2.5:3b";
      const llm = async (prompt, { system } = {}) => {
        const res = await fetch(`${base}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            think: false,
            messages: [
              ...(system ? [{ role: "system", content: system }] : []),
              { role: "user", content: prompt },
            ],
          }),
          signal: AbortSignal.timeout(60_000),
        });
        const json = await res.json().catch(() => ({}));
        return json?.message?.content || "";
      };
      const ready = async () => {
        try { const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5_000) }); return r.ok; }
        catch { return false; }
      };
      const batch = await runSummaryBatch({ llm, ready, max: pending.length });
      summarizeReport = { queued, attempted: batch.attempted, stored: batch.stored, rejected: batch.rejected, reason: batch.reason };
    }
    const result = applyRestrictedSummaryOnly(db, { apply, backupPath });
    console.log(JSON.stringify({
      dryRun: result.dryRun,
      count: result.count,
      byHost: result.byHost,
      ids: result.ids,
      sample: result.sample,
      ...(apply ? { applied: result.applied, backupPath: result.backupPath } : {}),
      ...(summarizeReport ? { summarize: summarizeReport } : {}),
      dbPath,
    }));
  }
} finally {
  db.close();
}
