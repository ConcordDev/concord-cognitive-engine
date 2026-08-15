import { test } from 'node:test';
import assert from 'node:assert';
import { pickFreeCloudProvider, listAvailableProviders, getDefaultModel } from '../lib/free-cloud-router.js';
import { fcfsReset, fcfsTryConsume } from '../lib/fcfs-quota.js';

test('pickFreeCloudProvider returns highest-priority configured provider', () => {
  process.env.OPENROUTER_API_KEY = 'test';
  process.env.CEREBRAS_API_KEY = 'test';
  process.env.GROQ_API_KEY = '';
  process.env.GEMINI_API_KEY = '';
  process.env.MISTRAL_API_KEY = '';
  process.env.CLOUDFLARE_API_TOKEN = '';
  const r = pickFreeCloudProvider({ userId: 'router-test-1', slot: 'conscious' });
  assert(r);
  assert.strictEqual(r.provider, 'openrouter');
});

test('pickFreeCloudProvider skips providers with exhausted quota', () => {
  process.env.OPENROUTER_API_KEY = 'test';
  process.env.CEREBRAS_API_KEY = 'test';
  fcfsReset('router-test-2');
  // Exhaust openrouter (default 50 calls limit)
  for (let i = 0; i < 50; i++) {
    fcfsTryConsume({ userId: 'router-test-2', provider: 'openrouter', estimatedTokens: 1 });
  }
  const r = pickFreeCloudProvider({ userId: 'router-test-2', slot: 'conscious' });
  // Should fall through to cerebras since openrouter is now exhausted
  assert(r);
  assert.strictEqual(r.provider, 'cerebras');
});

test('pickFreeCloudProvider returns null when no providers configured', () => {
  process.env.OPENROUTER_API_KEY = '';
  process.env.CEREBRAS_API_KEY = '';
  process.env.GROQ_API_KEY = '';
  process.env.GEMINI_API_KEY = '';
  process.env.MISTRAL_API_KEY = '';
  process.env.CLOUDFLARE_API_TOKEN = '';
  const r = pickFreeCloudProvider({ userId: 'router-test-3', slot: 'conscious' });
  assert.strictEqual(r, null);
});

test('listAvailableProviders returns configured status', () => {
  process.env.OPENROUTER_API_KEY = 'test';
  process.env.CEREBRAS_API_KEY = '';
  const list = listAvailableProviders();
  const or = list.find(p => p.provider === 'openrouter');
  const cerebras = list.find(p => p.provider === 'cerebras');
  assert.strictEqual(or.configured, true);
  assert.strictEqual(cerebras.configured, false);
});

test('getDefaultModel returns expected model for slot', () => {
  const m = getDefaultModel('cerebras', 'conscious');
  assert.strictEqual(m, 'llama-3.3-70b');
});
