// tests/depth/document-domain-behavior.test.js
//
// Proves domains/document.js is wired end-to-end through the REAL macro
// registry on a real server.js boot. document.js uses `register(domain,
// name, fn)` (the MACROS registry — same style as domains/mcp.js), NOT
// `registerLensAction` — so per _harness.js's own header comment, the
// right helper is `macroRuntime()` + a literal `runMacro("document", ...)`
// call, not `lensRun()` (which only reaches LENS_ACTIONS-registered
// handlers via the lens.run macro's STATE.lensArtifacts id-lookup path —
// confirmed by hand: calling this via lensRun() instead silently fell
// through to lens.run's utility-brain AI-fallback and returned a fake
// "fetch failed" instead of ever reaching this file's real handler).
// Deliberately kept to ONE test — see code-exec-python-behavior.test.js's
// header for why: multiple worker/heavy-IO tests sharing this file's heavy
// _harness.js boot has a documented node --test runner interaction that
// silently truncates later subtests in the file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";

test("document.create is registered on the real server and produces a real downloadable PDF", async () => {
  const { runMacro, ctx } = await macroRuntime("document");
  const res = await runMacro("document", "create", { title: "Real Server Boot Spec", format: "pdf", summary: "Proves the domain is wired." }, ctx);
  assert.equal(res.ok, true);
  assert.equal(res.mimeType, "application/pdf");
  assert.match(res.downloadUrl, /^\/api\/artifact\/.+\/download$/);
});
