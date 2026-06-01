// server/lib/creator-progression.js
//
// Real, data-driven creator progression for the ProgressionPanel — replacing the
// panel's hardcoded DEMO_PROFILE/MILESTONES/UNLOCKS. Aggregates from live tables:
//   - totalCitations: SUM(dtu_citations.citation_count) over the user's DTUs
//   - totalRoyalties: SUM(economy_ledger.net) of ROYALTY_PAYOUTs received
//   - domains[]:      citations attributed to one of 8 reputation domains via the
//                     DTU's tags/type (best-effort keyword match; unmatched fall
//                     to 'exploration'). Tier is derived from the citation count.
//   - badges / unlocks / milestones: derived deterministically from the real
//                     totals + per-domain tiers (no fabricated data).
//
// All reads are try/catch-guarded so a minimal build (missing dtu_citations /
// economy_ledger) degrades to zeros rather than throwing.

export const REPUTATION_DOMAINS = [
  "structural", "materials", "infrastructure", "energy",
  "architecture", "mentorship", "governance", "exploration",
];

// Panel's TierName order + citation thresholds to ENTER each tier.
const TIER_ORDER = ["Novice", "Apprentice", "Journeyman", "Expert", "Master", "Grandmaster"];
const TIER_THRESHOLDS = [0, 10, 50, 150, 400, 1000];

const DOMAIN_KEYWORDS = {
  structural: ["structure", "structural", "beam", "foundation", "frame", "load"],
  materials: ["material", "ore", "alloy", "resource", "smelt", "craft"],
  infrastructure: ["infrastructure", "road", "pipe", "network", "grid", "utility"],
  energy: ["energy", "power", "battery", "solar", "reactor", "fuel"],
  architecture: ["architecture", "design", "blueprint", "building", "facade", "layout"],
  mentorship: ["mentor", "teach", "guide", "lesson", "tutor", "apprentice"],
  governance: ["governance", "vote", "policy", "faction", "law", "council", "decree"],
  exploration: ["explore", "discover", "map", "world", "quest", "expedition", "scout"],
};

function tierFor(citations) {
  let idx = 0;
  for (let i = 0; i < TIER_THRESHOLDS.length; i++) if (citations >= TIER_THRESHOLDS[i]) idx = i;
  const tier = TIER_ORDER[idx];
  const nextThreshold = idx + 1 < TIER_THRESHOLDS.length ? TIER_THRESHOLDS[idx + 1] : null;
  const citationsToNextTier = nextThreshold == null ? 0 : Math.max(0, nextThreshold - citations);
  return { tier, idx, nextThreshold, citationsToNextTier };
}

// Attribute a DTU to a domain via its tags/title/type. Returns null if nothing
// matched (caller buckets those into 'exploration').
function domainForDtu(tagsJson, title, type) {
  let hay = `${title || ""} ${type || ""}`.toLowerCase();
  try {
    const tags = JSON.parse(tagsJson || "[]");
    if (Array.isArray(tags)) hay += " " + tags.join(" ").toLowerCase();
  } catch { /* ignore malformed tags */ }
  for (const domain of REPUTATION_DOMAINS) {
    if (DOMAIN_KEYWORDS[domain].some((kw) => hay.includes(kw))) return domain;
  }
  return null;
}

/**
 * Build the ProgressionPanel's exact shape from live data.
 * @returns {{ profile, milestones, unlocks }}
 */
export function getCreatorProgression(db, userId) {
  const empty = {
    profile: { totalCitations: 0, totalRoyalties: 0, domains: zeroDomains(), badges: [] },
    milestones: [],
    unlocks: defaultUnlocks(zeroDomains()),
  };
  if (!db || !userId) return empty;

  // ── Citations per DTU (creator-owned) ──────────────────────────
  let dtuRows = [];
  try {
    dtuRows = db.prepare(`
      SELECT d.id AS id, d.title AS title, d.type AS type, d.tags_json AS tags_json,
             COALESCE(c.citation_count, 0) AS citations, c.last_cited AS last_cited
      FROM dtus d
      LEFT JOIN dtu_citations c ON c.dtu_id = d.id
      WHERE d.creator_id = ?
    `).all(userId);
  } catch { return empty; }

  const perDomain = Object.fromEntries(REPUTATION_DOMAINS.map((d) => [d, 0]));
  let totalCitations = 0;
  for (const r of dtuRows) {
    const cites = Number(r.citations) || 0;
    if (cites <= 0) continue;
    totalCitations += cites;
    const domain = domainForDtu(r.tags_json, r.title, r.type) || "exploration";
    perDomain[domain] += cites;
  }

  // ── Royalties received ─────────────────────────────────────────
  let totalRoyalties = 0;
  try {
    const row = db.prepare(`
      SELECT COALESCE(SUM(net), 0) AS total FROM economy_ledger
      WHERE to_user_id = ? AND type = 'ROYALTY_PAYOUT' AND status = 'complete'
    `).get(userId);
    totalRoyalties = Math.round((Number(row?.total) || 0) * 100) / 100;
  } catch { /* ledger optional */ }

  // ── Domains[] + unlocks[] ──────────────────────────────────────
  const domains = REPUTATION_DOMAINS.map((domain) => {
    const citations = perDomain[domain];
    const t = tierFor(citations);
    return { domain, tier: t.tier, citations, citationsToNextTier: t.citationsToNextTier };
  });
  const unlocks = buildUnlocks(domains);

  // ── Badges (deterministic from real totals) ────────────────────
  const badges = [];
  if (totalCitations >= 1) badges.push(badge("first-citation", "First Citation", "Your work was cited.", "✦"));
  if (totalCitations >= 100) badges.push(badge("cited-100", "Cited 100×", "100 citations across your DTUs.", "✺"));
  if (totalCitations >= 1000) badges.push(badge("cited-1k", "Luminary", "1,000 citations.", "☀"));
  if (totalRoyalties > 0) badges.push(badge("first-royalty", "First Royalty", "You earned perpetual royalties.", "◈"));
  const topDomain = domains.slice().sort((a, b) => b.citations - a.citations)[0];
  if (topDomain && topDomain.citations >= TIER_THRESHOLDS[5]) {
    badges.push(badge(`gm-${topDomain.domain}`, `${cap(topDomain.domain)} Grandmaster`, `Grandmaster in ${topDomain.domain}.`, "♛"));
  }

  // ── Milestones (from the user's top-cited real DTUs) ───────────
  const milestones = dtuRows
    .filter((r) => (Number(r.citations) || 0) > 0)
    .sort((a, b) => (Number(b.citations) || 0) - (Number(a.citations) || 0))
    .slice(0, 5)
    .map((r) => ({
      id: `m-${r.id}`,
      title: `“${r.title || "Untitled"}” cited ${r.citations}×`,
      description: `Your DTU has been cited ${r.citations} time${r.citations === 1 ? "" : "s"}.`,
      timestamp: r.last_cited || new Date().toISOString(),
      domain: domainForDtu(r.tags_json, r.title, r.type) || "exploration",
    }));

  return {
    profile: { totalCitations, totalRoyalties, domains, badges },
    milestones,
    unlocks,
  };
}

function zeroDomains() {
  return REPUTATION_DOMAINS.map((domain) => ({ domain, tier: "Novice", citations: 0, citationsToNextTier: TIER_THRESHOLDS[1] }));
}
function defaultUnlocks(domains) { return buildUnlocks(domains); }
function buildUnlocks(domains) {
  // Per-domain tier ladder (Apprentice..Grandmaster), each flagged unlocked when
  // the domain's citation count has reached its threshold. Gives the panel a
  // meaningful mix of earned (unlocked=true) + upcoming (false) per domain.
  const unlocks = [];
  for (const d of domains) {
    for (let i = 1; i < TIER_THRESHOLDS.length; i++) {
      const threshold = TIER_THRESHOLDS[i];
      unlocks.push({
        id: `u-${d.domain}-${TIER_ORDER[i]}`,
        domain: d.domain,
        citationsRequired: threshold,
        title: `${TIER_ORDER[i]} · ${cap(d.domain)}`,
        description: `Reach ${threshold} ${d.domain} citations for ${TIER_ORDER[i]}.`,
        unlocked: d.citations >= threshold,
      });
    }
  }
  return unlocks;
}
function badge(id, name, description, icon) { return { id, name, description, icon, earnedDate: new Date().toISOString() }; }
function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }
