// server/lib/feature-flags.js
//
// Centralized read for `FF_*` and `CONCORD_*` env-var feature flags.
// Returns 1/0 booleans (with a default fallback) so callers can write:
//
//   if (getFlag("FF_DX_SOCKET", 1)) { ... }
//   if (getFlag("FF_MOUNTS_RIDING", 1)) { ... }
//   if (getFlag("FF_MACRO_BILLING", 1)) { ... }
//
// Convention:
//   - FF_*       — Phase / feature kill-switches added by DX Platform
//                  and Mount System tracks. Default 1 in dev, 0 in prod
//                  for staged rollout (caller chooses default).
//   - CONCORD_*  — Pre-existing kill-switches and tunables (see CLAUDE.md
//                  multi-tenant cap defaults). Forwarded as-is.
//
// Truthy values: "1", "true", "yes", "on" (case-insensitive).
// Anything else (including missing) → falls back to `defaultVal`.

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY  = new Set(["0", "false", "no", "off"]);

export function getFlag(name, defaultVal = 0) {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultVal ? 1 : 0;
  const v = String(raw).trim().toLowerCase();
  if (TRUTHY.has(v)) return 1;
  if (FALSY.has(v)) return 0;
  return defaultVal ? 1 : 0;
}

// Numeric flags (for `*_CAP`, `*_INTERVAL` style env vars). Returns
// `defaultVal` if unset or unparseable.
export function getFlagNumber(name, defaultVal) {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultVal;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultVal;
}
