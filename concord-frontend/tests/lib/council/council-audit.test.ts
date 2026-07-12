/**
 * Hand-verified contract tests for the council lens's pure budget-simulation
 * input builder + process-completeness audit port. See
 * lib/council/council-audit.ts for why these are pure/local instead of a
 * round-trip through the `council.simulate-budget` / `council.audit` macros.
 */
import { describe, it, expect } from 'vitest';
import {
  buildBudgetSimulationInput,
  computeProcessCompleteness,
} from '@/lib/council/council-audit';

describe('buildBudgetSimulationInput', () => {
  it('maps linked BudgetItems into {total, items} using description as name', () => {
    const proposal = { linkedBudgetItems: ['bi-1', 'bi-2', 'bi-missing'] };
    const budgetItems = [
      { id: 'bi-1', description: 'Construction materials', category: 'Capital', amount: 10000 },
      { id: 'bi-2', description: 'Permits & fees', category: 'Admin', amount: 5000 },
      { id: 'bi-3', description: 'Unrelated item', category: 'Ops', amount: 999 },
    ];
    const result = buildBudgetSimulationInput(proposal, budgetItems);
    // Hand-verified: only bi-1 + bi-2 are linked (bi-3 unlinked, bi-missing doesn't exist)
    expect(result.items).toEqual([
      { name: 'Construction materials', amount: 10000 },
      { name: 'Permits & fees', amount: 5000 },
    ]);
    // Hand-verified: total = 10000 + 5000 = 15000
    expect(result.total).toBe(15000);
  });

  it('falls back to category when description is empty', () => {
    const proposal = { linkedBudgetItems: ['bi-1'] };
    const budgetItems = [{ id: 'bi-1', description: '', category: 'Operations', amount: 250 }];
    const result = buildBudgetSimulationInput(proposal, budgetItems);
    expect(result.items).toEqual([{ name: 'Operations', amount: 250 }]);
    expect(result.total).toBe(250);
  });

  it('returns total 0 and empty items when no budget items are linked', () => {
    const result = buildBudgetSimulationInput({ linkedBudgetItems: [] }, []);
    expect(result).toEqual({ total: 0, items: [] });
  });
});

describe('computeProcessCompleteness', () => {
  const now = () => '2026-07-11T12:00:00.000Z';

  it('hand-verified: all three factors present -> processCompleteness 1', () => {
    const proposal = {
      id: 'prop-1',
      type: 'policy',
      votes: { s1: 'support', s2: 'oppose', s3: 'support' },
      discussion: [{ id: 'c1' }, { id: 'c2' }],
      linkedBudgetItems: ['bi-1'],
      updatedAt: '2026-07-10T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
    };
    const trail = computeProcessCompleteness(proposal, now);
    // Hand-verified tally: support=2, oppose=1
    expect(trail.choiceTally).toEqual({ support: 2, oppose: 1 });
    expect(trail.totalVotes).toBe(3);
    expect(trail.uniqueVoters).toBe(3);
    expect(trail.totalWeight).toBe(3); // 1 per vote, no per-vote weight tracked
    expect(trail.debateTurns).toBe(2);
    // hasVotes=true, hasDebate=true, hasBudget=true (linked items present) -> 3/3 = 1
    expect(trail.processCompleteness).toBe(1);
    expect(trail.entityId).toBe('prop-1');
    expect(trail.auditedAt).toBe('2026-07-11T12:00:00.000Z');
    expect(trail.voteTimeline).toEqual([
      { voterId: 's1', choice: 'support', weight: 1 },
      { voterId: 's2', choice: 'oppose', weight: 1 },
      { voterId: 's3', choice: 'support', weight: 1 },
    ]);
  });

  it('hand-verified: no votes, no discussion, non-budget type (budget not required) -> 1/3 = 0.33', () => {
    const proposal = {
      id: 'prop-2',
      type: 'policy',
      votes: {},
      discussion: [],
      linkedBudgetItems: [],
      updatedAt: '2026-07-10T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
    };
    const trail = computeProcessCompleteness(proposal, now);
    // hasVotes=false, hasDebate=false, hasBudget=true (type!=='budget' so not required) -> 1/3
    expect(Math.round((1 / 3) * 100) / 100).toBe(0.33);
    expect(trail.processCompleteness).toBe(0.33);
    expect(trail.totalVotes).toBe(0);
    expect(trail.choiceTally).toEqual({});
    expect(trail.voteTimeline).toEqual([]);
  });

  it('hand-verified: budget-type proposal with no linked items fails the budget factor -> 2/3 = 0.67', () => {
    const proposal = {
      id: 'prop-3',
      type: 'budget',
      votes: { s1: 'support' },
      discussion: [{ id: 'c1' }],
      linkedBudgetItems: [],
      updatedAt: '2026-07-10T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
    };
    const trail = computeProcessCompleteness(proposal, now);
    // hasVotes=true, hasDebate=true, hasBudget=false (type==='budget' AND no linked items) -> 2/3
    expect(Math.round((2 / 3) * 100) / 100).toBe(0.67);
    expect(trail.processCompleteness).toBe(0.67);
  });

  it('hand-verified: budget-type proposal WITH linked items passes the budget factor -> 3/3 = 1', () => {
    const proposal = {
      id: 'prop-4',
      type: 'budget',
      votes: { s1: 'support' },
      discussion: [{ id: 'c1' }],
      linkedBudgetItems: ['bi-1'],
      updatedAt: '2026-07-10T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
    };
    const trail = computeProcessCompleteness(proposal, now);
    expect(trail.processCompleteness).toBe(1);
  });

  it('caps voteTimeline at the last 20 votes, same as the server macro', () => {
    const votes: Record<string, string> = {};
    for (let i = 0; i < 25; i++) votes[`s${i}`] = 'support';
    const proposal = {
      id: 'prop-5',
      type: 'policy',
      votes,
      discussion: [],
      linkedBudgetItems: [],
      updatedAt: '2026-07-10T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
    };
    const trail = computeProcessCompleteness(proposal, now);
    expect(trail.totalVotes).toBe(25);
    expect(trail.voteTimeline.length).toBe(20);
    // Hand-verified: slice(-20) of s0..s24 keeps s5..s24
    expect(trail.voteTimeline[0].voterId).toBe('s5');
    expect(trail.voteTimeline[19].voterId).toBe('s24');
  });
});
