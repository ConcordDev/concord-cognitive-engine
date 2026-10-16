#!/usr/bin/env node
// Universal Silver phase 1: boot the server in-process (no port, throwaway DB
// and state, as tests/depth/_harness.js does), read the live registries and
// write the gap report.
//
//   node scripts/silver-registry-report.mjs            # writes audit/silver/{GAP_REPORT.md,summary.json}
//   node scripts/silver-registry-report.mjs --full     # also audit/silver/registry.json (every entry; large, not committed)
//
// Read-only with respect to the product: the boot uses a temporary database
// that is deleted afterwards.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const OUT = path.join(REPO, "audit", "silver");
const stamp = `${process.pid}-${Date.now()}`;
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.CONCORD_NO_LISTEN = "true";
process.env.DB_PATH = path.join(os.tmpdir(), `silver-registry-${stamp}.db`);
process.env.STATE_PATH = path.join(os.tmpdir(), `silver-registry-${stamp}.json`);

let t = null;
let code = 0;
try {
  t = (await import("../server.js")).__TEST__;
  const { buildSilverRegistry, collectLiveSources } = await import("../lib/silver/registry.js");
  const { renderGapReport } = await import("../lib/silver/report.js");
  const reg = buildSilverRegistry(await collectLiveSources());
  let head = null;
  try { head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(); } catch { head = null; }
  const generatedAt = new Date().toISOString();
  fs.mkdirSync(OUT, { recursive: true });
  let precisionSample = null;
  try { precisionSample = JSON.parse(fs.readFileSync(path.join(HERE, "..", "lib", "silver", "precision-sample.json"), "utf8")); } catch { precisionSample = null; }
  fs.writeFileSync(path.join(OUT, "GAP_REPORT.md"), `${renderGapReport(reg, { generatedAt, head, precisionSample })}\n`);
  fs.writeFileSync(path.join(OUT, "summary.json"), `${JSON.stringify({ generatedAt, head, contractVersion: reg.contractVersion, summary: reg.summary }, null, 1)}\n`);
  if (process.argv.includes("--full")) fs.writeFileSync(path.join(OUT, "registry.json"), JSON.stringify(reg));
  const s = reg.summary;
  console.log(`silver registry: ${s.total} entries over ${s.domains} domains; ${Object.entries(s.bySource).map(([k, v]) => `${k} ${v.count}`).join(", ")}; promotion candidates ${s.promotionCandidates}`);
} catch (e) {
  console.error(`silver registry report failed: ${e instanceof Error ? e.stack : e}`);
  code = 1;
} finally {
  try { await t?.terminateAllWorkersForTest?.(); } catch { /* best effort */ }
  try { t?.clearActiveTimersForTest?.(); } catch { /* best effort */ }
  for (const f of [process.env.DB_PATH, `${process.env.DB_PATH}-wal`, `${process.env.DB_PATH}-shm`, process.env.STATE_PATH, `${process.env.STATE_PATH}.tmp`]) {
    try { fs.rmSync(f, { force: true }); } catch { /* best effort */ }
  }
  process.exit(code);
}
