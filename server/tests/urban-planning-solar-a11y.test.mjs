// FIX-urban-planning-010 + FIX-urban-planning-009 — source pins.
// 010: the Sun/Shadow study shows a local solar-time column derived
// from the site's longitude, UTC kept, honestly labelled (B4 design).
// 009: panel headings normalized to h2; the smallest interactive
// chips/buttons carry a >=24px min-height; the lowest-contrast
// informational small text is bumped a zinc tier (B4 design).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, '..', '..', 'concord-frontend', rel), 'utf8');
const UP = 'components/urban-planning';

test('010: local solar time is derived from longitude and shown beside UTC', () => {
  const src = read(`${UP}/ZoningSiteAnalysis.tsx`);
  assert.match(src, /function localSolarTime\(hourUtc: number, lng: number\)/);
  assert.match(src, /lng \/ 15/);
  assert.match(src, />Local solar</);
  assert.match(src, />UTC hour</);
  assert.match(src, /local solar` : 'n\/a'}/, 'peak-sun summary carries the local solar reading');
  assert.match(src, /not civil time/, 'the solar-time basis is labelled honestly');
});

test('009: panel titles are h2, not h3, across the lens panels', () => {
  const titled = ['app/lenses/urban-planning/page.tsx', `${UP}/ParcelManager.tsx`, `${UP}/ProjectTracker.tsx`, `${UP}/PublicCommentPanel.tsx`, `${UP}/ScenarioStudio.tsx`, `${UP}/TransitCoveragePanel.tsx`, `${UP}/PlanExportPanel.tsx`];
  for (const rel of titled) {
    const src = read(rel);
    assert.ok(!src.includes('<h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"'), `${rel}: panel-title h3 remains`);
    assert.ok(!src.includes('<h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"'), `${rel}: panel-title h3 remains (page variant)`);
    assert.match(src, /<h2 className="[^"]*text-sm font-semibold text-white/, `${rel}: panel title is an h2`);
  }
});

test('009: the smallest interactive controls carry a 24px min-height', () => {
  for (const rel of [`${UP}/ProjectTracker.tsx`, `${UP}/PublicCommentPanel.tsx`, `${UP}/ParcelManager.tsx`, `${UP}/ScenarioStudio.tsx`, `${UP}/ZoningSiteAnalysis.tsx`]) {
    assert.match(read(rel), /min-h-\[24px\]/, `${rel}: no min-h-[24px] control`);
  }
});

test('009: no small informational text still sits at zinc-400/500', () => {
  const files = ['app/lenses/urban-planning/page.tsx', ...['ParcelManager', 'ProjectTracker', 'PublicCommentPanel', 'ScenarioStudio', 'TransitCoveragePanel', 'PlanExportPanel', 'CountyDataPanel', 'ZoningSiteAnalysis', 'CityMap'].map((n) => `${UP}/${n}.tsx`)];
  for (const rel of files) {
    const src = read(rel);
    for (const m of src.matchAll(/"[^"\n]*"|`[^`\n]*`| '[^'\n]*'/g)) {
      const s = m[0];
      if ((s.includes('text-[9px]') || s.includes('text-[10px]')) && /(?<![\w-])text-zinc-[45]00/.test(s)) {
        assert.fail(`${rel}: low-contrast small text remains: ${s.slice(0, 90)}`);
      }
    }
  }
});
