// server/lib/high-power-allowlist.js
//
// Private Mode / High Power Mode — rollout gate (task #33 of the plan).
//
// CONCORD_HIGH_POWER_ALLOWLIST controls WHO can see/opt into High Power
// Mode, independent of the durable users.brain_mode column. It is a
// ROLLOUT safety net, not a privacy control — Private Mode's guarantee is
// never gated by this, and every account can always choose or keep
// Private regardless of allowlist state. The point is to let an operator
// watch real platform-provider spend/volume on a small group first (see
// GET /api/admin/platform-providers-status) before opening High Power
// Mode to everyone, without needing a migration to remove the gate later.
//
// Values of CONCORD_HIGH_POWER_ALLOWLIST:
//   - unset (the env var does not exist at all)  -> everyone allowed.
//     This is the "gate removed" state: an operator who never configures
//     it, or later deletes the var, gets the fully-open feature with zero
//     code/migration changes — matching the plan's own framing.
//   - "*"                                         -> everyone allowed,
//     explicit (identical effect to unset; useful when an ops config
//     wants this stated rather than implied by omission).
//   - "" (present but empty string)               -> NOBODY allowed. An
//     explicit hard-lockout switch, distinct from simply not setting the
//     var — lets an operator kill the feature without also having to
//     remember to unset a value elsewhere.
//   - a comma-separated list of user ids           -> only those ids.
//
// Re-checked SERVER-SIDE on every write path (routes/auth.js's
// choose-brain-mode, domains/byo-keys.js's set_brain_mode) — never only
// hidden in the UI, so a client that skips (or never loads) the
// visibility check can't bypass it by calling the endpoint directly.

export function isHighPowerModeAllowed(userId) {
  const raw = process.env.CONCORD_HIGH_POWER_ALLOWLIST;
  if (raw === undefined) return true; // gate never configured / removed
  if (raw === "*") return true;
  if (raw.trim() === "") return false; // explicit hard lockout
  if (!userId) return false;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(String(userId));
}

/**
 * Summarize the allowlist's current MODE for an operator diagnostic (GET
 * /api/admin/platform-providers-status) — never the actual membership
 * list, since that's operator config, not something worth exposing over
 * an API even to other admins.
 * @returns {{mode:'open'|'closed'|'list', note?:string, size?:number}}
 */
export function describeAllowlistMode() {
  const raw = process.env.CONCORD_HIGH_POWER_ALLOWLIST;
  if (raw === undefined || raw === "*") {
    return { mode: "open", note: "everyone can opt into High Power Mode" };
  }
  if (raw.trim() === "") {
    return { mode: "closed", note: "High Power Mode is hard-disabled for every account" };
  }
  return { mode: "list", size: raw.split(",").map((s) => s.trim()).filter(Boolean).length };
}
