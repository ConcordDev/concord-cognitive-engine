#!/usr/bin/env node
// scripts/wire-graph-adapters.mjs
//
// One-off migration: give every `targets: () => []` solver a real graph
// target + a graph-native `run(ctx, id)` that reads its props namespace.
//
// The registry contract is `for (const t of s.targets(graph)) s.run(ctx, t)`,
// so `targets: () => []` makes a solver invisible to the design graph. This
// rewrites each registration to use graph-adapter.js instead.
//
// Idempotent: a file already wired is skipped.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOLVERS = path.resolve(HERE, "../server/lib/conkay/physics/solvers");

/** solver file stem → { namespace, exportName, argName } */
const PLAN = {
  "kinematics-inverse-leg":        { ns: "kinematics.legIK",      fn: "inverseLegIK",        arg: "opts" },
  "kinematics-range-check":        { ns: "kinematics.rangeCheck", fn: "rangeCheckTrajectory", arg: "opts" },
  "kinematics-self-collision-2d":  { ns: "kinematics.selfCollision", fn: "selfCollisionCheck2D", arg: "opts" },
  "gait-preview-control":          { ns: "gait.preview",          fn: "gaitPreviewControl",   arg: "opts" },
  "actuation-thermal-budget":      { ns: "actuation.thermal",     fn: "thermalBudgetTrajectory", arg: "opts" },
  "dynamics-forward":              { ns: "dynamics.forwardDeps",  fn: "dynamicsForward",     arg: "opts" },
  "gait-footstep-sequence-plan":   { ns: "gait.footstepSequence", fn: "footstepSequencePlan", arg: "opts" },
  "gait-capture-point-reachability": { ns: "gait.capturePointReach", fn: "capturePointReachability", arg: "opts" },
  "gait-swing-collision-check":    { ns: "gait.swingCollision",   fn: "swingCollisionCheck",  arg: "opts" },
  "stability-push-recovery":       { ns: "stability.pushRecovery", fn: "pushRecovery",        arg: "opts" },
  "stability-pressure-distribution": { ns: "stability.pressure",  fn: "pressureDistribution", arg: "opts" },
  "mass-inertia-moment":           { ns: "mass.inertiaMoment",    fn: "inertiaMoment",        arg: "opts" },
  "fea-bone-stance-stress":        { ns: "fea.boneStance",        fn: "boneStanceStress",    arg: "opts" },
  "joint-bolt-screening":          { ns: "joint.boltScreen",      fn: "boltScreening",        arg: "opts" },
  "electrical-battery-budget":     { ns: "electrical.batteryBudget", fn: "batteryBudget",     arg: "opts" },
  "electrical-motor-thermal":      { ns: "electrical.motorThermal", fn: "motorThermal",      arg: "opts" },
  "dynamics-full-body-rnea":       { ns: "dynamics.fullBody",     fn: "fullBodyRnea",        arg: "opts" },
  "robotics-impedance-controller": { ns: "robotics.impedance",    fn: "impedanceController", arg: "opts" },
  "dynamics-parameter-id":         { ns: "dynamics.parameterId",  fn: "parameterId",         arg: "opts" },
  "gait-slope-walking":            { ns: "gait.slope",            fn: "slopeWalking",        arg: "opts" },
  "humanoid-step-pipeline":        { ns: "humanoid.stepPipeline", fn: "humanoidStepPipeline", arg: "opts" },
  "actuation-joint-torque":        { ns: "actuation.torqueScreen", fn: "actuationJointTorque", arg: "opts" },
  "stability-dynamic":             { ns: "stability.dynamic",     fn: "stabilityDynamic",    arg: "opts" },
  "gait-footstep-plan":            { ns: "gait.footstepPlan",     fn: "gaitFootstepPlan",    arg: "opts" },
};

let wired = 0;
let skipped = [];
let failed = [];

for (const [stem, plan] of Object.entries(PLAN)) {
  const file = path.join(SOLVERS, `${stem}.js`);
  let src;
  try {
    src = await readFile(file, "utf8");
  } catch {
    failed.push(`${stem}: file not found`);
    continue;
  }

  if (src.includes("graph-adapter.js")) { skipped.push(stem); continue; }
  if (!src.includes("targets: () => []")) { skipped.push(`${stem} (already has real targets)`); continue; }

  // 1. add the adapter import right after the registry import. The adapters
  // fea-bone-stance-stress and joint-bolt-screening already pull `envelope`
  // from "../registry.js", which does not exist there — so we never reuse
  // the registry envelope and always add ours below.
  const registryImportRe = /^import \{ registerSolver[^}]*\} from "\.\.\/registry\.js";$/m;
  const m = src.match(registryImportRe);
  if (!m) { failed.push(`${stem}: no registry import`); continue; }
  src = src.replace(
    m[0],
    `${m[0]}\nimport { graphTargets, graphRunner, envelope } from "./graph-adapter.js";`,
  );

  // 2. replace the stub targets + run with graph-native versions
  //    Handles both shapes: `targets: () => [], run: (opts) => fn(opts)` and
  //    `targets: () => [], run: ({...}) => fn({...})`.
  const stubTargets = "targets: () => [],";
  if (!src.includes(stubTargets)) { failed.push(`${stem}: targets stub not found`); continue; }

  const graphBlock =
    `  // Graph-native: runs when any node carries props.${plan.ns}.\n` +
    `  // The props subtree is passed straight through to ${plan.fn}.\n` +
    `  targets: graphTargets("${plan.ns}"),\n` +
    `  run: graphRunner("${plan.ns}", (ctx, id, props) => envelope(${plan.fn}(props))),`;

  // Replace the stub `targets` AND whatever `run:` followed it. Some files use
  // a one-liner `run: (opts) => fn(opts)`; others destructure inline across
  // several lines. Leaving the old run in place would shadow the graph runner.
  const after = src.indexOf(stubTargets);
  const runIdx = src.indexOf("run:", after);
  if (runIdx < 0) { failed.push(`${stem}: no run: after targets stub`); continue; }

  // Walk to the end of the run expression: it ends at the first "\n  }" that
  // closes the arrow body, or at "\n});" for a one-liner.
  const rest = src.slice(runIdx);
  const oneLiner = /^run:[^\n]*\n/.exec(rest);
  let cutEnd;
  if (oneLiner && oneLiner[0].includes("=>")) {
    cutEnd = oneLiner[0].length;
  } else {
    const closeIdx = rest.indexOf("\n  });");
    if (closeIdx < 0) { failed.push(`${stem}: could not find end of run block`); continue; }
    cutEnd = closeIdx + "\n  });".length;
  }

  src = src.slice(0, after) + graphBlock + src.slice(runIdx + cutEnd);

  // 3. ensure `envelope` is imported from our local adapter. Adapters that
  // already pulled `envelope` from the registry get their import left alone
  // (the registry has no `envelope` export, so the original code was already
  // broken — but that's a separate issue and we don't pile on here).
  if (!/from "\\.\\/graph-adapter\\.js"/.test(src) || !/graphRunner/.test(src)) {
    failed.push(`${stem}: post-patch adapter import missing`);
    continue;
  }

  await writeFile(file, src, "utf8");
  wired += 1;
}

console.log(`wired: ${wired}`);
console.log(`skipped: ${skipped.length}${skipped.length ? ` → ${skipped.join(", ")}` : ""}`);
if (failed.length) {
  console.log(`FAILED: ${failed.length}`);
  for (const f of failed) console.log(`  - ${f}`);
  process.exit(1);
}