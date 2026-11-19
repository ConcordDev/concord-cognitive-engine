/**
 * Groove templates (studio.groove-list) as a song feel. The Studio transport
 * swing runs 0–100, where 100 delays each off-eighth by a triplet eighth; a
 * template's swing is a fraction where 0.5 is that same triplet feel. So
 * transport swing = template swing × 200, capped at 100.
 */
export function swingFromGroove(swing: number): number {
  if (!Number.isFinite(swing) || swing <= 0) return 0;
  return Math.min(100, Math.round(swing * 200));
}

/** The template whose swing matches the song's current swing, if any. */
export function grooveForSwing<T extends { swing: number }>(grooves: T[], transportSwing: number): T | null {
  return grooves.find((g) => swingFromGroove(g.swing) === Math.round(transportSwing)) ?? null;
}
