/**
 * Tier-2 contract tests for the fetch-timeout autofix.
 *
 * Pinned: rewrites `fetch(url)` → `fetch(url, { signal: AbortSignal.timeout(5000) })`,
 * rewrites `axios.get(url)` → `axios.get(url, { timeout: 5000 })`, leaves
 * Ollama brain ports alone, leaves already-timeout calls alone, and is
 * registered in the autofix registry under id `add_fetch_timeout`.
 *
 * Run: node --test tests/fetch-timeout-autofix.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { fetchTimeoutFix } from "../lib/autofix/fetch-timeout.js";
import { listFixes, getFix, safeApply } from "../lib/autofix/index.js";

describe("fetchTimeoutFix — matching", () => {
  it("matches finding id 'external_call_without_timeout'", () => {
    assert.equal(fetchTimeoutFix.matchFinding({ id: "external_call_without_timeout" }), true);
    assert.equal(fetchTimeoutFix.matchFinding({ id: "something_else" }), false);
  });
});

describe("fetchTimeoutFix — apply", () => {
  it("rewrites bare fetch(url) by adding signal:AbortSignal.timeout(5000)", () => {
    const src = `const r = await fetch('https://api.example.com/data');\n`;
    const finding = { id: "external_call_without_timeout", location: "server/routes/foo.js:1" };
    const out = fetchTimeoutFix.apply(src, finding);
    assert.ok(out, "must return rewritten content");
    assert.match(out, /AbortSignal\.timeout\(5000\)/);
    assert.match(out, /fetch\('https:\/\/api\.example\.com\/data', \{ signal: AbortSignal\.timeout\(5000\) \}\)/);
  });

  it("rewrites fetch(url, { method }) by injecting signal before closing }", () => {
    const src = `const r = await fetch('https://api.example.com/data', { method: 'POST' });\n`;
    const finding = { id: "external_call_without_timeout", location: "server/routes/foo.js:1" };
    const out = fetchTimeoutFix.apply(src, finding);
    assert.ok(out);
    assert.match(out, /method: 'POST'.*signal: AbortSignal\.timeout\(5000\)/);
  });

  it("rewrites axios.get(url) by adding timeout: 5000", () => {
    const src = `const r = await axios.get('https://api.example.com/data');\n`;
    const finding = { id: "external_call_without_timeout", location: "server/routes/foo.js:1" };
    const out = fetchTimeoutFix.apply(src, finding);
    assert.ok(out);
    assert.match(out, /timeout: 5000/);
  });

  it("does NOT touch calls that already have signal:", () => {
    const src = `const r = await fetch('https://api.example.com/data', { signal: controller.signal });\n`;
    const finding = { id: "external_call_without_timeout", location: "server/routes/foo.js:1" };
    const out = fetchTimeoutFix.apply(src, finding);
    assert.equal(out, null, "must decline to touch a call that already has signal:");
  });

  it("does NOT touch Ollama brain port URLs", () => {
    const src = `const r = await fetch('http://localhost:11434/api/generate');\n`;
    const finding = { id: "external_call_without_timeout", location: "server/routes/foo.js:1" };
    const out = fetchTimeoutFix.apply(src, finding);
    assert.equal(out, null, "must decline to touch Ollama brain port calls");
  });

  it("returns null when the finding line doesn't actually contain a fetch", () => {
    const src = `const x = 1;\nconst y = 2;\n`;
    const finding = { id: "external_call_without_timeout", location: "server/routes/foo.js:1" };
    const out = fetchTimeoutFix.apply(src, finding);
    assert.equal(out, null);
  });
});

describe("fetchTimeoutFix — registry wiring", () => {
  it("is registered in the autofix registry", () => {
    const ids = listFixes().map(f => f.id);
    assert.ok(ids.includes("add_fetch_timeout"), "add_fetch_timeout must be registered");
    assert.ok(getFix("add_fetch_timeout"), "getFix must return the spec");
  });

  it("safeApply applies cleanly to a routes/* file", () => {
    const src = `router.get('/x', async (req, res) => {\n  const r = await fetch('https://api.example.com/data');\n  res.json(await r.json());\n});\n`;
    const finding = { id: "external_call_without_timeout", location: "server/routes/foo.js:2" };
    const result = safeApply(fetchTimeoutFix, "server/routes/foo.js", src, finding);
    assert.equal(result.ok, true);
    assert.match(result.content, /AbortSignal\.timeout\(5000\)/);
  });

  it("safeApply refuses to touch server.js (hard refusal)", () => {
    const src = `await fetch('https://api.example.com/data');\n`;
    const finding = { id: "external_call_without_timeout", location: "server/server.js:1" };
    const result = safeApply(fetchTimeoutFix, "server/server.js", src, finding);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "hard_refusal_path");
  });
});
