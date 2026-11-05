// server/tests/alliance-build.test.js
//
// Alliance full lens build (B2) — pins, against the REAL registry
// handlers in server/domains/alliance.js with a stub users directory:
//   S1/F1  invites resolve the display name the platform itself shows;
//          failures are distinguishable (unknown user / ambiguous name /
//          lookup unavailable)
//   S2/F3  dm-send addresses a recipient by handle, with resolution
//          errors distinct from the alliance-member gate
//   S7/F7  message-edit exists — author-only, timestamped
//   S4/F4  the compatibility fixture from the first pass (overall 47.5)
//          reconstructs: strengths report their own similarity and the
//          result carries the composite's formula
//   S5/F5  concentration flags apply the stated threshold to each
//          partner's share of total dependency, with the basis returned
import test from "node:test";
import assert from "node:assert/strict";
import registerAllianceActions from "../domains/alliance.js";

const USERS = [
  { id: "u-owner", username: "ada", display_name: "Ada Lovelace", is_active: 1 },
  { id: "u-member", username: "bea", display_name: "Bea Knower", is_active: 1 },
  { id: "u-dup1", username: "sam1", display_name: "Sam Shared", is_active: 1 },
  { id: "u-dup2", username: "sam2", display_name: "Sam Shared", is_active: 1 },
  { id: "u-loner", username: "loner", display_name: "Lone Wolf", is_active: 1 },
];

function stubDb() {
  const cols = ["id", "username", "display_name", "is_active"].map((name) => ({ name }));
  function match(sql, value) {
    const activeFilter = sql.includes("is_active = 1");
    const pool = activeFilter ? USERS.filter((u) => u.is_active === 1) : USERS;
    if (sql.includes("WHERE id")) return pool.filter((u) => u.id === value);
    if (sql.includes("lower(display_name)")) return pool.filter((u) => u.display_name.toLowerCase() === String(value).toLowerCase());
    if (sql.includes("display_name")) return pool.filter((u) => u.display_name === value);
    if (sql.includes("lower(username)")) return pool.filter((u) => u.username.toLowerCase() === String(value).toLowerCase());
    if (sql.includes("username")) return pool.filter((u) => u.username === value);
    if (sql.includes("id =")) return pool.filter((u) => u.id === value);
    return [];
  }
  return {
    prepare(sql) {
      if (sql.startsWith("PRAGMA")) return { all: () => cols, get: () => null };
      return {
        get: (v) => match(sql, v)[0] || null,
        all: (v) => match(sql, v),
      };
    },
  };
}

function makeRegistry() {
  const actions = new Map();
  registerAllianceActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));
  return actions;
}
const db = stubDb();
const owner = { actor: { userId: "u-owner" }, db };
const member = { actor: { userId: "u-member" }, db };
const third = { actor: { userId: "u-third" }, db };

async function allianceWithMember(a) {
  const run = (name, ctx, params = {}, artifact) => a.get(`alliance.${name}`)(ctx, artifact, params);
  const created = await run("alliance-create", owner, { name: "Pact", type: "research" });
  const allianceId = created.result.alliance.id;
  const channelId = created.result.defaultChannel.id;
  const invite = await run("invite-create", owner, { allianceId, handle: "Bea Knower" });
  await run("invite-respond", member, { inviteId: invite.result.invite.id, accept: true });
  return { allianceId, channelId, run };
}

test("S1: invites resolve a displayed name; failures are distinguishable", async () => {
  globalThis._concordSTATE = {};
  const a = makeRegistry();
  const run = (name, ctx, params = {}) => a.get(`alliance.${name}`)(ctx, undefined, params);
  const created = await run("alliance-create", owner, { name: "Pact", type: "research" });
  const allianceId = created.result.alliance.id;

  const byName = await run("invite-create", owner, { allianceId, handle: "Bea Knower" });
  assert.equal(byName.ok, true);
  assert.equal(byName.result.invite.inviteeId, "u-member");

  const ambiguous = await run("invite-create", owner, { allianceId, handle: "Sam Shared" });
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.error, /more than one account/);

  const unknown = await run("invite-create", owner, { allianceId, handle: "Nobody Here" });
  assert.equal(unknown.error, "unknown user");

  const noDb = await a.get("alliance.invite-create")({ actor: { userId: "u-owner" } }, undefined, { allianceId, handle: "bea" });
  assert.equal(noDb.error, "user lookup unavailable");
});

test("S2: dm-send by handle resolves; unknown handle and non-member stay distinct", async () => {
  globalThis._concordSTATE = {};
  const a = makeRegistry();
  const { run } = await allianceWithMember(a);

  const sent = await run("dm-send", third, { handle: "Bea Knower", content: "hello from outside" });
  assert.equal(sent.ok, true);
  assert.equal(sent.result.message.toId, "u-member");

  const ghost = await run("dm-send", third, { handle: "Ghost Person", content: "hi" });
  assert.equal(ghost.error, "unknown user");

  const loner = await run("dm-send", third, { toId: "u-loner", content: "hi" });
  assert.equal(loner.error, "recipient not found");
});

test("S7: message-edit edits the author's own message and stamps it", async () => {
  globalThis._concordSTATE = {};
  const a = makeRegistry();
  const { channelId, run } = await allianceWithMember(a);
  const sent = await run("message-send", owner, { channelId, content: "first draft" });
  const messageId = sent.result.message.id;

  const edited = await run("message-edit", owner, { channelId, messageId, content: "revised" });
  assert.equal(edited.ok, true);
  assert.equal(edited.result.message.content, "revised");
  assert.ok(edited.result.message.editedAt);

  const foreign = await run("message-edit", member, { channelId, messageId, content: "hijack" });
  assert.equal(foreign.ok, false);
  assert.match(foreign.error, /only the author/);
});

test("S4: the pass's compatibility fixture reconstructs exactly", async () => {
  globalThis._concordSTATE = {};
  const a = makeRegistry();
  const artifact = {
    data: {
      partnerA: { name: "A", capabilities: ["a", "b", "c"], values: ["x", "y"], resources: ["r1", "r2", "r3"], strengths: ["s1", "s2"] },
      partnerB: { name: "B", capabilities: ["b", "c", "d"], values: ["x", "z"], resources: ["r2", "r3", "r4"], strengths: ["s3", "s4"] },
    },
  };
  const r = await a.get("alliance.compatibilityScore")(owner, artifact, {});
  assert.equal(r.result.componentScores.capabilitySimilarity, 50);
  assert.equal(r.result.componentScores.valuesAlignment, 33.33);
  assert.equal(r.result.componentScores.resourceSimilarity, 50);
  assert.equal(r.result.componentScores.strengthSimilarity, 0);
  assert.equal(r.result.componentScores.complementarity, 66.67);
  assert.equal(r.result.compositeScore, 47.5);
  assert.match(r.result.formula, /complementarity = mean/);
  assert.equal(r.result.weights.values, 0.35);
});

test("S5: concentration flags follow the stated share threshold", async () => {
  globalThis._concordSTATE = {};
  const a = makeRegistry();
  const artifact = {
    data: {
      alliances: [
        { partnerId: "p1", partnerName: "Big", dependencyPct: 60, critical: true, categories: ["x"] },
        { partnerId: "p2", partnerName: "Small", dependencyPct: 40, categories: ["y"] },
      ],
    },
  };
  const r = await a.get("alliance.riskAssessment")(owner, artifact, {});
  assert.equal(r.result.hhi, 5200);
  assert.equal(r.result.concentrationBasis, "a partner is concentrated when its share of total dependency is at least 30%");
  const byName = Object.fromEntries(r.result.concentrationRisks.map((c) => [c.partnerName, c]));
  assert.equal(byName.Big.normalizedPct, 60);
  assert.equal(byName.Small.normalizedPct, 40);
  // Shares are computed from the totals, so uneven raw inputs normalize:
  const artifact2 = {
    data: {
      alliances: [
        { partnerId: "p1", partnerName: "Big", dependencyPct: 120, categories: ["x"] },
        { partnerId: "p2", partnerName: "Small", dependencyPct: 40, categories: ["y"] },
      ],
    },
  };
  const r2 = await a.get("alliance.riskAssessment")(owner, artifact2, {});
  const byName2 = Object.fromEntries(r2.result.concentrationRisks.map((c) => [c.partnerName, c]));
  assert.equal(byName2.Big.normalizedPct, 75);
  assert.equal(byName2.Small.normalizedPct, 25);
  assert.equal(byName2.Big.isConcentrated, true);
  assert.equal(byName2.Small.isConcentrated, false);
});
