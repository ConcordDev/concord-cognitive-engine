# Free Cloud Brain Fleet — Design Plan

## Goal
Wire ALL the operator's free cloud API keys as fallback brains for High Power Mode users,
with per-user daily quotas and FCFS allocation.

## Existing infrastructure (already built)
- `server/lib/byo-providers.js` — adapter pattern (openai/anthropic/xai/google/groq/mistral)
- `server/lib/platform-providers.js` — routes slots to providers
- `server/lib/platform-providers-budget.js` — global per-(provider,slot) rate limit
- `server/lib/byo-router.js` — `brainChat()` dispatch (private→ollama, override→BYO, fallback→platform)
- `server/migrations/397_brain_mode.js` — `users.brain_mode` column (private/high_power)

## What's missing
1. **More provider adapters** — OpenRouter, Cerebras, Cloudflare Workers AI, OpenCode
2. **Per-USER FCFS quota** — track daily usage per user, return "quota_exhausted" cleanly
3. **High Power Mode UI** — toggle in Settings + provider picker

## Design

### 1. New provider adapters (server/lib/byo-providers.js additions)

#### OpenRouter
- Endpoint: `https://openrouter.ai/api/v1/chat/completions`
- Auth: `Authorization: Bearer ${apiKey}`
- Free models (no auth required): `meta-llama/llama-3.3-70b-instruct:free`, `qwen/qwen-2.5-72b-instruct:free`, etc.
- Free tier: 50 RPM, 20 RPD (free models only)
- Adapter shape: same as openai (OpenAI-compatible)

#### Cerebras
- Endpoint: `https://api.cerebras.ai/v1/chat/completions`
- Auth: `Authorization: Bearer ${apiKey}`
- Models: `llama-3.3-70b`, `llama-3.1-8b` (free)
- Free tier: 30 RPM, 1M TPD, 60k TPM
- Speed: ~2000 tok/s (fastest free inference)

#### Cloudflare Workers AI
- Endpoint: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.1-8b-instruct`
- Auth: `Authorization: Bearer ${apiToken}`
- Models: `@cf/meta/llama-3.1-8b-instruct`, `@cf/mistral/mistral-7b-instruct-v0.1`, etc.
- Free tier: 100k neurons/day
- Adapter shape: custom (not OpenAI-compatible)

#### OpenCode / Zen
- OpenCode provides "Zen" — a free inference gateway with many open models
- Endpoint: TBD (check OpenCode docs for current gateway)
- If not available: skip

### 2. FCFS quota tracker (server/lib/fcfs-quota.js)

```js
// Per-user daily quota (configurable via CONCORD_USER_DAILY_QUOTA)
// Tracks: {userId} → {provider, dayUtc, callsMade, tokensUsed}
// Resets at midnight UTC (or rolling 24h window)
//
// API:
//   fcfsTryConsume({db, userId, provider, estimatedTokens})
//     → {allowed: bool, callsRemaining: N, resetsAt: timestamp, reason?: 'daily_limit'|'rate_limited'}
//   fcfsGetStatus(db, userId)
//     → {callsToday, tokensToday, limitCalls, limitTokens, resetsAt, perProvider: {...}}
//
// Storage:
//   CREATE TABLE fcfs_usage (
//     user_id TEXT NOT NULL,
//     provider TEXT NOT NULL,
//     day_utc TEXT NOT NULL,  -- 'YYYY-MM-DD'
//     calls INTEGER DEFAULT 0,
//     tokens_in INTEGER DEFAULT 0,
//     tokens_out INTEGER DEFAULT 0,
//     last_call INTEGER,
//     PRIMARY KEY (user_id, provider, day_utc)
//   );
```

### 3. Provider picker (server/lib/free-cloud-router.js)

```js
// Given a user + intent, pick the best free provider
// based on: provider availability, user quota, model fit
//
// export function pickFreeCloudProvider({db, userId, slot, intent, models})
//   → {provider, modelId, apiKey} | {reason: 'all_quota_exhausted'}
//
// Priority order:
//   1. openrouter (most model variety, easy fallback)
//   2. cerebras (fastest for latency-sensitive)
//   3. groq (balanced)
//   4. gemini (best reasoning)
//   5. mistral (best for background)
//   6. cloudflare workers-ai (last resort, neurons)
```

### 4. UI component (concord-frontend/components/HighPowerMode.tsx)

```tsx
// Shows:
// - Toggle (private vs high power)
// - Per-provider quota (calls used / calls limit today)
// - "Quota exhausted for OpenRouter, try Groq" messaging
// - Reset countdown
```

## Files to ship

1. `server/lib/cloudflare-ai-provider.js` — Cloudflare adapter (separate from byo-providers for shape)
2. `server/lib/free-cloud-router.js` — provider picker
3. `server/lib/fcfs-quota.js` — quota tracker + tests
4. `server/lib/free-cloud-providers.js` — registry of all free providers + health check
5. `server/lib/byo-providers.js` — extend ADAPTERS with openrouter/cerebras
6. `server/lib/platform-providers.js` — extend SLOT_TO_PROVIDER with new slots
7. `server/migrations/414_fcfs_usage.js` — quota table
8. `server/tests/fcfs-quota.test.js`
9. `server/tests/free-cloud-router.test.js`
10. `concord-frontend/components/HighPowerMode.tsx` — UI toggle

## Test strategy
- Unit tests with mock providers
- Integration: real ollama fallback when all quota exhausted
- Per-user quota: 3 users, exhaust one, others still work

## Out of scope (next pass)
- OpenCode/zen (need to check if it has a free inference gateway)
- Per-message cost display
- User-selectable model picker (just provider for now)
