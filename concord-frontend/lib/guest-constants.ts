/**
 * Server-safe constants for guest (signed-out) browsing — GB-1536
 * "Enter means Enter".
 *
 * Deliberately NOT a 'use client' module: the root layout (a server
 * component) reads GUEST_HEADER from the request headers, exactly like
 * ANON_BROWSE_HEADER in anon-browse-constants.ts. Middleware keeps its
 * own literal copy (edge runtime); tests pin the copies equal.
 */
export const GUEST_HEADER = 'x-concord-guest';

/**
 * Client-side mirror of the server's guestRead register (the actions an
 * anonymous caller may run — see docs/audits/GUEST_READ_AUDIT.md). The
 * SERVER is the authority (its spec registry decides); this list exists
 * so the client backstop in lib/api/client.ts can let a guestRead
 * /api/lens/run call through to the server's verdict instead of
 * blocking it blind. Keys are `${domain}.${action}`.
 */
export const GUEST_READ_ACTIONS: ReadonlySet<string> = new Set([
  'lens.list',
  'lens.get',
  'code.snippets-list',
  'code.snapshots-list',
]);
