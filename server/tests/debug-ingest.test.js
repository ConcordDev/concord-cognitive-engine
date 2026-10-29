// Behaviour tests for the Debug Q1 ingest slice — the Sentry-compatible
// envelope endpoint's testable layers: the pure envelope lib
// (server/lib/sentry-envelope.js) and the domain layer (per-project
// ingest keys + the shared grouping core in server/domains/debug.js).
// The express route itself is thin wiring over these and is exercised
// live at Review 2's re-pass (no node_modules in this sandbox).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseEnvelope,
  mapEventToIssue,
  parseSentryAuthHeader,
  createRateLimiter,
} from "../lib/sentry-envelope.js";
import registerDebugActions, { debugIngest } from "../domains/debug.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`debug.${name}`);
  if (!fn) throw new Error(`debug.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerDebugActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const asUser = (userId) => ({ actor: { userId }, userId });
const ada = asUser("ing_ada");
const bob = asUser("ing_bob");

function envelopeBody(items, header = {}) {
  const lines = [JSON.stringify({ event_id: "hdr", sent_at: "2026-10-29T00:00:00Z", ...header })];
  for (const [itemHeader, payload] of items) {
    const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload);
    lines.push(JSON.stringify({ ...itemHeader, length: Buffer.byteLength(payloadStr) }));
    lines.push(payloadStr);
  }
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

const sampleEvent = (overrides = {}) => ({
  event_id: "9ec79c33ec9942ab8353589fcb04e3c2",
  timestamp: Math.floor(Date.now() / 1000) - 60,
  platform: "javascript",
  level: "error",
  release: "web@1.4.0",
  environment: "production",
  exception: {
    values: [{
      type: "TypeError",
      value: "Cannot read properties of undefined (reading 'id')",
      stacktrace: {
        frames: [
          { filename: "app.js", function: "boot", lineno: 10, in_app: true },
          { filename: "cart.js", function: "renderCart", lineno: 42, colno: 7, in_app: true },
          { filename: "vendor.js", function: "dispatch", lineno: 1, in_app: false },
        ],
      },
    }],
  },
  breadcrumbs: {
    values: [
      { timestamp: Math.floor(Date.now() / 1000) - 120, category: "navigation", message: "/cart", level: "info" },
    ],
  },
  ...overrides,
});

describe("sentry-envelope lib — parsing", () => {
  it("parses a single-event envelope", () => {
    const r = parseEnvelope(envelopeBody([[{ type: "event" }, sampleEvent()]]));
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].type, "event");
    assert.equal(r.items[0].payload.event_id, "9ec79c33ec9942ab8353589fcb04e3c2");
  });

  it("parses multi-item envelopes and keeps non-event items distinct", () => {
    const r = parseEnvelope(envelopeBody([
      [{ type: "event" }, sampleEvent()],
      [{ type: "session" }, { sid: "s1", status: "ok" }],
    ]));
    assert.equal(r.ok, true);
    assert.deepEqual(r.items.map((i) => i.type), ["event", "session"]);
  });

  it("length-prefixed payloads may contain newlines", () => {
    const ev = sampleEvent({ message: "line one\nline two" });
    const r = parseEnvelope(envelopeBody([[{ type: "event" }, ev]]));
    assert.equal(r.ok, true);
    assert.equal(r.items[0].payload.message, "line one\nline two");
  });

  it("malformed inputs name their defect", () => {
    assert.equal(parseEnvelope(Buffer.alloc(0)).error, "envelope is empty");
    assert.match(parseEnvelope("not json\n").error, /header is not valid JSON/);
    const badItem = Buffer.from('{"event_id":"x"}\nnot json\n{}\n');
    assert.match(parseEnvelope(badItem).error, /item header is not valid JSON/);
    const truncated = Buffer.from('{"event_id":"x"}\n{"type":"event","length":500}\n{"a":1}\n');
    assert.match(parseEnvelope(truncated).error, /truncated/);
  });
});

describe("sentry-envelope lib — event mapping", () => {
  it("maps an exception event: culprit is the last in_app frame, stack newest-first", () => {
    const r = mapEventToIssue(sampleEvent());
    assert.equal(r.ok, true);
    assert.match(r.fields.culprit, /renderCart/);
    assert.match(r.fields.culprit, /cart\.js:42/);
    const stackLines = r.fields.stack.split("\n");
    assert.equal(stackLines[0], "TypeError: Cannot read properties of undefined (reading 'id')");
    assert.match(stackLines[1], /dispatch/, "newest frame first");
    assert.equal(r.fields.level, "error");
    assert.equal(r.fields.release, "web@1.4.0");
    assert.equal(r.fields.environment, "production");
    assert.equal(r.fields.breadcrumbs.length, 1);
    assert.equal(r.fields.breadcrumbs[0].category, "navigation");
  });

  it("message-only events map too; chained exceptions take the last value", () => {
    const msg = mapEventToIssue({ event_id: "e1", message: "plain failure", level: "warning" });
    assert.equal(msg.ok, true);
    assert.equal(msg.fields.type, "Error");
    assert.equal(msg.fields.level, "warning");
    const chained = mapEventToIssue(sampleEvent({
      exception: {
        values: [
          { type: "WrapperError", value: "outer" },
          { type: "RootCause", value: "the real one" },
        ],
      },
    }));
    assert.equal(chained.fields.type, "RootCause");
    assert.equal(chained.fields.message, "the real one");
  });

  it("debug level maps to info; timestamps clamp to a sane window", () => {
    const now = Date.now();
    const dbg = mapEventToIssue({ event_id: "e2", message: "x", level: "debug", timestamp: now / 1000 + 3600 }, now);
    assert.equal(dbg.fields.level, "info");
    assert.ok(Math.abs(new Date(dbg.fields.occurredAt).getTime() - now) < 5000, "future timestamps clamp to now");
    const ancient = mapEventToIssue({ event_id: "e3", message: "x", timestamp: 100000000 }, now);
    assert.ok(new Date(ancient.fields.occurredAt).getTime() > now - 5000, "ancient timestamps clamp to now");
  });

  it("unmappable events are refused with a named reason (the 400 cases)", () => {
    assert.match(mapEventToIssue({ message: "no id" }).error, /event_id/);
    assert.match(mapEventToIssue({ event_id: "e4" }).error, /neither an exception nor a message/);
    assert.match(mapEventToIssue(null).error, /not an object/);
  });

  it("the auth header yields its key; the limiter windows per key", () => {
    assert.equal(
      parseSentryAuthHeader("Sentry sentry_version=7, sentry_key=cdi_abc123, sentry_client=sdk/1.0"),
      "cdi_abc123",
    );
    assert.equal(parseSentryAuthHeader("Bearer xyz"), null);
    assert.equal(parseSentryAuthHeader(undefined), null);
    const rl = createRateLimiter({ limit: 2, windowMs: 60_000 });
    const t0 = 1_000_000;
    assert.equal(rl.check("k1", t0).allowed, true);
    assert.equal(rl.check("k1", t0 + 1).allowed, true);
    const blocked = rl.check("k1", t0 + 2);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSec > 0);
    assert.equal(rl.check("k2", t0 + 2).allowed, true, "windows are per key");
    assert.equal(rl.check("k1", t0 + 60_001).allowed, true, "window resets");
  });
});

describe("debug ingest — keys and the shared core", () => {
  const mkProjectId = (ctx) => call("project-list", ctx, {}).result.defaultProjectId;

  it("create returns the raw key once; only its hash is stored; list never shows it", () => {
    const pid = mkProjectId(ada);
    const r = call("ingest-key-create", ada, { projectId: pid, label: "web app" });
    assert.equal(r.ok, true);
    assert.match(r.result.key, /^cdi_[0-9a-f]{64}$/);
    assert.equal(r.result.dsnPath, `/api/debug/ingest/${pid}/envelope/`);
    const stored = globalThis._concordSTATE.debugLens.ingestKeys.get("ing_ada")[0];
    assert.equal(stored.hash.length, 64);
    assert.ok(!JSON.stringify(stored).includes(r.result.key), "the raw key is nowhere in stored state");
    const list = call("ingest-key-list", ada, { projectId: pid }).result;
    assert.equal(list.count, 1);
    assert.equal(list.keys[0].label, "web app");
    assert.ok(!("hash" in list.keys[0]) && !("key" in list.keys[0]));
    assert.ok(!JSON.stringify(list).includes(r.result.key));
  });

  it("keys are project-scoped and owner-scoped", () => {
    const pid = mkProjectId(ada);
    assert.equal(call("ingest-key-create", ada, {}).error, "projectId required");
    assert.equal(call("ingest-key-create", bob, { projectId: pid }).error, "project not found");
    assert.equal(call("ingest-key-list", bob, { projectId: pid }).error, "project not found");
  });

  it("verifyKey resolves a live key to its owner and dies on revoke", () => {
    const pid = mkProjectId(ada);
    const { result } = call("ingest-key-create", ada, { projectId: pid });
    const found = debugIngest.verifyKey(result.key);
    assert.equal(found.userId, "ing_ada");
    assert.equal(found.record.projectId, pid);
    assert.equal(debugIngest.verifyKey("cdi_" + "0".repeat(64)), null);
    assert.equal(debugIngest.verifyKey("not-a-key"), null);
    call("ingest-key-revoke", ada, { id: result.keyRecord.id });
    assert.equal(debugIngest.verifyKey(result.key), null, "a revoked key authenticates nothing");
    debugIngest.touchKey("ing_ada", result.keyRecord.id); // must not throw post-revoke
  });

  it("events ingested through the core group per project, exactly like the macro", () => {
    const pid = mkProjectId(ada);
    const other = call("project-create", ada, { name: "Worker" }).result.project.id;
    const fields = mapEventToIssue(sampleEvent()).fields;
    const first = debugIngest.ingestEvent("ing_ada", pid, fields);
    assert.equal(first.ok, true);
    assert.equal(first.result.isNew, true);
    assert.equal(first.result.issue.environment, "production");
    assert.match(first.result.issue.stack, /renderCart/);
    const again = debugIngest.ingestEvent("ing_ada", pid, fields);
    assert.equal(again.result.issue.id, first.result.issue.id);
    assert.equal(again.result.issue.count, 2);
    const elsewhere = debugIngest.ingestEvent("ing_ada", other, fields);
    assert.notEqual(elsewhere.result.issue.id, first.result.issue.id);
    assert.equal(call("issue-list", ada, { projectId: pid }).result.count, 1);
    assert.equal(debugIngest.ingestEvent("ing_ada", "proj_nope", fields).error, "project not found");
    // The macro path still groups with the endpoint path (one implementation).
    const viaMacro = call("issue-ingest", ada, {
      projectId: pid, type: fields.type, message: fields.message, culprit: fields.culprit,
    });
    assert.equal(viaMacro.result.issue.id, first.result.issue.id);
    assert.equal(viaMacro.result.issue.count, 3);
  });
});
