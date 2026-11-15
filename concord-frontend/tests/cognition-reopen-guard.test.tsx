/**
 * FIX-cognition-001 (frontend leg) — Reopen intermittently did
 * nothing, then failed with HTTP 500 under repeat clicks: the
 * handlers set a busy flag, but the Mark answered / Reopen buttons
 * never disabled on it, so clicks raced the endpoint. Both buttons
 * now respect the guard. (The endpoint's 500-after-write is
 * server-side and stays the desk's.)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-cognition-001 — answer-flow double-submit guard', () => {
  const s = read('app/lenses/cognition/page.tsx');

  it('Mark answered disables while busy', () => {
    expect(s).toContain('disabled={busy} onClick={() => { void saveAnswer(trace.id); }}');
  });

  it('Reopen disables while busy', () => {
    expect(s).toContain('disabled={busy} onClick={() => { void clearAnswer(trace.id); }}');
  });
});
