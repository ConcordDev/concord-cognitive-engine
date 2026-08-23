// server/lib/fcfs-quota-db.js
//
// DB-persistent version of fcfs-quota.js. Falls back to in-memory if db is unavailable.
//
// Schema:
//   CREATE TABLE fcfs_usage_daily (
//     user_id TEXT NOT NULL,
//     provider TEXT NOT NULL,
//     day_utc TEXT NOT NULL,
//     calls INTEGER DEFAULT 0,
//     tokens_in INTEGER DEFAULT 0,
//     tokens_out INTEGER DEFAULT 0,
//     last_call INTEGER,
//     PRIMARY KEY (user_id, provider, day_utc)
//   );

import { LruMap } from './lru-map.js';
import logger from '../logger.js';

const DEFAULT_DAILY_CALLS = Number(process.env.CONCORD_USER_DAILY_CALLS) || 100;
const PROVIDER_CALL_OVERRIDES = {
  openrouter: Number(process.env.CONCORD_USER_DAILY_OPENROUTER) || 50,
  cerebras: Number(process.env.CONCORD_USER_DAILY_CEREBRAS) || 100,
  cloudflare: Number(process.env.CONCORD_USER_DAILY_CLOUDFLARE) || 200,
  groq: Number(process.env.CONCORD_USER_DAILY_GROQ) || 50,
  gemini: Number(process.env.CONCORD_USER_DAILY_GEMINI) || 50,
  mistral: Number(process.env.CONCORD_USER_DAILY_MISTRAL) || 50,
};

const inMemoryCache = new LruMap(50_000);

function dayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function msUntilReset() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return tomorrow.getTime() - now.getTime();
}

function initSchema(db) {
  if (!db) return;
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fcfs_usage_daily (
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        day_utc TEXT NOT NULL,
        calls INTEGER DEFAULT 0,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        last_call INTEGER,
        PRIMARY KEY (user_id, provider, day_utc)
      );
      CREATE INDEX IF NOT EXISTS idx_fcfs_user ON fcfs_usage_daily(user_id);
      CREATE INDEX IF NOT EXISTS idx_fcfs_day ON fcfs_usage_daily(day_utc);
    `);
  } catch (err) {
    logger.log('warn', 'fcfs_db_init_failed', { error: err.message });
  }
}

function readUsage(db, userId, provider, day) {
  if (db) {
    try {
      const row = db.prepare(
        `SELECT calls, tokens_in, tokens_out, last_call FROM fcfs_usage_daily
         WHERE user_id = ? AND provider = ? AND day_utc = ?`
      ).get(userId, provider, day);
      if (row) {
        return {
          userId, provider, day,
          calls: row.calls,
          tokensIn: row.tokens_in,
          tokensOut: row.tokens_out,
          lastCall: row.last_call,
        };
      }
    } catch { /* fall through to memory */ }
  }
  // In-memory fallback
  const key = `${userId}:${provider}:${day}`;
  return inMemoryCache.get(key) || { userId, provider, day, calls: 0, tokensIn: 0, tokensOut: 0, lastCall: 0 };
}

function writeUsage(db, rec) {
  if (db) {
    try {
      db.prepare(`
        INSERT INTO fcfs_usage_daily (user_id, provider, day_utc, calls, tokens_in, tokens_out, last_call)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, provider, day_utc) DO UPDATE SET
          calls = excluded.calls,
          tokens_in = excluded.tokens_in,
          tokens_out = excluded.tokens_out,
          last_call = excluded.last_call
      `).run(rec.userId, rec.provider, rec.day, rec.calls, rec.tokensIn, rec.tokensOut, rec.lastCall);
      return;
    } catch (err) {
      logger.log('warn', 'fcfs_db_write_failed', { error: err.message });
    }
  }
  // In-memory fallback
  const key = `${rec.userId}:${rec.provider}:${rec.day}`;
  inMemoryCache.set(key, rec);
}

export function fcfsTryConsumeDb(db, { userId, provider, estimatedTokens = 0 }) {
  if (!userId || !provider) {
    return { allowed: false, reason: 'missing_params', resetsAt: Date.now() + msUntilReset() };
  }

  initSchema(db);
  const day = dayUtc();
  const providerLimit = PROVIDER_CALL_OVERRIDES[provider] || DEFAULT_DAILY_CALLS;

  const rec = readUsage(db, userId, provider, day);
  if (rec.calls >= providerLimit) {
    return { allowed: false, reason: 'daily_limit', callsRemaining: 0, resetsAt: Date.now() + msUntilReset() };
  }

  const globalRec = readUsage(db, userId, '_global', day);
  const totalTokens = (globalRec.tokensIn + globalRec.tokensOut) + estimatedTokens;
  if (totalTokens > Number(process.env.CONCORD_USER_DAILY_TOKENS || 500_000)) {
    return { allowed: false, reason: 'daily_token_limit', callsRemaining: providerLimit - rec.calls, resetsAt: Date.now() + msUntilReset() };
  }

  // Consume
  rec.calls++;
  rec.tokensIn += Math.floor(estimatedTokens / 2);
  rec.tokensOut += Math.floor(estimatedTokens / 2);
  rec.lastCall = Date.now();
  writeUsage(db, rec);

  globalRec.calls++;
  globalRec.tokensIn += Math.floor(estimatedTokens / 2);
  globalRec.tokensOut += Math.floor(estimatedTokens / 2);
  globalRec.lastCall = Date.now();
  writeUsage(db, globalRec);

  return { allowed: true, callsRemaining: providerLimit - rec.calls, resetsAt: Date.now() + msUntilReset() };
}

export function fcfsGetStatusDb(db, userId) {
  initSchema(db);
  const day = dayUtc();
  const perProvider = {};
  let totalCalls = 0;
  for (const provider of Object.keys(PROVIDER_CALL_OVERRIDES)) {
    const rec = readUsage(db, userId, provider, day);
    const limit = PROVIDER_CALL_OVERRIDES[provider] || DEFAULT_DAILY_CALLS;
    perProvider[provider] = { calls: rec.calls, callsLimit: limit, exhausted: rec.calls >= limit };
    totalCalls += rec.calls;
  }
  return { userId, day, callsToday: totalCalls, perProvider, resetsAt: Date.now() + msUntilReset() };
}

export function fcfsResetDb(db, userId) {
  initSchema(db);
  if (db) {
    try {
      db.prepare(`DELETE FROM fcfs_usage_daily WHERE user_id = ?`).run(userId);
      return;
    } catch { /* fall through */ }
  }
  // In-memory cleanup
  for (const key of inMemoryCache.keys()) {
    if (key.startsWith(`${userId}:`)) inMemoryCache.delete(key);
  }
}



export function fcfsRecordUsageDb(db, { userId, provider, tokensIn = 0, tokensOut = 0 }) {
  if (!userId || !provider) return;
  initSchema(db);
  const day = dayUtc();
  const rec = readUsage(db, userId, provider, day);
  rec.tokensIn += tokensIn;
  rec.tokensOut += tokensOut;
  rec.lastCall = Date.now();
  writeUsage(db, rec);
  const globalRec = readUsage(db, userId, '_global', day);
  globalRec.tokensIn += tokensIn;
  globalRec.tokensOut += tokensOut;
  globalRec.lastCall = Date.now();
  writeUsage(db, globalRec);
}

export default { fcfsTryConsumeDb, fcfsGetStatusDb, fcfsResetDb, fcfsRecordUsageDb };
