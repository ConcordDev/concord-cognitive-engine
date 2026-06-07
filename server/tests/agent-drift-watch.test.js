// Contract test for Wave 7 / C3 — periodic drift-watch.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migAgent } from "../migrations/325_agent_identity.js";
import { up as migDrift } from "../migrations/330_agent_drift_watch.js";
import { createAgentSelf } from "../lib/agent-self.js";
import { runAgentDriftWatchCycle } from "../emergent/agent-drift-watch-cycle.js";

function setupDb() {
  const db = new Database(":memory:");
  migAgent(db);
  migDrift(db);
  return db;
}

test("Track C3 — agent drift-watch", async (t) => {
  await t.test("an aligned agent has low drift, not flagged", () => {
    const db = setupDb();
    // SEEKING-dominant agent whose anchor includes curiosity (the SEEKING-expressed value)
    createAgentSelf(db, { worldId: "w", coreValues: ["curiosity", "care_for_others"], driveProfile: { SEEKING: 0.9, CARE: 0.7, RAGE: 0.1, FEAR: 0.1, PANIC: 0.1, PLAY: 0.3, LUST: 0.1 } });
    const r = runAgentDriftWatchCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.swept, 1);
    assert.equal(r.flagged, 0, "expressed character still honours the anchor");
    const row = db.prepare(`SELECT value_drift, drift_flagged_at FROM agent_identities LIMIT 1`).get();
    assert.ok(row.value_drift < 0.6);
    assert.equal(row.drift_flagged_at, null);
  });

  await t.test("an agent whose character diverged from its anchor is FLAGGED (not corrected)", () => {
    const db = setupDb();
    // anchor = gentle values, but the drive profile expresses RAGE/FEAR → divergence
    createAgentSelf(db, { worldId: "w", coreValues: ["serenity", "gentleness", "patience"], driveProfile: { RAGE: 0.9, FEAR: 0.8, PANIC: 0.7, SEEKING: 0.2, CARE: 0.1, PLAY: 0.1, LUST: 0.1 } });
    const r = runAgentDriftWatchCycle({ db });
    assert.equal(r.flagged, 1, "the divergence is flagged for human review");
    const row = db.prepare(`SELECT value_drift, drift_flagged_at FROM agent_identities LIMIT 1`).get();
    assert.ok(row.value_drift >= 0.6);
    assert.ok(row.drift_flagged_at > 0, "flagged timestamp stamped");
    // the anchor itself is never touched (drift is watched, not corrected)
    assert.deepEqual(JSON.parse(db.prepare(`SELECT core_values_json FROM agent_identities LIMIT 1`).get().core_values_json), ["serenity", "gentleness", "patience"]);
  });

  await t.test("kill-switch + totality", () => {
    const db = setupDb();
    const prev = process.env.CONCORD_AGENT_DRIFT_WATCH;
    process.env.CONCORD_AGENT_DRIFT_WATCH = "0";
    assert.equal(runAgentDriftWatchCycle({ db }).reason, "disabled");
    if (prev === undefined) delete process.env.CONCORD_AGENT_DRIFT_WATCH; else process.env.CONCORD_AGENT_DRIFT_WATCH = prev;
    assert.doesNotThrow(() => runAgentDriftWatchCycle({}));
    assert.equal(runAgentDriftWatchCycle({ db: null }).ok, true);
  });
});
