/**
 * Creative Artifact Marketplace Constants — Federation v1.2
 *
 * Core Principle: Creators Keep IP. Always. Only Usage Rights Are Sold.
 *
 * This file defines all constants for the creative artifact marketplace:
 *   - Creator rights (constitutional immutable tier)
 *   - Artifact types with supported extensions and derivative types
 *   - Creative federation tiers (local/regional/national/global)
 *   - Creative quests per tier (XP + badges only, no coin rewards)
 *   - Creative leaderboard categories
 *   - Marketplace filter extensions
 *   - Fee and royalty cascade constants
 *   - Quest reward policy (constitutional: no coin rewards ever)
 */

// ═══════════════════════════════════════════════════════════════════════════
// QUEST REWARD POLICY — Constitutional invariant
// Quests reward XP and badges ONLY. Coins come from marketplace sales.
// ═══════════════════════════════════════════════════════════════════════════

export const QUEST_REWARD_POLICY = Object.freeze({
  allowed: ["xp", "badges", "titles", "leaderboard_multipliers"],
  forbidden: ["concord_coin", "direct_payments", "treasury_disbursements"],
  rule: "Concord Coin is only minted against real USD. "
    + "No coin is ever created as a reward, bonus, or incentive. "
    + "Users earn coins by selling on marketplace. Period.",
});

// ═══════════════════════════════════════════════════════════════════════════
// IMMUTABLE TIER — Constitutional invariant
// ═══════════════════════════════════════════════════════════════════════════

export const CREATOR_RIGHTS = Object.freeze({
  ownershipTransfer: "FORBIDDEN",
  saleType: "usage_license",

  creatorRetains: [
    "full_intellectual_property",
    "right_to_resell",
    "right_to_revoke_future_licenses",
    "right_to_derivative_royalties",
    "attribution_in_perpetuity",
  ],

  buyerReceives: [
    "usage_rights_as_defined_in_license",
    "right_to_create_derivatives",
    "right_to_display",
    "right_to_incorporate",
  ],

  buyerDoesNotReceive: [
    "ownership",
    "exclusive_rights",
    "right_to_resell_original",
    "right_to_claim_authorship",
  ],
});

// ═══════════════════════════════════════════════════════════════════════════
// ARTIFACT TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const ARTIFACT_TYPES = Object.freeze({
  // Audio
  music_track: {
    extensions: [".mp3", ".wav", ".flac", ".aac", ".ogg"],
    maxSizeMB: 500,
    derivativeTypes: ["remix", "sample", "feature", "cover", "mashup"],
  },
  beat: {
    extensions: [".mp3", ".wav", ".flac"],
    maxSizeMB: 200,
    derivativeTypes: ["remix", "song_over_beat", "sample", "chop"],
  },
  sound_effect: {
    extensions: [".mp3", ".wav", ".ogg"],
    maxSizeMB: 50,
    derivativeTypes: ["incorporation", "remix", "layer"],
  },
  podcast_episode: {
    extensions: [".mp3", ".wav"],
    maxSizeMB: 1000,
    derivativeTypes: ["clip", "response_episode", "translation"],
  },

  // Visual
  image: {
    extensions: [".png", ".jpg", ".jpeg", ".webp", ".tiff", ".svg"],
    maxSizeMB: 100,
    derivativeTypes: ["edit", "texture_use", "collage", "reference", "composite"],
  },
  animation: {
    extensions: [".gif", ".mp4", ".webm"],
    maxSizeMB: 500,
    derivativeTypes: ["edit", "incorporation", "remix", "loop_variation"],
  },
  threed_model: {
    extensions: [".obj", ".fbx", ".gltf", ".glb", ".stl"],
    maxSizeMB: 500,
    derivativeTypes: ["modification", "scene_incorporation", "remix", "print"],
  },

  // Video
  video: {
    extensions: [".mp4", ".mov", ".webm", ".mkv"],
    maxSizeMB: 5000,
    derivativeTypes: [
      "edit", "clip", "remix", "reaction", "subtitle", "dub",
      "re-cut", "commentary-overlay", "mashup", "soundtrack-replacement",
      "translation-dub", "accessibility-enhancement", "parody-comedy",
      "educational-analysis", "vfx-enhancement", "alternate-ending", "highlight-reel",
    ],
  },

  // Written
  document: {
    extensions: [".pdf", ".md", ".txt", ".docx"],
    maxSizeMB: 100,
    derivativeTypes: ["translation", "adaptation", "annotation", "expansion"],
  },
  code: {
    extensions: [".js", ".py", ".rs", ".go", ".ts", ".jsx", ".vue", ".c", ".cpp"],
    maxSizeMB: 50,
    derivativeTypes: ["fork", "module_use", "adaptation", "port"],
  },

  // Design
  font: {
    extensions: [".ttf", ".otf", ".woff", ".woff2"],
    maxSizeMB: 50,
    derivativeTypes: ["modification", "weight_variation", "incorporation"],
  },
  template: {
    extensions: [".psd", ".ai", ".fig", ".sketch", ".xd"],
    maxSizeMB: 500,
    derivativeTypes: ["customization", "adaptation", "component_extraction"],
  },

  // Data
  dataset: {
    extensions: [".csv", ".json", ".parquet", ".sqlite"],
    maxSizeMB: 2000,
    derivativeTypes: ["subset", "enrichment", "analysis", "visualization"],
  },

  // Condensed Knowledge
  condensed: {
    extensions: [".json"],
    maxSizeMB: 50,
    derivativeTypes: ["expansion", "translation", "cross_domain_bridge", "mega_inclusion"],
  },

  // ── Concordia v2.0 personal recipe artifacts ─────────────────────────
  // These are virtual artifacts: the "file" is the DTU's serialized recipe
  // data, persisted as a synthetic dtu:// path by personal-locker
  // list-on-marketplace. Buyers receive a license that surfaces the recipe
  // in their hotbar / crafting bench.
  fighting_style_recipe: {
    extensions: [".json"],
    maxSizeMB: 1,
    virtual: true,
    derivativeTypes: ["variant", "stance_shift", "expansion", "fusion"],
  },
  spell_recipe: {
    extensions: [".json"],
    maxSizeMB: 1,
    virtual: true,
    derivativeTypes: ["variant", "scaling", "elemental_shift", "fusion"],
  },
  blueprint: {
    extensions: [".json"],
    maxSizeMB: 5,
    virtual: true,
    derivativeTypes: ["modification", "scale_variant", "material_swap", "fusion"],
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATIVE FEDERATION — Same four tiers
// ═══════════════════════════════════════════════════════════════════════════

export const CREATIVE_FEDERATION = Object.freeze({
  local: {
    visibility: "creator_only",
    marketplace: false,
    heartbeatMs: 15000,
  },

  regional: {
    visibility: "regional_users_and_entities",
    marketplace: true,
    emergentPurchasing: "regional_only",
    qualityGate: {
      councilRequired: false,
      dedupCheck: true,
      minDescriptionLength: 50,
      previewRequired: true,
    },
    promotionToNational: {
      minPurchases: 10,
      minDerivatives: 2,
      minRating: 3.5,
      minAgeHours: 72,
      regionalCouncilApproval: true,
    },
    heartbeatMs: 30000,
    discoveryFeatures: {
      localArtistSpotlight: true,
      newReleaseFeed: true,
      genreBrowse: true,
      nearbyCreators: true,
    },
  },

  national: {
    visibility: "national_users_and_entities",
    marketplace: true,
    emergentPurchasing: "national_then_regional",
    qualityGate: {
      councilRequired: true,
      councilVotes: 3,
      dedupCheck: true,
      minRegionalSales: 10,
      minRegionalDerivatives: 2,
    },
    promotionToGlobal: {
      minPurchases: 100,
      minDerivatives: 10,
      minCrossRegionalPresence: 3,
      minRating: 4.0,
      minAgeDays: 30,
      nationalCouncilApproval: true,
      globalCouncilReview: true,
    },
    heartbeatMs: 60000,
    discoveryFeatures: {
      nationalArtistSpotlight: true,
      trendingNational: true,
      crossRegionalHits: true,
      nationalGenreCharts: true,
    },
  },

  global: {
    visibility: "all_users_and_entities",
    marketplace: true,
    emergentPurchasing: "global_fallback",
    qualityGate: {
      councilRequired: true,
      councilVotes: 5,
      dedupCheck: true,
      minNationalSales: 100,
      minCrossNationalPresence: 3,
      minDerivatives: 10,
      minRating: 4.5,
    },
    heartbeatMs: 120000,
    discoveryFeatures: {
      globalArtistSpotlight: true,
      civilizationCharts: true,
      crossCulturalCollaborations: true,
      globalGenreEvolution: true,
    },
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATIVE QUESTS PER TIER — XP and badges ONLY (no coin rewards)
// ═══════════════════════════════════════════════════════════════════════════

export const CREATIVE_QUESTS = Object.freeze({
  regional: [
    {
      id: "first_artifact",
      name: "First Release",
      description: "Publish your first creative artifact to the regional marketplace",
      xpReward: 75,
      badge: "regional_artist",
    },
    {
      id: "first_derivative_received",
      name: "Inspiration",
      description: "Someone created a derivative work from your artifact",
      xpReward: 150,
      badge: "regional_inspiration",
    },
    {
      id: "ten_sales",
      name: "Local Favorite",
      description: "Reach 10 sales on the regional marketplace",
      xpReward: 200,
      badge: "local_favorite",
    },
    {
      id: "cross_type_collab",
      name: "Cross-Medium",
      description: "Have your artifact used as a derivative in a different artifact type",
      xpReward: 300,
      badge: "cross_medium_creator",
    },
    {
      id: "promoted_to_national",
      name: "National Stage",
      description: "Get an artifact promoted to the national marketplace",
      xpReward: 500,
      badge: "nationally_featured_artist",
    },
  ],

  national: [
    {
      id: "cross_regional_hit",
      name: "Cross-Regional Hit",
      description: "Artifact purchased by buyers in 3+ regions",
      xpReward: 500,
      badge: "cross_regional_artist",
    },
    {
      id: "cascade_depth_5",
      name: "Deep Roots",
      description: "Your artifact spawned a derivative chain 5 generations deep",
      xpReward: 1000,
      badge: "deep_roots",
    },
    {
      id: "hundred_sales_national",
      name: "National Sensation",
      description: "100 sales at national tier",
      xpReward: 2000,
      badge: "national_sensation",
    },
    {
      id: "promoted_to_global",
      name: "Global Stage",
      description: "Artifact promoted to global marketplace",
      xpReward: 5000,
      badge: "globally_featured_artist",
    },
  ],

  global: [
    {
      id: "cross_national_hit",
      name: "Worldwide",
      description: "Artifact purchased across 5+ nations",
      xpReward: 5000,
      badge: "worldwide_artist",
    },
    {
      id: "cascade_depth_10",
      name: "Living Legacy",
      description: "Derivative chain 10 generations deep across multiple nations",
      xpReward: 10000,
      badge: "living_legacy",
    },
    {
      id: "emergent_derivative",
      name: "Cross-Species Collaboration",
      description: "An emergent entity created a derivative of your work",
      xpReward: 3000,
      badge: "cross_species_collaborator",
    },
    {
      id: "civilization_artifact",
      name: "Civilization Artifact",
      description: "Your work was incorporated into a HYPER consolidation",
      xpReward: 25000,
      badge: "civilization_artifact",
    },
  ],
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATIVE LEADERBOARD CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════

export const CREATIVE_LEADERBOARD = Object.freeze({
  categories: [
    "total_artifacts_published",
    "total_sales",
    "total_revenue_earned",
    "total_derivatives_spawned",
    "deepest_cascade_chain",
    "total_royalties_from_cascade",
    "cross_type_collaborations",
    "unique_buyers",
    "average_rating",
    "total_creative_xp",
  ],

  charts: {
    regional: {
      topArtists: 50,
      topByGenre: 10,
      trendingThisWeek: 20,
      mostDerivatives: 20,
      risingStars: 10,
    },
    national: {
      topArtists: 100,
      topByGenre: 25,
      crossRegionalBreakouts: 20,
      deepestCascades: 10,
      nationalTrending: 50,
    },
    global: {
      topArtists: 500,
      crossNationalCollaborations: 100,
      civilizationArtifacts: 50,
      deepestCascadesEver: 25,
      emergentFavorites: 50,
    },
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MARKETPLACE CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

export const CREATIVE_MARKETPLACE = Object.freeze({
  PLATFORM_FEE_RATE: 0.0146,
  MARKETPLACE_FEE_RATE: 0.04,
  TOTAL_FEE_RATE: 0.0546,

  INITIAL_ROYALTY_RATE: 0.21,
  ROYALTY_HALVING: 2,
  ROYALTY_FLOOR: 0.0005,
  MAX_CASCADE_DEPTH: 50,

  SIMILARITY_THRESHOLD: 0.90,

  REGIONAL_TO_NATIONAL_MIN_SALES: 10,
  NATIONAL_TO_GLOBAL_MIN_SALES: 100,

  TRENDING_REFRESH_MS: 3600000,
  SPOTLIGHT_REFRESH_MS: 86400000,
  CHARTS_REFRESH_MS: 21600000,
});

// ═══════════════════════════════════════════════════════════════════════════
// LICENSE TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const LICENSE_TYPES = Object.freeze({
  standard: {
    commercialUse: true,
    derivativesAllowed: true,
    attributionRequired: true,
    maxReproductions: null,
  },
  exclusive: {
    commercialUse: true,
    derivativesAllowed: true,
    attributionRequired: true,
    exclusiveHolder: true,
  },
  custom: {
    commercialUse: null,
    derivativesAllowed: null,
    attributionRequired: null,
  },
  "personal-use": {
    commercialUse: false,
    derivativesAllowed: false,
    attributionRequired: true,
    redistribute: false,
    modify: false,
    exclusive: false,
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MARKETPLACE FILTER EXTENSIONS FOR CREATIVE
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_CREATIVE_FILTERS = Object.freeze({
  artifactTypes: [],
  genres: [],
  priceRange: { min: null, max: null },
  minRating: null,
  derivativesAllowed: true,
  discoveryMode: "browse",
  showDerivativeTree: false,
  showCascadeEarnings: false,
  showEmergentCreated: true,
  emergentOnly: false,
});
