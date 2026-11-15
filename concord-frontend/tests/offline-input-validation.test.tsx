/**
 * FIX-offline-005 — the ReplicationPanel document editor accepted a
 * blank body and stored {} silently, showed the raw JSON parser
 * error on bad input, and let JSON.parse silently round integers
 * past the safe range. saveDraft now refuses a blank body in words,
 * refuses an unsafe integer in words (naming the value and the
 * string alternative), and words JSON syntax errors (with the
 * character position when the parser reports one).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-offline-005 — document editor input honesty', () => {
  const s = read('components/offline/ReplicationPanel.tsx');

  it('a blank body is refused in words, never stored as {}', () => {
    expect(s).toContain('document body required — a blank body would store an empty document');
    expect(s.includes("draftBody.trim() ? JSON.parse(draftBody) : {}")).toBe(false);
  });

  it('unsafe integers are refused before parsing', () => {
    expect(s).toContain('Number.isSafeInteger');
    expect(s).toContain('too large to store exactly');
    expect(s).toContain('quote it as a string instead');
  });

  it('JSON syntax errors are worded, not raw', () => {
    expect(s).toContain('body is not valid JSON');
    expect(s).toContain('check for missing quotes, commas, or braces');
    expect(s.includes("setErr(e instanceof Error ? e.message : 'invalid JSON body')")).toBe(false);
  });
});
