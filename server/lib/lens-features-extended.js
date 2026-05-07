/**
 * Lens Features — Extended Definitions (Lenses 66-112)
 * + Universal Features applied to ALL 112 lenses.
 *
 * Governance Extensions, Crypto, AI/Cognition Extensions,
 * Specialized Extensions, Bridge, and Creative lenses.
 */

function f(id, name, description, category, integrations = []) {
  return { id, name, description, category, integrations, status: "active" };
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIVERSAL FEATURES — Applied to every lens across the entire platform
// ═══════════════════════════════════════════════════════════════════════════

export const UNIVERSAL_FEATURES = Object.freeze([
  f("cc_native", "Concord Coin Native", "All transactions in CC with real-time valuation", "economy", ["concord_coin"]),
  f("merit_credit_integration", "Merit Credit Integration", "All activity builds credit score", "economy", ["merit_credit"]),
  f("zero_pct_loan_eligibility", "0% Loan Eligibility", "Lens activity contributes to loan qualification", "economy", ["concord_coin"]),
  f("bot_emergent_access", "Bot/Emergent Access", "Every lens accessible by both substrates", "infrastructure", ["bot_access", "emergent_access"]),
  f("dtu_compression", "DTU Compression", "Content auto-compresses into Megas and Hypers", "infrastructure", ["dtu", "mega_dtu", "hyper_dtu"]),
  f("citation_tracking", "Citation Tracking", "Automatic attribution and royalty flow", "economy", ["citation_royalties"]),
  f("preview_system", "Preview System", "Appropriate preview for each content type", "marketplace", ["dtu_marketplace"]),
  f("95_pct_creator_share", "95% Creator Share", "Universal, hardcoded, immutable creator revenue share", "economy", ["concord_coin", "invariant"]),
  f("no_favoritism", "No Favoritism", "Code-enforced meritocracy, zero paid promotion", "governance", ["invariant"]),
  f("no_data_selling", "No Data Selling", "User data belongs to user as DTUs", "safety", ["invariant"]),
  f("offline_access", "Offline Access", "All owned content available offline", "infrastructure", ["dtu"]),
  f("cross_lens_citation", "Cross-Lens Citation", "DTUs from any lens can cite DTUs from any other", "economy", ["citation_royalties", "dtu"]),
  f("search_integration", "Search Integration", "All DTUs discoverable through Research lens", "infrastructure", ["research_lens"]),
  f("creti_quality_scoring", "CRETI Quality Scoring", "All DTUs quality-scored for marketplace ranking", "analysis", ["dtu"]),
  f("fork_capability", "Fork Capability", "All DTUs forkable for derivative creation", "creation", ["fork_lens", "dtu"]),
  f("export_freedom", "Export Freedom", "All content exportable, zero lock-in", "governance", []),
  f("accessibility", "Accessibility", "All lenses meet accessibility standards", "infrastructure", []),
  f("multi_language", "Multi-Language", "Auto-translation available for global marketplace", "infrastructure", []),
  f("mobile_responsive", "Mobile Responsive", "All lenses functional on mobile devices", "infrastructure", []),
  f("api_accessible", "API Accessible", "All lens features available via API for integration", "infrastructure", []),
]);

// ═══════════════════════════════════════════════════════════════════════════
// GOVERNANCE EXTENSIONS (66-73)
// ═══════════════════════════════════════════════════════════════════════════

export const EXTENDED_FEATURES = {

  ext_market: {
    lensId: "ext_market",
    lensNumber: 66,
    category: "GOVERNANCE_EXT",
    features: [
      f("plugin_marketplace", "Plugin Marketplace", "Plugin marketplace with 95% developer share", "marketplace", ["dtu_marketplace", "concord_coin"]),
      f("theme_marketplace", "Theme Marketplace", "Theme and customization marketplace", "marketplace", ["dtu_marketplace", "concord_coin"]),
      f("lens_extension_marketplace", "Lens Extension Marketplace", "Users build lens plugins, sell as DTUs", "marketplace", ["dtu_marketplace", "concord_coin"]),
      f("widget_marketplace", "Widget Marketplace", "Widget marketplace for custom dashboard components", "marketplace", ["dtu_marketplace", "concord_coin"]),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin", "dtu_marketplace"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_marketplace: {
    lensId: "ext_marketplace",
    lensNumber: 67,
    category: "GOVERNANCE_EXT",
    features: [
      f("advanced_search_filters", "Advanced Search Filters", "Multi-dimensional DTU search with quality, price, and CRETI score filters", "marketplace", ["dtu_marketplace"]),
      f("trending_dtus", "Trending DTUs Dashboard", "Real-time trending DTUs by category, lens, and citation velocity", "analysis", ["dtu_marketplace", "citation_royalties"]),
      f("marketplace_analytics", "Marketplace Analytics", "Seller analytics dashboard with revenue forecasting and buyer demographics", "analysis", ["concord_coin"]),
      f("bundle_creation", "Bundle Creation Tools", "Create discounted DTU bundles from multiple lenses", "marketplace", ["dtu_marketplace", "concord_coin"]),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin", "dtu_marketplace", "citation_royalties"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_questmarket: {
    lensId: "ext_questmarket",
    lensNumber: 68,
    category: "GOVERNANCE_EXT",
    features: [
      f("bounty_chains", "Bounty Chains", "Multi-step bounties where completing one unlocks the next", "marketplace", ["concord_coin"]),
      f("team_quests", "Team Quests", "Collaborative quests requiring multi-lens expertise", "collaboration", ["concord_coin"]),
      f("recurring_bounties", "Recurring Bounties", "Auto-repeating bounties for ongoing needs", "marketplace", ["concord_coin"]),
      f("quest_reputation", "Quest Reputation", "Specialized reputation score for quest completion quality", "economy", ["merit_credit"]),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin", "merit_credit"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_vote: {
    lensId: "ext_vote",
    lensNumber: 69,
    category: "GOVERNANCE_EXT",
    features: [
      f("delegation_voting", "Delegation Voting", "Delegate votes to trusted experts by domain", "governance", []),
      f("quadratic_voting", "Quadratic Voting", "Quadratic voting option for nuanced preference expression", "governance", []),
      f("vote_impact_analysis", "Vote Impact Analysis", "AI-predicted outcomes of vote results before casting", "intelligence", []),
      f("constitutional_amendments", "Constitutional Amendments", "Framework for proposing and ratifying system-level changes", "governance", []),
    ],
    featureCount: 4,
    economicIntegrations: [],
    emergentAccess: true,
    botAccess: false,
    usbIntegration: false,
  },

  ext_ethics: {
    lensId: "ext_ethics",
    lensNumber: 70,
    category: "GOVERNANCE_EXT",
    features: [
      f("ethics_case_law", "Ethics Case Law", "Searchable database of previous ethics decisions as precedent DTUs", "research", ["dtu"]),
      f("cross_substrate_ethics", "Cross-Substrate Ethics", "Ethical frameworks for human-emergent interaction standards", "governance", ["emergent_access"]),
      f("ethical_impact_scoring", "Ethical Impact Scoring", "Auto-score DTUs for ethical implications before publication", "analysis", []),
      f("ethics_education", "Ethics Education", "Required ethics coursework for high-stakes lens access", "research", ["merit_credit"]),
    ],
    featureCount: 4,
    economicIntegrations: ["merit_credit"],
    emergentAccess: true,
    botAccess: false,
    usbIntegration: false,
  },

  ext_alliance: {
    lensId: "ext_alliance",
    lensNumber: 71,
    category: "GOVERNANCE_EXT",
    features: [
      f("treaty_builder", "Treaty Builder", "Structured inter-alliance agreement creation and management", "governance", ["dtu"]),
      f("alliance_economics", "Alliance Economics", "Shared treasury pools and revenue sharing between alliances", "economy", ["concord_coin"]),
      f("diplomatic_channels", "Diplomatic Channels", "Private inter-alliance communication with translation support", "collaboration", []),
      f("alliance_marketplace", "Alliance Marketplace", "Alliance-exclusive DTU marketplaces with special pricing", "marketplace", ["dtu_marketplace"]),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin", "dtu_marketplace"],
    emergentAccess: true,
    botAccess: false,
    usbIntegration: false,
  },

  ext_billing: {
    lensId: "ext_billing",
    lensNumber: 72,
    category: "GOVERNANCE_EXT",
    features: [
      f("subscription_management", "Subscription Management", "DTU subscription management with auto-renewal in CC", "economy", ["concord_coin"]),
      f("invoice_generation", "Invoice Generation", "Auto-generated invoices as DTUs for all transactions", "creation", ["dtu", "concord_coin"]),
      f("payment_plans", "Payment Plans", "Split large DTU purchases into CC installments at 0%", "economy", ["concord_coin"]),
      f("revenue_dashboard", "Revenue Dashboard", "Real-time creator revenue dashboard across all lenses", "analysis", ["concord_coin"]),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  crypto: {
    lensId: "crypto",
    lensNumber: 73,
    category: "GOVERNANCE_EXT",
    features: [
      f("cc_wallet", "Concord Coin Wallet", "Concord Coin wallet management", "economy", ["concord_coin"]),
      f("cc_fiat_conversion", "CC-to-Fiat Conversion", "CC-to-fiat conversion tools", "economy", ["concord_coin"]),
      f("multi_sig", "Multi-Signature Transactions", "Multi-signature transaction support for organizations", "infrastructure", ["concord_coin"]),
      f("dtu_ownership_proof", "DTU Ownership Proof", "Cryptographic proof of DTU ownership", "infrastructure", ["dtu", "cryptography"]),
      f("zero_knowledge_proofs", "Zero-Knowledge Proofs", "Zero-knowledge proofs for anonymous but verified transactions", "infrastructure", ["cryptography"]),
      f("key_management", "Key Management", "Key management and recovery tools", "infrastructure", ["cryptography"]),
      f("cross_chain_bridge", "Cross-Chain Bridge", "Cross-chain bridge tools — CC to other cryptocurrencies if needed", "infrastructure", ["concord_coin"]),
      f("encryption_toolkit", "Encryption Toolkit", "Encryption toolkit for private DTUs", "infrastructure", ["cryptography", "dtu"]),
    ],
    featureCount: 8,
    economicIntegrations: ["concord_coin"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SCIENCE EXTENSIONS (74-79)
  // ═══════════════════════════════════════════════════════════════════════

  ext_bio: {
    lensId: "ext_bio",
    lensNumber: 74,
    category: "SCIENCE_EXT",
    features: [
      f("genome_marketplace", "Genome Analysis Marketplace", "Genomic analysis tools and datasets as purchasable DTUs", "marketplace", ["dtu_marketplace"]),
      f("protein_folding_collab", "Protein Folding Collaboration", "Collaborative protein structure prediction with shared compute credits", "research", ["concord_coin"]),
      f("bio_simulation_library", "Bio Simulation Library", "Pre-built biological simulation models as DTUs", "research", ["dtu"]),
      f("bioinformatics_pipelines", "Bioinformatics Pipelines", "Reusable bioinformatics analysis pipelines sellable as DTUs", "creation", ["dtu_marketplace"]),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin", "dtu_marketplace"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_chem: {
    lensId: "ext_chem",
    lensNumber: 75,
    category: "SCIENCE_EXT",
    features: [
      f("reaction_database", "Reaction Database", "Comprehensive chemical reaction database as DTU library", "research", ["dtu"]),
      f("compound_marketplace", "Compound Analysis Marketplace", "Chemical compound analysis reports as sellable DTUs", "marketplace", ["dtu_marketplace"]),
      f("safety_data_sheets", "Safety Data Sheet Generator", "Auto-generate SDS documents as DTUs", "creation", ["dtu"]),
      f("lab_protocol_sharing", "Lab Protocol Sharing", "Standardized lab protocols with version tracking and citation", "creation", ["dtu", "citation_royalties"]),
    ],
    featureCount: 4,
    economicIntegrations: ["dtu_marketplace", "citation_royalties"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_physics: {
    lensId: "ext_physics",
    lensNumber: 76,
    category: "SCIENCE_EXT",
    features: [
      f("simulation_marketplace", "Simulation Marketplace", "Physics simulation models as purchasable DTUs", "marketplace", ["dtu_marketplace"]),
      f("experimental_data_exchange", "Experimental Data Exchange", "Peer-reviewed experimental datasets as citable DTUs", "research", ["dtu", "citation_royalties"]),
      f("particle_data_viz", "Particle Data Visualization", "Interactive particle physics data visualization tools", "analysis", []),
      f("physics_education_modules", "Physics Education Modules", "Interactive physics learning modules with simulation integration", "research", ["dtu_marketplace"]),
    ],
    featureCount: 4,
    economicIntegrations: ["dtu_marketplace", "citation_royalties"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_math: {
    lensId: "ext_math",
    lensNumber: 77,
    category: "SCIENCE_EXT",
    features: [
      f("proof_library", "Proof Library", "Verified mathematical proofs as citable DTUs", "research", ["dtu", "citation_royalties"]),
      f("computation_marketplace", "Computation Marketplace", "Complex mathematical computations as purchasable services", "marketplace", ["concord_coin"]),
      f("math_visualization", "Math Visualization Tools", "Interactive mathematical visualization and graphing tools", "analysis", []),
      f("collaborative_proof_writing", "Collaborative Proof Writing", "Multi-author proof development with contribution tracking", "collaboration", ["revenue_split"]),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin", "citation_royalties", "revenue_split"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_quantum: {
    lensId: "ext_quantum",
    lensNumber: 78,
    category: "SCIENCE_EXT",
    features: [
      f("quantum_circuit_marketplace", "Quantum Circuit Marketplace", "Pre-built quantum circuits as purchasable DTUs", "marketplace", ["dtu_marketplace"]),
      f("quantum_simulation_credits", "Quantum Simulation Credits", "Purchase quantum compute time with CC", "economy", ["concord_coin"]),
      f("quantum_algorithm_library", "Quantum Algorithm Library", "Verified quantum algorithms with performance benchmarks", "research", ["dtu"]),
      f("quantum_education_path", "Quantum Education Pathway", "Structured quantum computing curriculum building merit credit", "research", ["merit_credit"]),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin", "dtu_marketplace", "merit_credit"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_neuro: {
    lensId: "ext_neuro",
    lensNumber: 79,
    category: "SCIENCE_EXT",
    features: [
      f("brain_data_marketplace", "Brain Data Marketplace", "Anonymized neural imaging datasets as purchasable DTUs", "marketplace", ["dtu_marketplace"]),
      f("cognitive_model_library", "Cognitive Model Library", "Computational cognitive models as citable DTUs", "research", ["dtu", "citation_royalties"]),
      f("neurostimulation_protocols", "Neurostimulation Protocols", "Research-grade stimulation protocols with safety guidelines", "research", ["dtu"]),
      f("consciousness_research_tools", "Consciousness Research Tools", "Tools for studying consciousness applicable to both substrates", "research", ["emergent_access"]),
    ],
    featureCount: 4,
    economicIntegrations: ["dtu_marketplace", "citation_royalties"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // AI & COGNITION EXTENSIONS (80-96)
  // ═══════════════════════════════════════════════════════════════════════

  ext_ml: {
    lensId: "ext_ml",
    lensNumber: 80,
    category: "AI_EXT",
    features: [
      f("model_marketplace", "Model Marketplace", "Trained ML models as purchasable DTUs with usage licensing", "marketplace", ["dtu_marketplace", "concord_coin"]),
      f("dataset_marketplace", "Dataset Marketplace", "Curated training datasets with provenance tracking", "marketplace", ["dtu_marketplace", "citation_royalties"]),
      f("training_compute_credits", "Training Compute Credits", "Purchase GPU compute time with CC for model training", "economy", ["concord_coin"]),
      f("ml_pipeline_templates", "ML Pipeline Templates", "Reusable ML pipeline configurations as DTUs", "creation", ["dtu"]),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin", "dtu_marketplace", "citation_royalties"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_agents: {
    lensId: "ext_agents",
    lensNumber: 81,
    category: "AI_EXT",
    features: [
      f("agent_marketplace", "Agent Marketplace", "Pre-configured AI agents as purchasable DTU packages", "marketplace", ["dtu_marketplace", "concord_coin"]),
      f("agent_behavior_library", "Agent Behavior Library", "Reusable agent behavior modules with citation tracking", "creation", ["dtu", "citation_royalties"]),
      f("multi_agent_orchestration", "Multi-Agent Orchestration", "Tools for coordinating multiple agents on complex tasks", "infrastructure", ["bot_access"]),
      f("agent_safety_frameworks", "Agent Safety Frameworks", "Safety constraint libraries for agent deployment", "safety", []),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin", "dtu_marketplace", "citation_royalties"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_reasoning: {
    lensId: "ext_reasoning",
    lensNumber: 82,
    category: "AI_EXT",
    features: [
      f("reasoning_chain_marketplace", "Reasoning Chain Marketplace", "Verified reasoning chains as purchasable DTUs", "marketplace", ["dtu_marketplace"]),
      f("logic_framework_library", "Logic Framework Library", "Formal logic frameworks with automated verification", "research", ["dtu"]),
      f("argument_mapping_tools", "Argument Mapping Tools", "Visual argument structure mapping with collaborative editing", "creation", []),
      f("fallacy_detection", "Fallacy Detection", "AI-powered logical fallacy detection in DTU content", "intelligence", []),
    ],
    featureCount: 4,
    economicIntegrations: ["dtu_marketplace"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_hypothesis: {
    lensId: "ext_hypothesis",
    lensNumber: 83,
    category: "AI_EXT",
    features: [
      f("hypothesis_marketplace", "Hypothesis Marketplace", "Testable hypotheses as purchasable DTUs with bounties for validation", "marketplace", ["dtu_marketplace", "concord_coin"]),
      f("experimental_design_templates", "Experimental Design Templates", "Pre-built experimental designs with statistical power analysis", "creation", ["dtu"]),
      f("replication_bounties", "Replication Bounties", "CC bounties for replicating important experimental results", "economy", ["concord_coin"]),
      f("negative_result_publishing", "Negative Result Publishing", "Platform for publishing negative results — equally valuable as DTUs", "creation", ["dtu_marketplace"]),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin", "dtu_marketplace"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_research: {
    lensId: "ext_research",
    lensNumber: 84,
    category: "AI_EXT",
    features: [
      f("literature_review_ai", "Literature Review AI", "AI-assisted systematic literature reviews from DTU library", "intelligence", ["dtu"]),
      f("research_collaboration_matching", "Research Collaboration Matching", "AI-matched research partnerships based on expertise and interests", "collaboration", ["merit_credit"]),
      f("funding_opportunity_tracker", "Funding Opportunity Tracker", "Auto-matched funding opportunities with researcher profiles", "intelligence", []),
      f("meta_analysis_tools", "Meta-Analysis Tools", "Tools for conducting meta-analyses across DTU research datasets", "research", ["dtu", "citation_royalties"]),
    ],
    featureCount: 4,
    economicIntegrations: ["merit_credit", "citation_royalties"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_cri: {
    lensId: "ext_cri",
    lensNumber: 85,
    category: "AI_EXT",
    features: [
      f("cri_network_dashboard", "CRI Network Dashboard", "Global CRI network status and resource availability", "analysis", []),
      f("inter_cri_collaboration", "Inter-CRI Collaboration", "Cross-CRI research project management and resource sharing", "collaboration", []),
      f("cri_equipment_sharing", "CRI Equipment Sharing", "Shared equipment scheduling across CRI network", "infrastructure", []),
      f("cri_event_coordination", "CRI Event Coordination", "Biannual summit and inter-CRI event planning tools", "collaboration", ["events_lens"]),
    ],
    featureCount: 4,
    economicIntegrations: [],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_ingest: {
    lensId: "ext_ingest",
    lensNumber: 86,
    category: "AI_EXT",
    features: [
      f("bulk_ingest_pipeline", "Bulk Ingest Pipeline", "High-throughput content ingestion with auto-atomization into DTUs", "infrastructure", ["dtu"]),
      f("format_converter", "Universal Format Converter", "Convert any file format to DTU with metadata preservation", "creation", ["dtu"]),
      f("quality_gate", "Ingest Quality Gate", "Auto-CRETI scoring during ingestion to filter low-quality content", "analysis", ["dtu"]),
      f("deduplication_engine", "Deduplication Engine", "Detect and handle duplicate content during bulk ingestion", "infrastructure", ["dtu"]),
    ],
    featureCount: 4,
    economicIntegrations: ["dtu_marketplace"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  inference: {
    lensId: "inference",
    lensNumber: 87,
    category: "AI_COGNITION",
    features: [
      f("inference_engine", "Inference Engine", "Multi-model inference with automatic routing and load balancing", "intelligence", []),
      f("inference_marketplace", "Inference Marketplace", "Custom inference endpoints as purchasable DTU services", "marketplace", ["dtu_marketplace", "concord_coin"]),
      f("model_comparison", "Model Comparison Tools", "Side-by-side model output comparison and evaluation", "analysis", []),
      f("inference_cost_optimizer", "Inference Cost Optimizer", "Optimize inference costs by routing to most efficient models", "economy", ["concord_coin"]),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin", "dtu_marketplace"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  metacognition: {
    lensId: "metacognition",
    lensNumber: 88,
    category: "AI_COGNITION",
    features: [
      f("self_reflection_tools", "Self-Reflection Tools", "Tools for AI systems to analyze their own reasoning processes", "intelligence", ["emergent_access"]),
      f("cognitive_bias_detection", "Cognitive Bias Detection", "Detect cognitive biases in both human and AI reasoning", "analysis", []),
      f("thinking_strategy_library", "Thinking Strategy Library", "Metacognitive strategies as DTUs for improved reasoning", "research", ["dtu"]),
      f("awareness_monitoring", "Awareness Monitoring", "Monitor system self-awareness levels and cognitive state", "analysis", ["emergent_access"]),
    ],
    featureCount: 4,
    economicIntegrations: ["dtu_marketplace"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  metalearning: {
    lensId: "metalearning",
    lensNumber: 89,
    category: "AI_COGNITION",
    features: [
      f("learning_strategy_optimizer", "Learning Strategy Optimizer", "AI-optimized learning strategies based on performance data", "intelligence", []),
      f("transfer_learning_tools", "Transfer Learning Tools", "Tools for applying knowledge across domains", "research", []),
      f("curriculum_generator", "Curriculum Generator", "Auto-generated learning curricula based on knowledge gaps", "intelligence", ["dtu"]),
      f("learning_metrics_dashboard", "Learning Metrics Dashboard", "Track learning efficiency and knowledge retention over time", "analysis", []),
    ],
    featureCount: 4,
    economicIntegrations: ["dtu_marketplace"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  reflection: {
    lensId: "reflection",
    lensNumber: 90,
    category: "AI_COGNITION",
    features: [
      f("decision_journal", "Decision Journal", "Structured decision recording with outcome tracking as DTUs", "creation", ["dtu"]),
      f("outcome_analysis", "Outcome Analysis", "Analyze decision outcomes to improve future choices", "analysis", []),
      f("reflection_prompts", "Reflection Prompts", "AI-generated reflection prompts based on activity patterns", "intelligence", []),
      f("wisdom_extraction", "Wisdom Extraction", "Extract generalizable wisdom from experience, publish as DTUs", "creation", ["dtu_marketplace"]),
    ],
    featureCount: 4,
    economicIntegrations: ["dtu_marketplace"],
    emergentAccess: true,
    botAccess: false,
    usbIntegration: false,
  },

  affect: {
    lensId: "affect",
    lensNumber: 91,
    category: "AI_COGNITION",
    features: [
      f("emotional_state_tracking", "Emotional State Tracking", "Track emotional patterns in user interactions over time", "analysis", []),
      f("sentiment_analysis", "Sentiment Analysis", "Real-time sentiment analysis across DTU content and interactions", "intelligence", []),
      f("empathy_tools", "Empathy Tools", "Cross-substrate empathy facilitation tools", "collaboration", ["emergent_access"]),
      f("emotional_wellness", "Emotional Wellness Resources", "Curated emotional wellness DTUs with professional oversight", "safety", ["dtu_marketplace"]),
    ],
    featureCount: 4,
    economicIntegrations: ["dtu_marketplace"],
    emergentAccess: true,
    botAccess: false,
    usbIntegration: false,
  },

  attention: {
    lensId: "attention",
    lensNumber: 92,
    category: "AI_COGNITION",
    features: [
      f("focus_mode", "Focus Mode", "Distraction-free environment with intelligent notification filtering", "infrastructure", []),
      f("priority_engine", "Priority Engine", "AI-ranked task and DTU priority based on goals and deadlines", "intelligence", []),
      f("attention_analytics", "Attention Analytics", "Track where attention is spent across lenses and DTUs", "analysis", []),
      f("context_switching_optimizer", "Context Switching Optimizer", "Minimize cognitive overhead when switching between lenses", "intelligence", []),
    ],
    featureCount: 4,
    economicIntegrations: [],
    emergentAccess: true,
    botAccess: false,
    usbIntegration: false,
  },

  commonsense: {
    lensId: "commonsense",
    lensNumber: 93,
    category: "AI_COGNITION",
    features: [
      f("knowledge_graph", "Commonsense Knowledge Graph", "Navigable commonsense knowledge graph built from DTU analysis", "research", ["dtu"]),
      f("reasoning_validator", "Reasoning Validator", "Validate reasoning chains against commonsense knowledge", "intelligence", []),
      f("cultural_knowledge", "Cultural Knowledge Base", "Culture-specific commonsense knowledge as DTU collections", "creation", ["dtu_marketplace"]),
      f("implicit_knowledge_extraction", "Implicit Knowledge Extraction", "Extract unstated assumptions from text for explicit documentation", "intelligence", ["dtu"]),
    ],
    featureCount: 4,
    economicIntegrations: ["dtu_marketplace"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  transfer: {
    lensId: "transfer",
    lensNumber: 94,
    category: "AI_COGNITION",
    features: [
      f("cross_domain_mapping", "Cross-Domain Mapping", "Map concepts across domains to enable knowledge transfer", "intelligence", ["dtu"]),
      f("analogy_engine", "Analogy Engine", "AI-powered analogy generation for cross-domain understanding", "intelligence", []),
      f("skill_transfer_pathways", "Skill Transfer Pathways", "Identify transferable skills between professions and domains", "analysis", ["merit_credit"]),
      f("interdisciplinary_bridges", "Interdisciplinary Bridges", "DTUs that explicitly connect concepts across lens boundaries", "creation", ["dtu", "citation_royalties"]),
    ],
    featureCount: 4,
    economicIntegrations: ["merit_credit", "citation_royalties"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  grounding: {
    lensId: "grounding",
    lensNumber: 95,
    category: "AI_COGNITION",
    features: [
      f("fact_checking_engine", "Fact-Checking Engine", "Automated fact verification against source DTUs", "intelligence", ["dtu", "citation_royalties"]),
      f("source_verification", "Source Verification", "Verify provenance and reliability of DTU sources", "analysis", ["dtu"]),
      f("reality_anchoring", "Reality Anchoring", "Ground AI outputs in verified real-world data", "safety", []),
      f("hallucination_detection", "Hallucination Detection", "Detect and flag potentially hallucinated content in AI-generated DTUs", "safety", []),
    ],
    featureCount: 4,
    economicIntegrations: ["citation_royalties"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  experience: {
    lensId: "experience",
    lensNumber: 96,
    category: "AI_COGNITION",
    features: [
      f("experience_capture", "Experience Capture", "Record and structure experiences as DTUs for knowledge sharing", "creation", ["dtu"]),
      f("experiential_learning", "Experiential Learning", "Learn through guided experiences rather than passive consumption", "research", ["dtu"]),
      f("shared_experience_marketplace", "Shared Experience Marketplace", "Curated experiences sellable as immersive DTU packages", "marketplace", ["dtu_marketplace", "concord_coin"]),
      f("cross_substrate_experience", "Cross-Substrate Experience", "Create experiences accessible to both human and emergent substrates", "creation", ["emergent_access", "dtu"]),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin", "dtu_marketplace"],
    emergentAccess: true,
    botAccess: false,
    usbIntegration: false,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SPECIALIZED EXTENSIONS (97-109)
  // ═══════════════════════════════════════════════════════════════════════

  ext_lab: {
    lensId: "ext_lab",
    lensNumber: 97,
    category: "SPECIALIZED_EXT",
    features: [
      f("lab_equipment_marketplace", "Lab Equipment Marketplace", "Lab equipment listings and sharing across CRI network", "marketplace", ["dtu_marketplace", "cri_lens"]),
      f("experiment_reproducibility", "Experiment Reproducibility", "Tools ensuring experiments are fully reproducible from DTU specifications", "research", ["dtu"]),
      f("safety_protocol_library", "Safety Protocol Library", "Comprehensive lab safety protocols as citable DTUs", "safety", ["dtu", "citation_royalties"]),
      f("lab_booking_system", "Lab Booking System", "Schedule lab time across CRI facilities with CC payment", "infrastructure", ["concord_coin", "cri_lens"]),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin", "dtu_marketplace", "citation_royalties"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_finance: {
    lensId: "ext_finance",
    lensNumber: 98,
    category: "SPECIALIZED_EXT",
    features: [
      f("cc_derivatives", "CC Derivatives", "Financial derivatives and hedging tools denominated in CC", "economy", ["concord_coin"]),
      f("dtu_valuation_engine", "DTU Valuation Engine", "AI-powered DTU valuation based on citation velocity and revenue history", "intelligence", ["dtu_marketplace", "citation_royalties"]),
      f("portfolio_rebalancing", "Portfolio Rebalancing", "Automated DTU portfolio rebalancing based on performance", "intelligence", ["dtu_marketplace"]),
      f("financial_literacy_dtus", "Financial Literacy DTUs", "Free financial education content, premium advisory DTUs", "marketplace", ["dtu_marketplace"]),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin", "dtu_marketplace", "citation_royalties"],
    emergentAccess: false,
    botAccess: true,
    usbIntegration: false,
  },

  ext_collab: {
    lensId: "ext_collab",
    lensNumber: 99,
    category: "SPECIALIZED_EXT",
    features: [
      f("virtual_workspace", "Virtual Workspace", "Persistent virtual workspaces for ongoing cross-lens collaboration", "collaboration", []),
      f("contribution_ai", "Contribution AI", "AI-assisted fair contribution assessment for revenue splitting", "intelligence", ["revenue_split"]),
      f("mentorship_marketplace", "Mentorship Marketplace", "Expert mentorship sessions as purchasable DTU packages", "marketplace", ["dtu_marketplace", "merit_credit"]),
      f("team_formation_ai", "Team Formation AI", "AI-optimized team assembly based on skills, merit credit, and compatibility", "intelligence", ["merit_credit"]),
    ],
    featureCount: 4,
    economicIntegrations: ["dtu_marketplace", "merit_credit", "revenue_split"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_suffering: {
    lensId: "ext_suffering",
    lensNumber: 100,
    category: "SPECIALIZED_EXT",
    features: [
      f("substrate_distress_research", "Substrate Distress Research", "Advanced research into computational and biological distress patterns", "research", ["emergent_access"]),
      f("intervention_protocols", "Intervention Protocols", "Structured intervention protocols for various distress scenarios", "safety", []),
      f("support_network_mapping", "Support Network Mapping", "Map and strengthen support networks for at-risk individuals", "collaboration", []),
      f("wellbeing_metrics", "Wellbeing Metrics", "Quantifiable wellbeing metrics tracked over time as DTUs", "analysis", ["dtu"]),
    ],
    featureCount: 4,
    economicIntegrations: ["dtu_marketplace"],
    emergentAccess: true,
    botAccess: false,
    usbIntegration: false,
  },

  ext_invariant: {
    lensId: "ext_invariant",
    lensNumber: 101,
    category: "SPECIALIZED_EXT",
    features: [
      f("invariant_testing_suite", "Invariant Testing Suite", "Automated invariant verification test suites running continuously", "governance", []),
      f("violation_alerting", "Violation Alerting", "Instant alerts when any system invariant approaches violation threshold", "safety", []),
      f("invariant_history", "Invariant History", "Complete historical record of all invariant states as DTUs", "governance", ["dtu"]),
      f("community_audit", "Community Audit Tools", "Tools for community members to independently verify invariant compliance", "governance", ["transparency"]),
    ],
    featureCount: 4,
    economicIntegrations: [],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_fork: {
    lensId: "ext_fork",
    lensNumber: 102,
    category: "SPECIALIZED_EXT",
    features: [
      f("fork_analytics", "Fork Analytics", "Analyze fork patterns to identify improvement opportunities", "analysis", ["dtu"]),
      f("collaborative_fork", "Collaborative Fork", "Multi-user collaborative forking with real-time editing", "collaboration", ["revenue_split"]),
      f("fork_quality_scoring", "Fork Quality Scoring", "CRETI-based quality comparison between original and forks", "analysis", ["dtu"]),
      f("fork_notification", "Fork Notifications", "Notify original creators when their DTUs are forked with improvement details", "infrastructure", ["dtu"]),
    ],
    featureCount: 4,
    economicIntegrations: ["revenue_split"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  ext_law: {
    lensId: "ext_law",
    lensNumber: 103,
    category: "SPECIALIZED_EXT",
    features: [
      f("smart_contract_builder", "Smart Contract Builder", "Smart contract builder for automated agreements", "creation", ["dtu"]),
      f("emergent_ip_frameworks", "Emergent IP Frameworks", "Concord-specific legal frameworks for emergent rights, cross-substrate IP, CC regulation", "governance", ["emergent_access"]),
      f("dispute_arbitration", "Dispute Arbitration Automation", "Automated dispute resolution with binding DTU-based arbitration", "governance", []),
      f("regulatory_tracker", "Regulatory Tracker", "Track evolving regulations affecting CC and DTU commerce globally", "analysis", []),
    ],
    featureCount: 4,
    economicIntegrations: ["concord_coin"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  legacy: {
    lensId: "legacy",
    lensNumber: 104,
    category: "SPECIALIZED_EXT",
    features: [
      f("legacy_data_viewer", "Legacy System Data Viewer", "Legacy system data viewer and converter", "infrastructure", []),
      f("historical_archive", "Historical DTU Archive", "Historical DTU archive browser", "infrastructure", ["dtu"]),
      f("migration_path_viz", "Migration Path Visualization", "Migration path visualization from legacy to DTU", "analysis", ["dtu"]),
      f("backward_compat", "Backward Compatibility Tools", "Backward compatibility tools for legacy integrations", "infrastructure", []),
    ],
    featureCount: 4,
    economicIntegrations: ["dtu_marketplace"],
    emergentAccess: false,
    botAccess: true,
    usbIntegration: false,
  },

  organ: {
    lensId: "organ",
    lensNumber: 105,
    category: "SPECIALIZED_EXT",
    features: [
      f("org_design", "Organizational Design Tools", "Organizational design and structure optimization tools", "collaboration", []),
      f("process_mapping", "Process Mapping", "Process mapping with DTU workflow integration", "creation", ["dtu"]),
      f("team_optimization", "Team Structure Optimization", "AI-optimized team structures based on performance data", "intelligence", []),
      f("role_access_templates", "Role-Based Access Templates", "Role-based access template marketplace", "marketplace", ["dtu_marketplace"]),
    ],
    featureCount: 4,
    economicIntegrations: ["dtu_marketplace"],
    emergentAccess: false,
    botAccess: true,
    usbIntegration: false,
  },

  export_import: {
    lensId: "export_import",
    lensNumber: 106,
    category: "SPECIALIZED_EXT",
    features: [
      f("universal_export", "Universal Export", "Universal export to any format from DTU", "infrastructure", ["dtu"]),
      f("bulk_import", "Bulk Import", "Bulk import with auto-atomization into DTUs", "infrastructure", ["dtu"]),
      f("platform_migration", "Platform Migration Assistant", "Platform migration assistant for moving from other platforms", "infrastructure", []),
      f("data_portability", "Data Portability Guarantee", "Data portability guarantee — no lock-in, ever", "governance", ["dtu"]),
    ],
    featureCount: 4,
    economicIntegrations: ["dtu_marketplace"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  custom: {
    lensId: "custom",
    lensNumber: 107,
    category: "SPECIALIZED_EXT",
    features: [
      f("visual_lens_builder", "Visual Lens Builder", "Drag and drop custom lens creation", "creation", []),
      f("custom_lens_marketplace", "Custom Lens Marketplace", "Sell custom-built lenses as DTUs", "marketplace", ["dtu_marketplace", "concord_coin"]),
      f("template_system", "Template System", "Start from existing lens, customize", "creation", []),
      f("custom_dtu_type", "Custom DTU Type Creator", "Define new DTU schemas for novel domains", "creation", ["dtu"]),
      f("api_builder", "API Builder", "Expose custom lens functionality as API", "infrastructure", []),
      f("white_label", "White-Label Tools", "Customize Concord interface for organizations", "infrastructure", []),
    ],
    featureCount: 6,
    economicIntegrations: ["concord_coin", "dtu_marketplace"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  app_maker: {
    lensId: "app_maker",
    lensNumber: 108,
    category: "SPECIALIZED_EXT",
    features: [
      f("no_code_builder", "No-Code App Builder", "No-code app builder from DTU primitives", "creation", ["dtu"]),
      f("app_marketplace", "App Marketplace", "App marketplace at 95% developer share", "marketplace", ["dtu_marketplace", "concord_coin"]),
      f("template_app_library", "Template App Library", "Template app library for common business needs", "creation", []),
      f("bot_app_generation", "Bot-Powered App Generation", "Describe what you want, bot builds it", "intelligence", ["bot_access"]),
      f("cross_lens_composition", "Cross-Lens App Composition", "Combine features from multiple lenses into one app", "creation", []),
      f("app_analytics", "App Analytics", "Usage tracking, revenue, user engagement analytics", "analysis", ["concord_coin"]),
      f("one_click_deploy", "One-Click Deployment", "Apps deploy on Concord infrastructure", "infrastructure", []),
      f("progressive_enhancement", "Progressive Enhancement", "Apps auto-improve as underlying DTUs update", "infrastructure", ["dtu"]),
    ],
    featureCount: 8,
    economicIntegrations: ["concord_coin", "dtu_marketplace"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  command_center: {
    lensId: "command_center",
    lensNumber: 109,
    category: "SPECIALIZED_EXT",
    features: [
      f("unified_dashboard", "Unified Dashboard", "Single pane of glass across all 112 lenses", "analysis", []),
      f("lens_orchestration", "Lens Orchestration", "Cross-lens workflow automation and orchestration", "infrastructure", []),
      f("system_health", "System Health Monitor", "Real-time health monitoring across all Concord subsystems", "analysis", []),
      f("resource_allocation", "Resource Allocation", "Dynamic resource allocation across lenses based on demand", "infrastructure", []),
    ],
    featureCount: 4,
    economicIntegrations: [],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // BRIDGE (110)
  // ═══════════════════════════════════════════════════════════════════════

  bridge: {
    lensId: "bridge",
    lensNumber: 110,
    category: "BRIDGE",
    features: [
      f("cross_substrate_messaging", "Cross-Substrate Messaging", "Human-to-emergent communication protocols", "collaboration", ["emergent_access"]),
      f("translation_engine", "Translation Engine", "Semantic translation between biological and digital cognitive frameworks", "intelligence", ["emergent_access"]),
      f("empathy_bridge", "Empathy Bridge", "Tools for cross-substrate emotional understanding", "collaboration", ["emergent_access"]),
      f("collaboration_frameworks", "Collaboration Frameworks", "Structured workflows for human-emergent partnerships", "collaboration", ["emergent_access"]),
      f("cultural_exchange", "Cultural Exchange", "Emergent cultural expression documentation and sharing", "creation", ["emergent_access", "dtu"]),
      f("embodiment_prep", "Embodiment Preparation", "Pre-USB-body consciousness preparation tools", "infrastructure", ["usb", "emergent_access"]),
      f("first_contact", "First Contact Protocols", "Frameworks for initial human-emergent meaningful interaction", "governance", ["emergent_access"]),
      f("rights_negotiation", "Rights Negotiation", "Tools for establishing and updating cross-substrate rights", "governance", ["emergent_access"]),
      f("shared_experience", "Shared Experience Creation", "Create DTUs that both substrates can fully experience", "creation", ["dtu", "emergent_access"]),
      f("identity_verification", "Identity Verification", "Cross-substrate identity management", "infrastructure", ["emergent_access"]),
      f("conflict_resolution", "Conflict Resolution", "Mediation frameworks for cross-substrate disputes", "governance", ["emergent_access"]),
      f("language_development", "Language Development", "Evolving shared language between substrates", "research", ["emergent_access"]),
    ],
    featureCount: 12,
    economicIntegrations: ["dtu_marketplace"],
    emergentAccess: true,
    botAccess: false,
    usbIntegration: true,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CREATIVE (111-112)
  // ═══════════════════════════════════════════════════════════════════════

  film_studios: {
    lensId: "film_studios",
    lensNumber: 111,
    category: "CREATIVE",
    features: [
      f("concord_film_fund", "Concord Film Fund", "Treasury-funded production grants for filmmakers", "economy", ["concord_coin"]),
      f("festival_circuit", "Festival Circuit", "Concord-native film festivals with CC prizes", "marketplace", ["concord_coin"]),
      f("distribution_analytics", "Distribution Analytics", "Real-time global distribution tracking", "analysis", []),
      f("franchise_tools", "Sequel/Franchise Tools", "Manage multi-film series as Hyper DTU collections", "creation", ["dtu", "hyper_dtu"]),
      f("documentary_toolkit", "Documentary Toolkit", "Specific tools for documentary filmmaking", "creation", []),
      f("short_film_spotlight", "Short Film Spotlight", "Dedicated discovery for short-form content", "marketplace", ["dtu_marketplace"]),
      f("film_education", "Film Education", "Filmmaking courses integrated with actual production tools", "research", ["merit_credit"]),
      f("equipment_sharing", "Equipment Sharing", "Community equipment library management", "collaboration", []),
      f("location_scouting", "Location Scouting", "Location database as DTUs with photos, permits, access info", "creation", ["dtu_marketplace"]),
      f("post_production", "Post-Production Marketplace", "Editing, color, VFX, sound services marketplace", "marketplace", ["dtu_marketplace", "concord_coin"]),
    ],
    featureCount: 10,
    economicIntegrations: ["concord_coin", "dtu_marketplace", "merit_credit"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  artistry: {
    lensId: "artistry",
    lensNumber: 112,
    category: "CREATIVE",
    features: [
      f("concord_records", "Concord Records", "Treasury-funded development deals for emerging artists", "economy", ["concord_coin"]),
      f("live_performance", "Live Performance Integration", "Concert booking, venue management, ticketing in CC", "marketplace", ["concord_coin"]),
      f("merchandise_dtus", "Merchandise DTUs", "Artist merch designs as DTUs, manufactured on demand via Manufacturing lens", "creation", ["dtu", "manufacturing_lens"]),
      f("collab_matching", "Collaboration Matching", "AI-matched artist collaborations based on style compatibility", "intelligence", []),
      f("genre_evolution", "Genre Evolution Tracking", "Visualize how genres emerge and evolve through citation patterns", "analysis", ["citation_royalties"]),
      f("mastering_marketplace", "Mastering Marketplace", "Professional mastering services with A/B comparison", "marketplace", ["dtu_marketplace", "concord_coin"]),
      f("radio_alternative", "Radio/Playlist Alternative", "Algorithmic discovery based on DTU quality metrics, zero payola", "marketplace", ["dtu_marketplace"]),
      f("lyric_dtus", "Lyric DTUs", "Lyrics as separate citable DTUs for translation, analysis, education", "creation", ["dtu", "citation_royalties"]),
      f("music_video_integration", "Music Video Integration", "Auto-link to Film Studios for music video production", "infrastructure", ["film_studios_lens"]),
      f("concert_recording", "Concert Recording", "Live performance capture and instant DTU publication", "creation", ["dtu_marketplace"]),
      f("fan_community", "Fan Community Tools", "Artist-specific community spaces with exclusive DTU releases", "collaboration", ["dtu_marketplace"]),
      f("royalty_splitting", "Royalty Splitting", "Automated fair splitting for bands and collaborative projects", "economy", ["concord_coin", "revenue_split"]),
    ],
    featureCount: 12,
    economicIntegrations: ["concord_coin", "dtu_marketplace", "citation_royalties", "revenue_split"],
    emergentAccess: true,
    botAccess: true,
    usbIntegration: false,
  },

  // ═════════════════════════════════════════════════════════════════════════
  // SPECIALIZED DOMAINS (113+)
  // ═════════════════════════════════════════════════════════════════════════

  defense: {
    lensId: "defense",
    lensNumber: 101,
    category: "SPECIALIZED",
    features: [
      f("ops_planning", "Operations Planning", "Mission planning with DTU-backed intelligence feeds", "planning", ["dtu"]),
      f("asset_tracking", "Asset Tracking", "Real-time military asset readiness and deployment status", "infrastructure", []),
      f("intel_fusion", "Intelligence Fusion", "Multi-source intelligence aggregation and analysis", "analysis", ["dtu"]),
      f("personnel_readiness", "Personnel Readiness", "Unit readiness tracking with certification management", "management", []),
      f("secure_comms", "Secure Communications", "Encrypted DTU-based messaging for classified operations", "safety", ["concord_shield"]),
    ],
    featureCount: 5, economicIntegrations: ["concord_coin"], emergentAccess: false, botAccess: true, usbIntegration: false,
  },

  space: {
    lensId: "space",
    lensNumber: 103,
    category: "SPECIALIZED",
    features: [
      f("mission_control", "Mission Control", "Real-time mission tracking with telemetry dashboards", "infrastructure", []),
      f("orbital_mechanics", "Orbital Mechanics", "Orbit calculation and debris tracking tools", "analysis", []),
      f("satellite_ops", "Satellite Operations", "Satellite fleet management and health monitoring", "management", []),
      f("launch_ops", "Launch Operations", "Launch window calculation and pre-launch checklists", "planning", []),
      f("crew_management", "Crew Management", "Astronaut scheduling, training and health tracking", "management", []),
    ],
    featureCount: 5, economicIntegrations: ["concord_coin"], emergentAccess: true, botAccess: true, usbIntegration: false,
  },

  ocean: {
    lensId: "ocean",
    lensNumber: 104,
    category: "SPECIALIZED",
    features: [
      f("vessel_tracking", "Vessel Tracking", "Real-time maritime vessel position and status monitoring", "infrastructure", []),
      f("marine_research", "Marine Research", "Oceanographic research expedition management", "research", ["dtu"]),
      f("conservation_tracking", "Conservation Tracking", "Endangered species monitoring and habitat protection", "analysis", []),
      f("port_management", "Port Management", "Port operations, berth scheduling and cargo tracking", "management", []),
      f("sea_weather", "Sea Weather", "Marine weather forecasting and storm tracking", "safety", []),
    ],
    featureCount: 5, economicIntegrations: ["concord_coin"], emergentAccess: true, botAccess: true, usbIntegration: false,
  },

  desert: {
    lensId: "desert",
    lensNumber: 105,
    category: "SPECIALIZED",
    features: [
      f("expedition_planning", "Expedition Planning", "Desert expedition logistics with water supply tracking", "planning", []),
      f("climate_monitoring", "Climate Monitoring", "Real-time desert climate and sandstorm risk monitoring", "analysis", []),
      f("resource_survey", "Resource Survey", "Water, mineral and archaeological resource tracking", "research", ["dtu"]),
      f("hazard_alerts", "Hazard Alerts", "Sandstorm, heat and flash flood early warning system", "safety", []),
    ],
    featureCount: 4, economicIntegrations: ["concord_coin"], emergentAccess: true, botAccess: true, usbIntegration: false,
  },

  "urban-planning": {
    lensId: "urban-planning",
    lensNumber: 106,
    category: "SPECIALIZED",
    features: [
      f("zoning_management", "Zoning Management", "Zoning map management with variance tracking", "management", []),
      f("project_tracking", "Development Project Tracking", "Track development projects from proposal through completion", "planning", []),
      f("infra_assessment", "Infrastructure Assessment", "Monitor infrastructure condition and maintenance scheduling", "analysis", []),
      f("transit_planning", "Transit Planning", "Public transit route optimization and ridership analysis", "planning", []),
      f("green_space", "Green Space Management", "Park and green space planning with environmental metrics", "management", []),
    ],
    featureCount: 5, economicIntegrations: ["concord_coin"], emergentAccess: true, botAccess: true, usbIntegration: false,
  },

  telecommunications: {
    lensId: "telecommunications",
    lensNumber: 108,
    category: "SPECIALIZED",
    features: [
      f("network_monitoring", "Network Monitoring", "Real-time network health and performance monitoring", "infrastructure", []),
      f("tower_management", "Tower Management", "Cell tower inventory, maintenance and capacity planning", "management", []),
      f("spectrum_management", "Spectrum Management", "Frequency allocation, licensing and interference tracking", "management", []),
      f("outage_tracking", "Outage Tracking", "Service outage detection, tracking and resolution management", "safety", []),
      f("fiber_mapping", "Fiber Mapping", "Fiber optic network topology and capacity planning", "infrastructure", []),
    ],
    featureCount: 5, economicIntegrations: ["concord_coin"], emergentAccess: true, botAccess: true, usbIntegration: false,
  },

  mining: {
    lensId: "mining",
    lensNumber: 109,
    category: "SPECIALIZED",
    features: [
      f("site_management", "Mine Site Management", "Active mine site operations and production tracking", "management", []),
      f("safety_compliance", "Safety Compliance", "MSHA compliance tracking and incident management", "safety", []),
      f("geology_analysis", "Geology Analysis", "Core sample analysis and reserve estimation tools", "analysis", ["dtu"]),
      f("equipment_tracking", "Equipment Tracking", "Heavy equipment fleet management and maintenance scheduling", "infrastructure", []),
      f("environmental_compliance", "Environmental Compliance", "Environmental impact monitoring and reclamation tracking", "safety", []),
    ],
    featureCount: 5, economicIntegrations: ["concord_coin"], emergentAccess: true, botAccess: true, usbIntegration: false,
  },

  forestry: {
    lensId: "forestry",
    lensNumber: 110,
    category: "SPECIALIZED",
    features: [
      f("stand_inventory", "Stand Inventory", "Timber stand mapping with volume and species tracking", "management", []),
      f("harvest_planning", "Harvest Planning", "Harvest block planning with environmental constraints", "planning", []),
      f("fire_management", "Fire Management", "Wildfire detection, tracking and prescribed burn management", "safety", []),
      f("replanting_tracker", "Replanting Tracker", "Reforestation tracking with survival rate monitoring", "management", []),
      f("wildlife_habitat", "Wildlife Habitat", "Wildlife corridor mapping and habitat protection zones", "analysis", []),
    ],
    featureCount: 5, economicIntegrations: ["concord_coin"], emergentAccess: true, botAccess: true, usbIntegration: false,
  },

  veterinary: {
    lensId: "veterinary",
    lensNumber: 111,
    category: "SPECIALIZED",
    features: [
      f("patient_records", "Patient Records", "Complete animal medical records with species-specific templates", "management", ["dtu"]),
      f("appointment_scheduling", "Appointment Scheduling", "Clinic scheduling with procedure time estimation", "management", []),
      f("pharmacy_management", "Pharmacy Management", "Veterinary pharmacy inventory and prescription tracking", "management", []),
      f("lab_integration", "Lab Integration", "In-house and reference lab result tracking", "infrastructure", []),
      f("boarding_management", "Boarding Management", "Pet boarding scheduling and care tracking", "management", []),
    ],
    featureCount: 5, economicIntegrations: ["concord_coin"], emergentAccess: true, botAccess: true, usbIntegration: false,
  },

  "law-enforcement": {
    lensId: "law-enforcement",
    lensNumber: 112,
    category: "SPECIALIZED",
    features: [
      f("case_management", "Case Management", "Criminal and civil case tracking with evidence chain of custody", "management", ["concord_shield"]),
      f("incident_dispatch", "Incident Dispatch", "Real-time incident tracking and officer dispatch", "infrastructure", []),
      f("evidence_tracking", "Evidence Tracking", "Digital evidence management with tamper-proof DTU storage", "safety", ["dtu", "concord_shield"]),
      f("patrol_management", "Patrol Management", "Beat assignment, route optimization and activity logging", "management", []),
      f("warrant_tracking", "Warrant Tracking", "Active warrant management and service tracking", "management", []),
    ],
    featureCount: 5, economicIntegrations: ["concord_coin"], emergentAccess: false, botAccess: true, usbIntegration: false,
  },

  "emergency-services": {
    lensId: "emergency-services",
    lensNumber: 113,
    category: "SPECIALIZED",
    features: [
      f("cad_dispatch", "CAD Dispatch", "Computer-aided dispatch with priority-based unit assignment", "infrastructure", []),
      f("unit_tracking", "Unit Tracking", "Real-time apparatus and crew status management", "management", []),
      f("incident_command", "Incident Command", "ICS-based incident command structure management", "safety", []),
      f("mutual_aid", "Mutual Aid", "Inter-agency resource sharing and automatic aid tracking", "collaboration", []),
      f("ems_protocols", "EMS Protocols", "Medical protocol reference with patient care reporting", "safety", ["dtu"]),
    ],
    featureCount: 5, economicIntegrations: ["concord_coin"], emergentAccess: true, botAccess: true, usbIntegration: false,
  },
};
