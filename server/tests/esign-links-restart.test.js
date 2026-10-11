// INC-68 — signing links lived only in STATE.esignLinks, a Map the process
// snapshot never walked. Envelopes (toolsLens) survived a restart; the
// token 404'd. This is the same JSON round-trip _serializeState writes
// under lensState.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerToolsActions from "../domains/tools.js";
import { viewSigningLink, signViaLink, signingUrl } from "../lib/esign-links.js";
import { serializeLensState, hydrateLensState, LENS_STATE_KEYS } from "../lib/lens-state-persistence.js";
import { CANONICAL_FRONTEND_URL, _resetFrontendUrlWarningForTest, setFrontendUrlLogger } from "../lib/frontend-url.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`tools.${name}`);
  if (!fn) throw new Error(`tools.${name} not registered`);
  return fn(ctx, { id: null, data: params, meta: {} }, params);
}

function restartFromSnapshot() {
  const persisted = JSON.parse(JSON.stringify(serializeLensState(globalThis._concordSTATE)));
  const next = {};
  hydrateLensState(next, persisted);
  globalThis._concordSTATE = next;
  return persisted;
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const DAY_MS = 24 * 60 * 60 * 1000;

before(() => { registerToolsActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = {};
});

async function sendOne() {
  const created = await call("esign-create", ctxA, {
    title: "Mutual NDA",
    document: "The parties agree to keep this confidential.",
    parties: [{ name: "Alice", isSender: true }, { name: "Bob", email: "bob@example.com" }],
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  const env = created.result.envelope;
  const sent = await call("esign-send", ctxA, { envelopeId: env.id });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.equal(sent.result.links.length, 1);
  const token = sent.result.links[0].url.split("/sign/")[1];
  assert.ok(token && token.length >= 16);
  return { env, token };
}

describe("e-sign links survive a snapshot restart", () => {
  it("registers esignLinks on the snapshot key list", () => {
    assert.ok(LENS_STATE_KEYS.includes("esignLinks"));
  });

  it("resolves and signs a link after the same save/reload a restart performs", async () => {
    const { env, token } = await sendOne();
    const blob = restartFromSnapshot();
    assert.equal(blob.esignLinks.__type, "Map");
    assert.equal(JSON.stringify(blob.esignLinks).includes(token), true);
    assert.ok(globalThis._concordSTATE.esignLinks instanceof Map);

    const listed = await call("esign-list", ctxA, { status: "out_for_signature" });
    assert.equal(listed.result.envelopes.length, 1);
    assert.equal(listed.result.envelopes[0].id, env.id);

    const view = await viewSigningLink(token);
    assert.equal(view.ok, true, JSON.stringify(view));
    assert.equal(view.result.signer.name, "Bob");
    assert.equal(view.result.envelopeStatus, "out_for_signature");

    const signed = await signViaLink(token, { typedName: "Bob Smith", consent: true, ip: "203.0.113.5" });
    assert.equal(signed.ok, true, JSON.stringify(signed));
    assert.equal(signed.result.completed, false);

    restartFromSnapshot();
    const replay = await signViaLink(token, { typedName: "Bob Smith", consent: true });
    assert.equal(replay.ok, false);
    assert.equal(replay.error, "party already signed");
    const detail = await call("esign-detail", ctxA, { envelopeId: env.id });
    assert.equal(detail.result.envelope.parties[1].status, "signed");
    assert.equal(detail.result.envelope.parties[1].typedName, "Bob Smith");
  });

  it("keeps a voided envelope's links revoked after reload", async () => {
    const { env, token } = await sendOne();
    restartFromSnapshot();
    const view = await viewSigningLink(token);
    assert.equal(view.ok, true, JSON.stringify(view));

    const voided = await call("esign-void", ctxA, { envelopeId: env.id, reason: "sent in error" });
    assert.equal(voided.ok, true, JSON.stringify(voided));
    assert.equal(voided.result.envelope.status, "voided");

    const blob = restartFromSnapshot();
    assert.equal(JSON.stringify(blob.esignLinks || {}).includes(token), false);
    const after = await viewSigningLink(token);
    assert.equal(after.ok, false);
    assert.equal(after.error, "link_not_found");
    const again = await signViaLink(token, { typedName: "Bob", consent: true });
    assert.equal(again.error, "link_not_found");

    restartFromSnapshot();
    assert.equal((await viewSigningLink(token)).error, "link_not_found");
  });

  it("rejects a link older than 30 days and still serves a younger one", async () => {
    const young = await sendOne();
    const old = await sendOne();
    const store = globalThis._concordSTATE.esignLinks;
    store.get(young.token).createdAt = new Date(Date.now() - 29 * DAY_MS).toISOString();
    store.get(old.token).createdAt = new Date(Date.now() - 31 * DAY_MS).toISOString();

    const still = await viewSigningLink(young.token);
    assert.equal(still.ok, true, JSON.stringify(still));
    assert.equal(still.result.signer.name, "Bob");

    const expired = await viewSigningLink(old.token);
    assert.equal(expired.ok, false);
    assert.equal(expired.error, "link_not_found");
    assert.equal(store.has(old.token), false);
    assert.equal((await signViaLink(old.token, { typedName: "Bob", consent: true })).error, "link_not_found");

    restartFromSnapshot();
    assert.equal((await viewSigningLink(young.token)).ok, true);
    assert.equal((await viewSigningLink(old.token)).error, "link_not_found");
  });

  it("mints signing links on the canonical origin when FRONTEND_URL is the template placeholder", () => {
    const prevNode = process.env.NODE_ENV;
    const prevFront = process.env.FRONTEND_URL;
    const prevNext = process.env.NEXT_PUBLIC_FRONTEND_URL;
    const prevConcord = process.env.CONCORD_FRONTEND_URL;
    process.env.NODE_ENV = "production";
    process.env.FRONTEND_URL = "https://yourdomain.com";
    delete process.env.NEXT_PUBLIC_FRONTEND_URL;
    delete process.env.CONCORD_FRONTEND_URL;
    _resetFrontendUrlWarningForTest();
    const logs = [];
    setFrontendUrlLogger((level, event) => logs.push({ level, event }));
    try {
      assert.equal(signingUrl("tok_example_value"), `${CANONICAL_FRONTEND_URL}/sign/tok_example_value`);
      assert.equal(logs[0].level, "error");
      assert.equal(logs[0].event, "frontend_url_placeholder");
    } finally {
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevFront === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = prevFront;
      if (prevNext === undefined) delete process.env.NEXT_PUBLIC_FRONTEND_URL;
      else process.env.NEXT_PUBLIC_FRONTEND_URL = prevNext;
      if (prevConcord === undefined) delete process.env.CONCORD_FRONTEND_URL;
      else process.env.CONCORD_FRONTEND_URL = prevConcord;
      _resetFrontendUrlWarningForTest();
      setFrontendUrlLogger(null);
    }
  });
});
