/**
 * FIX-materials-009: 6061-T6 outdoors at 25 C / 50% RH rated 45/100
 * "high" risk, 3-10 years. 6061's atmospheric corrosion resistance is
 * good (passive oxide; routinely used unprotected outdoors) — the
 * named aluminium adjustment was underweighted against the generic
 * metal base. Pins the corrected band and the neighbours that must
 * not move.
 */
import { describe, it, expect } from "vitest";
import registerMaterialsActions from "../domains/materials.js";

const actions = new Map();
registerMaterialsActions((domain, action, handler) => actions.set(`${domain}:${action}`, handler));
const risk = (data) => actions.get("materials:corrosionRisk")({}, { data }, {}).result;

describe("corrosionRisk calibration", () => {
  it("6061-T6 outdoors, mild conditions: moderate, not high", () => {
    const r = risk({ name: "Aluminum 6061-T6", category: "metal", environment: "outdoor", temperature: 25, humidity: 50 });
    expect(r.corrosionResistance).toBe(55);
    expect(r.riskLevel).toBe("moderate");
    expect(r.estimatedLifespan).toBe("10-20 years");
  });
  it("marine exposure stays high for 6061", () => {
    const r = risk({ name: "6061-T6", category: "metal", environment: "marine", temperature: 25, humidity: 60 });
    expect(r.riskLevel).toBe("high");
  });
  it("carbon steel outdoors stays critical (unchanged neighbour)", () => {
    const r = risk({ name: "carbon steel", category: "metal", environment: "outdoor", temperature: 25, humidity: 50 });
    expect(r.corrosionResistance).toBe(10);
    expect(r.riskLevel).toBe("critical");
  });
});
