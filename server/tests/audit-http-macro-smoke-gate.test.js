// server/tests/audit-http-macro-smoke-gate.test.js
//
// Real acceptance tests for scripts/audit-http-macro-smoke.mjs — the
// HTTP-layer smoke test that fires `POST /api/lens/run` for every
// registered (domain, macro) pair against a live backend, catching bugs
// the in-process behavior-smoke harness can't (auth middleware, rate
// limiting, serialization, route mounting, CSRF, bot-guard).
//
// Two layers of proof:
//   1. Pure-logic unit tests for shouldSkip / buildTotals / buildFailures /
//      buildStatusBreakdown / buildMarkdownReport — no network at all.
//   2. A REAL end-to-end run of `runSmoke()` (the exact concurrency +
//      request-building + response-parsing path `main()` uses) against an
//      actual `node:http` server standing in for the Concord backend —
//      proving the HTTP layer genuinely works, not just the aggregation
//      math. Covers a 200 ok:true, a 200 ok:false, a malformed-JSON body,
//      a 500 status, a skipped LLM-hint macro (asserted NEVER hits the
//      server), a skipped blacklisted-domain macro, and a real network
//      error (a closed port with nothing listening).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
  shouldSkip,
  testOne,
  buildTotals,
  buildFailures,
  buildStatusBreakdown,
  buildMarkdownReport,
  runSmoke,
  LLM_RE,
  SKIP_DOMAINS,
  HEADERS,
} from "../../scripts/audit-http-macro-smoke.mjs";

describe("audit-http-macro-smoke.mjs — shouldSkip", () => {
  it("skips a macro whose name matches the LLM-hint pattern", () => {
    // LLM_RE's word-list alternatives are ANCHORED (`^word$`) — an exact
    // macro name match, not a substring — so only the two forms below
    // actually trip it: an exact listed verb, or any name CONTAINING the
    // literal substring "llm"/"brain" (those two alternatives are outside
    // the anchored group).
    assert.equal(shouldSkip("chat", "respond"), "llm-hint");
    assert.equal(shouldSkip("music", "generate"), "llm-hint");
    assert.equal(shouldSkip("anything", "explain"), "llm-hint");
  });

  it("does NOT skip a macro whose name merely starts with a listed verb (the match is anchored, not prefix-based)", () => {
    // A real behavior-smoke-harness distinction: 'generatePlaylist' does
    // NOT match `^generate$` and contains no 'llm'/'brain' substring, so
    // it is genuinely exercised over HTTP — the same shape the actual
    // MACROS map uses for many non-LLM macro names that happen to start
    // with a listed English verb.
    assert.equal(shouldSkip("music", "generatePlaylist"), null);
    assert.equal(shouldSkip("anything", "explainThing"), null);
  });

  it("skips a macro in a blacklisted domain regardless of its name", () => {
    for (const d of SKIP_DOMAINS) {
      assert.equal(shouldSkip(d, "totallyHarmlessName"), "domain-blacklist");
    }
  });

  it("does not skip an ordinary non-LLM macro in a non-blacklisted domain", () => {
    assert.equal(shouldSkip("accounting", "trialBalance"), null);
    assert.equal(shouldSkip("dtu", "create"), null);
  });

  it("domain-blacklist takes precedence over an LLM-shaped name in the same call (both true independently)", () => {
    const [oneBlacklisted] = SKIP_DOMAINS;
    assert.equal(shouldSkip(oneBlacklisted, "respond"), "domain-blacklist");
  });

  it("LLM_RE also matches a bare 'llm'/'brain' substring anywhere in the name", () => {
    assert.ok(LLM_RE.test("someLlmHelper"));
    assert.ok(LLM_RE.test("brainRouter"));
  });
});

describe("audit-http-macro-smoke.mjs — buildTotals / buildStatusBreakdown / buildFailures", () => {
  const results = [
    { domain: "oracle", macro: "anything", skipped: "domain-blacklist" },
    { domain: "chat", macro: "respond", skipped: "llm-hint" },
    { domain: "good", macro: "a", status: 200, okShape: true, ok: true },
    { domain: "good", macro: "b", status: 200, okShape: true, ok: false, error: "validation_failed" },
    { domain: "bad", macro: "c", status: 200, okShape: false, parseError: "json-parse: boom" },
    { domain: "bad", macro: "d", status: 500, okShape: true, ok: false },
    { domain: "bad", macro: "e", networkError: "fetch failed" },
  ];

  it("buildTotals counts skip/exercise/shape/status buckets correctly", () => {
    const totals = buildTotals(results);
    assert.equal(totals.total, 7);
    assert.equal(totals.skipped, 2);
    assert.equal(totals.exercised, 5);
    assert.equal(totals.okEnvelope, 3); // a, b, d all have okShape:true
    assert.equal(totals.okTrue, 1); // only a
    assert.equal(totals.okFalse, 2); // b and d
    assert.equal(totals.badShape, 2); // c (bad shape) + e (network error, no okShape)
    assert.equal(totals.networkError, 1);
    assert.equal(totals.http200, 3); // a, b, c
    assert.equal(totals.http500, 1); // d
    assert.equal(totals.http400, 0);
  });

  it("buildStatusBreakdown tallies exercised results by HTTP status, ignoring skipped/networkError rows with no status", () => {
    const breakdown = buildStatusBreakdown(results);
    assert.deepEqual(breakdown, { 200: 3, 500: 1 });
  });

  it("buildFailures selects network errors + bad-shape + 5xx, excludes skipped and clean 200s", () => {
    const failures = buildFailures(results);
    const keys = failures.map((f) => `${f.domain}.${f.macro}`);
    assert.deepEqual(keys.sort(), ["bad.c", "bad.d", "bad.e"]);
  });

  it("buildFailures caps at 100 rows", () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ domain: "x", macro: `m${i}`, status: 500, okShape: true }));
    assert.equal(buildFailures(many).length, 100);
  });
});

describe("audit-http-macro-smoke.mjs — buildMarkdownReport", () => {
  it("renders totals, status breakdown, and a failures table with a real issue description per row", () => {
    const out = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      backend: "http://127.0.0.1:5050",
      totals: buildTotals([
        { domain: "bad", macro: "c", status: 200, okShape: false, parseError: "json-parse: boom" },
        { domain: "bad", macro: "d", status: 500, okShape: true, ok: false },
        { domain: "bad", macro: "e", networkError: "fetch failed" },
      ]),
      statusBreakdown: { 200: 1, 500: 1 },
      failures: buildFailures([
        { domain: "bad", macro: "c", status: 200, okShape: false, parseError: "json-parse: boom" },
        { domain: "bad", macro: "d", status: 500, okShape: true, ok: false },
        { domain: "bad", macro: "e", networkError: "fetch failed" },
      ]),
    };
    const md = buildMarkdownReport(out);
    assert.match(md, /Backend: http:\/\/127\.0\.0\.1:5050/);
    assert.match(md, /- exercised: \*\*3\*\*/);
    assert.match(md, /- 500: 1/);
    assert.match(md, /`bad`.*`c`.*bad shape/);
    assert.match(md, /`bad`.*`d`.*500-class status/);
    assert.match(md, /`bad`.*`e`.*network: fetch failed/);
  });
});

describe("audit-http-macro-smoke.mjs — HEADERS shape", () => {
  it("sends a real browser User-Agent so the bot guard is exercised, not bypassed", () => {
    assert.match(HEADERS["User-Agent"], /Mozilla.*Chrome/);
    assert.equal(HEADERS["Content-Type"], "application/json");
  });
});

describe("audit-http-macro-smoke.mjs — testOne / runSmoke against a REAL http server", () => {
  // Stands in for the Concord backend's /api/lens/run route with a handful
  // of scripted response shapes, keyed by (domain, macro) so each test
  // scenario is independently addressable. Any request the smoke script
  // should have SKIPPED (llm-hint / blacklisted-domain) hits the 'never'
  // branch, which fails the test loudly if actually reached.
  function startFakeBackend() {
    const hits = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        hits.push(`${parsed.domain}.${parsed.name}`);
        const key = `${parsed.domain}.${parsed.name}`;
        if (key === "good.okTrue") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, result: { hello: "world" } }));
        } else if (key === "good.okFalse") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "validation_failed" }));
        } else if (key === "bad.malformed") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{not valid json");
        } else if (key === "bad.serverError") {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "internal" }));
        } else if (key === "chat.respond" || key === "oracle.anything") {
          res.writeHead(500);
          res.end("SHOULD HAVE BEEN SKIPPED — this macro should never reach the server");
        } else {
          res.writeHead(404);
          res.end("unknown test route");
        }
      });
    });
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address();
        resolve({ server, backend: `http://127.0.0.1:${port}`, hits });
      });
    });
  }

  it("testOne against a real 200 ok:true response parses the envelope correctly", async () => {
    const { server, backend } = await startFakeBackend();
    try {
      const r = await testOne({ domain: "good", macro: "okTrue" }, { backend, fetchImpl: fetch });
      assert.equal(r.status, 200);
      assert.equal(r.okShape, true);
      assert.equal(r.ok, true);
      assert.equal(r.error, null);
      assert.equal(typeof r.ms, "number");
    } finally {
      server.close();
    }
  });

  it("testOne against a real 200 ok:false response reports ok:false + the error string", async () => {
    const { server, backend } = await startFakeBackend();
    try {
      const r = await testOne({ domain: "good", macro: "okFalse" }, { backend, fetchImpl: fetch });
      assert.equal(r.status, 200);
      assert.equal(r.okShape, true);
      assert.equal(r.ok, false);
      assert.equal(r.error, "validation_failed");
    } finally {
      server.close();
    }
  });

  it("testOne against malformed JSON reports okShape:false with a parseError, not a crash", async () => {
    const { server, backend } = await startFakeBackend();
    try {
      const r = await testOne({ domain: "bad", macro: "malformed" }, { backend, fetchImpl: fetch });
      assert.equal(r.status, 200);
      // envelope stays `null` (JSON.parse threw before any envelope was
      // built) so okShape short-circuits to `null`, not the boolean
      // `false` — both are falsy, and buildTotals' `!r.okShape` filter
      // treats them identically as "bad shape".
      assert.ok(!r.okShape, `expected a falsy okShape, got ${JSON.stringify(r.okShape)}`);
      assert.match(r.parseError, /json-parse/);
    } finally {
      server.close();
    }
  });

  it("testOne against a real 500 response reports the status", async () => {
    const { server, backend } = await startFakeBackend();
    try {
      const r = await testOne({ domain: "bad", macro: "serverError" }, { backend, fetchImpl: fetch });
      assert.equal(r.status, 500);
    } finally {
      server.close();
    }
  });

  it("testOne never sends a network request for an llm-hint or blacklisted-domain macro", async () => {
    const { server, backend, hits } = await startFakeBackend();
    try {
      const r1 = await testOne({ domain: "chat", macro: "respond" }, { backend, fetchImpl: fetch });
      const r2 = await testOne({ domain: "oracle", macro: "anything" }, { backend, fetchImpl: fetch });
      assert.equal(r1.skipped, "llm-hint");
      assert.equal(r2.skipped, "domain-blacklist");
      assert.deepEqual(hits, [], "the fake server should never have been hit for either skipped macro");
    } finally {
      server.close();
    }
  });

  it("testOne against a closed port reports a real networkError (no server listening)", async () => {
    // Bind and immediately close to get a guaranteed-free port with nothing
    // listening, so the fetch genuinely fails at the transport layer.
    const probe = createServer();
    const deadPort = await new Promise((resolve) => {
      probe.listen(0, "127.0.0.1", () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
      });
    });
    const r = await testOne({ domain: "good", macro: "anything" }, { backend: `http://127.0.0.1:${deadPort}`, fetchImpl: fetch });
    assert.ok(r.networkError, `expected a networkError, got: ${JSON.stringify(r)}`);
    assert.equal(r.status, undefined);
  });

  it("runSmoke drives the full concurrent pass end-to-end: totals + status breakdown + failures all line up with a real HTTP round trip", async () => {
    const { server, backend, hits } = await startFakeBackend();
    try {
      const macros = [
        { domain: "good", macro: "okTrue" },
        { domain: "good", macro: "okFalse" },
        { domain: "bad", macro: "malformed" },
        { domain: "bad", macro: "serverError" },
        { domain: "chat", macro: "respond" }, // skipped, llm-hint
        { domain: "oracle", macro: "anything" }, // skipped, domain-blacklist
      ];
      const out = await runSmoke(macros, { backend, fetchImpl: fetch, concurrency: 3 });
      assert.equal(out.backend, backend);
      assert.equal(out.totals.total, 6);
      assert.equal(out.totals.skipped, 2);
      assert.equal(out.totals.exercised, 4);
      assert.equal(out.totals.okTrue, 1);
      assert.equal(out.totals.okFalse, 1);
      // Bad shape = malformed (JSON.parse threw, envelope null) AND
      // serverError (valid JSON `{error:"internal"}` but no `ok` boolean
      // field — a raw framework 500 body, not a lens/run envelope).
      assert.equal(out.totals.badShape, 2);
      assert.equal(out.totals.http500, 1);
      assert.deepEqual(out.statusBreakdown, { 200: 3, 500: 1 });
      const failureKeys = out.failures.map((f) => `${f.domain}.${f.macro}`).sort();
      assert.deepEqual(failureKeys, ["bad.malformed", "bad.serverError"]);
      // Real network round trip actually happened for the 4 exercised
      // macros and NOT for the 2 skipped ones.
      assert.equal(hits.length, 4);
      assert.ok(!hits.includes("chat.respond"));
      assert.ok(!hits.includes("oracle.anything"));
      // The report is a well-formed JSON-serializable + markdown-renderable
      // object, exactly what main() persists to disk.
      const md = buildMarkdownReport(out);
      assert.match(md, /bad\.malformed|`bad`.*`malformed`/);
    } finally {
      server.close();
    }
  });
});
