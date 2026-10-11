/** Honest copy for crisis macro refusals. Unknown codes pass through. */
const REFUSAL: Record<string, string> = {
  crisis_not_found: 'That crisis is not on the board.',
  not_authorized: 'You cannot remove this assignment.',
  entry_not_found: 'That roster entry is already gone.',
  no_actor: 'Sign in to change the roster.',
  no_db: 'Crisis records are unavailable.',
  missing_crisis_or_responder: 'Name the responder.',
  missing_crisis_or_note: 'Write a note before logging.',
  missing_crisis_or_entry: 'Pick a roster entry to remove.',
};

export function crisisRefusal(error: string | null | undefined): string | null {
  if (!error) return null;
  return REFUSAL[error] || error;
}
