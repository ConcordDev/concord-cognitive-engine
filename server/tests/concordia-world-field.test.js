/**
 * World identity is a spatial field. Geographic effectiveness is physics.
 *
 *   cd server && node --test tests/concordia-world-field.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAvailableIn } from "../lib/cross-world-potency.js";
import {
  FIELD_ACTOR_KINDS,
  FIELD_GATE_ANGLES,
  MEGAWORLD_KM,
  fieldCenter,
  fieldAt,
  fieldAtWorld,
  localRules,
  geographicEffectiveness,
  geographicEffectivenessAtWorld,
  explainGeographicEffectiveness,
  centerAffinity,
} from "../lib/concordia-world-field.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function canonSource() {
  return readFileSync(
    join(root, "apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Canon.cs"),
    "utf8",
  );
}

describe("field topology matches Canon gate bearings", () => {
  it("kernel angles are the Hub ring, not disconnected maps", () => {
    const canon = canonSource();
    assert.match(canon, /angle = 0 \}/);
    assert.match(canon, /angle = Mathf\.PI \/ 2 \}/);
    assert.match(canon, /angle = 5 \* Mathf\.PI \/ 4 \}/);
    assert.equal(FIELD_GATE_ANGLES.cyber, 0);
    assert.equal(FIELD_GATE_ANGLES.fantasy, Math.PI / 2);
    assert.equal(FIELD_GATE_ANGLES.crime, 5 * Math.PI / 4);
    const fantasy = fieldCenter("fantasy");
    const crime = fieldCenter("crime");
    assert.ok(fantasy.hasLinkGate);
    assert.ok(crime.hasLinkGate);
    const sere = fieldCenter("sere");
    assert.equal(sere.hasLinkGate, false);
    assert.ok(sere.radiusKm > MEGAWORLD_KM.civilizationRadius);
  });
});

describe("WorldField is continuous", () => {
  it("fantasy center is high-magic; crime center is not a wall, it is thin magic", () => {
    const f = fieldCenter("fantasy");
    const c = fieldCenter("crime");
    const atF = fieldAt(f.x, f.z);
    const atC = fieldAt(c.x, c.z);
    assert.equal(atF.ok, true);
    assert.ok(atF.fantasy > 0.85, `fantasy at home ${atF.fantasy}`);
    assert.ok(atF.crime < 0.15, `crime leak at fantasy ${atF.crime}`);
    assert.ok(atC.crime > 0.85);
    assert.ok(atC.fantasy < 0.15);
    const rulesF = localRules(atF);
    const rulesC = localRules(atC);
    assert.ok(rulesF.magic > 0.85, `magic at fantasy ${rulesF.magic}`);
    assert.ok(rulesC.magic < 0.20, `magic at crime ${rulesC.magic}`);
    assert.ok(rulesC.magic > 0, "crime does not hard-zero magic on the field");
    assert.ok(rulesC.tech > rulesF.tech);
  });

  it("adjacent civilizations share a transition band; opposites do not share a border", () => {
    const f = fieldCenter("fantasy");
    const t = fieldCenter("tunya");
    const mid = fieldAt((f.x + t.x) / 2, (f.z + t.z) / 2);
    assert.equal(mid.flowerLaw, false);
    assert.equal(mid.transition.ok, true);
    const pair = [mid.transition.a, mid.transition.b].sort();
    assert.deepEqual(pair, ["fantasy", "tunya"]);
    assert.ok(mid.fantasy > 0.35 && mid.tunya > 0.35);

    const crime = fieldCenter("crime");
    const opposite = fieldAt((f.x + crime.x) / 2, (f.z + crime.z) / 2);
    const oppPair = opposite.transition.ok
      ? [opposite.transition.a, opposite.transition.b]
      : [];
    assert.equal(oppPair.includes("fantasy") && oppPair.includes("crime"), false,
      "Fantasy and Crime sit across the Hub; the walk crosses neighbors, not a shared border");
  });

  it("Hub is a suppression well: Flower Law, steel dead, physics flattened", () => {
    const hub = fieldAt(0, 0);
    assert.equal(hub.flowerLaw, true);
    assert.equal(hub.steelLive, false);
    assert.ok(hub.chaosSuppressed >= 0.85);
    assert.equal(hub.dominant, "hub");
    assert.equal(hub.transition.ok, false);
    const rules = localRules(hub);
    assert.ok(Math.abs(rules.magic - 0.7) < 0.08, `hub magic should sit near civil 0.7, got ${rules.magic}`);
    const outskirts = fieldAt(0, MEGAWORLD_KM.hubMetro + 5);
    assert.equal(outskirts.flowerLaw, false);
    assert.equal(outskirts.steelLive, true);
  });

  it("missing position is not a fabricated field", () => {
    const r = fieldAt(undefined, 10);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_position");
  });
});

describe("geographic effectiveness is physics, not a protagonist debuff", () => {
  const native = 94;
  const fantasy = fieldCenter("fantasy");
  const crime = fieldCenter("crime");
  const farther = { x: 0, z: fantasy.z * 0.62 };
  const wild = { x: 0, z: MEGAWORLD_KM.hubMetro + 20 };

  it("a Sundering mage weakens walking toward Crime, without a popup modifier", () => {
    const home = geographicEffectiveness({
      origin: "fantasy", domain: "magic", nativeStrength: native, x: fantasy.x, z: fantasy.z,
    });
    const away = geographicEffectiveness({
      origin: "fantasy", domain: "magic", nativeStrength: native, x: farther.x, z: farther.z,
    });
    const between = geographicEffectiveness({
      origin: "fantasy", domain: "magic", nativeStrength: native, x: wild.x, z: wild.z,
    });
    const deep = geographicEffectiveness({
      origin: "fantasy", domain: "magic", nativeStrength: native, x: crime.x, z: crime.z,
    });
    assert.ok(home.effective > native * 0.97 && home.effective <= native + 1e-9, `home ${home.effective}`);
    assert.ok(away.effective < home.effective, `farther ${away.effective} vs home ${home.effective}`);
    assert.ok(between.effective < away.effective, `wild ${between.effective} vs farther ${away.effective}`);
    assert.ok(deep.effective < between.effective, `crime ${deep.effective} vs wild ${between.effective}`);
    assert.ok(deep.effective > 15 && deep.effective < 45, `crime residual ${deep.effective}`);
    const why = explainGeographicEffectiveness({
      origin: "fantasy", domain: "magic", nativeStrength: native, x: crime.x, z: crime.z,
    });
    assert.doesNotMatch(why.because, /-|−|\u2212\s*42%\s*Magic Damage/i);
    assert.doesNotMatch(why.because, /debuff/i);
    assert.match(why.because, /physics|floor|competence/i);
  });

  it("the same fire is the same number on a player, a boss, a dragon, a summoned thing", () => {
    const args = { origin: "fantasy", domain: "magic", nativeStrength: native, x: crime.x, z: crime.z };
    const sample = geographicEffectiveness({ ...args, actorKind: "player" });
    for (const kind of FIELD_ACTOR_KINDS) {
      const g = geographicEffectiveness({ ...args, actorKind: kind });
      assert.equal(g.multiplier, sample.multiplier, kind);
      assert.equal(g.effective, sample.effective, kind);
      assert.equal(g.localPhysics, sample.localPhysics, kind);
      assert.equal(g.actorKind, kind);
    }
  });

  it("adaptation raises the floor in hostile physics without beating home", () => {
    const home = geographicEffectiveness({
      origin: "fantasy", domain: "magic", nativeStrength: native, adaptation: 0, x: fantasy.x, z: fantasy.z,
    });
    const untrained = geographicEffectiveness({
      origin: "fantasy", domain: "magic", nativeStrength: native, adaptation: 0, x: crime.x, z: crime.z,
    });
    const trained = geographicEffectiveness({
      origin: "fantasy", domain: "magic", nativeStrength: native, adaptation: 1, x: crime.x, z: crime.z,
    });
    assert.ok(trained.effective > untrained.effective);
    assert.ok(trained.effective < home.effective);
  });

  it("a Crime tech user is stronger at home than in the Sundering", () => {
    const home = geographicEffectiveness({
      origin: "crime", domain: "tech", nativeStrength: 80, x: crime.x, z: crime.z,
    });
    const abroad = geographicEffectiveness({
      origin: "crime", domain: "tech", nativeStrength: 80, x: fantasy.x, z: fantasy.z,
    });
    assert.ok(home.effective > abroad.effective, `crime-home ${home.effective} vs fantasy ${abroad.effective}`);
  });
});

describe("compose with discrete potency; do not replace it yet", () => {
  it("authored crime still hard-forbids magic on the WorldId path", () => {
    const crimeMeta = JSON.parse(readFileSync(join(root, "content/world/crime/meta.json"), "utf8"));
    const gate = isAvailableIn(crimeMeta, { domain: "magic" });
    assert.equal(gate.available, false);
    const fieldPath = geographicEffectivenessAtWorld({
      worldId: "crime", origin: "fantasy", domain: "magic", nativeStrength: 94,
    });
    assert.equal(fieldPath.ok, true);
    assert.ok(fieldPath.effective > 0, "the field degrades; it does not forbid");
  });

  it("fieldAtWorld(fantasy) samples the fantasy center", () => {
    const c = fieldCenter("fantasy");
    const a = fieldAtWorld("fantasy");
    const b = fieldAt(c.x, c.z);
    assert.equal(a.ok, true);
    assert.ok(Math.abs(a.fantasy - b.fantasy) < 1e-9);
  });

  it("live combat route still does not import the field (W7)", () => {
    const worlds = readFileSync(join(root, "server/routes/worlds.js"), "utf8");
    assert.doesNotMatch(worlds, /concordia-world-field/);
    assert.doesNotMatch(worlds, /geographicEffectiveness/);
  });

  it("center magic affinities come from authored meta, not invented tables", () => {
    const fantasyMeta = JSON.parse(readFileSync(join(root, "content/world/fantasy/meta.json"), "utf8"));
    const crimeMeta = JSON.parse(readFileSync(join(root, "content/world/crime/meta.json"), "utf8"));
    assert.equal(centerAffinity("fantasy", "magic"), fantasyMeta.skill_affinity.magic);
    assert.equal(centerAffinity("crime", "magic"), crimeMeta.skill_affinity.magic);
  });
});
