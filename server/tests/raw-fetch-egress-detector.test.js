// SB-08 — the raw-fetch detector ratchet.
//
// Pristine behaviour: no detector flagged a raw fetch on a dynamic
// URL, so a new unguarded egress site could land anywhere in server/**
// without any gate noticing.
//
// Pins (failure paths first), over a fixture tree:
//   (1) fetch(userUrl) raises a finding; undici.request(url) raises
//       one; an interpolated template raises one.
//   (2) fetch("https://fixed") does not; an interpolation-free
//       template does not; a literal concatenated with + DOES (it is
//       not a complete literal).
//   (3) the allow-list holds: a dynamic fetch inside a guard module's
//       path, and anywhere under server/tests/, raises nothing; a
//       dynamic fetch outside server/** raises nothing.
//   (4) classifyFirstArg unit cases.
// Run: node --test server/tests/raw-fetch-egress-detector.test.js
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runRawFetchEgressDetector, scanSource, classifyFirstArg } from "../lib/detectors/raw-fetch-egress-detector.js";

let root;
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "sb08-fixture-"));
  const put = async (rel, src) => {
    const p = path.join(root, rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, src);
  };
  await put("server/lib/dynamic.js", "export async function a(userUrl) { return fetch(userUrl); }\n");
  await put("server/lib/fixed.js", "export async function b() { const r = await fetch(\"https://example.com/x\"); const s = await fetch(`https://example.com/y`); return [r, s]; }\n");
  await put("server/lib/interp.js", "export async function c(id, url) { const a = await fetch(`https://example.com/${id}`); const b = await undici.request(url); const d = await fetch(\"https://example.com/\" + id); return [a, b, d]; }\n");
  await put("server/lib/public-fetch.js", "export async function d(u) { return fetch(u); }\n");
  await put("server/tests/local.test.js", "export async function e(u) { return fetch(u); }\n");
  await put("concord-frontend/lib/x.js", "export async function f(u) { return fetch(u); }\n");
});
after(async () => { await rm(root, { recursive: true, force: true }); });

describe("SB-08 raw-fetch-egress detector", () => {
  it("(1)+(2)+(3) fixture tree: exactly the dynamic production calls are flagged", async () => {
    const report = await runRawFetchEgressDetector({ root });
    assert.equal(report.ok, true);
    const byPath = {};
    for (const f of report.findings) byPath[f.subject.path] = (byPath[f.subject.path] || 0) + 1;
    assert.deepEqual(byPath, {
      "server/lib/dynamic.js": 1,
      "server/lib/interp.js": 3,
    });
    assert.ok(report.findings.every((f) => f.severity === "high" && f.id === "raw_fetch_dynamic_url"));
  });

  it("(4) classifier: literal forms vs dynamic forms", () => {
    const cls = (argSrc) => classifyFirstArg(`fetch(${argSrc})`, 6);
    assert.equal(cls('"https://example.com"'), "literal");
    assert.equal(cls("'https://example.com', {}"), "literal");
    assert.equal(cls("`https://example.com`"), "literal");
    assert.equal(cls("`https://example.com/${id}`"), "dynamic");
    assert.equal(cls('"https://example.com" + suffix'), "dynamic");
    assert.equal(cls("userUrl"), "dynamic");
    assert.equal(cls("buildUrl(id)"), "dynamic");
    assert.equal(cls("  url  "), "dynamic");
  });

  it("scanSource ignores injected transports called by their own names", () => {
    const src = "await fetchImpl(url); await transport(url); await pinnedFetch(check, init);";
    assert.deepEqual(scanSource(src), []);
  });
});
