// server/lib/free-cloud-router-extended.js
//
// Wire free-cloud-router into the byo-router.js brainChat() path.
// Used as fallback when platformProviderChat() fails or isn't configured.
//
// INC-138: this used to try ONE provider with ONE model and give up, so a single withdrawn
// OpenRouter ':free' slug (404) took High Power down whenever the pod and Gemini were both out.
// It now walks every usable provider in priority order, and each provider's ordered model list,
// moving on after 404 / 408 / 429 / 5xx / timeout. Gemini 503/429 gets one ~1 s retry first.

import logger from '../logger.js';
import { freeCloudCandidates } from './free-cloud-router.js';
import { fcfsTryConsumeDb, fcfsRecordUsageDb } from './fcfs-quota-db.js';
import { providerChat } from './byo-providers.js';

// free-cloud provider name -> byo-providers.js adapter. Providers without an adapter
// (cerebras today) are skipped rather than burning quota on unknown_provider.
const ADAPTER_FOR = { openrouter: 'openrouter', groq: 'groq', gemini: 'google', mistral: 'mistral', cloudflare: 'cloudflare' };

const PER_ATTEMPT_TIMEOUT_MS = 20_000;
const TOTAL_BUDGET_MS = 55_000;
const RETRY_STATUS = /_(429|503):/;
// 401 = bad key (skip the provider). 403 can be per model ("not in your subscription"), so it moves on.
const AUTH_STATUS = /_401:/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retryDelayMs = () => {
  const v = Number(process.env.CONCORD_FREE_CLOUD_RETRY_MS);
  return Number.isFinite(v) && v >= 0 ? v : 1000;
};

/**
 * Try to serve a brain call via the free cloud providers, falling through the chain.
 * Returns the same shape as platformProviderChat().
 *
 * @param {Object} args
 * @param {Object} [args.db]
 * @param {string} args.userId
 * @param {string} args.slot — conscious / subconscious / utility / repair / multimodal
 * @param {Array} args.messages
 * @param {Object} [args.opts]
 * @returns {Promise<{ok, text, provider, model, tokensIn, tokensOut, error?, attempts?}>}
 */
export async function freeCloudProviderChat({ db, userId, slot, messages, opts = {} } = {}, deps = {}) {
  const candidates = (deps.freeCloudCandidates || freeCloudCandidates)({ userId, slot });
  const chat = deps.providerChat || providerChat;
  const tryConsume = deps.fcfsTryConsumeDb || fcfsTryConsumeDb;
  const recordUsage = deps.fcfsRecordUsageDb || fcfsRecordUsageDb;
  if (!candidates.length) {
    return { ok: false, text: '', error: 'no_free_provider_available', tokensIn: 0, tokensOut: 0 };
  }

  const startedAt = Date.now();
  const estimatedTokens = Math.ceil(JSON.stringify(messages || []).length / 4);
  const attempts = [];
  let last = null;

  for (const c of candidates) {
    const adapter = ADAPTER_FOR[c.provider];
    if (!adapter) { attempts.push({ provider: c.provider, error: 'no_adapter' }); continue; }

    const quota = tryConsume(db, { userId, provider: c.provider, estimatedTokens });
    if (!quota.allowed) {
      logger.log('info', 'free_cloud_quota_blocked', { userId, provider: c.provider, reason: quota.reason });
      attempts.push({ provider: c.provider, error: quota.reason });
      last = { ok: false, text: '', error: quota.reason, provider: c.provider, resetsAt: quota.resetsAt, tokensIn: 0, tokensOut: 0 };
      continue;
    }

    for (const modelId of c.models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const left = TOTAL_BUDGET_MS - (Date.now() - startedAt);
        if (left < 2_000) {
          return { ...(last || {}), ok: false, text: '', error: last?.error || 'free_cloud_budget_exhausted', attempts, tokensIn: 0, tokensOut: 0 };
        }
        const timeoutMs = Math.min(opts.timeoutMs || PER_ATTEMPT_TIMEOUT_MS, PER_ATTEMPT_TIMEOUT_MS, left);
        let r;
        try {
          r = await chat({ provider: adapter, apiKey: c.apiKey, slot, modelId, messages, opts: { ...opts, timeoutMs } });
        } catch (err) {
          r = { ok: false, text: '', error: String(err?.message || err), tokensIn: 0, tokensOut: 0 };
        }
        if (r?.ok && r.text) {
          if (r.tokensIn || r.tokensOut) {
            try { recordUsage(db, { userId, provider: c.provider, tokensIn: r.tokensIn || 0, tokensOut: r.tokensOut || 0 }); } catch { /* metering only */ }
          }
          if (attempts.length) logger.log('info', 'free_cloud_chain_recovered', { userId, provider: c.provider, model: modelId, attempts });
          return { ...r, provider: c.provider, model: modelId, attempts };
        }
        const error = String(r?.error || (r?.ok ? 'empty_reply' : 'free_cloud_error'));
        attempts.push({ provider: c.provider, model: modelId, error: error.slice(0, 120) });
        last = { ...r, ok: false, text: '', error, provider: c.provider, model: modelId, tokensIn: 0, tokensOut: 0 };
        logger.log('warn', 'free_cloud_provider_failed', { userId, provider: c.provider, model: modelId, error: error.slice(0, 200) });
        // The outbound leak guard refused the prompt: no provider may receive it.
        if (error.startsWith('blocked_secret_detected')) return { ...last, attempts };
        // Gemini "high demand" 503 / 429 is usually momentary: one short retry, same model.
        if (attempt === 0 && c.provider === 'gemini' && RETRY_STATUS.test(error)) { await sleep(retryDelayMs()); continue; }
        break;
      }
      // Bad key for this provider: its other models will fail the same way.
      if (last && AUTH_STATUS.test(last.error || '')) break;
    }
  }

  return { ...(last || { ok: false, text: '', error: 'free_cloud_error', tokensIn: 0, tokensOut: 0 }), ok: false, attempts };
}

export default { freeCloudProviderChat };
