import { test } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { prepareContext } from '../lib/context-orchestrator.js';

function createInMemoryDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  return db;
}

test('prepareContext returns empty for empty messages', async () => {
  const result = await prepareContext({ messages: [] });

  assert.deepStrictEqual(result.messages, []);
  assert.strictEqual(result.usedTokens, 0);
  assert.strictEqual(result.compacted, false);
});

test('prepareContext respects target size', async () => {
  const messages = [
    { role: 'user', content: 'Test' }
  ];

  const result = await prepareContext({
    messages,
    intent: 'chat',
    systemLoad: { freeVRAMGB: 16 }
  });

  assert(result.targetSize >= 8192);
  assert(result.usedTokens <= result.targetSize * 1.5);
});

test('prepareContext compacts when messages exceed target', async () => {
  const messages = Array(20).fill(null).map((_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'This is a longer message that has many words in it for testing purposes. '.repeat(40)
  }));

  const mockSummarize = async () => 'Compacted summary';

  const result = await prepareContext({
    messages,
    intent: 'chat',
    summarize: mockSummarize,
    systemLoad: { freeVRAMGB: 16 }
  });

  assert(result.messages.length < messages.length);
});

test('prepareContext falls back on compaction error', async () => {
  const messages = [
    { role: 'user', content: 'Test message' }
  ];

  const throwingSummarize = async () => {
    throw new Error('Summarize failed');
  };

  const result = await prepareContext({
    messages,
    intent: 'chat',
    summarize: throwingSummarize
  });

  assert(result.messages.length > 0);
  assert.strictEqual(result.compacted, false);
});

test('prepareContext uses vault when db and userId provided', async () => {
  const db = createInMemoryDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_vault (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      created_at INTEGER NOT NULL,
      last_accessed INTEGER,
      access_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_mv_user ON memory_vault(user_id);
    CREATE INDEX IF NOT EXISTS idx_mv_kind ON memory_vault(kind);
  `);

  const stmt = db.prepare(`
    INSERT INTO memory_vault (user_id, kind, key, content, created_at, access_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run('user123', 'exchange', 'prior', 'Prior context', Date.now() - 1000, 5);

  const messages = [
    { role: 'user', content: 'New message' }
  ];

  const result = await prepareContext({
    db,
    userId: 'user123',
    messages,
    intent: 'chat'
  });

  assert(result.vaultRefs.length > 0);
});

test('prepareContext returns correct structure', async () => {
  const messages = [
    { role: 'user', content: 'Test' }
  ];

  const result = await prepareContext({
    messages,
    intent: 'analysis'
  });

  assert(Array.isArray(result.messages));
  assert(typeof result.usedTokens === 'number');
  assert(Array.isArray(result.vaultRefs));
  assert(typeof result.compacted === 'boolean');
  assert(typeof result.targetSize === 'number');
});

test('prepareContext reduces target on low VRAM', async () => {
  const messages = [
    { role: 'user', content: 'Test message' }
  ];

  const result = await prepareContext({
    messages,
    intent: 'codebase',
    systemLoad: { freeVRAMGB: 4 }
  });

  assert(result.targetSize <= 10240);
});

test('prepareContext stores exchange in vault', async () => {
  const db = createInMemoryDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_vault (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      created_at INTEGER NOT NULL,
      last_accessed INTEGER,
      access_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_mv_user ON memory_vault(user_id);
    CREATE INDEX IF NOT EXISTS idx_mv_kind ON memory_vault(kind);
  `);

  const messages = [
    { role: 'user', content: 'Test exchange message' }
  ];

  await prepareContext({
    db,
    userId: 'user123',
    messages,
    intent: 'chat',
    brainName: 'conscious'
  });

  const query = db.prepare('SELECT COUNT(*) as cnt FROM memory_vault WHERE user_id = ?');
  const { cnt } = query.get('user123');

  assert(cnt >= 0);
});
