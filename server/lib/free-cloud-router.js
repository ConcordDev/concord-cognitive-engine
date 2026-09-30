// server/lib/free-cloud-router.js
//
// Given a (user, slot, intent), pick the best free cloud provider.
//
// Priority order (operator decision):
//   1. openrouter — most model variety, easy fallback
//   2. cerebras — fastest for latency-sensitive (2000 tok/s)
//   3. groq — balanced
//   4. gemini — best reasoning
//   5. mistral — best for background work
//   6. cloudflare workers-ai — last resort (neurons/day)
//
// Each provider is gated by:
//   - API key configured in env
//   - User FCFS quota not exhausted
//   - Optional intent match
//
// Returns null when no provider is available (caller falls back to Ollama).

import logger from '../logger.js';
import { fcfsGetStatus } from './fcfs-quota.js';

const PROVIDERS = ['openrouter', 'cerebras', 'groq', 'gemini', 'mistral', 'cloudflare'];

const ENV_KEYS = {
  openrouter: 'OPENROUTER_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  cloudflare: 'CLOUDFLARE_API_TOKEN',
};

const DEFAULT_MODELS = {
  openrouter: {
    conscious: 'meta-llama/llama-3.3-70b-instruct:free',
    subconscious: 'qwen/qwen-2.5-72b-instruct:free',
    utility: 'meta-llama/llama-3.1-8b-instruct:free',
    repair: 'qwen/qwen-2.5-coder-32b-instruct:free',
    multimodal: 'llama-3.2-90b-vision-instruct:free',
  },
  cerebras: {
    conscious: 'llama-3.3-70b',
    subconscious: 'llama-3.3-70b',
    utility: 'llama-3.1-8b',
    repair: 'llama-3.3-70b',
    multimodal: 'llama-3.2-90b-vision',
  },
  groq: {
    conscious: 'llama-3.3-70b-versatile',
    subconscious: 'llama-3.3-70b-versatile',
    utility: 'llama-3.1-8b-instant',
    repair: 'llama-3.3-70b-versatile',
    multimodal: 'llama-3.2-90b-vision-preview',
  },
  gemini: {
    conscious: 'gemini-3.6-flash',
    subconscious: 'gemini-3.5-flash-lite',
    utility: 'gemini-3.5-flash-lite',
    repair: 'gemini-3.5-flash-lite',
    multimodal: 'gemini-3.6-flash',
  },
  mistral: {
    conscious: 'mistral-large-latest',
    subconscious: 'mistral-small-latest',
    utility: 'mistral-small-latest',
    repair: 'codestral-latest',
    multimodal: 'pixtral-large-latest',
  },
  cloudflare: {
    conscious: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    subconscious: '@cf/meta/llama-3.1-8b-instruct',
    utility: '@cf/meta/llama-3.1-8b-instruct',
    repair: '@cf/meta/llama-3.1-8b-instruct',
    multimodal: '@cf/meta/llama-3.2-11b-vision-instruct',
  },
};

const SKIPPED_PROVIDERS = (process.env.CONCORD_FREE_CLOUD_SKIP || '').split(',').filter(Boolean);

function getApiKey(provider) {
  const envVar = ENV_KEYS[provider];
  if (!envVar) return null;
  return process.env[envVar] || null;
}

/**
 * Pick the best free cloud provider for a (user, slot).
 *
 * @param {Object} args
 * @param {string} args.userId
 * @param {string} args.slot — conscious / subconscious / utility / repair / multimodal
 * @param {string} [args.intent] — chat / analysis / long-doc / codebase (hint for model choice)
 * @param {string[]} [args.providerOrder] — override priority order
 * @returns {{provider, modelId, apiKey, slot, reason?: string} | null}
 */
export function pickFreeCloudProvider({ userId, slot = 'conscious', intent = null, providerOrder = null } = {}) {
  const order = providerOrder || PROVIDERS;
  const userStatus = userId ? fcfsGetStatus(userId) : null;

  for (const provider of order) {
    if (SKIPPED_PROVIDERS.includes(provider)) continue;
    const apiKey = getApiKey(provider);
    if (!apiKey) continue;

    // Quota check
    if (userStatus) {
      const pStatus = userStatus.perProvider[provider];
      if (pStatus && pStatus.exhausted) {
        logger.log('debug', 'free_cloud_skip_quota', { userId, provider, calls: pStatus.calls });
        continue;
      }
    }

    const modelId = DEFAULT_MODELS[provider]?.[slot] || DEFAULT_MODELS[provider]?.conscious;
    if (!modelId) continue;

    logger.log('debug', 'free_cloud_picked', { userId, provider, modelId, slot, intent });
    return { provider, modelId, apiKey, slot };
  }

  logger.log('info', 'free_cloud_all_exhausted', { userId, slot });
  return null;
}

/**
 * List all configured providers (regardless of quota).
 * Used by UI to show "available providers" picker.
 */
export function listAvailableProviders() {
  return PROVIDERS
    .filter(p => !SKIPPED_PROVIDERS.includes(p))
    .map(p => ({
      provider: p,
      configured: !!getApiKey(p),
      envVar: ENV_KEYS[p],
    }));
}

/**
 * Get the default model for a (provider, slot).
 */
export function getDefaultModel(provider, slot) {
  return DEFAULT_MODELS[provider]?.[slot] || null;
}

export const _testing = { PROVIDERS, ENV_KEYS, DEFAULT_MODELS };

export default {
  pickFreeCloudProvider,
  listAvailableProviders,
  getDefaultModel,
};
