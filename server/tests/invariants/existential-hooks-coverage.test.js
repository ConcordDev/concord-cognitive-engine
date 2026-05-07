// Invariant: Layer 4 — existential OS hooks expansion + persistence.
//
// Pins:
//   1. Migration 111 creates qualia_state + qualia_log with expected columns
//   2. Three new hooks (hookDiscovery, hookEcology, hookBrainTraining) exist
//      and don't throw on null/incomplete input
//   3. persistQualiaState writes to qualia_state without throwing on a
//      fresh DB (graceful no-op when QualiaEngine has no snapshot export)
//   4. Layer 2's affect-bridge cross-emits to hookAffect lazily

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../../migrate.js";
import {
  hookDiscovery,
  hookEcology,
  hookBrainTraining,
  persistQualiaState,
} from "../../existential/hooks.js";

let db;
beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");
  await runMigrations(db);
});

function colExists(table, col) {
  return db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table)
    .some((r) => r.name === col);
}

test("migration 111 creates qualia_state with required columns + composite PK", () => {
  for (const c of ["entity_id", "channel", "value", "last_updated_at"]) {
    assert.ok(colExists("qualia_state", c), `qualia_state.${c} missing`);
  }
  // Verify composite PK by attempting two inserts with same (entity_id, channel).
  db.prepare(`INSERT INTO qualia_state (entity_id, channel, value) VALUES ('e1', 'truth_os.evidence_weight', 0.7)`).run();
  // Second insert with same key → ON CONFLICT DO NOTHING / replace must not duplicate.
  // Using INSERT OR IGNORE to test the constraint exists.
  assert.doesNotThrow(() => {
    db.prepare(`INSERT OR IGNORE INTO qualia_state (entity_id, channel, value) VALUES ('e1', 'truth_os.evidence_weight', 0.9)`).run();
  });
  const count = db.prepare(`SELECT COUNT(*) as c FROM qualia_state WHERE entity_id = 'e1'`).get().c;
  assert.strictEqual(count, 1, "composite PK must prevent duplicate (entity_id, channel) rows");
});

test("migration 111 creates qualia_log with delta tracking columns", () => {
  for (const c of ["id", "entity_id", "channel", "prev_value", "new_value", "delta", "source", "occurred_at"]) {
    assert.ok(colExists("qualia_log", c), `qualia_log.${c} missing`);
  }
});

test("hookDiscovery accepts shape { novelty, clusterSize, breakthrough, source } without throwing", () => {
  // No global qualiaEngine in test env — hooks fail-safe via getEngine() null check.
  assert.doesNotThrow(() => {
    hookDiscovery("entity-1", { novelty: 0.8, clusterSize: 5, breakthrough: true });
  });
  // Null/undefined input must not throw either.
  assert.doesNotThrow(() => hookDiscovery(null, null));
  assert.doesNotThrow(() => hookDiscovery("entity-1", undefined));
});

test("hookEcology accepts environmental signal payload", () => {
  assert.doesNotThrow(() => {
    hookEcology("concordia-hub", {
      temperature: -5,        // cold zone
      light: 1500,            // overcast
      humidity: 80,           // damp
      sound: 35,              // quiet
      pressure: 1010,         // slightly low
      airQuality: 0.85,       // good
    });
  });
  assert.doesNotThrow(() => hookEcology(null, null));
});

test("hookBrainTraining accepts refresh result + handles partial fields", () => {
  assert.doesNotThrow(() => {
    hookBrainTraining("utility", { evalScore: 0.72, swapped: true, corpusSize: 200 });
  });
  // Partial — missing fields shouldn't crash.
  assert.doesNotThrow(() => hookBrainTraining("repair", { evalScore: 0.5 }));
  assert.doesNotThrow(() => hookBrainTraining(null, null));
});

test("persistQualiaState handles fresh DB gracefully when no engine available", () => {
  // No qualiaEngine globally → graceful no-op.
  const r = persistQualiaState(db);
  assert.ok(r);
  // Either ok:false with no_engine reason, OR ok:true with no_snapshot_export reason.
  if (r.ok === false) {
    assert.match(String(r.reason || ""), /no_engine/);
  } else {
    assert.strictEqual(r.persisted, 0);
  }
});

test("persistQualiaState writes to qualia_state when engine has snapshot export", () => {
  // Mock a qualiaEngine that produces a snapshot.
  const original = globalThis.qualiaEngine;
  globalThis.qualiaEngine = {
    snapshot() {
      return {
        "world:concordia-hub": {
          "thermal_os.ambient_temp": 0.3,
          "sight_os.illumination": 0.6,
        },
        "user-test": {
          "motivation_os.drive": 0.9,
        },
      };
    },
  };
  try {
    const r = persistQualiaState(db);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.persisted, 3);
    const rows = db.prepare(`SELECT entity_id, channel, value FROM qualia_state ORDER BY entity_id, channel`).all();
    assert.strictEqual(rows.length, 3);
    const world = rows.find((r) => r.entity_id === "world:concordia-hub" && r.channel === "thermal_os.ambient_temp");
    assert.ok(world);
    assert.ok(Math.abs(world.value - 0.3) < 1e-9);
  } finally {
    globalThis.qualiaEngine = original;
  }
});

test("persistQualiaState appends to qualia_log on significant delta", () => {
  // Seed an existing channel value, then mock engine producing a new value.
  db.prepare(`INSERT INTO qualia_state (entity_id, channel, value) VALUES (?, ?, ?)`)
    .run("user-delta", "motivation_os.drive", 0.30);

  const original = globalThis.qualiaEngine;
  globalThis.qualiaEngine = {
    snapshot() {
      return { "user-delta": { "motivation_os.drive": 0.50 } }; // |Δ| = 0.20 ≥ 0.05
    },
  };
  try {
    const r = persistQualiaState(db);
    assert.strictEqual(r.ok, true);
    assert.ok(r.logged >= 1, "significant delta must be logged");
    const log = db.prepare(`SELECT * FROM qualia_log WHERE entity_id = ?`).get("user-delta");
    assert.ok(log);
    assert.ok(Math.abs(log.delta - 0.20) < 1e-9);
  } finally {
    globalThis.qualiaEngine = original;
  }
});

test("affect-bridge lazy-imports hookAffect (verified via source string check)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(
    new URL("../../lib/affect-bridge.js", import.meta.url),
    "utf8",
  );
  assert.ok(
    src.includes("_crossEmitQualia"),
    "affect-bridge must call _crossEmitQualia after applyAffectEvent for Layer 4 cross-link",
  );
  assert.ok(
    src.includes("hookAffect"),
    "affect-bridge must reference hookAffect from existential/hooks.js",
  );
});
