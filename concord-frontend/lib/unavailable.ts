// Shared formatter for values the backend reports as null plus a reason code.
// The reason codes are machine tokens (e.g. `no_ledger_table`); the UI must
// never print them raw. Map each known code to a short plain sentence.
// Unknown codes fall back to a generic sentence, never the raw token.

export const NOT_AVAILABLE = 'Not available';

const REASON_SENTENCES: Record<string, string> = {
  // Royalties / citations (economy_ledger)
  no_ledger_table: 'no royalty ledger yet',
  ledger_unreadable: 'royalty ledger could not be read',
  // Buildings (world_buildings)
  no_building_table: 'no building records yet',
  no_buildings: 'no buildings in this world yet',
  no_building_state: 'building condition is not recorded',
  buildings_not_attributed: 'buildings do not record who placed them',
  buildings_unreadable: 'building records could not be read',
  // Reputation (user_reputation)
  no_reputation_table: 'no reputation records yet',
  no_reputation_row: 'no reputation earned yet',
  reputation_unreadable: 'reputation records could not be read',
  // Playtime (world_visits)
  no_visit_table: 'no visit records yet',
  visits_unreadable: 'visit records could not be read',
  // Login streak (user_login_streak)
  no_streak_table: 'no login streak records yet',
  no_streak_row: 'no login streak yet',
  streak_unreadable: 'login streak could not be read',
  // Ecosystem score (player_world_metrics)
  no_metrics_table: 'no ecosystem metrics yet',
  no_ecosystem_score: 'ecosystem score is not recorded',
  metrics_unreadable: 'ecosystem metrics could not be read',
  no_sample: 'no players have an ecosystem score here yet',
  // Generic
  not_recorded: 'not recorded',
};

/** The full message for a null value: "Not available — <plain reason>". */
export function unavailableMessage(reason?: string | null): string {
  const sentence = (reason && REASON_SENTENCES[reason]) || 'no data reported';
  return `${NOT_AVAILABLE} — ${sentence}`;
}
