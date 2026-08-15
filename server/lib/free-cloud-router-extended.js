// server/lib/free-cloud-router-extended.js
//
// Wire free-cloud-router into the byo-router.js brainChat() path.
// Used as fallback when platformProviderChat() fails or isn't configured.

import logger from '../logger.js';
import { pickFreeCloudProvider } from './free-cloud-router.js';
import { fcfsTryConsumeDb, fcfsRecordUsageDb } from './fcfs-quota-db.js';
import { providerChat } from './byo-providers.js';

/**
 * Try to serve a brain call via a free cloud provider.
 * Returns the same shape as platformProviderChat().
 *
 * @param {Object} args
 * @param {Object} [args.db]
 * @param {string} args.userId
 * @param {string} args.slot — conscious / subconscious / utility / repair / multimodal
 * @param {Array} args.messages
 * @param {Object} [args.opts]
 * @returns {Promise<{ok, text, provider, model, tokensIn, tokensOut, error?, reason?}>}
 */
export async function freeCloudProviderChat({ db, userId, slot, messages, opts = {} } = {}) {
  // 1. Pick best available provider
  const picked = pickFreeCloudProvider({ userId, slot });
  if (!picked) {
    return { ok: false, text: '', error: 'no_free_provider_available', tokensIn: 0, tokensOut: 0 };
  }

  // 2. Check FCFS quota
  const estimatedTokens = Math.ceil(JSON.stringify(messages).length / 4);
  const quota = fcfsTryConsumeDb(db, { userId, provider: picked.provider, estimatedTokens });
  if (!quota.allowed) {
    logger.log('info', 'free_cloud_quota_blocked', { userId, provider: picked.provider, reason: quota.reason });
    return {
      ok: false,
      text: '',
      error: quota.reason,
      provider: picked.provider,
      resetsAt: quota.resetsAt,
      tokensIn: 0,
      tokensOut: 0,
    };
  }

  // 3. Call the provider via the existing adapter
  try {
    const r = await providerChat({
      provider: picked.provider,
      apiKey: picked.apiKey,
      slot,
      modelId: picked.modelId,
      messages,
      opts,
    });

    // 4. Record actual usage
    if (r.ok && (r.tokensIn || r.tokensOut)) {
      fcfsRecordUsageDb(db, {
        userId,
        provider: picked.provider,
        tokensIn: r.tokensIn || 0,
        tokensOut: r.tokensOut || 0,
      });
    }

    return {
      ...r,
      provider: picked.provider,
      model: picked.modelId,
    };
  } catch (err) {
    logger.log('warn', 'free_cloud_provider_failed', { userId, provider: picked.provider, error: err.message });
    return {
      ok: false,
      text: '',
      error: err.message,
      provider: picked.provider,
      model: picked.modelId,
      tokensIn: 0,
      tokensOut: 0,
    };
  }
}

export default { freeCloudProviderChat };
