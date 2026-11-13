/**
 * FIX-offline-007 — on the dark theme the offline lens's labels sat
 * at zinc-500 and its disabled buttons (Wipe local named in the
 * ticket) rendered at 50% opacity — red-300 at half strength is
 * effectively unreadable. Labels are raised to zinc-400 and the
 * ReplicationPanel's disabled buttons keep 75% opacity so a
 * disabled control still reads as text. Placeholders were already
 * zinc-400 and stay untouched.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-offline-007 — offline dark-theme legibility', () => {
  it('no zinc-500 labels remain in the offline panels', () => {
    expect(read('components/offline/ConflictMergePanel.tsx').includes('text-zinc-500')).toBe(false);
    expect(read('components/offline/ReplicationPanel.tsx').includes('text-zinc-500')).toBe(false);
  });

  it('disabled buttons render at 75% opacity, Wipe local included', () => {
    const rp = read('components/offline/ReplicationPanel.tsx');
    expect(rp.includes('disabled:opacity-50')).toBe(false);
    expect(rp).toContain('Wipe local');
    expect(rp.includes('disabled:opacity-75')).toBe(true);
  });
});
