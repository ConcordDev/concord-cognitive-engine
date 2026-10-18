// server/lib/llm-cloud-fallback.js
//
// INC-137: with the pod brain down (BRAIN.conscious.enabled false), chat skipped the whole
// LLM branch, so High Power / BYO accounts got "AI is temporarily unavailable" in ~0.2 s with
// zero cloud calls. These helpers decide whether a cloud route exists for this account and run
// it. Private Mode is the account-wide "local only, no exceptions" guarantee: both functions
// return before touching any provider, key lookup or quota for a non-high_power account.

import { pickFreeCloudProvider } from "./free-cloud-router.js";
import { freeCloudProviderChat } from "./free-cloud-router-extended.js";
import { platformProviderConfigured } from "./platform-providers.js";
import { getOverride } from "./byo-router.js";

const isHighPower = (actor) => actor?.brainMode === "high_power";

/**
 * True when this account can be answered by a cloud model right now: High Power mode AND
 * (its own BYO key for the slot, an operator platform key, or a free-cloud provider with quota).
 * Always false in Private Mode (no lookups at all).
 */
export function cloudChatAvailable({ db, actor, slot = "conscious" } = {}, deps = {}) {
  if (!isHighPower(actor)) return false;
  const userId = actor?.userId;
  try {
    const ov = userId && db ? (deps.getOverride || getOverride)(db, userId, slot) : null;
    if (ov?.provider && ov.provider !== "concord_default" && ov.provider !== "ollama") return true;
  } catch { /* no BYO */ }
  try { if ((deps.platformProviderConfigured || platformProviderConfigured)(slot)) return true; } catch { /* none */ }
  try { return Boolean((deps.pickFreeCloudProvider || pickFreeCloudProvider)({ userId, slot })); } catch { return false; }
}

/**
 * Free-cloud chat for a High Power account whose local brain is down. Returns
 * { ok, text, provider, model, ... } or { ok:false, error }. Private Mode never reaches a provider.
 */
export async function cloudFallbackChat({ db, actor, slot = "conscious", messages, opts = {} } = {}, deps = {}) {
  if (!isHighPower(actor)) return { ok: false, text: "", error: "private_mode_local_only" };
  try {
    return await (deps.freeCloudProviderChat || freeCloudProviderChat)({ db, userId: actor.userId, slot, messages, opts });
  } catch (e) {
    return { ok: false, text: "", error: String(e?.message || e) };
  }
}

/** Honest readiness for this account: the local brain, or (High Power only) a cloud route. */
export function llmReadyFor({ localReady, db, actor, slot = "conscious" } = {}, deps = {}) {
  return Boolean(localReady) || cloudChatAvailable({ db, actor, slot }, deps);
}
