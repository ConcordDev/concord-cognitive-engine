// server/lib/conkay/chat/repair-rules.js
//
// The repair table: for a failing (or flagged) check, which design variables may move, in what steps, within what
// bounds, and why (the rule's citation). Deterministic: a rule proposes candidate values; the orchestrator runs
// each one through the real pipeline and keeps only what the computed margins support. No rule ever changes a
// requirement; a rule with no candidate left reports its variable as binding.
//
// Seeded from the electric car done by hand (#1230): top speed on power -> the next drive unit in the library;
// rear slant past Ahmed's onset -> a longer tail; pack heat with no cooling designed -> listed, never repaired.
// The other hand repairs of that car (seat cross split at the tunnel, firewall from the feet / steering sweep /
// wheel wells, B-post vs rear thigh) became compiler derivations in #1230; they are listed here as encoded, so the
// table says where each one lives.

export const REPAIR_RULES_VERSION = "1.0.0";
export const SLANT_ONSET_DEG = 12.5; // Ahmed, Ramm & Faltin, SAE 840300 (1984): the slant drag rises past ~12.5°

const env = (ctx, runId) => ctx.envelopes.get(runId) || null;
const failing = (ctx, re) => [...ctx.envelopes.values()].filter((e) => e.status === "FAIL" && re.test(e.runId));

/** A requirement on top speed that fails, and the solver says the car is power (drag) limited. */
function topSpeedPowerLimited(ctx) {
  const req = failing(ctx, /^requirement\.check@REQ_topSpeed/);
  return req.length > 0 && /power|drag/i.test(ctx.report?.topSpeed?.limitedBy || "");
}

export const REPAIR_RULES = Object.freeze([
  {
    id: "top-speed.next-drive-unit",
    checks: ["requirement.check@REQ_topSpeed"],
    variable: "motorId",
    cite: "#1230 (by hand): the top speed failed on the iM-225's continuous power; the next speed-capable drive unit in the library (iM-375) held it. A repair changes the component, never the requirement.",
    bounds: "speed-capable motors in components/library.json, lightest first",
    applies: (ctx) => ctx.state.fuelType === "electric" && topSpeedPowerLimited(ctx),
    candidates(ctx) {
      const all = (ctx.report?.selection?.engine_or_motor?.candidates || []).filter((c) => c.ok).sort((a, b) => a.massKg - b.massKg || a.id.localeCompare(b.id));
      const cur = ctx.report?.selection?.engine_or_motor?.chosen;
      const curMass = all.find((c) => c.id === cur)?.massKg ?? -Infinity;
      const next = all.find((c) => c.massKg > curMass || (c.massKg === curMass && c.id > cur));
      return next ? [{ value: next.id, label: `drive unit ${cur} -> ${next.id}` }] : [];
    },
    atBound: (ctx) => `the heaviest speed-capable drive unit in the library (${ctx.report?.selection?.engine_or_motor?.chosen}) is already fitted`,
  },
  {
    id: "aero.rear-slant.tail-length",
    checks: ["requirement.check@REQ_topSpeed"],
    variable: "tailExtensionM",
    cite: "Ahmed et al., SAE 840300: the slant contribution rises past 12.5° (the build-up adds 0.14..0.158 there); #1230 (by hand): the electric body's slant was 13.2° at the 0.22 m tail and 10.8° at 0.6 m. Tail +0.1 m steps, up to 0.8 m added.",
    bounds: "tail extension from its current value + 0.1 m to + 0.8 m, never above 1.0 m",
    applies: (ctx) => topSpeedPowerLimited(ctx) && (env(ctx, "aero.drag-buildup@VEH")?.inputs?.rearSlantDeg?.value ?? 0) > SLANT_ONSET_DEG,
    candidates(ctx) {
      const cur = ctx.state.tailExtensionM;
      const out = [];
      for (let k = 1; k <= 8; k++) {
        const v = Math.round((cur + 0.1 * k) * 1000) / 1000;
        if (v > 1.0 + 1e-9) break;
        out.push({ value: v, label: `tail ${cur} m -> ${v} m` });
      }
      return out;
    },
    // the rule's own condition: the slant at or under the onset (the top speed may still need the drive unit)
    resolved: (ctx) => (env(ctx, "aero.drag-buildup@VEH")?.inputs?.rearSlantDeg?.value ?? Infinity) <= SLANT_ONSET_DEG,
    atBound: (ctx) => ((env(ctx, "aero.drag-buildup@VEH")?.inputs?.rearSlantDeg?.value ?? 0) > SLANT_ONSET_DEG ? "the tail is at its 1.0 m bound with the slant still past the onset" : `the rear slant is already at or under ${SLANT_ONSET_DEG}°: a longer tail does not lower the build-up further`),
  },
  {
    id: "traction-battery.heat",
    checks: ["vehicle.traction-battery@VEH"],
    variable: null,
    cite: "No pack cooling is designed (powertrain/ev-pack.js NOT_INCLUDED): the conduction-loss WARN stays a WARN; listed, never repaired by moving a number",
    bounds: null,
    applies: (ctx) => env(ctx, "vehicle.traction-battery@VEH")?.status === "WARN",
    candidates: () => [],
    listed: true,
  },
]);

/** Repairs that became compiler derivations (#1230): where each lives, so the table is complete. */
export const ENCODED_REPAIRS = Object.freeze([
  { id: "tub.seat-cross-split", where: "structural/car-tub.js (electric: the seat cross ends at the tunnel walls)" },
  { id: "layout.firewall-from-feet-sweep-wells", where: "compiler/car-layout.js deriveEvFront (feet vs steering sweep, the tub's sill vs the sweep and the wheel-well cut)" },
  { id: "layout.b-post-rear-thigh", where: "compiler/car-from-library.js buildCarFromLibrary (rear seats inboard by the overlap + 1 mm)" },
  { id: "pack.behind-firewall-sheet", where: "compiler/car-from-library.js placeBattery" },
]);
