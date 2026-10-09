// server/lib/conkay/verification/mass-state.js
//
// Mass states. Every mass in a design says where it came from:
//
//   sourced     a published manufacturer or supplier spec, or a published
//               measurement of the exact part (massState.sourceKind says
//               which). Needs the source (URL or document) and the exact
//               variant it applies to.
//   estimated   a documented engineering estimate. Needs the method and an
//               uncertainty range: { lowKg, highKg } or { pct }.
//   computed    geometry × density from material properties. Needs a
//               reference to the geometry and the material.
//   placeholder no real source or computation yet. Needs a note saying so.
//
// A sourced mass is right only for the variant it was published for;
// applicability (components/index.js) checks that variant against the
// configuration. summarizeMassStates rolls a list of masses up by state with
// an uncertainty band: the estimated ranges are summed; placeholders have no
// honest band, so the band says it excludes them.

export const MASS_STATES = ["sourced", "estimated", "computed", "placeholder"];

const str = (v) => typeof v === "string" && v.trim().length > 0;

/**
 * Validate a massState object. `massKg` (optional) is the mass it describes,
 * used to check an estimate's range contains it. Returns a list of errors
 * (empty when valid).
 */
export function validateMassState(ms, { massKg } = {}) {
  const errors = [];
  if (!ms || typeof ms !== "object") return ["massState must be an object"];
  if (!MASS_STATES.includes(ms.state)) return [`massState.state must be one of ${MASS_STATES.join(", ")} (got ${JSON.stringify(ms.state)})`];
  if (ms.state === "sourced") {
    const s = ms.source;
    if (!s || typeof s !== "object" || !(str(s.url) || str(s.document))) errors.push("sourced mass needs source.url or source.document");
    else if (str(s.url) && !/^https?:\/\//.test(s.url)) errors.push("source.url must be an http(s) URL");
    if (!str(ms.variant)) errors.push("sourced mass needs the exact variant it was published for (massState.variant)");
  } else if (ms.state === "estimated") {
    if (!str(ms.method)) errors.push("estimated mass needs a method note (massState.method)");
    const u = ms.uncertainty;
    if (!u || typeof u !== "object") errors.push("estimated mass needs an uncertainty range: { lowKg, highKg } or { pct }");
    else if (u.pct != null) {
      if (!(Number.isFinite(u.pct) && u.pct > 0)) errors.push("uncertainty.pct must be a positive number");
    } else if (!(Number.isFinite(u.lowKg) && Number.isFinite(u.highKg) && u.lowKg >= 0 && u.lowKg <= u.highKg)) {
      errors.push("uncertainty needs lowKg ≤ highKg (both ≥ 0), or pct");
    } else if (Number.isFinite(massKg) && (massKg < u.lowKg - 1e-9 || massKg > u.highKg + 1e-9)) {
      errors.push(`estimated mass ${massKg} kg is outside its own range ${u.lowKg}–${u.highKg} kg`);
    }
  } else if (ms.state === "computed") {
    if (!str(ms.geometryRef)) errors.push("computed mass needs geometryRef (the geometry it was computed from)");
    if (!str(ms.materialRef)) errors.push("computed mass needs materialRef (the material whose density was used)");
  } else if (ms.state === "placeholder") {
    if (!str(ms.note)) errors.push("placeholder mass needs a note saying what it stands in for");
  }
  return errors;
}

/** The [low, high] band of one mass in its state (null for a placeholder). */
export function massBand(massKg, ms) {
  if (ms.state === "placeholder") return null;
  if (ms.state !== "estimated") return [massKg, massKg];
  const u = ms.uncertainty;
  if (u.pct != null) return [massKg * (1 - u.pct / 100), massKg * (1 + u.pct / 100)];
  return [u.lowKg, u.highKg];
}

/**
 * Roll up [{ id, massKg, massState }] (massKg may be null for a placeholder
 * with no mass at all). Returns the total, kg and % by state, counts, and the
 * uncertainty band. Percentages are of the total known mass.
 */
export function summarizeMassStates(items) {
  const byState = Object.fromEntries(MASS_STATES.map((s) => [s, { kg: 0, pct: 0, count: 0, ids: [] }]));
  let total = 0;
  let low = 0;
  let high = 0;
  const unmassed = [];
  for (const it of items) {
    const s = it.massState?.state;
    if (!MASS_STATES.includes(s)) throw new Error(`${it.id}: no valid mass state`);
    const b = byState[s];
    b.count += 1;
    b.ids.push(it.id);
    if (!Number.isFinite(it.massKg)) { unmassed.push(it.id); continue; }
    b.kg += it.massKg;
    total += it.massKg;
    const band = massBand(it.massKg, it.massState);
    if (band) { low += band[0]; high += band[1]; } else { low += it.massKg; high += it.massKg; }
  }
  for (const s of MASS_STATES) byState[s].pct = total > 0 ? (byState[s].kg / total) * 100 : 0;
  return {
    totalKg: total,
    byState,
    uncertainty: {
      lowKg: low,
      highKg: high,
      method: "Σ estimated ranges; sourced and computed masses at their value",
      excludes: byState.placeholder.count
        ? `${byState.placeholder.count} placeholder(s) (${byState.placeholder.kg.toFixed(1)} kg at face value${unmassed.length ? `, ${unmassed.length} with no mass at all` : ""}): a placeholder has no honest band`
        : null,
    },
    unmassed,
  };
}
