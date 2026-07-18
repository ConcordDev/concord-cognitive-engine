// concord-frontend/lib/conkay/mutating-macros.ts
//
// Unit A2 — the client-side signal for "does calling this macro change state."
// Gates the pre-execution confirm ConKay renders before a CLIENT-INITIATED
// macro call (see ConKayActionConfirm.tsx + ConKayOverlay.tsx#executeMacro).
//
// ── WHY A NAME HEURISTIC, NOT A SERVER FLAG ─────────────────────────────────
// The obvious first place to look was the backend's `publicReadDomains`
// allowlist (server/server.js, ~340 lines starting around line 11394) — but
// reading it in full shows it answers a DIFFERENT question: "can an
// UNAUTHENTICATED caller reach this macro at all", not "is this macro
// read-only." The two diverge in both directions, in the object's own code:
//   - `dtu: new Set([...,"create","update","delete","bulkCreate",...])` — real
//     writes, deliberately left public.
//   - `social: new Set([...,"post","react","share","comment","follow",
//     "unfollow"])` — all mutations.
//   - `reels: new Set(["list_for_you","list_by_user","record_view"])` with
//     the object's OWN comment: "record_view is a write but tolerated as
//     anonymous."
//   - `governance: new Set([...,"cast_vote","open_proposal",...])` — votes
//     and proposals, both writes.
// Treating "present in publicReadDomains" as "safe, skip the confirm" would
// silently wave through real state-mutating calls — exactly the fake-gate
// failure mode this unit exists to prevent. It is also not usable as an
// inverse signal ("NOT listed => mutating"): most genuine per-user reads
// (e.g. an authenticated GET of your own wallet) are intentionally absent
// from this allowlist because they require auth anyway, not because they
// write.
//
// Also checked and ruled out:
//   - `server/lib/agent-action-log.js` — records what an agent DID for
//     recall/memory; carries no forward-looking read/write classification.
//   - `server/lib/confined-ctx.js` — a capability *manifest* (which domains a
//     sandboxed program may reach at all), not a read/write distinction
//     within an allowed domain.
//   - The macro registry itself: `register(domain, name, fn, spec = {})` in
//     server.js takes a free-form `spec` object with no `readOnly`/
//     `mutating`/`destructiveHint` field anywhere in the codebase (verified
//     by reading the full `register()` body and grepping for
//     destructiveHint/readOnlyHint/idempotentHint/isMutating/isWrite across
//     server/ — zero hits outside node_modules).
//   - None of the above is serialized to the client anyway — `/api/lens/run`
//     and `/api/lens-actions/:domain` never return a write/read flag, so
//     there is nothing for the frontend to fetch even if the shape existed.
//
// So the only real, checkable-from-the-client signal is the macro's OWN
// NAME — the exact pattern this codebase already trusts elsewhere:
//   - `components/lens/ManifestActionBar.tsx`'s `ACTION_ICONS` table picks an
//     icon from a verb prefix (create/delete/export/edit/...).
//   - The server's own `GET /api/lens-actions/:domain` handler (server.js)
//     computes `isGenerative`/`isAnalysis`/`isLive`/`isCompute` from regexes
//     over the macro name — the SAME kind of heuristic, done server-side.
// This file follows that established precedent instead of inventing a new
// mechanism.
//
// ── CLASSIFICATION STRATEGY ──────────────────────────────────────────────
// The macro name is split into lowercase word tokens (snake_case, kebab-case,
// dot-namespaced, and camelCase boundaries all count) and checked in order:
//   1. A `live_*` prefix (this codebase's own "read-only external fetch"
//      naming convention — see below) => read.
//   2. A WRITE_VERBS token ANYWHERE in the name wins outright => mutating.
//      This catches compound names like a hypothetical `get_or_create_profile`
//      (contains "create") the same way it catches a name that plainly starts
//      with a write verb.
//   3. A WRITE_VERBS_FIRST_TOKEN_ONLY match on JUST the first token =>
//      mutating. Reserved for verbs that double as common trailing nouns
//      ("mount" the animal vs. "mount" the action) — checking these only as
//      a prefix avoids misreading `get_active_mount` as a mutation because
//      it contains the noun "mount".
//   4. A READ_VERBS token ANYWHERE in the name (only reached if nothing
//      above matched) => read.
//   5. Otherwise => mutating (the safe default).
//
// SAFE DEFAULT: a macro whose tokens match nothing above — or an empty/
// malformed name — is treated as MUTATING (confirm-gated). A false positive
// here costs the user one extra click; a false negative would silently run
// something real. This mirrors the contract's own instruction: "when unsure,
// treat as mutating — the safe default."
//
// KNOWN RESIDUAL IMPRECISION (documented, not hidden): a heuristic on names
// can't be perfect. E.g. `land_claims.claim_at` is actually a pure point-in-
// circle lookup (per its own doc comment) but tokenizes to ["claim","at"],
// and "claim" is a write token — so it gets an unnecessary confirm. Same for
// `creatures.for_world` (tokenizes to ["for","world"], neither a recognized
// verb) — it defaults to a confirm even though it's a pure read. Both are the
// accepted cost of the safe-default direction above, not bugs to chase.

/** Tokens that, ANYWHERE in a macro name, indicate a state-changing call.
 *  Reserved for verbs that are unambiguous even as a trailing token (i.e.
 *  they're never plausibly a trailing NOUN in a read-shaped name — contrast
 *  with WRITE_VERBS_FIRST_TOKEN_ONLY below, for verbs that also double as
 *  common nouns). */
const WRITE_VERBS = new Set([
  'create', 'update', 'delete', 'remove', 'add', 'save', 'write',
  'send', 'spawn', 'buy', 'purchase', 'sell', 'transfer', 'withdraw',
  'deposit', 'mint', 'invite', 'join', 'leave', 'equip', 'unequip', 'craft',
  'attack', 'dodge', 'parry', 'grapple', 'grab',
  'claim', 'donate', 'tip', 'vote', 'post', 'comment', 'follow', 'unfollow',
  'react', 'revoke', 'cancel', 'approve', 'reject', 'assign',
  'schedule', 'checkout', 'pay', 'advance', 'complete', 'resolve', 'realise',
  'realize', 'coerce', 'attempt', 'pickup', 'publish', 'register',
  'submit', 'apply', 'grant', 'award', 'consume', 'activate',
  'deactivate', 'toggle', 'reset', 'clear', 'merge', 'fork', 'import',
  'upload', 'promote', 'demote', 'archive',
  'restore', 'revert', 'install', 'uninstall', 'subscribe', 'unsubscribe',
  'bid', 'accept', 'decline', 'ban', 'mute',
  'seed', 'plant', 'harvest', 'gather', 'brew', 'forge', 'tame', 'groom',
  'gainxp', 'gain', 'topup',
]);

/** Tokens that indicate a write ONLY when they are the FIRST token — words
 *  that are unambiguous as an imperative macro name ("mount", "open") but
 *  are also common trailing NOUNS in a read-shaped name ("get_active_mount",
 *  "list_open_cases"). Checking these as a prefix (not "anywhere") avoids
 *  misreading the noun usage as the verb. */
const WRITE_VERBS_FIRST_TOKEN_ONLY = new Set([
  'mount', 'dismount', 'feed', 'rest', 'move', 'place', 'drop', 'order',
  'book', 'share', 'block', 'cast', 'use', 'mine', 'open', 'close', 'start',
  'stop', 'record', 'report', 'offer', 'tag', 'label', 'mark', 'kick', 'set',
]);

/** Tokens that indicate a pure read anywhere they appear in the name
 *  (checked only when no WRITE token matched — see isMutatingMacro). Verbs
 *  AND read-shaped bare nouns both belong here: this codebase names a lot of
 *  pure-read macros as nouns with no verb at all (e.g. `reasoning.traces`,
 *  `refusal.strength`, `billing.balance` — see server/server.js
 *  publicReadDomains for the live examples each of these is grounded in). */
const READ_VERBS = new Set([
  'get', 'list', 'search', 'find', 'browse', 'view', 'read', 'status',
  'stats', 'count', 'preview', 'explain', 'compare', 'export', 'query',
  'check', 'show', 'inspect', 'describe', 'summary', 'history', 'recent',
  'trending', 'facets', 'fetch', 'watch', 'analyze', 'analyse', 'estimate',
  'calc', 'calculate', 'is', 'has', 'can',
  // Read-shaped bare nouns (no verb needed — the macro IS the noun it GETs).
  'taxonomy', 'species', 'evidence', 'usage', 'balance', 'traces', 'trace',
  'chains', 'steps', 'strength', 'composition', 'metrics', 'health', 'info',
  'thumbnail', 'peers', 'topology', 'channels', 'patterns', 'predictions',
  'strategies', 'profile', 'network', 'census', 'registry', 'catalog',
  'schema', 'definitions', 'constants', 'models', 'gaps', 'dashboard',
  'entities', 'simulations', 'revisions', 'comments', 'workspace',
  'bindings', 'exhibition', 'masterworks', 'domains', 'expertise', 'values',
  'traditions', 'stories', 'rights', 'wealth', 'findings', 'baseline',
  'diff', 'overrides', 'rankings', 'matrix', 'spectrum', 'grid',
]);

/** Split a macro name into lowercase word tokens across snake_case,
 *  kebab-case, dot-namespaced, and camelCase boundaries. */
function tokenize(name: string): string[] {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Is calling `domain.macro` on the CLIENT-INITIATED path expected to change
 * state? `domain` is accepted for future domain-specific overrides but is
 * currently unused — the classification is purely name-based (see file
 * header for why). Never throws; a garbage input classifies as mutating.
 */
export function isMutatingMacro(_domain: string, macro: string): boolean {
  const raw = String(macro || '');
  const toks = tokenize(raw);
  if (!toks.length) return true; // unnamed/garbage macro — safe default
  // The `live_*` naming convention (dozens of real macros: live_apod,
  // live_arxiv, live_wiki_search, ...) is this codebase's OWN established
  // signal for "read-only external API fetch" — the server's own
  // GET /api/lens-actions/:domain handler computes an `isLive: /^live_/`
  // flag from the exact same prefix. Trusting it here follows precedent
  // rather than inventing a new one.
  if (/^live_/i.test(raw)) return false;
  if (toks.some((t) => WRITE_VERBS.has(t))) return true;
  if (WRITE_VERBS_FIRST_TOKEN_ONLY.has(toks[0])) return true;
  if (toks.some((t) => READ_VERBS.has(t))) return false;
  return true; // unrecognized shape — safe default
}
