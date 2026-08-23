function cosineSimilarity(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0) {
    return 0;
  }

  const minLen = Math.min(a.length, b.length);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < minLen; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

function embeddingToBuffer(embedding) {
  if (!embedding) return null;
  if (Buffer.isBuffer(embedding)) return embedding;
  if (Array.isArray(embedding)) {
    const buf = Buffer.allocUnsafe(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) {
      buf.writeFloatLE(embedding[i], i * 4);
    }
    return buf;
  }
  return null;
}

function bufferToEmbedding(buf) {
  if (!buf) return null;
  const embedding = [];
  for (let i = 0; i < buf.length; i += 4) {
    embedding.push(buf.readFloatLE(i));
  }
  return embedding;
}

export function initVaultSchema(db) {
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
}

export function vaultStore(db, userId, kind, key, content, embedding = null) {
  initVaultSchema(db);

  const embeddingBuf = embeddingToBuffer(embedding);
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO memory_vault (user_id, kind, key, content, embedding, created_at, access_count)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `);

  const result = stmt.run(userId, kind, key, content, embeddingBuf, now);
  return {
    id: result.lastInsertRowid,
    userId,
    kind,
    key,
    content,
    created_at: now,
    access_count: 0
  };
}

export function vaultRecall(db, userId, query, embedding = null, topK = 3) {
  initVaultSchema(db);

  const stmt = db.prepare(`
    SELECT id, kind, key, content, embedding, access_count
    FROM memory_vault
    WHERE user_id = ?
    ORDER BY access_count DESC, created_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(userId, topK * 3);

  const scored = rows.map(row => {
    let score = 1.0;
    if (embedding && row.embedding) {
      const rowEmbedding = bufferToEmbedding(row.embedding);
      score = cosineSimilarity(embedding, rowEmbedding);
    }
    return {
      id: row.id,
      key: row.key,
      content: row.content,
      kind: row.kind,
      score
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

export function vaultCompact(db, userId, olderThanMs = 24 * 60 * 60 * 1000) {
  initVaultSchema(db);

  const cutoffTime = Date.now() - olderThanMs;

  const stmt = db.prepare(`
    DELETE FROM memory_vault
    WHERE user_id = ? AND created_at < ?
  `);

  const result = stmt.run(userId, cutoffTime);
  return {
    deleted: result.changes
  };
}

export function vaultClear(db, userId) {
  initVaultSchema(db);

  const stmt = db.prepare('DELETE FROM memory_vault WHERE user_id = ?');
  const result = stmt.run(userId);
  return {
    deleted: result.changes
  };
}
