// Privacy dedicated-set pins (FIX-privacy-001/002/004/008):
//  001 — DPO studio working sets persist per user (dpoGet/dpoSet), so a
//        consent-audit / data-inventory create survives reloads instead
//        of living only in browser memory.
//  002 — retentionSet refuses out-of-range / non-numeric windows in
//        words instead of silently clamping them to the 3650 max.
//  004 — dsarDelete / flowDelete remove the caller's OWN records only.
//  008 — the privacy lens registers an export provider, so the header
//        export contains the caller's own records instead of reporting
//        "no saved lens items" over a full lens.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPrivacyActions from "../domains/privacy.js";
import { collectLensExport, hasLensExportProvider } from "../lib/lens-export.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`privacy.${name}`);
  if (!fn) throw new Error(`privacy.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPrivacyActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const noArtifacts = async () => ({ ok: true, artifacts: [] });

describe("FIX-privacy-001 DPO working sets persist", () => {
  it("inventory + consents round-trip through dpoSet/dpoGet", () => {
    const inv = [{ category: "email", sensitive: false }, { category: "health_record", sensitive: true }];
    assert.equal(call("dpoSet", ctxA, { which: "inventory", items: inv }).ok, true);
    assert.equal(call("dpoSet", ctxA, { which: "consents", items: [{ subject: "person-1", status: "active", expiry: "" }] }).ok, true);
    const got = call("dpoGet", ctxA, {});
    assert.deepEqual(got.result.inventory, inv);
    assert.equal(got.result.consents.length, 1);
    assert.equal(got.result.consents[0].subject, "person-1");
  });

  it("working sets are the caller's own — another user sees none of them", () => {
    call("dpoSet", ctxA, { which: "inventory", items: [{ category: "email", sensitive: false }] });
    const gotB = call("dpoGet", ctxB, {});
    assert.deepEqual(gotB.result.inventory, []);
    assert.deepEqual(gotB.result.consents, []);
  });

  it("dpoSet validates in words: bad set name, missing category, missing subject", () => {
    assert.match(call("dpoSet", ctxA, { which: "other", items: [] }).error, /inventory or consents/);
    assert.equal(call("dpoSet", ctxA, { which: "inventory", items: [{ sensitive: true }] }).ok, false);
    assert.equal(call("dpoSet", ctxA, { which: "consents", items: [{ status: "active" }] }).ok, false);
  });
});

describe("FIX-privacy-002 retentionSet refuses out-of-range in words", () => {
  it("3650 is accepted; 3651 and a non-number are refused, not clamped", () => {
    assert.equal(call("retentionSet", ctxA, { category: "chat_history", windowDays: 3650, action: "delete" }).ok, true);
    const over = call("retentionSet", ctxA, { category: "chat_history", windowDays: 3651, action: "delete" });
    assert.equal(over.ok, false);
    assert.match(over.error, /between 0 and 3650/);
    assert.equal(call("retentionSet", ctxA, { category: "chat_history", windowDays: "abc", action: "delete" }).ok, false);
    // the refused writes changed nothing
    const got = call("retentionGet", ctxA, {});
    assert.equal(got.result.policies.find((p) => p.category === "chat_history").windowDays, 3650);
  });
});

describe("FIX-privacy-004 delete controls for requests and flows", () => {
  it("dsarDelete removes the caller's own request; another user's id is not found", () => {
    const sub = call("dsarSubmit", ctxA, { kind: "access", note: "please" });
    const id = sub.result.request.id;
    assert.equal(call("dsarDelete", ctxB, { dsarId: id }).ok, false);
    assert.equal(call("dsarList", ctxA, {}).result.totalRequests, 1);
    assert.equal(call("dsarDelete", ctxA, { dsarId: id }).ok, true);
    assert.equal(call("dsarList", ctxA, {}).result.totalRequests, 0);
  });

  it("flowDelete removes the caller's own flow; unknown ids refuse in words", () => {
    const reg = call("flowRegister", ctxA, { destination: "peer.example", direction: "outbound" });
    const id = reg.result.flow.id;
    assert.equal(call("flowDelete", ctxB, { flowId: id }).ok, false);
    assert.equal(call("flowDelete", ctxA, { flowId: id }).ok, true);
    assert.match(call("flowDelete", ctxA, { flowId: id }).error, /flow not found/);
  });
});

describe("FIX-privacy-008 header export provider", () => {
  it("privacy is registered as a state-backed export domain", () => {
    assert.equal(hasLensExportProvider("privacy"), true);
  });

  it("the caller's own records are export rows; another user's are absent", async () => {
    call("dsarSubmit", ctxA, { kind: "export", note: "mine" });
    call("flowRegister", ctxA, { destination: "peer.example", direction: "outbound" });
    call("dpoSet", ctxA, { which: "inventory", items: [{ category: "email", sensitive: false }] });
    call("dsarSubmit", ctxB, { kind: "access", note: "not yours" });

    const out = await collectLensExport({ runMacro: noArtifacts, domain: "privacy", ctx: ctxA });
    assert.equal(out.ok, true);
    assert.equal(out.stateBacked, true);
    const types = out.artifacts.map((r) => r.type);
    assert.ok(types.includes("dsar_request"), "caller's DSAR is an export row");
    assert.ok(types.includes("data_flow"), "caller's flow is an export row");
    assert.ok(types.includes("data_inventory_item"), "caller's DPO inventory is an export row");
    assert.ok(!JSON.stringify(out.artifacts).includes("not yours"), "no other user's records ride the export");
  });
});
