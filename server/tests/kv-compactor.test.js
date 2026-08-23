import { test } from 'node:test';
import assert from 'node:assert';
import { compactMessages, estimateContextTokens } from '../lib/kv-compactor.js';

test('compactMessages returns input unchanged when under maxTokens', async () => {
  const messages = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there' }
  ];

  const result = await compactMessages(messages, 10000);

  assert.deepStrictEqual(result, messages);
});

test('compactMessages returns empty array for empty input', async () => {
  const result = await compactMessages([], 1000);

  assert.deepStrictEqual(result, []);
});

test('compactMessages compacts over maxTokens with summarize function', async () => {
  const messages = Array(10).fill(null).map((_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'This is a longer message that has many words in it for testing purposes. '.repeat(20)
  }));

  const mockSummarize = async (msgs) => 'Summary of prior messages';

  const result = await compactMessages(messages, 2000, mockSummarize);

  assert(result.length > 0);
  assert.strictEqual(result[0].role, 'system');
  assert(result[0].content.includes('Summary'));
});

test('compactMessages uses fallback when summarize throws', async () => {
  const messages = Array(5).fill(null).map((_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'This is an even longer message that has many more words in it for testing purposes. '.repeat(40)
  }));

  const throwingSummarize = async () => {
    throw new Error('Summarize failed');
  };

  const result = await compactMessages(messages, 1000, throwingSummarize);

  assert(result.length > 0);
  assert.strictEqual(result[0].role, 'system');
  assert(result[0].content.includes('prior messages'));
});

test('estimateContextTokens returns reasonable token count', () => {
  const messages = [
    { role: 'user', content: 'Hello world' },
    { role: 'assistant', content: 'Hi there' }
  ];

  const tokens = estimateContextTokens(messages);

  assert(tokens > 0);
  assert(tokens < 100);
});

test('compactMessages preserves recent messages after compaction', async () => {
  const messages = [
    { role: 'user', content: 'Old message one' },
    { role: 'assistant', content: 'Old response one' },
    { role: 'user', content: 'Recent message two' },
    { role: 'assistant', content: 'Recent response two' }
  ];

  const mockSummarize = async () => 'Prior summary';

  const result = await compactMessages(messages, 500, mockSummarize);

  const recentContent = result.slice(1).map(m => m.content).join('');
  assert(recentContent.includes('Recent'));
});
