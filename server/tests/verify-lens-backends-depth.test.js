// Pins scripts/verify-lens-backends.mjs in both directions after it learned to
// follow a lens's component tree transitively and resolve same-file domain
// constants:
//   - lenses whose backend calls sit two+ levels below page.tsx are WIRED
//     (code → CodeApp → panels, healthcare, sim, mail → client/*, …)
//   - `lensRun(DOMAIN, …)` with `const DOMAIN = '…'` counts (inheritance)
//   - a page with no backend anywhere in its tree stays NO-BACKEND-CALL
//     (narrative-walk), and the shared API client reached by a relative
//     import is not mistaken for the lens calling every route in it.

import { it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

it("verify-lens-backends: deep wiring found, true negatives kept, no client leakage", { timeout: 120_000 }, () => {
  execFileSync(process.execPath, [path.join(ROOT, "scripts/verify-lens-backends.mjs")], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  const rows = JSON.parse(fs.readFileSync("/tmp/lens-verify.json", "utf8"));
  const v = Object.fromEntries(rows.map((r) => [r.lens, r]));
  for (const lens of ["code", "healthcare", "sim", "mail", "inheritance", "calendar", "world"]) {
    assert.equal(v[lens]?.verdict, "WIRED", `${lens} should be WIRED (${v[lens]?.verdict} ${v[lens]?.detail || ""})`);
  }
  assert.equal(v["narrative-walk"]?.verdict, "NO-BACKEND-CALL");
  for (const r of rows) assert.ok(!/\/api\/(predictions|meta-derivation|deaths\/registry)/.test(r.detail || ""), `${r.lens} leaked shared-client routes: ${r.detail}`);
});
