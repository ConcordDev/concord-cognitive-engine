// server/lib/fcfs-quota.js
//
// Per-user daily FCFS quota tracker.
//
// Each user gets a daily budget per provider, plus a global daily budget
// summed across all providers. When the budget is hit, returns
// {allowed: false, reason: 'daily_limit'} cleanly so the caller can fall
// through to the next provider in the priority chain.
//
// Resets at midnight UTC. Uses LruMap to bound memory under high user churn.
//
// API:
//   fcfsTryConsume({userId, provider, estimatedTokens}) → {allowed, callsRemaining, tokensRemaining, resetsAt, reason?}
//   fcfsGetStatus(userId) → {callsToday, tokensToday, limits, perProvider, resetsAt}
//   fcfsReset(userId) → admin reset

import { LruMap } from './lru-map.js';
import logger from './logger.js';

const DEFAULT_DAILY_CALLS = Number(process.env.CONCORD_USER_DAILY_CALLS) || 100;
const DEFAULT_DAILY_TOKENS = Number(process.env.CONCORD_USER_DAILY_TOKENS) || 500_000;
const PROVIDER_CALL_OVERRIDES = {
  openrouter: Number(process.env.CONCORD_USER_DAILY_OPENROUTER) || 50,
  cerebras: Number(process.env.CONCORD_USER_DAILY_CEREBRAS) || 100,
  cloudflare: Number(process.env.CONCORD_USER_DAILY_CLOUDFLARE) || 200,
  groq: Number(process.env.CONCORD_USER_DAILY_GROQ) || 50,
  gemini: Number(process.env.CONCORD_USER_DAILY_GEMINI) || 50,
  mistral: Number(process.env.CONCORD_USER_DAILY_MISTRAL) || 50,
};

const usageCache = new LruMap(50_000);

/** Returns YYYY-MM-DD for a Date in UTC. */
function dayUtc(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** Returns ms until next midnight UTC. */
function msUntilReset() {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return tomorrow.getTime() - now.getTime();
}

/**
 * Get or create the usage record for (user, provider) on the current UTC day.
 * If the day has rolled over, the record resets.
 */
function getOrCreateRecord(userId, provider, day = dayUtc()) {
  const key = `${userId}:${provider}:${day}`;
  let rec = usageCache.get(key);
  if (!rec) {
    rec = {
      userId,
      provider,
      day,
      calls: 0,
      tokensIn: 0,
      tokensOut: 0,
      lastCall: 0,
    };
    usageCache.set(key, rec);
  }
  return rec;
}

/**
 * Try to consume one call + estimatedTokens for a (user, provider).
 * Returns allowed=false if either per-provider call limit OR global token
 * limit is exceeded.
 */
export function fcfsTryConsume({ userId, provider, estimatedTokens = 0 }) {
  if (!userId || !provider) {
    return { allowed: false, reason: 'missing_params', resetsAt: Date.now() + msUntilReset() };
  }

  const day = dayUtc();
  const providerLimit = PROVIDER_CALL_OVERRIDES[provider] || DEFAULT_DAILY_CALLS;

  // Per-provider call limit
  const rec = getOrCreateRecord(userId, provider, day);
  if (rec.calls >= providerLimit) {
    return {
      allowed: false,
      reason: 'daily_limit',
      callsRemaining: 0,
      tokensRemaining: null,
      resetsAt: Date.now() + msUntilReset(),
    };
  }

  // Global per-user token limit (sum across all providers)
  const globalRec = getOrCreateRecord(userId, '_global', day);
  const estTotal = (globalRec.tokensIn + globalRec.tokensOut) + estimatedTokens;
  if (estTotal > DEFAULT_DAILY_TOKENS) {
    return {
      allowed: false,
      reason: 'daily_token_limit',
      callsRemaining: providerLimit - rec.calls,
      tokensRemaining: Math.max(0, DEFAULT_DAILY_TOKENS - (globalRec.tokensIn + globalRec.tokensOut)),
      resetsAt: Date.now() + msUntilReset(),
    };
  }

  // Consume
  rec.calls++;
  rec.tokensIn += Math.floor(estimatedTokens / 2);
  rec.tokensOut += Math.floor(estimatedTokens / 2);
  rec.lastCall = Date.now();

  globalRec.calls++;
  globalRec.tokensIn += Math.floor(estimatedTokens / 2);
  globalRec.tokensOut += Math.floor(estimatedTokens / 2);
  globalRec.lastCall = Date.now();

  return {
    allowed: true,
    callsRemaining: providerLimit - rec.calls,
    tokensRemaining: DEFAULT_DAILY_TOKENS - (globalRec.tokensIn + globalRec.tokensOut),
    resetsAt: Date.now() + msUntilReset(),
  };
}

/**
 * Record actual usage after a call completes (for accurate accounting).
 */
export function fcfsRecordUsage({ userId, provider, tokensIn = 0, tokensOut = 0 }) {
  if (!userId || !provider) return;
  const day = dayUtc();
  const rec = getOrCreateRecord(userId, provider, day);
  const globalRec = getOrCreateRecord(userId, '_global', day);
  // Adjust: subtract the estimate, add actual
  rec.tokensIn = Math.max(0, rec.tokensIn - Math.floor((rec.tokensIn + rec.tokensOut) / 2) + tokensIn);
  rec.tokensOut = Math.max(0, rec.tokensOut - Math.floor((rec.tokensIn + rec.tokensOut) / 2) + tokensOut);
  globalRec.tokensIn = Math.max(0, globalRec.tokensIn + tokensIn - Math.floor((globalRec.tokensIn + globalRec.tokensOut) / 2) + tokensIn);
  globalRec.tokensOut = Math.max(0, globalRec.tokensOut + tokensOut - Math.floor((globalRec.tokensIn + globalRec.tokensOut) / 2) + tokensOut);
}

/**
 * Get current usage status for a user.
 */
export function fcfsGetStatus(userId) {
  const day = dayUtc();
  const perProvider = {};
  let totalCalls = 0;
  let totalTokens = 0;

  for (const provider of Object.keys(PROVIDER_CALL_OVERRIDES)) {
    const rec = getOrCreateRecord(userId, provider, day);
    const limit = PROVIDER_CALL_OVERRIDES[provider] || DEFAULT_DAILY_CALLS;
    perProvider[provider] = {
      calls: rec.calls,
      callsLimit: limit,
      tokens: rec.tokensIn + rec.tokensOut,
      exhausted: rec.calls >= limit,
    };
    totalCalls += rec.calls;
    totalTokens += rec.tokensIn + rec.tokensOut;
  }

  return {
    userId,
    day,
    callsToday: totalCalls,
    tokensToday: totalTokens,
    limits: {
      callsPerProvider: PROVIDER_CALL_OVERRIDES,
      tokensPerDay: DEFAULT_DAILY_TOKENS,
    },
    perProvider,
    resetsAt: Date.now() + msUntilReset(),
  };
}

/**
 * Admin: reset all usage for a user.
 */
export function fcfsReset(userId) {
  const day = dayUtc();
  for (const key of usageCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      usageCache.delete(key);
    }
  }
  logger.log('info', 'fcfs_reset', { userId, day });
}

export const _testing = { usageCache, dayUtc, msUntilReset };

export default {
  fcfsTryConsume,
  fcfsRecordUsage,
  fcfsGetStatus,
  fcfsReset,
};
