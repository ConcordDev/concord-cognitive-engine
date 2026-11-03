// Personal fixture result for the Matches artifact.
// A blank score is not 0. A past date with no score is not upcoming.
// Both scores present is a recorded result: your team is scoreHome.

export type FixtureResult = 'win' | 'loss' | 'draw' | 'upcoming' | 'unscored';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseScore(raw: unknown): number | null {
  if (raw === '' || raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return null;
    return Math.round(raw);
  }
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

export type ScorePair =
  | { kind: 'blank' }
  | { kind: 'partial' }
  | { kind: 'pair'; home: number; away: number };

export function scorePair(scoreHome: unknown, scoreAway: unknown): ScorePair {
  const home = parseScore(scoreHome);
  const away = parseScore(scoreAway);
  if (home === null && away === null) return { kind: 'blank' };
  if (home === null || away === null) return { kind: 'partial' };
  return { kind: 'pair', home, away };
}

export function resultFromScores(home: number, away: number): 'win' | 'loss' | 'draw' {
  if (home > away) return 'win';
  if (away > home) return 'loss';
  return 'draw';
}

/** Blank scores follow the date. A past day is unscored. Today and later stay upcoming. */
export function resultFromDate(date: string, today: string): 'upcoming' | 'unscored' {
  if (DAY.test(date) && DAY.test(today) && date < today) return 'unscored';
  return 'upcoming';
}

export function badgeForStored(
  game: { result?: string | null; date?: string | null },
  today: string,
): FixtureResult {
  if (game.result === 'win' || game.result === 'loss' || game.result === 'draw') return game.result;
  return resultFromDate(game.date || '', today);
}
