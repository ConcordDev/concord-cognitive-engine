/**
 * Regression test: every socket.io client must connect to the RESOLVED
 * SOCKET_URL, never same-origin.
 *
 * `lib/realtime/socket.ts` now resolves SOCKET_URL to the page origin in the
 * browser (same-origin /socket.io via Next HTTP rewrite + polling-first).
 * Direct `io({ path })` without that shared URL is still forbidden. SOCKET_URL was module-
 * private, so `lib/hooks/useYjsDoc.ts` had independently written
 * `io({ path: '/socket.io' })` — no URL — and reintroduced exactly that bug.
 *
 * Measured live on /lenses/world (2026-07-25), via Playwright websocket
 * instrumentation against a real dev stack:
 *
 *   ws://localhost:5050/socket.io/  -> open,   79 frames   (SOCKET_URL: fine)
 *   ws://localhost:3000/socket.io/  -> closed,  0 frames   x6
 *       "WebSocket is closed before the connection is established."
 *
 * Realtime was genuinely working; the "Disconnected" badge was lit by the
 * duplicate same-origin client failing forever beside it.
 *
 * This test is a source-level guard rather than a runtime one on purpose: the
 * failure is invisible at runtime (the app still works, it just looks broken),
 * so the cheap durable check is "does any socket consumer construct io()
 * without a URL".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const SEARCH_DIRS = ['lib', 'hooks', 'components'];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next') continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

describe('socket.io clients resolve one shared URL', () => {
  it('exposes SOCKET_URL so consumers can share the resolution', async () => {
    const mod = await import('@/lib/realtime/socket');
    expect(typeof mod.SOCKET_URL).toBe('string');
  });

  it('no socket consumer constructs a client with an options-object first argument', () => {
    // The same-origin form is `io(` followed directly by an options object.
    // The correct forms pass the URL first.
    //
    // COMMENTS ARE STRIPPED FIRST, and that is load-bearing, not tidiness.
    // The first version of this check scanned raw text and flagged five files
    // it had just FIXED — because the explanatory comments left at each fix
    // site quote the offending call verbatim to say what was wrong. A guard
    // that fires on the prose describing the bug is a false positive that
    // punishes documenting the fix. CLAUDE.md records the same self-inflicted
    // trap in `grade-ux-polish.mjs` (a comment naming a retired component
    // retriggered the flag describing it); the durable fix is to scan code,
    // not commentary, rather than to write vaguer comments.
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    const offenders: string[] = [];
    for (const dir of SEARCH_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const raw = readFileSync(file, 'utf8');
        if (!raw.includes('socket.io-client')) continue;
        if (/[^a-zA-Z0-9_.]io\(\s*\{/.test(stripComments(raw))) {
          offenders.push(file.replace(ROOT + '/', ''));
        }
      }
    }
    expect(offenders, `same-origin construction found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the comment-stripping does not blind the check (bidirectional)', () => {
    // Guards the fix above from over-correcting into uselessness: a real
    // offending call must still be caught when it sits beside a comment that
    // also contains one.
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const RE = /[^a-zA-Z0-9_.]io\(\s*\{/;

    const commentOnly = `// was: socket = io({ path: '/socket.io' })\nconst s = io(SOCKET_URL, { path: '/x' });`;
    const realOffender = `// was: socket = io({ path: '/socket.io' })\nconst s = io({ path: '/x' });`;

    expect(RE.test(stripComments(commentOnly))).toBe(false);  // prose alone: clean
    expect(RE.test(stripComments(realOffender))).toBe(true);  // real call: caught
  });

  it('useYjsDoc specifically connects via the shared SOCKET_URL', () => {
    const src = readFileSync(join(ROOT, 'lib/hooks/useYjsDoc.ts'), 'utf8');
    expect(src).toMatch(/import\s*\{\s*SOCKET_URL\s*\}\s*from\s*'@\/lib\/realtime\/socket'/);
    expect(src).toMatch(/io\(\s*SOCKET_URL\s*,/);
  });
});
