/**
 * FIX-sports-007 — 'Pull feed' ingested DTUs into the user's vault
 * with only "Ingested N new DTUs from <source>" as the outcome; the
 * ticket asks for a clear note that it saves to My Vault (or a
 * preview). The shared LensFeedButton now names the My Vault save
 * before the pull (banner description + compact tooltip) and in the
 * result line on both variants.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-sports-007 — pull feed names the vault save', () => {
  const s = read('components/lens/LensFeedButton.tsx');

  it('the pre-pull descriptions name My Vault', () => {
    expect(s).toContain('Ingests real items from a free public source as DTUs — saved to My Vault.');
    expect(s).toContain('Ingest real items from a free public source as DTUs — saved to My Vault');
  });

  it('both result lines name My Vault', () => {
    const hits = s.match(/— saved to My Vault/g) || [];
    expect(hits.length).toBeGreaterThanOrEqual(4);
    expect(s).toContain('from {result.source} — saved to My Vault');
  });
});
