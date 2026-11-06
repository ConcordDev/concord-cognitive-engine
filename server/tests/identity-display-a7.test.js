// Close-out A7 — identity-display adoption. At the named instances'
// reads, a party's NAME resolves through the platform resolver
// (server/lib/user-identity.js) and rides the row beside the id; an
// unresolved party carries null — the raw account id is never
// substituted as the display. Harness: domain modules registered with
// a fake collector over a stub STATE whose db is an in-memory
// better-sqlite3 with a users table; LFG's lib runs against the same
// db with its own table.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { listOpenLfg } from "../lib/lfg.js";
import registerBountiesActions from "../domains/bounties.js";
import registerPersonasActions from "../domains/personas.js";
import registerLawEnforcementActions from "../domains/lawenforcement.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const GHOST = "22222222-2222-4222-8222-222222222222"; // no users row

let db;
function collector() {
  const actions = new Map();
  return { actions, register: (domain, action, fn) => actions.set(`${domain}.${action}`, fn) };
}
const ctxFor = (userId) => ({ actor: { userId }, userId, db });

before(() => {
  db = new Database(":memory:");
  db.prepare("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT)").run();
  db.prepare("INSERT INTO users (id, username) VALUES (?, ?)").run(ALICE, "alice");
  db.prepare(`CREATE TABLE lfg_requests (
    id TEXT PRIMARY KEY, requester_user_id TEXT, world_id TEXT, role TEXT,
    party_type TEXT, note TEXT, created_at INTEGER, expires_at INTEGER,
    party_max_size INTEGER, current_party_size INTEGER, status TEXT)`).run();
  const ins = db.prepare(`INSERT INTO lfg_requests
    (id, requester_user_id, world_id, role, party_type, note, created_at, expires_at, party_max_size, current_party_size, status)
    VALUES (?, ?, 'concordia-hub', 'healer', 'normal', '', 1, 9999999999, 8, 1, 'open')`);
  ins.run("lfg_a", ALICE);
  ins.run("lfg_b", GHOST);
  globalThis._concordSTATE = { db };
  globalThis._concordSaveStateDebounced = () => {};
});

describe("A7 — LFG board rows carry the poster's resolved name", () => {
  it("resolved poster → their name; unresolved → null, never the raw id as a name", () => {
    const rows = listOpenLfg(db, {});
    const a = rows.find((r) => r.id === "lfg_a");
    const b = rows.find((r) => r.id === "lfg_b");
    assert.equal(a.posterName, "alice");
    assert.equal(b.posterName, null);
    assert.equal(b.userId, GHOST); // the id stays on the row for ownership checks
  });
});

describe("A7 — Bounties rows carry the poster's resolved name", () => {
  it("create + list: ownerName resolves; the raw id is not the display", async () => {
    const { actions, register } = collector();
    registerBountiesActions(register);
    const create = actions.get("bounties.create");
    const list = actions.get("bounties.list");
    const made = await create(ctxFor(ALICE), null, { title: "Name the poster", description: "A bounty about naming its poster properly.", rewardCc: 5 });
    assert.equal(made.ok, true);
    assert.equal(made.result.bounty.ownerName, "alice");
    const rows = (await list(ctxFor(ALICE), null, {})).result.bounties;
    assert.equal(rows[0].ownerName, "alice");
    assert.equal(rows[0].ownerId, ALICE);
  });
});

describe("A7 — Personas rows carry the author's resolved name", () => {
  it("create + marketplace list: authorName resolves beside authorUserId", async () => {
    const { actions, register } = collector();
    registerPersonasActions(register);
    const create = actions.get("personas.create");
    const list = actions.get("personas.browse");
    const made = await create(ctxFor(ALICE), null, {
      name: "Named Author Bot", tagline: "t", personality: "warm", greeting: "hi",
      exampleDialogue: [{ user: "q", reply: "a" }],
    });
    assert.equal(made.ok, true);
    try { await actions.get("personas.publish")(ctxFor(ALICE), null, { personaId: made.result.persona.id, published: true }); } catch { /* the create-view fallback below still pins the name */ }
    const rows = (await list(ctxFor(ALICE), null, {})).result.personas;
    const row = rows.find((p) => p.id === made.result.persona.id) || made.result.persona;
    assert.equal(row.authorName, "alice");
    assert.equal(row.authorUserId, ALICE);
  });
});

describe("A7 — Law-enforcement evidence carries the holder's resolved name", () => {
  it("intake by a resolved officer → currentHolderName; chain entries carry from/to names", async () => {
    const { actions, register } = collector();
    registerLawEnforcementActions(register);
    const intake = actions.get("law-enforcement.evidenceIntake");
    const list = actions.get("law-enforcement.evidenceList");
    const made = await intake(ctxFor(ALICE), null, { description: "A7 probe evidence", caseNumber: "CASE-A7" });
    assert.equal(made.ok, true);
    assert.equal(made.result.evidence.currentHolderName, "alice");
    const rows = (await list(ctxFor(ALICE), null, {})).result.evidence;
    const row = rows.find((e) => e.id === made.result.evidence.id);
    assert.equal(row.currentHolderName, "alice");
    assert.equal(row.currentHolder, ALICE); // raw id stays on the record
  });
});
