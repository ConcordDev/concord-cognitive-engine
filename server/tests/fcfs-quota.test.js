import { test } from 'node:test';
import assert from 'node:assert';
import { fcfsTryConsume, fcfsGetStatus, fcfsReset, fcfsRecordUsage } from '../lib/fcfs-quota.js';

test('fcfsTryConsume allows calls under limit', () => {
  fcfsReset('test-user-1');
  const r = fcfsTryConsume({ userId: 'test-user-1', provider: 'openrouter', estimatedTokens: 100 });
  assert.strictEqual(r.allowed, true);
  assert(typeof r.callsRemaining === 'number');
});

test('fcfsTryConsume rejects at provider call limit', () => {
  fcfsReset('test-user-2');
  for (let i = 0; i < 50; i++) {
    fcfsTryConsume({ userId: 'test-user-2', provider: 'openrouter', estimatedTokens: 10 });
  }
  const r = fcfsTryConsume({ userId: 'test-user-2', provider: 'openrouter', estimatedTokens: 10 });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, 'daily_limit');
});

test('fcfsTryConsume rejects when token budget exceeded', () => {
  fcfsReset('test-user-3');
  const r = fcfsTryConsume({ userId: 'test-user-3', provider: 'groq', estimatedTokens: 600_000 });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, 'daily_token_limit');
});

test('fcfsGetStatus returns per-provider counts', () => {
  fcfsReset('test-user-4');
  fcfsTryConsume({ userId: 'test-user-4', provider: 'openrouter', estimatedTokens: 50 });
  fcfsTryConsume({ userId: 'test-user-4', provider: 'groq', estimatedTokens: 30 });
  const status = fcfsGetStatus('test-user-4');
  assert(status.callsToday >= 2);
  assert(status.tokensToday >= 80);
  assert(status.perProvider.openrouter.calls >= 1);
  assert(status.perProvider.groq.calls >= 1);
  assert(typeof status.resetsAt === 'number');
  assert(status.resetsAt > Date.now());
});

test('fcfsRecordUsage updates actual token counts', () => {
  fcfsReset('test-user-5');
  fcfsTryConsume({ userId: 'test-user-5', provider: 'cerebras', estimatedTokens: 100 });
  fcfsRecordUsage({ userId: 'test-user-5', provider: 'cerebras', tokensIn: 80, tokensOut: 40 });
  const status = fcfsGetStatus('test-user-5');
  assert(status.perProvider.cerebras.tokens > 0);
});

test('fcfsTryConsume rejects with missing params', () => {
  const r = fcfsTryConsume({ userId: null, provider: 'openrouter' });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, 'missing_params');
});

test('fcfsReset clears all user usage', () => {
  fcfsTryConsume({ userId: 'test-user-6', provider: 'openrouter', estimatedTokens: 100 });
  fcfsReset('test-user-6');
  const status = fcfsGetStatus('test-user-6');
  assert.strictEqual(status.callsToday, 0);
});
