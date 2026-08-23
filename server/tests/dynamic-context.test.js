import { test } from 'node:test';
import assert from 'node:assert';
import { getContextSize, clearContextSizeCache } from '../lib/dynamic-context.js';

test('getContextSize returns correct values per intent', () => {
  clearContextSizeCache();

  assert.strictEqual(getContextSize({ intent: 'chat' }), 8192);
  assert.strictEqual(getContextSize({ intent: 'analysis' }), 12288);
  assert.strictEqual(getContextSize({ intent: 'long-doc' }), 16384);
  assert.strictEqual(getContextSize({ intent: 'codebase' }), 20480);
});

test('getContextSize defaults to chat intent', () => {
  clearContextSizeCache();

  assert.strictEqual(getContextSize({}), 8192);
});

test('getContextSize halves output when systemLoad.freeVRAMGB < 8', () => {
  clearContextSizeCache();

  const baseSize = getContextSize({ intent: 'codebase' });
  const reduced = getContextSize({ intent: 'codebase', systemLoad: { freeVRAMGB: 4 } });

  assert.strictEqual(reduced, Math.floor(baseSize / 2));
});

test('getContextSize returns cached value', () => {
  clearContextSizeCache();

  const first = getContextSize({ intent: 'analysis' });
  const second = getContextSize({ intent: 'analysis' });

  assert.strictEqual(first, second);
  assert.strictEqual(first, 12288);
});

test('getContextSize applies premium tier multiplier', () => {
  clearContextSizeCache();

  const standard = getContextSize({ intent: 'chat', userTier: 'free' });
  const premium = getContextSize({ intent: 'chat', userTier: 'premium' });

  assert(premium > standard);
  assert(premium <= 20480);
});

test('getContextSize never exceeds 20480', () => {
  clearContextSizeCache();

  const result = getContextSize({
    intent: 'codebase',
    userTier: 'premium',
    systemLoad: { freeVRAMGB: 32 }
  });

  assert(result <= 20480);
});

test('getContextSize respects input token bucketing', () => {
  clearContextSizeCache();

  const size1 = getContextSize({ intent: 'chat', inputTokens: 100 });
  const size2 = getContextSize({ intent: 'chat', inputTokens: 150 });

  assert.strictEqual(size1, size2);
});
