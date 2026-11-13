/** Length gates shared by lens writes. Over-long text is refused, not sliced. */

export const SCENE_LOCATION_MAX = 120;
export const TOURNAMENT_TITLE_MAX = 120;

export function acceptSceneLocation(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "A location is required." };
  if (trimmed.length > SCENE_LOCATION_MAX) {
    return { ok: false, error: `Location must be ${SCENE_LOCATION_MAX} characters or fewer.` };
  }
  return { ok: true, location: trimmed };
}

export function acceptTournamentTitle(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "A title is required." };
  if (trimmed.length > TOURNAMENT_TITLE_MAX) {
    return { ok: false, error: `Title must be ${TOURNAMENT_TITLE_MAX} characters or fewer.` };
  }
  return { ok: true, title: trimmed };
}
