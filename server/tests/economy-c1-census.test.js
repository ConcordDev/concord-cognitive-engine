// server/tests/economy-c1-census.test.js
//
// C1 pinning regression (the write-path sweep, 2026-10-28, Lane 7 Gate 3).
//
// C1 was a ledger-type forgery: the transfer route let the CALLER choose
// the ledger `type`, and ROYALTY_PAYOUT (0% fee, withdrawal-eligible as
// "earned" income) turned that into fee evasion + a cash-out path.
// PR #1790 sealed the route (user transfers are always "TRANSFER").
// The fleet-wide sweep that followed established the invariant this file
// pins, so the class cannot regrow silently:
//
//   1. Every production executeTransfer call site passes a string-LITERAL
//      ledger type, and the set of sites + literals is exactly the census
//      below. A new caller — or a changed literal — fails here until a
//      human extends the census consciously. No site may ever pass
//      ROYALTY_PAYOUT (system-minted only), and none may pass a variable.
//   2. creditOperatingWallet (emergent-accounts.js) still has NO
//      production callers. Its `source` → ledger-type mapping is
//      substring-based ("royalt" → ROYALTY_PAYOUT): safe today only
//      because nothing wires it. Lane 7 Gate 3: its first production
//      caller MUST pass `source` as a settlement-side enum, never caller
//      input — when that caller lands, this test fails, and the census
//      update that re-pins it must pin the caller's source as a literal.
//   3. Direct economy_ledger writers (INSERT INTO economy_ledger) are
//      exactly the pinned production files. A new direct writer bypasses
//      every guard above by construction, so it fails here too.
//
// Behavioural coverage of the functions themselves lives in
// tests/economy/ledger-emergent-transfer-type.test.js and economy/'s own
// suites; this file pins the CALLER CENSUS, which is a source property.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "data"]);

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) yield* walk(p);
    } else if (ent.isFile() && ent.name.endsWith(".js") && !ent.name.endsWith(".test.js")) {
      yield p;
    }
  }
}

const rel = (p) => path.relative(serverRoot, p).split(path.sep).join("/");
const productionFiles = [...walk(serverRoot)];
const sourceOf = new Map(productionFiles.map((p) => [rel(p), fs.readFileSync(p, "utf8")]));

// file -> sorted list of ledger types its executeTransfer calls pass
const EXECUTE_TRANSFER_CENSUS = {
  "domains/wallet.js": ["TRANSFER"],
  "economy/commission-service.js": ["MARKETPLACE_PURCHASE", "MARKETPLACE_PURCHASE", "TRANSFER", "TRANSFER"],
  "economy/lens-economy-wiring.js": ["BOUNTY_CLAIM", "BOUNTY_ESCROW", "MARKETPLACE_PURCHASE", "TRANSFER"],
  "economy/routes.js": ["TRANSFER"],
  "routes/disputes.js": ["REFUND", "REFUND", "REFUND"],
  "server.js": ["TRANSFER"],
};

function executeTransferSites() {
  const sites = new Map(); // file -> [{ literal|null, line }]
  for (const [file, src] of sourceOf) {
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      if (!/executeTransfer\(\s*db\s*,/.test(line)) return;
      if (line.includes("function executeTransfer")) return; // the definition
      // The type literal sits inside the options object, within a few lines.
      let literal = null;
      for (let j = i; j < Math.min(i + 12, lines.length); j++) {
        const m = lines[j].match(/\btype:\s*"([A-Z_]+)"/) || lines[j].match(/\btype:\s*'([A-Z_]+)'/);
        if (m) { literal = m[1]; break; }
        if (/\btype:\s*[A-Za-z_$]/.test(lines[j])) { literal = "<variable>"; break; }
      }
      if (!sites.has(file)) sites.set(file, []);
      sites.get(file).push({ literal, line: i + 1 });
    });
  }
  return sites;
}

describe("C1 census — executeTransfer callers (pinned 2026-10-29)", () => {
  it("every production call site passes a string-literal type from the census", () => {
    const sites = executeTransferSites();
    assert.deepEqual(
      [...sites.keys()].sort(),
      Object.keys(EXECUTE_TRANSFER_CENSUS).sort(),
      "executeTransfer caller files changed — a new caller must be added to the census in this file consciously, with its type literal reviewed (never caller-controlled, never ROYALTY_PAYOUT)",
    );
    for (const [file, expected] of Object.entries(EXECUTE_TRANSFER_CENSUS)) {
      const got = (sites.get(file) || []).map((s) => s.literal);
      assert.ok(
        got.every((g) => typeof g === "string" && g !== "<variable>"),
        `${file}: an executeTransfer call passes a non-literal type (${JSON.stringify(got)}) — ledger types are system-minted, never caller-controlled (C1)`,
      );
      assert.deepEqual(
        [...got].sort(),
        [...expected].sort(),
        `${file}: executeTransfer type literals changed — update the census only after reviewing the new literal`,
      );
    }
  });

  it("no executeTransfer call site passes ROYALTY_PAYOUT", () => {
    const sites = executeTransferSites();
    for (const [file, list] of sites) {
      for (const s of list) {
        assert.notEqual(s.literal, "ROYALTY_PAYOUT", `${file}:${s.line} — ROYALTY_PAYOUT is minted by the royalty settlement path only, never by a transfer caller (C1)`);
      }
    }
  });
});

describe("C1 census — the latent creditOperatingWallet pattern stays unwired", () => {
  it("creditOperatingWallet has no production callers", () => {
    const callers = [];
    for (const [file, src] of sourceOf) {
      if (file === "economy/emergent-accounts.js") continue; // the definition
      if (/creditOperatingWallet\(/.test(src)) callers.push(file);
    }
    assert.deepEqual(
      callers,
      [],
      `creditOperatingWallet gained production caller(s): ${callers.join(", ")}. Lane 7 Gate 3: the first production caller MUST pass \`source\` as a settlement-side enum, never caller input (its substring mapping turns "royalt"-containing sources into ROYALTY_PAYOUT). Wire it that way, then re-pin this census with the caller's source argument as a literal.`,
    );
  });
});

describe("C1 census — direct economy_ledger writers (pinned 2026-10-29)", () => {
  it("INSERT INTO economy_ledger appears only in the pinned production files", () => {
    const writers = [];
    for (const [file, src] of sourceOf) {
      if (file.startsWith("migrations/")) continue; // schema, not writers
      if (/INSERT INTO economy_ledger/.test(src)) writers.push(file);
    }
    assert.deepEqual(
      writers.sort(),
      ["economy/ledger.js", "lib/account-lifecycle.js", "server.js"],
      "a new direct economy_ledger writer appeared — direct writers bypass the transfer-path guards; pin it here only after review",
    );
  });
});
