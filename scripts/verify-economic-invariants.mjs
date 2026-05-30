#!/usr/bin/env node
// scripts/verify-economic-invariants.mjs
//
// The exploit gate (static half). A persistent creator economy with real royalties
// is gaming's richest exploit surface; the constitutional constants (CLAUDE.md:
// "Do not change any of the above without governance approval") are load-bearing.
// This gate greps them from the live code and fails if any has drifted, plus
// checks the derived identities (shares sum to 1; the seller-keeps floor holds).
// The adversarial/dynamic half (dupe loops, cascade gaming) is the agent-playtest
// exploit run (Instrument 2); the cascade MATH is pinned by tests/royalty-cascade.test.js.
//
// Usage: node scripts/verify-economic-invariants.mjs [--json] [--ci]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const ci = args.includes("--ci");
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { return ""; } };

// Extract a numeric constant `NAME: 0.04` or `NAME = 0.04` from source.
function num(src, name) {
  const m = src.match(new RegExp(`\\b${name}\\b\\s*[:=]\\s*([0-9]*\\.?[0-9]+)`));
  return m ? Number(m[1]) : null;
}

const cmc = read("server/lib/creative-marketplace-constants.js");
const cascade = read("server/economy/royalty-cascade.js");
const withdrawals = read("server/economy/withdrawals.js");
const serverJs = read("server/server.js");

// Each invariant: name, actual (parsed from code), expected (constitutional).
const inv = [
  ["PLATFORM_FEE_RATE", num(cmc, "PLATFORM_FEE_RATE"), 0.0146],
  ["MARKETPLACE_FEE_RATE", num(cmc, "MARKETPLACE_FEE_RATE"), 0.04],
  ["INITIAL_ROYALTY_RATE", num(cmc, "INITIAL_ROYALTY_RATE"), 0.21],
  ["ROYALTY_HALVING", num(cmc, "ROYALTY_HALVING"), 2],
  ["ROYALTY_FLOOR", num(cmc, "ROYALTY_FLOOR"), 0.0005],
  ["MAX_CASCADE_DEPTH", num(cmc, "MAX_CASCADE_DEPTH"), 50],
  ["MAX_ROYALTY_RATE", num(cascade, "MAX_ROYALTY_RATE"), 0.30],
  ["WITHDRAWAL_HOLD_HOURS", num(withdrawals, "WITHDRAWAL_HOLD_HOURS"), 48],
  ["TOKEN_PURCHASE_FEE", num(serverJs, "TOKEN_PURCHASE_FEE"), 0.0146],
  ["MARKETPLACE_FEE", num(serverJs, "MARKETPLACE_FEE"), 0.04],
  ["CREATOR_SHARE", num(serverJs, "CREATOR_SHARE"), 0.70],
  ["ROYALTY_SHARE", num(serverJs, "ROYALTY_SHARE"), 0.20],
  ["TREASURY_SHARE", num(serverJs, "TREASURY_SHARE"), 0.10],
];

const results = inv.map(([name, actual, expected]) => ({
  name, actual, expected,
  ok: actual != null && Math.abs(actual - expected) < 1e-9,
}));

// Derived identities (defense-in-depth on the parsed values).
const get = (n) => results.find((r) => r.name === n)?.actual;
const shareSum = (get("CREATOR_SHARE") ?? 0) + (get("ROYALTY_SHARE") ?? 0) + (get("TREASURY_SHARE") ?? 0);
const sellerFloor = 1 - ((get("PLATFORM_FEE_RATE") ?? 0) + (get("MARKETPLACE_FEE_RATE") ?? 0)) - (get("MAX_ROYALTY_RATE") ?? 0);
const derived = [
  { name: "shares sum to 1.0 (CREATOR+ROYALTY+TREASURY)", ok: Math.abs(shareSum - 1) < 1e-9, detail: `= ${shareSum}` },
  { name: "seller keeps ≥ 64.54% (1 − fees − royalty cap)", ok: sellerFloor >= 0.6454 - 1e-9, detail: `= ${(sellerFloor * 100).toFixed(2)}%` },
];

const allOk = results.every((r) => r.ok) && derived.every((d) => d.ok);

if (asJson) {
  console.log(JSON.stringify({ ok: allOk, invariants: results, derived }, null, 2));
} else {
  console.log("\n=== Economic Invariants Gate (constitutional constants) ===");
  for (const r of results) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.name.padEnd(22)} ${r.actual} ${r.ok ? "" : `(expected ${r.expected})`}`);
  }
  console.log("  ── derived identities ──");
  for (const d of derived) console.log(`  ${d.ok ? "✓" : "✗"} ${d.name}  ${d.detail}`);
  console.log(`\n  ${allOk ? "✓ all economic invariants hold" : "✗ ECONOMIC INVARIANT DRIFT — governance approval required"}\n`);
}

if (ci && !allOk) {
  console.error("[economic-invariants] FAIL: a constitutional economic constant has drifted.");
  process.exit(1);
}
