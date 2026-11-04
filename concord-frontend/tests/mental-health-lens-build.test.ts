/**
 * /lenses/mental-health — build pins for the full-lens build
 * (S-MH-1 store connection, S-MH-2 breathing player, S-MH-3 trend
 * label, F5 Companion crisis pointer, S-MH-4 declaration).
 *
 * Source pins: each assertion names the exact behaviour the Product
 * first pass (R3, 2026-11-01) found missing, so a regression that
 * re-severs a connection fails here even without a live backend.
 * Behavioural proof for the server half lives in
 * server/tests/mental-health-lens-build.test.js.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

const page = read('app/lenses/mental-health/page.tsx');
const actionPanel = read('components/mental-health/MentalHealthActionPanel.tsx');
const practice = read('components/mental-health/MhPracticePanel.tsx');
const mood = read('components/mental-health/MhMoodPanel.tsx');
const companion = read('components/mental-health/MhCompanionPanel.tsx');
const manifest = read('lib/lenses/manifest.ts');

describe('mental-health build — S-MH-1 Analysis reads the tracked store', () => {
  it('page fetches wellness-score-tracked for the headline score', () => {
    expect(page).toContain("'wellness-score-tracked'");
    expect(page).toContain('Your score, from your own tracked check-ins, sleep and practice');
  });

  it('the manual calculator stays, labelled manual, factory boxes no longer the headline', () => {
    expect(page).toContain('Manual calculator');
    expect(page).toContain("'wellnessScore'"); // manual path preserved
  });

  it('no tracked data renders the server message instead of a score', () => {
    expect(page).toContain('wellnessScore == null');
    expect(page).toContain('trackedResult.message');
  });
});

describe('mental-health build — S-MH-1 Toolkit tiles read the member\u2019s data', () => {
  it('Mood tile loads mood-insights and never hard-refuses without a CSV', () => {
    expect(actionPanel).toContain("'mood-insights'");
    expect(actionPanel).not.toContain('Mood csv required.');
    expect(actionPanel).toContain('your tracked check-ins');
  });

  it('Journal tile surfaces the member\u2019s recent entries from gratitude-list', () => {
    expect(actionPanel).toContain("'gratitude-list'");
    expect(actionPanel).toContain('Your recent journal entries');
  });
});

describe('mental-health build — S-MH-2 breathing exercises run, not just log', () => {
  it('Practice panel has a phase player that logs completed rounds', () => {
    expect(practice).toContain('startBreathing');
    expect(practice).toContain('finishBreathing');
    expect(practice).toContain("'breathing-log', { patternId: p.id, rounds }");
    expect(practice).toContain('Round {player.round} of {BREATHE_ROUNDS}');
  });

  it('the old instant-log click handler is gone', () => {
    expect(practice).not.toContain("await lensRun('mental-health', 'breathing-log', { patternId, rounds: 6 })");
  });
});

describe('mental-health build — S-MH-3 + F5 labels', () => {
  it('Mood panel renders not-enough-data as "Not enough data yet", never "Stable" by default', () => {
    expect(mood).toContain("'not-enough-data': 'Not enough data yet'");
  });

  it('Companion tab carries its own always-visible 988 pointer', () => {
    expect(companion).toContain('In crisis? Call or text');
    expect(companion).toContain('988');
  });
});

describe('mental-health build — S-MH-4 declaration', () => {
  it('manifest declares mental-health REAL_LIVE', () => {
    const i = manifest.indexOf("domain: 'mental-health'");
    expect(i).toBeGreaterThanOrEqual(0);
    const block = manifest.slice(i, i + 1400);
    expect(block).toContain("dataTier: 'REAL_LIVE'");
  });
});
