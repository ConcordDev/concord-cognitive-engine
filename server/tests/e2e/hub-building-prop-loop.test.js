/**
 * Tier-3 flagship E2E loop (R8/CL3, loop 3): "Enter Hub → purposeful
 * building/prop interaction."
 *
 * Boots the REAL server (macroRuntime) and drives two real, previously-
 * separate subsystems together as a player actually experiences them:
 *
 *   1. Building purpose (master-spec A3/A4 — server/lib/building-purpose.js)
 *      — resolve a SPECIFIC authored building from
 *      content/world/concordia-hub/city-layout.json ("courthouse") against a
 *      REAL `world_buildings` row, and confirm it maps to a real, non-
 *      placeholder lens (the same contract server/tests/building-purpose.
 *      test.js pins for the building-purpose module in isolation — here it
 *      is exercised as part of a full loop that also proves the target
 *      domain ("legal") is a real, populated macro domain, not just a
 *      string).
 *   2. DTU-as-world-prop (master-spec §3.3 units B6-B9 — server/lib/
 *      dtu-props.js + server/domains/dtu-props.js's `dtu_props.list` /
 *      `dtu_props.interact` macros) — place a real DTU as a prop inside
 *      that building's world, list it via the live macro dispatch, and have
 *      a SECOND user take it, which routes through the exact same
 *      `registerCitation` royalty-lineage mechanism every derivative work in
 *      Concord uses (server/economy/royalty-cascade.js) — proving "purposeful
 *      interaction" is not a cosmetic click, it mints a real, citable,
 *      provenance-tracked artifact.
 *
 * NOTE on a subtlety this test makes explicit (not a gap — it is
 * deliberately, correctly documented in server/lib/dtu-props.js's own header
 * comment): `dtu_props.list`/`interact` read the SQL `dtus` table, which is
 * a DIFFERENT substrate than the in-memory `STATE.dtus` Map the `dtu.create`
 * macro (exercised in loop 2) writes to. A DTU created via `dtu.create` does
 * NOT automatically appear as a world prop — this test inserts directly into
 * the SQL table, matching the real pattern other SQL-`dtus`-table writers
 * (world/gather, dtu-props' own contract tests) already use.
 *
 * VERIFIED AT RUNTIME, NOT TRUSTED FROM A COMMENT (per CLAUDE.md's
 * "runtime-truth over source-guessing"): server/domains/dtu-props.js's own
 * header comment claims "this file is registered here but ... NOT [wired] —
 * that two-line addition was deliberately NOT made". Direct grep of
 * server.js shows this is STALE — `registerDtuPropsMacros(register)` is
 * called at module-load time (server.js, right after `discovery.js`'s
 * registration), identically to every other live domain. This test calls
 * the macros through the real `/api/lens/run`-equivalent dispatch
 * (`runMacro`), which only succeeds if that wiring is genuinely live —
 * proving the comment wrong by demonstration, not just by grep.
 *
 * Run: node --test tests/e2e/hub-building-prop-loop.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { macroRuntime, depthCtx } from "../depth/_harness.js";
import { buildingPurposeForType, CITY_LAYOUT_WORLD_ID } from "../../lib/building-purpose.js";
import { exportScene } from "../../lib/scene-export.js";

let runMacro, STATE, ownerCtx, takerCtx;
const WORLD_ID = "concordia-hub";
const BUILDING_ID = "b_e2e_courthouse";
let propDtuId;

before(async () => {
  const rt = await macroRuntime("hub-building-prop");
  runMacro = rt.runMacro;
  STATE = rt.STATE;
  ownerCtx = await depthCtx("e2e_hub_owner");
  takerCtx = await depthCtx("e2e_hub_taker");

  // Real users for the FK-referenced dtus.owner_user_id column.
  for (const uid of [ownerCtx.actor.userId, takerCtx.actor.userId]) {
    STATE.db.prepare(`
      INSERT OR IGNORE INTO users (id, username, email, password_hash, created_at)
      VALUES (?, ?, ?, 'x', datetime('now'))
    `).run(uid, uid, `${uid}@e2e.test`);
  }

  // A real world_buildings row for a "courthouse" — the SAME building_type
  // building-purpose.test.js pins as a real, unambiguous station type.
  STATE.db.prepare(`
    INSERT OR IGNORE INTO world_buildings
      (id, world_id, building_type, x, y, z, rotation, width, depth, height, material, floors, state, health_pct)
    VALUES (?, ?, 'courthouse', -30, 0, -10, 0, 10, 10, 8, 'stone', 2, 'standing', 1)
  `).run(BUILDING_ID, WORLD_ID);
});

describe("Enter Hub E2E loop — Stage 1: the courthouse is a real, purposeful building", () => {
  it("resolves against the authored city-layout.json — a real purpose + a real lens, not a placeholder facade", () => {
    const purpose = buildingPurposeForType("courthouse", CITY_LAYOUT_WORLD_ID);
    assert.ok(purpose, "courthouse must resolve to a real authored purpose");
    assert.equal(purpose.lens, "legal");
    assert.ok(typeof purpose.purpose === "string" && purpose.purpose.trim().length >= 12,
      "purpose string must be a real function description, not a placeholder");
    assert.ok(!/^(tbd|todo|placeholder|n\/a|none|unknown)$/i.test(purpose.purpose.trim()));
  });

  it("the target domain ('legal') is a REAL, populated macro domain — not just a purpose string with nothing behind it", async () => {
    // ownerCtx.macro.listMacros is the live registry introspection (server.js
    // makeInternalCtx wires ctx.macro = { run, listDomains, listMacros }) —
    // asking the ACTUAL running dispatcher, not grepping source.
    const legalMacros = ownerCtx.macro.listMacros("legal");
    assert.ok(Array.isArray(legalMacros) && legalMacros.length > 0,
      "the 'legal' domain the courthouse maps to must have real registered macros");
  });

  it("the real world_buildings row round-trips through scene-export with the purpose/lens attached", () => {
    const scene = exportScene(STATE.db, WORLD_ID);
    assert.equal(scene.ok, true);
    const node = scene.nodes.find((n) => n.id === BUILDING_ID);
    assert.ok(node, "the courthouse building must appear in the exported scene");
    assert.equal(node.extras.lens, "legal");
    assert.ok(typeof node.extras.purpose === "string" && node.extras.purpose.length > 0);
  });
});

describe("Enter Hub E2E loop — Stage 2: a real DTU becomes an interactive world prop", () => {
  it("a real DTU placed in the world is listed by the live dtu_props.list macro dispatch", async () => {
    propDtuId = `dtuprop_e2e_${randomUUID().slice(0, 10)}`;
    STATE.db.prepare(`
      INSERT INTO dtus (id, owner_user_id, creator_id, title, body_json, data, tags_json, visibility, tier, type, world_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, '{}', '{}', '[]', 'public', 'regular', 'recipe', ?, datetime('now'), datetime('now'))
    `).run(propDtuId, ownerCtx.actor.userId, ownerCtx.actor.userId, "Courthouse Precedent Recipe", WORLD_ID);

    const listed = await runMacro("dtu_props", "list", { worldId: WORLD_ID }, takerCtx);
    assert.equal(listed.ok, true, `dtu_props.list must succeed via the real macro dispatch: ${JSON.stringify(listed)}`);
    const placement = listed.placements.find((p) => p.dtuId === propDtuId);
    assert.ok(placement, "the real DTU must appear as a real prop placement");
    assert.equal(placement.title, "Courthouse Precedent Recipe");
    assert.equal(placement.slot, "counter", "recipe-kind DTUs deterministically place on a counter slot");
    assert.ok(Array.isArray(placement.position) && placement.position.length === 3);
  });

  it("inspecting the prop via dtu_props.interact returns the real DTU content", async () => {
    const r = await runMacro("dtu_props", "interact", { dtuId: propDtuId, action: "inspect" }, takerCtx);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.dtu.id, propDtuId);
    assert.equal(r.dtu.title, "Courthouse Precedent Recipe");
    assert.equal(r.dtu.creatorId, ownerCtx.actor.userId);
  });

  it("a SECOND user taking the prop mints a real, cited child DTU — provenance is real, not cosmetic", async () => {
    const before = STATE.db.prepare(`SELECT COUNT(*) AS n FROM dtus WHERE type = 'dtu_prop_take' AND owner_user_id = ?`).get(takerCtx.actor.userId).n;

    const r = await runMacro("dtu_props", "interact", { dtuId: propDtuId, action: "take" }, takerCtx);
    assert.equal(r.ok, true, `take must succeed via the live macro dispatch: ${JSON.stringify(r)}`);
    assert.equal(typeof r.childId, "string");
    assert.equal(typeof r.lineageId, "string", "take must register a real royalty_lineage row, not a fabricated success");

    const after = STATE.db.prepare(`SELECT COUNT(*) AS n FROM dtus WHERE type = 'dtu_prop_take' AND owner_user_id = ?`).get(takerCtx.actor.userId).n;
    assert.equal(after, before + 1, "a real held-reference DTU row must exist for the taker");

    // The SAME royalty_lineage mechanism loop 2 exercises via dtu.create's
    // auto-citation — proving "take" is not a parallel, weaker provenance
    // path, it is the real one.
    const lineageRow = STATE.db.prepare(
      `SELECT * FROM royalty_lineage WHERE child_id = ? AND parent_id = ?`
    ).get(r.childId, propDtuId);
    assert.ok(lineageRow, "taking a prop must write a real royalty_lineage row citing the original");
    assert.equal(lineageRow.creator_id, takerCtx.actor.userId);
    assert.equal(lineageRow.parent_creator, ownerCtx.actor.userId);
  });

  it("taking the SAME prop again is idempotent — no duplicate mint, no duplicate citation", async () => {
    const before = STATE.db.prepare(`SELECT COUNT(*) AS n FROM dtus WHERE type = 'dtu_prop_take' AND owner_user_id = ?`).get(takerCtx.actor.userId).n;
    const r = await runMacro("dtu_props", "interact", { dtuId: propDtuId, action: "take" }, takerCtx);
    assert.equal(r.ok, true);
    assert.equal(r.alreadyTaken, true);
    const after = STATE.db.prepare(`SELECT COUNT(*) AS n FROM dtus WHERE type = 'dtu_prop_take' AND owner_user_id = ?`).get(takerCtx.actor.userId).n;
    assert.equal(after, before, "re-taking an already-held prop must not mint a second child DTU");
  });

  it("arranging the prop's placement is owner-gated — the taker cannot rearrange a prop they don't own", async () => {
    const r = await runMacro("dtu_props", "interact", {
      dtuId: propDtuId, action: "arrange", placement: { slot: "window", position: [1, 0, 1] },
    }, takerCtx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
  });

  it("the real owner CAN rearrange it, and the arranged placement wins on the next real list call", async () => {
    const arranged = await runMacro("dtu_props", "interact", {
      dtuId: propDtuId, action: "arrange", placement: { slot: "window", position: [2, 0, 3], roomId: "custom_room" },
    }, ownerCtx);
    assert.equal(arranged.ok, true, JSON.stringify(arranged));

    const listed = await runMacro("dtu_props", "list", { worldId: WORLD_ID }, takerCtx);
    const placement = listed.placements.find((p) => p.dtuId === propDtuId);
    assert.ok(placement);
    assert.equal(placement.slot, "window");
    assert.equal(placement.arranged, true);
    assert.deepEqual(placement.position, [2, 0, 3]);
  });
});
