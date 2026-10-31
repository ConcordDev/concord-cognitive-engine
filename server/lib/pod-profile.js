// Pod profile: the brains run on the RunPod A40 (48 GB VRAM), while the backend can still sit on a small Mac.
// Many limits were sized for the Mac's local 2B models. CONCORD_POD_PROFILE=1 selects the pod-sized values;
// unset or 0 keeps the lean values, so a Mac-local fallback (pod unreachable) is unchanged.
// Every limit stays individually overridable by its own env var; this only switches the defaults and ceilings.
export function podProfile(env = process.env) {
  const v = String(env.CONCORD_POD_PROFILE ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

/** pick(lean, pod): the default for the active profile. */
export function podPick(lean, pod, env = process.env) {
  return podProfile(env) ? pod : lean;
}

/** An env-tunable number: explicit env wins, else the profile default, clamped to the profile ceiling. */
export function podNumber(envName, { lean, pod, leanMax = Infinity, podMax = Infinity }, env = process.env) {
  const on = podProfile(env);
  const raw = Number(env[envName]);
  const base = Number.isFinite(raw) && raw > 0 ? raw : (on ? pod : lean);
  return Math.min(base, on ? podMax : leanMax);
}
