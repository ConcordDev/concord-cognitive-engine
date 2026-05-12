/**
 * System 1: Planetary Ingest Engine
 *
 * Tiered knowledge consumption: URLs in, governed DTUs out.
 *
 * Pipeline: URL -> rate limit -> domain validation -> content fetch ->
 *   content extraction -> deduplication -> HLR Processing -> HLM Processing ->
 *   DTU Generation (CRETI) -> Council Gate (five voices) -> Installation
 *
 * Tiers:
 *   Free       — 10 pages/day, allowlist only, low priority
 *   Paid       — 100/day, normal priority
 *   Researcher — 500/day, high priority
 *   Sovereign  — unlimited, immediate processing
 *
 * Additive only. One file. Self-contained. Silent failure.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function getSTATE() {
  return globalThis._concordSTATE || null;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const TIERS = Object.freeze({
  FREE:       "free",
  PAID:       "paid",
  RESEARCHER: "researcher",
  SOVEREIGN:  "sovereign",
});

export const TIER_LIMITS = Object.freeze({
  [TIERS.FREE]:       { pagesPerDay: 10,  priority: 0, maxSizeBytes: 1_000_000,   timeoutMs: 10_000 },
  [TIERS.PAID]:       { pagesPerDay: 100, priority: 1, maxSizeBytes: 5_000_000,   timeoutMs: 20_000 },
  [TIERS.RESEARCHER]: { pagesPerDay: 500, priority: 2, maxSizeBytes: 20_000_000,  timeoutMs: 30_000 },
  [TIERS.SOVEREIGN]:  { pagesPerDay: Infinity, priority: 3, maxSizeBytes: 50_000_000, timeoutMs: 60_000 },
});

export const DOMAIN_ALLOWLIST = new Set([
  "arxiv.org",
  "pubmed.ncbi.nlm.nih.gov",
  "pubmed.gov",
  "scholar.google.com",
  "jstor.org",
  "nature.com",
  "science.org",
  "openstax.org",
  "khanacademy.org",
  "wikipedia.org",
  "w3.org",
  "ietf.org",
  "data.gov",
  "kaggle.com",
]);

export const DOMAIN_BLOCKLIST = new Set([
  "contentfarm.example.com",
  "seo-spam.example.com",
]);

// ── In-Memory State ─────────────────────────────────────────────────────────

// Ingest queue: sorted by priority on insertion
const _queue = [];

// All ingest jobs by ID
const _jobs = new LruMap();

// Rate-limit counters: userId -> { count, resetDate }
const _rateLimits = new LruMap();

// Dedup index: content hash -> ingestId
const _contentHashes = new LruMap();

// Installed DTU IDs from ingest
const _installedDTUs = [];

// Aggregate metrics
const _metrics = {
  submitted: 0,
  processed: 0,
  approved: 0,
  rejected: 0,
  duplicates: 0,
  rateLimited: 0,
  domainBlocked: 0,
  fetchErrors: 0,
  councilRejections: 0,
};

// ── Rate Limiting ───────────────────────────────────────────────────────────

function getTodayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function getRateCounter(userId) {
  const key = getTodayKey();
  let bucket = _rateLimits.get(userId);
  if (!bucket || bucket.resetDate !== key) {
    bucket = { count: 0, resetDate: key };
    _rateLimits.set(userId, bucket);
  }
  return bucket;
}

function checkRateLimit(userId, tier) {
  const limit = TIER_LIMITS[tier];
  if (!limit) return { allowed: false, reason: "unknown_tier" };
  if (limit.pagesPerDay === Infinity) return { allowed: true };

  const bucket = getRateCounter(userId);
  if (bucket.count >= limit.pagesPerDay) {
    return { allowed: false, reason: "rate_limit_exceeded", current: bucket.count, limit: limit.pagesPerDay };
  }
  return { allowed: true, current: bucket.count, remaining: limit.pagesPerDay - bucket.count };
}

function incrementRateCounter(userId) {
  const bucket = getRateCounter(userId);
  bucket.count += 1;
}

// ── Domain Validation ───────────────────────────────────────────────────────

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function matchesAllowlist(hostname) {
  if (!hostname) return false;

  // Direct match
  for (const allowed of DOMAIN_ALLOWLIST) {
    if (hostname === allowed) return true;
    // Subdomain match (e.g., en.wikipedia.org matches wikipedia.org)
    if (hostname.endsWith("." + allowed)) return true;
  }

  // *.gov wildcard
  if (hostname.endsWith(".gov")) return true;

  return false;
}

function matchesBlocklist(hostname) {
  if (!hostname) return false;
  for (const blocked of DOMAIN_BLOCKLIST) {
    if (hostname === blocked) return true;
    if (hostname.endsWith("." + blocked)) return true;
  }
  return false;
}

function validateDomain(url, tier) {
  const hostname = extractDomain(url);
  if (!hostname) return { valid: false, reason: "invalid_url", hostname: null };

  // Blocklist check — Sovereign can override
  if (matchesBlocklist(hostname) && tier !== TIERS.SOVEREIGN) {
    return { valid: false, reason: "domain_blocked", hostname };
  }

  // Free tier: allowlist only
  if (tier === TIERS.FREE && !matchesAllowlist(hostname)) {
    return { valid: false, reason: "not_on_allowlist", hostname };
  }

  // Paid/Researcher: blocklist only, all others allowed
  // Sovereign: everything allowed
  return { valid: true, hostname };
}

// ── Content Fetching ────────────────────────────────────────────────────────

/**
 * Fetch URL content with tier-appropriate timeout and size limits.
 * Returns content object with fetchSuccess boolean indicating outcome.
 */
async function fetchContent(url, tier) {
  const limits = TIER_LIMITS[tier] || TIER_LIMITS[TIERS.FREE];
  const hostname = extractDomain(url);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), limits.timeoutMs);
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Concord/1.0 (Research Bot; +https://concord.app/bot)' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        url, hostname, fetchedAt: nowISO(), fetchSuccess: false,
        error: `HTTP ${response.status}`,
      };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text') && !contentType.includes('json') && !contentType.includes('xml')) {
      return {
        url, hostname, fetchedAt: nowISO(), fetchSuccess: false,
        error: `Unsupported content type: ${contentType}`,
      };
    }

    const raw = await response.text();
    const rawLength = raw.length;

    if (rawLength > limits.maxSizeBytes) {
      return {
        url, hostname, fetchedAt: nowISO(), fetchSuccess: false,
        error: `Content too large: ${rawLength} bytes exceeds ${limits.maxSizeBytes} limit`,
      };
    }

    // Strip scripts, styles, and HTML tags for web pages
    const cleaned = raw
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50000); // Cap at 50k chars

    // Extract title from HTML if present
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : `Content from ${hostname}`;

    const format = contentType.includes('pdf') ? 'pdf'
      : contentType.includes('json') ? 'json'
      : contentType.includes('xml') ? 'xml'
      : 'html';

    return {
      url,
      hostname,
      fetchedAt: nowISO(),
      timeoutMs: limits.timeoutMs,
      maxSizeBytes: limits.maxSizeBytes,
      rawLength,
      title,
      text: cleaned,
      format,
      headers: { contentType },
      fetchSuccess: true,
    };
  } catch (e) {
    return {
      url, hostname, fetchedAt: nowISO(), fetchSuccess: false,
      error: e.name === 'AbortError' ? `Timeout after ${limits.timeoutMs}ms` : e.message,
    };
  }
}

// ── Content Extraction ──────────────────────────────────────────────────────

function extractContent(fetched) {
  if (!fetched || !fetched.fetchSuccess) {
    return { ok: false, reason: "fetch_failed" };
  }

  // Simulate HTML strip / PDF parse / markdown conversion
  const extracted = {
    title: fetched.title || "Untitled",
    plainText: fetched.text || "",
    format: fetched.format || "unknown",
    wordCount: (fetched.text || "").split(/\s+/).length,
    // Simulated structural extraction
    headings: [],
    paragraphs: [],
    citations: [],
    authors: [],
    abstract: null,
    peerReviewed: false,
    isPreprint: false,
    hasCitations: false,
    hasNamedAuthor: false,
  };

  // Infer signals from domain
  const host = fetched.hostname || "";
  if (host.includes("arxiv")) {
    extracted.isPreprint = true;
    extracted.hasCitations = true;
    extracted.hasNamedAuthor = true;
  } else if (host.includes("pubmed") || host.includes("nature.com") || host.includes("science.org")) {
    extracted.peerReviewed = true;
    extracted.hasCitations = true;
    extracted.hasNamedAuthor = true;
  } else if (host.includes("jstor")) {
    extracted.peerReviewed = true;
    extracted.hasCitations = true;
    extracted.hasNamedAuthor = true;
  } else if (host.includes("scholar.google")) {
    extracted.hasCitations = true;
    extracted.hasNamedAuthor = true;
  } else if (host.includes("wikipedia")) {
    extracted.hasCitations = true;
  } else if (host.includes("khanacademy") || host.includes("openstax")) {
    extracted.hasNamedAuthor = true;
  }

  return { ok: true, content: extracted };
}

// ── Deduplication ───────────────────────────────────────────────────────────

function computeContentHash(content) {
  const payload = JSON.stringify({
    title: (content.title || "").toLowerCase().trim(),
    text: (content.plainText || "").toLowerCase().trim().slice(0, 2000),
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function computeTagOverlap(tagsA, tagsB) {
  if (!tagsA.length || !tagsB.length) return 0;
  const setA = new Set(tagsA.map(t => t.toLowerCase()));
  const setB = new Set(tagsB.map(t => t.toLowerCase()));
  let overlap = 0;
  for (const t of setA) {
    if (setB.has(t)) overlap++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? overlap / union : 0;
}

function computeClaimOverlap(claimsA, claimsB) {
  if (!claimsA.length || !claimsB.length) return 0;
  // Simplified: lowercase exact-match comparison
  const setA = new Set(claimsA.map(c => c.toLowerCase().trim()));
  const setB = new Set(claimsB.map(c => c.toLowerCase().trim()));
  let overlap = 0;
  for (const c of setA) {
    if (setB.has(c)) overlap++;
  }
  const total = Math.max(setA.size, setB.size);
  return total > 0 ? overlap / total : 0;
}

/**
 * Check for duplicates against existing installed DTUs.
 *
 * Returns:
 *   { isDuplicate: true }                           — tag overlap >80%
 *   { isSkip: true }                                — claim overlap >60%
 *   { isPartialNovel: true, novelClaims: [...] }    — partially novel
 *   { isNovel: true }                               — fully novel
 */
function checkDeduplication(contentHash, tags, claims) {
  // Exact content hash match
  if (_contentHashes.has(contentHash)) {
    return { isDuplicate: true, reason: "exact_content_hash", matchedId: _contentHashes.get(contentHash) };
  }

  // Compare against installed DTUs
  const STATE = getSTATE();
  if (STATE && STATE.dtus) {
    for (const [dtuId, dtu] of STATE.dtus) {
      const existingTags = dtu.tags || [];
      const existingClaims = (dtu.core && dtu.core.claims) || [];

      // Tag overlap >80% = duplicate
      const tagOverlap = computeTagOverlap(tags, existingTags);
      if (tagOverlap > 0.8) {
        return { isDuplicate: true, reason: "tag_overlap", overlap: tagOverlap, matchedId: dtuId };
      }

      // Claim overlap >60% = skip
      const claimOverlap = computeClaimOverlap(claims, existingClaims);
      if (claimOverlap > 0.6) {
        return { isSkip: true, reason: "claim_overlap", overlap: claimOverlap, matchedId: dtuId };
      }

      // Partial novelty: some claims overlap but not enough to skip
      if (claimOverlap > 0.1 && claimOverlap <= 0.6) {
        const existingSet = new Set(existingClaims.map(c => c.toLowerCase().trim()));
        const novelClaims = claims.filter(c => !existingSet.has(c.toLowerCase().trim()));
        if (novelClaims.length > 0) {
          return { isPartialNovel: true, novelClaims, overlap: claimOverlap, matchedId: dtuId };
        }
      }
    }
  }

  return { isNovel: true };
}

// ── Reliability Scoring ─────────────────────────────────────────────────────

/**
 * Compute source reliability score for extracted content.
 *
 * Scoring:
 *   Baseline:         0.5
 *   Academic domain:  +0.3
 *   Has citations:    +0.1
 *   Has peer review:  +0.15
 *   Has named author: +0.05
 *   Is preprint:      -0.1
 */
export function computeReliabilityScore(content) {
  if (!content) return 0.5;

  let score = 0.5;
  const hostname = (content.hostname || content.host || "").toLowerCase();

  // Academic domain check
  const academicDomains = [
    "arxiv.org", "pubmed", "nature.com", "science.org",
    "jstor.org", "scholar.google", ".edu", ".ac.uk",
  ];
  const isAcademic = academicDomains.some(d => hostname.includes(d));
  if (isAcademic) score += 0.3;

  // Citation presence
  if (content.hasCitations) score += 0.1;

  // Peer review
  if (content.peerReviewed) score += 0.15;

  // Named author
  if (content.hasNamedAuthor) score += 0.05;

  // Preprint penalty
  if (content.isPreprint) score -= 0.1;

  return clamp01(score);
}

// ── HLR Processing (High-Level Reading) ─────────────────────────────────────

function processHLR(content, reliability) {
  // Extract key claims from content
  const claims = [];

  if (content.title) {
    claims.push(`Source presents: ${content.title}`);
  }
  if (content.abstract) {
    claims.push(`Abstract: ${content.abstract}`);
  }

  // Simulated claim extraction from text
  const text = content.plainText || "";
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
  for (const s of sentences.slice(0, 10)) {
    claims.push(s.trim());
  }

  // Evidence assessment
  const evidenceStrength = clamp01(
    (content.hasCitations ? 0.3 : 0) +
    (content.peerReviewed ? 0.3 : 0) +
    (content.hasNamedAuthor ? 0.1 : 0) +
    (claims.length > 3 ? 0.2 : 0.1) +
    0.1 // baseline
  );

  return {
    claims,
    evidenceStrength,
    reliability,
    sourceType: content.peerReviewed ? "peer_reviewed" :
                content.isPreprint ? "preprint" :
                content.hasCitations ? "cited_source" : "general",
  };
}

// ── HLM Processing (High-Level Mapping) ─────────────────────────────────────

const DOMAIN_CLASSIFICATION_KEYWORDS = {
  "formal.math":          ["math", "algebra", "topology", "theorem", "proof", "calculus"],
  "formal.logic":         ["logic", "boolean", "predicate", "inference"],
  "empirical.physics":    ["physics", "quantum", "entropy", "relativity", "particle"],
  "empirical.biology":    ["biology", "evolution", "cell", "gene", "organism"],
  "empirical.medicine":   ["medicine", "drug", "neural", "brain", "health", "disease"],
  "historical.world":     ["history", "civilization", "culture", "politics"],
  "historical.economic":  ["economic", "market", "trade", "capital"],
  "interpretive.philosophy": ["philosophy", "ethics", "consciousness", "epistemology"],
  "model.computation":    ["algorithm", "computation", "software", "data", "machine learning"],
  "design.engineering":   ["engineering", "system", "architecture", "infrastructure"],
};

function processHLM(content, hlr) {
  const text = ((content.title || "") + " " + (content.plainText || "")).toLowerCase();

  // Domain classification
  let bestDomain = "general.note";
  let bestScore = 0;
  for (const [domain, keywords] of Object.entries(DOMAIN_CLASSIFICATION_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  // Tag generation
  const tags = [bestDomain.split(".")[0]];
  if (content.peerReviewed) tags.push("peer_reviewed");
  if (content.isPreprint) tags.push("preprint");
  if (content.hasCitations) tags.push("cited");
  tags.push("ingested");

  // Extract additional keyword tags
  for (const [domain, keywords] of Object.entries(DOMAIN_CLASSIFICATION_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw) && !tags.includes(kw)) {
        tags.push(kw);
        if (tags.length >= 15) break;
      }
    }
    if (tags.length >= 15) break;
  }

  // Lineage: source URL chain
  const lineage = [{
    sourceUrl: content.url || content.hostname || "unknown",
    fetchedAt: nowISO(),
    reliability: hlr.reliability,
  }];

  // Gap identification: what claims are weakly supported
  const gaps = [];
  if (hlr.evidenceStrength < 0.5) {
    gaps.push("Low evidence strength — needs corroboration");
  }
  if (!content.peerReviewed && !content.hasCitations) {
    gaps.push("No citations or peer review — requires verification");
  }
  if (hlr.claims.length < 3) {
    gaps.push("Few extractable claims — content may be thin");
  }

  return {
    domain: bestDomain,
    tags,
    lineage,
    gaps,
    epistemicClass: bestDomain.startsWith("formal") ? "FORMAL" :
                    bestDomain.startsWith("empirical") ? "EMPIRICAL" :
                    bestDomain.startsWith("historical") ? "HISTORICAL" :
                    bestDomain.startsWith("interpretive") ? "INTERPRETIVE" :
                    bestDomain.startsWith("model") ? "MODEL" :
                    bestDomain.startsWith("design") ? "DESIGN" : "GENERAL",
  };
}

// ── DTU Generation (CRETI Format) ───────────────────────────────────────────

function generateDTU(url, content, hlr, hlm, reliability, fetchedAt) {
  const id = uid("dtu");

  return {
    id,
    title: content.title || "Untitled Ingested Content",
    domain: hlm.domain,
    tags: hlm.tags,
    epistemicClass: hlm.epistemicClass,
    tier: "regular",
    scope: "global",
    lane: "B",

    // CRETI core
    core: {
      claims: hlr.claims,
      definitions: [],
      invariants: [],
      examples: [],
      formulas: [],
      nextActions: hlm.gaps.length > 0
        ? hlm.gaps.map(g => `VERIFY: ${g}`)
        : [],
    },

    // Human-readable
    human: {
      summary: `Ingested from ${url} on ${fetchedAt}. Reliability: ${reliability.toFixed(2)}.`,
      bullets: hlr.claims.slice(0, 5),
    },

    // Scores
    resonance:  clamp01(reliability * 0.8),
    coherence:  clamp01(hlr.evidenceStrength),
    stability:  clamp01(reliability * 0.9),

    // Provenance
    provenance: {
      source: "planetary_ingest_engine",
      sourceUrl: url,
      fetchedAt,
      reliability,
      evidenceStrength: hlr.evidenceStrength,
      sourceType: hlr.sourceType,
      format: content.format || "unknown",
    },

    // Lineage
    lineage: hlm.lineage,
    gaps: hlm.gaps,

    // Metadata
    epistemicStatus: reliability >= 0.7 ? "VERIFIED" : "PROVISIONAL",
    authority: { model: "ingest_engine", score: clamp01(reliability * 0.9) },
    schemaVersion: 2,

    createdAt: nowISO(),
  };
}

// ── Council Gate (Five Voices) ──────────────────────────────────────────────

const COUNCIL_VOICES = [
  { id: "skeptic",    label: "The Skeptic",    votingTendency: "conservative", weight: 1.0 },
  { id: "socratic",   label: "The Socratic",   votingTendency: "neutral",      weight: 1.0 },
  { id: "opposer",    label: "The Opposer",    votingTendency: "adversarial",  weight: 1.0 },
  { id: "idealist",   label: "The Idealist",   votingTendency: "progressive",  weight: 1.0 },
  { id: "pragmatist", label: "The Pragmatist", votingTendency: "moderate",     weight: 1.0 },
];

function runCouncilGate(dtu) {
  const voices = {};
  const reliability = (dtu.provenance && dtu.provenance.reliability) || 0.5;
  const evidence = (dtu.provenance && dtu.provenance.evidenceStrength) || 0.5;
  const claimCount = (dtu.core && dtu.core.claims && dtu.core.claims.length) || 0;

  for (const voice of COUNCIL_VOICES) {
    let score = 0.5;

    // Skeptic: weighs evidence heavily
    if (voice.id === "skeptic") {
      score = clamp01(0.3 + evidence * 0.5 + (reliability > 0.7 ? 0.15 : 0));
    }

    // Socratic: cares about claim richness and coherence
    if (voice.id === "socratic") {
      score = clamp01(0.4 + (claimCount > 3 ? 0.2 : 0) + evidence * 0.3);
    }

    // Opposer: looks for weaknesses
    if (voice.id === "opposer") {
      const gaps = (dtu.gaps && dtu.gaps.length) || 0;
      score = clamp01(0.5 - gaps * 0.1 + reliability * 0.3);
    }

    // Idealist: values knowledge expansion
    if (voice.id === "idealist") {
      score = clamp01(0.5 + (claimCount > 0 ? 0.2 : 0) + (reliability > 0.5 ? 0.1 : 0));
    }

    // Pragmatist: practical value
    if (voice.id === "pragmatist") {
      score = clamp01(0.4 + reliability * 0.3 + (claimCount > 2 ? 0.15 : 0));
    }

    // Apply voting tendency modifier
    switch (voice.votingTendency) {
      case "conservative": score *= 0.85; break;
      case "adversarial":  score *= 0.75; break;
      case "progressive":  score *= 1.1;  break;
      case "moderate":     break;
      case "neutral":      break;
    }

    score = clamp01(score);

    voices[voice.id] = {
      label: voice.label,
      score: Math.round(score * 1000) / 1000,
      vote: score > 0.6 ? "accept" : score < 0.4 ? "reject" : "needs_more_data",
    };
  }

  const scores = Object.values(voices).map(v => v.score);
  const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length;
  const votes = Object.values(voices).map(v => v.vote);
  const acceptCount = votes.filter(v => v === "accept").length;
  const rejectCount = votes.filter(v => v === "reject").length;

  // Majority rule: need 3+ accepts to pass
  const verdict = acceptCount >= 3 ? "approved" :
                  rejectCount >= 3 ? "rejected" : "held_for_review";

  return {
    voices,
    avgScore: Math.round(avgScore * 1000) / 1000,
    verdict,
    acceptCount,
    rejectCount,
    unanimous: votes.every(v => v === votes[0]),
    evaluatedAt: nowISO(),
  };
}

// ── Installation ────────────────────────────────────────────────────────────

function installDTU(dtu, contentHash) {
  const STATE = getSTATE();

  // Register in global lattice
  if (STATE && STATE.dtus) {
    try {
      // Build CRETI human-readable content
      const lines = [];
      lines.push(`# ${dtu.title}`);
      if (dtu.human && dtu.human.summary) lines.push(`\n## Summary\n${dtu.human.summary}`);
      const bullets = (dtu.human && dtu.human.bullets) || [];
      if (bullets.length) lines.push(`\n## Key Points\n` + bullets.map(b => `- ${b}`).join("\n"));
      const claims = (dtu.core && dtu.core.claims) || [];
      if (claims.length) lines.push(`\n## Claims\n` + claims.map(c => `- ${c}`).join("\n"));
      const nextActions = (dtu.core && dtu.core.nextActions) || [];
      if (nextActions.length) lines.push(`\n## Next Actions\n` + nextActions.map(a => `- ${a}`).join("\n"));

      dtu.cretiHuman = lines.join("\n").trim();
      dtu.content = dtu.cretiHuman;

      STATE.dtus.set(dtu.id, dtu);
    } catch (_e) { logger.debug('emergent:ingest-engine', 'silent', { error: _e?.message }); }
  }

  // Track in content hash index
  _contentHashes.set(contentHash, dtu.id);

  // Track installed DTU
  _installedDTUs.push(dtu.id);
  if (_installedDTUs.length > 5000) {
    _installedDTUs.splice(0, _installedDTUs.length - 5000);
  }

  return dtu.id;
}

// ── Full Pipeline Processing ────────────────────────────────────────────────

async function processIngestJob(job) {
  const startTime = Date.now();

  try {
    job.status = "processing";
    job.processingStartedAt = nowISO();

    // Step 1: Content fetch
    const fetched = await fetchContent(job.url, job.tier);
    if (!fetched.fetchSuccess) {
      job.status = "failed";
      job.error = "fetch_failed";
      _metrics.fetchErrors++;
      return job;
    }
    job.fetchResult = { hostname: fetched.hostname, format: fetched.format, rawLength: fetched.rawLength };

    // Step 2: Content extraction
    const extraction = extractContent(fetched);
    if (!extraction.ok) {
      job.status = "failed";
      job.error = extraction.reason;
      _metrics.fetchErrors++;
      return job;
    }
    const content = extraction.content;
    content.url = job.url;
    content.hostname = fetched.hostname;

    // Step 3: Deduplication
    const contentHash = computeContentHash(content);
    const tags = []; // Will be populated by HLM
    const claims = []; // Will be populated by HLR

    // Pre-dedup on exact hash
    if (_contentHashes.has(contentHash)) {
      job.status = "duplicate";
      job.error = "exact_content_duplicate";
      job.matchedId = _contentHashes.get(contentHash);
      _metrics.duplicates++;
      return job;
    }

    // Step 4: Reliability scoring
    const reliability = computeReliabilityScore(content);
    job.reliability = reliability;

    // Step 5: HLR Processing
    const hlr = processHLR(content, reliability);

    // Step 6: HLM Processing
    const hlm = processHLM(content, hlr);

    // Step 7: Full deduplication with tags and claims
    const dedup = checkDeduplication(contentHash, hlm.tags, hlr.claims);
    if (dedup.isDuplicate) {
      job.status = "duplicate";
      job.error = "duplicate_content";
      job.dedupDetail = dedup;
      _metrics.duplicates++;
      return job;
    }
    if (dedup.isSkip) {
      job.status = "skipped";
      job.error = "claim_overlap_too_high";
      job.dedupDetail = dedup;
      _metrics.duplicates++;
      return job;
    }

    // Step 8: DTU generation
    // If partially novel, use only new claims
    let effectiveClaims = hlr.claims;
    if (dedup.isPartialNovel) {
      effectiveClaims = dedup.novelClaims;
      hlr.claims = effectiveClaims;
      job.partialNovel = true;
    }

    const dtu = generateDTU(job.url, content, hlr, hlm, reliability, fetched.fetchedAt);
    job.dtuId = dtu.id;

    // Step 9: Council Gate
    const council = runCouncilGate(dtu);
    job.council = council;

    if (council.verdict === "approved") {
      // Step 10: Installation
      installDTU(dtu, contentHash);
      job.status = "installed";
      _metrics.approved++;
    } else if (council.verdict === "rejected") {
      job.status = "council_rejected";
      _metrics.councilRejections++;
    } else {
      job.status = "held_for_review";
    }

    _metrics.processed++;
    job.processingDurationMs = Date.now() - startTime;
    job.completedAt = nowISO();

    return job;
  } catch (err) {
    job.status = "failed";
    job.error = String(err.message || err);
    _metrics.fetchErrors++;
    return job;
  }
}

// ── Queue Management ────────────────────────────────────────────────────────

function insertIntoQueue(job) {
  const priority = TIER_LIMITS[job.tier] ? TIER_LIMITS[job.tier].priority : 0;
  job.priority = priority;

  // Insert sorted by priority (highest first)
  let inserted = false;
  for (let i = 0; i < _queue.length; i++) {
    if (priority > (_queue[i].priority || 0)) {
      _queue.splice(i, 0, job);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    _queue.push(job);
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Submit a URL for ingestion.
 *
 * @param {string} userId - ID of the submitting user
 * @param {string} url - URL to ingest
 * @param {string} tier - One of: free, paid, researcher, sovereign
 * @returns {{ ok: boolean, ingestId?: string, error?: string, status?: string }}
 */
export async function submitUrl(userId, url, tier) {
  try {
    const effectiveTier = tier || TIERS.FREE;
    const ingestId = uid("ingest");

    // Rate limit check
    const rateCheck = checkRateLimit(userId, effectiveTier);
    if (!rateCheck.allowed) {
      _metrics.rateLimited++;
      return { ok: false, error: "rate_limit_exceeded", detail: rateCheck };
    }

    // Domain validation
    const domainCheck = validateDomain(url, effectiveTier);
    if (!domainCheck.valid) {
      _metrics.domainBlocked++;
      return { ok: false, error: domainCheck.reason, hostname: domainCheck.hostname };
    }

    // Increment rate counter
    incrementRateCounter(userId);
    _metrics.submitted++;

    // Create ingest job
    const job = {
      ingestId,
      userId,
      url,
      tier: effectiveTier,
      hostname: domainCheck.hostname,
      status: "queued",
      submittedAt: nowISO(),
      priority: TIER_LIMITS[effectiveTier] ? TIER_LIMITS[effectiveTier].priority : 0,
      dtuId: null,
      council: null,
      error: null,
      reliability: null,
      processingStartedAt: null,
      completedAt: null,
      processingDurationMs: null,
    };

    _jobs.set(ingestId, job);

    // Sovereign tier: immediate processing, bypass queue
    if (effectiveTier === TIERS.SOVEREIGN) {
      await processIngestJob(job);
      return { ok: true, ingestId, status: job.status, immediate: true };
    }

    // All other tiers: queue
    insertIntoQueue(job);
    return { ok: true, ingestId, status: "queued", queuePosition: _queue.indexOf(job) };
  } catch {
    return { ok: false, error: "submission_failed" };
  }
}

/**
 * Get the current ingest queue.
 *
 * @returns {object[]} Queue items with summary info
 */
export function getQueue() {
  try {
    return _queue.map((job, idx) => ({
      position: idx,
      ingestId: job.ingestId,
      url: job.url,
      tier: job.tier,
      priority: job.priority,
      status: job.status,
      submittedAt: job.submittedAt,
      userId: job.userId,
    }));
  } catch {
    return [];
  }
}

/**
 * Get status of a specific ingest job.
 *
 * @param {string} ingestId
 * @returns {object|null}
 */
export function getIngestStatus(ingestId) {
  try {
    const job = _jobs.get(ingestId);
    if (!job) return null;

    return {
      ingestId: job.ingestId,
      url: job.url,
      tier: job.tier,
      status: job.status,
      hostname: job.hostname,
      reliability: job.reliability,
      dtuId: job.dtuId,
      council: job.council,
      error: job.error,
      submittedAt: job.submittedAt,
      processingStartedAt: job.processingStartedAt,
      completedAt: job.completedAt,
      processingDurationMs: job.processingDurationMs,
      partialNovel: job.partialNovel || false,
    };
  } catch {
    return null;
  }
}

/**
 * Get aggregate ingest statistics.
 *
 * @returns {object}
 */
export function getIngestStats() {
  try {
    return {
      queueLength: _queue.length,
      totalJobs: _jobs.size,
      installedDTUs: _installedDTUs.length,
      contentHashes: _contentHashes.size,
      metrics: { ..._metrics },
      timestamp: nowISO(),
    };
  } catch {
    return { queueLength: 0, totalJobs: 0, installedDTUs: 0, contentHashes: 0, metrics: {}, timestamp: nowISO() };
  }
}

/**
 * Get the current domain allowlist.
 *
 * @returns {string[]}
 */
export function getAllowlist() {
  try {
    return [...DOMAIN_ALLOWLIST];
  } catch {
    return [];
  }
}

/**
 * Add a domain to the allowlist.
 *
 * @param {string} domain
 * @returns {{ ok: boolean }}
 */
export function addToAllowlist(domain) {
  try {
    const d = String(domain || "").toLowerCase().trim();
    if (!d) return { ok: false, error: "empty_domain" };
    DOMAIN_ALLOWLIST.add(d);
    return { ok: true, domain: d, allowlistSize: DOMAIN_ALLOWLIST.size };
  } catch {
    return { ok: false, error: "add_failed" };
  }
}

/**
 * Remove a domain from the allowlist.
 *
 * @param {string} domain
 * @returns {{ ok: boolean }}
 */
export function removeFromAllowlist(domain) {
  try {
    const d = String(domain || "").toLowerCase().trim();
    if (!d) return { ok: false, error: "empty_domain" };
    const existed = DOMAIN_ALLOWLIST.delete(d);
    return { ok: true, domain: d, removed: existed, allowlistSize: DOMAIN_ALLOWLIST.size };
  } catch {
    return { ok: false, error: "remove_failed" };
  }
}

/**
 * Add a domain to the blocklist.
 *
 * @param {string} domain
 * @returns {{ ok: boolean }}
 */
export function addToBlocklist(domain) {
  try {
    const d = String(domain || "").toLowerCase().trim();
    if (!d) return { ok: false, error: "empty_domain" };
    DOMAIN_BLOCKLIST.add(d);
    return { ok: true, domain: d, blocklistSize: DOMAIN_BLOCKLIST.size };
  } catch {
    return { ok: false, error: "add_failed" };
  }
}

/**
 * Flush the entire queue, processing all items.
 *
 * @returns {{ ok: boolean, processed: number, results: object[] }}
 */
export async function flushQueue() {
  try {
    const results = [];
    let processed = 0;

    while (_queue.length > 0) {
      const job = _queue.shift();
      if (job.status === "queued") {
        await processIngestJob(job);
        processed++;
      }
      results.push({
        ingestId: job.ingestId,
        url: job.url,
        status: job.status,
        dtuId: job.dtuId,
      });
    }

    return { ok: true, processed, results };
  } catch {
    return { ok: false, processed: 0, results: [] };
  }
}

/**
 * Process the next item in the queue.
 *
 * @returns {{ ok: boolean, job?: object, empty?: boolean }}
 */
export async function processNextItem() {
  try {
    if (_queue.length === 0) {
      return { ok: true, empty: true };
    }

    const job = _queue.shift();
    if (job.status === "queued") {
      await processIngestJob(job);
    }

    return {
      ok: true,
      job: {
        ingestId: job.ingestId,
        url: job.url,
        status: job.status,
        dtuId: job.dtuId,
        reliability: job.reliability,
        council: job.council ? { verdict: job.council.verdict, avgScore: job.council.avgScore } : null,
      },
    };
  } catch {
    return { ok: false, error: "process_failed" };
  }
}

/**
 * Get detailed ingest metrics including per-tier breakdowns.
 *
 * @returns {object}
 */
export function getIngestMetrics() {
  try {
    // Per-tier breakdown
    const byTier = {};
    for (const t of Object.values(TIERS)) {
      byTier[t] = { submitted: 0, installed: 0, rejected: 0, failed: 0 };
    }

    for (const job of _jobs.values()) {
      const tier = job.tier || TIERS.FREE;
      if (!byTier[tier]) byTier[tier] = { submitted: 0, installed: 0, rejected: 0, failed: 0 };
      byTier[tier].submitted++;
      if (job.status === "installed") byTier[tier].installed++;
      if (job.status === "council_rejected") byTier[tier].rejected++;
      if (job.status === "failed") byTier[tier].failed++;
    }

    // Per-status breakdown
    const byStatus = {};
    for (const job of _jobs.values()) {
      byStatus[job.status] = (byStatus[job.status] || 0) + 1;
    }

    // Rate limit status
    const rateLimits = {};
    for (const [userId, bucket] of _rateLimits) {
      rateLimits[userId] = { count: bucket.count, resetDate: bucket.resetDate };
    }

    // Average processing time
    let totalDuration = 0;
    let durationCount = 0;
    for (const job of _jobs.values()) {
      if (job.processingDurationMs) {
        totalDuration += job.processingDurationMs;
        durationCount++;
      }
    }

    return {
      totals: { ..._metrics },
      byTier,
      byStatus,
      rateLimits,
      avgProcessingMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
      queueLength: _queue.length,
      allowlistSize: DOMAIN_ALLOWLIST.size,
      blocklistSize: DOMAIN_BLOCKLIST.size,
      installedDTUs: _installedDTUs.length,
      contentHashCount: _contentHashes.size,
      timestamp: nowISO(),
    };
  } catch {
    return { totals: {}, byTier: {}, byStatus: {}, rateLimits: {}, timestamp: nowISO() };
  }
}
