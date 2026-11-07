// League form contract for the sports-league-engine REST routes.
// openLeague refuses a body that omits worldId (reason missing_inputs).
// This form has no world picker, so a personal league is filed on the
// hub world. concordia-hub is the real hub id used across the client.
// sport_kind is a CHECK on sports_leagues: tennis and cricket are not rows.

export const HUB_WORLD_ID = 'concordia-hub';

export const LEAGUE_SPORTS = [
  'soccer',
  'basketball',
  'baseball',
  'esports',
  'racing',
  'brawling',
] as const;

export type LeagueSport = (typeof LEAGUE_SPORTS)[number];

export function leagueCreateBody(name: string, sportKind: string): {
  name: string;
  sportKind: string;
  worldId: string;
} {
  return { name: name.trim(), sportKind, worldId: HUB_WORLD_ID };
}

type ActionBody = {
  ok?: boolean;
  reason?: string;
  error?: string;
} | null | undefined;

/** Null when the action succeeded. Otherwise a sentence the panel can show. */
export function actionError(body: ActionBody, status: number, label: string): string | null {
  if (body?.ok) return null;
  const why = body?.reason || body?.error;
  if (why) return `${label} (${why}).`;
  if (status >= 400) return `${label} (${status}).`;
  return `${label}.`;
}

export function hasMatchScores(homeScore: unknown, awayScore: unknown): boolean {
  return Number.isFinite(homeScore) && Number.isFinite(awayScore);
}

/** Higher score wins. Equal finite scores are a draw (null). Call only after hasMatchScores. */
export function winnerTeamId(
  homeId: string,
  awayId: string,
  homeScore: number,
  awayScore: number,
): string | null {
  if (homeScore > awayScore) return homeId;
  if (awayScore > homeScore) return awayId;
  return null;
}
