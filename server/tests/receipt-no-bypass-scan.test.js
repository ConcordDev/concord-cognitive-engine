// Guard: no signature without the declaration gate (REC-INT-01).
//
// Scans server/ (not tests, not node_modules) for direct calls to the receipt
// signers. Only the signer implementation + gate + store may call them. Every
// other caller is either routed through lib/receipts/declarations.js or sits in
// KNOWN_UNGATED below, which is PINNED BOTH WAYS:
//   - a new file that signs directly fails (new bypass),
//   - a listed file that stops signing directly also fails (remove it: the list only shrinks).
// The two paths this ticket closed (MCP bridge, conkay-demo calc routes) are
// asserted absent from the list.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SIGNERS = ["attestReceipt", "attestReport", "buildCalcReceipt", "calcReceiptForEnvelope", "issueStoredReceipt", "storeReceipt", "buildAnalysisReceipt", "buildBeamCalcReceipt"];
const CALL_RE = new RegExp(`\\b(${SIGNERS.join("|")})\\s*\\(`);

/** The signer implementation, the ONE gate, and the store. Nothing else. */
const ALLOWED = new Set([
  "lib/receipts/attest.js",
  "lib/receipts/calc-receipt.js",
  "lib/receipts/store.js",
  "lib/receipts/declarations.js",
]);

/**
 * Files that still sign directly, with why. These are tracked debt, not
 * approved design: each is a signature that does not (yet) mean "checked
 * against a declared reference". Do not add to this list; remove from it.
 */
const KNOWN_UNGATED = {
  "domains/conkay-design.js": "attests full solver envelopes in design views and 'report' results (attestReceipt/attestReport) with no declaration",
  "domains/conkay-northstar.js": "attestReport over the north-star report",
  "domains/conkay-safety.js": "attestReport over safety-case / PRA / facility reports",
  "domains/conkay-knowledge.js": "attestReport over formulation / mixture reports",
  "domains/engineering.js": "solveBeamStudy builds a signed calc receipt eagerly; both exits (lens hook, conkay-demo gate) strip or re-sign it, but the solver output itself is pre-signed",
  "lib/conkay/beam-study.js": "buildAnalysisReceipt / buildBeamCalcReceipt: the solver-side receipt builders solveBeamStudy calls",
  "lib/conkay/iterate/receipt.js": "run-record provenance hash attestation (not a numeric claim), still ungated",
  "lib/cockpit/receipts.js": "cockpit step-record attestation (not a numeric claim), still ungated",
  "routes/conkay-demo.js": "GET /designs/:id attests the frozen showcase snapshot (provenance of a stored file, not a computed number)",
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "tests" || e.name === ".git" || e.name === "data") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(m?js|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Lines that are a real call: not a comment, not a function/export definition, not an import. */
function callSites(src) {
  const hits = [];
  src.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("import ")) return;
    if (/\bfunction\s+\w+\s*\(/.test(t) && !/=>/.test(t) && !/\w\s*\(.*\)\s*;?\s*$/.test(t.replace(/\bfunction\s+\w+\s*\([^)]*\)\s*\{?/, ""))) return;
    if (/^export\s+(async\s+)?function\b/.test(t) || /^(async\s+)?function\b/.test(t)) return;
    const m = CALL_RE.exec(line);
    if (m) hits.push({ line: i + 1, signer: m[1] });
  });
  return hits;
}

/** Relative paths (posix) of files under `root` that call a signer and are not allowed. */
export function scanForSignerBypass(root, allowed = ALLOWED) {
  const found = {};
  for (const f of walk(root)) {
    const rel = path.relative(root, f).split(path.sep).join("/");
    if (allowed.has(rel)) continue;
    const hits = callSites(fs.readFileSync(f, "utf8"));
    if (hits.length) found[rel] = hits;
  }
  return found;
}

describe("receipt signing bypass scan", () => {
  it("every direct signer call outside the gate/store is pinned in KNOWN_UNGATED (no new bypass)", () => {
    const found = Object.keys(scanForSignerBypass(SERVER_ROOT)).sort();
    const pinned = Object.keys(KNOWN_UNGATED).sort();
    const added = found.filter((f) => !pinned.includes(f));
    const stale = pinned.filter((f) => !found.includes(f));
    assert.deepEqual(added, [], `NEW direct signer call(s) outside lib/receipts/declarations.js: ${added.join(", ")}. Route them through applyReceiptDeclaration / applyEnvelopeDeclaration.`);
    assert.deepEqual(stale, [], `KNOWN_UNGATED lists file(s) that no longer sign directly: ${stale.join(", ")}. Remove them (the list only shrinks).`);
  });

  it("the MCP bridge and the conkay-demo calc routes do not sign directly any more", () => {
    const found = scanForSignerBypass(SERVER_ROOT);
    assert.equal(found["lib/mcp-execution-bridge.js"], undefined);
    // conkay-demo still attests the frozen showcase snapshot (provenance), but never calc receipts:
    const demo = fs.readFileSync(path.join(SERVER_ROOT, "routes/conkay-demo.js"), "utf8");
    for (const s of ["issueStoredReceipt", "buildCalcReceipt", "calcReceiptForEnvelope", "chemReceiptParts"]) {
      assert.equal(new RegExp(`\\b${s}\\b`).test(demo), false, `routes/conkay-demo.js must not use ${s}`);
    }
    assert.match(demo, /applyReceiptDeclaration/);
    const bridge = fs.readFileSync(path.join(SERVER_ROOT, "lib/mcp-execution-bridge.js"), "utf8");
    assert.equal(/calcReceiptForEnvelope/.test(bridge), false);
    assert.match(bridge, /applyEnvelopeDeclaration/);
    assert.match(bridge, /applyReceiptDeclaration/);
  });

  it("the scanner FAILS on a planted bypass fixture and ignores comments/definitions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "receipt-scan-"));
    try {
      fs.mkdirSync(path.join(dir, "routes"));
      fs.writeFileSync(path.join(dir, "routes/sneaky.js"), 'import { issueStoredReceipt } from "../lib/receipts/store.js";\nexport const r = (x) => issueStoredReceipt(x, {});\n');
      fs.writeFileSync(path.join(dir, "routes/direct.js"), "const s = attestReceipt({ n: 1 });\n");
      fs.writeFileSync(path.join(dir, "routes/clean.js"), "// attestReceipt(x) is documented here\n/* issueStoredReceipt(y) */\nexport function buildCalcReceipt(a) { return a; }\n * storeReceipt(z)\n");
      const found = scanForSignerBypass(dir, new Set());
      assert.deepEqual(Object.keys(found).sort(), ["routes/direct.js", "routes/sneaky.js"]);
      assert.equal(found["routes/sneaky.js"][0].signer, "issueStoredReceipt");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("every pinned exception states a reason", () => {
    for (const [f, why] of Object.entries(KNOWN_UNGATED)) assert.ok(typeof why === "string" && why.length > 20, f);
  });
});
