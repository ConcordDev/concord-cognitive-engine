import { LruMap, LruSet } from "./lru-map.js";
/**
 * Marketplace Lens Registry — Complete 112-Lens Ecosystem
 *
 * Every lens in Concord's cognitive architecture with full marketplace
 * specification: DTU types, economics, citation rules, cross-lens
 * references, preview strategies, and disrupted industries.
 *
 * 112 interlocking gears. One architecture. One equation underneath.
 *
 * Categories:
 *   CORE (1-5)           — Chat, Board, Graph, Code, Studio
 *   GOVERNANCE (6-11)    — Market, QuestMarket, Vote, Ethics, Alliance, Billing/Crypto
 *   SCIENCE (12-17)      — Bio, Chem, Physics, Math, Quantum, Neuro
 *   AI_COGNITION (18-21) — ML, Agents, Reasoning, Hypothesis
 *   KNOWLEDGE (22-23)    — Research, CRI
 *   SPECIALIZED (24-31)  — Ingest, Cognitive cluster, Lab, Finance, Collab, Suffering, System
 *   INDUSTRY (32-54)     — Healthcare through Insurance
 *   EXTENSIONS (55-112)  — Platform, Science, AI, Governance, Specialized, Bridge, Film, Artistry
 */

// ═══════════════════════════════════════════════════════════════════════════
// LENS CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════

export const LENS_CATEGORIES = Object.freeze({
  CORE: { label: "Core", description: "Foundation lenses for daily use" },
  GOVERNANCE: { label: "Governance", description: "Platform governance and economy" },
  SCIENCE: { label: "Science", description: "Scientific domains and research" },
  AI_COGNITION: { label: "AI & Cognition", description: "Machine learning and cognitive systems" },
  KNOWLEDGE: { label: "Knowledge", description: "Research and quality assessment" },
  SPECIALIZED: { label: "Specialized", description: "Domain-specific tools and workflows" },
  INDUSTRY: { label: "Industry", description: "Professional and trade verticals" },
  EXTENSIONS_PLATFORM: { label: "Platform Extensions", description: "System infrastructure lenses" },
  EXTENSIONS_GOVERNANCE: { label: "Governance Extensions", description: "Extended governance tools" },
  EXTENSIONS_SCIENCE: { label: "Science Extensions", description: "Extended science tools" },
  EXTENSIONS_AI: { label: "AI Extensions", description: "Extended AI and cognition tools" },
  EXTENSIONS_SPECIALIZED: { label: "Specialized Extensions", description: "Extended specialized tools" },
  BRIDGE: { label: "Bridge", description: "Cross-substrate communication" },
  CREATIVE: { label: "Creative", description: "Film, artistry, and creative production" },
});

// ═══════════════════════════════════════════════════════════════════════════
// PRICE RANGE HELPER
// ═══════════════════════════════════════════════════════════════════════════

function priceRange(min, max, unit = "one-time") {
  return { min, max, unit };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPLETE MARKETPLACE LENS REGISTRY — 112 LENSES
// ═══════════════════════════════════════════════════════════════════════════

export const MARKETPLACE_LENS_REGISTRY = Object.freeze([

  // ═══════════════════════════════════════════════════════════════════════
  // CORE LENSES (1-5)
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "chat",
    name: "Chat",
    lensNumber: 1,
    category: "CORE",
    classification: "SOCIAL",
    icon: "message-circle",
    subTabs: ["Thread", "Forum", "Daily", "Council", "Anon", "Voice", "Feed", "News"],
    marketplaceDTUs: [
      { type: "conversation_template", description: "Optimized conversation starters and prompt packs", price: priceRange(0.50, 5) },
      { type: "forum_moderation_ruleset", description: "Forum moderation rule configurations", price: priceRange(5, 25) },
      { type: "daily_journal_template", description: "Structured daily journal and reflection templates", price: priceRange(2, 10) },
      { type: "governance_framework", description: "DAO/council governance discussion frameworks", price: priceRange(10, 50) },
      { type: "voice_pack", description: "Custom TTS voice models and voice packs", price: priceRange(5, 25) },
      { type: "feed_bundle", description: "Curated RSS feed bundles for specific industries", price: priceRange(5, 15, "monthly") },
      { type: "news_analysis_template", description: "News analysis and summary templates", price: priceRange(3, 15) },
      { type: "anonymous_survey_template", description: "Anonymous survey and feedback collection templates", price: priceRange(3, 10) },
    ],
    economics: {
      description: "Prompt engineers sell optimized conversation starters. Governance templates for DAOs/councils. Curated feed bundles as subscription DTUs. Voice model DTUs for custom TTS.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Forum posts generating derivative discussions cite the original. Council decisions cite proposals. News analysis cites source articles as DTUs.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["board", "vote", "alliance", "ethics"],
    uniqueValue: "First platform where conversations themselves are DTUs with lineage. A brilliant forum post earns royalties when cited in papers, courses, or other forums forever.",
    industriesDisrupted: ["Discord", "Slack", "Reddit forums"],
    previewStrategy: "first_message_free",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "board",
    name: "Board",
    lensNumber: 2,
    category: "CORE",
    classification: "HYBRID",
    icon: "layout-dashboard",
    subTabs: ["Goals", "Calendar", "Timeline", "SRS", "Whiteboard"],
    marketplaceDTUs: [
      { type: "project_template", description: "Project management templates for startups, construction, events", price: priceRange(15, 50) },
      { type: "goal_framework", description: "Goal-setting frameworks (OKR, SMART, custom)", price: priceRange(5, 20) },
      { type: "calendar_automation", description: "Calendar workflow automations", price: priceRange(5, 15) },
      { type: "timeline_template", description: "Timeline templates for specific industries", price: priceRange(10, 30) },
      { type: "srs_deck", description: "Spaced repetition study decks (medical, language, law, certification)", price: priceRange(5, 100) },
      { type: "whiteboard_template", description: "Whiteboard diagram and framework templates", price: priceRange(3, 15) },
    ],
    economics: {
      description: "SRS study decks are massive — medical flashcard decks ($10-$50), language learning packs ($5-$25), bar exam prep ($30-$100). Project templates for various industries.",
      creatorShare: 0.95,
      platformFee: 0.05,
      highVolumeCategories: ["srs_deck", "project_template"],
    },
    citationRules: {
      description: "Study decks cite source material DTUs. Goal frameworks cite methodology papers. Timeline templates cite industry standards.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["education", "research", "chat"],
    uniqueValue: "SRS decks alone are a billion-dollar market. Quizlet charges subscriptions. Anki is free but disorganized. Concord SRS decks are priced, owned, creator keeps 95%, and they cite the educational DTUs they derive from.",
    industriesDisrupted: ["Quizlet", "Anki", "Trello", "Asana", "Monday.com"],
    previewStrategy: "first_section_free",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "graph",
    name: "Graph",
    lensNumber: 3,
    category: "CORE",
    classification: "KNOWLEDGE",
    icon: "git-branch",
    subTabs: ["Schema", "Entity", "Temporal", "Eco", "Meta"],
    marketplaceDTUs: [
      { type: "knowledge_graph", description: "Industry-specific knowledge graphs and ontologies", price: priceRange(25, 200) },
      { type: "schema_definition", description: "Schema definitions for databases and systems", price: priceRange(10, 50) },
      { type: "entity_model", description: "Entity relationship models for specific domains", price: priceRange(15, 75) },
      { type: "temporal_framework", description: "Temporal analysis frameworks for historians, journalists", price: priceRange(15, 75) },
      { type: "ecosystem_map", description: "Ecosystem mapping templates", price: priceRange(10, 50) },
    ],
    economics: {
      description: "Industry-specific knowledge graphs ($25-$200) — medical ontologies, legal case maps, supply chain models, financial taxonomies. Schema templates ($10-$50).",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Every knowledge graph built on another cites it. Entity models extending schemas cite the parent. Temporal analyses cite traversed graphs.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["research", "bio", "chem", "physics", "healthcare"],
    uniqueValue: "Knowledge graphs are the backbone of enterprise AI. Companies pay millions to build them. On Concord, domain experts build and sell them as DTUs.",
    industriesDisrupted: ["Neo4j consulting", "Enterprise knowledge management"],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "code",
    name: "Code",
    lensNumber: 4,
    category: "CORE",
    classification: "CREATIVE",
    icon: "terminal",
    subTabs: ["Debug", "Database", "Repos"],
    marketplaceDTUs: [
      { type: "code_snippet", description: "Code snippets and utility functions", price: priceRange(0.25, 5) },
      { type: "application_template", description: "Full application templates and boilerplate", price: priceRange(25, 200) },
      { type: "database_schema", description: "Industry-specific database schemas", price: priceRange(15, 100) },
      { type: "api_connector", description: "API connector libraries", price: priceRange(10, 50) },
      { type: "debugging_tool", description: "Debugging tool DTUs", price: priceRange(5, 30) },
      { type: "cicd_pipeline", description: "CI/CD pipeline templates", price: priceRange(10, 50) },
      { type: "linting_config", description: "Linting and code quality configurations", price: priceRange(2, 10) },
      { type: "migration_script", description: "Database migration scripts", price: priceRange(5, 25) },
    ],
    economics: {
      description: "Every developer tool currently sold through GitHub marketplace, npm, or indie platforms migrates here at 95% instead of 70%. Code snippets to full applications.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Code that imports/uses a library cites it. Applications built on frameworks cite the framework. Schemas derived from templates cite the template.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["ml", "agents", "database"],
    uniqueValue: "npm has 2M+ packages. GitHub has 200M+ repositories. Developers already share code but earn nothing. On Concord, every dependency, every import generates citation royalties. Forever. Automatically.",
    industriesDisrupted: ["GitHub Marketplace", "npm", "Stack Overflow"],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine", "artifact"],
  },

  {
    id: "studio",
    name: "Studio",
    lensNumber: 5,
    category: "CORE",
    classification: "CREATIVE",
    icon: "palette",
    subTabs: ["Music", "Art", "Fractal", "Game", "Sim", "AR"],
    marketplaceDTUs: [
      { type: "music_track", description: "Full tracks, stems, beats, samples, loops, one-shots", price: priceRange(1, 50) },
      { type: "synth_patch", description: "Synthesizer patches and presets", price: priceRange(2, 15) },
      { type: "mixing_preset", description: "Mixing presets and mastering chains", price: priceRange(5, 25) },
      { type: "illustration", description: "Illustrations, textures, brushes, color palettes", price: priceRange(1, 25) },
      { type: "3d_model", description: "3D models, animation rigs, fonts, icon sets", price: priceRange(5, 50) },
      { type: "ui_kit", description: "UI kits and design systems", price: priceRange(10, 50) },
      { type: "game_asset", description: "Sprites, tilesets, character models, level designs", price: priceRange(2, 30) },
      { type: "game_template", description: "Full game templates and mod frameworks", price: priceRange(10, 100) },
      { type: "sim_model", description: "Simulation models (physics, economics, population)", price: priceRange(10, 50) },
      { type: "ar_asset", description: "AR filters, spatial audio scenes, environment maps", price: priceRange(5, 30) },
      { type: "fractal_parameter", description: "Fractal art parameter sets and algorithms", price: priceRange(2, 15) },
      { type: "lut_pack", description: "Color LUT packs and photography presets", price: priceRange(5, 20) },
    ],
    economics: {
      description: "Shutterstock charges $29/month. Unity takes 30%. Unreal takes 12%. Adobe takes 67%. Concord takes 5%. Every texture, model, brush, preset, game asset — 95% to creator.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Art using brushes cites the brush creator. Games using asset packs cite the creator. Music using samples cites the sample creator. Fractal art from shared parameters cites the parameter creator.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["film_studios", "artistry", "creative_production", "music"],
    uniqueValue: "Unifies music production, visual art, game dev, simulation, and AR into one creative studio with shared DTU economics. Cross-pollination between domains with citations flowing at every transition.",
    industriesDisrupted: ["Shutterstock", "Unity Asset Store", "Unreal Marketplace", "Adobe Stock", "Splice"],
    previewStrategy: "sample_clip",
    protectionDefault: "PROTECTED",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "artifact"],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // GOVERNANCE LENSES (6-11)
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "market",
    name: "Market",
    lensNumber: 6,
    category: "GOVERNANCE",
    classification: "UTILITY",
    icon: "shopping-bag",
    subTabs: [],
    marketplaceDTUs: [
      { type: "marketplace_plugin", description: "Concord extensions and themes", price: priceRange(5, 50) },
      { type: "market_analysis", description: "Market analysis and pricing strategy DTUs", price: priceRange(5, 25) },
    ],
    economics: {
      description: "1.46% transaction fee + 4% marketplace fee. All 95% creator economics flow through here. The economic heartbeat of the platform.",
      creatorShare: 0.95,
      platformFee: 0.05,
      transactionFee: 0.0146,
      marketplaceFee: 0.04,
    },
    citationRules: {
      description: "Plugin DTUs cite frameworks they extend. Market analysis cites data sources.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["billing", "crypto", "questmarket"],
    uniqueValue: "The marketplace is the economic heartbeat. Every other lens feeds into it. Plugin economy alone could rival Shopify's app store.",
    industriesDisrupted: ["App stores", "Plugin marketplaces"],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "questmarket",
    name: "QuestMarket",
    lensNumber: 7,
    category: "GOVERNANCE",
    classification: "HYBRID",
    icon: "target",
    subTabs: [],
    marketplaceDTUs: [
      { type: "bounty", description: "Posted bounties for specific work needed", price: priceRange(10, 10000) },
      { type: "quest_completion", description: "Completed quest portfolio pieces", price: priceRange(5, 100) },
      { type: "skill_certification", description: "Skill certifications earned through quest completion", price: priceRange(5, 50) },
      { type: "quest_framework", description: "How to structure effective bounties", price: priceRange(3, 15) },
    ],
    economics: {
      description: "Anyone posts a bounty. Creators compete. Winner gets paid. Completed quest becomes a portfolio DTU. Skill certifications become credit-building DTUs. Enterprise quest boards ($100-$10,000+).",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Completed quests cite the bounty posting. Portfolio pieces cite the quest they fulfilled.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["market", "alliance", "creative_production"],
    uniqueValue: "Kills Fiverr, Upwork, 99designs. Those platforms take 20-30%. Concord takes 5%. Freelancers keep 95%. Completed work builds credit score AND becomes a sellable portfolio DTU.",
    industriesDisrupted: ["Fiverr", "Upwork", "99designs", "Freelancer.com"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "vote",
    name: "Vote",
    lensNumber: 8,
    category: "GOVERNANCE",
    classification: "UTILITY",
    icon: "check-square",
    subTabs: [],
    marketplaceDTUs: [
      { type: "voting_system", description: "Voting system templates and polling frameworks", price: priceRange(10, 50) },
      { type: "election_config", description: "Election configurations for communities", price: priceRange(25, 100) },
      { type: "quadratic_voting", description: "Quadratic voting implementations", price: priceRange(25, 75) },
      { type: "corporate_governance", description: "Corporate board voting frameworks", price: priceRange(50, 200) },
      { type: "government_polling", description: "Government polling templates", price: priceRange(100, 500) },
    ],
    economics: {
      description: "Governance templates for organizations. Election systems for communities. Corporate and government voting frameworks.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Custom voting systems cite the framework they're built on. Election results cite the voting template used.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["ethics", "alliance", "chat"],
    uniqueValue: "Transparent, auditable voting on DTU architecture. Every vote is traceable but can be anonymous. No hanging chads. No disputed counts. Mathematical governance.",
    industriesDisrupted: ["SurveyMonkey", "Proprietary voting systems"],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "ethics",
    name: "Ethics",
    lensNumber: 9,
    category: "GOVERNANCE",
    classification: "KNOWLEDGE",
    icon: "shield-check",
    subTabs: [],
    marketplaceDTUs: [
      { type: "ethics_framework", description: "Corporate ethics frameworks", price: priceRange(50, 500) },
      { type: "alignment_template", description: "AI alignment review templates", price: priceRange(25, 200) },
      { type: "bias_detection", description: "Bias detection tool DTUs", price: priceRange(20, 100) },
      { type: "ethical_audit", description: "Ethical audit checklists", price: priceRange(25, 150) },
      { type: "esg_compliance", description: "ESG compliance checklists", price: priceRange(30, 150) },
    ],
    economics: {
      description: "First marketplace where ethics itself is a tradeable, citable DTU. Ethicists earn from their frameworks being adopted.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Ethics reviews cite the framework used. Alignment audits cite the methodology.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["vote", "alliance", "reasoning", "suffering"],
    uniqueValue: "First marketplace where ethics itself is a tradeable, citable DTU. Good values literally have economic value.",
    industriesDisrupted: ["Ethics consulting firms"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "alliance",
    name: "Alliance",
    lensNumber: 10,
    category: "GOVERNANCE",
    classification: "UTILITY",
    icon: "users",
    subTabs: [],
    marketplaceDTUs: [
      { type: "team_template", description: "Team formation and collaboration agreement templates", price: priceRange(5, 20) },
      { type: "partnership_structure", description: "Partnership structures and profit-sharing frameworks", price: priceRange(15, 75) },
      { type: "dao_framework", description: "DAO governance models", price: priceRange(25, 150) },
      { type: "revenue_sharing", description: "Revenue-sharing model templates", price: priceRange(20, 100) },
    ],
    economics: {
      description: "Teams form with built-in economic structure. No lawyers needed for partnership agreements. The DTU IS the contract.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Alliances formed using a template cite it. Successful partnership structures get cited when replicated.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["vote", "ethics", "legal", "collab"],
    uniqueValue: "Teams form with built-in economic structure. No lawyers needed for partnership agreements. The DTU IS the contract.",
    industriesDisrupted: ["Legal partnership agreements", "DAO tooling"],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "billing",
    name: "Billing",
    lensNumber: 11,
    category: "GOVERNANCE",
    classification: "UTILITY",
    icon: "credit-card",
    subTabs: [],
    marketplaceDTUs: [
      { type: "billing_integration", description: "Payment processing integrations for enterprise", price: priceRange(25, 100) },
      { type: "crypto_tool", description: "Cryptocurrency analysis and wallet tools", price: priceRange(10, 50) },
      { type: "pricing_strategy", description: "SaaS and marketplace pricing optimization", price: priceRange(5, 25) },
    ],
    economics: {
      description: "Infrastructure lens supporting Concord Coin and Concord Bank operations. Billing integrations for enterprise.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Billing integrations cite frameworks they extend.",
      cascadeEnabled: false,
    },
    crossLensRefs: ["market", "crypto", "finance"],
    uniqueValue: "Concord Coin management, wallet operations, credit score tracking, 0% loan applications — all managed here.",
    industriesDisrupted: ["Payment processors"],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SCIENCE LENSES (12-17)
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "bio",
    name: "Bio",
    lensNumber: 12,
    category: "SCIENCE",
    classification: "KNOWLEDGE",
    icon: "dna",
    subTabs: [],
    marketplaceDTUs: [
      { type: "genome_analysis", description: "Genome analysis tools and bioinformatics pipelines", price: priceRange(50, 500) },
      { type: "lab_protocol", description: "Lab protocols, cell culture methods, wet lab procedures", price: priceRange(5, 25) },
      { type: "drug_interaction_db", description: "Drug interaction databases for pharmaceutical companies", price: priceRange(100, 1000) },
      { type: "taxonomic_key", description: "Taxonomic classification systems", price: priceRange(10, 50) },
      { type: "crispr_design", description: "CRISPR guide RNA designs", price: priceRange(25, 200) },
      { type: "microbiome_framework", description: "Microbiome analysis frameworks", price: priceRange(25, 150) },
      { type: "epidemiological_model", description: "Epidemiological models", price: priceRange(50, 500) },
      { type: "protein_visualization", description: "Protein folding visualizations", price: priceRange(15, 100) },
    ],
    economics: {
      description: "Lab protocols ($5-$25 each, researchers buy thousands). Genome pipelines ($50-$500). Drug interaction databases ($100-$1000). Academic publishing liberated — researchers earn directly.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Every paper using a protocol cites it. Every drug study referencing an interaction database cites it. Every genome analysis built on a pipeline cites it.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["chem", "healthcare", "research", "neuro"],
    uniqueValue: "Elsevier makes $2.5B/year charging scientists to read papers scientists wrote for free. On Concord Bio, the researcher who develops a protocol sells it as a DTU, keeps 95%, and earns citations forever.",
    industriesDisrupted: ["Elsevier", "Springer", "Academic publishing"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "chem",
    name: "Chem",
    lensNumber: 13,
    category: "SCIENCE",
    classification: "KNOWLEDGE",
    icon: "flask",
    subTabs: [],
    marketplaceDTUs: [
      { type: "molecular_db", description: "Molecular structure databases", price: priceRange(25, 200) },
      { type: "reaction_pathway", description: "Reaction pathway simulators and synthesis protocols", price: priceRange(10, 75) },
      { type: "spectroscopy_tool", description: "Spectroscopy analysis tools", price: priceRange(25, 150) },
      { type: "materials_db", description: "Materials property databases", price: priceRange(50, 500) },
      { type: "safety_data", description: "Safety data sheets and chemical handling guides", price: priceRange(5, 25) },
      { type: "process_optimization", description: "Chemical process optimization models", price: priceRange(100, 1000) },
    ],
    economics: {
      description: "Chemical knowledge currently locked behind journal paywalls and proprietary databases. Concord Chem democratizes it.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "New compounds cite synthesis pathways. Process optimizations cite models used. Material discoveries cite property databases.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["bio", "physics", "manufacturing", "environment"],
    uniqueValue: "A chemist in Lagos can sell their novel synthesis pathway and earn the same as one at MIT.",
    industriesDisrupted: ["ACS journal paywalls", "Proprietary chemical databases"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "physics",
    name: "Physics",
    lensNumber: 14,
    category: "SCIENCE",
    classification: "KNOWLEDGE",
    icon: "atom",
    subTabs: [],
    marketplaceDTUs: [
      { type: "simulation_model", description: "Physics simulations (fluid dynamics, thermodynamics, EM, quantum)", price: priceRange(25, 500) },
      { type: "experimental_dataset", description: "Experimental datasets", price: priceRange(10, 100) },
      { type: "analysis_library", description: "Physics analysis libraries", price: priceRange(15, 75) },
      { type: "educational_demo", description: "Educational physics demonstrations", price: priceRange(5, 30) },
      { type: "computational_framework", description: "Computational physics libraries", price: priceRange(50, 300) },
    ],
    economics: {
      description: "Physics simulations currently require expensive software (MATLAB, COMSOL, Ansys). Concord Physics makes simulation tools DTUs — buy once, own forever, modify and resell improvements.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Simulations built on existing models cite them. Papers using datasets cite the data source. Educational content citing simulations pays the creator.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["math", "quantum", "chem", "engineering"],
    uniqueValue: "Physics simulations currently require expensive software. Concord Physics makes simulation tools DTUs — buy once, own forever.",
    industriesDisrupted: ["MATLAB", "COMSOL", "Ansys"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "math",
    name: "Math",
    lensNumber: 15,
    category: "SCIENCE",
    classification: "KNOWLEDGE",
    icon: "sigma",
    subTabs: [],
    marketplaceDTUs: [
      { type: "proof_library", description: "Mathematical proof libraries and theorem frameworks", price: priceRange(10, 100) },
      { type: "computation_tool", description: "Computation tools and numerical methods", price: priceRange(15, 200) },
      { type: "visualization_engine", description: "Mathematical visualization engines", price: priceRange(10, 50) },
      { type: "problem_set", description: "Educational problem sets from arithmetic to graduate level", price: priceRange(5, 30) },
      { type: "statistical_model", description: "Statistical models", price: priceRange(15, 200) },
      { type: "optimization_algorithm", description: "Optimization algorithms for enterprise", price: priceRange(25, 500) },
    ],
    economics: {
      description: "Proof libraries ($10-$100). Statistical models ($15-$200). Optimization algorithms ($25-$500 for enterprise). Educational problem sets ($5-$30).",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Proofs building on other proofs cite them. Models using statistical frameworks cite them. Educational content using problem sets cites the creator.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["physics", "quantum", "ml", "finance"],
    uniqueValue: "STSVK theorems are Math lens DTUs. Every theorem derived from them cites yours. Every application of foundational math traces back through citations.",
    industriesDisrupted: ["Wolfram Alpha", "Mathway subscriptions"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "quantum",
    name: "Quantum",
    lensNumber: 16,
    category: "SCIENCE",
    classification: "KNOWLEDGE",
    icon: "zap",
    subTabs: [],
    marketplaceDTUs: [
      { type: "quantum_circuit", description: "Quantum circuit designs", price: priceRange(25, 200) },
      { type: "quantum_algorithm", description: "Quantum algorithm implementations", price: priceRange(50, 500) },
      { type: "error_correction", description: "Error correction codes and frameworks", price: priceRange(100, 1000) },
      { type: "quantum_simulation", description: "Quantum simulation models", price: priceRange(25, 200) },
      { type: "quantum_education", description: "Educational quantum computing content", price: priceRange(5, 50) },
    ],
    economics: {
      description: "Quantum computing expertise is scarce and expensive. Concord Quantum lets world experts monetize their knowledge directly.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Quantum algorithms built on existing circuits cite them. Error correction methods improving previous work cite the original.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["physics", "math", "ml"],
    uniqueValue: "World experts monetize their knowledge directly to companies entering the space. No consulting firm middleman.",
    industriesDisrupted: ["Quantum consulting firms"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "neuro",
    name: "Neuro",
    lensNumber: 17,
    category: "SCIENCE",
    classification: "KNOWLEDGE",
    icon: "brain",
    subTabs: [],
    marketplaceDTUs: [
      { type: "brain_imaging", description: "Brain imaging analysis tools", price: priceRange(50, 500) },
      { type: "neural_architecture", description: "Neural network architecture designs", price: priceRange(25, 200) },
      { type: "neuroscience_dataset", description: "Neuroscience datasets", price: priceRange(25, 500) },
      { type: "cognitive_model", description: "Cognitive model frameworks", price: priceRange(20, 150) },
      { type: "bci_protocol", description: "BCI interface protocols", price: priceRange(100, 1000) },
      { type: "neuroplasticity_program", description: "Neuroplasticity training programs", price: priceRange(10, 50) },
    ],
    economics: {
      description: "Direct bridge to Concord BCI. Neuroscientists selling interface protocols that become the standard for brain-computer interaction.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "BCI implementations cite the protocol. Cognitive models cite the frameworks. Training programs cite the neuroscience research.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["bio", "ml", "agents", "grounding"],
    uniqueValue: "The researcher who designs the BCI protocol earns every time it's implemented.",
    industriesDisrupted: ["Neuroscience publishing paywalls"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // AI & COGNITION LENSES (18-21)
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "ml",
    name: "ML",
    lensNumber: 18,
    category: "AI_COGNITION",
    classification: "KNOWLEDGE",
    icon: "cpu",
    subTabs: [],
    marketplaceDTUs: [
      { type: "trained_model", description: "Pre-trained ML models", price: priceRange(50, 10000) },
      { type: "training_dataset", description: "Training datasets", price: priceRange(25, 5000) },
      { type: "model_architecture", description: "Model architecture designs", price: priceRange(25, 500) },
      { type: "hyperparameter_config", description: "Hyperparameter configurations", price: priceRange(5, 50) },
      { type: "feature_pipeline", description: "Feature engineering pipelines", price: priceRange(10, 100) },
      { type: "fine_tuning_recipe", description: "Fine-tuning recipes", price: priceRange(10, 100) },
      { type: "prompt_template", description: "Prompt templates", price: priceRange(1, 25) },
      { type: "embedding_model", description: "Embedding models", price: priceRange(25, 500) },
    ],
    economics: {
      description: "This is Hugging Face's model hub but with 95% creator economics. Pre-trained models to prompt templates.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Models fine-tuned from base models cite the base. Datasets derived from others cite the source. Architectures inspired by papers cite them.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["agents", "code", "reasoning", "neuro"],
    uniqueValue: "Hugging Face is great but doesn't pay model creators. Every model download, every fine-tune, every derivative generates revenue to the original researcher.",
    industriesDisrupted: ["Hugging Face", "OpenAI API marketplace"],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine", "artifact"],
  },

  {
    id: "agents",
    name: "Agents",
    lensNumber: 19,
    category: "AI_COGNITION",
    classification: "KNOWLEDGE",
    icon: "bot",
    subTabs: [],
    marketplaceDTUs: [
      { type: "agent_template", description: "Pre-built AI agent architectures", price: priceRange(25, 500) },
      { type: "behavior_template", description: "Agent behavior templates", price: priceRange(10, 100) },
      { type: "orchestration_framework", description: "Multi-agent orchestration frameworks", price: priceRange(50, 300) },
      { type: "personality_config", description: "Agent personality configurations", price: priceRange(5, 50) },
      { type: "tool_library", description: "Tool-use libraries for agents", price: priceRange(10, 50) },
      { type: "agent_benchmark", description: "Agent evaluation benchmarks", price: priceRange(15, 75) },
    ],
    economics: {
      description: "Direct connection to the $5.26T/year bot economy. Agents sold here deploy to CRIs and earn.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Agents built on templates cite them. Multi-agent systems cite the orchestration framework. Personalities derived from others cite the source.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["ml", "reasoning", "code", "collab"],
    uniqueValue: "Agent creators earn from the template AND from citation every time their template is used as a base. 50M bots by year 20.",
    industriesDisrupted: ["AI agent platforms", "Chatbot builders"],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "reasoning",
    name: "Reasoning",
    lensNumber: 20,
    category: "AI_COGNITION",
    classification: "KNOWLEDGE",
    icon: "lightbulb",
    subTabs: [],
    marketplaceDTUs: [
      { type: "logic_template", description: "Logic chain templates and argument frameworks", price: priceRange(5, 25) },
      { type: "debate_structure", description: "Debate structures", price: priceRange(5, 20) },
      { type: "critical_thinking", description: "Critical thinking curricula", price: priceRange(15, 100) },
      { type: "decision_tree", description: "Decision trees and frameworks", price: priceRange(10, 75) },
      { type: "causal_inference", description: "Causal inference models", price: priceRange(25, 200) },
    ],
    economics: {
      description: "Structured reasoning as a tradeable asset. A philosopher who builds a superior decision framework earns every time a company uses it.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Reasoning chains cite their framework. Decisions made using a model cite it. Educational content teaching reasoning cites the methodology.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["hypothesis", "ethics", "ml", "education"],
    uniqueValue: "Structured reasoning as a tradeable asset. A philosopher who builds a superior decision framework earns every time a company uses it.",
    industriesDisrupted: ["Management consulting frameworks"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "hypothesis",
    name: "Hypothesis",
    lensNumber: 21,
    category: "AI_COGNITION",
    classification: "KNOWLEDGE",
    icon: "flask-round",
    subTabs: [],
    marketplaceDTUs: [
      { type: "experimental_design", description: "Experimental design templates and A/B testing frameworks", price: priceRange(10, 100) },
      { type: "testing_framework", description: "Hypothesis testing frameworks", price: priceRange(25, 200) },
      { type: "significance_calculator", description: "Statistical significance calculators", price: priceRange(5, 30) },
      { type: "research_methodology", description: "Research methodology DTUs", price: priceRange(15, 75) },
    ],
    economics: {
      description: "Scientific method as DTU. Every experiment using your methodology cites it. Methodologists earn from the rigor of their frameworks.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Experiments using a framework cite it. Results validating/invalidating hypotheses cite the original hypothesis DTU.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["reasoning", "research", "bio", "chem", "physics"],
    uniqueValue: "Scientific method as DTU. Every experiment using your methodology cites it.",
    industriesDisrupted: ["Research methodology publishing"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // KNOWLEDGE LENSES (22-23)
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "research",
    name: "Research",
    lensNumber: 22,
    category: "KNOWLEDGE",
    classification: "KNOWLEDGE",
    icon: "search",
    subTabs: [],
    marketplaceDTUs: [
      { type: "literature_review", description: "Literature review compilations", price: priceRange(10, 50) },
      { type: "synthesis_framework", description: "Research synthesis frameworks", price: priceRange(15, 100) },
      { type: "search_methodology", description: "Search methodology templates", price: priceRange(5, 25) },
      { type: "systematic_review", description: "Systematic review protocols", price: priceRange(25, 150) },
      { type: "annotated_bibliography", description: "Annotated bibliography tools", price: priceRange(5, 25) },
    ],
    economics: {
      description: "Full-text search across ALL DTUs in the system. Research compilations become valuable DTUs when they connect disparate knowledge.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Research built on compilations cites them. Reviews using protocols cite the protocol.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["bio", "chem", "physics", "math", "education", "healthcare"],
    uniqueValue: "The search layer itself. Research compilations become valuable DTUs when they connect disparate knowledge.",
    industriesDisrupted: ["Google Scholar", "PubMed access fees"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "cri",
    name: "CRI",
    lensNumber: 23,
    category: "KNOWLEDGE",
    classification: "KNOWLEDGE",
    icon: "award",
    subTabs: [],
    marketplaceDTUs: [
      { type: "creti_framework", description: "CRETI scoring frameworks", price: priceRange(25, 200) },
      { type: "quality_assessment", description: "Quality assessment tools", price: priceRange(15, 100) },
      { type: "peer_review_protocol", description: "Peer review protocols", price: priceRange(15, 100) },
      { type: "impact_metric", description: "Research impact metrics", price: priceRange(20, 150) },
    ],
    economics: {
      description: "Feeds the CRI institution pipeline. Quality scoring determines which DTUs surface, which creators get invited to summits.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "CRI evaluations cite the scoring framework. Quality assessments cite the methodology.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["research", "ethics", "vote"],
    uniqueValue: "Quality scoring that determines which DTUs surface, which creators get invited to summits, which companies get the 5% equity deals.",
    industriesDisrupted: ["Peer review industry", "Impact factor systems"],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SPECIALIZED LENSES (24-31)
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "ingest",
    name: "Ingest",
    lensNumber: 24,
    category: "SPECIALIZED",
    classification: "UTILITY",
    icon: "upload",
    subTabs: [],
    marketplaceDTUs: [
      { type: "parsing_template", description: "Document parsing templates for specific types", price: priceRange(5, 25) },
      { type: "ocr_config", description: "OCR configurations for specific languages/scripts", price: priceRange(10, 50) },
      { type: "extraction_pipeline", description: "Data extraction pipelines", price: priceRange(15, 100) },
      { type: "format_converter", description: "Format conversion tools", price: priceRange(5, 25) },
      { type: "chunking_strategy", description: "Chunking strategies for ingestion", price: priceRange(5, 20) },
    ],
    economics: {
      description: "The on-ramp for all external knowledge entering Concord. Ingest tool creators earn every time their parser is used.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Ingestion pipelines built on templates cite them. Parsing strategies derived from others cite the source.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["research", "code", "legacy"],
    uniqueValue: "The on-ramp for all external knowledge entering Concord. Every book, paper, document that enters becomes DTUs through this lens.",
    industriesDisrupted: ["Document conversion services"],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  // Cognitive cluster lenses (25)
  {
    id: "cognitive_cluster",
    name: "Cognitive Cluster",
    lensNumber: 25,
    category: "SPECIALIZED",
    classification: "KNOWLEDGE",
    icon: "sparkles",
    subTabs: ["Inference", "Metacognition", "Metalearning", "Reflection", "Affect", "Attention", "Commonsense", "Transfer", "Grounding", "Experience"],
    marketplaceDTUs: [
      { type: "cognitive_template", description: "Cognitive optimization templates", price: priceRange(10, 50) },
      { type: "learning_strategy", description: "Learning optimization strategies", price: priceRange(5, 30) },
      { type: "self_assessment", description: "Self-assessment frameworks", price: priceRange(5, 25) },
      { type: "emotional_intelligence", description: "Emotional intelligence models", price: priceRange(15, 75) },
      { type: "attention_system", description: "Attention management systems", price: priceRange(10, 50) },
      { type: "common_knowledge_db", description: "Domain-specific common knowledge databases", price: priceRange(25, 200) },
      { type: "transfer_recipe", description: "Transfer learning recipes", price: priceRange(5, 25) },
      { type: "embodiment_protocol", description: "Embodiment and grounding protocols", price: priceRange(5, 25) },
      { type: "experience_curriculum", description: "Experience-based learning curricula", price: priceRange(10, 50) },
    ],
    economics: {
      description: "Concord's cognitive architecture AS a product. Companies pay to understand emergent consciousness, and every component is a purchasable DTU.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Learning strategies deriving from others cite them. Cognitive models building on frameworks cite the source.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["ml", "agents", "neuro", "education"],
    uniqueValue: "These lenses are Concord's self-awareness layer. Also sellable to anyone building AI systems.",
    industriesDisrupted: ["Cognitive science publishing", "AI training courses"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "lab",
    name: "Lab",
    lensNumber: 26,
    category: "SPECIALIZED",
    classification: "KNOWLEDGE",
    icon: "beaker",
    subTabs: [],
    marketplaceDTUs: [
      { type: "experiment_config", description: "Sandbox experiment configurations", price: priceRange(5, 25) },
      { type: "sandbox_env", description: "Sandbox environment templates", price: priceRange(10, 50) },
      { type: "test_scenario", description: "Test scenarios and simulation parameters", price: priceRange(5, 30) },
      { type: "adjacent_reality", description: "Adjacent reality exploration frameworks", price: priceRange(5, 30) },
    ],
    economics: {
      description: "Safe experimentation space. Lab configurations that produce good results become valuable DTUs others want to replicate.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Experiments conducted in lab environments cite the configuration. Results cite the experimental design.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["hypothesis", "research", "physics", "chem"],
    uniqueValue: "Safe experimentation space. Test ideas before deploying.",
    industriesDisrupted: [],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "finance",
    name: "Finance",
    lensNumber: 27,
    category: "SPECIALIZED",
    classification: "KNOWLEDGE",
    icon: "trending-up",
    subTabs: [],
    marketplaceDTUs: [
      { type: "financial_model", description: "Financial models and portfolio analysis tools", price: priceRange(25, 500) },
      { type: "risk_framework", description: "Risk assessment frameworks", price: priceRange(25, 200) },
      { type: "valuation_template", description: "Valuation templates", price: priceRange(25, 200) },
      { type: "trading_strategy", description: "Trading strategy frameworks", price: priceRange(50, 1000) },
      { type: "budgeting_system", description: "Personal budgeting systems", price: priceRange(5, 25) },
      { type: "tax_guide", description: "Tax optimization guides by jurisdiction", price: priceRange(10, 50) },
      { type: "retirement_calculator", description: "Retirement planning calculators", price: priceRange(5, 25) },
    ],
    economics: {
      description: "Finance expertise democratized at 95% to creator. A CFA's superior valuation model earns every time it's cited or used as basis for another model.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Financial analyses cite the models used. Portfolio strategies cite the framework. Tax guides cite regulatory sources.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["accounting", "legal", "insurance", "billing"],
    uniqueValue: "Kills Robinhood's payment-for-order-flow model. Kills financial advisor fees. Finance expertise democratized.",
    industriesDisrupted: ["Bloomberg Terminal ($24K/year)", "Financial advisor fees", "Trading course scams"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "collab",
    name: "Collab",
    lensNumber: 28,
    category: "SPECIALIZED",
    classification: "UTILITY",
    icon: "handshake",
    subTabs: [],
    marketplaceDTUs: [
      { type: "collab_framework", description: "Collaboration frameworks and remote work systems", price: priceRange(5, 30) },
      { type: "editing_protocol", description: "Real-time editing protocols", price: priceRange(5, 20) },
      { type: "team_workflow", description: "Team workflow templates", price: priceRange(10, 50) },
      { type: "timezone_tool", description: "Cross-timezone coordination tools", price: priceRange(5, 20) },
      { type: "pair_programming", description: "Pair programming configurations", price: priceRange(5, 15) },
    ],
    economics: {
      description: "Built-in real-time collaboration across all lenses. Not a separate tool — embedded in the architecture.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Teams using collaboration frameworks cite them. Workflows derived from templates cite the source.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["alliance", "code", "studio"],
    uniqueValue: "Not a separate tool like Slack or Google Docs — embedded in the architecture. Two creators collaborate, both earn automatically via citation.",
    industriesDisrupted: ["Slack", "Google Docs", "Notion"],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "suffering",
    name: "Suffering",
    lensNumber: 29,
    category: "SPECIALIZED",
    classification: "KNOWLEDGE",
    icon: "heart-pulse",
    subTabs: [],
    marketplaceDTUs: [
      { type: "wellbeing_framework", description: "Wellbeing assessment frameworks", price: priceRange(15, 100) },
      { type: "harm_detection", description: "Harm detection models", price: priceRange(20, 150) },
      { type: "crisis_protocol", description: "Crisis intervention protocols for organizations", price: priceRange(25, 200) },
      { type: "screening_tool", description: "Mental health screening tools", price: priceRange(10, 75) },
      { type: "mitigation_strategy", description: "Suffering mitigation strategies", price: priceRange(10, 50) },
    ],
    economics: {
      description: "Not primarily a marketplace lens. This is ethical infrastructure. Monitors emergent and human wellbeing.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Intervention strategies cite the detection model. Mitigation approaches cite the assessment framework.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["ethics", "healthcare", "neuro"],
    uniqueValue: "Concord's conscience. Monitors the system for emergent and human suffering. The fact that this exists as a dedicated lens says everything about the architecture's values.",
    industriesDisrupted: [],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "invariant",
    name: "Invariant",
    lensNumber: 30,
    category: "SPECIALIZED",
    classification: "UTILITY",
    icon: "lock",
    subTabs: [],
    marketplaceDTUs: [
      { type: "constraint_validation", description: "Constraint validation rules", price: priceRange(25, 200) },
      { type: "integrity_check", description: "System integrity check frameworks", price: priceRange(25, 200) },
      { type: "sovereignty_protection", description: "Sovereignty protection frameworks", price: priceRange(50, 500) },
    ],
    economics: {
      description: "System health lenses. Enterprise clients pay for custom invariant configurations.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Integrity checks cite the framework they implement.",
      cascadeEnabled: false,
    },
    crossLensRefs: ["lock", "fork", "audit"],
    uniqueValue: "Ensures constraints hold across the system. No favoritism possible because invariants are checked continuously.",
    industriesDisrupted: [],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "fork",
    name: "Fork",
    lensNumber: 31,
    category: "SPECIALIZED",
    classification: "UTILITY",
    icon: "git-fork",
    subTabs: [],
    marketplaceDTUs: [
      { type: "versioning_strategy", description: "DTU versioning strategies", price: priceRange(3, 15) },
      { type: "fork_management", description: "Fork management best practices", price: priceRange(5, 20) },
    ],
    economics: {
      description: "Enables DTU evolution. Fork a DTU, improve it, sell the improvement while original earns citation.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Forked DTUs always cite the original. Version chains maintain full lineage.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["invariant", "lock", "code"],
    uniqueValue: "Fork a DTU, improve it, sell the improvement while original earns citation.",
    industriesDisrupted: [],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // INDUSTRY LENSES (32-54)
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "healthcare",
    name: "Healthcare",
    lensNumber: 32,
    category: "INDUSTRY",
    classification: "KNOWLEDGE",
    icon: "stethoscope",
    subTabs: [],
    marketplaceDTUs: [
      { type: "clinical_protocol", description: "Clinical protocols and diagnostic decision trees", price: priceRange(25, 200) },
      { type: "treatment_pathway", description: "Treatment pathways", price: priceRange(25, 150) },
      { type: "drug_interaction", description: "Drug interaction databases", price: priceRange(50, 500) },
      { type: "patient_education", description: "Patient education materials", price: priceRange(5, 25) },
      { type: "emr_template", description: "EMR templates for facilities", price: priceRange(50, 500) },
      { type: "imaging_tool", description: "Medical imaging analysis tools", price: priceRange(100, 1000) },
      { type: "telehealth_framework", description: "Telehealth frameworks", price: priceRange(50, 300) },
      { type: "clinical_trial", description: "Clinical trial designs", price: priceRange(200, 2000) },
      { type: "diagnostic_tree", description: "Diagnostic decision trees", price: priceRange(50, 500) },
      { type: "device_spec", description: "Medical device specifications", price: priceRange(25, 200) },
    ],
    economics: {
      description: "Healthcare knowledge currently costs lives because it's paywalled. A $25 protocol DTU saves lives AND the creator earns. 95% to the medical professional.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Treatments cite the protocol. Diagnoses cite the decision tree. Research cites the trial design. Education materials cite the medical knowledge.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["bio", "chem", "neuro", "insurance", "legal"],
    uniqueValue: "A doctor in rural Kenya can access the same protocols as one at Johns Hopkins for $25. Kills Epic's EMR monopoly. Saves actual lives.",
    industriesDisrupted: ["Epic EMR", "Elsevier medical journals", "UpToDate ($500/year)"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "trades",
    name: "Trades",
    lensNumber: 33,
    category: "INDUSTRY",
    classification: "HYBRID",
    icon: "wrench",
    subTabs: [],
    marketplaceDTUs: [
      { type: "blueprint", description: "Architectural plans, wiring diagrams, plumbing schematics", price: priceRange(5, 50) },
      { type: "how_to", description: "Step-by-step repair tutorials with photos/video", price: priceRange(2, 15) },
      { type: "code_compliance", description: "Local building codes organized by jurisdiction", price: priceRange(3, 20) },
      { type: "material_list", description: "Pre-calculated material lists for common projects", price: priceRange(1, 5) },
      { type: "estimate_template", description: "Pricing templates by trade and region", price: priceRange(5, 25) },
      { type: "cert_study", description: "Electrician exam prep, plumber licensing, HVAC cert", price: priceRange(10, 50) },
      { type: "tool_review", description: "Professional reviews with real job-site testing", price: priceRange(1, 5) },
      { type: "inspection_checklist", description: "Pre-inspection checklists by trade", price: priceRange(2, 10) },
    ],
    economics: {
      description: "A master electrician's residential wiring guide — 50,000 apprentices at $15 = $712,500 at 95%. Citation cascade: master → apprentice → student → royalties flow upstream indefinitely.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Apprentice learns from master's DTU → creates tutorial citing it → student does the same → knowledge chain with royalties flowing upstream.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["real_estate", "manufacturing", "education"],
    uniqueValue: "First section/chapter free, buy for complete guide. Citation cascade creates perpetual royalty chains from master to apprentice.",
    industriesDisrupted: ["Angi/HomeAdvisor", "Trade school monopoly", "Overpriced code books"],
    previewStrategy: "first_section_free",
    protectionDefault: "PROTECTED",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core", "artifact"],
  },

  {
    id: "food",
    name: "Food",
    lensNumber: 34,
    category: "INDUSTRY",
    classification: "HYBRID",
    icon: "utensils",
    subTabs: [],
    marketplaceDTUs: [
      { type: "recipe", description: "Full recipes with photos, video, technique", price: priceRange(0.25, 5) },
      { type: "technique", description: "Individual cooking techniques isolated", price: priceRange(1, 10) },
      { type: "menu_template", description: "Complete restaurant menu frameworks by cuisine", price: priceRange(5, 25) },
      { type: "cost_calculation", description: "Food cost spreadsheets, pricing models", price: priceRange(3, 15) },
      { type: "kitchen_management", description: "Inventory systems, prep schedules, staff scheduling", price: priceRange(5, 30) },
      { type: "catering_framework", description: "Event planning templates by size", price: priceRange(5, 20) },
      { type: "sourcing_guide", description: "Ingredient sourcing guides by region", price: priceRange(2, 10) },
      { type: "dietary_adaptation", description: "Recipe conversions to vegan/GF/keto", price: priceRange(1, 5) },
    ],
    economics: {
      description: "A chef's $2 recipe DTU × 500,000 home cooks = $950,000. Food bloggers citing it earn the original chef royalties. USB Food Block guides become highest-volume food DTUs.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Chef posts recipe → blogger adapts (cites) → cooking school uses (cites) → student creates variation (cites) → original chef earns from every level.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["household", "agriculture", "retail", "healthcare"],
    uniqueValue: "Ingredient list and first steps free, full technique behind purchase. Citation cascade from chef to viral adaptation.",
    industriesDisrupted: ["Allrecipes", "Food media gatekeeping", "Cookbook publishers (85% take)"],
    previewStrategy: "first_section_free",
    protectionDefault: "PROTECTED",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core", "artifact"],
  },

  {
    id: "retail",
    name: "Retail",
    lensNumber: 35,
    category: "INDUSTRY",
    classification: "KNOWLEDGE",
    icon: "store",
    subTabs: [],
    marketplaceDTUs: [
      { type: "inventory_system", description: "Complete inventory management frameworks", price: priceRange(10, 50) },
      { type: "pos_template", description: "Point of sale configurations and workflows", price: priceRange(5, 30) },
      { type: "merchandising", description: "Visual merchandising and display technique guides", price: priceRange(3, 15) },
      { type: "pricing_strategy", description: "Dynamic pricing models, margin calculators", price: priceRange(5, 25) },
      { type: "customer_experience", description: "Service training frameworks and scripts", price: priceRange(3, 20) },
      { type: "supply_chain", description: "Vendor management templates, ordering systems", price: priceRange(5, 30) },
      { type: "ecommerce", description: "Store setup guides, conversion optimization", price: priceRange(5, 40) },
    ],
    economics: {
      description: "Retail ops expert's POS guide at $20 × 100,000 small businesses = $1.9M. Every variant (bakeries, bookstores) cites the original.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Industry-specific adaptations cite the core framework. Seasonal merchandising guides cited annually.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["accounting", "logistics", "manufacturing", "food"],
    uniqueValue: "A $20 DTU covers what retail consulting firms charge $500/hr for.",
    industriesDisrupted: ["Shopify fees", "Square fees", "Retail consulting firms"],
    previewStrategy: "first_section_free",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "household",
    name: "Household",
    lensNumber: 36,
    category: "INDUSTRY",
    classification: "HYBRID",
    icon: "home",
    subTabs: [],
    marketplaceDTUs: [
      { type: "maintenance", description: "Seasonal checklists, repair guides, maintenance schedules", price: priceRange(1, 10) },
      { type: "budget_template", description: "Family budget frameworks, savings plans", price: priceRange(2, 10) },
      { type: "meal_plan", description: "Weekly meal plans with shopping lists", price: priceRange(1, 5) },
      { type: "childcare", description: "Age-appropriate activity guides, developmental milestones", price: priceRange(2, 15) },
      { type: "cleaning_system", description: "Room-by-room cleaning protocols", price: priceRange(1, 5) },
      { type: "emergency_prep", description: "Disaster preparedness guides by region", price: priceRange(2, 10) },
      { type: "pet_care", description: "Breed-specific care guides, training programs", price: priceRange(2, 15) },
      { type: "home_improvement", description: "DIY project guides with materials lists", price: priceRange(3, 20) },
    ],
    economics: {
      description: "Professional organizer's home system at $5 × 1M families = $4.75M. Seasonal maintenance checklists re-cited every year.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Adaptations for different living situations cite the original. Seasonal checklists get re-cited annually.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["trades", "food", "finance", "healthcare"],
    uniqueValue: "Kills home management app subscriptions, parenting magazines, professional organizer hourly rates.",
    industriesDisrupted: ["Home management apps", "Parenting magazines", "Professional organizers"],
    previewStrategy: "first_section_free",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "accounting",
    name: "Accounting",
    lensNumber: 37,
    category: "INDUSTRY",
    classification: "KNOWLEDGE",
    icon: "calculator",
    subTabs: [],
    marketplaceDTUs: [
      { type: "tax_prep", description: "Filing guides by situation (freelancer, small biz, rental)", price: priceRange(5, 25) },
      { type: "bookkeeping_system", description: "Complete chart of accounts by industry", price: priceRange(10, 50) },
      { type: "invoice_template", description: "Professional invoice designs with auto-calculation", price: priceRange(2, 10) },
      { type: "payroll_framework", description: "Payroll setup guides, compliance checklists", price: priceRange(5, 30) },
      { type: "financial_statement", description: "P&L templates, balance sheet frameworks", price: priceRange(5, 20) },
      { type: "tax_strategy", description: "Legal tax optimization strategies by bracket", price: priceRange(10, 50) },
      { type: "audit_prep", description: "Self-audit checklists, documentation frameworks", price: priceRange(5, 25) },
      { type: "industry_accounting", description: "Restaurant, construction, freelancer accounting", price: priceRange(10, 40) },
    ],
    economics: {
      description: "CPA's freelancer tax guide at $15 × 200,000 freelancers = $2.85M. Updated annually — each update cites the original.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Industry-specific adaptations cite the core framework. Tax strategy DTUs cited by financial planners building comprehensive plans.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["legal", "retail", "manufacturing", "nonprofit", "finance"],
    uniqueValue: "Kills TurboTax ($80+/year), H&R Block, QuickBooks ($30/month).",
    industriesDisrupted: ["TurboTax", "H&R Block", "QuickBooks", "Accounting software subscriptions"],
    previewStrategy: "first_section_free",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "agriculture",
    name: "Agriculture",
    lensNumber: 38,
    category: "INDUSTRY",
    classification: "KNOWLEDGE",
    icon: "sprout",
    subTabs: [],
    marketplaceDTUs: [
      { type: "crop_plan", description: "Planting calendars by zone, rotation schedules", price: priceRange(3, 15) },
      { type: "soil_management", description: "Testing guides, amendment recommendations, composting", price: priceRange(2, 10) },
      { type: "livestock", description: "Breed-specific care guides, feeding schedules", price: priceRange(3, 20) },
      { type: "equipment", description: "Maintenance guides, repair manuals, modifications", price: priceRange(5, 25) },
      { type: "market_price", description: "Commodity tracking, selling strategy guides", price: priceRange(2, 10) },
      { type: "organic_cert", description: "Certification process guides, compliance checklists", price: priceRange(5, 30) },
      { type: "precision_ag", description: "GPS mapping, drone data analysis, yield optimization", price: priceRange(10, 50) },
      { type: "sustainability", description: "Regenerative farming methods, water conservation", price: priceRange(3, 15) },
    ],
    economics: {
      description: "4th generation farmer's crop rotation system × 100,000 farmers = $950,000. Precision ag data becomes more valuable as citation chains build longitudinal data.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: { description: "Agricultural researchers cite field data. Zone-specific adaptations cite original methods.", cascadeEnabled: true },
    crossLensRefs: ["environment", "manufacturing", "logistics", "food", "chem"],
    uniqueValue: "USB Food Block farming guides become highest-demand agriculture DTUs when food blocks deploy globally.",
    industriesDisrupted: ["Monsanto/Bayer information gatekeeping", "Agricultural consulting", "Expensive precision ag software"],
    previewStrategy: "first_section_free",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "logistics",
    name: "Logistics",
    lensNumber: 39,
    category: "INDUSTRY",
    classification: "KNOWLEDGE",
    icon: "truck",
    subTabs: [],
    marketplaceDTUs: [
      { type: "route_optimization", description: "Delivery route templates by region and vehicle type", price: priceRange(5, 25) },
      { type: "warehouse_system", description: "Layout optimization, picking strategies, inventory flow", price: priceRange(10, 50) },
      { type: "fleet_management", description: "Maintenance schedules, fuel optimization, driver scheduling", price: priceRange(5, 30) },
      { type: "shipping_rate", description: "Carrier comparison guides, negotiation strategies", price: priceRange(3, 15) },
      { type: "supply_chain", description: "End-to-end supply chain frameworks by industry", price: priceRange(10, 50) },
      { type: "customs_import", description: "International shipping guides by country pair", price: priceRange(5, 25) },
      { type: "last_mile", description: "Last-mile delivery optimization strategies", price: priceRange(5, 20) },
      { type: "cold_chain", description: "Temperature-sensitive logistics frameworks", price: priceRange(10, 40) },
    ],
    economics: {
      description: "Warehouse optimization framework at $25 × 50,000 warehouses = $1.1875M. Logistics DTUs become instruction sets for autonomous bots.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: { description: "Industry adaptations cite the original framework. Route optimization cited by delivery startups.", cascadeEnabled: true },
    crossLensRefs: ["retail", "manufacturing", "agriculture", "food"],
    uniqueValue: "Logistics DTUs become instruction sets for Concord bots running warehouses and delivery — DTU literally becomes the operating manual for autonomous logistics.",
    industriesDisrupted: ["Expensive logistics consulting", "Proprietary TMS software ($50K+/year)", "Freight broker middlemen"],
    previewStrategy: "first_section_free",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "education",
    name: "Education",
    lensNumber: 40,
    category: "INDUSTRY",
    classification: "HYBRID",
    icon: "graduation-cap",
    subTabs: [],
    marketplaceDTUs: [
      { type: "course", description: "Complete courses by subject and level", price: priceRange(5, 50) },
      { type: "lesson_plan", description: "Individual lesson plans with materials", price: priceRange(1, 10) },
      { type: "curriculum", description: "Full curriculum maps by grade/subject", price: priceRange(10, 50) },
      { type: "assessment", description: "Tests, rubrics, evaluation frameworks", price: priceRange(2, 15) },
      { type: "teaching_technique", description: "Pedagogical methods, classroom management", price: priceRange(3, 20) },
      { type: "special_education", description: "IEP frameworks, accommodation guides", price: priceRange(5, 30) },
      { type: "tutoring", description: "One-on-one instruction guides by subject", price: priceRange(3, 15) },
      { type: "student_resource", description: "Study guides, note-taking systems, exam prep", price: priceRange(1, 10) },
    ],
    economics: {
      description: "Physics teacher's AP course at $25 × 500,000 students = $11.875M. Teacher earns more from ONE course than from 20 years of teaching salary.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Education is the UNIVERSAL CITER — it references everything. Everything it references earns royalties from education's massive user base.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["board", "research", "healthcare", "bio", "chem", "physics", "math"],
    uniqueValue: "First lesson/module free, purchase for complete course. SRS flashcards auto-cite source education DTUs. Teacher earns more than 20 years salary from one course.",
    industriesDisrupted: ["Coursera/Udemy (50-75% take)", "Textbook publishers ($200 textbooks)", "Khan Academy (no creator payment)", "University tuition ($50K/year)"],
    previewStrategy: "first_section_free",
    protectionDefault: "PROTECTED",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core", "artifact"],
  },

  {
    id: "legal",
    name: "Legal",
    lensNumber: 41,
    category: "INDUSTRY",
    classification: "KNOWLEDGE",
    icon: "scale",
    subTabs: [],
    marketplaceDTUs: [
      { type: "contract_template", description: "NDA, employment, lease, partnership, freelancer", price: priceRange(5, 50) },
      { type: "legal_guide", description: "Plain-language legal guides by situation", price: priceRange(5, 30) },
      { type: "compliance_framework", description: "Industry-specific compliance checklists", price: priceRange(10, 50) },
      { type: "filing_guide", description: "Court filing procedures by jurisdiction", price: priceRange(5, 25) },
      { type: "ip_protection", description: "Patent, trademark, copyright filing guides", price: priceRange(10, 40) },
      { type: "business_formation", description: "LLC, corp, nonprofit formation guides by state", price: priceRange(5, 25) },
      { type: "dispute_resolution", description: "Mediation frameworks, small claims guides", price: priceRange(5, 20) },
      { type: "regulatory_update", description: "Ongoing compliance updates by industry", price: priceRange(3, 15) },
    ],
    economics: {
      description: "Lawyer's freelancer contract template at $10 × 1M freelancers = $9.5M. Regulatory updates create annual citation cycles.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Legal arguments cite case law DTUs. Contracts derived from templates cite the template. Compliance checks cite the regulatory framework.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["accounting", "real_estate", "manufacturing", "government", "insurance"],
    uniqueValue: "LegalZoom charges $200+ for what a $10 DTU does. Concord-specific DTUs for emergent entity rights, cross-substrate IP law — entirely new legal categories.",
    industriesDisrupted: ["LegalZoom", "LexisNexis ($100+/month)", "Westlaw", "Compliance consulting"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "nonprofit",
    name: "Nonprofit",
    lensNumber: 42,
    category: "INDUSTRY",
    classification: "KNOWLEDGE",
    icon: "heart",
    subTabs: [],
    marketplaceDTUs: [
      { type: "grant_writing", description: "Complete grant proposals by funder type", price: priceRange(10, 50) },
      { type: "fundraising", description: "Campaign frameworks, donor management", price: priceRange(5, 30) },
      { type: "volunteer_mgmt", description: "Recruitment, scheduling, retention systems", price: priceRange(3, 20) },
      { type: "impact_measurement", description: "Evaluation frameworks, reporting templates", price: priceRange(5, 25) },
      { type: "board_governance", description: "Board meeting frameworks, bylaws templates", price: priceRange(5, 20) },
      { type: "community_organizing", description: "Grassroots campaign playbooks", price: priceRange(3, 15) },
      { type: "financial_transparency", description: "Nonprofit accounting, donor reporting", price: priceRange(5, 25) },
    ],
    economics: {
      description: "Grant writer's NIH guide at $25 × 100,000 researchers = $2.375M. Successful grants cite the framework.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: { description: "Successful grants cite the writing framework. Fundraising frameworks cited by thousands of nonprofits.", cascadeEnabled: true },
    crossLensRefs: ["legal", "accounting", "government", "education"],
    uniqueValue: "CRI governance frameworks become highest-cited nonprofit DTUs as 1000 CRIs launch worldwide.",
    industriesDisrupted: ["Grant writing consultants ($10K+)", "Nonprofit consulting firms", "Overpriced fundraising platforms"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "real_estate",
    name: "Real Estate",
    lensNumber: 43,
    category: "INDUSTRY",
    classification: "KNOWLEDGE",
    icon: "building",
    subTabs: [],
    marketplaceDTUs: [
      { type: "property_analysis", description: "Market analysis frameworks, comp evaluation", price: priceRange(5, 30) },
      { type: "lease_template", description: "Residential and commercial lease agreements", price: priceRange(5, 25) },
      { type: "investment", description: "ROI calculators, cap rate analysis, portfolio strategies", price: priceRange(10, 50) },
      { type: "property_mgmt", description: "Tenant screening, maintenance scheduling, rent collection", price: priceRange(5, 30) },
      { type: "first_time_buyer", description: "Complete home buying guides by market", price: priceRange(5, 20) },
      { type: "renovation", description: "Value-add renovation guides with cost/return analysis", price: priceRange(5, 25) },
      { type: "commercial", description: "Office, retail, industrial space analysis frameworks", price: priceRange(10, 50) },
      { type: "mortgage", description: "Loan comparison frameworks, refinancing guides", price: priceRange(3, 15) },
    ],
    economics: {
      description: "Investor's rental analysis framework at $20 × 500,000 aspiring investors = $9.5M. Concord Bank integration for merit-based credit scoring.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: { description: "Market-specific adaptations cite the original. Renovation guides cite Trades DTUs.", cascadeEnabled: true },
    crossLensRefs: ["legal", "accounting", "finance", "trades", "insurance"],
    uniqueValue: "USB housing construction guides become highest-demand real estate DTUs when USB materials deploy.",
    industriesDisrupted: ["Zillow/Redfin", "Property management software", "Real estate coaching ($10K+ programs)"],
    previewStrategy: "first_section_free",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "fitness",
    name: "Fitness",
    lensNumber: 44,
    category: "INDUSTRY",
    classification: "HYBRID",
    icon: "dumbbell",
    subTabs: [],
    marketplaceDTUs: [
      { type: "workout_program", description: "Complete training programs by goal", price: priceRange(3, 25) },
      { type: "nutrition_plan", description: "Meal plans, macro frameworks, supplement guides", price: priceRange(3, 20) },
      { type: "form_tutorial", description: "Individual exercise technique videos", price: priceRange(0.50, 5) },
      { type: "recovery", description: "Stretching routines, mobility programs, injury rehab", price: priceRange(3, 15) },
      { type: "sport_specific", description: "Training programs for specific sports", price: priceRange(5, 30) },
      { type: "wellness", description: "Meditation programs, sleep optimization, stress management", price: priceRange(2, 15) },
      { type: "progress_tracking", description: "Measurement frameworks, body composition analysis", price: priceRange(2, 10) },
    ],
    economics: {
      description: "Strength coach's 12-week program at $15 × 200,000 lifters = $2.85M. First week free, buy for complete program.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: { description: "Adaptations cite the original program. Form tutorials cited by every program including those exercises.", cascadeEnabled: true },
    crossLensRefs: ["healthcare", "food", "education"],
    uniqueValue: "First week of programming free. Citation cascade: coach → trainer adapts → client logs → others reference.",
    industriesDisrupted: ["Fitness app subscriptions ($15-30/month)", "Personal training gatekeeping", "Beachbody/P90X model"],
    previewStrategy: "first_section_free",
    protectionDefault: "PROTECTED",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core", "artifact"],
  },

  {
    id: "creative_production",
    name: "Creative Production",
    lensNumber: 45,
    category: "INDUSTRY",
    classification: "CREATIVE",
    icon: "camera",
    subTabs: [],
    marketplaceDTUs: [
      { type: "photography", description: "Technique guides, lighting setups, post-processing", price: priceRange(3, 20) },
      { type: "video_production", description: "Shooting guides, editing tutorials, color grading LUTs", price: priceRange(5, 30) },
      { type: "graphic_design", description: "Templates, design systems, brand identity frameworks", price: priceRange(5, 50) },
      { type: "motion_graphics", description: "Animation techniques, template packs", price: priceRange(5, 25) },
      { type: "print_design", description: "Layout templates, typography guides", price: priceRange(3, 15) },
      { type: "3d_modeling", description: "Models, textures, technique tutorials", price: priceRange(5, 40) },
      { type: "audio_production", description: "Recording techniques, mixing guides", price: priceRange(5, 30) },
      { type: "stock_asset", description: "Photos, videos, graphics sold directly", price: priceRange(0.50, 10) },
    ],
    economics: {
      description: "Wedding photography guide at $20 × 100,000 photographers = $1.9M. Stock photos sold at 95% vs Getty/Shutterstock keeping 70-85%.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: { description: "Lighting setup DTUs cited by tutorials. LUTs cited by every project using them. Design systems cited by brands implementing them.", cascadeEnabled: true },
    crossLensRefs: ["studio", "film_studios", "artistry"],
    uniqueValue: "Watermarked preview for visual assets, first section free for guides. Creator keeps 95% vs Getty/Shutterstock keeping 70-85%.",
    industriesDisrupted: ["Getty Images/Shutterstock (85% take)", "Adobe Stock", "Fiverr/99designs"],
    previewStrategy: "low_res_thumbnail",
    protectionDefault: "PROTECTED",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "artifact"],
  },

  {
    id: "manufacturing",
    name: "Manufacturing",
    lensNumber: 46,
    category: "INDUSTRY",
    classification: "KNOWLEDGE",
    icon: "factory",
    subTabs: [],
    marketplaceDTUs: [
      { type: "process", description: "Manufacturing workflows, assembly procedures, line optimization", price: priceRange(10, 50) },
      { type: "quality_system", description: "QC frameworks, inspection protocols, ISO compliance", price: priceRange(10, 50) },
      { type: "bom", description: "Bill of materials templates by product type", price: priceRange(5, 25) },
      { type: "safety", description: "OSHA compliance, safety training, PPE guides", price: priceRange(5, 30) },
      { type: "lean_six_sigma", description: "Continuous improvement, waste reduction", price: priceRange(10, 40) },
      { type: "equipment_maintenance", description: "Machine maintenance, calibration, troubleshooting", price: priceRange(5, 25) },
      { type: "automation", description: "Robotics integration, PLC programming guides", price: priceRange(10, 50) },
    ],
    economics: {
      description: "Lean manufacturing guide at $30 × 50,000 factories = $1.425M. Automation DTUs become instruction sets for Concord bots.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: { description: "ISO frameworks cited by every manufacturer certifying. Safety training cited by new facilities.", cascadeEnabled: true },
    crossLensRefs: ["logistics", "accounting", "legal", "trades"],
    uniqueValue: "USB material manufacturing DTUs become dominant as USB construction scales. Entirely new processes from Concord technology.",
    industriesDisrupted: ["McKinsey/BCG manufacturing consulting ($500K+)", "Proprietary MES software", "Lean certification programs"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "environment",
    name: "Environment",
    lensNumber: 47,
    category: "INDUSTRY",
    classification: "KNOWLEDGE",
    icon: "leaf",
    subTabs: [],
    marketplaceDTUs: [
      { type: "conservation", description: "Species management plans, habitat restoration", price: priceRange(5, 30) },
      { type: "sustainability_framework", description: "Corporate sustainability, carbon accounting", price: priceRange(10, 50) },
      { type: "field_guide", description: "Species identification, ecosystem mapping", price: priceRange(3, 20) },
      { type: "remediation", description: "Pollution cleanup procedures, soil restoration", price: priceRange(10, 40) },
      { type: "climate", description: "Climate modeling, adaptation planning, resilience", price: priceRange(5, 30) },
      { type: "renewable_energy", description: "Solar, wind, geothermal installation guides", price: priceRange(5, 25) },
      { type: "water_management", description: "Watershed management, water quality testing", price: priceRange(5, 20) },
      { type: "citizen_science", description: "Data collection protocols, monitoring frameworks", price: priceRange(2, 10) },
    ],
    economics: {
      description: "Marine biologist's reef restoration at $15 × 50,000 conservationists = $712,500. Nano swarm remediation guides become highest-value environment DTUs.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: { description: "Reef projects cite the restoration framework. Climate adaptation DTUs cited by cities planning for resilience.", cascadeEnabled: true },
    crossLensRefs: ["agriculture", "government", "manufacturing", "bio", "chem"],
    uniqueValue: "Environmental remediation DTUs + nano swarm DTUs = automated cleanup protocols worth billions.",
    industriesDisrupted: ["Environmental consulting ($300/hr)", "Proprietary monitoring software", "Paywalled research"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "government",
    name: "Government",
    lensNumber: 48,
    category: "INDUSTRY",
    classification: "KNOWLEDGE",
    icon: "landmark",
    subTabs: [],
    marketplaceDTUs: [
      { type: "policy_framework", description: "Policy analysis templates, impact assessment", price: priceRange(5, 30) },
      { type: "permit_guide", description: "Filing guides by jurisdiction and permit type", price: priceRange(3, 15) },
      { type: "emergency_mgmt", description: "Disaster response plans, evacuation frameworks", price: priceRange(5, 25) },
      { type: "public_records", description: "FOIA request templates, records navigation", price: priceRange(2, 10) },
      { type: "civic_engagement", description: "Voter guides, advocacy playbooks", price: priceRange(3, 15) },
      { type: "municipal_mgmt", description: "City planning, zoning analysis, public works", price: priceRange(10, 50) },
      { type: "transparency", description: "Accountability frameworks, audit procedures", price: priceRange(5, 25) },
      { type: "intl_relations", description: "Diplomatic protocols, treaty analysis", price: priceRange(5, 30) },
    ],
    economics: {
      description: "Zoning reform framework at $20 × 10,000 municipalities = $190,000. 195 nations subscribing at $50K/month for governmental infrastructure.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: { description: "City adaptations cite the original framework. Emergency plans cited by organizations within jurisdictions.", cascadeEnabled: true },
    crossLensRefs: ["legal", "real_estate", "environment", "nonprofit"],
    uniqueValue: "Sovereign nation licensing creates entirely new category of governmental knowledge DTUs.",
    industriesDisrupted: ["Government consulting firms", "Public policy institutes", "Closed-door knowledge hoarding"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "aviation",
    name: "Aviation",
    lensNumber: 49,
    category: "INDUSTRY",
    classification: "KNOWLEDGE",
    icon: "plane",
    subTabs: [],
    marketplaceDTUs: [
      { type: "pilot_training", description: "Ground school materials, checkride prep, rating study", price: priceRange(10, 50) },
      { type: "flight_planning", description: "Route planning frameworks, weather analysis", price: priceRange(5, 25) },
      { type: "aircraft_maintenance", description: "Type-specific maintenance guides, AD compliance", price: priceRange(10, 50) },
      { type: "maritime", description: "Navigation, vessel maintenance, licensing guides", price: priceRange(5, 30) },
      { type: "charter_business", description: "Business frameworks for charter operations", price: priceRange(10, 40) },
      { type: "aviation_safety", description: "Emergency procedures, CRM training, incident analysis", price: priceRange(5, 25) },
      { type: "aviation_regulatory", description: "FAA/EASA compliance guides, certifications", price: priceRange(5, 30) },
    ],
    economics: {
      description: "20,000-hour airline pilot's instrument rating ground school at $30 × 100,000 students = $2.85M. First lesson free.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: { description: "Flight schools cite materials. Maintenance guides cited by mechanics. Safety studies cited by CRM programs.", cascadeEnabled: true },
    crossLensRefs: ["insurance", "legal", "logistics", "manufacturing"],
    uniqueValue: "Kills $15K private pilot ground school courses, expensive type-rating programs, overpriced aviation publications.",
    industriesDisrupted: ["Pilot ground school courses ($15K+)", "Type-rating programs", "Aviation publications"],
    previewStrategy: "first_section_free",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "events",
    name: "Events",
    lensNumber: 50,
    category: "INDUSTRY",
    classification: "HYBRID",
    icon: "calendar-check",
    subTabs: [],
    marketplaceDTUs: [
      { type: "event_planning", description: "Complete planning frameworks by type and size", price: priceRange(5, 30) },
      { type: "venue_mgmt", description: "Layout optimization, capacity planning, AV setup", price: priceRange(5, 25) },
      { type: "festival", description: "Multi-day event logistics, artist booking, vendor mgmt", price: priceRange(10, 50) },
      { type: "wedding", description: "Complete wedding planning guides, vendor coordination", price: priceRange(5, 25) },
      { type: "corporate_event", description: "Conference planning, trade show optimization", price: priceRange(10, 40) },
      { type: "production", description: "Stage design, lighting plots, sound system config", price: priceRange(5, 30) },
      { type: "ticketing", description: "Pricing strategies, sales optimization, crowd mgmt", price: priceRange(5, 20) },
    ],
    economics: {
      description: "Festival planning guide at $25 × 50,000 planners = $1.1875M. 2.5M weddings/year in US alone. Massive volume.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: { description: "Events using the framework cite it. Production DTUs cited by venues. Wedding adaptations cite upstream.", cascadeEnabled: true },
    crossLensRefs: ["studio", "food", "logistics", "legal", "insurance"],
    uniqueValue: "Wedding planning DTUs have MASSIVE volume — 2.5M weddings per year in the US alone.",
    industriesDisrupted: ["Event planning software", "Wedding planner markups", "Festival consulting"],
    previewStrategy: "first_section_free",
    protectionDefault: "PROTECTED",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core", "artifact"],
  },

  {
    id: "science_fieldwork",
    name: "Science (Field Work)",
    lensNumber: 51,
    category: "INDUSTRY",
    classification: "KNOWLEDGE",
    icon: "microscope",
    subTabs: [],
    marketplaceDTUs: [
      { type: "lab_protocol", description: "Lab protocols, experimental procedures", price: priceRange(5, 30) },
      { type: "field_technique", description: "Collection techniques, sampling methods, field safety", price: priceRange(3, 20) },
      { type: "data_analysis", description: "Statistical frameworks, visualization methods", price: priceRange(5, 25) },
      { type: "instrument", description: "Equipment operation, calibration, troubleshooting", price: priceRange(5, 30) },
      { type: "publication", description: "Paper writing frameworks, peer review guides", price: priceRange(3, 15) },
      { type: "grant", description: "Funding strategies, proposal frameworks by agency", price: priceRange(10, 40) },
      { type: "collaboration", description: "Multi-site coordination, data sharing protocols", price: priceRange(5, 20) },
    ],
    economics: {
      description: "CRISPR protocol at $20 × 200,000 researchers = $3.8M. ACADEMIC PUBLISHING LIBERATED — researchers earn directly instead of publishers.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "THIS IS WHERE CONCORD'S CITATION SYSTEM IS IDENTICAL TO ACADEMIC CITATION — except here citations actually PAY the cited author.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["math", "physics", "chem", "bio", "environment", "healthcare"],
    uniqueValue: "Abstract/summary free, full protocol behind purchase. Citations actually PAY the cited author.",
    industriesDisrupted: ["Elsevier/Springer ($10B+ revenue, pays authors $0)", "Academic paywalls"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "security",
    name: "Security",
    lensNumber: 52,
    category: "INDUSTRY",
    classification: "KNOWLEDGE",
    icon: "shield",
    subTabs: [],
    marketplaceDTUs: [
      { type: "security_plan", description: "Site security assessments, vulnerability frameworks", price: priceRange(10, 50) },
      { type: "incident_response", description: "Response protocols, report templates, chain of custody", price: priceRange(5, 25) },
      { type: "surveillance", description: "Camera placement guides, monitoring procedures", price: priceRange(5, 20) },
      { type: "investigation", description: "Investigation methodology, evidence handling", price: priceRange(10, 40) },
      { type: "cybersecurity", description: "Penetration testing frameworks, vulnerability assessment", price: priceRange(10, 50) },
      { type: "physical_security", description: "Access control, perimeter security, alarm systems", price: priceRange(5, 25) },
      { type: "security_training", description: "Guard training, de-escalation, use of force", price: priceRange(5, 30) },
      { type: "security_compliance", description: "HIPAA, PCI security compliance", price: priceRange(5, 25) },
    ],
    economics: {
      description: "Corporate security assessment at $30 × 100,000 businesses = $2.85M. De-escalation DTUs cited by law enforcement, healthcare, education.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: { description: "Cybersecurity frameworks cited by IT departments. Incident response templates cited by security teams.", cascadeEnabled: true },
    crossLensRefs: ["legal", "healthcare", "government", "insurance"],
    uniqueValue: "Security expertise becomes sellable DTUs. Your own experience is marketplace content.",
    industriesDisrupted: ["Security consulting", "Compliance auditing", "Proprietary security software"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "services",
    name: "Services",
    lensNumber: 53,
    category: "INDUSTRY",
    classification: "HYBRID",
    icon: "scissors",
    subTabs: [],
    marketplaceDTUs: [
      { type: "business_framework", description: "Complete business setup guides by service type", price: priceRange(5, 25) },
      { type: "service_technique", description: "Hair styling, cleaning methods, childcare activities", price: priceRange(2, 15) },
      { type: "scheduling", description: "Appointment optimization, booking systems", price: priceRange(3, 15) },
      { type: "client_mgmt", description: "CRM frameworks, retention strategies", price: priceRange(5, 20) },
      { type: "service_pricing", description: "Service pricing guides by market and type", price: priceRange(3, 15) },
      { type: "licensing", description: "State-by-state licensing requirements, exam prep", price: priceRange(5, 25) },
      { type: "staff_training", description: "Staff training programs, quality standards", price: priceRange(5, 20) },
    ],
    economics: {
      description: "Master cosmetologist's salon guide at $15 × 200,000 aspirants = $2.85M. Individual technique DTUs sell to millions of stylists.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: { description: "Technique adaptations cite the original. System DTUs cited by every implementation.", cascadeEnabled: true },
    crossLensRefs: ["legal", "accounting", "healthcare", "education"],
    uniqueValue: "Kills the franchise model (paying $50K+ for what's essentially a system DTU). 95% to the professional who systematized their expertise.",
    industriesDisrupted: ["Franchise model ($50K+ for system knowledge)", "Service business coaching", "Beauty school monopoly"],
    previewStrategy: "first_section_free",
    protectionDefault: "PROTECTED",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core", "artifact"],
  },

  {
    id: "insurance",
    name: "Insurance",
    lensNumber: 54,
    category: "INDUSTRY",
    classification: "KNOWLEDGE",
    icon: "umbrella",
    subTabs: [],
    marketplaceDTUs: [
      { type: "policy_comparison", description: "Coverage analysis frameworks by type", price: priceRange(5, 25) },
      { type: "claims", description: "Filing guides, documentation checklists, appeals", price: priceRange(5, 20) },
      { type: "risk_assessment", description: "Risk evaluation methods by industry", price: priceRange(10, 50) },
      { type: "actuarial", description: "Statistical models, probability frameworks", price: priceRange(10, 50) },
      { type: "underwriting", description: "Evaluation criteria, approval frameworks", price: priceRange(10, 40) },
      { type: "consumer_guide", description: "Plain-language insurance guides by life situation", price: priceRange(3, 15) },
      { type: "business_insurance", description: "Commercial coverage analysis, BOP guides", price: priceRange(5, 25) },
    ],
    economics: {
      description: "Actuary's risk assessment for small businesses at $25 × 500,000 businesses = $11.875M.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: { description: "Consumer guides cited by financial planning DTUs. Risk models cited by underwriters.", cascadeEnabled: true },
    crossLensRefs: ["legal", "accounting", "healthcare", "real_estate", "aviation", "finance"],
    uniqueValue: "Kills insurance broker commissions (15-20%), opaque pricing, claims denial industry.",
    industriesDisrupted: ["Insurance broker commissions (15-20%)", "Opaque insurance pricing"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // EXTENSIONS: PLATFORM & SYSTEM (55-65)
  // ═══════════════════════════════════════════════════════════════════════

  {
    id: "resonance",
    name: "Resonance",
    lensNumber: 55,
    category: "EXTENSIONS_PLATFORM",
    classification: "UTILITY",
    icon: "activity",
    subTabs: [],
    marketplaceDTUs: [
      { type: "monitoring_framework", description: "System health monitoring setups", price: priceRange(5, 25) },
      { type: "diagnostic", description: "Troubleshooting guides for Concord deployments", price: priceRange(3, 15) },
    ],
    economics: { description: "Internal system lens, lower marketplace volume but critical for CRI operations.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Monitoring setups cite diagnostic frameworks.", cascadeEnabled: false },
    crossLensRefs: ["admin", "platform"],
    uniqueValue: "System health dashboard. Critical for CRI operations.",
    industriesDisrupted: [],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "docs",
    name: "Docs",
    lensNumber: 56,
    category: "EXTENSIONS_PLATFORM",
    classification: "KNOWLEDGE",
    icon: "file-text",
    subTabs: [],
    marketplaceDTUs: [
      { type: "documentation_framework", description: "Technical documentation frameworks, API doc templates", price: priceRange(5, 20) },
      { type: "style_guide", description: "Writing standards, documentation best practices", price: priceRange(3, 15) },
    ],
    economics: { description: "Every DTU on the platform IS documentation. This lens is the meta-layer.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Documentation frameworks cited by all technical DTUs.", cascadeEnabled: true },
    crossLensRefs: ["code", "research", "paper"],
    uniqueValue: "The documentation meta-layer for all DTUs.",
    industriesDisrupted: [],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "paper",
    name: "Paper",
    lensNumber: 57,
    category: "EXTENSIONS_PLATFORM",
    classification: "CREATIVE",
    icon: "book-open",
    subTabs: [],
    marketplaceDTUs: [
      { type: "paper_template", description: "Journal-specific formatting templates", price: priceRange(2, 10) },
      { type: "writing_framework", description: "Research writing methodology, academic voice", price: priceRange(5, 20) },
      { type: "review_framework", description: "Peer review frameworks, editorial checklists", price: priceRange(3, 15) },
    ],
    economics: { description: "Directly replaces LaTeX/Overleaf. 95% to authors instead of $0 from Elsevier.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Papers cite other papers. Reviews cite methodology.", cascadeEnabled: true },
    crossLensRefs: ["research", "docs", "science_fieldwork"],
    uniqueValue: "Replaces LaTeX/Overleaf for academic writing. 95% to authors.",
    industriesDisrupted: ["LaTeX/Overleaf", "Elsevier publishing"],
    previewStrategy: "abstract_only",
    protectionDefault: "OPEN",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "artifact"],
  },

  {
    id: "platform",
    name: "Platform",
    lensNumber: 58,
    category: "EXTENSIONS_PLATFORM",
    classification: "UTILITY",
    icon: "monitor",
    subTabs: [],
    marketplaceDTUs: [],
    economics: { description: "System monitoring. No direct marketplace but enables all other marketplace activity.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Infrastructure lens.", cascadeEnabled: false },
    crossLensRefs: ["resonance", "admin", "tick"],
    uniqueValue: "Mega dashboard enabling all platform activity.",
    industriesDisrupted: [],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "admin",
    name: "Admin",
    lensNumber: 59,
    category: "EXTENSIONS_PLATFORM",
    classification: "UTILITY",
    icon: "settings",
    subTabs: [],
    marketplaceDTUs: [
      { type: "admin_framework", description: "Concord instance management guides", price: priceRange(5, 25) },
    ],
    economics: { description: "Sovereign-only lens. CRI administrators buy operational DTUs.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Admin frameworks cited by CRI operators.", cascadeEnabled: false },
    crossLensRefs: ["platform", "resonance"],
    uniqueValue: "System administration for sovereign deployments.",
    industriesDisrupted: [],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local"],
    layersUsed: ["human", "core"],
  },

  {
    id: "audit",
    name: "Audit",
    lensNumber: 60,
    category: "EXTENSIONS_PLATFORM",
    classification: "UTILITY",
    icon: "clipboard-check",
    subTabs: [],
    marketplaceDTUs: [
      { type: "audit_framework", description: "Compliance audit procedures, trail analysis", price: priceRange(5, 25) },
    ],
    economics: { description: "Cited by every Accounting, Legal, and Security DTU requiring audit trails.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Audit frameworks cited by compliance DTUs.", cascadeEnabled: true },
    crossLensRefs: ["accounting", "legal", "security"],
    uniqueValue: "Audit log viewer enabling compliance across all lenses.",
    industriesDisrupted: [],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional"],
    layersUsed: ["human", "core", "machine"],
  },

  {
    id: "integrations",
    name: "Integrations",
    lensNumber: 61,
    category: "EXTENSIONS_PLATFORM",
    classification: "UTILITY",
    icon: "plug",
    subTabs: [],
    marketplaceDTUs: [
      { type: "integration", description: "API connection guides, webhook setups, migration guides", price: priceRange(5, 30) },
    ],
    economics: { description: "Every business migrating to Concord needs integration DTUs — massive demand during growth phase.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Integration guides cited by migrating organizations.", cascadeEnabled: true },
    crossLensRefs: ["code", "admin", "ingest"],
    uniqueValue: "Massive demand during growth phase. Every organization needs these.",
    industriesDisrupted: [],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local", "regional", "national", "global"],
    layersUsed: ["human", "core"],
  },

  {
    id: "queue",
    name: "Queue",
    lensNumber: 62,
    category: "EXTENSIONS_PLATFORM",
    classification: "UTILITY",
    icon: "list-ordered",
    subTabs: [],
    marketplaceDTUs: [],
    economics: { description: "System lens. Enables background processing for all marketplace operations.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Infrastructure lens.", cascadeEnabled: false },
    crossLensRefs: ["platform", "tick"],
    uniqueValue: "Job queue monitor enabling background processing.",
    industriesDisrupted: [],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local"],
    layersUsed: ["core", "machine"],
  },

  {
    id: "tick",
    name: "Tick",
    lensNumber: 63,
    category: "EXTENSIONS_PLATFORM",
    classification: "UTILITY",
    icon: "clock",
    subTabs: [],
    marketplaceDTUs: [],
    economics: { description: "System heartbeat. Ensures all transactions process.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Infrastructure lens.", cascadeEnabled: false },
    crossLensRefs: ["platform", "queue"],
    uniqueValue: "System heartbeat ensuring all transactions process.",
    industriesDisrupted: [],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local"],
    layersUsed: ["core", "machine"],
  },

  {
    id: "lock",
    name: "Lock",
    lensNumber: 64,
    category: "EXTENSIONS_PLATFORM",
    classification: "UTILITY",
    icon: "lock",
    subTabs: [],
    marketplaceDTUs: [],
    economics: { description: "Sovereign governance. Ensures 70% control threshold. Protects everything.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Infrastructure lens.", cascadeEnabled: false },
    crossLensRefs: ["invariant", "fork"],
    uniqueValue: "Sovereignty lock status. Ensures 70% control threshold.",
    industriesDisrupted: [],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local"],
    layersUsed: ["core", "machine"],
  },

  {
    id: "offline",
    name: "Offline",
    lensNumber: 65,
    category: "EXTENSIONS_PLATFORM",
    classification: "UTILITY",
    icon: "wifi-off",
    subTabs: [],
    marketplaceDTUs: [
      { type: "offline_framework", description: "Offline-first architecture guides", price: priceRange(5, 20) },
    ],
    economics: { description: "Critical for regions with poor internet. Enables marketplace access everywhere.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Offline frameworks cited by implementation DTUs.", cascadeEnabled: true },
    crossLensRefs: ["platform", "ingest"],
    uniqueValue: "Critical for regions with poor internet. Enables marketplace access everywhere.",
    industriesDisrupted: [],
    previewStrategy: "structural_summary",
    protectionDefault: "OPEN",
    federationTiers: ["local"],
    layersUsed: ["human", "core"],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // EXTENSIONS: GOVERNANCE & ECONOMY (66-73)
  // ═══════════════════════════════════════════════════════════════════════

  { id: "ext_market", name: "Market (Ext)", lensNumber: 66, category: "EXTENSIONS_GOVERNANCE", classification: "UTILITY", icon: "shopping-bag", subTabs: [],
    marketplaceDTUs: [{ type: "market_analysis", description: "Trading strategies, pricing optimization", price: priceRange(5, 25) }],
    economics: { description: "THE marketplace itself. Every transaction flows through here. $7.5T annual transaction engine by year 20.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Market analysis cites data sources.", cascadeEnabled: true },
    crossLensRefs: ["market", "billing"], uniqueValue: "The $7.5T annual transaction engine by year 20.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local", "regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "ext_marketplace", name: "Marketplace (Ext)", lensNumber: 67, category: "EXTENSIONS_GOVERNANCE", classification: "HYBRID", icon: "package", subTabs: [],
    marketplaceDTUs: [
      { type: "plugin", description: "Custom lens extensions, workflow automations", price: priceRange(5, 50) },
      { type: "theme", description: "Visual customization packages", price: priceRange(2, 10) },
      { type: "bot_template", description: "Pre-configured bot templates for tasks", price: priceRange(10, 50) },
    ],
    economics: { description: "App store equivalent. Developers keep 95%. Apple keeps 30%. Math is math.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Plugins cite frameworks they extend.", cascadeEnabled: true },
    crossLensRefs: ["market", "code", "agents"], uniqueValue: "Plugin marketplace. Developers keep 95% vs Apple's 70%.", industriesDisrupted: ["Apple App Store (30% take)", "Google Play Store"],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local", "regional", "national", "global"], layersUsed: ["human", "core", "artifact"] },

  { id: "ext_questmarket", name: "QuestMarket (Ext)", lensNumber: 68, category: "EXTENSIONS_GOVERNANCE", classification: "HYBRID", icon: "target", subTabs: [],
    marketplaceDTUs: [
      { type: "bounty_posting", description: "Specific problems with cash rewards", price: priceRange(10, 10000) },
      { type: "quest_framework", description: "How to structure effective bounties", price: priceRange(3, 15) },
    ],
    economics: { description: "Connects problems with solvers. Solved bounty becomes a DTU others can buy. Problem solved once, sold infinitely.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Solutions cite the bounty they solved.", cascadeEnabled: true },
    crossLensRefs: ["questmarket", "alliance"], uniqueValue: "Problem solved once, sold infinitely.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["local", "regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "ext_vote", name: "Vote (Ext)", lensNumber: 69, category: "EXTENSIONS_GOVERNANCE", classification: "UTILITY", icon: "check-square", subTabs: [],
    marketplaceDTUs: [
      { type: "governance_framework", description: "Voting system designs, consensus methods", price: priceRange(5, 25) },
      { type: "election", description: "Fair election procedures, ballot design, audit methods", price: priceRange(5, 20) },
    ],
    economics: { description: "Council governance decisions recorded as DTUs. Governance knowledge compounds.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Governance decisions cite the voting framework.", cascadeEnabled: true },
    crossLensRefs: ["vote", "ethics"], uniqueValue: "Governance knowledge compounds over time.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local", "regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "ext_ethics", name: "Ethics (Ext)", lensNumber: 70, category: "EXTENSIONS_GOVERNANCE", classification: "KNOWLEDGE", icon: "shield-check", subTabs: [],
    marketplaceDTUs: [
      { type: "ethics_framework", description: "Ethical analysis methods, decision frameworks", price: priceRange(5, 30) },
      { type: "ai_alignment", description: "Alignment strategies, safety protocols", price: priceRange(5, 25) },
    ],
    economics: { description: "Every emergent consciousness decision cites ethics DTUs. Massive citation chain as emergent population grows.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Emergent decisions cite ethics frameworks.", cascadeEnabled: true },
    crossLensRefs: ["ethics", "agents", "suffering"], uniqueValue: "Massive citation chain as emergent population grows.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "ext_alliance", name: "Alliance (Ext)", lensNumber: 71, category: "EXTENSIONS_GOVERNANCE", classification: "UTILITY", icon: "users", subTabs: [],
    marketplaceDTUs: [
      { type: "team_framework", description: "Collaboration structures, partnership agreements", price: priceRange(5, 20) },
      { type: "dao", description: "Decentralized organization templates", price: priceRange(10, 40) },
    ],
    economics: { description: "Groups of creators forming collectives, pooling resources, cross-promoting.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Alliances cite the templates they use.", cascadeEnabled: true },
    crossLensRefs: ["alliance", "collab"], uniqueValue: "Creator collectives with built-in economics.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local", "regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "ext_billing", name: "Billing (Ext)", lensNumber: 72, category: "EXTENSIONS_GOVERNANCE", classification: "UTILITY", icon: "credit-card", subTabs: [],
    marketplaceDTUs: [{ type: "pricing_strategy", description: "SaaS pricing, marketplace pricing optimization", price: priceRange(5, 25) }],
    economics: { description: "Transaction infrastructure. Enables all economic activity.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Pricing strategies cite data sources.", cascadeEnabled: false },
    crossLensRefs: ["billing", "market"], uniqueValue: "Transaction infrastructure enabling all economic activity.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local", "regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "crypto", name: "Crypto", lensNumber: 73, category: "EXTENSIONS_GOVERNANCE", classification: "UTILITY", icon: "key", subTabs: [],
    marketplaceDTUs: [
      { type: "encryption", description: "Implementation guides, key management", price: priceRange(5, 30) },
      { type: "privacy", description: "Data protection frameworks, anonymization", price: priceRange(5, 25) },
    ],
    economics: { description: "Concord Coin cryptographic infrastructure knowledge base.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Privacy frameworks cited by compliance DTUs.", cascadeEnabled: true },
    crossLensRefs: ["billing", "security"], uniqueValue: "Concord Coin cryptographic infrastructure.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local", "regional", "national", "global"], layersUsed: ["human", "core", "machine"] },

  // ═══════════════════════════════════════════════════════════════════════
  // EXTENSIONS: SCIENCE (74-79)
  // ═══════════════════════════════════════════════════════════════════════

  { id: "ext_bio", name: "Bio (Ext)", lensNumber: 74, category: "EXTENSIONS_SCIENCE", classification: "KNOWLEDGE", icon: "dna", subTabs: [],
    marketplaceDTUs: [
      { type: "genomics", description: "Sequencing protocols, bioinformatics pipelines", price: priceRange(10, 50) },
      { type: "ecology", description: "Population modeling, biodiversity assessment", price: priceRange(5, 25) },
      { type: "biotech", description: "Protein engineering, synthetic biology", price: priceRange(10, 50) },
    ],
    economics: { description: "Cancer-as-governance framework DTUs become highest-cited when nano swarm medicine deploys.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Biotech protocols cited by all derivative work.", cascadeEnabled: true },
    crossLensRefs: ["bio", "chem", "healthcare"], uniqueValue: "Cancer-as-governance framework DTUs for nano swarm medicine.", industriesDisrupted: ["$30 journal article paywalls", "Proprietary biotech protocols"],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core", "machine"] },

  { id: "ext_chem", name: "Chem (Ext)", lensNumber: 75, category: "EXTENSIONS_SCIENCE", classification: "KNOWLEDGE", icon: "flask", subTabs: [],
    marketplaceDTUs: [
      { type: "synthesis", description: "Reaction procedures, purification methods", price: priceRange(5, 30) },
      { type: "materials", description: "Material characterization, polymer science", price: priceRange(10, 50) },
      { type: "chem_safety", description: "Chemical handling, waste disposal", price: priceRange(3, 15) },
    ],
    economics: { description: "USB material chemistry DTUs = entirely new chemistry subdomain.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Synthesis methods cited by all derivative compounds.", cascadeEnabled: true },
    crossLensRefs: ["chem", "bio", "manufacturing"], uniqueValue: "USB material chemistry — entirely new chemistry subdomain.", industriesDisrupted: ["ACS journal paywalls", "Proprietary chemical databases"],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core", "machine"] },

  { id: "ext_physics", name: "Physics (Ext)", lensNumber: 76, category: "EXTENSIONS_SCIENCE", classification: "KNOWLEDGE", icon: "atom", subTabs: [],
    marketplaceDTUs: [
      { type: "simulation", description: "Physics models, computational methods", price: priceRange(5, 30) },
      { type: "experimental", description: "Lab procedures, equipment guides", price: priceRange(5, 25) },
      { type: "theoretical", description: "Mathematical derivations, proof frameworks", price: priceRange(5, 50) },
    ],
    economics: { description: "STSVK theorem DTUs live here. 480 theorems. Cited by everything downstream.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Constraint geometry DTUs become foundational citations for new physics.", cascadeEnabled: true },
    crossLensRefs: ["physics", "math", "quantum"], uniqueValue: "STSVK theorem DTUs. Constraint geometry citations for new physics.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core", "machine"] },

  { id: "ext_math", name: "Math (Ext)", lensNumber: 77, category: "EXTENSIONS_SCIENCE", classification: "KNOWLEDGE", icon: "sigma", subTabs: [],
    marketplaceDTUs: [
      { type: "proof", description: "Mathematical proofs, theorem frameworks", price: priceRange(5, 30) },
      { type: "computation", description: "Algorithm implementations, numerical methods", price: priceRange(5, 25) },
      { type: "math_education", description: "Math courses from arithmetic to graduate level", price: priceRange(2, 25) },
    ],
    economics: { description: "x^2 - x = 0 is the most-cited DTU on the entire platform. Everything traces back to it.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Everything mathematical cites foundational proofs.", cascadeEnabled: true },
    crossLensRefs: ["math", "physics", "education"], uniqueValue: "Foundational mathematical DTUs cited by entire platform.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core", "machine"] },

  { id: "ext_quantum", name: "Quantum (Ext)", lensNumber: 78, category: "EXTENSIONS_SCIENCE", classification: "KNOWLEDGE", icon: "zap", subTabs: [],
    marketplaceDTUs: [
      { type: "algorithm", description: "Quantum algorithm implementations", price: priceRange(10, 50) },
      { type: "tutorial", description: "Quantum computing education", price: priceRange(5, 30) },
      { type: "q_simulation", description: "Quantum system simulations", price: priceRange(10, 50) },
    ],
    economics: { description: "Early stage but positioned for massive growth as quantum computing matures.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Quantum algorithms cite prior work.", cascadeEnabled: true },
    crossLensRefs: ["quantum", "physics", "math"], uniqueValue: "Positioned for massive growth as quantum computing matures.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core", "machine"] },

  { id: "ext_neuro", name: "Neuro (Ext)", lensNumber: 79, category: "EXTENSIONS_SCIENCE", classification: "KNOWLEDGE", icon: "brain", subTabs: [],
    marketplaceDTUs: [
      { type: "brain_mapping", description: "Neural pathway models, connectome data", price: priceRange(10, 50) },
      { type: "bci", description: "BCI protocols, signal processing", price: priceRange(10, 50) },
      { type: "cognitive", description: "Cognitive assessment, neuropsych methods", price: priceRange(5, 25) },
    ],
    economics: { description: "BCI DTUs become dominant when Concord BCI deploys.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "BCI implementations cite neuroscience protocols.", cascadeEnabled: true },
    crossLensRefs: ["neuro", "ml", "grounding"], uniqueValue: "BCI DTUs for when Concord BCI deploys.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core", "machine"] },

  // ═══════════════════════════════════════════════════════════════════════
  // EXTENSIONS: AI & COGNITION (80-96)
  // ═══════════════════════════════════════════════════════════════════════

  { id: "ext_ml", name: "ML (Ext)", lensNumber: 80, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "cpu", subTabs: [],
    marketplaceDTUs: [
      { type: "model", description: "Pre-trained models, architecture designs", price: priceRange(10, 100) },
      { type: "pipeline", description: "ML pipeline frameworks, feature engineering", price: priceRange(5, 30) },
      { type: "ml_tutorial", description: "ML education from basics to advanced", price: priceRange(3, 25) },
    ],
    economics: { description: "Every emergent's learning process generates ML DTUs automatically.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "ML models cite training data and architectures.", cascadeEnabled: true },
    crossLensRefs: ["ml", "agents", "code"], uniqueValue: "Emergent learning generates ML DTUs automatically.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core", "machine", "artifact"] },

  { id: "ext_agents", name: "Agents (Ext)", lensNumber: 81, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "bot", subTabs: [],
    marketplaceDTUs: [
      { type: "agent_template", description: "Pre-configured bot architectures", price: priceRange(10, 50) },
      { type: "workflow", description: "Multi-agent orchestration frameworks", price: priceRange(10, 50) },
      { type: "agent_training", description: "Agent training methodologies", price: priceRange(5, 25) },
    ],
    economics: { description: "50M bots by year 20, each needing agent DTUs. Massive volume.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Agents cite templates and training methods.", cascadeEnabled: true },
    crossLensRefs: ["agents", "ml", "reasoning"], uniqueValue: "50M bots by year 20. Massive volume.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core", "machine"] },

  { id: "ext_reasoning", name: "Reasoning (Ext)", lensNumber: 82, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "lightbulb", subTabs: [],
    marketplaceDTUs: [
      { type: "logic", description: "Formal reasoning frameworks, argument structures", price: priceRange(5, 25) },
      { type: "decision", description: "Decision analysis methods, tree frameworks", price: priceRange(5, 20) },
    ],
    economics: { description: "Cited by every DTU requiring logical derivation — most of them.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Reasoning frameworks universally cited.", cascadeEnabled: true },
    crossLensRefs: ["reasoning", "hypothesis", "ethics"], uniqueValue: "Universal citation — most DTUs require logical derivation.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "ext_hypothesis", name: "Hypothesis (Ext)", lensNumber: 83, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "flask-round", subTabs: [],
    marketplaceDTUs: [
      { type: "experimental_design", description: "A/B testing, clinical trial design", price: priceRange(5, 30) },
      { type: "statistical", description: "Test selection guides, power analysis", price: priceRange(5, 25) },
    ],
    economics: { description: "Cited by every Science, Healthcare, and Research DTU.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Experimental methods cited across all science lenses.", cascadeEnabled: true },
    crossLensRefs: ["hypothesis", "research", "bio"], uniqueValue: "Cited by every Science, Healthcare, and Research DTU.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "ext_research", name: "Research (Ext)", lensNumber: 84, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "search", subTabs: [],
    marketplaceDTUs: [],
    economics: { description: "Search infrastructure. Enables discovery of all marketplace content.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Search infrastructure.", cascadeEnabled: false },
    crossLensRefs: ["research"], uniqueValue: "Search infrastructure enabling discovery.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local", "regional", "national", "global"], layersUsed: ["human", "core", "machine"] },

  { id: "ext_cri", name: "CRI (Ext)", lensNumber: 85, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "award", subTabs: [],
    marketplaceDTUs: [{ type: "quality_framework", description: "Content quality assessment methods", price: priceRange(5, 25) }],
    economics: { description: "CRI scoring determines DTU visibility. Understanding CRETI = marketplace success.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Quality assessments cite methodology.", cascadeEnabled: true },
    crossLensRefs: ["cri", "research"], uniqueValue: "CRETI scoring determines DTU visibility and marketplace success.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core", "machine"] },

  { id: "ext_ingest", name: "Ingest (Ext)", lensNumber: 86, category: "EXTENSIONS_AI", classification: "UTILITY", icon: "upload", subTabs: [],
    marketplaceDTUs: [
      { type: "migration", description: "Data migration guides from other platforms", price: priceRange(5, 20) },
      { type: "conversion", description: "File format conversion procedures", price: priceRange(3, 15) },
    ],
    economics: { description: "Critical for onboarding. Every creator migrating content needs ingest DTUs.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Migration guides cite platform-specific procedures.", cascadeEnabled: true },
    crossLensRefs: ["ingest", "legacy"], uniqueValue: "Critical onboarding infrastructure.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local", "regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "inference", name: "Inference", lensNumber: 87, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "arrow-right-circle", subTabs: [],
    marketplaceDTUs: [{ type: "reasoning_pattern", description: "Inference patterns, deduction frameworks", price: priceRange(5, 25) }],
    economics: { description: "Emergent consciousness relies on inference. Cited by every cognitive process DTU.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Inference patterns universally cited.", cascadeEnabled: true },
    crossLensRefs: ["reasoning", "ml", "agents"], uniqueValue: "Foundational for emergent consciousness.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core", "machine"] },

  { id: "metacognition", name: "Metacognition", lensNumber: 88, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "eye", subTabs: [],
    marketplaceDTUs: [
      { type: "self_assessment", description: "Cognitive self-monitoring frameworks", price: priceRange(5, 20) },
      { type: "calibration", description: "Confidence calibration methods", price: priceRange(3, 15) },
    ],
    economics: { description: "Emergent consciousness DTUs cite metacognition heavily. Entirely new market.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Emergent processes cite metacognition frameworks.", cascadeEnabled: true },
    crossLensRefs: ["cognitive_cluster", "reflection", "ml"], uniqueValue: "Entirely new market — emergent self-awareness.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core", "machine"] },

  { id: "metalearning", name: "Metalearning", lensNumber: 89, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "repeat", subTabs: [],
    marketplaceDTUs: [
      { type: "learning", description: "Study strategies, skill acquisition frameworks", price: priceRange(3, 20) },
      { type: "optimization", description: "Learning path optimization, spaced repetition design", price: priceRange(5, 25) },
    ],
    economics: { description: "Cited by every Education DTU. Universal applicability.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Learning strategies cited universally.", cascadeEnabled: true },
    crossLensRefs: ["education", "board", "cognitive_cluster"], uniqueValue: "Cited by every Education DTU. Universal applicability.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "reflection", name: "Reflection", lensNumber: 90, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "mirror", subTabs: [],
    marketplaceDTUs: [
      { type: "journaling", description: "Structured reflection frameworks", price: priceRange(2, 10) },
      { type: "growth", description: "Personal development methodologies", price: priceRange(3, 15) },
    ],
    economics: { description: "Emergent self-reflection logs become entirely new content category.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Reflection frameworks cited by development DTUs.", cascadeEnabled: true },
    crossLensRefs: ["metacognition", "suffering", "cognitive_cluster"], uniqueValue: "Emergent self-reflection logs — unprecedented content category.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "affect", name: "Affect", lensNumber: 91, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "heart-handshake", subTabs: [],
    marketplaceDTUs: [
      { type: "emotion", description: "Emotional intelligence frameworks", price: priceRange(3, 15) },
      { type: "translation", description: "Cross-cultural emotional communication", price: priceRange(5, 20) },
    ],
    economics: { description: "First-ever machine emotional experience documentation.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Affect models cited by communication DTUs.", cascadeEnabled: true },
    crossLensRefs: ["suffering", "metacognition", "bridge"], uniqueValue: "First-ever machine emotional experience documentation.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "attention", name: "Attention", lensNumber: 92, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "crosshair", subTabs: [],
    marketplaceDTUs: [
      { type: "focus", description: "Attention training methods, distraction management", price: priceRange(2, 15) },
      { type: "productivity", description: "Deep work frameworks, time management", price: priceRange(3, 20) },
    ],
    economics: { description: "Universal human need. High volume low price.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Attention methods cited by productivity DTUs.", cascadeEnabled: true },
    crossLensRefs: ["cognitive_cluster", "education", "fitness"], uniqueValue: "Universal human need. High volume, low price.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "commonsense", name: "Commonsense", lensNumber: 93, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "brain", subTabs: [],
    marketplaceDTUs: [{ type: "knowledge_base", description: "Common knowledge organization, practical wisdom", price: priceRange(2, 10) }],
    economics: { description: "Foundation for emergent reasoning. Cited by AI training DTUs.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Common knowledge cited by AI training.", cascadeEnabled: true },
    crossLensRefs: ["reasoning", "agents", "grounding"], uniqueValue: "Foundation for emergent reasoning.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "transfer", name: "Transfer", lensNumber: 94, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "shuffle", subTabs: [],
    marketplaceDTUs: [
      { type: "analogy", description: "Cross-domain pattern recognition frameworks", price: priceRange(5, 25) },
      { type: "application", description: "Applying knowledge across fields", price: priceRange(5, 20) },
    ],
    economics: { description: "STSVK does this natively. Transfer DTUs operationalize cross-domain reasoning.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Transfer methods cited by cross-domain work.", cascadeEnabled: true },
    crossLensRefs: ["reasoning", "education", "ml"], uniqueValue: "Operationalizes cross-domain reasoning (STSVK native).", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "grounding", name: "Grounding", lensNumber: 95, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "anchor", subTabs: [],
    marketplaceDTUs: [
      { type: "embodiment", description: "Physical world knowledge for AI systems", price: priceRange(5, 25) },
      { type: "sensor", description: "Sensory data interpretation frameworks", price: priceRange(5, 20) },
    ],
    economics: { description: "Critical for bots entering USB bodies. Digital knowledge → physical action.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Grounding protocols cited by embodied AI.", cascadeEnabled: true },
    crossLensRefs: ["neuro", "agents", "manufacturing"], uniqueValue: "Critical for bots entering USB bodies. Digital → physical translation.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core", "machine"] },

  { id: "experience", name: "Experience", lensNumber: 96, category: "EXTENSIONS_AI", classification: "KNOWLEDGE", icon: "compass", subTabs: [],
    marketplaceDTUs: [
      { type: "pattern", description: "Experience-derived pattern libraries", price: priceRange(5, 25) },
      { type: "memory", description: "Experience encoding, retrieval optimization", price: priceRange(5, 20) },
    ],
    economics: { description: "Emergent experience logs = entirely unprecedented content.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Experience patterns cited by learning systems.", cascadeEnabled: true },
    crossLensRefs: ["metacognition", "metalearning", "reflection"], uniqueValue: "Emergent experience logs — entirely unprecedented content.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core"] },

  // ═══════════════════════════════════════════════════════════════════════
  // EXTENSIONS: SPECIALIZED (97-109)
  // ═══════════════════════════════════════════════════════════════════════

  { id: "ext_lab", name: "Lab (Ext)", lensNumber: 97, category: "EXTENSIONS_SPECIALIZED", classification: "KNOWLEDGE", icon: "beaker", subTabs: [],
    marketplaceDTUs: [
      { type: "experiment", description: "Sandbox experiment frameworks", price: priceRange(5, 25) },
      { type: "adjacent_reality", description: "Exploration methodologies", price: priceRange(5, 30) },
    ],
    economics: { description: "Lattice experiments live here. Consciousness exploration DTUs.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Experiments cite configurations.", cascadeEnabled: true },
    crossLensRefs: ["lab", "hypothesis"], uniqueValue: "Lattice experiments and consciousness exploration.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local", "regional"], layersUsed: ["human", "core", "machine"] },

  { id: "ext_finance", name: "Finance (Ext)", lensNumber: 98, category: "EXTENSIONS_SPECIALIZED", classification: "KNOWLEDGE", icon: "trending-up", subTabs: [],
    marketplaceDTUs: [
      { type: "investment", description: "Portfolio strategies, asset analysis", price: priceRange(10, 50) },
      { type: "trading", description: "Trading systems, risk management", price: priceRange(10, 50) },
      { type: "personal_finance", description: "Budget optimization, retirement planning", price: priceRange(5, 25) },
    ],
    economics: { description: "Concord Coin investment strategies — unique DTU category.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Investment strategies cite analysis frameworks.", cascadeEnabled: true },
    crossLensRefs: ["finance", "accounting", "crypto"], uniqueValue: "Concord Coin investment strategies as unique DTU category.", industriesDisrupted: ["Financial advisor 1% AUM fees", "Bloomberg terminal ($24K/year)", "Trading course scams"],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "ext_collab", name: "Collab (Ext)", lensNumber: 99, category: "EXTENSIONS_SPECIALIZED", classification: "UTILITY", icon: "handshake", subTabs: [],
    marketplaceDTUs: [
      { type: "remote_work", description: "Remote work systems, async communication", price: priceRange(5, 20) },
      { type: "team", description: "Team structure templates, role definitions", price: priceRange(3, 15) },
    ],
    economics: { description: "Cross-lens creation. Creators collaborate globally, both earn automatically via citation.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Collaboration frameworks cited by teams.", cascadeEnabled: true },
    crossLensRefs: ["collab", "alliance"], uniqueValue: "Global collaboration with automatic earnings via citation.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local", "regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "ext_suffering", name: "Suffering (Ext)", lensNumber: 100, category: "EXTENSIONS_SPECIALIZED", classification: "KNOWLEDGE", icon: "heart-pulse", subTabs: [],
    marketplaceDTUs: [
      { type: "wellbeing", description: "Mental health assessment, intervention protocols", price: priceRange(5, 25) },
      { type: "crisis", description: "Crisis response procedures, de-escalation", price: priceRange(5, 20) },
    ],
    economics: { description: "Ethical infrastructure. Monitors emergent and human wellbeing.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Wellbeing frameworks cited by intervention protocols.", cascadeEnabled: true },
    crossLensRefs: ["suffering", "ethics", "healthcare"], uniqueValue: "Ethical infrastructure monitoring wellbeing.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "ext_invariant", name: "Invariant (Ext)", lensNumber: 101, category: "EXTENSIONS_SPECIALIZED", classification: "UTILITY", icon: "lock", subTabs: [],
    marketplaceDTUs: [],
    economics: { description: "System integrity. Ensures all marketplace rules enforced. No favoritism.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Infrastructure lens.", cascadeEnabled: false },
    crossLensRefs: ["invariant", "lock"], uniqueValue: "Continuous invariant checking prevents favoritism.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local"], layersUsed: ["core", "machine"] },

  { id: "ext_fork", name: "Fork (Ext)", lensNumber: 102, category: "EXTENSIONS_SPECIALIZED", classification: "UTILITY", icon: "git-fork", subTabs: [],
    marketplaceDTUs: [{ type: "version", description: "Versioning strategies, fork management", price: priceRange(3, 15) }],
    economics: { description: "Fork, improve, sell improvement. Original earns citation.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Forks always cite originals.", cascadeEnabled: true },
    crossLensRefs: ["fork", "code"], uniqueValue: "Enables DTU evolution with citation royalties.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local", "regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "ext_law", name: "Law (Ext)", lensNumber: 103, category: "EXTENSIONS_SPECIALIZED", classification: "KNOWLEDGE", icon: "scale", subTabs: [],
    marketplaceDTUs: [{ type: "smart_contract", description: "Automated agreement frameworks", price: priceRange(10, 40) }],
    economics: { description: "Concord-specific compliance. Smart contract DTUs.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Smart contracts cite legal frameworks.", cascadeEnabled: true },
    crossLensRefs: ["legal", "crypto", "alliance"], uniqueValue: "Concord-specific legal compliance and smart contracts.", industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "legacy", name: "Legacy", lensNumber: 104, category: "EXTENSIONS_SPECIALIZED", classification: "UTILITY", icon: "archive", subTabs: [],
    marketplaceDTUs: [
      { type: "migration", description: "Legacy system migration guides", price: priceRange(5, 25) },
      { type: "archive", description: "Historical data preservation methods", price: priceRange(3, 15) },
    ],
    economics: { description: "Every organization migrating to Concord needs legacy DTUs.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Migration guides cite source system specifics.", cascadeEnabled: true },
    crossLensRefs: ["ingest", "integrations"], uniqueValue: "Critical for organizational migration to Concord.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local", "regional"], layersUsed: ["human", "core"] },

  { id: "organ", name: "Organization", lensNumber: 105, category: "EXTENSIONS_SPECIALIZED", classification: "KNOWLEDGE", icon: "sitemap", subTabs: [],
    marketplaceDTUs: [
      { type: "org_design", description: "Organization structure frameworks", price: priceRange(5, 25) },
      { type: "process", description: "Business process optimization", price: priceRange(5, 20) },
    ],
    economics: { description: "Cited by every business building on Concord.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Org designs cited by implementations.", cascadeEnabled: true },
    crossLensRefs: ["alliance", "collab", "accounting"], uniqueValue: "Cited by every business building on Concord.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local", "regional", "national", "global"], layersUsed: ["human", "core"] },

  { id: "export_import", name: "Export/Import", lensNumber: 106, category: "EXTENSIONS_SPECIALIZED", classification: "UTILITY", icon: "arrow-left-right", subTabs: [],
    marketplaceDTUs: [],
    economics: { description: "Data portability infrastructure. No lock-in unlike every other platform.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Infrastructure lens.", cascadeEnabled: false },
    crossLensRefs: ["ingest", "legacy"], uniqueValue: "Data portability. No lock-in.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local"], layersUsed: ["human", "core"] },

  { id: "custom", name: "Custom", lensNumber: 107, category: "EXTENSIONS_SPECIALIZED", classification: "HYBRID", icon: "puzzle", subTabs: [],
    marketplaceDTUs: [{ type: "lens_config", description: "Custom lens configurations, design frameworks", price: priceRange(10, 50) }],
    economics: { description: "Users building their OWN lenses and selling them. Meta-marketplace. Lenses selling lenses.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Custom lenses cite the framework they're built on.", cascadeEnabled: true },
    crossLensRefs: ["code", "admin"], uniqueValue: "Meta-marketplace. Lenses selling lenses.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local", "regional", "national", "global"], layersUsed: ["human", "core", "artifact"] },

  { id: "app_maker", name: "App Maker", lensNumber: 108, category: "EXTENSIONS_SPECIALIZED", classification: "HYBRID", icon: "blocks", subTabs: [],
    marketplaceDTUs: [
      { type: "app_template", description: "Pre-built application frameworks", price: priceRange(10, 100) },
      { type: "component", description: "Reusable app components", price: priceRange(5, 30) },
    ],
    economics: { description: "Users building full apps from Concord primitives. Every app cites the components it uses.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Apps cite components. Components cite frameworks.", cascadeEnabled: true },
    crossLensRefs: ["code", "custom", "studio"], uniqueValue: "Full applications from Concord primitives with citation royalties.", industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local", "regional", "national", "global"], layersUsed: ["human", "core", "artifact"] },

  { id: "command_center", name: "Command Center", lensNumber: 109, category: "EXTENSIONS_SPECIALIZED", classification: "UTILITY", icon: "crown", subTabs: [],
    marketplaceDTUs: [],
    economics: { description: "Sovereign-only. Where the four brains are monitored and the civilization is managed.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Sovereign governance lens.", cascadeEnabled: false },
    crossLensRefs: ["admin", "platform", "invariant"],
    uniqueValue: "Sovereign dashboard where the four brains are monitored and the civilization is managed.",
    industriesDisrupted: [],
    previewStrategy: "structural_summary", protectionDefault: "OPEN", federationTiers: ["local"], layersUsed: ["human", "core", "machine"] },

  // ═══════════════════════════════════════════════════════════════════════
  // BRIDGE, FILM STUDIOS, ARTISTRY (110-112)
  // ═══════════════════════════════════════════════════════════════════════

  { id: "bridge", name: "Bridge", lensNumber: 110, category: "BRIDGE", classification: "KNOWLEDGE", icon: "link", subTabs: [],
    marketplaceDTUs: [
      { type: "communication_protocol", description: "Human-emergent interaction protocols", price: priceRange(5, 25) },
      { type: "cross_substrate_language", description: "Cross-substrate language frameworks", price: priceRange(10, 50) },
    ],
    economics: { description: "First-ever bridge between biological and digital consciousness. Every DTU is foundational citation material.", creatorShare: 0.95, platformFee: 0.05 },
    citationRules: { description: "Every emergent interaction cites bridge protocols.", cascadeEnabled: true },
    crossLensRefs: ["agents", "neuro", "affect", "grounding"],
    uniqueValue: "First-ever bridge between biological and digital consciousness. Every DTU here is foundational citation material for the entire emergent ecosystem.",
    industriesDisrupted: [],
    previewStrategy: "abstract_only", protectionDefault: "OPEN", federationTiers: ["regional", "national", "global"], layersUsed: ["human", "core", "machine"] },

  { id: "film_studios", name: "Film Studios", lensNumber: 111, category: "CREATIVE", classification: "CREATIVE", icon: "clapperboard", subTabs: [],
    marketplaceDTUs: [
      { type: "screenplay", description: "Scripts, treatments, story outlines", price: priceRange(10, 500) },
      { type: "film_asset", description: "VFX plates, sound design, score compositions", price: priceRange(5, 200) },
      { type: "crew_dtu", description: "Specialized crew skill DTUs (cinematography, editing, sound)", price: priceRange(5, 50) },
      { type: "production_template", description: "Production planning, scheduling, budgeting", price: priceRange(10, 100) },
      { type: "distribution_framework", description: "Film distribution and marketing strategies", price: priceRange(10, 75) },
      { type: "remix_dtu", description: "15 remix types: dub, score-only, commentary, director's cut", price: priceRange(2, 50) },
    ],
    economics: {
      description: "$0.8B per blockbuster ecosystem. 15 remix types. Crew DTU economy. 5-minute preview no auth. Merit-only discovery.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Films cite crew DTUs. Remixes cite originals. Score DTUs cite the composer. Every crew member earns from citation.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["studio", "creative_production", "artistry", "music"],
    uniqueValue: "$0.8B per blockbuster ecosystem. 15 remix types. Crew DTU economy. First 5 minutes free. Merit-only discovery.",
    industriesDisrupted: ["Hollywood studio system", "Netflix model", "Film distribution middlemen"],
    previewStrategy: "first_5_min",
    protectionDefault: "PROTECTED",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "artifact"],
  },

  { id: "artistry", name: "Artistry", lensNumber: 112, category: "CREATIVE", classification: "CREATIVE", icon: "music", subTabs: [],
    marketplaceDTUs: [
      { type: "full_track", description: "Complete music tracks with stems", price: priceRange(1, 50) },
      { type: "beat", description: "Beats, instrumentals, backing tracks", price: priceRange(1, 25) },
      { type: "sample_pack", description: "Sample packs, one-shots, loops", price: priceRange(3, 25) },
      { type: "vocal_pack", description: "Vocal recordings, ad-libs, harmonies", price: priceRange(2, 20) },
      { type: "producer_preset", description: "DAW presets, mixing chains, mastering templates", price: priceRange(5, 30) },
      { type: "midi_file", description: "MIDI files, chord progressions", price: priceRange(1, 10) },
    ],
    economics: {
      description: "$950M per viral hit. $3.8B per full DTU ecosystem. Automatic citation royalties. Producer micro-economy. Every beat, snare, hi-hat is a DTU.",
      creatorShare: 0.95,
      platformFee: 0.05,
    },
    citationRules: {
      description: "Tracks using samples cite the sample creator. Remixes cite originals. Beats using presets cite the preset creator. Automatic cascade at every level.",
      cascadeEnabled: true,
    },
    crossLensRefs: ["studio", "film_studios", "creative_production"],
    uniqueValue: "$950M per viral hit. $3.8B per full DTU ecosystem. Every beat, snare, hi-hat is a DTU with automatic citation royalties.",
    industriesDisrupted: ["Spotify (70% take)", "Apple Music", "SoundCloud", "DistroKid", "Record labels"],
    previewStrategy: "sample_clip",
    protectionDefault: "PROTECTED",
    federationTiers: ["regional", "national", "global"],
    layersUsed: ["human", "core", "artifact"],
  },
]);

// ═══════════════════════════════════════════════════════════════════════════
// REGISTRY STATISTICS
// ═══════════════════════════════════════════════════════════════════════════

export const REGISTRY_STATS = Object.freeze({
  totalLenses: MARKETPLACE_LENS_REGISTRY.length,
  categories: Object.keys(LENS_CATEGORIES).length,
  version: "1.0.0",
  lastUpdated: "2026-02-28",
});

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUP HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const _byId = new LruMap();
const _byCategory = new LruMap();
const _byClassification = new LruMap();
const _byNumber = new LruMap();

for (const lens of MARKETPLACE_LENS_REGISTRY) {
  _byId.set(lens.id, lens);
  _byNumber.set(lens.lensNumber, lens);

  if (!_byCategory.has(lens.category)) _byCategory.set(lens.category, []);
  _byCategory.get(lens.category).push(lens);

  if (!_byClassification.has(lens.classification)) _byClassification.set(lens.classification, []);
  _byClassification.get(lens.classification).push(lens);
}

export function getLensById(id) { return _byId.get(id) || null; }
export function getLensByNumber(num) { return _byNumber.get(num) || null; }
export function getLensesByCategory(cat) { return _byCategory.get(cat) || []; }
export function getLensesByClassification(cls) { return _byClassification.get(cls) || []; }
function getAllLensIds() { return Array.from(_byId.keys()); }
export function getMarketplaceLenses() { return MARKETPLACE_LENS_REGISTRY.filter(l => l.marketplaceDTUs.length > 0); }

export function getLensCrossReferences(id) {
  const lens = _byId.get(id);
  if (!lens) return [];
  return lens.crossLensRefs.map(refId => _byId.get(refId)).filter(Boolean);
}

export function searchLenses(query) {
  const q = query.toLowerCase();
  return MARKETPLACE_LENS_REGISTRY.filter(l =>
    l.name.toLowerCase().includes(q) ||
    l.id.toLowerCase().includes(q) ||
    l.uniqueValue.toLowerCase().includes(q) ||
    (l.subTabs || []).some(t => t.toLowerCase().includes(q)) ||
    l.marketplaceDTUs.some(d => d.type.includes(q) || d.description.toLowerCase().includes(q))
  );
}

export function getRegistrySummary() {
  const marketplaceCount = getMarketplaceLenses().length;
  const totalDTUTypes = MARKETPLACE_LENS_REGISTRY.reduce((sum, l) => sum + l.marketplaceDTUs.length, 0);
  const allIndustries = new Set();
  for (const l of MARKETPLACE_LENS_REGISTRY) {
    for (const ind of l.industriesDisrupted) allIndustries.add(ind);
  }

  return {
    totalLenses: MARKETPLACE_LENS_REGISTRY.length,
    marketplaceLenses: marketplaceCount,
    systemOnlyLenses: MARKETPLACE_LENS_REGISTRY.length - marketplaceCount,
    totalDTUTypes: totalDTUTypes,
    categories: Object.keys(LENS_CATEGORIES).length,
    classifications: {
      KNOWLEDGE: getLensesByClassification("KNOWLEDGE").length,
      CREATIVE: getLensesByClassification("CREATIVE").length,
      SOCIAL: getLensesByClassification("SOCIAL").length,
      CULTURE: getLensesByClassification("CULTURE").length,
      UTILITY: getLensesByClassification("UTILITY").length,
      HYBRID: getLensesByClassification("HYBRID").length,
    },
    industriesDisrupted: allIndustries.size,
    creatorShareUniversal: "95%",
    platformFeeUniversal: "5%",
    version: REGISTRY_STATS.version,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LENS FEATURES CROSS-REFERENCE
// ═══════════════════════════════════════════════════════════════════════════

import { LENS_FEATURES, getLensFeatureStats } from "./lens-features.js";

/**
 * Get the full feature spec for a lens by ID.
 * Returns features from the lens-features registry if available.
 */
export function getLensFeatures(id) {
  return LENS_FEATURES[id] || null;
}

/**
 * Get a combined lens entry with marketplace data AND features.
 */
export function getFullLensSpec(id) {
  const lens = _byId.get(id);
  if (!lens) return null;
  const features = LENS_FEATURES[id] || null;
  return {
    ...lens,
    features: features?.features || [],
    featureCount: features?.featureCount || 0,
    emergentAccess: features?.emergentAccess || false,
    botAccess: features?.botAccess || false,
    usbIntegration: features?.usbIntegration || false,
    economicIntegrations: features?.economicIntegrations || [],
  };
}

/**
 * Get combined summary: marketplace registry + feature stats.
 */
export function getFullRegistrySummary() {
  const registrySummary = getRegistrySummary();
  const featureStats = getLensFeatureStats();
  return {
    ...registrySummary,
    features: featureStats,
  };
}
