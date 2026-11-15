/**
 * reasonWords.ts — foundry failure reasons in user words (CB-0473).
 *
 * The foundry domain answers failures with machine tokens
 * ({ ok: false, reason: 'no_systems' }). The studio, canvas, and preview
 * used to render those tokens verbatim. This map is the one translation
 * point: known tokens get plain words, the *_failed family gets an
 * honest generic, and anything unknown is humanized (underscores to
 * spaces) rather than dumped raw — the same fallback the mail client
 * uses for its error strings.
 */

const WORDS: Record<string, string> = {
  no_systems: 'Add at least one system first.',
  not_found: 'That world could not be found.',
  not_owner: 'Only the world’s owner can do that.',
  owner_only: 'Only the world’s owner can do that.',
  missing_id: 'No world was specified.',
  missing_name: 'Give the world a name first.',
  name_too_long: 'That name is too long — 200 characters at most.',
  missing_user_id: 'Enter a user id first.',
  cannot_add_self: 'You are already the owner — you cannot add yourself as a collaborator.',
  already_promoted: 'This world is already published.',
  already_published: 'This world is already published.',
  nothing_to_update: 'Nothing changed, so there was nothing to save.',
  unknown_template: 'That template does not exist.',
  unknown_system: 'That system does not exist.',
  unknown_category: 'That category does not exist.',
  empty_blueprint: 'The blueprint is empty — add something first.',
  missing_session_id: 'The playtest session is gone — start a new one.',
  missing_worldspec_or_id: 'The world or its spec is missing.',
  missing_natural_language: 'Describe the change in words first.',
  min_exceeds_max: 'The minimum is higher than the maximum.',
  invalid_stars: 'Pick a star rating between 1 and 5.',
  cannot_rate_own_game: 'You cannot rate your own game.',
  generated_content_invalid: 'The generated content did not validate — try again.',
  invalid_asset: 'That asset is not valid.',
  asset_not_found: 'That asset could not be found.',
  no_db: 'The foundry store is unavailable — try again shortly.',
  no_actor: 'Sign in first.',
};

export function foundryReasonWords(reason?: string | null, fallback = 'Something went wrong — try again.'): string {
  if (!reason) return fallback;
  if (WORDS[reason]) return WORDS[reason];
  if (reason.endsWith('_failed')) return 'That failed on the server — try again.';
  return reason.replace(/_/g, ' ');
}
