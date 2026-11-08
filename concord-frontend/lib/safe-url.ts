/**
 * safeLinkUrl — the allowlist for user-entered URLs that reach an href / src.
 *
 * React 19 only rewrites `javascript:` hrefs; it passes `data:`, `vbscript:`
 * and every other scheme straight through to the DOM (measured, not assumed:
 * tests/safe-url.test.tsx). So user-controlled URLs are filtered here to
 * http(s) and relative references; anything else returns null and the caller
 * renders nothing (or a notice) instead of the link.
 */

// Browsers drop ASCII tab / newline / carriage return anywhere in a URL and
// ignore leading C0 controls and spaces, so "java\nscript:" is still
// `javascript:`. Strip them before looking at the scheme.
// eslint-disable-next-line no-control-regex
const STRIP = /[\u0000- \u007f]/g;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

export function safeLinkUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const probe = trimmed.replace(STRIP, '');
  const scheme = SCHEME.exec(probe);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    return s === 'http' || s === 'https' ? trimmed : null;
  }
  // No scheme: a relative reference (/path, ./x, ../x, #frag, ?q, or a bare
  // path). A colon before the first "/", "?" or "#" would have matched
  // SCHEME above, so this branch cannot smuggle a scheme.
  return trimmed;
}
