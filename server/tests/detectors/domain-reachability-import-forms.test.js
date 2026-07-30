// server/tests/detectors/domain-reachability-import-forms.test.js
//
// Pins the domain-reachability detector's import-recognition BOTH ways
// (2026-07-28).
//
// The bug: its import regex required a BARE default import
// (`import vault from './vault.js'`). `domains/index.js:209` actually writes
// `import vault, { setAdmissionProtectionHandler } from './vault.js'`, so the
// match failed and the detector emitted a `high` claiming vault.js "is
// imported by NEITHER server.js NOR domains/index.js — every macro it
// registers is unreachable at runtime". Both halves of that were false:
// index.js imports it at :209 and lists it in the `export default [...]`
// array at :508, which server.js:45270 drains via
// `domainModules.forEach(mod => mod(registerLensAction))`.
//
// Why this test is written bidirectionally: per CLAUDE.md's anti-cheat rule, a
// checker may only be "fixed" as a correctness change proven in both
// directions — it must now accept the real case AND still reject a genuinely
// dead one. A one-directional test would be indistinguishable from quietly
// softening the detector until the finding disappeared, which is the exact
// goalpost-moving failure mode `scripts/autoloop/guard.mjs` exists to stop.
//
// Run: node --test server/tests/detectors/domain-reachability-import-forms.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, "../../lib/detectors/domain-reachability-detector.js"), "utf8");

// Rebuild the detector's matcher from its own source so the test tracks the
// real regex rather than a copy that can silently drift out of sync.
function buildDotRe(stem) {
  const m = SRC.match(/const DEFAULT_BINDING = String\.raw`([^`]*)`/);
  assert.ok(m, "DEFAULT_BINDING not found — detector was restructured; update this test deliberately");
  return new RegExp(String.raw`import\s+${m[1]}\s+from\s+["'\`]\.\/${stem}\.js["'\`]`);
}

describe("domain-reachability — default-import forms it must ACCEPT", () => {
  const cases = [
    ["bare default", `import vault from './vault.js';`],
    ["default + named clause", `import vault, { setAdmissionProtectionHandler } from './vault.js';`],
    ["default + multi named", `import vault, { a, b, c } from './vault.js';`],
    ["default + namespace", `import vault, * as vaultNs from './vault.js';`],
    ["double quotes", `import vault, { x } from "./vault.js";`],
  ];
  for (const [label, line] of cases) {
    it(`recognizes: ${label}`, () => {
      const m = buildDotRe("vault").exec(line);
      assert.ok(m, `detector failed to see the import in: ${line}`);
      assert.equal(m[1], "vault", "must bind the DEFAULT identifier, not a named one");
    });
  }
});

describe("domain-reachability — forms it must still REJECT", () => {
  it("a named-only import is not a default registrar import", () => {
    // This one matters: `import { setAdmissionProtectionHandler } from
    // './vault.js'` alone does NOT make the registrar reachable, and treating
    // it as if it did would re-hide the real bug class this detector exists for.
    const line = `import { setAdmissionProtectionHandler } from './vault.js';`;
    assert.equal(buildDotRe("vault").exec(line), null);
  });

  it("does not split an identifier to fake a match (import xfrom '...')", () => {
    // Guards the fix itself: relaxing the mandatory whitespace before `from`
    // would make this match with ident="vault".
    assert.equal(buildDotRe("vault").exec(`import vaultfrom './vault.js';`), null);
  });

  it("a different module's import does not satisfy this stem", () => {
    assert.equal(buildDotRe("vault").exec(`import ledger from './ledger.js';`), null);
  });
});

describe("domain-reachability — the real tree is the ground truth", () => {
  const INDEX = readFileSync(path.join(HERE, "../../domains/index.js"), "utf8");

  it("vault is imported AND listed in the exported default array", () => {
    const m = buildDotRe("vault").exec(INDEX);
    assert.ok(m, "domains/index.js really does import vault — detector must see it");
    const start = INDEX.indexOf("export default [");
    assert.ok(start > 0, "domains/index.js has no `export default [` array");
    const open = INDEX.indexOf("[", start);
    let depth = 0, end = -1;
    for (let i = open; i < INDEX.length; i++) {
      if (INDEX[i] === "[") depth++;
      else if (INDEX[i] === "]") { depth--; if (depth === 0) { end = i; break; } }
    }
    const body = INDEX.slice(open, end + 1);
    assert.match(body, new RegExp(`(?:^|[^\\w$])${m[1]}(?:[^\\w$]|$)`),
      "vault is imported but never drained by the domainModules array");
  });

  it("a module that is NOT in the array is still detectable as unreachable", () => {
    // Negative control against a name that cannot be present, proving the
    // array membership check can actually fail.
    const start = INDEX.indexOf("export default [");
    const open = INDEX.indexOf("[", start);
    const body = INDEX.slice(open, INDEX.indexOf("\n];", open));
    assert.doesNotMatch(body, /(?:^|[^\w$])__definitelyNotADomain__(?:[^\w$]|$)/);
  });
});
