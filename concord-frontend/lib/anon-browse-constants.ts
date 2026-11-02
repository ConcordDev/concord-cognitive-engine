/**
 * Server-safe constants for signed-out Music/Market browse (GB-0664).
 *
 * Deliberately NOT a 'use client' module: the root layout (a server component) reads
 * ANON_BROWSE_HEADER from the request headers. Importing a plain value from a 'use client'
 * module into a server component yields a client reference (a function), not the string,
 * so headers().get(<reference>) threw "e.toLowerCase is not a function" and every page 500'd.
 */
export const ANON_BROWSE_HEADER = 'x-concord-anon-browse';

/** Lenses open to signed-out visitors (browse-only, public items, 30 s previews). Exact paths. */
export const PUBLIC_BROWSE_LENSES: ReadonlySet<string> = new Set(['/lenses/music', '/lenses/market']);
