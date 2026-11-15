// FIX-dx-platform-016: the dx domain answers failures as machine tokens
// ('team_not_found', 'invalid_regex'). Every error funnel in the DX
// workbench rendered the token verbatim. This translator holds the
// domain's vocabulary — read from the error strings server/domains/
// dx-platform.js and server/domains/dx.js actually return — and turns
// each token into the sentence it stands for. Text that is already a
// sentence passes through; an unseen snake_case token is humanized
// rather than shown raw.

const WORDS: Record<string, string> = {
  already_a_member: 'That user is already a member of this team.',
  auth_required: 'Sign in to do that.',
  codebase_not_found: 'That codebase could not be found.',
  db_unavailable: 'The database is unavailable right now — try again in a moment.',
  handler_error: 'That failed on the server — try again.',
  invalid_decision: 'That decision is not valid.',
  invalid_input: 'Some of those details could not be used — check them and try again.',
  invalid_regex: 'That search pattern is not a valid regular expression.',
  invitee_not_found: 'No user matches that invite — check the name and try again.',
  no_codebase_id: 'Choose a codebase first.',
  no_commit_sha: 'No commit was selected.',
  no_diff: 'There is no diff to review yet.',
  no_enabled_ids: 'Enable at least one item first.',
  no_files: 'There are no files to work with yet.',
  no_name: 'Give it a name first.',
  no_query: 'Enter a search query first.',
  no_question: 'Enter a question first.',
  no_repo: 'No repository is connected.',
  no_valid_files: 'None of those files could be used.',
  not_a_member: 'You are not a member of that team.',
  not_invited: 'You have not been invited to that team — ask a member for an invite code.',
  not_owner: 'Only the owner can do that.',
  team_not_found: 'That team could not be found — it may have been removed.',
  unknown_detector: 'That detector is not available.',
  github_unavailable: 'GitHub is unavailable right now — try again in a moment.',
};

export function dxErrorWords(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const known = WORDS[raw];
  if (known) return known;
  if (raw.includes(' ')) return raw;
  if (/^[a-z0-9_]+$/.test(raw)) return 'That failed on the server — try again.';
  return raw;
}
