/**
 * Token Budget Assembler — Comprehensive Tests
 * Run: node --test tests/token-budget-assembler.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  estimateTokens,
  BUDGET_RATIOS,
  formatDTUBlock,
  assembleWithTokenBudget,
  computeBudgetBreakdown,
  dtuContextCapTokens,
} from '../lib/token-budget-assembler.js';

// ── estimateTokens tests ────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for null/empty', () => {
    assert.strictEqual(estimateTokens(null), 0);
    assert.strictEqual(estimateTokens(''), 0);
    assert.strictEqual(estimateTokens(undefined), 0);
  });

  it('estimates correctly for known string lengths', () => {
    // 38 chars / 3.8 = 10 tokens
    const text = 'a'.repeat(38);
    assert.strictEqual(estimateTokens(text), 10);
  });

  it('rounds up', () => {
    // 39 chars / 3.8 = 10.26 → 11
    const text = 'a'.repeat(39);
    assert.strictEqual(estimateTokens(text), 11);
  });

  it('handles large strings', () => {
    const text = 'a'.repeat(10000);
    assert.ok(estimateTokens(text) > 2000);
  });
});

// ── BUDGET_RATIOS tests ─────────────────────────────────────────────────────

describe('BUDGET_RATIOS', () => {
  it('ratios sum to 1.0', () => {
    const sum = BUDGET_RATIOS.systemPrompt +
      BUDGET_RATIOS.conversationSummary +
      BUDGET_RATIOS.dtuContext +
      BUDGET_RATIOS.responseSpace;
    assert.ok(Math.abs(sum - 1.0) < 0.001, `Ratios sum to ${sum}`);
  });

  it('has correct individual values', () => {
    assert.strictEqual(BUDGET_RATIOS.systemPrompt, 0.15);
    assert.strictEqual(BUDGET_RATIOS.conversationSummary, 0.10);
    assert.strictEqual(BUDGET_RATIOS.dtuContext, 0.50);
    assert.strictEqual(BUDGET_RATIOS.responseSpace, 0.25);
  });

  it('is frozen', () => {
    assert.ok(Object.isFrozen(BUDGET_RATIOS));
  });
});

// ── formatDTUBlock tests ────────────────────────────────────────────────────

describe('formatDTUBlock', () => {
  it('formats basic DTU', () => {
    const dtu = { id: 'dtu1', title: 'Test DTU', tier: 'regular', tags: ['science'] };
    const block = formatDTUBlock(dtu);
    assert.ok(block.includes('[REGULAR] Test DTU'));
    assert.ok(block.includes('Tags: science'));
  });

  it('formats MEGA DTU', () => {
    const dtu = { id: 'mega1', title: 'Mega Summary', tier: 'mega', tags: [] };
    const block = formatDTUBlock(dtu);
    assert.ok(block.includes('[MEGA]'));
  });

  it('includes summary text', () => {
    const dtu = {
      id: 'dtu1', title: 'Test', tier: 'regular', tags: [],
      human: { summary: 'This is a test summary' },
    };
    const block = formatDTUBlock(dtu);
    assert.ok(block.includes('This is a test summary'));
  });

  it('includes invariants', () => {
    const dtu = {
      id: 'dtu1', title: 'Test', tier: 'regular', tags: [],
      core: { invariants: ['Must be true', 'Must also hold'] },
    };
    const block = formatDTUBlock(dtu);
    assert.ok(block.includes('Invariants: Must be true; Must also hold'));
  });

  it('includes activation score', () => {
    const dtu = { id: 'dtu1', title: 'Test', tier: 'regular', tags: [] };
    const block = formatDTUBlock(dtu, { score: 0.85 });
    assert.ok(block.includes('Confidence: 85%'));
  });

  it('includes consolidation info', () => {
    const dtu = { id: 'dtu1', title: 'Test', tier: 'mega', tags: [], _consolidates: 5 };
    const block = formatDTUBlock(dtu);
    assert.ok(block.includes('Consolidates: 5 DTUs'));
  });

  it('includes lineage depth', () => {
    const dtu = {
      id: 'dtu1', title: 'Test', tier: 'regular', tags: [],
      lineage: { parents: ['p1', 'p2'] },
    };
    const block = formatDTUBlock(dtu);
    assert.ok(block.includes('Lineage depth: 2'));
  });

  it('filters shadow and session tags', () => {
    const dtu = {
      id: 'dtu1', title: 'Test', tier: 'regular',
      tags: ['shadow', 'session:abc', 'science', 'physics'],
    };
    const block = formatDTUBlock(dtu);
    assert.ok(!block.includes('shadow'));
    assert.ok(!block.includes('session:'));
    assert.ok(block.includes('science'));
  });

  it('uses id as fallback when no title', () => {
    const dtu = { id: 'dtu123', tier: 'regular', tags: [] };
    const block = formatDTUBlock(dtu);
    assert.ok(block.includes('dtu123'));
  });

  it('truncates long summaries at 300 chars', () => {
    const dtu = {
      id: 'dtu1', title: 'Test', tier: 'regular', tags: [],
      human: { summary: 'x'.repeat(500) },
    };
    const block = formatDTUBlock(dtu);
    // The summary line should not exceed 300 chars of content
    const summaryLine = block.split('\n').find(l => l.includes('xxx'));
    assert.ok(summaryLine.length <= 310); // 300 + indentation
  });
});

// ── assembleWithTokenBudget tests ───────────────────────────────────────────

describe('assembleWithTokenBudget', () => {
  it('returns correct structure', () => {
    const result = assembleWithTokenBudget({
      systemPromptBase: 'You are Concord.',
      userMessage: 'Hello world',
      workingSetDtus: [],
      contextWindow: 4096,
    });
    assert.ok(result.systemPromptFinal);
    assert.ok(result.messagesForLLM);
    assert.ok(typeof result.tokenEstimate === 'number');
    assert.ok(typeof result.truncatedCount === 'number');
    assert.ok(result.budgetUtilization);
  });

  it('includes entity state in system prompt', () => {
    const result = assembleWithTokenBudget({
      systemPromptBase: 'System.',
      entityStateBlock: '[Entity State]\nMood: positive',
      userMessage: 'Hi',
      workingSetDtus: [],
      contextWindow: 4096,
    });
    assert.ok(result.systemPromptFinal.includes('[Entity State]'));
    assert.ok(result.systemPromptFinal.includes('Mood: positive'));
  });

  it('includes conversation summary in messages', () => {
    const result = assembleWithTokenBudget({
      systemPromptBase: 'System.',
      conversationSummary: 'We discussed physics last time.',
      userMessage: 'Tell me more',
      workingSetDtus: [],
      contextWindow: 4096,
    });
    const userContent = result.messagesForLLM[0].content;
    assert.ok(userContent.includes('Conversation Summary'));
    assert.ok(userContent.includes('physics'));
  });

  it('formats DTUs in context block', () => {
    const dtus = [
      { id: 'dtu1', title: 'Physics DTU', tier: 'regular', tags: ['physics'], human: { summary: 'Laws of motion' } },
    ];
    const result = assembleWithTokenBudget({
      systemPromptBase: 'System.',
      userMessage: 'Physics?',
      workingSetDtus: dtus,
      contextWindow: 32768,
    });
    assert.ok(result.dtuContextBlock.includes('[REGULAR] Physics DTU'));
    assert.ok(result.dtuContextBlock.includes('Laws of motion'));
    assert.strictEqual(result.dtuCount, 1);
  });

  it('truncates DTUs when over budget', () => {
    // Create many large DTUs that won't all fit in a tiny context window
    const dtus = Array.from({ length: 50 }, (_, i) => ({
      id: `dtu_${i}`, title: `DTU ${i}`, tier: 'regular', tags: [],
      human: { summary: 'x'.repeat(200) },
    }));
    const result = assembleWithTokenBudget({
      systemPromptBase: 'System prompt here.',
      userMessage: 'Query',
      workingSetDtus: dtus,
      contextWindow: 2000, // Very small
    });
    assert.ok(result.truncatedCount > 0);
    assert.ok(result.dtuCount < 50);
  });

  it('prioritizes entity state DTUs', () => {
    const dtus = [
      { id: 'semantic1', title: 'Semantic Match', tier: 'regular', tags: [] },
      { id: 'entity1', title: 'Entity State', tier: 'regular', tags: ['entity-state'] },
    ];
    const result = assembleWithTokenBudget({
      systemPromptBase: 'System.',
      userMessage: 'Test',
      workingSetDtus: dtus,
      contextWindow: 32768,
    });
    // Entity state should appear before semantic matches
    const entityIdx = result.dtuContextBlock.indexOf('Entity State');
    const semanticIdx = result.dtuContextBlock.indexOf('Semantic Match');
    assert.ok(entityIdx < semanticIdx, 'Entity state should come first');
  });

  it('prioritizes conversation-referenced DTUs', () => {
    const dtus = [
      { id: 'mega1', title: 'Mega Summary', tier: 'mega', tags: [] },
      { id: 'conv1', title: 'Discussed DTU', tier: 'regular', tags: [] },
    ];
    const result = assembleWithTokenBudget({
      systemPromptBase: 'System.',
      userMessage: 'Test',
      workingSetDtus: dtus,
      conversationDtuIds: new Set(['conv1']),
      contextWindow: 32768,
    });
    const convIdx = result.dtuContextBlock.indexOf('Discussed DTU');
    const megaIdx = result.dtuContextBlock.indexOf('Mega Summary');
    assert.ok(convIdx < megaIdx, 'Conversation-referenced should come before MEGA');
  });

  it('provides budget utilization breakdown', () => {
    const result = assembleWithTokenBudget({
      systemPromptBase: 'System.',
      userMessage: 'Test',
      workingSetDtus: [],
      contextWindow: 32768,
    });
    assert.ok(result.budgetUtilization.systemPrompt);
    assert.ok(result.budgetUtilization.conversationSummary);
    assert.ok(result.budgetUtilization.dtuContext);
    assert.ok(result.budgetUtilization.responseSpace);
    assert.ok(result.budgetUtilization.total);
    assert.ok(typeof result.budgetUtilization.total.pct === 'number');
  });

  it('handles empty options gracefully', () => {
    const result = assembleWithTokenBudget({});
    assert.ok(result.systemPromptFinal !== undefined);
    assert.ok(result.messagesForLLM);
    assert.strictEqual(result.dtuCount, 0);
  });
});

// ── computeBudgetBreakdown tests ────────────────────────────────────────────

describe('computeBudgetBreakdown', () => {
  it('uses provided context window', () => {
    const result = computeBudgetBreakdown(4096);
    assert.strictEqual(result.contextWindow, 4096);
    assert.strictEqual(result.budgets.systemPrompt, Math.floor(4096 * 0.15));
    assert.strictEqual(result.budgets.dtuContext, Math.floor(4096 * 0.50));
  });

  it('defaults to brain config context window', () => {
    const result = computeBudgetBreakdown();
    assert.ok(result.contextWindow > 0);
  });

  it('includes ratios', () => {
    const result = computeBudgetBreakdown(4096);
    assert.strictEqual(result.ratios.systemPrompt, 0.15);
    assert.strictEqual(result.ratios.dtuContext, 0.50);
  });

  it('budgets sum approximately to context window below the DTU cap', () => {
    const result = computeBudgetBreakdown(4096);
    const sum = Object.values(result.budgets).reduce((a, b) => a + b, 0);
    // Allow small rounding error from Math.floor
    assert.ok(Math.abs(sum - 4096) < 4, `Budget sum ${sum} should be close to 4096`);
  });

  it('caps the DTU block absolutely, so a big window does not mean a big prompt', () => {
    // 2026-09-27: at 32K the 50% ratio gave retrieval ~16K tokens and a
    // greeting shipped a 16.6K-token system prompt (23-49 s of prefill).
    const big = computeBudgetBreakdown(32768);
    assert.strictEqual(big.budgets.dtuContext, dtuContextCapTokens());
    assert.ok(big.budgets.dtuContext < Math.floor(32768 * 0.5));
    const sum = Object.values(big.budgets).reduce((a, b) => a + b, 0);
    assert.ok(sum <= 32768);
    assert.strictEqual(dtuContextCapTokens({}), 3000);
    assert.strictEqual(dtuContextCapTokens({ CONCORD_DTU_CONTEXT_MAX_TOKENS: '8000' }), 8000);
    assert.strictEqual(dtuContextCapTokens({ CONCORD_DTU_CONTEXT_MAX_TOKENS: 'junk' }), 3000);
    const dtus = Array.from({ length: 200 }, (_, i) => ({ id: 'd' + i, title: 'Mega Summary ' + i, tier: 'mega', human: { summary: 'x'.repeat(800) } }));
    const r = assembleWithTokenBudget({ contextWindow: 32768, systemPromptBase: 'sys', workingSetDtus: dtus, userMessage: 'hey' });
    assert.ok(Math.ceil(r.dtuContextBlock.length / 3.8) <= dtuContextCapTokens() + 50, `DTU block ~${Math.ceil(r.dtuContextBlock.length / 3.8)} tok`);
  });
});
