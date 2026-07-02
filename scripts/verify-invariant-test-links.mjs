#!/usr/bin/env node
// scripts/verify-invariant-test-links.mjs
//
// The intent layer of docs-as-build-artifact (H5.2). CLAUDE.md's Key Invariants
// carry their proof as backticked test paths ("pinned by `tests/x.test.js`",
// "Tests pin the contract at `tests/y.test.js`"). That link is what keeps the
// narrative honest: violate the invariant and a named, running test goes red.
// But the link itself can rot — a test gets renamed/moved and the doc still
// points at it, so the "proof" silently stops existing. This gate greps every
// backticked tests/… reference out of CLAUDE.md (and any docs/*.md that carry
// them) and fails if a referenced test file doesn't exist on disk.
//
// Path resolution: refs are written `tests/…` but live under server/tests/ or
// concord-frontend/tests/ (a few could be repo-root tests/). All three bases
// are searched. Literal documentation placeholders (`tests/path/to/…`) are
// ignored.
//
// Usage: node scripts/verify-invariant-test-links.mjs [--json] [--ci]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const ci = args.includes("--ci");

const BASES = ["server", "concord-frontend", "."];
const REF_RE = /`((?:server\/|concord-frontend\/)?tests\/[\w./\-[\]]+\.(?:test|spec|behavior)\.[jt]sx?)`/g;
// Documentation templates/examples, not invariant links: `path/to/`, `foo.test`,
// `yourname`, and elided `...` segments.
const PLACEHOLDER_RE = /path\/to\/|\bfoo\.test\b|yourname|\/\.\.\.\//;
// A ref whose surrounding line declares it FUTURE work ("planned", "will be
// pinned", "to be pinned") is an acceptance criterion, not a live claim.
const PLANNED_LINE_RE = /\bplanned\b|will be pinned|to be pinned/i;

const sources = ["CLAUDE.md", ...fs.readdirSync(path.join(ROOT, "docs"))
  .filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)];

const refs = new Map(); // ref -> [sourceFile...]
for (const src of sources) {
  let text = "";
  try { text = fs.readFileSync(path.join(ROOT, src), "utf8"); } catch { continue; }
  for (const line of text.split("\n")) {
    if (PLANNED_LINE_RE.test(line)) continue; // future acceptance criterion, not a live claim
    for (const m of line.matchAll(REF_RE)) {
      const ref = m[1];
      if (PLACEHOLDER_RE.test(ref)) continue; // doc example, not an invariant link
      if (!refs.has(ref)) refs.set(ref, []);
      refs.get(ref).push(src);
    }
  }
}

const missing = [];
let resolved = 0;
for (const [ref, where] of refs) {
  // A ref may already carry its base (server/tests/...) or be the logical tests/... form.
  const candidates = ref.startsWith("tests/")
    ? BASES.map((b) => path.join(ROOT, b, ref))
    : [path.join(ROOT, ref)];
  if (candidates.some((c) => fs.existsSync(c))) { resolved++; continue; }
  missing.push({ ref, referencedIn: [...new Set(where)] });
}

const result = { total: refs.size, resolved, missing };
if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`invariant test-links: ${resolved}/${refs.size} resolve`);
  for (const m of missing) {
    console.log(`  MISSING ${m.ref}  (referenced in ${m.referencedIn.join(", ")})`);
  }
  if (!missing.length) console.log("  all invariant proofs exist on disk ✓");
}
if (ci && missing.length) process.exit(1);
