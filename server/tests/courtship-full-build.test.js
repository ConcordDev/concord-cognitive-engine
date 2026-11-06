// Courtship full build (B8) — the legs the GB-1021 build adds over the
// shipped romance engine, against REAL migrated DBs (migrations 206 + 480
// + the world roster of 042, minimal shape):
//
//   S1  the declaration: the registry carries courtship at REAL_LIVE with
//       liveFromSubstrate (the manifest + badge legs are FE-pinned).
//   S2  the names leg + the pregnancies read: an NPC partner's name
//       resolves from world_npcs into the list / marriages / pregnancies
//       payloads; an NPC with no roster row resolves to NULL (never a
//       fabricated name); a player partner's payload carries NO raw
//       account id for the other party and a null name; listPregnancies
//       returns the caller's own unborn pregnancies only.
//   S4  the export provider: caller-scoped over courtships + marriages +
//       children; the other party appears as kind + name, never a raw id;
//       a third account exports nothing.
//   S5  the spouses read carries the resolved name beside the npcId.
//
// The engine, the consent machinery, and the stores are the shipped,
// protected core — this suite pins only the build's additions.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCourtshipMacros from "../domains/courtship.js";
import { up as upRomance } from "../migrations/206_romance.js";
import { up as upConsent } from "../migrations/480_player_courtship_consent.js";
import { collectLensExport, hasLensExportProvider } from "../lib/lens-export.js";
import { getIntegration } from "../lib/integration-registry.js";

function freshDb() {
  const db = new Database(":memory:");
  upRomance(db);
  upConsent(db);
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, npc_emergent_id TEXT, faction TEXT, world_id TEXT);
    CREATE TABLE npc_relations (npc_id TEXT, related_npc_id TEXT);
    INSERT INTO world_npcs (id, npc_emergent_id) VALUES ('npc_lyra', 'Lyra');
  `);
  return db;
}

function collectMacros() {
  const map = new Map();
  registerCourtshipMacros((domain, name, handler) => map.set(name, handler));
  return map;
}

const ctxFor = (db, userId) => ({ db, actor: { userId } });
const ALICE = "user_alice";
const BOB = "user_bob";
const CAROL = "user_carol";

// Drive a full NPC lifecycle for `userId` with npc_lyra: interact to the
// engage floor, propose, raise to the marry floor, wed. Returns macros.
async function wedNpc(macros, db, userId) {
  for (let i = 0; i < 30; i++) {
    const r = await macros.get("interact")(ctxFor(db, userId), { partnerKind: "npc", partnerId: "npc_lyra", sentiment: 1 });
    if (r.affinity >= 0.7) break;
  }
  const prop = await macros.get("propose")(ctxFor(db, userId), { partnerKind: "npc", partnerId: "npc_lyra" });
  assert.equal(prop.ok, true, "propose at the engage floor");
  for (let i = 0; i < 12; i++) {
    const r = await macros.get("interact")(ctxFor(db, userId), { partnerKind: "npc", partnerId: "npc_lyra", sentiment: 1 });
    if (r.affinity >= 0.85) break;
  }
  const wed = await macros.get("wed")(ctxFor(db, userId), { partnerKind: "npc", partnerId: "npc_lyra" });
  assert.equal(wed.ok, true, "wed at the marry floor");
  return wed;
}

describe("courtship full build", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("S1: the registry declares courtship REAL_LIVE from its own substrate", () => {
    const entry = getIntegration("courtship");
    assert.ok(entry, "registry entry exists");
    assert.equal(entry.tier, "REAL_LIVE");
    assert.equal(entry.liveFromSubstrate, true);
    assert.match(entry.note, /player_courtship/);
  });

  it("S2: list + get carry the NPC partner's resolved name", async () => {
    await macros.get("interact")(ctxFor(db, ALICE), { partnerKind: "npc", partnerId: "npc_lyra", sentiment: 1 });
    const list = await macros.get("list")(ctxFor(db, ALICE), {});
    assert.equal(list.courtships.length, 1);
    assert.equal(list.courtships[0].partnerName, "Lyra");
    const got = await macros.get("get")(ctxFor(db, ALICE), { partnerKind: "npc", partnerId: "npc_lyra" });
    assert.equal(got.courtship.partnerName, "Lyra");
  });

  it("S2: an NPC with no roster row resolves to a null name — never fabricated", async () => {
    await macros.get("interact")(ctxFor(db, ALICE), { partnerKind: "npc", partnerId: "npc_ghost", sentiment: 1 });
    const list = await macros.get("list")(ctxFor(db, ALICE), {});
    assert.equal(list.courtships.length, 1);
    assert.equal(list.courtships[0].partnerName, null);
  });

  it("S2: a player partner's payload strips the non-viewer party's id and names nothing", async () => {
    // Bob courts Alice (player partner). The helper's standing semantics,
    // pinned here exactly as shipped: presenting the row keeps the
    // VIEWER's own id wherever it appears (as author or as partner) and
    // strips the OTHER party's id — so to Alice the row keeps her own
    // partner_id and drops Bob's author id; to Bob it keeps his author id
    // and drops Alice's partner id; to a third party both drop. The
    // build's addition: no name is ever invented for a player partner.
    await macros.get("interact")(ctxFor(db, BOB), { partnerKind: "player", partnerId: ALICE, sentiment: 1 });
    const bobRow = db.prepare("SELECT * FROM player_courtship WHERE player_user_id = ?").get(BOB);
    const { presentCourtship } = await import("../lib/romance-engine.js");
    const asAlice = presentCourtship(bobRow, ALICE, db);
    assert.equal(asAlice.player_user_id, undefined, "the non-viewer party's id (the author, to Alice) is stripped");
    assert.equal(asAlice.partner_id, ALICE, "the viewer's own id stays");
    assert.equal(asAlice.partnerName, null, "no name is invented for a player partner");
    const asBob = presentCourtship(bobRow, BOB, db);
    assert.equal(asBob.player_user_id, BOB);
    assert.equal(asBob.partner_id, undefined, "the non-viewer party's id (the partner, to Bob) is stripped");
    assert.equal(asBob.partnerName, null);
  });

  it("S2: pregnancies list the caller's own unborn pregnancies, named, and no one else's", async () => {
    await wedNpc(macros, db, ALICE);
    await wedNpc(macros, db, BOB);
    const cA = await macros.get("conceive")(ctxFor(db, ALICE), { partnerKind: "npc", partnerId: "npc_lyra" });
    assert.equal(cA.ok, true);
    await macros.get("conceive")(ctxFor(db, BOB), { partnerKind: "npc", partnerId: "npc_lyra" });

    const mine = await macros.get("pregnancies")(ctxFor(db, ALICE), {});
    assert.equal(mine.ok, true);
    assert.equal(mine.pregnancies.length, 1);
    assert.equal(mine.pregnancies[0].pregnancyId, cA.pregnancyId);
    assert.equal(mine.pregnancies[0].partnerName, "Lyra");
    assert.equal(typeof mine.pregnancies[0].dueAt, "number");

    const carols = await macros.get("pregnancies")(ctxFor(db, CAROL), {});
    assert.deepEqual(carols.pregnancies, [], "a third account sees no pregnancies");

    // After birth the row leaves the unborn list.
    db.prepare("UPDATE player_pregnancies SET due_at = 1 WHERE id = ?").run(cA.pregnancyId);
    const born = await macros.get("birth")(ctxFor(db, ALICE), { pregnancyId: cA.pregnancyId, name: "Wren" });
    assert.equal(born.ok, true);
    const after = await macros.get("pregnancies")(ctxFor(db, ALICE), {});
    assert.deepEqual(after.pregnancies, [], "a born pregnancy leaves the list");
  });

  it("S5: the spouses read carries the resolved name beside the npcId", async () => {
    await wedNpc(macros, db, ALICE);
    const s = await macros.get("spouses")(ctxFor(db, ALICE), {});
    assert.equal(s.spouses.length, 1);
    assert.equal(s.spouses[0].npcId, "npc_lyra");
    assert.equal(s.spouses[0].partnerName, "Lyra");
  });

  it("S4: the export provider is caller-scoped and carries names, never raw ids", async () => {
    assert.equal(hasLensExportProvider("courtship"), true);
    await wedNpc(macros, db, ALICE);
    const cA = await macros.get("conceive")(ctxFor(db, ALICE), { partnerKind: "npc", partnerId: "npc_lyra" });
    db.prepare("UPDATE player_pregnancies SET due_at = 1 WHERE id = ?").run(cA.pregnancyId);
    await macros.get("birth")(ctxFor(db, ALICE), { pregnancyId: cA.pregnancyId, name: "Wren" });

    const runMacro = async () => ({ ok: true, artifacts: [] });
    const mine = await collectLensExport({ runMacro, domain: "courtship", ctx: ctxFor(db, ALICE) });
    const types = mine.artifacts.map((r) => r.type).sort();
    assert.deepEqual(types, ["child", "courtship", "marriage"]);
    const courtshipRow = mine.artifacts.find((r) => r.type === "courtship");
    assert.equal(courtshipRow.data.partnerName, "Lyra");
    assert.match(courtshipRow.title, /Lyra/);
    const blob = JSON.stringify(mine.artifacts);
    assert.ok(!blob.includes(BOB), "no other account id leaks into the export");

    const carols = await collectLensExport({ runMacro, domain: "courtship", ctx: ctxFor(db, CAROL) });
    assert.deepEqual(carols.artifacts, [], "a third account exports nothing");
  });
});
