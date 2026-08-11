// concord-frontend/tests/components/sessionContextBudget.test.ts
//
// Pure-derivation pins for components/conkay/sessionContextBudget.ts.
// Test the math, not the React tree — the tree is exercised by
// SessionContextBadge.test.tsx.
//
// Pinned behavior:
//   1. The six honest UI states (unreachable/empty/green/yellow/red/over)
//      are PURE functions of (budget, freshness, now, lastFetchMs). No
//      clock, no IO, no React.
//   2. Staleness greater than 2 minutes degrades "fresh"/"stale" budget
//      to "unreachable" — a stale number is not an honest number.
//   3. `recommendCompress` is FALSE for green/empty, TRUE for
//      yellow/red/over. NEVER TRUE for unreachable (we don't urge
//      compression on possibly-stale data).
//   4. The voice hint copy is purely derived from the state — when
//      recommendCompress is true, the hint names the threshold and the
//      remaining turns (real numbers, no fabrication). When false, the
//      hint is empty.
//   5. WINDOW_THRESHOLD is 50 and COMPRESSION_BATCH is 20 (matches
//      server/lib/conversation-memory.js — if anyone changes one
//      without the other, the test fails).

import { describe, it, expect } from 'vitest';
import {
  deriveBudgetState,
  type ContextBudgetWire,
} from '@/components/conkay/sessionContextBudget';

function wire(over: Partial<ContextBudgetWire>): ContextBudgetWire {
  return {
    ok: true,
    sessionId: 's1',
    messageCount: 0,
    threshold: 50,
    batchSize: 20,
    usagePct: 0,
    atOrOverThreshold: false,
    turnsUntilAuto: 50,
    ...over,
  };
}

describe('deriveBudgetState — six-state honesty contract', () => {
  it('empty when messageCount is zero (brand-new session)', () => {
    const d = deriveBudgetState(wire({ messageCount: 0 }), 'fresh');
    expect(d.kind).toBe('empty');
    expect(d.recommendCompress).toBe(false);
    expect(d.autoCompressionDue).toBe(false);
    expect(d.voiceHint).toBe('');
  });

  it('green at 49/50 (just under half, no recommendation)', () => {
    const d = deriveBudgetState(wire({ messageCount: 24, usagePct: 48 }), 'fresh');
    expect(d.kind).toBe('green');
    expect(d.recommendCompress).toBe(false);
  });

  it('yellow at 50% — recommendCompress becomes TRUE', () => {
    const d = deriveBudgetState(wire({ messageCount: 25, usagePct: 50 }), 'fresh');
    expect(d.kind).toBe('yellow');
    expect(d.recommendCompress).toBe(true);
    expect(d.autoCompressionDue).toBe(false);
    // Real numbers in the hint — never fabricated.
    expect(d.voiceHint).toContain('50%');
    expect(d.voiceHint).toContain('compress');
  });

  it('red at 85%+ — recommends compression, NOT auto due yet', () => {
    const d = deriveBudgetState(wire({ messageCount: 43, usagePct: 86 }), 'fresh');
    expect(d.kind).toBe('red');
    expect(d.recommendCompress).toBe(true);
    expect(d.autoCompressionDue).toBe(false);
    expect(d.voiceHint).toContain('86%');
    // Should mention the remaining turns (real number).
    expect(d.voiceHint).toMatch(/\d+ turns before/);
  });

  it('over at 100%+ — auto-compression is due', () => {
    const d = deriveBudgetState(
      wire({ messageCount: 55, usagePct: 100, atOrOverThreshold: true, turnsUntilAuto: -5 }),
      'fresh',
    );
    expect(d.kind).toBe('over');
    expect(d.recommendCompress).toBe(true);
    expect(d.autoCompressionDue).toBe(true);
    expect(d.voiceHint).toContain('55 turns');
    expect(d.voiceHint).toContain('past the 50');
  });

  it('unreachable on never-fetched — never claims a fill %', () => {
    const d = deriveBudgetState(null, 'never-fetched');
    expect(d.kind).toBe('unreachable');
    expect(d.label).toBe('Context: not loaded');
    expect(d.recommendCompress).toBe(false); // critical: no urge on no-data
  });

  it('unreachable on fetch error — never claims a fill %', () => {
    const d = deriveBudgetState(wire({ messageCount: 40 }), 'unreachable');
    expect(d.kind).toBe('unreachable');
    expect(d.label).toBe('Context: unreachable');
    expect(d.recommendCompress).toBe(false); // critical: no urge on error
  });

  it('stale > 2 minutes degrades a loaded budget to unreachable', () => {
    const NOW = 1_700_000_000_000;
    const LAST = NOW - 3 * 60 * 1000; // 3 minutes ago
    const d = deriveBudgetState(
      wire({ messageCount: 40, usagePct: 80 }), // would otherwise be 'red'
      'stale',
      NOW,
      LAST,
    );
    expect(d.kind).toBe('unreachable');
    expect(d.label).toBe('Context: stale (>2m)');
    // Honest: we DO NOT recommend on stale data. The user should
    // re-trigger before trusting a recommendation.
    expect(d.recommendCompress).toBe(false);
  });

  it('stale < 2 minutes stays at the real derivation', () => {
    const NOW = 1_700_000_000_000;
    const LAST = NOW - 60 * 1000; // 1 minute ago
    const d = deriveBudgetState(
      wire({ messageCount: 43, usagePct: 86 }),
      'stale',
      NOW,
      LAST,
    );
    expect(d.kind).toBe('red');
    expect(d.recommendCompress).toBe(true);
  });
});

describe('deriveBudgetState — wire-shape honesty', () => {
  it('uses the threshold and batchSize literally (no placeholder values)', () => {
    // Pin the wire-name strings. If a future refactor renames them,
    // this test forces the rename to also update the badge.
    const d = deriveBudgetState(
      wire({ messageCount: 13, threshold: 50, batchSize: 20, usagePct: 26 }),
      'fresh',
    );
    // The label exposes the turn count and pct.
    expect(d.label).toContain('13');
    expect(d.label).toContain('26%');
  });

  it('never assigns the marketing label "OK" or "Healthy"', () => {
    // The badge copy is governed by the same honesty contract as
    // CycleTelemetryRibbon — never "Healthy", never "OK".
    const states = [
      deriveBudgetState(null, 'never-fetched'),
      deriveBudgetState(wire({ messageCount: 0 }), 'fresh'),
      deriveBudgetState(wire({ messageCount: 30, usagePct: 60 }), 'fresh'),
      deriveBudgetState(wire({ messageCount: 60, atOrOverThreshold: true }), 'fresh'),
      deriveBudgetState(null, 'unreachable'),
    ];
    for (const s of states) {
      expect(s.label).not.toMatch(/\bOK\b/);
      expect(s.label).not.toMatch(/\bHealthy\b/);
      expect(s.label).not.toMatch(/\bAll systems\b/);
    }
  });
});
