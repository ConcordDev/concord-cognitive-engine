// A4 (saved-work-as-DTU) PR 2 — CrossDomainConnections merges the
// registered graph nodes (the lens's own saved work) into its items.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cdc = readFileSync(join(here, '..', 'components/common/CrossDomainConnections.tsx'), 'utf8');

describe('saved-work graph merge (panel)', () => {
  it('queries the registered-nodes action for the home domain', () => {
    assert.match(cdc, /'registered-nodes'/);
    assert.match(cdc, /queryKey: \['cross-domain-registered', domain\]/);
  });

  it('merges registered nodes deduped against the DTU sources', () => {
    assert.match(cdc, /const seen = new Set\(base\.map\(\(i\) => i\.id\)\)/);
    assert.match(cdc, /return \[\.\.\.base, \.\.\.registered\];/);
  });

  it('a failing registration leg reads as empty, not an error surface', () => {
    assert.match(cdc, /return \[\];\s*\}/);
  });
});
