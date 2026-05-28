// Phase W — disease engine.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  initDiseaseCatalog, getDisease, listCatalog, listEndemicTo,
  contractDisease, tickDiseases, curePartial, listActiveDiseases,
  _resetDiseaseCatalog,
} from "../lib/disease-engine.js";

function memDb() {
  const t = {
    diseases: new Map(),  // id → row
    immunity: new Map(),
    visits: [],
  };
  function _trim(s) { return s.replace(/\s+/g, " ").trim(); }
  return {
    prepare(sql) {
      const n = _trim(sql);
      return {
        run: (...args) => {
          if (n.startsWith("INSERT INTO player_diseases")) {
            const [id, userId, diseaseId, severity, radius] = args;
            t.diseases.set(id, { id, user_id: userId, disease_id: diseaseId, severity, contagion_radius_m: radius, contracted_at: Math.floor(Date.now() / 1000), recovered_at: null, symptoms_json: args[5] || "[]" });
            return { changes: 1 };
          }
          if (n.startsWith("UPDATE player_diseases SET severity = ? WHERE id = ?")) {
            const [sev, id] = args;
            const r = t.diseases.get(id);
            if (r) { r.severity = sev; return { changes: 1 }; }
            return { changes: 0 };
          }
          if (n.startsWith("UPDATE player_diseases SET severity = ?, recovered_at = unixepoch()")) {
            const [sev, id] = args;
            const r = t.diseases.get(id);
            if (r) { r.severity = sev; r.recovered_at = Math.floor(Date.now() / 1000); return { changes: 1 }; }
            return { changes: 0 };
          }
          if (n.startsWith("INSERT INTO disease_immunity")) {
            const [userId, diseaseId] = args;
            t.immunity.set(`${userId}|${diseaseId}`, { user_id: userId, disease_id: diseaseId });
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        get: (...args) => {
          if (n.startsWith("SELECT id, severity FROM player_diseases WHERE user_id = ? AND disease_id = ? AND recovered_at IS NULL")) {
            const [userId, diseaseId] = args;
            for (const d of t.diseases.values()) {
              if (d.user_id === userId && d.disease_id === diseaseId && !d.recovered_at) {
                return { id: d.id, severity: d.severity };
              }
            }
            return null;
          }
          if (n.startsWith("SELECT 1 FROM disease_immunity")) {
            return t.immunity.has(`${args[0]}|${args[1]}`) ? { 1: 1 } : null;
          }
          return null;
        },
        all: (...args) => {
          if (n.startsWith("SELECT id, disease_id, severity, contracted_at FROM player_diseases")) {
            const [userId] = args;
            return [...t.diseases.values()]
              .filter(d => d.user_id === userId && !d.recovered_at)
              .map(d => ({ id: d.id, disease_id: d.disease_id, severity: d.severity, contracted_at: d.contracted_at }));
          }
          if (n.includes("FROM player_diseases") && n.includes("recovered_at IS NULL") && n.includes("ORDER BY contracted_at DESC")) {
            const [userId] = args;
            return [...t.diseases.values()]
              .filter(d => d.user_id === userId && !d.recovered_at)
              .map(d => ({ id: d.id, diseaseId: d.disease_id, severity: d.severity, contractedAt: d.contracted_at, contagionRadiusM: d.contagion_radius_m, symptoms_json: d.symptoms_json }));
          }
          return [];
        },
      };
    },
    _t: t,
  };
}

describe("Phase W — disease engine", () => {
  let db;
  beforeEach(() => {
    _resetDiseaseCatalog();
    db = memDb();
  });

  it("catalog loads from content/diseases/*.json", () => {
    const r = initDiseaseCatalog();
    assert.ok(r.count >= 15, `expected ≥15 diseases, got ${r.count}`);
  });

  it("catalog has all 4 tiers represented", () => {
    initDiseaseCatalog();
    const c = listCatalog();
    const tiers = new Set(c.map(d => d.tier));
    assert.ok(tiers.has("common"));
    assert.ok(tiers.has("uncommon"));
    assert.ok(tiers.has("rare"));
    assert.ok(tiers.has("mental"));
  });

  it("listEndemicTo returns tunya-specific diseases", () => {
    initDiseaseCatalog();
    const tunyaDiseases = listEndemicTo("tunya");
    assert.ok(tunyaDiseases.some(d => d.id === "river-fever"));
  });

  it("contractDisease rejects unknown diseases", () => {
    initDiseaseCatalog();
    const r = contractDisease(db, "u1", "made-up-disease");
    assert.equal(r.ok, false);
    assert.equal(r.error, "unknown_disease");
  });

  it("contractDisease records new infection", () => {
    initDiseaseCatalog();
    const r = contractDisease(db, "u1", "common-cold");
    assert.equal(r.ok, true);
    assert.ok(r.id);
    assert.equal(listActiveDiseases(db, "u1").length, 1);
  });

  it("re-contract bumps severity instead of duplicate", () => {
    initDiseaseCatalog();
    contractDisease(db, "u1", "common-cold", { severity: 0.1 });
    const r = contractDisease(db, "u1", "common-cold", { severity: 0.2 });
    assert.equal(r.ok, true);
    assert.equal(r.alreadyInfected, true);
    assert.ok(r.newSeverity > 0.1);
  });

  it("immunity prevents re-contraction", () => {
    initDiseaseCatalog();
    db._t.immunity.set("u1|common-cold", { user_id: "u1", disease_id: "common-cold" });
    const r = contractDisease(db, "u1", "common-cold");
    assert.equal(r.ok, false);
    assert.equal(r.error, "immune");
  });

  it("tickDiseases advances severity", () => {
    initDiseaseCatalog();
    contractDisease(db, "u1", "common-cold", { severity: 0.1 });
    const before = listActiveDiseases(db, "u1")[0].severity;
    tickDiseases(db, "u1");
    const after = listActiveDiseases(db, "u1")[0].severity;
    assert.ok(after > before);
  });

  it("curePartial below threshold marks recovered + grants immunity", () => {
    initDiseaseCatalog();
    contractDisease(db, "u1", "common-cold", { severity: 0.05 });
    const r = curePartial(db, "u1", "common-cold", 0.05);
    assert.equal(r.ok, true);
    assert.equal(r.recovered, true);
    assert.ok(db._t.immunity.has("u1|common-cold"));
  });

  it("curePartial above threshold drops severity but keeps active", () => {
    initDiseaseCatalog();
    contractDisease(db, "u1", "common-cold", { severity: 0.5 });
    const r = curePartial(db, "u1", "common-cold", 0.2);
    assert.equal(r.ok, true);
    assert.equal(r.recovered, false);
    assert.ok(r.severity > 0.02);
  });

  it("rare-tier disease (rad-poison) exists in catalog", () => {
    initDiseaseCatalog();
    const d = getDisease("rad-poison");
    assert.ok(d);
    assert.equal(d.tier, "rare");
    assert.ok(d.mortalityRisk > 0);
  });
});
