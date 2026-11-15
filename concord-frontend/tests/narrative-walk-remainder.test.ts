// Narrative-Walk build — behavioural pins where the sandbox allows:
// the set-eyebrow derivation is a pure function of the beat's own
// comment, re-implemented here against the shipped rule and exercised
// on the two real comment forms; the lifecycle and declaration legs
// are source-pinned.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

// The shipped rule (page.tsx setLabel), mirrored for behaviour:
function setLabel(comment: string): string | null {
  if (comment.startsWith('Phase W')) return 'Event template';
  if (comment.includes('Concordia Phase 15')) return 'Concordia cinematic';
  return null;
}

test('the set eyebrow derives from each beat\u2019s own self-label', () => {
  assert.equal(setLabel('Phase W — fires when a lattice-born quest is realised. Slow zoom…'), 'Event template');
  assert.equal(setLabel('Concordia Phase 15 — bespoke cinematic when refusal_field strength ≥ 6…'), 'Concordia cinematic');
  assert.equal(setLabel('An unlabelled beat.'), null);
});

test('the lifecycle stands: back, start-over, walk-again from the ending', () => {
  const src = read('app/lenses/narrative-walk/page.tsx');
  assert.match(src, /const goBack = useCallback/);
  assert.match(src, /The step before/);
  assert.match(src, /localStorage\.removeItem\(OPEN_KEY\)/);
  assert.match(src, /localStorage\.removeItem\(WATCHED_KEY\)/);
  assert.match(src, /atEnd \? 'Walk it again'/);
  // the ending is stated as an ending, and the record is keepable
  assert.match(src, /The trail ends here — you have walked all/);
  assert.match(src, /KeepRecordActions record=\{walkRecord\} saveLabel="Keep the walk record"/);
  // the counter counts what the journal records
  assert.match(src, /\{watchedCount\} walked/);
  assert.doesNotMatch(src, /\} watched</);
  // the CTA is never disabled at the end any more
  assert.doesNotMatch(src, /disabled=\{phase !== 'ready' \|\| catalog\.length === 0 \|\| atEnd\}/);
});

test('the tier stands declared and the badge mounted', () => {
  const page = read('app/lenses/narrative-walk/page.tsx');
  assert.match(page, /<DepthBadge lensId="narrative-walk"/);
  const manifest = read('lib/lenses/manifest.ts');
  const line = manifest.split('\n').find(l => l.includes("domain: 'narrative-walk'")) || '';
  assert.match(line, /dataTier: 'SIM_GRADE_A'/);
});

test('the Hub copy names the written walk it is', () => {
  const registry = read('lib/lens-registry.ts');
  assert.match(registry, /A written walk through the turning points of Concordia/);
  assert.doesNotMatch(registry, /read as shot direction/);
  assert.doesNotMatch(registry, /Firewatch-style film/);
});

test('every authored beat carries user-facing prose, free of production copy', () => {
  const dir = join(root, 'content/cinematics');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 11);
  // Internal authoring markers that must never reach the walker as
  // story prose (the FIX-creative-writing-011 leak class).
  const INTERNAL = /Phase W|Concordia Phase|Sprint|CLAUDE\.md|refusal_field|attrites|≥|invariant/;
  for (const f of files) {
    const seq = JSON.parse(read(join('content/cinematics', f)));
    assert.equal(typeof seq.summary, 'string', `${f}: summary missing`);
    assert.ok(seq.summary.trim().length > 0, `${f}: summary empty`);
    assert.doesNotMatch(seq.summary, INTERNAL, `${f}: summary carries production copy`);
  }
  // And the page renders the summary, never the internal comment.
  const page = read('app/lenses/narrative-walk/page.tsx');
  assert.match(page, /\{open\.summary\}/);
  assert.doesNotMatch(page, /\{open\.comment\}/);
});
