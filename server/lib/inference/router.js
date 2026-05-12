// server/lib/inference/router.js
// Brain selection with role-based routing, availability checking, and fallback.
// Extends the static BRAIN_CONFIG routing with runtime health checks.

import { BRAIN_CONFIG } from "../brain-config.js";
import { isBrainAvailable, makeBrainHandle } from "./ollama-client.js";
import { LruMap, LruSet } from "../lru-map.js";

// Role → ordered list of brains to try (primary first, then fallback)
// IMPORTANT: conscious role for chat callers has NO fallback chain.
// Chat is conscious-only. If 14B is unavailable, we fail explicitly.
const ROLE_CHAIN = {
  conscious:    ["conscious"],      // chat uses conscious ONLY — no silent downgrade
  subconscious: ["subconscious", "utility"],
  utility:      ["utility", "repair"],
  repair:       ["repair"],
  multimodal:   ["multimodal"],
};

// CallerIds that require strict conscious-only routing (no fallback under any circumstances)
const CHAT_CALLER_PREFIXES = ["chat", "chat-conscious", "conscious-chat"];

// Reachability cache — refreshed on first miss or after TTL
const _available = new LruMap(); // brainName → { ok, expiresAt }
const CACHE_TTL_MS = 15000;

async function checkAvailability(brainName) {
  const cached = _available.get(brainName);
  if (cached && Date.now() < cached.expiresAt) return cached.ok;
  const ok = await isBrainAvailable(brainName);
  _available.set(brainName, { ok, expiresAt: Date.now() + CACHE_TTL_MS });
  return ok;
}

/**
 * Select the best available brain for a role.
 * Tries the primary brain first, falls back through the role chain.
 *
 * @param {import('./types.js').BrainRole} role
 * @param {{ brainOverride?: string, skipAvailabilityCheck?: boolean }} opts
 * @returns {Promise<{handle: import('./types.js').BrainHandle, fallbacksUsed: string[]}>}
 */
export async function selectBrain(role, opts = {}) {
  if (opts.brainOverride && BRAIN_CONFIG[opts.brainOverride]) {
    return {
      handle: makeBrainHandle(opts.brainOverride),
      fallbacksUsed: [],
    };
  }

  // Enforce conscious-only for chat callers — no silent fallback to other brains
  const callerId = opts.callerId || "";
  const isChatCaller = CHAT_CALLER_PREFIXES.some(prefix => callerId.startsWith(prefix));
  if ((role === "conscious" || isChatCaller) && !opts.skipAvailabilityCheck) {
    const available = await checkAvailability("conscious");
    if (!available) {
      const err = new Error(
        "Conscious brain required for chat is currently unavailable. " +
        "Service will resume when the conscious brain is back online."
      );
      err.code = "conscious_brain_unavailable";
      err.role = role;
      err.callerId = callerId;
      throw err;
    }
    return { handle: makeBrainHandle("conscious"), fallbacksUsed: [] };
  }

  const chain = ROLE_CHAIN[role] || ROLE_CHAIN.conscious;
  const fallbacksUsed = [];

  for (let i = 0; i < chain.length; i++) {
    const brainName = chain[i];
    if (!BRAIN_CONFIG[brainName]) continue;

    if (opts.skipAvailabilityCheck) {
      return { handle: makeBrainHandle(brainName), fallbacksUsed };
    }

    const available = await checkAvailability(brainName);
    if (available) {
      return { handle: makeBrainHandle(brainName), fallbacksUsed };
    }

    if (i > 0) fallbacksUsed.push(chain[i - 1]);
  }

  // All brains in chain unavailable — return primary anyway (will fail at call time)
  const primary = chain[0];
  return {
    handle: makeBrainHandle(primary),
    fallbacksUsed: chain.slice(0, -1),
  };
}

/**
 * Invalidate the availability cache for a brain (call after a successful call).
 * @param {string} brainName
 */
export function markBrainAvailable(brainName) {
  _available.set(brainName, { ok: true, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Mark a brain as unavailable (call after a failed call).
 * @param {string} brainName
 */
export function markBrainUnavailable(brainName) {
  _available.set(brainName, { ok: false, expiresAt: Date.now() + CACHE_TTL_MS });
}
