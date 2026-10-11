/**
 * Foundation Intelligence — Three-Tier Intelligence Architecture
 *
 * Sovereign classifier and tiered intelligence pipeline for planetary
 * signal intelligence stewardship.
 *
 * Three tiers:
 *   Tier 1 — PUBLIC:    Weather, geology, energy, ocean, seismic, agriculture, environment.
 *                        Standard lattice DTUs. Full meta-derivation. Commercially licensable.
 *   Tier 2 — RESEARCH:  Cross-medium synthesis, historical archaeology, deep geological,
 *                        advanced atmospheric, marine deep. Governance-approved access only.
 *                        Lineage-tracked. Transfer-prohibited.
 *   Tier 3 — SOVEREIGN: Military, naval, nuclear, infrastructure vulnerability,
 *                        population behavioral, communication topology.
 *                        Isolated vault. No lattice. No API. No path.
 *
 * Sovereign Classifier:
 *   Runs BEFORE DTU creation. Raw signal → classifier → tier routing.
 *   Ambiguous data goes UP a tier, never down.
 *   Only Dutch can modify sovereign classification rules.
 *
 * Rules:
 *   1. Gate before data. Classifier must exist before deep listening begins.
 *   2. Sovereign vault has zero lattice connections. Zero edges. Zero references.
 *   3. Lineage tracking on all Tier 2 DTUs. Violations traceable to source.
 *   4. Public tier operates autonomously. Research requires governance + Dutch approval.
 *   5. Architecture enforces ethics. No export mechanism exists for sovereign data.
 */

import crypto from "crypto";

function uid(prefix = "intel") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, Number(v) || 0)); }

// ── Constants ───────────────────────────────────────────────────────────────

export const TIERS = Object.freeze({
  PUBLIC:    "PUBLIC",
  RESEARCH:  "RESEARCH",
  SOVEREIGN: "SOVEREIGN",
});

export const CLASSIFICATIONS = Object.freeze({
  OPEN:       "OPEN",
  RESTRICTED: "RESTRICTED",
  ABSOLUTE:   "ABSOLUTE",
});

export const PUBLIC_CATEGORIES = Object.freeze([
  "weather",
  "geology",
  "energy",
  "ocean",
  "seismic",
  "agriculture",
  "environment",
]);

export const RESEARCH_CATEGORIES = Object.freeze([
  "cross_medium_synthesis",
  "historical_archaeology",
  "deep_geological",
  "advanced_atmospheric",
  "marine_deep",
]);

export const SOVEREIGN_CATEGORIES = Object.freeze([
  "military_installation",
  "naval_movement",
  "nuclear_facility",
  "infrastructure_vulnerability",
  "population_behavioral",
  "communication_topology",
]);

// ── Sovereign Classifier Patterns ───────────────────────────────────────────

const SOVEREIGN_PATTERNS = Object.freeze({
  military_installation: {
    keywords: [
      "military", "defense", "base", "installation", "radar", "weapons",
      "armament", "garrison", "munitions", "barracks", "airfield",
    ],
    signalIndicators: [
      "high_power_radar", "encrypted_burst", "jamming_detected",
      "restricted_frequency", "military_band",
    ],
    energyThreshold: 10.0, // MW — unusually high for area
  },
  naval_movement: {
    keywords: [
      "submarine", "naval", "destroyer", "carrier", "warship",
      "fleet", "sonar", "torpedo", "depth_charge",
    ],
    signalIndicators: [
      "undersea_cable_disturbance", "acoustic_em_conversion",
      "vlf_communication", "elf_transmission",
    ],
  },
  nuclear_facility: {
    keywords: [
      "nuclear", "reactor", "enrichment", "centrifuge", "fission",
      "plutonium", "uranium", "isotope", "radiation",
    ],
    signalIndicators: [
      "high_baseload_constant", "radiation_artifact",
      "enrichment_signature", "cooling_system_harmonic",
    ],
    energyThreshold: 50.0, // MW — nuclear-scale constant load
  },
  infrastructure_vulnerability: {
    keywords: [
      "vulnerability", "exploit", "leakage", "unprotected",
      "exposure", "weakness", "backdoor", "unencrypted",
    ],
    signalIndicators: [
      "scada_unprotected", "control_system_exposed",
      "critical_infrastructure_leak", "unshielded_control",
    ],
  },
  population_behavioral: {
    keywords: [
      "population_tracking", "mass_surveillance", "behavioral_aggregate",
      "social_dynamics", "political_movement", "mass_profiling",
    ],
    signalIndicators: [
      "device_density_anomaly", "communication_pattern_mass",
      "behavioral_clustering", "movement_aggregate",
    ],
    minPopulationScale: 10000,
  },
  communication_topology: {
    keywords: [
      "government_network", "intelligence_agency", "classified_comm",
      "diplomatic_channel", "command_structure",
    ],
    signalIndicators: [
      "encrypted_topology", "multi_hop_classified",
      "government_band", "diplomatic_frequency",
    ],
  },
});

// ── Public regulatory documents: Tier 1 (Dutch decision, 2026-10-09) ────────
//
// Sovereign-rule change made by Dutch (the only person who may change these
// rules), 2026-10-09, relayed verbatim: "public NRC/IAEA documents and ConKay
// screening analyses are ordinary public (Tier 1) data, NOT the Tier 3
// sovereign vault".
//
// Deliberately narrow. The exemption lifts ONLY the `nuclear_facility`
// keyword score, and ONLY when the caller passes structured provenance
// (`signalData.publicSource`), never from free text. It does not apply if:
//   - the input is a plain string (no structured provenance possible);
//   - any `nuclear_facility` signal indicator matched (e.g. enrichment
//     signature, radiation artifact, cooling-system harmonic) or an
//     `energyLevel` is supplied — that is a sensed signal, not a document;
//   - any OTHER sovereign category scores at or above the sensitivity
//     threshold (military, naval, infrastructure vulnerability, ...);
//   - the source kind / locator / host does not match the allow-list below.
// Everything else the classifier protects is unchanged.

const PUBLIC_REGULATORY_HOSTS = Object.freeze([
  "nrc.gov", "ecfr.gov", "govinfo.gov", "federalregister.gov", "iaea.org",
]);

const PUBLIC_REGULATORY_SOURCES = Object.freeze({
  // NRC ADAMS accession number, e.g. ML25086A073
  "nrc-adams": { locator: /^ML\d{5}[A-Z]\d{3}$/, needsUrl: true },
  // NUREG series, e.g. NUREG-0800, NUREG-0492, NUREG/CR-6928
  "nureg": { locator: /^NUREG(\/(CR|BR|IA))?-\d{3,4}\b/, needsUrl: true },
  // Code of Federal Regulations, e.g. "10 CFR 50 Appendix A, Criterion 17"
  "cfr": { locator: /^\d{1,2} CFR \d+/, needsUrl: true },
  // IAEA Safety Standards Series, e.g. "SSR-2/1 (Rev. 1)", "SSG-2 (Rev. 1)"
  "iaea-safety-standard": { locator: /^(SF|GSR|SSR|GSG|SSG|NS-G|GS-G|RS-G|TS-G)-\d/, needsUrl: true },
  // ConKay screening analysis: identified by its receipt hash, produced
  // in-process (no URL)
  "conkay-screening-analysis": { locator: /^[0-9a-f]{64}$/, needsUrl: false },
});

function hostAllowed(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return PUBLIC_REGULATORY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * Returns { kind, locator } when the Dutch 2026-10-09 public-regulatory
 * exemption applies to this signal, otherwise null.
 */
export function publicRegulatoryExemption(signalData, perCategory, sensitivityThreshold) {
  if (!signalData || typeof signalData !== "object") return null;
  const src = signalData.publicSource;
  if (!src || typeof src !== "object") return null;
  const rule = PUBLIC_REGULATORY_SOURCES[src.kind];
  if (!rule) return null;
  if (typeof src.locator !== "string" || !rule.locator.test(src.locator)) return null;
  if (rule.needsUrl && (typeof src.url !== "string" || !hostAllowed(src.url))) return null;
  if (signalData.energyLevel !== undefined && signalData.energyLevel !== null) return null;
  const nuclear = perCategory.nuclear_facility;
  if (!nuclear || nuclear.indicatorMatches > 0) return null;
  for (const [category, r] of Object.entries(perCategory)) {
    if (category !== "nuclear_facility" && r.score >= sensitivityThreshold) return null;
  }
  return { kind: src.kind, locator: src.locator, decision: "Dutch 2026-10-09: public NRC/IAEA documents and ConKay screening analyses are Tier 1" };
}

// ── Research Sensitivity Patterns ───────────────────────────────────────────

const RESEARCH_PATTERNS = Object.freeze({
  cross_medium_synthesis: {
    keywords: ["cross-medium", "synthesis", "multi-signal", "correlation"],
    requiresMultiMedia: true,
  },
  historical_archaeology: {
    keywords: ["legacy", "historical", "archaeology", "decoded", "fossil"],
  },
  deep_geological: {
    keywords: ["aquifer", "mineral_deposit", "tectonic", "subsurface_detail"],
    precisionThreshold: 0.8,
  },
  advanced_atmospheric: {
    keywords: ["ionospheric", "space_weather", "upper_atmosphere", "solar_interaction"],
  },
  marine_deep: {
    keywords: ["ocean_floor", "deep_current", "thermal_vent", "submarine_geological"],
  },
});

// ── Module State ────────────────────────────────────────────────────────────

const _intelState = {
  initialized: false,
  classifierActive: false,

  // Sovereign vault — isolated, no lattice connection
  sovereignVault: {
    count: 0,
    categories: {},
    lastClassifiedAt: null,
    // Note: actual sovereign data is NOT stored in memory.
    // In production, this routes to an isolated system outside Concord.
    // Here we track metadata only — counts and timestamps.
  },

  // Research partition — restricted lattice
  researchPartition: {
    entries: [],
    accessGrants: new Map(), // researcherId → { granted, categories, agreement, expires }
    applications: new Map(), // applicationId → { researcher, status, submitted, reviewed }
  },

  // Public intelligence — standard lattice
  publicIntelligence: {
    weather: [],
    geology: [],
    energy: [],
    ocean: [],
    seismic: [],
    agriculture: [],
    environment: [],
  },

  // Classifier stats
  classifierStats: {
    totalClassified: 0,
    routedPublic: 0,
    routedResearch: 0,
    routedSovereign: 0,
    ambiguousUpgraded: 0,
    lastClassificationAt: null,
  },

  // Classification rules (sovereign rules modifiable only by Dutch)
  classifierRules: {
    sovereignPatterns: { ...SOVEREIGN_PATTERNS },
    researchPatterns: { ...RESEARCH_PATTERNS },
    sensitivityThreshold: 0.3,  // Score above this → research
    sovereignThreshold: 0.6,    // Score above this → sovereign
  },

  stats: {
    totalIntelDTUsCreated: 0,
    totalPublicDTUs: 0,
    totalResearchDTUs: 0,
    sovereignInterceptions: 0,
    researchApplications: 0,
    researchGranted: 0,
    researchDenied: 0,
    lastIntelAt: null,
    uptime: Date.now(),
  },
};

// ── Sovereign Classifier ────────────────────────────────────────────────────

/**
 * Classify raw signal data into a tier BEFORE DTU creation.
 * This is the gate. It must run before anything enters the lattice.
 *
 * Returns: { tier, category, confidence, sovereignMatch, researchMatch }
 */
export function classifySignal(signalData) {
  if (!signalData) return { tier: TIERS.PUBLIC, category: "unknown", confidence: 0, sovereignMatch: false, researchMatch: false };

  const text = typeof signalData === "string" ? signalData : JSON.stringify(signalData);
  const textLower = text.toLowerCase().replace(/_/g, " ");

  // Phase 1: Check sovereign patterns first (most restrictive)
  let maxSovereignScore = 0;
  let sovereignCategory = null;
  const perCategory = {};

  for (const [category, pattern] of Object.entries(SOVEREIGN_PATTERNS)) {
    let score = 0;
    let matches = 0;
    let indicatorMatches = 0;

    // Keyword matching (normalize underscores to spaces for comparison)
    for (const kw of pattern.keywords) {
      const kwNormalized = kw.toLowerCase().replace(/_/g, " ");
      if (textLower.includes(kwNormalized)) {
        matches++;
        score += 0.15;
      }
    }

    // Signal indicator matching (normalize underscores to spaces)
    if (pattern.signalIndicators) {
      for (const indicator of pattern.signalIndicators) {
        const indNormalized = indicator.toLowerCase().replace(/_/g, " ");
        if (textLower.includes(indNormalized)) {
          matches++;
          indicatorMatches++;
          score += 0.25;
        }
      }
    }

    // Energy threshold check
    if (pattern.energyThreshold && signalData.energyLevel) {
      if (signalData.energyLevel >= pattern.energyThreshold) {
        score += 0.3;
      }
    }

    // Population scale check
    if (pattern.minPopulationScale && signalData.populationScale) {
      if (signalData.populationScale >= pattern.minPopulationScale) {
        score += 0.3;
      }
    }

    score = clamp(score, 0, 1);
    perCategory[category] = { score, indicatorMatches };
    if (score > maxSovereignScore) {
      maxSovereignScore = score;
      sovereignCategory = category;
    }
  }

  // Phase 1b: Dutch 2026-10-09 public-regulatory exemption (see
  // publicRegulatoryExemption above). Lifts only the nuclear_facility score.
  const publicExemption = publicRegulatoryExemption(signalData, perCategory, _intelState.classifierRules.sensitivityThreshold);
  if (publicExemption) {
    maxSovereignScore = 0;
    sovereignCategory = null;
    for (const [category, r] of Object.entries(perCategory)) {
      if (category === "nuclear_facility") continue;
      if (r.score > maxSovereignScore) {
        maxSovereignScore = r.score;
        sovereignCategory = category;
      }
    }
  }

  // Phase 2: Check research patterns
  let maxResearchScore = 0;
  let researchCategory = null;

  for (const [category, pattern] of Object.entries(RESEARCH_PATTERNS)) {
    let score = 0;

    for (const kw of pattern.keywords) {
      const kwNormalized = kw.toLowerCase().replace(/_/g, " ");
      if (textLower.includes(kwNormalized)) {
        score += 0.2;
      }
    }

    if (pattern.requiresMultiMedia && signalData.mediaCount && signalData.mediaCount >= 2) {
      score += 0.3;
    }

    if (pattern.precisionThreshold && signalData.precision) {
      if (signalData.precision >= pattern.precisionThreshold) {
        score += 0.25;
      }
    }

    score = clamp(score, 0, 1);
    if (score > maxResearchScore) {
      maxResearchScore = score;
      researchCategory = category;
    }
  }

  // Phase 3: Classification decision — ambiguous goes UP, never down
  const threshold = _intelState.classifierRules;
  let tier, category, confidence;
  let sovereignMatch = false;
  let researchMatch = false;
  let upgraded = false;

  if (maxSovereignScore >= threshold.sovereignThreshold) {
    tier = TIERS.SOVEREIGN;
    category = sovereignCategory;
    confidence = maxSovereignScore;
    sovereignMatch = true;
  } else if (maxSovereignScore >= threshold.sensitivityThreshold) {
    // Ambiguous — might be sovereign. Err on the side of caution: upgrade to sovereign
    tier = TIERS.SOVEREIGN;
    category = sovereignCategory;
    confidence = maxSovereignScore;
    sovereignMatch = true;
    upgraded = true;
  } else if (maxResearchScore >= threshold.sensitivityThreshold) {
    tier = TIERS.RESEARCH;
    category = researchCategory;
    confidence = maxResearchScore;
    researchMatch = true;
  } else {
    // Determine public category from content
    tier = TIERS.PUBLIC;
    category = detectPublicCategory(signalData, textLower);
    confidence = 1.0 - Math.max(maxSovereignScore, maxResearchScore);
  }

  // Update stats
  _intelState.classifierStats.totalClassified++;
  _intelState.classifierStats.lastClassificationAt = nowISO();

  if (tier === TIERS.SOVEREIGN) {
    _intelState.classifierStats.routedSovereign++;
    if (upgraded) _intelState.classifierStats.ambiguousUpgraded++;
  } else if (tier === TIERS.RESEARCH) {
    _intelState.classifierStats.routedResearch++;
  } else {
    _intelState.classifierStats.routedPublic++;
  }

  const result = { tier, category, confidence, sovereignMatch, researchMatch, upgraded };
  if (publicExemption) result.publicRegulatoryExemption = publicExemption;
  return result;
}

function detectPublicCategory(signalData, textLower) {
  const categoryHints = {
    weather:     ["weather", "temperature", "pressure", "humidity", "storm", "atmospheric", "precipitation", "wind"],
    geology:     ["geology", "subsurface", "mineral", "soil", "terrain", "rock", "sediment", "geological"],
    energy:      ["energy", "grid", "power", "load", "renewable", "solar", "wind_power", "consumption", "harmonic"],
    ocean:       ["ocean", "sea", "marine", "tide", "current", "wave", "coastal", "undersea"],
    seismic:     ["seismic", "earthquake", "tectonic", "volcanic", "tremor", "fault"],
    agriculture: ["agriculture", "crop", "soil_moisture", "irrigation", "harvest", "farming"],
    environment: ["environment", "deforestation", "urbanization", "pollution", "biodiversity", "ecosystem"],
  };

  let bestCategory = "weather"; // default
  let bestScore = 0;

  for (const [cat, hints] of Object.entries(categoryHints)) {
    let score = 0;
    for (const hint of hints) {
      if (textLower.includes(hint)) score++;
    }
    // Also check signalData.category if present
    if (signalData.category === cat) score += 5;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat;
    }
  }

  return bestCategory;
}

// ── Tier Routing ────────────────────────────────────────────────────────────

/**
 * Route classified intelligence to appropriate tier.
 * Sovereign data is quarantined — no DTU created, no lattice entry.
 * Research data enters restricted partition with lineage.
 * Public data becomes a standard lattice DTU.
 */
export function routeIntelligence(signalData, classification) {
  if (!classification) return null;

  const now = nowISO();

  if (classification.tier === TIERS.SOVEREIGN) {
    // SOVEREIGN: No DTU created. No lattice entry. Metadata only.
    _intelState.sovereignVault.count++;
    _intelState.sovereignVault.lastClassifiedAt = now;
    const cat = classification.category || "unknown";
    _intelState.sovereignVault.categories[cat] = (_intelState.sovereignVault.categories[cat] || 0) + 1;
    _intelState.stats.sovereignInterceptions++;

    return {
      routed: true,
      tier: TIERS.SOVEREIGN,
      category: classification.category,
      dtuCreated: false,
      latticeEntry: false,
      message: "Sovereign quarantine. No DTU created. No lattice trace.",
    };
  }

  if (classification.tier === TIERS.RESEARCH) {
    const dtu = createResearchDTU(signalData, classification);
    _intelState.researchPartition.entries.push(dtu);
    if (_intelState.researchPartition.entries.length > 1000) {
      _intelState.researchPartition.entries = _intelState.researchPartition.entries.slice(-800);
    }
    return {
      routed: true,
      tier: TIERS.RESEARCH,
      category: classification.category,
      dtuCreated: true,
      latticeEntry: true,
      partition: "restricted",
      dtu,
    };
  }

  // PUBLIC
  const dtu = createPublicDTU(signalData, classification);
  const cat = classification.category || "weather";
  if (_intelState.publicIntelligence[cat]) {
    _intelState.publicIntelligence[cat].push(dtu);
    if (_intelState.publicIntelligence[cat].length > 500) {
      _intelState.publicIntelligence[cat] = _intelState.publicIntelligence[cat].slice(-400);
    }
  }
  return {
    routed: true,
    tier: TIERS.PUBLIC,
    category: classification.category,
    dtuCreated: true,
    latticeEntry: true,
    partition: "standard",
    dtu,
  };
}

// ── DTU Creation ────────────────────────────────────────────────────────────

export function createPublicDTU(signalData, classification) {
  const id = uid("pub_intel");
  const now = nowISO();

  const dtu = {
    id,
    type: "FOUNDATION_INTEL",
    tier: TIERS.PUBLIC,
    category: classification.category || "weather",
    classification: CLASSIFICATIONS.OPEN,
    created: now,
    source: "foundation-intelligence",
    data: {
      summary: signalData.summary || null,
      measurements: signalData.measurements || {},
      derived: signalData.derived || {},
    },
    confidence: clamp(classification.confidence || 0.5, 0, 1),
    sources: signalData.sources || 1,
    coverage_area: signalData.coverageArea || { center: { lat: 0, lng: 0 }, radius_km: 100 },
    temporal_range: {
      start: signalData.temporalStart || now,
      end: signalData.temporalEnd || now,
    },
    update_frequency: signalData.updateFrequency || "continuous",
    commercially_licensable: true,
    tags: ["foundation", "intelligence", "public", classification.category || "weather"],
    scope: "global",
  };

  _intelState.stats.totalIntelDTUsCreated++;
  _intelState.stats.totalPublicDTUs++;
  _intelState.stats.lastIntelAt = now;

  return dtu;
}

export function createResearchDTU(signalData, classification) {
  const id = uid("res_intel");
  const now = nowISO();

  const dtu = {
    id,
    type: "FOUNDATION_INTEL",
    tier: TIERS.RESEARCH,
    category: classification.category || "cross_medium_synthesis",
    classification: CLASSIFICATIONS.RESTRICTED,
    access_required: "governance_approved",
    usage_agreement: "no_weaponization_no_resale_no_transfer",
    created: now,
    source: "foundation-intelligence",
    data: {
      summary: signalData.summary || null,
      measurements: signalData.measurements || {},
      derived: signalData.derived || {},
      methodology: signalData.methodology || "foundation_extraction",
    },
    confidence: clamp(classification.confidence || 0.5, 0, 1),
    methodology: signalData.methodology || "foundation_extraction",
    lineage_tracking: "enforced",
    transfer_prohibited: true,
    tags: ["foundation", "intelligence", "research", classification.category || "research"],
    scope: "restricted",
  };

  _intelState.stats.totalIntelDTUsCreated++;
  _intelState.stats.totalResearchDTUs++;
  _intelState.stats.lastIntelAt = now;

  return dtu;
}

// ── Full Classification Pipeline ────────────────────────────────────────────

/**
 * Complete pipeline: classify → route → return result.
 * This is the main entry point for incoming signal data.
 */
export function processSignalIntelligence(signalData) {
  if (!_intelState.classifierActive) {
    return { ok: false, error: "classifier_not_active", message: "Sovereign classifier must be active before processing" };
  }
  if (!signalData) {
    return { ok: false, error: "no_signal_data" };
  }

  const classification = classifySignal(signalData);
  const routing = routeIntelligence(signalData, classification);

  return {
    ok: true,
    classification,
    routing,
  };
}

// ── Research Access Management ──────────────────────────────────────────────

export function submitResearchApplication(researcherId, institution, purpose, categories) {
  const id = uid("research_app");
  const now = nowISO();

  const application = {
    id,
    researcherId: researcherId || "anonymous",
    institution: institution || "unknown",
    purpose: purpose || "",
    requestedCategories: categories || [],
    status: "pending",
    submitted: now,
    reviewed: null,
    reviewedBy: null,
    decision: null,
  };

  _intelState.researchPartition.applications.set(id, application);
  _intelState.stats.researchApplications++;

  return { ok: true, applicationId: id, status: "pending" };
}

export function reviewResearchApplication(applicationId, approved, reviewedBy) {
  const app = _intelState.researchPartition.applications.get(applicationId);
  if (!app) return { ok: false, error: "application_not_found" };
  if (app.status !== "pending") return { ok: false, error: "already_reviewed" };

  app.status = approved ? "approved" : "denied";
  app.reviewed = nowISO();
  app.reviewedBy = reviewedBy || "governance";
  app.decision = approved ? "granted" : "denied";

  if (approved) {
    _intelState.stats.researchGranted++;
    // Grant access
    _intelState.researchPartition.accessGrants.set(app.researcherId, {
      granted: nowISO(),
      categories: app.requestedCategories,
      agreement: "no_weaponization_no_resale_no_transfer",
      expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      applicationId,
    });
  } else {
    _intelState.stats.researchDenied++;
  }

  return { ok: true, applicationId, status: app.status };
}

export function getResearchApplicationStatus(applicationId) {
  const app = _intelState.researchPartition.applications.get(applicationId);
  if (!app) return { ok: false, error: "application_not_found" };
  return { ok: true, application: { ...app } };
}

export function hasResearchAccess(researcherId, category) {
  const grant = _intelState.researchPartition.accessGrants.get(researcherId);
  if (!grant) return false;

  // Check expiry
  if (new Date(grant.expires) < new Date()) {
    _intelState.researchPartition.accessGrants.delete(researcherId);
    return false;
  }

  // Check category access
  if (category && grant.categories.length > 0) {
    return grant.categories.includes(category);
  }

  return true;
}

export function revokeResearchAccess(researcherId) {
  const existed = _intelState.researchPartition.accessGrants.has(researcherId);
  _intelState.researchPartition.accessGrants.delete(researcherId);
  return { ok: true, revoked: existed };
}

// ── Public Intelligence Retrieval ───────────────────────────────────────────

export function getPublicIntelligence(category, limit = 50) {
  if (!PUBLIC_CATEGORIES.includes(category)) {
    return { ok: false, error: "invalid_category", validCategories: PUBLIC_CATEGORIES };
  }

  const entries = _intelState.publicIntelligence[category] || [];
  const recent = entries.slice(-Math.min(limit, 200));

  return {
    ok: true,
    tier: TIERS.PUBLIC,
    category,
    count: recent.length,
    total: entries.length,
    data: recent,
  };
}

export function getAllPublicCategories() {
  const summary = {};
  for (const cat of PUBLIC_CATEGORIES) {
    summary[cat] = {
      count: (_intelState.publicIntelligence[cat] || []).length,
      latest: (_intelState.publicIntelligence[cat] || []).slice(-1)[0] || null,
    };
  }
  return { ok: true, categories: summary };
}

// ── Research Intelligence Retrieval ─────────────────────────────────────────

export function getResearchIntelligence(researcherId, category, limit = 50) {
  if (!hasResearchAccess(researcherId, category)) {
    return { ok: false, error: "access_denied", message: "Governance-approved access required" };
  }

  let entries = _intelState.researchPartition.entries;
  if (category) {
    entries = entries.filter(e => e.category === category);
  }

  const recent = entries.slice(-Math.min(limit, 200));

  return {
    ok: true,
    tier: TIERS.RESEARCH,
    category: category || "all",
    count: recent.length,
    researcherId,
    lineage_tracking: "enforced",
    data: recent,
  };
}

export function getResearchSynthesis(researcherId, limit = 50) {
  return getResearchIntelligence(researcherId, "cross_medium_synthesis", limit);
}

export function getResearchArchive(researcherId, limit = 50) {
  return getResearchIntelligence(researcherId, "historical_archaeology", limit);
}

// ── Sovereign Vault Metadata (counts only — no data) ────────────────────────

export function getSovereignVaultStatus() {
  return {
    exists: true,
    isolated: true,
    latticeConnected: false,
    apiAccessible: false,
    count: _intelState.sovereignVault.count,
    categories: { ..._intelState.sovereignVault.categories },
    lastClassifiedAt: _intelState.sovereignVault.lastClassifiedAt,
    message: "Sovereign vault metadata only. No data accessible through any API.",
  };
}

// ── Classifier Management ───────────────────────────────────────────────────

export function getClassifierStatus() {
  return {
    active: _intelState.classifierActive,
    stats: { ..._intelState.classifierStats },
    thresholds: {
      sensitivity: _intelState.classifierRules.sensitivityThreshold,
      sovereign: _intelState.classifierRules.sovereignThreshold,
    },
    sovereignCategories: SOVEREIGN_CATEGORIES,
    researchCategories: RESEARCH_CATEGORIES,
    publicCategories: PUBLIC_CATEGORIES,
  };
}

export function updateClassifierThresholds(sensitivityThreshold, sovereignThreshold) {
  if (sensitivityThreshold !== undefined) {
    _intelState.classifierRules.sensitivityThreshold = clamp(sensitivityThreshold, 0.1, 0.9);
  }
  if (sovereignThreshold !== undefined) {
    _intelState.classifierRules.sovereignThreshold = clamp(sovereignThreshold, 0.2, 1.0);
  }
  return {
    ok: true,
    sensitivity: _intelState.classifierRules.sensitivityThreshold,
    sovereign: _intelState.classifierRules.sovereignThreshold,
  };
}

// ── Chat Intent Detection ───────────────────────────────────────────────────

export function detectIntelIntent(prompt) {
  if (!prompt || typeof prompt !== "string") {
    return { isIntelRequest: false };
  }

  const p = prompt.toLowerCase().trim();

  // Weather
  if (/\b(weather|temperature|pressure|humidity|storm|forecast|atmospheric)\b/.test(p) &&
      /\b(intel|intelligence|foundation|signal|data|monitor|reading)\b/.test(p)) {
    return { isIntelRequest: true, action: "weather", params: {} };
  }

  // Geology
  if (/\b(geolog|subsurface|mineral|terrain|soil\s*composition|geological\s*survey)\b/.test(p)) {
    return { isIntelRequest: true, action: "geology", params: {} };
  }

  // Energy
  if (/\b(energy\s*(intel|intelligence|distribution|grid|map)|power\s*grid\s*intel)\b/.test(p)) {
    return { isIntelRequest: true, action: "energy", params: {} };
  }

  // Ocean
  if (/\b(ocean|marine|sea\s*state|undersea|coastal)\b/.test(p) &&
      /\b(intel|intelligence|monitor|data|reading)\b/.test(p)) {
    return { isIntelRequest: true, action: "ocean", params: {} };
  }

  // Seismic
  if (/\b(seismic|earthquake|tectonic|volcanic|tremor)\b/.test(p)) {
    return { isIntelRequest: true, action: "seismic", params: {} };
  }

  // Agriculture
  if (/\b(agricultur\w*|crop|farming|irrigation|harvest|soil\s*moisture)\b/.test(p)) {
    return { isIntelRequest: true, action: "agriculture", params: {} };
  }

  // Environment
  if (/\b(environment|deforestation|urbanization|pollution|biodiversity|ecosystem)\b/.test(p) &&
      /\b(intel|intelligence|assessment|data|monitor)\b/.test(p)) {
    return { isIntelRequest: true, action: "environment", params: {} };
  }

  // Intelligence status / classifier
  if (/\b(intelligence|intel)\s*(status|classifier|tier|classification)\b/.test(p) ||
      /\b(classifier|classification)\s*(status|active|stats)\b/.test(p)) {
    return { isIntelRequest: true, action: "classifier_status", params: {} };
  }

  // Research access
  if (/\b(research)\s*(access|apply|application|status|data|partition)\b/.test(p)) {
    return { isIntelRequest: true, action: "research_status", params: {} };
  }

  // Sovereign vault (metadata only)
  if (/\b(sovereign)\s*(vault|status|intelligence|quarantine)\b/.test(p)) {
    return { isIntelRequest: true, action: "sovereign_status", params: {} };
  }

  return { isIntelRequest: false };
}

// ── Metrics ─────────────────────────────────────────────────────────────────

export function getIntelligenceMetrics() {
  const publicCounts = {};
  for (const cat of PUBLIC_CATEGORIES) {
    publicCounts[cat] = (_intelState.publicIntelligence[cat] || []).length;
  }

  return {
    initialized: _intelState.initialized,
    classifierActive: _intelState.classifierActive,
    classifier: { ..._intelState.classifierStats },
    tiers: {
      public: {
        categories: publicCounts,
        totalDTUs: _intelState.stats.totalPublicDTUs,
      },
      research: {
        entries: _intelState.researchPartition.entries.length,
        activeGrants: _intelState.researchPartition.accessGrants.size,
        pendingApplications: [..._intelState.researchPartition.applications.values()]
          .filter(a => a.status === "pending").length,
        totalDTUs: _intelState.stats.totalResearchDTUs,
      },
      sovereign: {
        count: _intelState.sovereignVault.count,
        categories: { ..._intelState.sovereignVault.categories },
        isolated: true,
        apiAccessible: false,
      },
    },
    stats: { ..._intelState.stats },
    uptime: Date.now() - _intelState.stats.uptime,
  };
}

// ── Heartbeat ───────────────────────────────────────────────────────────────

export async function intelligenceHeartbeatTick(STATE, tick) {
  // Clean expired research access grants
  const now = new Date();
  for (const [researcherId, grant] of _intelState.researchPartition.accessGrants) {
    if (new Date(grant.expires) < now) {
      _intelState.researchPartition.accessGrants.delete(researcherId);
    }
  }

  // Clean old applications (keep last 500)
  if (_intelState.researchPartition.applications.size > 500) {
    const entries = [..._intelState.researchPartition.applications.entries()];
    const toRemove = entries.slice(0, entries.length - 400);
    for (const [key] of toRemove) {
      _intelState.researchPartition.applications.delete(key);
    }
  }
}

// ── Initialization ──────────────────────────────────────────────────────────

export async function initializeIntelligence(STATE) {
  if (_intelState.initialized) return { ok: true, alreadyInitialized: true };

  _intelState.initialized = true;
  _intelState.classifierActive = true;
  _intelState.stats.uptime = Date.now();

  return {
    ok: true,
    classifierActive: true,
    tiers: [TIERS.PUBLIC, TIERS.RESEARCH, TIERS.SOVEREIGN],
    publicCategories: PUBLIC_CATEGORIES,
    researchCategories: RESEARCH_CATEGORIES,
    sovereignCategories: SOVEREIGN_CATEGORIES.length, // Count only — don't expose categories
    message: "Foundation Intelligence initialized. Sovereign classifier active. Gate before data.",
  };
}

// ── State Reset (testing only) ──────────────────────────────────────────────

export function _resetIntelligenceState() {
  _intelState.initialized = false;
  _intelState.classifierActive = false;
  _intelState.sovereignVault = { count: 0, categories: {}, lastClassifiedAt: null };
  _intelState.researchPartition = {
    entries: [],
    accessGrants: new Map(),
    applications: new Map(),
  };
  _intelState.publicIntelligence = {
    weather: [], geology: [], energy: [], ocean: [],
    seismic: [], agriculture: [], environment: [],
  };
  _intelState.classifierStats = {
    totalClassified: 0, routedPublic: 0, routedResearch: 0,
    routedSovereign: 0, ambiguousUpgraded: 0, lastClassificationAt: null,
  };
  _intelState.classifierRules = {
    sovereignPatterns: { ...SOVEREIGN_PATTERNS },
    researchPatterns: { ...RESEARCH_PATTERNS },
    sensitivityThreshold: 0.3,
    sovereignThreshold: 0.6,
  };
  _intelState.stats = {
    totalIntelDTUsCreated: 0, totalPublicDTUs: 0, totalResearchDTUs: 0,
    sovereignInterceptions: 0, researchApplications: 0, researchGranted: 0,
    researchDenied: 0, lastIntelAt: null, uptime: Date.now(),
  };
}
