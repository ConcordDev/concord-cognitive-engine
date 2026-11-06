// Event-Timeline remainder pins (F-C row 18) — source-level contract pins
// for the guards and labels this build adds. Behavioural coverage of the
// server semantics lives in server/tests/event-timeline-build.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');

const manifest = read('lib/lenses/manifest.ts');
const badge = read('hooks/useDepthBadge.ts');
const viewsBar = read('components/event-timeline/SavedViewsBar.tsx');
const trends = read('components/event-timeline/ChannelTrends.tsx');
const panel = read('components/event-timeline/FirehosePanel.tsx');
const otd = read('components/event-timeline/OnThisDay.tsx');
const page = read('app/lenses/event-timeline/page.tsx');

describe('event-timeline remainder', () => {
  it('S1: the manifest declares REAL_LIVE at the event-timeline entry', () => {
    const i = manifest.indexOf("domain: 'event-timeline'");
    assert.ok(i >= 0);
    assert.match(manifest.slice(i, i + 200), /dataTier: 'REAL_LIVE'/);
  });

  it('S1: the badge override gives the own-substrate caption', () => {
    const i = badge.indexOf("'event-timeline':");
    assert.ok(i >= 0);
    const seg = badge.slice(i, i + 700);
    assert.match(seg, /label: 'Live'/);
    assert.match(seg, /own substrate event log/);
  });

  it('S2: the save flow consents to an overwrite before calling saveView', () => {
    const i = viewsBar.indexOf('const save = async');
    const seg = viewsBar.slice(i, i + 1600);
    assert.match(seg, /views\.some\(\(v\) => v\.name === trimmed\)/);
    assert.match(seg, /setConfirmOverwrite\(true\)/);
    assert.match(seg, /Saved over/);
    assert.match(seg, /Saved view/);
  });

  it('S2: delete is two-step and receipts name the outcome', () => {
    assert.match(viewsBar, /confirmDeleteId !== v\.id/);
    assert.match(viewsBar, /Delete\?/);
    assert.match(viewsBar, /Deleted view/);
  });

  it('S3: the chips carry their window; the stats strip label stands', () => {
    assert.match(panel, /Channels · counts, last 7 days:/);
    assert.match(panel, /Last 24h:/);
  });

  it('S3: trends send the selected channels and state their scope', () => {
    assert.match(trends, /channels: selectedChannels\.length \? selectedChannels : null/);
    assert.match(trends, /do not narrow these trends/);
  });

  it('S5: the OTD save shows its DTU ID in the panel', () => {
    assert.match(otd, /onSaved=\{setSavedDtuId\}/);
    assert.match(otd, /Saved as DTU \{savedDtuId\}/);
  });

  it('F8: the OTD heading and count follow the category; labels are sections', () => {
    assert.match(otd, /\{ id: 'selected', label: 'Selected' \}/);
    assert.match(otd, /On this day — \{categoryLabel\}/);
  });

  it('F8: panels stay mounted across view switches', () => {
    assert.match(page, /hidden=\{active !== id\}/);
    assert.doesNotMatch(page, /AnimatePresence/);
  });
});
