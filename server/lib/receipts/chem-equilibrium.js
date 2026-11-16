// server/lib/receipts/chem-equilibrium.js
//
// The one chem adiabatic-flame solve + receipt-parts builder. The no-login
// demo route (GET /api/conkay/demo/chem/equilibrium) and the chem lens action
// (POST /api/lens/run chem.equilibrium) both use this, so the reference
// (Turns 3e), the Cantera call and the verdict logic exist exactly once.

import { openDesign } from "../conkay/index.js";
import { chemKernelKey } from "../conkay/chem/cantera.js";
import { roundTo } from "./calc-receipt.js";

/** Envelope bounds (the validity envelope the reference case is certified over). */
export const CHEM_BOUNDS = Object.freeze({
  phi: { min: 0.5, max: 2.0 },
  T0: { min: 250, max: 1000 },
  P0atm: { min: 0.5, max: 10 },
});

// The cited source is machine-checkable by a stranger: ISBN-13 9780073380193 (verified against
// Open Library) is Turns, An Introduction to Combustion: Concepts and Applications, 3rd ed.
// (McGraw-Hill). The repo only ever recorded "ch. 2" for the stoichiometric adiabatic flame
// temperatures; the page/table/figure number has NOT been verified against a copy of the book
// (locatorVerified:false), so it is stated at chapter level rather than invented.
const TURNS_3E = (what) => ({
  kind: "book",
  citation: "Turns, S. R., An Introduction to Combustion: Concepts and Applications, 3rd ed., McGraw-Hill, 2011/2012",
  locator: `Ch. 2 (Combustion and Thermochemistry), adiabatic flame temperature, ${what}`,
  isbn: "9780073380193",
  locatorVerified: false,
  locatorNote: "chapter-level only; page/table/figure number not checked against the book",
});

export const CHEM_FUELS = {
  CH4: {
    mechanism: "gri30.yaml",
    reference: {
      case: "Turns, An Introduction to Combustion, 3rd ed. — stoichiometric CH4/air at 300 K, 1 atm", value: 2226, unit: "K", tolerance: 25,
      inputs: { fuel: "CH4", phi: 1, T0: 300, P0: 1 },
      source: TURNS_3E("stoichiometric CH4/air"),
    },
  },
  H2: {
    mechanism: "h2o2.yaml",
    reference: {
      case: "Turns, An Introduction to Combustion, 3rd ed. — stoichiometric H2/air at 300 K, 1 atm", value: 2380, unit: "K", tolerance: 40,
      inputs: { fuel: "H2", phi: 1, T0: 300, P0: 1 },
      source: TURNS_3E("stoichiometric H2/air"),
    },
  },
};
export const CHEM_OXIDIZER = "O2:1, N2:3.76";

const chemOutcomeCache = new Map();
let chemQueue = Promise.resolve();

/** Serialize kernel runs: at most one chem demo solve in flight per process. */
function enqueueChem(fn) {
  const run = chemQueue.then(fn, fn);
  chemQueue = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Run (or reuse) one equilibrium solve. The outcome — never the receipt —
 * is cached by chemKernelKey, so a repeat request attests fresh while the
 * kernel runs once.
 */
export function solveChemEquilibrium(spec) {
  const { mechanism } = CHEM_FUELS[spec.fuel];
  const request = {
    mechanism, fuel: spec.fuel, oxidizer: CHEM_OXIDIZER,
    phi: spec.phi, T0: spec.T0, P0: spec.P0atm * 101325,
  };
  const key = chemKernelKey("equilibrium", request);
  if (chemOutcomeCache.has(key)) return chemOutcomeCache.get(key);
  const pending = enqueueChem(async () => {
    const ir = { nodes: [{ id: "CMB", kind: "Volume", props: { chemistry: { op: "equilibrium", ...request } } }] };
    const opened = openDesign(ir);
    if (!opened.ok) return { status: "NOT_COMPUTED", reason: "the demo design did not compile" };
    await opened.session.settle();
    const env = opened.session.results().find((e) => e && e.solver && e.solver.id === "chem.equilibrium");
    if (!env) return { status: "NOT_COMPUTED", reason: "the equilibrium solver produced no run for the demo design" };
    const tAd = env.outputs && env.outputs.adiabaticFlameTemperature
      ? env.outputs.adiabaticFlameTemperature.value
      : undefined;
    if (env.status === "NOT_COMPUTED" || typeof tAd !== "number" || !Number.isFinite(tAd)) {
      return {
        status: "NOT_COMPUTED",
        reason: typeof env.reason === "string" && env.reason
          ? env.reason
          : "the chemistry kernel did not compute a result",
        solver: env.solver,
        assumptions: env.assumptions,
      };
    }
    const products = env.outputs.majorProducts && Array.isArray(env.outputs.majorProducts.value)
      ? env.outputs.majorProducts.value.map((p) => ({ species: p.species, moleFraction: roundTo(p.X, 4) }))
      : [];
    return { status: "COMPUTED", tAd, products, solver: env.solver, assumptions: env.assumptions };
  });
  chemOutcomeCache.set(key, pending);
  return pending;
}


/**
 * The v2 calc-receipt parts (to hand to buildCalcReceipt) for one chem outcome. The reference
 * verdict (PASS/FAIL against the cited Turns value) is computed only at
 * the reference state (phi 1, 300 K, 1 atm) the citation describes; off
 * that state a computed temperature carries WARN with the reason stated,
 * and an uncomputed one is NOT_COMPUTED — never a fabricated verdict.
 */
export function chemReceiptParts(spec, outcome) {
  const fuelSpec = CHEM_FUELS[spec.fuel];
  const atReference = spec.phi === 1 && spec.T0 === 300 && spec.P0atm === 1;
  let verdict;
  if (outcome.status === "NOT_COMPUTED") {
    verdict = { status: "NOT_COMPUTED", text: outcome.reason || "The chemistry kernel did not compute a result." };
  } else if (atReference) {
    const within = Math.abs(outcome.tAd - fuelSpec.reference.value) <= fuelSpec.reference.tolerance;
    verdict = {
      status: within ? "PASS" : "FAIL",
      governing: "reference comparison",
      text: `${within ? "PASS" : "FAIL"}: adiabatic flame temperature ${roundTo(outcome.tAd, 1)} K against the cited ${fuelSpec.reference.value} K ± ${fuelSpec.reference.tolerance} K.`,
    };
  } else {
    verdict = {
      status: "WARN",
      governing: "reference comparison",
      text: `Computed ${roundTo(outcome.tAd, 1)} K. The cited reference verdict applies at phi 1, 300 K, 1 atm; this run's inputs differ, so no pass/fail is claimed against it.`,
    };
  }
  return {
    solver: outcome.solver && outcome.solver.id
      ? { id: outcome.solver.id, version: outcome.solver.version }
      : { id: "chem.equilibrium", version: "" },
    inputs: {
      fuel: spec.fuel,
      mechanism: fuelSpec.mechanism,
      oxidizer: CHEM_OXIDIZER,
      equivalenceRatio: spec.phi,
      initialTemperature: { value: spec.T0, unit: "K" },
      initialPressure: { value: spec.P0atm, unit: "atm" },
    },
    method: outcome.solver && typeof outcome.solver.method === "string"
      ? outcome.solver.method
      : "Cantera chemical equilibrium at fixed enthalpy and pressure (HP)",
    designBasis: {
      code: "none — reference-value comparison only",
      loadFactors: "n/a",
      checksPerformed: ["Adiabatic flame temperature against the cited reference value, within its stated tolerance"],
      checksNotPerformed: ["Finite-rate kinetics", "Heat loss and radiation", "Transport and mixing effects"],
    },
    assumptions: Array.isArray(outcome.assumptions) && outcome.assumptions.length ? outcome.assumptions : undefined,
    results: outcome.status === "NOT_COMPUTED"
      ? {}
      : {
          adiabaticFlameTemperature: { value: roundTo(outcome.tAd, 1), unit: "K" },
          ...(outcome.products && outcome.products.length ? { majorProducts: outcome.products } : {}),
        },
    verdict,
    reference: fuelSpec.reference,
  };
}
