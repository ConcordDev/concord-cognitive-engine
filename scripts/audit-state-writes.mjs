#!/usr/bin/env node
// scripts/audit-state-writes.mjs
//
// Concurrency Refactor — STATE-write audit for a multi-process macro-POST
// cluster. Enumerates every `STATE.<key>` and `_moduleLevelVar` mutation in
// server.js, classifies the enclosing scope (HTTP route / macro handler /
// heartbeat / boot / helper), and checks whether a SQLite write-through sits
// in the same function body.
//
// Output: audit/concurrency/state-write-audit.json  (+ a markdown summary on
// stdout). READ-ONLY — never touches the running system.
//
// Run: node scripts/audit-state-writes.mjs

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "server", "server.js");
const src = readFileSync(SERVER, "utf8");
const lines = src.split("\n");

// --- 1. enumerate STATE.<key> keys ------------------------------------------
const stateKeys = new Set();
for (const m of src.matchAll(/\bSTATE\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) stateKeys.add(m[1]);
// drop obvious method calls that aren't state buckets
for (const noise of ["get", "set", "delete", "has", "clear", "forEach", "keys", "values", "entries", "size"]) stateKeys.delete(noise);

// --- 2. mutation detector --------------------------------------------------
const MUT = /\bSTATE\.([a-zA-Z_][a-zA-Z0-9_]*)(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*\s*(?:=(?!=)|\.(set|push|delete|clear|unshift|splice|pop|shift|add)\s*\()/;

// --- 3. crude enclosing-scope classifier --------------------------------
// Walk backwards from a line to find the nearest function/route signature.
function classifyScope(lineIdx) {
  for (let i = lineIdx; i >= 0 && i > lineIdx - 400; i--) {
    const l = lines[i];
    if (/\b(app|router)\.(get|post|put|delete|patch|all)\s*\(/.test(l)) return { kind: "http-route", at: i + 1, sig: l.trim().slice(0, 120) };
    if (/\bregister(LensAction)?\s*\(\s*["'`]/.test(l)) return { kind: "macro", at: i + 1, sig: l.trim().slice(0, 120) };
    if (/\bregisterHeartbeat\s*\(\s*["'`]/.test(l)) return { kind: "heartbeat", at: i + 1, sig: l.trim().slice(0, 120) };
    if (/\bfunction\s+governorTick\b|\basync function governorTick\b/.test(l)) return { kind: "heartbeat", at: i + 1, sig: "governorTick" };
    if (/\bfunction\s+(seed|boot|init|load)[A-Z]/.test(l)) return { kind: "boot", at: i + 1, sig: l.trim().slice(0, 120) };
  }
  return { kind: "helper/unknown", at: null, sig: null };
}

// does the enclosing ~120 lines after the scope start contain a SQLite write?
function hasWriteThroughNear(lineIdx) {
  const from = Math.max(0, lineIdx - 60), to = Math.min(lines.length, lineIdx + 60);
  const chunk = lines.slice(from, to).join("\n");
  return /\bdb\.(prepare|exec|transaction)\b|\.run\(|persist[A-Z]|writeThrough|saveToSQLite|upsert/.test(chunk);
}

// --- 4. collect ----------------------------------------------------------
const findings = {};
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(MUT);
  if (!m) continue;
  const key = m[1];
  if (["get", "set", "delete", "has"].includes(key)) continue;
  const scope = classifyScope(i);
  const wt = hasWriteThroughNear(i);
  (findings[key] ||= []).push({ line: i + 1, code: lines[i].trim().slice(0, 140), scope: scope.kind, scopeAt: scope.at, writeThroughNear: wt });
}

// --- 5. classify each key ----------------------------------------------
const KNOWN = {
  dtus: "SAFE-ish — dtu_store write-through (Phase 3) + Rust read sidecar. Verify every STATE.dtus.set has a persist.",
  shadowDtus: "PROCESS-LOCAL — LRU-capped, not persisted. Shadow tier is internal; per-process divergence tolerable but a cluster loses shadows on the wrong node.",
  lensArtifacts: "SAFE-ish — lens_artifacts write-through exists. Verify.",
  lensDomainIndex: "DERIVED — rebuildable from lensArtifacts; no persistence needed, rebuild on boot.",
  sessions: "PROCESS-LOCAL-BLOCKING — chat session buffers. Cluster needs sticky routing or Redis.",
  styleVectors: "PROCESS-LOCAL-BENIGN — per-session style; regenerates.",
  users: "SAFE — users table is the source of truth; STATE.users is a cache (now also fronted by _userCache).",
  apiKeys: "SAFE — api_keys table; cache.",
  orgs: "SAFE — orgs table; cache.",
  jobs: "PROCESS-LOCAL-BLOCKING — in-memory job queue. Cluster needs a shared queue (Redis/DB).",
  wallets: "MONEY — must be DB-authoritative. Any STATE.wallets mutation on the request path without a ledger write is a bug.",
  transactions: "MONEY — economy_ledger is authoritative.",
  xpStore: "PER-USER — needs write-through or sticky routing.",
  goals: "PER-USER — verify persistence.",
  qualia: "PROCESS-LOCAL — QualiaEngine per-entity store, LRU-capped, recreated on hook.",
};

const summary = [];
for (const key of Object.keys(findings).sort()) {
  const sites = findings[key];
  const byScope = {};
  for (const s of sites) byScope[s.scope] = (byScope[s.scope] || 0) + 1;
  const reqPath = sites.filter((s) => s.scope === "http-route" || s.scope === "macro");
  const reqPathNoWT = reqPath.filter((s) => !s.writeThroughNear);
  summary.push({
    key,
    totalWrites: sites.length,
    byScope,
    requestPathWrites: reqPath.length,
    requestPathWritesWithoutWriteThrough: reqPathNoWT.length,
    riskiestSites: reqPathNoWT.slice(0, 5).map((s) => `server.js:${s.line}  ${s.code}`),
    note: KNOWN[key] || "UNCLASSIFIED — review.",
  });
}

summary.sort((a, b) => b.requestPathWritesWithoutWriteThrough - a.requestPathWritesWithoutWriteThrough);

mkdirSync(join(ROOT, "audit", "concurrency"), { recursive: true });
writeFileSync(
  join(ROOT, "audit", "concurrency", "state-write-audit.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), keyCount: summary.length, summary }, null, 2),
);

console.log(`# STATE-write audit — ${summary.length} keys with in-request mutations\n`);
console.log("| key | req-path writes | …without write-through | note |");
console.log("|---|--:|--:|---|");
for (const s of summary) {
  if (s.requestPathWrites === 0) continue;
  console.log(`| \`${s.key}\` | ${s.requestPathWrites} | **${s.requestPathWritesWithoutWriteThrough}** | ${s.note.slice(0, 90)} |`);
}
console.log(`\nFull detail (all scopes, every site): audit/concurrency/state-write-audit.json`);
