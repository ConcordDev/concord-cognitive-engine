// Codex build — source pins for S-CDX-2 (label integrity) and S-CDX-3
// (tier declaration). Behavioural where the sandbox allows: the pillar
// selection is a pure id lookup, exercised here against the panel's
// own constant shape via the spine fixture form.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('the Pillars view selects the three pillars by id — no six-slice', () => {
  const src = read('components/codex/SpinePanel.tsx');
  assert.match(src, /PILLAR_IDS = \['lore_first_thought', 'lore_first_breath', 'lore_first_refusal'\]/);
  assert.doesNotMatch(src, /slice\(0, 6\)/);
  // the reduction is stated, not silent
  assert.match(src, /Search, filters, permalinks, and bookmarks live in Browse canon/);
});

test('the floating action names the search it performs', () => {
  const src = read('app/lenses/codex/page.tsx');
  assert.match(src, /Search the canon/);
  assert.doesNotMatch(src, /Open a page/);
  // Browse stays mounted across view switches (expansion persists)
  assert.match(src, /active === 'browse' \? undefined : 'hidden'/);
});

test('the tier declaration stands at both of the lens\u2019s own sites', () => {
  const manifest = read('lib/lenses/manifest.ts');
  const codexLine = manifest.split('\n').find(l => l.includes("domain: 'codex'")) || '';
  assert.match(codexLine, /dataTier: 'REAL_FREE'/);
  const badge = read('hooks/useDepthBadge.ts');
  assert.match(badge, /codex: \{\s*\n\s*label: 'Real',\s*\n\s*caption: 'The authored Concordia canon/);
});

test('fragment entries are badged and honestly described in Browse', () => {
  const src = read('components/codex/BrowsePanel.tsx');
  assert.match(src, /e\.type === 'fragment'/);
  assert.match(src, />Fragment</);
  assert.match(src, /A fragment — this entry is a title recorded before its account was written/);
  // the metadata line no longer dangles a bare separator
  assert.match(src, /\[e\.type, e\.era\]\.filter\(Boolean\)\.join\(' · '\)/);
});
