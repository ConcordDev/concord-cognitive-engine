// Badge Settlement pins (register A2, shared PR) — the LiveIndicator
// settle discipline exercised behaviourally through badgeClaim (the
// component's pure decision helper, extracted verbatim), plus the
// LensToolbar named-count pin.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');

const indicator = read('components/lens/LiveIndicator.tsx');
const toolbar = read('components/lens/LensToolbar.tsx');

function extractBadgeClaim(rawSrc: string): (a: { isLive: boolean; hasBeenLive: boolean; mountedForMs: number }) => string {
  // Strip the TS annotations first so the brace scan sees the function
  // body, not the signature's object type.
  const src = rawSrc
    .replace(/args: \{\s*isLive: boolean;\s*hasBeenLive: boolean;\s*mountedForMs: number;\s*\}/, 'args')
    .replace(/\): BadgeClaim \{/, ') {');
  const start = src.indexOf('export function badgeClaim');
  assert.ok(start >= 0, 'badgeClaim present');
  let depth = 0;
  let end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > start);
  const fnText = src.slice(start, end).replace('export function badgeClaim', 'function badgeClaim');
  const constLine = rawSrc.match(/export const BADGE_SETTLE_MS = \d+;/)?.[0].replace('export ', '') || '';
  assert.ok(constLine, 'BADGE_SETTLE_MS const present');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${constLine}\n${fnText}; return badgeClaim;`)() as never;
}

describe('badge settlement (shared)', () => {
  const claim = extractBadgeClaim(indicator);

  it('an unsettled badge at mount is PENDING, never a false OFF', () => {
    assert.equal(claim({ isLive: false, hasBeenLive: false, mountedForMs: 0 }), 'pending');
    assert.equal(claim({ isLive: false, hasBeenLive: false, mountedForMs: 2999 }), 'pending');
  });

  it('live settles LIVE at once, at any age', () => {
    assert.equal(claim({ isLive: true, hasBeenLive: false, mountedForMs: 0 }), 'live');
  });

  it('a badge that has been live renders a later false as OFF immediately', () => {
    assert.equal(claim({ isLive: false, hasBeenLive: true, mountedForMs: 10 }), 'off');
  });

  it('still false after the settle window, OFF is a settled truth', () => {
    assert.equal(claim({ isLive: false, hasBeenLive: false, mountedForMs: 3000 }), 'off');
    assert.match(indicator, /BADGE_SETTLE_MS = 3000/);
  });

  it('the pending render carries no OFF word', () => {
    assert.match(indicator, /claim === 'pending' \? 'Connecting'/);
    assert.match(indicator, /'CONNECTING'/);
  });

  it('F9: the toolbar count names what it counts', () => {
    assert.match(toolbar, /\{dtuCount\.toLocaleString\(\)\} DTUs/);
  });
});
