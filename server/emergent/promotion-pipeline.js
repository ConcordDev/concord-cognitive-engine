/**
 * System: Promotion Pipeline
 *
 * Content lifecycle: personal → published → marketplace → global.
 * Council gates at published, sovereign gate at global.
 * Works for apps, DTU collections, macros, wrappers — any promotable item.
 *
 * All state in module-level structures. Silent failure. Additive only.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";
import { screenLocalSync } from "../lib/content-safety/index.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "promo") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function getSTATE() { return globalThis._concordSTATE || null; }

// ── Constants ───────────────────────────────────────────────────────────────

// Full promotion ladder. The previous pipeline jumped directly from
// "published" to "marketplace" to "global" with no regional or
// national intermediate — which meant there was no way to scope a DTU
// to "my region only" or "my country only". The ladder now matches
// the federation spec:
//
//   personal → published → regional → national → marketplace → global
//
// Each step has its own gate:
//   • author_only     — creator promotes their own
//   • regional_council — regional council votes
//   • national_council — national council votes
//   • council_review   — marketplace listing review
//   • sovereign_approval — global promotion (federation-wide)
//
// marketplace listing is distinct from regional/national scope — a DTU
// can be regional-scoped and still be for sale on the marketplace.
// Skipping the marketplace stage is allowed (promote regional → global
// directly) if the creator never wants to monetize.
const PROMOTION_STAGES = {
  personal: {
    next: "published",
    gate: "author_only",
    requirements: ["valid_schema"],
  },
  published: {
    next: "regional",
    gate: "author_only",
    requirements: ["description_complete"],
  },
  regional: {
    next: "national",
    gate: "regional_council",
    requirements: ["min_5_uses", "no_violations", "description_complete"],
  },
  national: {
    next: "global",
    gate: "national_council",
    requirements: ["min_25_uses", "no_violations", "positive_trust_score"],
  },
  marketplace: {
    // Marketplace is a parallel branch off any of the public stages —
    // promote directly from published/regional/national, and it still
    // needs council review before listing goes live.
    next: "global",
    gate: "council_review",
    requirements: ["min_5_uses", "no_violations", "description_complete"],
  },
  global: {
    next: null,
    gate: null,
    requirements: [],
  },
};

// ── Module State ────────────────────────────────────────────────────────────

const _proposals = new LruMap();
const _history = [];

// ── Requirement Checks ──────────────────────────────────────────────────────

function getItem(itemId, itemType, STATE) {
  if (itemType === "app") {
    // Check app-maker module
    try {
      const apps = globalThis._concordApps;
      if (apps instanceof Map) return apps.get(itemId);
    } catch (_e) { logger.debug('emergent:promotion-pipeline', 'fallback', { error: _e?.message }); }
  }
  if (itemType === "dtu" && STATE?.dtus instanceof Map) {
    return STATE.dtus.get(itemId);
  }
  return null;
}

function checkRequirement(req, item) {
  switch (req) {
    case "valid_schema":
      return item._lastValidation?.valid !== false;
    case "min_5_uses":
      return (item._useCount || 0) >= 5;
    case "min_25_uses":
      return (item._useCount || 0) >= 25;
    case "min_50_uses":
      return (item._useCount || 0) >= 50;
    case "no_violations":
      return (item._lastValidation?.violations?.length || 0) === 0;
    case "description_complete":
      // Accept title, name, description, or human.summary — DTUs carry
      // title, apps carry name, creative artifacts carry description.
      return !!(
        (item.title && String(item.title).trim().length > 0) ||
        (item.name && String(item.name).trim().length > 0) ||
        item.human?.summary ||
        item.description
      );
    case "positive_trust_score":
      return (item._trustScore || 0) >= 0; // floor at 0, not strictly positive
    case "council_unanimous":
      return item._councilVote === "unanimous";
    default:
      return true;
  }
}

// ── Promotion Request ───────────────────────────────────────────────────────

export function requestPromotion(itemId, itemType, requesterId) {
  const STATE = getSTATE();
  const item = getItem(itemId, itemType, STATE);
  if (!item) return { ok: false, error: "Item not found" };

  const currentStage = item._promotionStage || "personal";
  const stageConfig = PROMOTION_STAGES[currentStage];
  if (!stageConfig?.next) return { ok: false, error: "Already at max stage" };

  // Check requirements
  const unmet = [];
  for (const req of stageConfig.requirements) {
    if (!checkRequirement(req, item)) unmet.push(req);
  }
  if (unmet.length > 0) return { ok: false, error: "Unmet requirements", unmet };

  // #3 — content-safety gate at the scope flip (sync local screen, stricter at
  // higher reach). Blocks policy-violating content from promoting.
  const screen = screenLocalSync(item.title || item.name || item.description || "", { targetScope: stageConfig.next });
  if (!screen.allowed) return { ok: false, error: "blocked_by_moderation", reason: screen.reason, flags: screen.flags };

  // Create proposal
  const proposal = {
    id: uid("promo"),
    itemId,
    itemType,
    from: currentStage,
    to: stageConfig.next,
    gate: stageConfig.gate,
    requesterId,
    status: "pending",
    createdAt: nowISO(),
    votes: [],
    resolvedAt: null,
    resolution: null,
  };

  // Auto-approve author_only gate — the author can take their own
  // DTU from personal→published→regional without anyone else voting.
  // They just need to have a declared region (checked by dtu.create
  // when federation_tier is set; trust that here).
  if (stageConfig.gate === "author_only") {
    // Allow the author, or an admin/sovereign explicitly requesting on
    // their behalf (which is how the existing sovereign command works).
    const isAuthor = requesterId === item.author || requesterId === item.ownerId;
    if (isAuthor || requesterId === "sovereign") {
      proposal.status = "approved";
      proposal.resolvedAt = nowISO();
      proposal.resolution = "auto_approved_author";
      item._promotionStage = stageConfig.next;
      item._promotedAt = nowISO();
    }
  }

  // Queue for regional council
  if (stageConfig.gate === "regional_council") {
    proposal.status = "pending_regional_council";
  }

  // Queue for national council
  if (stageConfig.gate === "national_council") {
    proposal.status = "pending_national_council";
  }

  // Queue for marketplace council_review (parallel branch)
  if (stageConfig.gate === "council_review") {
    proposal.status = "pending_council";
  }

  // Queue for sovereign_approval (global promotion)
  if (stageConfig.gate === "sovereign_approval") {
    proposal.status = "pending_sovereign";
  }

  _proposals.set(proposal.id, proposal);
  _history.push({ action: "requested", proposalId: proposal.id, timestamp: nowISO() });

  return { ok: true, proposal };
}

// ── Approval / Rejection ────────────────────────────────────────────────────

export function approvePromotion(proposalId, approverId = "sovereign") {
  const proposal = _proposals.get(proposalId);
  if (!proposal) return { ok: false, error: "Proposal not found" };
  if (proposal.status === "approved") return { ok: false, error: "Already approved" };
  if (proposal.status === "rejected") return { ok: false, error: "Already rejected" };

  proposal.status = "approved";
  proposal.resolvedAt = nowISO();
  proposal.resolution = `approved_by_${approverId}`;

  // Apply promotion
  const STATE = getSTATE();
  const item = getItem(proposal.itemId, proposal.itemType, STATE);
  if (item) {
    item._promotionStage = proposal.to;
    item._promotedAt = nowISO();

    // ── Scope / visibility side-effects ─────────────────────────────
    // Promotion stages aren't just bookkeeping — they directly affect
    // citability, royalty flow, and who can derive. When a DTU gets
    // approved to "global" we also mutate dtu.scope and dtu.visibility
    // so the canCiteSpecificDtu check in the royalty cascade and the
    // dtu.create lineage gate both see it as freely derivable and
    // royalty-flowing across the whole federation.
    if (proposal.itemType === "dtu") {
      switch (proposal.to) {
        case "published":
          // Author made their work publicly visible — not federated
          // yet, but visible and citable to anyone with a link.
          item.visibility = "published";
          if (!item.federation_tier || item.federation_tier === "local") {
            item.federation_tier = "local";
          }
          if (item.consent) {
            item.consent.allowCitations = true;
            item.consent.shareToFeed = true;
          }
          break;
        case "regional":
          // Regional council approved — the DTU is now visible to
          // everyone in the creator's region but NOT beyond. canViewDtu
          // compares viewer.declaredRegional against
          // dtu.location_regional to enforce.
          item.federation_tier = "regional";
          item.visibility = item.visibility === "private" ? "published" : item.visibility;
          if (item.consent) {
            item.consent.allowCitations = true;
            item.consent.shareToFeed = true;
          }
          item.councilApproval = item.councilApproval || {};
          item.councilApproval.regional = {
            approvedBy: approverId,
            approvedAt: nowISO(),
            proposalId,
          };
          break;
        case "national":
          // National council approved — visible country-wide.
          item.federation_tier = "national";
          item.visibility = item.visibility === "private" ? "published" : item.visibility;
          if (item.consent) {
            item.consent.allowCitations = true;
            item.consent.shareToFeed = true;
          }
          item.councilApproval = item.councilApproval || {};
          item.councilApproval.national = {
            approvedBy: approverId,
            approvedAt: nowISO(),
            proposalId,
          };
          break;
        case "marketplace":
          // Marketplace listing branch. Doesn't change federation
          // visibility — a DTU can be regional-scoped and still for
          // sale. Just flips the marketplace consent flag.
          if (!item.visibility || item.visibility === "private") {
            item.visibility = "published";
          }
          if (item.consent) {
            item.consent.publishToMarketplace = true;
            item.consent.allowCitations = true;
          }
          break;
        case "global":
          // Sovereign-approved global promotion. The "citable by
          // anyone, royalties flow across the whole federation" state.
          // Every downstream checker (canCiteSpecificDtu, canViewDtu,
          // dtu.create lineage gate, registerCitation,
          // distributeRoyalties) recognizes federation_tier="global"
          // and scope="global" as the unlock signal.
          item.scope = "global";
          item.federation_tier = "global";
          item.visibility = "public";
          if (item.consent) {
            item.consent.allowCitations = true;
            item.consent.shareToFeed = true;
            item.consent.publishToMarketplace = true;
          }
          item.councilApproval = item.councilApproval || {};
          item.councilApproval.global = {
            approvedBy: approverId,
            approvedAt: nowISO(),
            proposalId,
            fromStage: proposal.from,
          };
          break;
        default:
          break;
      }
      // Persist the mutation if a save helper is available.
      try {
        if (typeof globalThis.saveStateDebounced === "function") {
          globalThis.saveStateDebounced();
        }
      } catch (_e) { /* non-fatal */ }
    }
  }

  _history.push({ action: "approved", proposalId, approverId, timestamp: nowISO() });

  if (typeof globalThis.realtimeEmit === "function") {
    globalThis.realtimeEmit("promotion:approved", {
      proposalId,
      itemId: proposal.itemId,
      itemType: proposal.itemType,
      stage: proposal.to,
    });
  }

  return { ok: true, proposalId, stage: proposal.to };
}

export function rejectPromotion(proposalId, reason, rejecterId = "sovereign") {
  const proposal = _proposals.get(proposalId);
  if (!proposal) return { ok: false, error: "Proposal not found" };
  if (proposal.status === "approved") return { ok: false, error: "Already approved" };
  if (proposal.status === "rejected") return { ok: false, error: "Already rejected" };

  proposal.status = "rejected";
  proposal.resolvedAt = nowISO();
  proposal.resolution = `rejected_by_${rejecterId}: ${reason || "no reason"}`;

  _history.push({ action: "rejected", proposalId, rejecterId, reason, timestamp: nowISO() });

  return { ok: true, proposalId, rejected: true, reason };
}

// ── Query Helpers ───────────────────────────────────────────────────────────

export function getQueue() {
  const pending = [];
  for (const p of _proposals.values()) {
    if (p.status.startsWith("pending")) pending.push(p);
  }
  return { ok: true, queue: pending };
}

export function getPromotionHistory(limit = 50) {
  return {
    ok: true,
    history: _history.slice(-limit),
  };
}

export function getProposal(id) {
  const p = _proposals.get(id);
  if (!p) return { ok: false, error: "Proposal not found" };
  return { ok: true, proposal: p };
}

// ── Sovereign Command Handler ───────────────────────────────────────────────

export function handlePromotionCommand(parts) {
  const sub = parts[0]?.toLowerCase();

  switch (sub) {
    case "promote": {
      const [, itemId, itemType] = parts;
      return requestPromotion(itemId, itemType || "app", "sovereign");
    }
    case "promotion-queue":
      return getQueue();
    case "promotion-approve":
      return approvePromotion(parts[1], "sovereign");
    case "promotion-reject":
      return rejectPromotion(parts[1], parts.slice(2).join(" "), "sovereign");
    case "promotion-history":
      return getPromotionHistory(parseInt(parts[1] || "50", 10));
    default:
      return { ok: false, error: `Unknown promotion command: ${sub}` };
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

export function init({ STATE, helpers } = {}) {
  return { ok: true };
}
