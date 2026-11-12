/**
 * errorWords.ts — kingdoms failure tokens in user words (CB-0473).
 *
 * The kingdoms domain answers failures with machine tokens
 * ('kingdom_not_found', 'quorum_not_met', literal fallbacks like
 * 'char_create failed'). Every DynastyRealmManager tab error funnels
 * through one callback, and KingdomCreatePanel renders its own error
 * line — both translate through this map. Unknown tokens are humanized
 * (underscores to spaces, a trailing ' failed' reads as a sentence)
 * rather than dumped raw.
 */

const WORDS: Record<string, string> = {
  kingdom_not_found: 'That kingdom could not be found.',
  not_found: 'That record could not be found.',
  missing_inputs: 'Some required fields are missing.',
  not_heir: 'That character is not the heir.',
  quorum_not_met: 'Not enough council members voted — the quorum was not met.',
  election_requires_kingdom_ruler_proposal: 'An election can only start from a ruler’s proposal.',
  invalid_proof: 'That proof did not validate.',
  invalid_proposal: 'That proposal is not valid.',
  forbidden: 'You do not have permission to do that.',
  no_world: 'No kingdom world exists yet — found one first.',
  no_db: 'The kingdoms store is unavailable — try again shortly.',
  create_failed: 'The kingdom could not be created — try again.',
};

export function kingdomErrorWords(token?: string | null, fallback = 'Something went wrong — try again.'): string {
  if (!token) return fallback;
  if (WORDS[token]) return WORDS[token];
  if (token.endsWith('_failed')) return 'That failed on the server — try again.';
  const human = token.replace(/_/g, ' ');
  return human.charAt(0).toUpperCase() + human.slice(1) + (human.endsWith('failed') ? '.' : '');
}
