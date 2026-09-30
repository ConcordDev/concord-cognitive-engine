/**
 * Pain regions → combat verbs. Broken arm hits weaker; broken leg cannot dodge.
 * Pure: no DB. Callers pass getPainBudget(db, userId).byRegion.
 */
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function verbsFromPain(byRegion = {}) {
  const arms = n(byRegion.arms);
  const legs = n(byRegion.legs);
  const head = n(byRegion.head);
  const torso = n(byRegion.torso);
  return {
    damageMul: arms > 0.7 ? 0.62 : arms > 0.35 ? 0.82 : 1,
    speedMul: legs > 0.7 ? 0.68 : legs > 0.35 ? 0.85 : 1,
    staminaCostMul: arms > 0.7 ? 1.4 : 1,
    dodgeDisabled: legs > 0.75,
    staggerTakenMul: head > 0.55 ? 1.4 : 1,
    brokenArm: arms > 0.7,
    brokenLeg: legs > 0.75,
    headTrauma: head > 0.6,
    winded: torso > 0.7,
  };
}

export function limbContextModifiers(byRegion) {
  const v = verbsFromPain(byRegion);
  return {
    damageMul: v.damageMul,
    staminaCostMul: v.staminaCostMul,
    evadeBonus: 0,
    limbVerbs: v,
  };
}
