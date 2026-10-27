// guardAnonWrites (lib/lens-authz.js): write-shaped lens actions refuse a
// caller with no real account; reads, allowlisted public share/portal actions
// and AUTH_MODE=public keep working.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { guardAnonWrites, isWriteActionName } from "../lib/lens-authz.js";
import registerAgriculture from "../domains/agriculture.js";

function collect(register) {
  const map = new Map();
  register(guardAnonWrites((d, n, h) => map.set(`${d}.${n}`, h)));
  return map;
}

describe("anon-write gate", () => {
  const prevMode = process.env.AUTH_MODE;
  afterEach(() => { if (prevMode === undefined) delete process.env.AUTH_MODE; else process.env.AUTH_MODE = prevMode; });

  it("classifies write names, keeping pure calculators open", () => {
    for (const n of ["field-create", "zones-create", "feedPost", "listings-add", "unlist", "portal-approve"]) assert.equal(isWriteActionName(n), true, n);
    for (const n of ["field-list", "feed-list", "get", "statement", "public-page", "share-get"]) assert.equal(isWriteActionName(n), false, n);
    assert.equal(isWriteActionName("generate-outline", () => ({ ok: true, result: { outline: [] } })), false);
    assert.equal(isWriteActionName("generateInvoice", (ctx, s) => { s.invoices.push(1); saveState(); }), true); // eslint-disable-line no-undef
  });

  it("refuses anonymous writes with auth_required and never runs the handler", async () => {
    let ran = 0;
    const map = new Map();
    const reg = guardAnonWrites((d, n, h) => map.set(`${d}.${n}`, h));
    reg("x", "item-create", () => { ran++; return { ok: true }; });
    reg("x", "item-update", async () => { ran++; return { ok: true }; });
    for (const ctx of [{}, null, undefined, { actor: { userId: "anon" } }, { actor: { userId: "guest" } }, { userId: "anonymous" }]) {
      const r = map.get("x.item-create")(ctx, {}, {});
      assert.equal(r.ok, false); assert.equal(r.error, "auth_required"); assert.equal(r.status, 401);
      const r2 = map.get("x.item-update")(ctx, {}, {});
      assert.ok(r2 instanceof Promise, "async handlers stay promise-returning");
      assert.equal((await r2).error, "auth_required");
    }
    assert.equal(ran, 0);
    assert.deepEqual(map.get("x.item-create")({ actor: { userId: "u1" } }, {}, {}), { ok: true });
  });

  it("leaves reads and allowlisted public actions open to anonymous callers", () => {
    const map = new Map();
    const reg = guardAnonWrites((d, n, h) => map.set(`${d}.${n}`, h));
    reg("x", "item-list", () => ({ ok: true, items: [] }));
    reg("welding", "portal-approve", () => ({ ok: true }));
    reg("creative", "prooflink-public-comment", () => ({ ok: true }));
    for (const k of ["x.item-list", "welding.portal-approve", "creative.prooflink-public-comment"]) assert.equal(map.get(k)({ actor: null }, {}, {}).ok, true, k);
  });

  it("AUTH_MODE=public keeps anonymous writes (matches the server H1 gate)", () => {
    process.env.AUTH_MODE = "public";
    const map = new Map();
    guardAnonWrites((d, n, h) => map.set(`${d}.${n}`, h))("x", "item-create", () => ({ ok: true }));
    assert.equal(map.get("x.item-create")({}, {}, {}).ok, true);
  });

  it("is idempotent and keeps the real handler source visible", () => {
    const base = (d, n, h) => h;
    const g = guardAnonWrites(base);
    assert.equal(guardAnonWrites(g), g);
    const h = (ctx, a, params) => params.fieldId;
    assert.equal(g("x", "a-create", h).toString(), h.toString());
  });

  it("agriculture: anon field-create refused, member create and list work", () => {
    globalThis._concordSTATE = globalThis._concordSTATE || {};
    const m = collect(registerAgriculture);
    assert.equal(m.get("agriculture.field-create")({}, {}, { name: "North 40", acres: 40 }).error, "auth_required");
    const u = { actor: { userId: "gate_u1", role: "member" }, userId: "gate_u1" };
    const c = m.get("agriculture.field-create")(u, {}, { name: "North 40", acreage: 40, lat: 41.5, lng: -93.6, currentCrop: "corn" });
    assert.equal(c.ok, true, JSON.stringify(c));
    const list = m.get("agriculture.field-list")(u, {}, {});
    assert.ok(list.result.fields.some((f) => f.id === c.result.field.id));
    assert.equal(m.get("agriculture.field-list")({}, {}, {}).ok, true, "reads stay open");
  });
});
