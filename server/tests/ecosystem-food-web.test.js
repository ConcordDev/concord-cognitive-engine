// Animal Kingdom — trophic links + damped Lotka–Volterra population balance.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eats, preyForPredator, predatorsOf, sizeRankOf, balancePopulations,
} from "../lib/ecosystem/food-web.js";

test("trophic edges: predators eat smaller herbivores/omnivores, not each other", () => {
  assert.equal(eats("wolf", "deer"), true, "wolf eats deer");
  assert.equal(eats("wolf", "rabbit"), true);
  assert.equal(eats("bear", "goat"), true);
  assert.equal(eats("hawk", "rabbit"), true, "hawk (small) eats rabbit");
  // No cannibal / peer-predator edges.
  assert.equal(eats("wolf", "bear"), false, "no carnivore-eats-carnivore");
  assert.equal(eats("wolf", "wolf"), false, "no self-predation");
  // A herbivore is never a predator.
  assert.equal(eats("deer", "rabbit"), false, "herbivore doesn't hunt");
});

test("size gating: a small predator can't eat a larger animal", () => {
  assert.ok(sizeRankOf("bear") > sizeRankOf("deer"));
  assert.ok(sizeRankOf("rabbit") < sizeRankOf("wolf"));
  // hawk (rank 2) can't take a deer (rank 3) — only smaller prey.
  assert.equal(eats("hawk", "deer"), false);
});

test("preyForPredator / predatorsOf are inverse over a biome roster", () => {
  const prey = preyForPredator("standard", "forest", "wolf");
  assert.ok(prey.includes("deer"), "wolf preys on forest deer");
  // deer's predators in the forest include the wolf.
  const preds = predatorsOf("standard", "forest", "deer");
  assert.ok(preds.includes("wolf"));
});

test("balance: prey crash + predator excess starves predators, eases prey", () => {
  const r = balancePopulations({ predLive: 6, predTarget: 3, preyLive: 1, preyTarget: 10 });
  assert.ok(r.predTargetMult < 1, "predators pushed below target (starvation)");
  assert.equal(r.note, "prey_crash_predators_starve");
  // Multipliers stay bounded — never zero a tier in one pass.
  assert.ok(r.predTargetMult >= 0.5 && r.preyTargetMult <= 1.5);
});

test("balance: prey bloom + few predators lets predators grow", () => {
  const r = balancePopulations({ predLive: 1, predTarget: 3, preyLive: 16, preyTarget: 10 });
  assert.ok(r.predTargetMult > 1, "abundant prey supports more predators");
  assert.equal(r.note, "prey_bloom_predators_grow");
});

test("balance: at equilibrium the multipliers are ~1 (no churn)", () => {
  const r = balancePopulations({ predLive: 3, predTarget: 3, preyLive: 10, preyTarget: 10 });
  assert.ok(Math.abs(r.predTargetMult - 1) < 1e-9);
  assert.ok(Math.abs(r.preyTargetMult - 1) < 1e-9);
  assert.equal(r.note, "stable");
});

test("balance: no trophic pair passes through unchanged", () => {
  const r = balancePopulations({ predLive: 0, predTarget: 0, preyLive: 5, preyTarget: 8 });
  assert.equal(r.predTargetMult, 1);
  assert.equal(r.preyTargetMult, 1);
  assert.equal(r.note, "no_trophic_pair");
});

test("balance converges over repeated passes (damped, no extinction)", () => {
  // Start badly out of balance; apply the multipliers iteratively and confirm
  // the ratios move toward 1 and never collapse to 0.
  let predTarget = 3, preyTarget = 10;
  let predLive = 8, preyLive = 1;
  for (let i = 0; i < 40; i++) {
    const r = balancePopulations({ predLive, predTarget, preyLive, preyTarget });
    predTarget = Math.max(1, predTarget * r.predTargetMult);
    preyTarget = Math.max(1, preyTarget * r.preyTargetMult);
    // crude population relaxation toward target
    predLive += (predTarget - predLive) * 0.5;
    preyLive += (preyTarget - preyLive) * 0.5;
    assert.ok(predLive > 0 && preyLive > 0, "no tier goes extinct");
  }
  // After many passes the live populations should sit near their (shifted) targets.
  assert.ok(Math.abs(predLive - predTarget) / predTarget < 0.25);
  assert.ok(Math.abs(preyLive - preyTarget) / preyTarget < 0.25);
});
