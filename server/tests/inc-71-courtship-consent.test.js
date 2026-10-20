// INC-71 — player partners need mutual consent, either spouse may dissolve,
// and birth is the carrier's due pregnancy with server-side skills.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCourtshipMacros from "../domains/courtship.js";
import { up as upRomance } from "../migrations/206_romance.js";
import { ROMANCE_CONSTANTS } from "../lib/romance-engine.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "courtship");
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`courtship.${name} not registered`);
  return fn(ctx, input);
}
before(() => registerCourtshipMacros(register));

function freshDb() {
  const db = new Database(":memory:");
  upRomance(db);
  db.exec(`
    CREATE TABLE player_skill_levels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      skill_type TEXT NOT NULL,
      native_world_type TEXT NOT NULL DEFAULT 'hub',
      level INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

const A = { actor: { userId: "user_a" }, userId: "user_a" };
const B = { actor: { userId: "user_b" }, userId: "user_b" };

async function raise(db, userId, partnerId, target) {
  let last = 0;
  for (let i = 0; i < 40; i++) {
    const r = await call("interact", { db, actor: { userId }, userId }, {
      partnerKind: "player", partnerId, sentiment: 1,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    last = r.affinity;
    if (last >= target) break;
  }
  return last;
}

function noRawIds(value, ...ids) {
  const blob = JSON.stringify(value);
  for (const id of ids) assert.equal(blob.includes(id), false, `leaked ${id} in ${blob}`);
}

describe("INC-71 player courtship consent", () => {
  let db;
  beforeEach(() => { db = freshDb(); A.db = db; B.db = db; });

  it("wed is consent_required until B accepts; B can decline; either party can dissolve", async () => {
    const early = await call("wed", A, { partnerKind: "player", partnerId: "user_b" });
    assert.equal(early.ok, false);
    assert.equal(early.reason, "consent_required");
    noRawIds(early, "user_b");

    const aff = await raise(db, "user_a", "user_b", ROMANCE_CONSTANTS.MARRY_THRESHOLD);
    assert.ok(aff >= ROMANCE_CONSTANTS.MARRY_THRESHOLD);

    const proposed = await call("propose", A, { partnerKind: "player", partnerId: "user_b" });
    assert.equal(proposed.ok, true);
    assert.equal(proposed.status, "pending");
    assert.ok(proposed.proposalId);
    noRawIds(proposed, "user_a", "user_b");

    const still = await call("wed", A, { partnerKind: "player", partnerId: "user_b" });
    assert.equal(still.reason, "consent_required");

    const notices = await call("notices", B, {});
    assert.equal(notices.ok, true);
    assert.equal(notices.notices.length, 1);
    assert.equal(notices.notices[0].proposalId, proposed.proposalId);
    noRawIds(notices, "user_a");

    const declined = await call("decline", B, { proposalId: proposed.proposalId });
    assert.equal(declined.ok, true);
    assert.equal(declined.status, "declined");
    noRawIds(declined, "user_a");
    assert.equal((await call("wed", A, { partnerKind: "player", partnerId: "user_b" })).reason, "consent_required");

    const again = await call("propose", A, { partnerKind: "player", partnerId: "user_b" });
    assert.equal(again.status, "pending");
    const accepted = await call("accept", B, { proposalId: again.proposalId });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.status, "engaged");
    noRawIds(accepted, "user_a");

    const wedded = await call("wed", A, { partnerKind: "player", partnerId: "user_b" });
    assert.equal(wedded.ok, true, JSON.stringify(wedded));
    assert.equal(wedded.status, "married");
    assert.ok(wedded.marriageId);
    noRawIds(wedded, "user_a", "user_b");

    const seenByB = await call("marriages", B, {});
    assert.equal(seenByB.marriages.length, 1);
    assert.equal(seenByB.marriages[0].id, wedded.marriageId);
    noRawIds(seenByB, "user_a");

    const byB = await call("dissolve", B, { marriageId: wedded.marriageId });
    assert.equal(byB.ok, true);
    assert.equal(byB.dissolvedReason, "estranged");
    noRawIds(byB, "user_a");

    // Second marriage: A dissolves.
    await raise(db, "user_a", "user_b", ROMANCE_CONSTANTS.MARRY_THRESHOLD);
    const p2 = await call("propose", A, { partnerKind: "player", partnerId: "user_b" });
    await call("accept", B, { proposalId: p2.proposalId });
    const w2 = await call("wed", A, { partnerKind: "player", partnerId: "user_b" });
    assert.equal(w2.ok, true, JSON.stringify(w2));
    const byA = await call("dissolve", A, { marriageId: w2.marriageId });
    assert.equal(byA.ok, true);
  });

  it("B cannot birth A's pregnancy; client parentSkills do not propagate", async () => {
    await raise(db, "user_a", "user_b", ROMANCE_CONSTANTS.MARRY_THRESHOLD);
    const proposed = await call("propose", A, { partnerKind: "player", partnerId: "user_b" });
    await call("accept", B, { proposalId: proposed.proposalId });
    const wedded = await call("wed", A, { partnerKind: "player", partnerId: "user_b" });
    assert.equal(wedded.ok, true, JSON.stringify(wedded));

    const preg = await call("conceive", A, { partnerKind: "player", partnerId: "user_b" });
    assert.equal(preg.ok, true, JSON.stringify(preg));

    const intruder = await call("birth", B, {
      pregnancyId: preg.pregnancyId,
      parentSkills: { combat: 99999 },
    });
    assert.equal(intruder.ok, false);
    assert.equal(intruder.reason, "not_found");
    noRawIds(intruder, "user_a");

    db.prepare(`INSERT INTO player_skill_levels (id, user_id, skill_type, level) VALUES ('s1','user_a','combat',10)`).run();
    db.prepare(`UPDATE player_pregnancies SET due_at = ? WHERE id = ?`)
      .run(Math.floor(Date.now() / 1000) - 5, preg.pregnancyId);

    const born = await call("birth", A, {
      pregnancyId: preg.pregnancyId,
      name: "Heir",
      parentSkills: { combat: 99999 },
    });
    assert.equal(born.ok, true, JSON.stringify(born));
    assert.equal(born.inheritedSkills.combat, 8);
    assert.ok(!JSON.stringify(born).includes("99999"));
    noRawIds(born, "user_b");
  });
});
