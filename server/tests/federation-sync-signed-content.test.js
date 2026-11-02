// POST /api/federation/v1/sync used to HMAC only (peerId, count, timestamp, DTU ids): a man in the middle
// (or any holder of one old signed package) could swap a DTU's title/core/human and keep the signature valid,
// and a captured package replayed forever. The signature now covers a SHA-256 of each DTU's
// (id, title, tier, tags, core, human), the receiver requires pkg.peerId === the authenticated `from`,
// refuses timestamps outside +-10 min, and refuses an already-seen signature. The old ids-only format is
// accepted only behind FEDERATION_LEGACY_SIG_ACCEPT=1. Everything below runs over real HTTP.

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createFederationPeeringRouter from "../routes/federation-peering.js";
import { registerPeer, signPackage } from "../emergent/federation-peering.js";
import crypto from "node:crypto";

const SECRET = "test" + "-secret-0123456789";
const DTU = { id: "dtu_1", title: "Shared note", tier: "atomic", tags: ["x"], core: { a: 1 }, human: { summary: "hi" } };

let server, base, STATE;

const post = async (body) => {
  const r = await fetch(`${base}/sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const make = (over = {}) => {
  const p = { peerId: "pod-b", count: 1, timestamp: new Date().toISOString(), dtus: [structuredClone(DTU)], ...over };
  p.signature = signPackage(SECRET, p);
  return p;
};
const legacySign = (p) => crypto.createHmac("sha256", SECRET).update(JSON.stringify({
  peerId: p.peerId, count: p.count, timestamp: p.timestamp, dtuIds: p.dtus.map((d) => d.id).sort(),
})).digest("hex");

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/federation/v1", createFederationPeeringRouter());
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}/api/federation/v1`;
});
after(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  STATE = { dtus: new Map(), shadowDtus: new Map() };
  globalThis._concordSTATE = STATE;
  registerPeer(STATE, { peerId: "pod-b", endpoint: "https://pod-b.example/api/federation/v1", trust: 0.9, sharedSecret: SECRET });
  registerPeer(STATE, { peerId: "pod-c", endpoint: "https://pod-c.example/api/federation/v1", trust: 0.9, sharedSecret: SECRET });
});
afterEach(() => { delete process.env.FEDERATION_LEGACY_SIG_ACCEPT; });

describe("POST /sync — signed content", () => {
  it("correctly signed new-format package: accepted and shadowed", async () => {
    const r = await post({ from: "pod-b", package: make() });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(STATE.shadowDtus.size, 1);
  });

  it("content tamper (title swapped, ids unchanged): 401 and nothing stored", async () => {
    const p = make();
    p.dtus[0].title = "EVIL title";
    const r = await post({ from: "pod-b", package: p });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "signature_invalid");
    assert.equal(STATE.shadowDtus.size, 0);
  });

  it("content tamper in core / human / tags / tier is also refused", async () => {
    for (const edit of [(d) => { d.core = { a: 2 }; }, (d) => { d.human = { summary: "x" }; }, (d) => { d.tags = ["y"]; }, (d) => { d.tier = "mega"; }]) {
      const p = make();
      edit(p.dtus[0]);
      const r = await post({ from: "pod-b", package: p });
      assert.equal(r.status, 401);
    }
    assert.equal(STATE.shadowDtus.size, 0);
  });

  it("replay of an accepted package: 409, not stored twice", async () => {
    const p = make();
    assert.equal((await post({ from: "pod-b", package: p })).status, 200);
    STATE.shadowDtus.clear();
    const r = await post({ from: "pod-b", package: p });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "replayed_package");
    assert.equal(STATE.shadowDtus.size, 0);
  });

  it("stale and future timestamps (outside +-10 min): 401, nothing stored", async () => {
    for (const ms of [-11 * 60_000, 11 * 60_000]) {
      const r = await post({ from: "pod-b", package: make({ timestamp: new Date(Date.now() + ms).toISOString() }) });
      assert.equal(r.status, 401);
      assert.equal(r.body.error, "timestamp_out_of_window");
    }
    assert.equal(STATE.shadowDtus.size, 0);
  });

  it("package signed by pod-b but presented as from pod-c: 401 peer_mismatch", async () => {
    const r = await post({ from: "pod-c", package: make({ peerId: "pod-b" }) });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "peer_mismatch");
    assert.equal(STATE.shadowDtus.size, 0);
  });

  it("legacy ids-only signature: refused by default, accepted with the flag", async () => {
    const p = make();
    p.signature = legacySign(p);
    const refused = await post({ from: "pod-b", package: p });
    assert.equal(refused.status, 401);
    assert.equal(STATE.shadowDtus.size, 0);

    process.env.FEDERATION_LEGACY_SIG_ACCEPT = "1";
    const ok = await post({ from: "pod-b", package: p });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(STATE.shadowDtus.size, 1);
  });
});
