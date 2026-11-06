// Badge Settlement pins (register A2, lens-wiring PR) — Commonsense
// F8's selection persistence + Nonprofit's per-view pill removal.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');

const commonsense = read('app/lenses/commonsense/page.tsx');
const nonprofit = read('app/lenses/nonprofit/page.tsx');

describe('badge settlement (lens wiring)', () => {
  it('F8: the selection persists under a named key and restores on load', () => {
    assert.match(commonsense, /SELECTION_KEY = 'concord:commonsense:selected'/);
    assert.match(commonsense, /applyThread\(rows, storedSelection\(\)\)/);
    assert.match(commonsense, /localStorage\.setItem\(SELECTION_KEY, selectedId\)/);
  });

  it('the pill family: Nonprofit carries no per-view LiveIndicator mount', () => {
    assert.doesNotMatch(nonprofit, /<LiveIndicator/);
    assert.doesNotMatch(nonprofit, /from '@\/components\/lens\/LiveIndicator'/);
    // The page's one tier statement stands.
    assert.match(nonprofit, /<DepthBadge lensId="nonprofit"/);
    // The data panel keeps its feed (a panel, not a badge).
    assert.match(nonprofit, /<RealtimeDataPanel domain="nonprofit"/);
  });
});
