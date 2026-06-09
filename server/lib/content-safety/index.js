// server/lib/content-safety/index.js
//
// #3 — the content-safety gate at Concord's publish boundary. Concord had
// fragmented moderation (agent OUTPUT filtering + user REPORTS) but no screen on
// user content as it crosses personal → public/marketplace/global. This is that
// screen: local always-on checks (free, offline) + a tier-gated external
// classifier + the CSAM hash-match hook, returning a single
// { allowed, reason, flags, requiresReview } verdict the choke points act on.
//
// Reuses lib/ugc-safety.js#flagOffensive, lib/provenance-guard.js#scanForInjection,
// lib/content-moderation.js#scanContent, and the lib/content-safety/providers.js
// adapters. Kill-switch: CONCORD_UGC_SAFETY=0. Classifier behind a configured key.

import { flagOffensive } from "../ugc-safety.js";
import { scanForInjection } from "../provenance-guard.js";
import { openaiModeration, csamHashMatch } from "./providers.js";

// Higher reach = stricter. Accepts both the promotion-pipeline and scope-separation
// vocabularies.
const TIER_RANK = Object.freeze({
  shadow: 0, local: 0, personal: 0,
  published: 1,
  regional: 2,
  marketplace: 3, national: 3, creative_global: 3,
  global: 4,
});
function rank(t) { const r = TIER_RANK[String(t || "").toLowerCase()]; return r == null ? 1 : r; }

function isMinorSexualCategory(cat) {
  return /sexual\/?minors?|csam|child.*(sexual|abuse)/i.test(String(cat));
}

/**
 * Screen content before it crosses the publish boundary.
 * @returns {Promise<{ allowed: boolean, reason: string, flags: string[], requiresReview?: boolean, csam?: boolean, report?: string }>}
 */
export async function screenForPublish(content, {
  targetScope = "published",
  contentType = "text",
  mediaBuffer = null,
  userId = null,
  classifier = null, // injectable for tests; defaults to openaiModeration
} = {}) {
  if (process.env.CONCORD_UGC_SAFETY === "0") return { allowed: true, reason: "disabled", flags: [] };

  const text = typeof content === "string" ? content : String(content?.text || content?.title || "");
  const tier = rank(targetScope);
  const flags = [];
  let requiresReview = false;

  // 1) Local, always-on (free, offline).
  if (text) {
    const inj = scanForInjection(text);
    if (inj.flagged) flags.push(`injection:${inj.hits.join(",")}`);
    const off = flagOffensive(text);
    if (off.flagged) flags.push(`offensive:${off.hits.join(",")}`);
  }

  // 2) CSAM hash-match on media — legally mandatory when configured; checked at all
  // tiers. A match hard-blocks + flags for an NCMEC report.
  if (mediaBuffer && contentType !== "text") {
    const hm = await csamHashMatch(mediaBuffer, { userId }).catch(() => ({ ok: false }));
    if (hm?.ok && hm.match) {
      return { allowed: false, reason: "csam_detected", flags: [...flags, "csam_hash_match"], csam: true, report: "ncmec" };
    }
    // Unconfigured provider + high reach → cannot auto-clear media → human review.
    if (!hm?.ok && tier >= 3) requiresReview = true;
  }

  // 3) External classifier for marketplace+ (tier >= 3) when a key is configured.
  if (tier >= 3 && process.env.CONCORD_MODERATION_CLASSIFIER !== "off") {
    const classify = classifier || openaiModeration;
    const probe = text || (mediaBuffer && contentType !== "text" ? { imageUrl: content?.imageUrl } : null);
    if (probe) {
      const r = await Promise.resolve(classify(probe, { userId })).catch(() => ({ ok: false }));
      if (r?.ok && r.flagged) {
        const cats = r.categories || [];
        flags.push(`classifier:${cats.join(",")}`);
        if (cats.some(isMinorSexualCategory)) {
          // Treat minor-sexual classification as CSAM: hard block + report.
          return { allowed: false, reason: "content_violates_policy", flags, csam: true, report: "ncmec" };
        }
        requiresReview = true; // other categories → human review, not silent block
      }
      // A classifier outage at high reach is a soft-fail → review (never fail-open
      // to "clean" for the high tiers).
      else if (!r?.ok && tier >= 4) requiresReview = true;
    }
  }

  // 4) Scope policy: local offensive/injection hard-blocks only at the top tier;
  // any public-tier soft flag routes to human review.
  const topTier = tier >= 4;
  if (topTier && flags.some((f) => f.startsWith("offensive:") || f.startsWith("injection:"))) {
    return { allowed: false, reason: "content_violates_policy", flags };
  }
  if (flags.some((f) => f.startsWith("offensive:") || f.startsWith("injection:"))) requiresReview = true;

  return { allowed: true, reason: requiresReview ? "pending_review" : "ok", flags, requiresReview };
}

/**
 * Synchronous local-only screen (no external classifier) — for sync call sites
 * like the promotion ladder where we can't await. Same scope policy on the local
 * signals; top-tier hard-blocks, other public tiers flag for review.
 */
export function screenLocalSync(content, { targetScope = "published" } = {}) {
  if (process.env.CONCORD_UGC_SAFETY === "0") return { allowed: true, reason: "disabled", flags: [] };
  const text = typeof content === "string" ? content : String(content?.text || content?.title || "");
  const tier = rank(targetScope);
  const flags = [];
  if (text) {
    const inj = scanForInjection(text);
    if (inj.flagged) flags.push(`injection:${inj.hits.join(",")}`);
    const off = flagOffensive(text);
    if (off.flagged) flags.push(`offensive:${off.hits.join(",")}`);
  }
  if (tier >= 4 && flags.length) return { allowed: false, reason: "content_violates_policy", flags };
  return { allowed: true, reason: flags.length ? "pending_review" : "ok", flags, requiresReview: flags.length > 0 };
}

export default { screenForPublish, screenLocalSync };
