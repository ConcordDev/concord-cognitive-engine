// PR-2: dedicated background brain + governed embedding backfill.
// Brain config is evaluated at module load, so each case runs in a child
// process with its own env and a stubbed fetch (no network).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(script, env = {}) {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: SERVER, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NODE_ENV: "test", CONCORD_BG_STATUS_FILE: "", CONCORD_BG_KILL_FILE: "/nonexistent/kill", ...env },
  });
  const line = (r.stdout || "").split("\n").filter((l) => l.startsWith("RESULT ")).pop();
  assert.ok(line, `no RESULT line. stderr:\n${(r.stderr || "").slice(-2000)}`);
  return JSON.parse(line.slice(7));
}

const STUB_FETCH = `
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), body });
  const u = String(url);
  if (u.endsWith("/api/embed")) return new Response(JSON.stringify({ embeddings: [Array.from({ length: 1024 }, (_, i) => (i % 5) / 5)] }), { status: 200 });
  if (u.endsWith("/api/embeddings")) return new Response(JSON.stringify({ embedding: Array.from({ length: 1024 }, (_, i) => (i % 7) / 7) }), { status: 200 });
  if (u.endsWith("/api/chat")) return new Response(JSON.stringify({ message: { role: "assistant", content: "hello from bg" }, prompt_eval_count: 3, eval_count: 4 }), { status: 200 });
  if (u.endsWith("/api/tags") || u.endsWith("/api/version")) return new Response("{}", { status: 200 });
  return new Response("{}", { status: 404 });
};`;

describe("background brain config", () => {
  it("is absent unless BRAIN_BACKGROUND_URL is set", () => {
    const r = run(`import { BRAIN_CONFIG, hasBackgroundBrain } from "./lib/brain-config.js";
      console.log("RESULT " + JSON.stringify({ has: hasBackgroundBrain(), bg: BRAIN_CONFIG.background || null }));`,
    { BRAIN_BACKGROUND_URL: "", BRAIN_BACKGROUND_URLS: "" });
    assert.equal(r.has, false); assert.equal(r.bg, null);
  });
  it("uses the bg URL verbatim (not the user-facing proxy), core-v6, think:false", () => {
    const r = run(`import { BRAIN_CONFIG } from "./lib/brain-config.js";
      console.log("RESULT " + JSON.stringify({ bg: BRAIN_CONFIG.background, sub: BRAIN_CONFIG.subconscious.url }));`,
    { BRAIN_BACKGROUND_URL: "http://127.0.0.1:11436/", OLLAMA_PROXY_URL: "http://127.0.0.1:11435", BRAIN_SUBCONSCIOUS_URL: "http://127.0.0.1:11435" });
    assert.equal(r.bg.url, "http://127.0.0.1:11436");
    assert.equal(r.bg.model, "concord-core-v6:latest");
    assert.equal(r.bg.think, false);
    assert.equal(r.sub, "http://127.0.0.1:11435");
  });
});

describe("routing", () => {
  it("emergent callers go to the background brain with think:false; chat callers do not", () => {
    const r = run(`${STUB_FETCH}
      const { infer } = await import("./lib/inference/index.js");
      const a = await infer({ role: "subconscious", intent: "say hi", callerId: "emergent:e1:observe", maxSteps: 1 });
      const bgChat = calls.filter(c => c.url.endsWith("/api/chat"));
      console.log("RESULT " + JSON.stringify({ brain: a.brainUsed, text: a.finalText, chatUrls: bgChat.map(c => c.url), think: bgChat.map(c => c.body.think), model: bgChat.map(c => c.body.model) }));`,
    { BRAIN_BACKGROUND_URL: "http://127.0.0.1:11436", BRAIN_SUBCONSCIOUS_URL: "http://127.0.0.1:11435", CONCORD_BG_GOVERNOR: "shadow" });
    assert.equal(r.brain, "background");
    assert.equal(r.text, "hello from bg");
    assert.deepEqual(r.chatUrls, ["http://127.0.0.1:11436/api/chat"]);
    assert.deepEqual(r.think, [false]);
    assert.deepEqual(r.model, ["concord-core-v6:latest"]);
  });
  it("CONCORD_BG_BRAIN=0 keeps the caller's role", () => {
    const r = run(`${STUB_FETCH}
      const { infer } = await import("./lib/inference/index.js");
      const a = await infer({ role: "subconscious", intent: "x", callerId: "emergent:e1:observe", maxSteps: 1 });
      console.log("RESULT " + JSON.stringify({ brain: a.brainUsed, urls: calls.filter(c => c.url.endsWith("/api/chat")).map(c => c.url) }));`,
    { BRAIN_BACKGROUND_URL: "http://127.0.0.1:11436", BRAIN_SUBCONSCIOUS_URL: "http://127.0.0.1:11435", CONCORD_BG_BRAIN: "0" });
    assert.equal(r.brain, "subconscious");
    assert.deepEqual(r.urls, ["http://127.0.0.1:11435/api/chat"]);
  });
  it("a routed call is paused (not sent anywhere) when the breaker is open, even in shadow mode", () => {
    const r = run(`${STUB_FETCH}
      const G = await import("./lib/background-governor.js");
      G._resetGovernorForTest({});
      G._setBreakerForTest("open", "bg_brain_unreachable");
      const { infer } = await import("./lib/inference/index.js");
      const a = await infer({ role: "subconscious", intent: "x", callerId: "emergent:e1:observe", maxSteps: 1 });
      console.log("RESULT " + JSON.stringify({ error: a.error, sent: calls.filter(c => c.url.endsWith("/api/chat")).length }));`,
    { BRAIN_BACKGROUND_URL: "http://127.0.0.1:11436", CONCORD_BG_GOVERNOR: "shadow" });
    assert.equal(r.error, "bg_governor_denied:breaker_open:bg_brain_unreachable");
    assert.equal(r.sent, 0);
  });
});

describe("governed embedding backfill", () => {
  it("pauses while the breaker is open, then embeds every DTU once it closes", () => {
    const r = run(`${STUB_FETCH}
      const G = await import("./lib/background-governor.js");
      G._resetGovernorForTest({});
      const E = await import("./embeddings.js");
      await E.initEmbeddings({ db: null, ollamaUrls: ["http://127.0.0.1:11436"], structuredLog: () => {} });
      const dtus = new Map(Array.from({ length: 25 }, (_, i) => [\`d\${i}\`, { id: \`d\${i}\`, title: \`DTU \${i}\`, tags: ["t"] }]));
      G._setBreakerForTest("open", "chat_p95");
      setTimeout(() => G._setBreakerForTest("closed"), 6000);
      const t0 = Date.now();
      const res = await E.backfillEmbeddings(dtus, { governed: true });
      const st = E.getEmbeddingStatus(dtus.size);
      console.log("RESULT " + JSON.stringify({ res, waited: Date.now() - t0, coverage: st.coverage, pauses: st.backfill.pauses, reasons: st.backfill.pauseReasons, gov: G.getGovernorStatus().counters.exec }));`,
    { BRAIN_BACKGROUND_URL: "", CONCORD_EMBED_BACKFILL_DELAY_MS: "1" });
    assert.equal(r.res.embedded, 25);
    assert.equal(r.res.errors, 0);
    assert.equal(r.coverage, 100);
    assert.ok(r.pauses >= 1, "should have paused at least once");
    assert.ok(r.reasons["breaker_open:chat_p95"] >= 1);
    assert.ok(r.waited >= 5000);
    assert.equal(r.gov.allowed, 25);
  });
});

describe("governed backfill skips", () => {
  it("counts DTUs with no text as skipped, not as brain errors", () => {
    const r = run(`${STUB_FETCH}
      const G = await import("./lib/background-governor.js");
      G._resetGovernorForTest({});
      const E = await import("./embeddings.js");
      await E.initEmbeddings({ db: null, ollamaUrls: ["http://127.0.0.1:11436"], structuredLog: () => {} });
      const dtus = new Map([["a", { id: "a", title: "Has text" }], ["b", { id: "b" }], ["c", { id: "c", content: "body only" }]]);
      const res = await E.backfillEmbeddings(dtus, { governed: true });
      console.log("RESULT " + JSON.stringify({ res, out: G.getGovernorStatus().counters.outcomes }));`,
    { BRAIN_BACKGROUND_URL: "", CONCORD_EMBED_BACKFILL_DELAY_MS: "1" });
    assert.equal(r.res.embedded, 2);
    assert.equal(r.res.empty, 1);
    assert.equal(r.res.errors, 0);
    assert.equal(r.out.error, 0);
  });
});
