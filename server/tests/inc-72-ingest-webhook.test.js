// INC-72 — the advertised ingest webhook URL has a real receiver.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerIngestActions, { receiveIngestWebhook, WEBHOOK_MAX_RECORDS } from "../domains/ingest.js";
import { INGEST_WEBHOOK_RE } from "../middleware/csrf.js";

const ACTIONS = new Map();
const call = (n, userId, input = {}) =>
  ACTIONS.get(n)({ actor: { userId } }, { id: null, domain: "ingest", type: "domain_action", data: input, meta: {} }, input);

before(() => registerIngestActions((d, n, fn) => ACTIONS.set(n, fn)));
beforeEach(() => { globalThis._concordSTATE = {}; globalThis._concordSaveStateDebounced = () => {}; });

describe("INC-72 ingest webhook", () => {
  it("anonymous POST with A's token lands in A's inbox only", () => {
    const ep = call("getWebhookEndpoint", "userA");
    assert.equal(ep.ok, true);
    assert.match(ep.result.url, /^\/api\/ingest\/webhook\/[a-f0-9]{32}$/);
    assert.ok(INGEST_WEBHOOK_RE.test(ep.result.url));
    call("getWebhookEndpoint", "userB");
    const r = receiveIngestWebhook(ep.result.token, { records: [{ a: 1 }, { b: 2 }] });
    assert.equal(r.ok, true);
    assert.equal(r.accepted, 2);
    const a = call("listWebhookRecords", "userA");
    assert.equal(a.result.count, 2);
    assert.deepEqual(a.result.records.map((x) => x.payload), [{ b: 2 }, { a: 1 }]);
    const b = call("listWebhookRecords", "userB");
    assert.equal(b.result.count, 0);
    const again = call("getWebhookEndpoint", "userA");
    assert.equal(again.result.recordsReceived, 2);
    assert.ok(again.result.lastReceivedAt);
  });
  it("unknown token → 404, nothing stored", () => {
    call("getWebhookEndpoint", "userA");
    const r = receiveIngestWebhook("0".repeat(32), { records: [{ a: 1 }] });
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
    assert.equal(call("listWebhookRecords", "userA").result.count, 0);
  });
  it("oversized body or too many records → 413; empty → 400", () => {
    const ep = call("getWebhookEndpoint", "userA");
    const big = receiveIngestWebhook(ep.result.token, { records: [{ blob: "x".repeat(300 * 1024) }] });
    assert.equal(big.status, 413);
    const many = receiveIngestWebhook(ep.result.token, { records: Array.from({ length: WEBHOOK_MAX_RECORDS + 1 }, (_, i) => ({ i })) });
    assert.equal(many.status, 413);
    const empty = receiveIngestWebhook(ep.result.token, {});
    assert.equal(empty.status, 400);
    assert.equal(call("listWebhookRecords", "userA").result.count, 0);
  });
  it("a rotated token stops working", () => {
    const ep = call("getWebhookEndpoint", "userA");
    call("getWebhookEndpoint", "userA", { rotate: true });
    assert.equal(receiveIngestWebhook(ep.result.token, { records: [{ a: 1 }] }).status, 404);
  });
  it("route regex is exact (no prefix widening)", () => {
    assert.equal(INGEST_WEBHOOK_RE.test("/api/ingest/webhook/" + "a".repeat(32) + "/x"), false);
    assert.equal(INGEST_WEBHOOK_RE.test("/api/ingest/webhook/short"), false);
    assert.equal(INGEST_WEBHOOK_RE.test("/api/ingest/submit"), false);
  });
});
