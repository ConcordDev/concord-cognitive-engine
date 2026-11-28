// tests/lens-run-actor-identity.test.js
//
// SECURITY (2026-11-28): the acting account on a lens action is the signed-in
// account, never an id in the request. Found during the lens redesign triage
// and reproduced live on a dev server with two real accounts: signed in as one,
// naming the other's id in body.input, conkay.affect_state returned the other
// account's private emotional-state record and conkay.observe wrote to it.
// video's YouTube actions read params.userId before any session field, and the
// session fields they tried (ctx.user.id, ctx.actor.id) are never set on an
// HTTP ctx — so every video action ran as whoever the request named.
//
// Two layers are pinned here:
//   1. the guard (lib/actor-identity.js) refuses a spoofed actor id on
//      POST /api/lens/run and POST /api/lens/:domain/:id/run, in every body
//      shape the dispatch accepts, while letting the reviewed target actions
//      (block, share, invite, view a profile) through;
//   2. the macros themselves read the session first, so even a call that never
//      passed the guard (an internal ctx, a future route) cannot act as someone
//      else — two real accounts, the real macros, the real server.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { actorIdentityGuard, claimedActors, LENS_TARGET_FIELDS, LENS_ACTOR_FIELDS } from "../lib/actor-identity.js";
import { scanLensActorFields } from "../scripts/scan-lens-actor-fields.mjs";

// ── 1. The guard ─────────────────────────────────────────────────────────

function serve(user, authMode = "hybrid") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { if (user) req.user = { id: user }; next(); });
  app.use(actorIdentityGuard({ authMode }));
  app.post("/api/lens/run", (_req, res) => res.json({ ok: true, reached: true }));
  app.post("/api/lens/:domain/:id/run", (_req, res) => res.json({ ok: true, reached: true }));
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}
async function post(server, path, body) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

describe("lens dispatch guard — a spoofed actor id is refused", () => {
  it("refuses another account's id in body.input, in every shape the dispatch accepts", async () => {
    const s = await serve("alice");
    try {
      const shapes = [
        ["/api/lens/run", { domain: "conkay", name: "affect_state", input: { userId: "victim" } }],
        ["/api/lens/run", { domain: "conkay", action: "observe", input: { userId: "victim", text: "hi" } }],
        ["/api/lens/run", { domain: "housing", action: "mine", userId: "victim" }], // legacy flat body
        ["/api/lens/run", { domain: "housing", action: "rename", input: { artifact: { data: { ownerId: "victim" } } } }], // redundant wrapper
        ["/api/lens/run", { domain: "lens", name: "run", input: { id: "a1", action: "youtube-disconnect", params: { userId: "victim" } } }], // generic lens.run
        ["/api/lens/video/a1/run", { action: "upload-to-youtube", params: { userId: "victim" } }],
        ["/api/lens/run", { domain: "combat_polish", action: "change_stance", input: { actorId: "victim" } }],
        ["/api/lens/run", { domain: "achievements", action: "mine", input: { playerId: 42 } }],
        ["/api/lens/run", { domain: "social", action: "block", input: { userId: "bob", ownerId: "victim" } }], // a listed target field does not exempt the others
      ];
      for (const [path, body] of shapes) {
        const r = await post(s, path, body);
        assert.equal(r.status, 403, `${path} ${JSON.stringify(body)}`);
        assert.equal(r.body.error, "not_your_account");
        assert.equal(r.body.reached, undefined, "the handler never ran");
      }
    } finally { s.close(); }
  });

  it("lets through your own id, no id at all, and the reviewed target actions", async () => {
    const s = await serve("alice");
    try {
      for (const [path, body] of [
        ["/api/lens/run", { domain: "conkay", name: "affect_state", input: { userId: "alice" } }],
        ["/api/lens/run", { domain: "conkay", name: "affect_state", input: {} }],
        ["/api/lens/run", { domain: "social", action: "block", input: { userId: "bob" } }],
        ["/api/lens/run", { domain: "timeline", action: "user-mute", input: { userId: "bob" } }],
        ["/api/lens/run", { domain: "pets", action: "access-grant", input: { userId: "bob" } }],
        ["/api/lens/run", { domain: "timeline", action: "album-list", input: { ownerId: "bob" } }],
        ["/api/lens/run", { domain: "admin", action: "tenantAction", input: { userId: "bob", action: "note" } }],
        ["/api/lens/run", { domain: "conkay", name: "observe", input: { text: "a userId: victim in prose is not a field" } }],
      ]) {
        const r = await post(s, path, body);
        assert.equal(r.status, 200, `${path} ${JSON.stringify(body)}`);
        assert.equal(r.body.reached, true);
      }
    } finally { s.close(); }
  });

  it("signed out: 401 when an actor id is claimed; the single-user public mode is exempt", async () => {
    const anon = await serve(null);
    try { assert.equal((await post(anon, "/api/lens/run", { domain: "housing", action: "mine", input: { userId: "victim" } })).status, 401); }
    finally { anon.close(); }
    const pub = await serve(null, "public");
    try { assert.equal((await post(pub, "/api/lens/run", { domain: "housing", action: "mine", input: { userId: "victim" } })).status, 200); }
    finally { pub.close(); }
  });

  it("reads only: a GET carries no claim", () => {
    assert.deepEqual(claimedActors("GET", "/api/lens/run", { domain: "conkay", input: { userId: "victim" } }), []);
  });
});

// ── 2. The target list is pinned to the code ─────────────────────────────

// Actions the scanner reports reading an actor field with no session fallback on
// the line, reviewed and found NOT to name someone else: the field is unused by
// the action (the scan region runs past it), already must equal the caller, or is
// read session-first further down. The guard's default (refuse a mismatch) is
// right for all of them, so they are deliberately not in LENS_TARGET_FIELDS.
const REVIEWED_NOT_TARGET = {
  "agents.get": "reads agentId; the userId match is in the next registration's text",
  "forge.generate": "passes input to the template engine; actorId is not an account there",
  "scope.royaltyPreview": "reads dtuId only",
  "lens.bulkCreate": "ownerId comes from ctx.actor",
  "integration.list": "static catalogue",
  "redis.stats": "admin-gated stats; no account field used",
  "city.getStream": "session first (userId from ctx, input as backup)",
  "garage.get": "ownerId is projected for display, not taken from input",
  "accounting.invoice-webhook-mark-paid": "requireOwner: must equal the caller",
  "reels.create_from_post": "session first (ctx.actor.userId || input.userId)",
  "ingest.submit_url": "fixed 2026-11-28: session first",
  "quest.start": "fixed 2026-11-28: session first",
  "social.discover": "fixed 2026-11-28: session first",
  "federation.inbox": "session first; the direct match is the REST inbox route that follows it in server.js",
};

describe("lens dispatch guard — the target list matches the code", () => {
  const rows = scanLensActorFields();

  it("no action takes the actor from the request before the session (except reviewed targets)", () => {
    const bad = rows.filter((r) => r.kind === "fallback" && !(LENS_TARGET_FIELDS[`${r.domain}.${r.action}`] || []).includes(r.field));
    assert.deepEqual(bad.map((r) => `${r.domain}.${r.action} ${r.field} (${r.file}:${r.line})`), []);
  });

  it("every action that reads an actor field directly is either a reviewed target or reviewed as not one", () => {
    const unreviewed = rows.filter((r) => r.kind === "direct" && !(LENS_TARGET_FIELDS[`${r.domain}.${r.action}`] || []).includes(r.field) && !REVIEWED_NOT_TARGET[`${r.domain}.${r.action}`]);
    assert.deepEqual(unreviewed.map((r) => `${r.domain}.${r.action} ${r.field} (${r.file}:${r.line})`), [],
      "a new action reads an account id from its input: add it to LENS_TARGET_FIELDS only if it names someone else on purpose and its handler checks the caller may do that; otherwise read the session first");
  });

  it("every listed target field is still read by its action (no stale exemptions)", () => {
    const read = new Set(rows.map((r) => `${r.domain}.${r.action} ${r.field}`));
    const stale = Object.entries(LENS_TARGET_FIELDS).flatMap(([k, fs]) => fs.filter((f) => !read.has(`${k} ${f}`)).map((f) => `${k} ${f}`));
    assert.deepEqual(stale, []);
    for (const fs of Object.values(LENS_TARGET_FIELDS)) for (const f of fs) assert.ok(LENS_ACTOR_FIELDS.includes(f));
  });
});

// ── 3. Two real accounts, the real macros ────────────────────────────────

describe("two accounts — the macros act only for the signed-in account", async () => {
  const { load } = await import("./depth/_harness.js");
  const { runMacro, makeInternalCtx, STATE } = await load();
  // A signed-in member, the way an HTTP request's ctx looks (not the internal owner ctx).
  const member = (userId) => { const c = makeInternalCtx(userId); c.actor = { userId, orgId: "default", role: "member", scopes: ["read", "write"] }; c.internal = false; return c; };
  const t = Date.now().toString(36);
  const victim = `victim-${t}`, attacker = `attacker-${t}`;
  const run = (d, m, input, who) => runMacro(d, m, input, member(who));
  const lensAction = async (domain, action, params, who) => {
    const c = member(who);
    const id = `lens-${domain}-${t}-${Math.random().toString(36).slice(2, 8)}`;
    STATE.lensArtifacts.set(id, { id, domain, type: domain, data: {}, ownerId: who, createdBy: who });
    return runMacro("lens", "run", { id, action, params }, c);
  };
  after(() => {});

  it("conkay.affect_state: naming the victim's id returns the caller's own record, not the victim's", async () => {
    const seeded = await run("conkay", "observe", { text: "I am furious and exhausted today" }, victim);
    assert.equal(seeded.ok, true, JSON.stringify(seeded));
    const victimOwn = await run("conkay", "affect_state", {}, victim);
    assert.equal(victimOwn.state.turns, 1);
    const stolen = await run("conkay", "affect_state", { userId: victim }, attacker);
    assert.equal(stolen.ok, true);
    assert.equal(stolen.state.turns, 0, "the attacker sees a fresh record of their own");
    assert.notDeepEqual(stolen.state, victimOwn.state);
  });

  it("conkay.observe: writing with the victim's id changes the caller's record and leaves the victim's alone", async () => {
    const before = await run("conkay", "affect_state", {}, victim);
    await run("conkay", "observe", { userId: victim, text: "wonderful calm joy" }, attacker);
    const afterV = await run("conkay", "affect_state", {}, victim);
    assert.deepEqual(afterV.state, before.state, "the victim's record did not move");
    const attackerOwn = await run("conkay", "affect_state", {}, attacker);
    assert.equal(attackerOwn.state.turns, 1, "the write landed on the caller");
  });

  it("video YouTube: another account's connection can be neither seen nor disconnected", async () => {
    const { persistConnectorToken, getConnectorToken } = await import("../lib/connector-tokens.js");
    const { youtubeConnectorId } = await import("../lib/social-publish-youtube.js");
    const cid = youtubeConnectorId("default");
    // a mocked Google token on the victim's account (no network: status and disconnect only read and delete the row)
    persistConnectorToken(STATE.db, victim, cid, { access_token: "ya29.mock-victim", refresh_token: "1//mock", expires_at: Date.now() + 3600_000, scope: "youtube.upload" });
    const unwrap = (r) => (r && typeof r === "object" && "result" in r ? r.result : r);

    const peek = unwrap(await lensAction("video", "youtube-connect-status", { userId: victim }, attacker));
    assert.equal(peek.ok, true);
    assert.equal(peek.connected, false, "the attacker sees their own (absent) connection, not the victim's");

    const cut = unwrap(await lensAction("video", "youtube-disconnect", { userId: victim }, attacker));
    assert.equal(cut.ok, true);
    assert.ok(getConnectorToken(STATE.db, victim, cid), "the victim's YouTube token is still there");

    const own = unwrap(await lensAction("video", "youtube-connect-status", {}, victim));
    assert.equal(own.connected, true, "the victim still sees their connection");
  });
});
