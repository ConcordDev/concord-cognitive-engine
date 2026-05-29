// server/lib/world-danger.js
//
// WS6 — danger telegraphing helpers. Turns an entity's level RELATIVE to the
// player into a learnable tell (Witcher-3 skull style): the world is never
// walled off, but the player can read how lethal something is before engaging.
// Pure + tiny so both the danger endpoint and any client can share the mapping.

const TELLS = Object.freeze([
  { max: -10, label: "trivial",   severity: 0, color: "#7c8794" }, // grey
  { max: -3,  label: "easy",      severity: 1, color: "#4ade80" }, // green
  { max: 3,   label: "even",      severity: 2, color: "#e5e7eb" }, // white
  { max: 8,   label: "tough",     severity: 3, color: "#facc15" }, // yellow
  { max: 15,  label: "dangerous", severity: 4, color: "#fb923c" }, // orange
  { max: Infinity, label: "deadly", severity: 5, color: "#ef4444" }, // red
]);

/**
 * Map a level delta (entityLevel - playerLevel) to a danger tell.
 * @returns {{ label, severity, color }}
 */
export function dangerLabel(levelDelta) {
  const d = Number(levelDelta) || 0;
  for (const t of TELLS) if (d <= t.max) return { label: t.label, severity: t.severity, color: t.color };
  return TELLS[TELLS.length - 1];
}

export const DANGER_TELLS = TELLS;
