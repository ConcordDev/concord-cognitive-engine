// Wave 7 / Layer 3 — Panksepp drives contract.
//
// Pins: resting composition order (species beats clade); predator raises FEAR over
// passes and decays back when removed; carnivore hunting raises SEEKING/RAGE; all
// scalars stay in [0,1]; totality.
//
// Run: node --test tests/drives.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  restingDrivesForSpecies, updateDrives, dominantDrive, _resetDrivesCache, DRIVE_KINDS,
} from "../lib/ecosystem/drives.js";

describe("Wave 7 — Panksepp drives (Layer 3)", () => {
  it("resting balance is total and species overrides clade", () => {
    _resetDrivesCache();
    const deer = restingDrivesForSpecies("deer");
    assert.ok(DRIVE_KINDS.every((k) => deer[k] >= 0 && deer[k] <= 1));
    assert.ok(deer.FEAR > deer.RAGE, "deer is FEAR-dominant over RAGE");

    const wolf = restingDrivesForSpecies("wolf");
    assert.ok(wolf.SEEKING > deer.SEEKING, "wolf seeks more than deer");
    assert.ok(wolf.RAGE > deer.RAGE, "wolf rages more than deer");

    // unknown species → clade/diet fallback, still total
    const unknown = restingDrivesForSpecies("glorp_9000");
    assert.ok(DRIVE_KINDS.every((k) => typeof unknown[k] === "number"));
  });

  it("predator-near raises FEAR over passes; removing it decays FEAR back", () => {
    const rest = restingDrivesForSpecies("deer");
    let d = { ...rest };
    for (let i = 0; i < 4; i++) {
      d = updateDrives(d, rest, { v: -0.4, a: 0.8 }, { predatorNear: true });
    }
    assert.ok(d.FEAR > rest.FEAR, `FEAR climbed above resting (${d.FEAR} > ${rest.FEAR})`);
    const fearPeak = d.FEAR;
    for (let i = 0; i < 8; i++) {
      d = updateDrives(d, rest, { v: 0.3, a: 0.2 }, {});
    }
    assert.ok(d.FEAR < fearPeak, "FEAR decays back toward resting once safe");
  });

  it("a hungry carnivore on the hunt raises SEEKING and RAGE", () => {
    const rest = restingDrivesForSpecies("wolf");
    const d = updateDrives(rest, rest, { v: 0.1, a: 0.7 },
      { isHunting: true, blocked: true, needs: { hunger: 0.8 } });
    assert.ok(d.SEEKING >= rest.SEEKING, "SEEKING up with hunger");
    assert.ok(d.RAGE > rest.RAGE, "RAGE up when the hunt is blocked");
    assert.ok(DRIVE_KINDS.every((k) => d[k] >= 0 && d[k] <= 1));
  });

  it("dominantDrive is total", () => {
    assert.equal(dominantDrive(null).name, null);
    const dd = dominantDrive(restingDrivesForSpecies("deer"));
    assert.equal(dd.name, "FEAR");
  });
});
