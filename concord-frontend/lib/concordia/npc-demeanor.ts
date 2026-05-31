// concord-frontend/lib/concordia/npc-demeanor.ts
//
// WS-CONSEQUENCE — make the world's memory VISIBLE before a word is spoken. The
// substrate already remembers (npc_grudges / faction reputation / gratitude) and
// the dialogue already colours by it; this surfaces it at a GLANCE: an NPC's
// nameplate tint + approach posture + icon shift with how they regard YOU, so a
// player SEES the consequence of what they did, not just reads it once inside a
// dialogue box. Pure + total; the nameplate renderer consumes it.

export type Demeanor = "hostile" | "wary" | "cold" | "neutral" | "warm" | "devoted";

export interface DemeanorResult {
  demeanor: Demeanor;
  /** nameplate tint (hex) */
  tint: string;
  /** a single glyph above the nameplate */
  icon: string;
  /** approach posture hint for the NPC rig (used by the activity tag) */
  posture: "menacing" | "guarded" | "closed" | "open" | "eager";
  label: string;
}

const TABLE: Record<Demeanor, Omit<DemeanorResult, "demeanor">> = {
  hostile: { tint: "#c0392b", icon: "⚔", posture: "menacing", label: "Hostile" },
  wary:    { tint: "#d68910", icon: "👁", posture: "guarded",  label: "Wary of you" },
  cold:    { tint: "#7f8c8d", icon: "❄", posture: "closed",   label: "Cold toward you" },
  neutral: { tint: "#bdc3c7", icon: "",  posture: "open",     label: "" },
  warm:    { tint: "#52be80", icon: "♥", posture: "open",     label: "Fond of you" },
  devoted: { tint: "#f1c40f", icon: "★", posture: "eager",    label: "Devoted to you" },
};

/**
 * Resolve an NPC's demeanor toward the player from the remembered signals. PURE.
 * @param s {
 *   grudge?: 0..10 (npc_grudges severity),
 *   reputation?: -1..+1 (faction reputation, normalized),
 *   gratitude?: 0..10 (saved/helped),
 *   hostile?: boolean (actively an enemy),
 * }
 */
export function resolveDemeanor(s: {
  grudge?: number; reputation?: number; gratitude?: number; hostile?: boolean;
} = {}): DemeanorResult {
  const grudge = clamp(s.grudge ?? 0, 0, 10);
  const gratitude = clamp(s.gratitude ?? 0, 0, 10);
  const rep = clamp(s.reputation ?? 0, -1, 1);

  // Net regard: gratitude + reputation lift; grudge sinks. Grudge is weighted
  // heavily — being wronged is remembered louder than being helped.
  const net = gratitude * 0.4 + rep * 4 - grudge * 0.6;

  let demeanor: Demeanor;
  if (s.hostile || grudge >= 8) demeanor = "hostile";
  else if (net <= -2.5) demeanor = "wary";
  else if (net < -0.5) demeanor = "cold";
  else if (net >= 4) demeanor = "devoted";
  else if (net >= 1.2) demeanor = "warm";
  else demeanor = "neutral";

  return { demeanor, ...TABLE[demeanor] };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number(x) || 0));
}
