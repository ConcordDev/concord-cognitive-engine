// server/tests/webhook-meta-access.test.js — fix/sec-webhook-hmac
//
// SECURITY: the integrations webhook actions (test/activate/deliveries/retry/
// verifyWebhookSignature) key HMAC secrets and delivery history by webhookId
// only. These tests pin the ownership fix: metas are owned by their creator,
// other users get 403, anonymous callers get 401 (and never create a meta),
// legacy ownerless metas are admin-only, and verifyWebhookSignature never
// echoes the expected HMAC back (signing-oracle closure) while comparing in
// constant time. Transport is a fake ctx.integrationsFetch — no egress.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerIntegrationsActions from "../domains/integrations.js";
import { webhookMetaAccess, safeSignatureEqual } from "../lib/webhook-meta-access.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`integrations.${name}`);
  if (!fn) throw new Error(`integrations.${name} not registered`);
  const artifact = { id: null, domain: "integrations", type: "domain_action", data: params, meta: {} };
  return fn(ctx, artifact, params);
}

before(() => { registerIntegrationsActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const ctxAdmin = { actor: { userId: "admin_1", role: "admin" }, userId: "admin_1" };
const ctxAnon = { actor: { userId: "anon" }, userId: "anon" };

// ── webhookMetaAccess unit tests ─────────────────────────────────────────────

describe("webhookMetaAccess ownership verdict", () => {
  const ownMeta = { ownerId: "u1", secret: "whsec_x", deliveries: [] };

  it("allows the owner", () => {
    assert.equal(webhookMetaAccess({ meta: ownMeta, actorId: "u1", isAdmin: false }), null);
  });

  it("allows an admin even for someone else's meta", () => {
    assert.equal(webhookMetaAccess({ meta: ownMeta, actorId: "u2", isAdmin: true }), null);
  });

  it("refuses a different owner with 403 FORBIDDEN", () => {
    const d = webhookMetaAccess({ meta: ownMeta, actorId: "u2", isAdmin: false });
    assert.deepEqual(d, { ok: false, status: 403, code: "FORBIDDEN", error: "forbidden: not your webhook" });
  });

  it("refuses a legacy ownerless meta for a member but allows an admin", () => {
    const legacy = { deliveries: [], secret: "whsec_legacy" }; // no ownerId key
    const d = webhookMetaAccess({ meta: legacy, actorId: "u1", isAdmin: false });
    assert.equal(d.ok, false);
    assert.equal(d.status, 403);
    assert.equal(d.code, "FORBIDDEN");
    assert.equal(webhookMetaAccess({ meta: legacy, actorId: "u1", isAdmin: true }), null);
  });

  it("refuses anonymous callers with 401 AUTH_REQUIRED, before any admin pass", () => {
    for (const actorId of ["anon", null, undefined, ""]) {
      const d = webhookMetaAccess({ meta: ownMeta, actorId, isAdmin: false });
      assert.deepEqual(d, { ok: false, status: 401, code: "AUTH_REQUIRED", error: "sign in required" }, `actorId=${actorId}`);
    }
    // Anon is 401 even if a caller mislabels it admin — the identity check wins.
    assert.equal(webhookMetaAccess({ meta: ownMeta, actorId: "anon", isAdmin: true }).status, 401);
  });

  it("returns fresh denial objects, not a shared frozen instance", () => {
    const d1 = webhookMetaAccess({ meta: ownMeta, actorId: "u2", isAdmin: false });
    const d2 = webhookMetaAccess({ meta: ownMeta, actorId: "u2", isAdmin: false });
    assert.notEqual(d1, d2);
    d1.status = 999;
    assert.equal(webhookMetaAccess({ meta: ownMeta, actorId: "u2", isAdmin: false }).status, 403);
  });
});

// ── safeSignatureEqual unit tests ────────────────────────────────────────────

describe("safeSignatureEqual constant-time compare", () => {
  const sig = `sha256=${"a".repeat(64)}`;

  it("accepts an identical string and rejects any mismatch", () => {
    assert.equal(safeSignatureEqual(sig, sig), true);
    assert.equal(safeSignatureEqual(sig, `sha256=${"a".repeat(63)}b`), false);
    assert.equal(safeSignatureEqual(sig, `sha256=${"b".repeat(64)}`), false);
    assert.equal(safeSignatureEqual(sig, sig.slice(0, -1)), false); // length mismatch
    assert.equal(safeSignatureEqual(sig, `${sig}0`), false);
  });

  it("returns false for non-strings instead of throwing", () => {
    for (const bad of [null, undefined, 42, {}, [], Buffer.from(sig)]) {
      assert.equal(safeSignatureEqual(bad, sig), false, String(bad));
      assert.equal(safeSignatureEqual(sig, bad), false, String(bad));
    }
    assert.equal(safeSignatureEqual(), false);
  });
});

// ── Behavioral tests (real domain module, fake transport) ───────────────────

describe("integrations webhook meta ownership (behavioral)", () => {
  let fetchCalls = 0;
  const fetchOk = async () => { fetchCalls++; return { status: 200 }; };
  const ctxOkA = { ...ctxA, integrationsFetch: fetchOk };
  const ctxOkB = { ...ctxB, integrationsFetch: fetchOk };
  const ctxOkAdmin = { ...ctxAdmin, integrationsFetch: fetchOk };
  const ctxOkAnon = { ...ctxAnon, integrationsFetch: fetchOk };

  function metaOf(webhookId) {
    return globalThis._concordSTATE.integrationsLens.webhookMeta.get(webhookId);
  }

  it("user A's webhookTest creates a meta owned by A", async () => {
    const r = await call("webhookTest", ctxOkA, { webhookId: "wh_own", url: "https://hooks.example/x" });
    assert.equal(r.ok, true);
    const meta = metaOf("wh_own");
    assert.ok(meta, "meta exists");
    assert.equal(meta.ownerId, "user_a");
    assert.match(meta.secret, /^whsec_[0-9a-f]{48}$/);
  });

  it("user B gets 403 on every webhook action over A's webhook, with no side effects", async () => {
    await call("webhookTest", ctxOkA, { webhookId: "wh_iso", url: "https://hooks.example/x" });
    const meta = metaOf("wh_iso");
    const deliveryId = meta.deliveries[0].id;
    assert.equal(meta.ownerId, "user_a");
    // Registry entry must survive B's refused activate untouched.
    globalThis._concordSTATE.webhooksRegistry = new Map([["wh_iso", { enabled: true }]]);
    fetchCalls = 0;

    const t = await call("webhookTest", ctxOkB, { webhookId: "wh_iso", url: "https://evil.example/x", payload: { event: "steal" } });
    assert.equal(t.ok, false); assert.equal(t.status, 403); assert.equal(t.code, "FORBIDDEN");
    const v = call("verifyWebhookSignature", ctxB, { webhookId: "wh_iso", body: "{}", signature: "sha256=deadbeef" });
    assert.equal(v.ok, false); assert.equal(v.status, 403); assert.equal(v.code, "FORBIDDEN");
    const d = call("webhookDeliveries", ctxB, { webhookId: "wh_iso" });
    assert.equal(d.ok, false); assert.equal(d.status, 403); assert.equal(d.code, "FORBIDDEN");
    const a = call("webhookActivate", ctxB, { webhookId: "wh_iso", enabled: false });
    assert.equal(a.ok, false); assert.equal(a.status, 403); assert.equal(a.code, "FORBIDDEN");
    const rr = await call("webhookRetry", ctxOkB, { webhookId: "wh_iso", deliveryId });
    assert.equal(rr.ok, false); assert.equal(rr.status, 403); assert.equal(rr.code, "FORBIDDEN");

    // No oracle side effects: nothing sent, nothing recorded, nothing toggled.
    assert.equal(fetchCalls, 0, "no delivery attempted for a refused caller");
    assert.equal(meta.deliveries.length, 1, "no new deliveries recorded");
    assert.equal(globalThis._concordSTATE.webhooksRegistry.get("wh_iso").enabled, true);
    assert.equal(meta.enabled, undefined);
    // B's refused calls did not reassign or create any meta.
    assert.equal(metaOf("wh_iso").ownerId, "user_a");
  });

  it("verifyWebhookSignature never returns the expected HMAC and still verifies correctly", async () => {
    await call("webhookTest", ctxOkA, { webhookId: "wh_verify", url: "https://hooks.example/x" });
    const delivery = metaOf("wh_verify").deliveries[0];

    const bad = call("verifyWebhookSignature", ctxA, { webhookId: "wh_verify", body: delivery.body, signature: `sha256=${"0".repeat(64)}` });
    assert.equal(bad.ok, true);
    assert.equal(bad.result.valid, false);
    assert.equal("expected" in bad.result, false);
    assert.equal(bad.result.expected, undefined);
    assert.deepEqual(Object.keys(bad.result).sort(), ["provided", "signatureHeader", "valid"]);

    const good = call("verifyWebhookSignature", ctxA, { webhookId: "wh_verify", body: delivery.body, signature: delivery.signature });
    assert.equal(good.ok, true);
    assert.equal(good.result.valid, true);
    assert.equal("expected" in good.result, false);
  });

  it("anonymous callers get 401 on every webhook action and never create a meta", async () => {
    fetchCalls = 0;
    const cases = [
      ["webhookTest", ctxOkAnon, { webhookId: "wh_anon", url: "https://hooks.example/x" }],
      ["webhookActivate", ctxOkAnon, { webhookId: "wh_anon", enabled: true }],
      ["webhookDeliveries", ctxOkAnon, { webhookId: "wh_anon" }],
      ["webhookRetry", ctxOkAnon, { webhookId: "wh_anon", deliveryId: "dlv_missing" }],
      ["verifyWebhookSignature", ctxOkAnon, { webhookId: "wh_anon", body: "{}", signature: "sha256=0" }],
    ];
    for (const [name, ctx, params] of cases) {
      const r = await call(name, ctx, params);
      assert.equal(r.ok, false, name);
      assert.equal(r.status, 401, name);
      assert.equal(r.code, "AUTH_REQUIRED", name);
      assert.equal(r.error, "sign in required", name);
    }
    assert.equal(fetchCalls, 0, "anon never sends anything");
    assert.equal(globalThis._concordSTATE.integrationsLens.webhookMeta.size, 0, "anon never creates a meta");
    // A caller with no actor at all is treated the same.
    const bare = await call("webhookTest", { ...{}, integrationsFetch: fetchOk }, { webhookId: "wh_anon2", url: "https://hooks.example/x" });
    assert.equal(bare.status, 401);
    assert.equal(globalThis._concordSTATE.integrationsLens.webhookMeta.size, 0);
  });

  it("an admin may operate another user's webhook (recovery path), still with no expected echo", async () => {
    await call("webhookTest", ctxOkA, { webhookId: "wh_admin", url: "https://hooks.example/x" });
    const meta = metaOf("wh_admin");
    assert.equal(meta.ownerId, "user_a");

    const d = call("webhookDeliveries", ctxAdmin, { webhookId: "wh_admin" });
    assert.equal(d.ok, true);
    assert.equal(d.result.total, 1);

    const v = call("verifyWebhookSignature", ctxAdmin, { webhookId: "wh_admin", body: meta.deliveries[0].body, signature: meta.deliveries[0].signature });
    assert.equal(v.result.valid, true);
    assert.equal("expected" in v.result, false);

    const on = call("webhookActivate", ctxAdmin, { webhookId: "wh_admin", enabled: true });
    assert.equal(on.ok, true);
    assert.equal(on.result.enabled, true);
    assert.equal(meta.enabled, true);

    const rr = await call("webhookRetry", ctxOkAdmin, { webhookId: "wh_admin", deliveryId: meta.deliveries[0].id });
    assert.equal(rr.ok, true);
    assert.equal(rr.result.attempt, 2);
  });

  it("a legacy ownerless meta is admin-only (member 403, admin ok)", () => {
    // Seed a meta the way pre-fix code left it: no ownerId.
    globalThis._concordSTATE.integrationsLens = {
      zaps: new Map(),
      connections: new Map(),
      runs: new Map(),
      webhookMeta: new Map([["wh_legacy", {
        deliveries: [],
        retryPolicy: { maxAttempts: 3, backoffSeconds: [2, 8, 30] },
        secret: "whsec_legacy",
      }]]),
    };
    const member = call("webhookDeliveries", ctxA, { webhookId: "wh_legacy" });
    assert.equal(member.ok, false);
    assert.equal(member.status, 403);
    assert.equal(member.code, "FORBIDDEN");
    const admin = call("webhookDeliveries", ctxAdmin, { webhookId: "wh_legacy" });
    assert.equal(admin.ok, true);
    assert.equal(admin.result.total, 0);
  });
});