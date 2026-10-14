// INC-SWEEP law F5 — contract version savedBy + esign signerUserId must not
// expose the raw account uuid. Prefer display name / "member". Pin via
// version-save/list, esign, detail read-back, and serialize/hydrate restart.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLawActions from "../domains/law.js";
import { serializeLensState, hydrateLensState } from "../lib/lens-state-persistence.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`law.${name}`);
  assert.ok(fn, `law.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerLawActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const RAW_UUID = "6f4308d5-039c-45ac-bd9c-254d0c498b0d";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function assertNoRawUuid(value, path = "root") {
  if (typeof value === "string") {
    assert.ok(!UUID_RE.test(value), `${path} leaked uuid: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoRawUuid(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertNoRawUuid(v, `${path}.${k}`);
  }
}

describe("law contract identity labels (F5)", () => {
  it("version-save/list + esign + detail use member (no raw uuid)", () => {
    const ctx = { actor: { userId: RAW_UUID }, userId: RAW_UUID };
    const created = call("contract-create", ctx, {
      title: "Identity Contract",
      type: "services",
      counterparty: "Acme",
    });
    assert.equal(created.ok, true);
    const id = created.result.contract.id;

    call("clause-add", ctx, { contractId: id, title: "Confidentiality", text: "Keep secret." });
    const saved = call("contract-version-save", ctx, { id, label: "snap F5" });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.version.savedBy, "member");
    assertNoRawUuid(saved.result);

    const list = call("contract-version-list", ctx, { id });
    assert.equal(list.ok, true);
    assert.equal(list.result.versions[0].savedBy, "member");
    assertNoRawUuid(list.result);

    const esign = call("contract-esign", ctx, { id, party: "QA Signer", intent: "I agree." });
    assert.equal(esign.ok, true);
    assert.equal(esign.result.certificate.signerUserId, "member");
    assertNoRawUuid(esign.result);

    const detail = call("contract-detail", ctx, { id });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.contract.versions[0].savedBy, "member");
    const ownerSig = detail.result.contract.signatures.find((s) => s.side === "owner" || s.certificate);
    assert.ok(ownerSig, "owner signature missing");
    const signerId = ownerSig.certificate?.signerUserId ?? ownerSig.signerUserId;
    assert.equal(signerId, "member");
    assertNoRawUuid(detail.result);
  });

  it("prefers actor displayName when present", () => {
    const ctx = {
      actor: { userId: RAW_UUID, displayName: "Ramaj QA" },
      userId: RAW_UUID,
    };
    const created = call("contract-create", ctx, { title: "Named Actor", type: "nda", counterparty: "X" });
    const id = created.result.contract.id;
    const saved = call("contract-version-save", ctx, { id, label: "v1" });
    assert.equal(saved.result.version.savedBy, "Ramaj QA");
    assertNoRawUuid(saved.result);
  });

  it("restart persistence: serialize/hydrate keeps labels, never raw uuid", () => {
    const ctx = { actor: { userId: RAW_UUID }, userId: RAW_UUID };
    const created = call("contract-create", ctx, {
      title: "Persist Identity",
      type: "services",
      counterparty: "Acme",
    });
    const id = created.result.contract.id;
    call("clause-add", ctx, { contractId: id, title: "A", text: "Body." });
    call("contract-version-save", ctx, { id, label: "persist" });
    call("contract-esign", ctx, { id, party: "Signer", intent: "ok" });

    const snap = serializeLensState(globalThis._concordSTATE);
    const persisted = JSON.parse(JSON.stringify(snap));
    const next = { dtus: new Map() };
    hydrateLensState(next, persisted);
    globalThis._concordSTATE = next;

    const detail = call("contract-detail", ctx, { id });
    assert.equal(detail.ok, true, JSON.stringify(detail));
    assert.equal(detail.result.contract.title, "Persist Identity");
    assert.equal(detail.result.contract.versions[0].savedBy, "member");
    assertNoRawUuid(detail.result);

    const list = call("contract-version-list", ctx, { id });
    assert.equal(list.result.versions[0].savedBy, "member");
    assertNoRawUuid(list.result);
  });

  it("legacy stored uuid is scrubbed on detail/list read-back", () => {
    const ctx = { actor: { userId: RAW_UUID }, userId: RAW_UUID };
    const created = call("contract-create", ctx, { title: "Legacy", type: "nda", counterparty: "Y" });
    const id = created.result.contract.id;
    // Simulate pre-fix stored rows that still hold the raw uuid.
    const c = globalThis._concordSTATE.lawLens.contracts.get(RAW_UUID).find((x) => x.id === id);
    c.versions = [{
      version: 1, label: "old", body: "x", clauseCount: 0,
      savedBy: RAW_UUID, savedAt: new Date().toISOString(),
    }];
    c.signatures = [{
      party: "Old", side: "owner", signedAt: new Date().toISOString(),
      signerUserId: RAW_UUID,
      certificate: {
        certificateId: "cert_old", party: "Old", intent: "ok",
        signedAt: new Date().toISOString(), documentHash: "a", signatureHash: "b",
        signerUserId: RAW_UUID, side: "owner", via: "app", algorithm: "sha256",
      },
    }];

    const detail = call("contract-detail", ctx, { id });
    assert.equal(detail.result.contract.versions[0].savedBy, "member");
    assert.equal(detail.result.contract.signatures[0].signerUserId, "member");
    assert.equal(detail.result.contract.signatures[0].certificate.signerUserId, "member");
    assertNoRawUuid(detail.result);

    const list = call("contract-version-list", ctx, { id });
    assert.equal(list.result.versions[0].savedBy, "member");
    assertNoRawUuid(list.result);
  });
});
