// FIX-byo-keys-008: the health panel rendered a provider's raw error
// verbatim — including raw JSON blobs. Source-pin: the panel shapes the
// error through humanError before rendering.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'KeyHealthPanel.tsx'), 'utf8');

describe('Key health error shaping (FIX-byo-keys-008)', () => {
  it('the rendered last error goes through humanError', () => {
    expect(SRC).toContain('function humanError(raw: string): string');
    expect(SRC).toContain('last error: {humanError(r.lastError)}');
  });
});
