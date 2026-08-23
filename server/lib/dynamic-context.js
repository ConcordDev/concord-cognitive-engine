import { LruMap } from './lru-map.js';

const contextSizeCache = new LruMap({ max: 5000, ttl: 60000 });

const CONTEXT_SIZES = {
  chat: 8192,
  analysis: 12288,
  'long-doc': 16384,
  codebase: 20480
};

export function getContextSize({ inputTokens = 0, intent = 'chat', userTier = 'free', systemLoad = {} }) {
  const { freeVRAMGB = 16 } = systemLoad;
  const inputBucket = Math.floor(inputTokens / 1000);
  const vramBucket = freeVRAMGB < 8 ? 'low' : 'normal';
  const cacheKey = `${intent}:${userTier}:${inputBucket}:${vramBucket}`;

  const cached = contextSizeCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let baseSize = CONTEXT_SIZES[intent] || 8192;

  if (userTier === 'premium') {
    baseSize = Math.min(baseSize * 1.25, 20480);
  }

  if (freeVRAMGB < 8) {
    baseSize = Math.floor(baseSize / 2);
  }

  contextSizeCache.set(cacheKey, baseSize);
  return baseSize;
}

export function clearContextSizeCache() {
  contextSizeCache.clear();
}
