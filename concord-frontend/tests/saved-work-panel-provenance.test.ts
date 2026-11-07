// A4 (saved-work-as-DTU) PR 3 — LensContextPanel provenance:
// dtuProvenance exercised behaviourally (verbatim extraction), plus
// the publish-gating pins.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(here, '..', 'components/lens/LensContextPanel.tsx'), 'utf8');

function extractProvenance(src: string): (dtu: { ownerId?: string }, viewerId?: string | null) => string {
  const clean = src
    .replace(/dtu: \{ ownerId\?: string \},\s*viewerId\?: string \| null,\s*\): DtuProvenance/, 'dtu, viewerId)');
  const start = clean.indexOf('export function dtuProvenance');
  assert.ok(start >= 0, 'dtuProvenance present');
  let depth = 0;
  let end = -1;
  for (let i = clean.indexOf('{', start); i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    if (clean[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > start);
  const fnText = clean.slice(start, end).replace('export function dtuProvenance', 'function dtuProvenance');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`${fnText}; return dtuProvenance;`)() as never;
}

describe('panel provenance', () => {
  const prov = extractProvenance(panel);

  it('owner match reads Yours; another owner reads Published', () => {
    assert.equal(prov({ ownerId: 'u1' }, 'u1'), 'yours');
    assert.equal(prov({ ownerId: 'u2' }, 'u1'), 'published');
  });

  it('no owner recorded reads Corpus (the safe direction)', () => {
    assert.equal(prov({}, 'u1'), 'corpus');
    assert.equal(prov({ ownerId: 'u2' }, null), 'published');
    assert.equal(prov({}, null), 'corpus');
  });

  it('Publish renders only on the viewer’s own rows', () => {
    assert.match(panel, /onPublish && provenance === 'yours' &&/);
    assert.match(panel, /provenance === 'yours' \? 'Yours'/);
  });

  it('the panel derives the viewer from the session, not a prop', () => {
    assert.match(panel, /const \{ user \} = useAuth\(\);/);
  });
});
