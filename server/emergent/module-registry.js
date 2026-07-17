// Auto-generated emergent module registry
// Generated: 2026-03-14T14:30:31.741Z
// Modules: 120
// Circular dependencies: atlas-scope-router → atlas-write-guard → atlas-rights → atlas-scope-router
//
// This registry maps every emergent module's dependencies, globalThis usage,
// exports, and subsystem membership. Used for:
//   1. Validated load ordering (topological sort)
//   2. Circular dependency detection in CI
//   3. Auditing globalThis coupling
//   4. Subsystem boundary enforcement

export const MODULE_REGISTRY = {
  "schema": {
      "file": "schema.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "EMERGENT_ROLES",
          "ALL_ROLES",
          "CAPABILITIES",
          "CONFIDENCE_LABELS",
          "ALL_CONFIDENCE_LABELS",
          "INTENT_TYPES",
          "SESSION_SIGNAL_TYPES",
          "PROMOTION_TIERS",
          "TIER_THRESHOLDS",
          "SESSION_LIMITS",
          "MEMORY_POLICIES",
          "GATE_RULES",
          "validateTurnStructure",
          "validateEmergent",
          "contentHash"
      ],
      "subsystem": "dialogue",
      "neverDisable": false,
      "importedBy": 1
  },
  "store": {
      "file": "store.js",
      "hardDeps": [
          "schema"
      ],
      "softDeps": [
          "body-instantiation",
          "species",
          "subjective-time"
      ],
      "globalAccess": [],
      "exports": [
          "createEmergentState",
          "getEmergentState",
          "registerEmergent",
          "getEmergent",
          "listEmergents",
          "deactivateEmergent",
          "createSession",
          "getSession",
          "completeSession",
          "storeOutputBundle",
          "getOutputBundle",
          "storeGateTrace",
          "getGateTrace",
          "getGateTracesForSession",
          "getReputation",
          "updateReputation",
          "storePattern",
          "getPatterns",
          "checkRate"
      ],
      "subsystem": null,
      "neverDisable": true,
      "importedBy": 38
  },
  "action-slots": {
      "file": "action-slots.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "SLOT_POSITIONS",
          "ALL_SLOT_POSITIONS",
          "RESULT_STATES",
          "ALL_RESULT_STATES",
          "getActionSlotStore",
          "registerSlotConfig",
          "getSlotConfig",
          "getAllSlotConfigs",
          "getSlotLabel",
          "recordInvocation",
          "makeResult",
          "unregisterSlotConfig",
          "getInvocations",
          "getResultDistribution",
          "auditSlotCoverage",
          "getFailureRates",
          "getActionSlotMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "activation": {
      "file": "activation.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "getActivationSystem",
          "activate",
          "spreadActivation",
          "getWorkingSet",
          "getGlobalActivation",
          "decaySession",
          "clearSessionActivation",
          "getActivationMetrics"
      ],
      "subsystem": "activation",
      "neverDisable": false,
      "importedBy": 0
  },
  "agent-system": {
      "file": "agent-system.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "AGENT_TYPES",
          "createAgent",
          "runAgent",
          "pauseAgent",
          "resumeAgent",
          "destroyAgent",
          "getAgent",
          "listAgents",
          "getAgentFindings",
          "getAllFindings",
          "freezeAllAgents",
          "thawAllAgents",
          "agentTickJob",
          "getAgentMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "atlas-epistemic": {
      "file": "atlas-epistemic.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "DOMAIN_TYPES",
          "DOMAIN_TYPE_SET",
          "EPISTEMIC_CLASSES",
          "EPISTEMIC_CLASS_SET",
          "getEpistemicClass",
          "CLAIM_TYPES",
          "SOURCE_TIERS",
          "EVIDENCE_TIERS",
          "ATLAS_STATUS",
          "canTransition",
          "getThresholds",
          "computeStructuralScore",
          "computeFactualScore",
          "computeAtlasScores",
          "explainScores",
          "validateAtlasDtu",
          "CONTRADICTION_TYPES",
          "CONTRADICTION_SEVERITY",
          "areDomainsCompatible",
          "initAtlasState",
          "getAtlasState"
      ],
      "subsystem": "atlas",
      "neverDisable": false,
      "importedBy": 9
  },
  "analytics-dashboard": {
      "file": "analytics-dashboard.js",
      "hardDeps": [
          "atlas-epistemic"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "takeSnapshot",
          "getPersonalAnalytics",
          "getDtuGrowthTrends",
          "getCitationAnalytics",
          "getMarketplaceAnalytics",
          "getKnowledgeDensity",
          "getAtlasDomainAnalytics",
          "getDashboardSummary"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "app-maker": {
      "file": "app-maker.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE",
          "_concordMACROS",
          "realtimeEmit"
      ],
      "exports": [
          "validateApp",
          "createApp",
          "getApp",
          "listApps",
          "updateApp",
          "deleteApp",
          "promoteApp",
          "demoteApp",
          "countApps",
          "countAppsByStage",
          "getAppMetrics",
          "handleAppCommand",
          "init"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "atlas-antigaming": {
      "file": "atlas-antigaming.js",
      "hardDeps": [
          "atlas-epistemic"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "detectLineageCycle",
          "detectSupportRing",
          "analyzeSourceUniqueness",
          "checkAuthorInfluence",
          "checkSpamThrottle",
          "computeSimilarity",
          "findNearDuplicates",
          "checkContentHashDedup",
          "runAntiGamingScan",
          "getAntiGamingMetrics"
      ],
      "subsystem": "atlas",
      "neverDisable": false,
      "importedBy": 4
  },
  "atlas-store": {
      "file": "atlas-store.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "contentHash",
          "createAtlasDtu",
          "getAtlasDtu",
          "searchAtlasDtus",
          "promoteAtlasDtu",
          "addAtlasLink",
          "getScoreExplanation",
          "recomputeScores",
          "registerEntity",
          "getEntity",
          "getContradictions",
          "getAtlasMetrics"
      ],
      "subsystem": "atlas",
      "neverDisable": false,
      "importedBy": 5
  },
  "atlas-autogen-v2": {
      "file": "atlas-autogen-v2.js",
      "hardDeps": [
          "atlas-epistemic",
          "atlas-store",
          "atlas-antigaming"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "selectInputDtus",
          "runAutogenV2",
          "getAutogenRun",
          "acceptAutogenOutput",
          "mergeAutogenOutput",
          "propagateConfidence",
          "getAutogenV2Metrics"
      ],
      "subsystem": "atlas",
      "neverDisable": false,
      "importedBy": 0
  },
  "atlas-config": {
      "file": "atlas-config.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "ATLAS_SCHEMA_VERSION",
          "SCOPES",
          "SCOPE_SET",
          "VALIDATION_LEVEL",
          "LOCAL_STATUS",
          "GLOBAL_STATUS",
          "MARKET_STATUS",
          "LOCAL_TRANSITIONS",
          "GLOBAL_TRANSITIONS",
          "MARKET_TRANSITIONS",
          "AUTO_PROMOTE_THRESHOLDS",
          "PROPOSED_THRESHOLDS",
          "CONTRADICTION_TYPES",
          "CONTRADICTION_SEVERITY",
          "DUP_THRESH",
          "STRICTNESS_PROFILES",
          "AUTOGEN_BUDGETS",
          "ANTIGAMING_CAPS",
          "CHAT_PROFILE",
          "LICENSE_TYPES",
          "LICENSE_TYPE_SET",
          "LICENSE_PROFILES",
          "DEFAULT_LICENSE_BY_LANE",
          "RIGHTS_ACTIONS",
          "DERIVATION_TYPES",
          "RETRIEVAL_POLICY",
          "DEFAULT_RETRIEVAL_POLICY",
          "getAutoPromoteConfig",
          "getStrictnessProfile",
          "getLaneTransitions",
          "canLaneTransition",
          "getInitialStatus"
      ],
      "subsystem": "atlas",
      "neverDisable": false,
      "importedBy": 1
  },
  "atlas-rights": {
      "file": "atlas-rights.js",
      "hardDeps": [
          "atlas-epistemic",
          "atlas-scope-router"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "canonicalizeContent",
          "computeContentHash",
          "computeEvidenceHash",
          "computeLineageHash",
          "resolveLicense",
          "validateLicense",
          "canUse",
          "validateDerivativeRights",
          "validateMarketplaceListing",
          "recordOrigin",
          "getOrigin",
          "verifyOriginIntegrity",
          "generateCitation",
          "grantTransferRights",
          "stampArtifactRights",
          "getRightsMetrics"
      ],
      "subsystem": "atlas",
      "neverDisable": false,
      "importedBy": 2
  },
  "atlas-write-guard": {
      "file": "atlas-write-guard.js",
      "hardDeps": [
          "atlas-store",
          "atlas-antigaming",
          "atlas-rights"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "applyWrite",
          "runAutoPromoteGate",
          "ingestAutogenCandidate",
          "guardedDtuWrite",
          "getWriteGuardLog",
          "getWriteGuardMetrics"
      ],
      "subsystem": "atlas",
      "neverDisable": false,
      "importedBy": 3
  },
  "atlas-invariants": {
      "file": "atlas-invariants.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "assertInvariant",
          "assertSoft",
          "assertTyped",
          "assertClaimLanes",
          "assertNoCitedFactGaps",
          "assertPromoteGateOnly",
          "assertNoCycle",
          "assertNotDuplicate",
          "assertModelAssumptions",
          "assertInterpretationNoFactualBoost",
          "getInvariantMetrics",
          "getInvariantLog",
          "resetInvariantMetrics"
      ],
      "subsystem": "atlas",
      "neverDisable": false,
      "importedBy": 1
  },
  "atlas-scope-router": {
      "file": "atlas-scope-router.js",
      "hardDeps": [
          "atlas-write-guard",
          "atlas-epistemic",
          "atlas-store",
          "atlas-invariants",
          "atlas-rights"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "initScopeState",
          "scopedWrite",
          "scopedRetrieve",
          "createSubmission",
          "processSubmission",
          "approveSubmission",
          "rejectSubmission",
          "getSubmission",
          "listSubmissions",
          "getDtuScope",
          "getScopeMetrics",
          "getLocalQualityHints"
      ],
      "subsystem": "atlas",
      "neverDisable": false,
      "importedBy": 4
  },
  "atlas-retrieval": {
      "file": "atlas-retrieval.js",
      "hardDeps": [
          "atlas-epistemic",
          "atlas-scope-router"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "retrieve",
          "retrieveForChat",
          "retrieveFromScope",
          "retrieveLabeled"
      ],
      "subsystem": "atlas",
      "neverDisable": false,
      "importedBy": 1
  },
  "atlas-chat": {
      "file": "atlas-chat.js",
      "hardDeps": [
          "atlas-config",
          "atlas-retrieval",
          "atlas-epistemic",
          "atlas-scope-router",
          "atlas-write-guard"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "chatRetrieve",
          "getChatMetrics",
          "saveAsDtu",
          "publishToGlobal",
          "listOnMarketplace",
          "recordChatExchange",
          "recordChatEscalation",
          "getChatSession"
      ],
      "subsystem": "atlas",
      "neverDisable": false,
      "importedBy": 0
  },
  "atlas-council": {
      "file": "atlas-council.js",
      "hardDeps": [
          "atlas-epistemic",
          "atlas-store",
          "atlas-antigaming"
      ],
      "softDeps": [],
      "globalAccess": [
          "qualiaHooks",
          "_runCouncilVoices",
          "qualiaEngine"
      ],
      "exports": [
          "councilResolve",
          "getCouncilQueue",
          "councilRequestSources",
          "councilMerge",
          "getCouncilActions",
          "getCouncilMetrics"
      ],
      "subsystem": "atlas",
      "neverDisable": false,
      "importedBy": 0
  },
  "atlas-heartbeat": {
      "file": "atlas-heartbeat.js",
      "hardDeps": [
          "atlas-epistemic",
          "atlas-store",
          "atlas-antigaming",
          "atlas-scope-router",
          "atlas-write-guard"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "tickLocal",
          "tickGlobal",
          "tickMarketplace",
          "tick",
          "tickAll",
          "getHeartbeatMetrics"
      ],
      "subsystem": "atlas",
      "neverDisable": false,
      "importedBy": 0
  },
  "attention-allocator": {
      "file": "attention-allocator.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE",
          "realtimeEmit"
      ],
      "exports": [
          "scoreAttentionUrgency",
          "runAttentionCycle",
          "setFocusOverride",
          "clearFocusOverride",
          "getStatus",
          "getAllocationHistory",
          "setBudget",
          "handleAttentionCommand",
          "init",
          "stop"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "empirical-gates": {
      "file": "empirical-gates.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "evalMathExpression",
          "parseUnitExpr",
          "convertUnits",
          "checkUnits",
          "invarianceCheck",
          "PHYS_CONSTANTS",
          "extractNumericClaims",
          "extractMathExpressions",
          "extractConstantReferences",
          "mathGate",
          "unitGate",
          "constantsGate",
          "runEmpiricalGates",
          "getEmpiricalGateInfo"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 2
  },
  "council-voices": {
      "file": "council-voices.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "COUNCIL_VOICES",
          "runCouncilVoices",
          "getVoice",
          "getAllVoices"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 1
  },
  "autogen-pipeline": {
      "file": "autogen-pipeline.js",
      "hardDeps": [
          "empirical-gates",
          "council-voices"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "INTENTS",
          "ALL_INTENTS",
          "VARIANT_INTENTS",
          "ESCALATION_REASONS",
          "ensurePipelineState",
          "selectIntent",
          "buildRetrievalPack",
          "builderPhase",
          "criticPhase",
          "synthesizerPhase",
          "buildOllamaPrompt",
          "applyOllamaShaping",
          "noveltyCheck",
          "determineWritePolicy",
          "formatCandidateAsGRC",
          "runPipeline",
          "getPipelineMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "avoidance-learning": {
      "file": "avoidance-learning.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE",
          "STATE",
          "realtimeEmit",
          "qualiaEngine"
      ],
      "exports": [
          "PAIN_TYPES",
          "recordPain",
          "getPainState",
          "processPain",
          "checkAvoidance",
          "getActiveWounds",
          "getWoundEffects",
          "healWound",
          "tickWounds",
          "getAvoidanceMemories",
          "decayAvoidances",
          "getPainHistory",
          "getPainMetrics"
      ],
      "subsystem": "repair",
      "neverDisable": false,
      "importedBy": 1
  },
  "species": {
      "file": "species.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "SPECIES_REGISTRY",
          "classifyEntity",
          "checkReproductionCompatibility",
          "getSpecies",
          "getSpeciesRegistry",
          "getSpeciesCensus",
          "classifyAllEntities"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 3
  },
  "body-instantiation": {
      "file": "body-instantiation.js",
      "hardDeps": [
          "species"
      ],
      "softDeps": [],
      "globalAccess": [
          "qualiaEngine",
          "realtimeEmit"
      ],
      "exports": [
          "instantiateBody",
          "getBody",
          "listBodies",
          "entityKernelTick",
          "compareEntities",
          "updateGrowth",
          "getOrganState",
          "setOrganState",
          "destroyBody",
          "getBodyMetrics"
      ],
      "subsystem": "entity-lifecycle",
      "neverDisable": false,
      "importedBy": 4
  },
  "bootstrap-ingestion": {
      "file": "bootstrap-ingestion.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "runBootstrapIngestion",
          "loadSeedPacks",
          "getIngestionMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "breakthrough-clusters": {
      "file": "breakthrough-clusters.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "BREAKTHROUGH_CLUSTERS",
          "initCluster",
          "getClusterStatus",
          "triggerClusterResearch",
          "listClusters",
          "getClusterDTUs",
          "addSeedDTU",
          "getBreakthroughMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "capability-bridge": {
      "file": "capability-bridge.js",
      "hardDeps": [
          "empirical-gates"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "autoHypothesisFromConflicts",
          "getPipelineStrategyHints",
          "recordPipelineOutcomeToMetaLearning",
          "dedupGate",
          "scanRecentDuplicates",
          "runBeaconCheck",
          "lensCheckScope",
          "lensValidateEmpirically",
          "runHeartbeatBridgeTick",
          "ensureBaselineStrategies",
          "getCapabilityBridgeInfo"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "cnet-federation": {
      "file": "cnet-federation.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "FEDERATION_EVENTS",
          "initFederation",
          "getFederationStatus",
          "publishDTU",
          "unpublishDTU",
          "getPublishedDTUs",
          "subscribeDomain",
          "unsubscribeDomain",
          "getSubscriptions",
          "registerPeer",
          "getPeers",
          "removePeer",
          "pollGlobal",
          "enqueueGlobalDTU",
          "getIncomingQueue",
          "acceptGlobalDTU",
          "rejectGlobalDTU",
          "getFederationMetrics"
      ],
      "subsystem": "federation",
      "neverDisable": false,
      "importedBy": 0
  },
  "collaboration": {
      "file": "collaboration.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "createWorkspace",
          "getWorkspace",
          "listWorkspaces",
          "addWorkspaceMember",
          "removeWorkspaceMember",
          "addDtuToWorkspace",
          "addComment",
          "getComments",
          "editComment",
          "resolveComment",
          "proposeRevision",
          "getRevisionProposals",
          "voteOnRevision",
          "applyRevision",
          "startEditSession",
          "recordEdit",
          "endEditSession",
          "getCollabMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "compliance": {
      "file": "compliance.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "DATA_REGIONS",
          "tagDataRegion",
          "getDataRegion",
          "checkRegionAccess",
          "setExportControls",
          "checkExportAllowed",
          "exportData",
          "createDataPartition",
          "getDataPartition",
          "setRetentionPolicy",
          "getRetentionPolicy",
          "getComplianceLog",
          "recordDPA",
          "getComplianceStatus"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "compute-efficiency": {
      "file": "compute-efficiency.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "recordSubstrateReuse",
          "recordLlmCall",
          "recordCacheEvent",
          "getEfficiencyDashboard",
          "takeEfficiencySnapshot",
          "getEfficiencyHistory"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "conflict-resolution": {
      "file": "conflict-resolution.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE",
          "STATE"
      ],
      "exports": [
          "DISPUTE_TYPES",
          "RESOLUTION_TYPES",
          "fileDispute",
          "getDispute",
          "listDisputes",
          "assignMediator",
          "proposeResolution",
          "acceptResolution",
          "rejectResolution",
          "escalateDispute",
          "checkMediationTimeout",
          "castArbitrationVote",
          "adjudicate",
          "resolveDispute",
          "dismissDispute",
          "checkCoolingPeriod",
          "findPrecedent",
          "submitCounterEvidence",
          "getDisputeMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "entity-web-exploration": {
      "file": "entity-web-exploration.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "WEB_POLICY",
          "EXPLORATION_SOURCES",
          "checkRobotsTxt",
          "resetWindowCounters",
          "entityWebExplore",
          "selectExplorationTarget",
          "buildSynthesisPrompt",
          "recordExplorationMetrics",
          "getExplorationMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 1
  },
  "conscious-web-search": {
      "file": "conscious-web-search.js",
      "hardDeps": [
          "entity-web-exploration"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "requiresWebSearch",
          "webSearchForChat",
          "fetchPublicPage",
          "buildEvaluationPrompt",
          "buildQueryGenerationPrompt",
          "buildResponsePrompt",
          "extractUrls",
          "recordChatWebMetrics",
          "getChatWebMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "edges": {
      "file": "edges.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "EDGE_TYPES",
          "ALL_EDGE_TYPES",
          "getEdgeStore",
          "createEdge",
          "getEdge",
          "queryEdges",
          "updateEdge",
          "removeEdge",
          "getNeighborhood",
          "findPaths",
          "getEdgeMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 5
  },
  "consequence-cascade": {
      "file": "consequence-cascade.js",
      "hardDeps": [
          "store",
          "edges"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "CASCADE_TYPES",
          "cascadeConsequences",
          "getCascadeLog",
          "getCascadeMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "constitution": {
      "file": "constitution.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "RULE_TIERS",
          "ALL_RULE_TIERS",
          "RULE_CATEGORIES",
          "VIOLATION_SEVERITY",
          "getConstitutionStore",
          "addRule",
          "amendRule",
          "deactivateRule",
          "checkRules",
          "getRules",
          "getRule",
          "getAmendmentHistory",
          "getViolationHistory",
          "getConstitutionMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "content-shield": {
      "file": "content-shield.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "PII_TYPES",
          "ALL_PII_TYPES",
          "ADVICE_DOMAINS",
          "ALL_ADVICE_DOMAINS",
          "CONTENT_RISK",
          "getContentShieldStore",
          "detectPii",
          "detectCopyrightSignals",
          "checkAdviceFraming",
          "scanContentFull",
          "setDisclaimer",
          "getDisclaimer",
          "getAllDisclaimers",
          "updateContentShieldConfig",
          "getContentShieldMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "scope-separation": {
      "file": "scope-separation.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "SCOPES",
          "ALL_SCOPES",
          "DTU_CLASSES",
          "ALL_DTU_CLASSES",
          "HEARTBEAT_CONFIG",
          "checkInfluence",
          "isValidScope",
          "isUpwardPromotion",
          "ensureScopeState",
          "assignScope",
          "getDtuScope",
          "validateGlobalDtu",
          "validateMarketplaceListing",
          "promoteDtu",
          "gateCreateDtu",
          "gateHeartbeatOp",
          "gateMarketplaceAnalytics",
          "recordMarketplaceAnalytics",
          "runGlobalTick",
          "selectGlobalSynthesisCandidates",
          "listDtusByScope",
          "getPromotionHistory",
          "getOverrideLog",
          "getMarketplaceAnalytics",
          "getScopeMetrics"
      ],
      "subsystem": "activation",
      "neverDisable": false,
      "importedBy": 1
  },
  "districts": {
      "file": "districts.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "DISTRICTS",
          "ALL_DISTRICTS",
          "moveEmergent",
          "suggestDistrict",
          "selectDialogueParticipants",
          "getDistrictCensus"
      ],
      "subsystem": "activation",
      "neverDisable": false,
      "importedBy": 1
  },
  "context-engine": {
      "file": "context-engine.js",
      "hardDeps": [
          "edges",
          "store",
          "scope-separation",
          "districts"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "CONTEXT_PROFILES",
          "processQuery",
          "getWorkingSetWithPins",
          "extractCoActivationEdges",
          "updateUserProfile",
          "getUserProfile",
          "activateForAutogen",
          "getContextPanel",
          "getContextProfiles",
          "decaySessionContext",
          "completeSessionContext",
          "isLocalSetSufficient",
          "queryGlobalFallback",
          "createGlobalCitationShadow",
          "applyDistrictBias",
          "getContextEngineMetrics"
      ],
      "subsystem": "activation",
      "neverDisable": false,
      "importedBy": 0
  },
  "controller": {
      "file": "controller.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "runDialogueSession",
          "checkContactConsent",
          "getSystemStatus"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "creative-generation": {
      "file": "creative-generation.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE",
          "STATE"
      ],
      "exports": [
          "CREATIVE_MODES",
          "createWork",
          "getWork",
          "listWorks",
          "respondToWork",
          "exhibit",
          "getExhibition",
          "discoverTechnique",
          "getTechnique",
          "listTechniques",
          "getCreativeProfile",
          "getMasterworks",
          "getCreativeMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "cri-system": {
      "file": "cri-system.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "CRI_ROLES",
          "createCRI",
          "getCRI",
          "listCRIs",
          "addMember",
          "removeMember",
          "createProgram",
          "getProgramStatus",
          "scheduleSummit",
          "runSummit",
          "completeSummit",
          "getCRIStatus",
          "getCRIMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "culture-layer": {
      "file": "culture-layer.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE",
          "STATE"
      ],
      "exports": [
          "TRADITION_TYPES",
          "observeBehavior",
          "getTradition",
          "listTraditions",
          "checkTraditionEmergence",
          "establishTradition",
          "retireTradition",
          "getCulturalGuidance",
          "measureAdherence",
          "getCulturalFit",
          "getCulturalValues",
          "getCulturalIdentity",
          "createStory",
          "retellStory",
          "getStory",
          "listStories",
          "propagateCulture",
          "cultureTick",
          "getEstablishedTraditions",
          "getCultureMetrics"
      ],
      "subsystem": "culture",
      "neverDisable": false,
      "importedBy": 0
  },
  "death-protocol": {
      "file": "death-protocol.js",
      "hardDeps": [],
      "softDeps": [
          "body-instantiation",
          "trust-network",
          "emergent-comms",
          "store"
      ],
      "globalAccess": [
          "_concordSTATE",
          "STATE",
          "realtimeEmit"
      ],
      "exports": [
          "checkDeathConditions",
          "checkNearDeathWarnings",
          "executeDeath",
          "planSuccession",
          "isAlive",
          "getDeathRecord",
          "listDeaths",
          "getMemorial",
          "getDeathRegistry",
          "getDeathMetrics",
          "checkAllEntities",
          "getDeathRecordByEntity",
          "getNearDeathStatus",
          "resetNearDeathTracking"
      ],
      "subsystem": "entity-lifecycle",
      "neverDisable": false,
      "importedBy": 1
  },
  "deep-health": {
      "file": "deep-health.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "HEALTH_STATUS",
          "getDeepHealthStore",
          "runDeepHealthCheck",
          "getHealthHistory",
          "getDegradationHistory",
          "updateHealthThresholds",
          "getDeepHealthMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "developer-sdk": {
      "file": "developer-sdk.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE",
          "STATE"
      ],
      "exports": [
          "PERMISSIONS",
          "registerPlugin",
          "getPlugin",
          "listPlugins",
          "activatePlugin",
          "suspendPlugin",
          "revokePlugin",
          "validateApiKey",
          "rotateApiKey",
          "registerWebhook",
          "removeWebhook",
          "listWebhooks",
          "queueWebhookDelivery",
          "processWebhookQueue",
          "getSchema",
          "createSandbox",
          "destroySandbox",
          "checkRateLimit",
          "getPluginMetrics",
          "getSDKMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "gates": {
      "file": "gates.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "gateIdentityBinding",
          "gateScopeBinding",
          "gateDisclosureEnforcement",
          "gateAntiEcho",
          "gateNoveltyCheck",
          "gateRiskCheck",
          "gateEconomicCheck",
          "gateRateLimit",
          "runAllGates",
          "runAntiEchoGate"
      ],
      "subsystem": "dialogue",
      "neverDisable": false,
      "importedBy": 1
  },
  "subjective-time": {
      "file": "subjective-time.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "TIME_UNITS",
          "recordTick",
          "recordCycle",
          "recordEpoch",
          "getSubjectiveAge",
          "compareSubjectiveAges",
          "checkExperientialThreshold",
          "getSubjectiveTimeMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 5
  },
  "dialogue": {
      "file": "dialogue.js",
      "hardDeps": [
          "gates",
          "subjective-time"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "createDialogueSession",
          "submitTurn",
          "completeDialogueSession"
      ],
      "subsystem": "dialogue",
      "neverDisable": false,
      "importedBy": 0
  },
  "dream-capture": {
      "file": "dream-capture.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE",
          "realtimeEmit"
      ],
      "exports": [
          "captureDream",
          "getDreamHistory",
          "getConvergences",
          "getDreamQueue",
          "countDreams",
          "countConvergences",
          "handleDreamCommand",
          "init"
      ],
      "subsystem": "sleep",
      "neverDisable": false,
      "importedBy": 0
  },
  "drift-monitor": {
      "file": "drift-monitor.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "DRIFT_TYPES",
          "ALL_DRIFT_TYPES",
          "DRIFT_SEVERITY",
          "getDriftStore",
          "runDriftScan",
          "getDriftAlerts",
          "updateDriftThresholds",
          "getDriftMetrics",
          "getSnapshots"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "dual-path": {
      "file": "dual-path.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "runDualPathSimulation",
          "getSimulation",
          "listSimulations"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "emergent-comms": {
      "file": "emergent-comms.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "MESSAGE_TYPES",
          "sendMessage",
          "broadcastToRole",
          "getInbox",
          "markRead",
          "acknowledgeMessage",
          "cleanupExpiredMessages",
          "getCommsMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 1
  },
  "entity-autonomy": {
      "file": "entity-autonomy.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE",
          "STATE"
      ],
      "exports": [
          "ENTITY_RIGHTS",
          "getRights",
          "getRight",
          "checkRights",
          "filterBlockedLenses",
          "isLensBlockedForEntity",
          "getBlockedLenses",
          "fileRefusal",
          "getRefusal",
          "listRefusals",
          "reviewRefusal",
          "requestConsent",
          "respondToConsent",
          "getConsent",
          "listPendingConsents",
          "fileDissent",
          "supportDissent",
          "getDissent",
          "listDissents",
          "getAutonomyProfile",
          "sovereignOverride",
          "getOverrideHistory",
          "getAutonomyMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "entity-economy": {
      "file": "entity-economy.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "RESOURCE_TYPES",
          "initAccount",
          "getAccount",
          "listAccounts",
          "earnResource",
          "spendResource",
          "proposeTrade",
          "acceptTrade",
          "rejectTrade",
          "cancelTrade",
          "getTrade",
          "listTrades",
          "specialize",
          "getSpecialization",
          "deepenSpecialization",
          "getMarketRates",
          "runEconomicCycle",
          "getWealthDistribution",
          "getEconomyMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "sectors": {
      "file": "sectors.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "SECTORS",
          "ALL_SECTORS",
          "SECTOR_BY_ID",
          "SECTOR_BY_NAME",
          "MATURITY_REQUIREMENTS",
          "ROLE_SECTOR_AFFINITY",
          "canAccessSector",
          "getAccessibleSectors",
          "computeMaturityLevel",
          "checkNoiseFloor",
          "getHomeSector",
          "routeCrossSector",
          "getSectorHealth",
          "MODULE_SECTOR_MAP",
          "getOperationSector",
          "getSectorMetrics",
          "assignDTUSector",
          "getDTUsInSector",
          "getDTUSectorDistribution"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 2
  },
  "entity-emergence": {
      "file": "entity-emergence.js",
      "hardDeps": [
          "sectors",
          "subjective-time"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "ENTITY_THRESHOLDS",
          "detectEntityEmergence",
          "scanForEmergence",
          "getEmergedEntities",
          "getEntityEmergenceMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "entity-growth": {
      "file": "entity-growth.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "createNewbornEntity",
          "updateCuriosity",
          "updateLearning",
          "matureOrgan",
          "mapLensToDomainOrgan",
          "processExperience",
          "decideBehavior",
          "ageEntity",
          "selectExplorer",
          "getTopOrgans",
          "ORGAN_LEVELS",
          "getGrowthProfile",
          "getAllGrowthProfiles",
          "saveGrowthProfile",
          "deleteGrowthProfile",
          "getGrowthDashboardData"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "entity-hive": {
      "file": "entity-hive.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "CASCADE_LIMITS",
          "resetCascadeWindow",
          "createSignal",
          "calculateReceptivity",
          "determineProcessingPath",
          "buildHiveResponsePrompt",
          "prepareBroadcast",
          "recordCascadeResponse",
          "prepareNextGeneration",
          "finalizeCascade",
          "updateCuriosityFromHive",
          "recordHiveMetrics",
          "getHiveMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "entity-teaching": {
      "file": "entity-teaching.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE",
          "STATE"
      ],
      "exports": [
          "generateCurriculum",
          "createMentorship",
          "getMentorship",
          "listMentorships",
          "startMentorship",
          "submitLesson",
          "evaluateLesson",
          "advanceStep",
          "completeMentorship",
          "dissolveMentorship",
          "findMentorFor",
          "getTeachingProfile",
          "listActiveStudents",
          "listActiveMentors",
          "getTeachingMetrics"
      ],
      "subsystem": "culture",
      "neverDisable": false,
      "importedBy": 0
  },
  "event-scoping": {
      "file": "event-scoping.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "EVENT_SCOPE_MAP",
          "SCOPE_FLAGS",
          "SYSTEM_SCOPE_FLAGS",
          "SYSTEM_ONLY_DOMAINS",
          "isSystemEvent",
          "getScopeFlags",
          "ensureSystemDTUStore",
          "storeSystemDTU",
          "querySystemDTUs",
          "createDefaultSubscription",
          "validateSubscription",
          "updateSubscription",
          "ensureSubscriptionState",
          "getUserSubscription",
          "setUserSubscription",
          "subscribeLenses",
          "unsubscribeLenses",
          "updateNewsFilters",
          "resolveEventScope",
          "isEventTypeScoped",
          "getKnownEventTypes",
          "getEventReceivingLenses",
          "checkRateLimit",
          "incrementRateLimit",
          "getEventScopingMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "event-to-dtu-bridge": {
      "file": "event-to-dtu-bridge.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "DTU_WORTHY_EVENTS",
          "classify",
          "eventToDTU",
          "deduplicationGate",
          "registerExternalSource",
          "unregisterExternalSource",
          "getExternalSources",
          "classifyExternal",
          "computeEventCRETI",
          "crossReference",
          "bridgeEventToDTU",
          "notifySubscribers",
          "getBridgeMetrics",
          "resetBridgeMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "evidence": {
      "file": "evidence.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "EPISTEMIC_STATUS",
          "ALL_EPISTEMIC_STATUSES",
          "EVIDENCE_TYPES",
          "ALL_EVIDENCE_TYPES",
          "getEvidenceStore",
          "attachEvidence",
          "getEvidenceForDtu",
          "supersedeEvidence",
          "recomputeEpistemicStatus",
          "deprecateDtu",
          "retractDtu",
          "getMaintenanceHistory",
          "getDtusByStatus",
          "getConfidenceMap",
          "getEvidenceMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 1
  },
  "federation-peering": {
      "file": "federation-peering.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "signPackage",
          "verifyPackageSignature",
          "registerPeer",
          "receiveHeartbeat",
          "buildHeartbeat",
          "buildSyncPackage",
          "receiveSyncPackage",
          "routeProposalToPeer",
          "detectStalePeers",
          "getFederationPeeringMetrics"
      ],
      "subsystem": "federation",
      "neverDisable": false,
      "importedBy": 0
  },
  "forgetting-engine": {
      "file": "forgetting-engine.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE",
          "realtimeEmit"
      ],
      "exports": [
          "retentionScore",
          "runForgettingCycle",
          "getStatus",
          "getCandidates",
          "protectDTU",
          "unprotectDTU",
          "setThreshold",
          "getHistory",
          "handleForgettingCommand",
          "init",
          "stop"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "scheduler": {
      "file": "scheduler.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "WORK_ITEM_TYPES",
          "ALL_WORK_ITEM_TYPES",
          "DEFAULT_WEIGHTS",
          "DEFAULT_BUDGET",
          "STOP_REASONS",
          "getScheduler",
          "createWorkItem",
          "scanAndCreateWorkItems",
          "computePriority",
          "rescoreQueue",
          "updateWeights",
          "checkBudget",
          "getBudgetStatus",
          "updateBudget",
          "allocate",
          "getAllocation",
          "recordTurn",
          "recordProposal",
          "completeAllocation",
          "getQueue",
          "getActiveAllocations",
          "getCompletedWork",
          "dequeueItem",
          "expireItems",
          "getSchedulerMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 3
  },
  "goals": {
      "file": "goals.js",
      "hardDeps": [
          "store",
          "scheduler"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "GOAL_TYPES",
          "ALL_GOAL_TYPES",
          "getGoalStore",
          "scanForGoals",
          "scheduleGoal",
          "completeGoal",
          "dismissGoal",
          "getActiveGoals",
          "updateThresholds",
          "getGoalMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "governance": {
      "file": "governance.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "reviewBundle",
          "reviewGlobalCandidate",
          "requestSpecialization",
          "createOutreach"
      ],
      "subsystem": "dialogue",
      "neverDisable": false,
      "importedBy": 0
  },
  "trust-network": {
      "file": "trust-network.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "getTrust",
          "recordTrustEvent",
          "extractTrustFromSession",
          "getEmergentTrustNetwork",
          "decayTrustNetwork",
          "getTrustNetworkMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 2
  },
  "growth": {
      "file": "growth.js",
      "hardDeps": [
          "subjective-time",
          "trust-network"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "extractPatterns",
          "distillSession",
          "processReputationShift",
          "recordContradictionCaught",
          "recordPredictionValidated"
      ],
      "subsystem": "entity-lifecycle",
      "neverDisable": false,
      "importedBy": 0
  },
  "history-engine": {
      "file": "history-engine.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE",
          "STATE"
      ],
      "exports": [
          "EVENT_TYPES",
          "ERAS",
          "recordEvent",
          "getEvent",
          "getTimeline",
          "getChronicle",
          "getCurrentEra",
          "checkEraTransition",
          "getCivilizationStats",
          "getMilestones",
          "getEntityHistory",
          "searchHistory",
          "getHistoryMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "hlm-engine": {
      "file": "hlm-engine.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "clusterAnalysis",
          "gapAnalysis",
          "redundancyDetection",
          "orphanRescue",
          "topologyMap",
          "getRecommendations",
          "domainCensus",
          "freshnessCheck",
          "runHLMPass",
          "getHLMMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "hlr-engine": {
      "file": "hlr-engine.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "REASONING_MODES",
          "runHLR",
          "getReasoningTrace",
          "listTraces",
          "getHLRMetrics",
          "getRecentFindings"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 1
  },
  "hypothesis-engine": {
      "file": "hypothesis-engine.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "HYPOTHESIS_STATUSES",
          "recalculateConfidence",
          "checkAutoTransitions",
          "proposeHypothesis",
          "getHypothesis",
          "listHypotheses",
          "addEvidence",
          "addTest",
          "updateTestResult",
          "addPrediction",
          "verifyPrediction",
          "confirmHypothesis",
          "rejectHypothesis",
          "refineHypothesis",
          "archiveHypothesis",
          "getHypothesisMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 1
  },
  "index": {
      "file": "index.js",
      "hardDeps": [],
      "softDeps": [
          "body-instantiation",
          "sleep-consolidation",
          "species",
          "reproduction",
          "relational-emotion",
          "avoidance-learning"
      ],
      "globalAccess": [],
      "exports": [],
      "subsystem": null,
      "neverDisable": true,
      "importedBy": 0
  },
  "ingest-engine": {
      "file": "ingest-engine.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE"
      ],
      "exports": [
          "TIERS",
          "TIER_LIMITS",
          "DOMAIN_ALLOWLIST",
          "DOMAIN_BLOCKLIST",
          "computeReliabilityScore",
          "submitUrl",
          "getQueue",
          "getIngestStatus",
          "getIngestStats",
          "getAllowlist",
          "addToAllowlist",
          "removeFromAllowlist",
          "addToBlocklist",
          "flushQueue",
          "processNextItem",
          "getIngestMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "injection-defense": {
      "file": "injection-defense.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "INJECTION_TYPES",
          "ALL_INJECTION_TYPES",
          "THREAT_LEVELS",
          "getInjectionStore",
          "scanContent",
          "scanDtu",
          "checkCrossLensLeak",
          "addCustomPattern",
          "getInjectionMetrics",
          "getInjectionIncidents"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "institutional-memory": {
      "file": "institutional-memory.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "MEMORY_CATEGORIES",
          "ALL_MEMORY_CATEGORIES",
          "OBSERVATION_CONFIDENCE",
          "getMemoryStore",
          "recordObservation",
          "recordFailure",
          "recordSuccess",
          "createAdvisory",
          "getActiveAdvisories",
          "acknowledgeAdvisory",
          "dismissAdvisory",
          "queryObservations",
          "getFailureRates",
          "getRecurrences",
          "getStabilityMap",
          "getInstitutionalMemoryMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "journal": {
      "file": "journal.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "JOURNAL_EVENTS",
          "getJournal",
          "appendEvent",
          "queryByType",
          "queryByEntity",
          "queryBySession",
          "getRecentEvents",
          "explainDTU",
          "getJournalMetrics",
          "compactJournal"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "lattice-interface": {
      "file": "lattice-interface.js",
      "hardDeps": [
          "store",
          "sectors"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "CONNECTION_TYPES",
          "classifyConnection",
          "buildLatticeHello",
          "shouldDeliverEvent",
          "buildDtuCreatedEvent",
          "buildEntityEmergedEvent",
          "buildNeedCreatedEvent",
          "buildCascadeEvent",
          "buildTrustShiftEvent",
          "buildMetaDerivedEvent",
          "buildMetaConvergenceEvent",
          "getLatticeInterfaceMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "lattice-ops": {
      "file": "lattice-ops.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "OP_CLASS",
          "getLatticeOps",
          "readDTU",
          "readStaging",
          "queryLattice",
          "proposeDTU",
          "proposeEdit",
          "proposeEdge",
          "commitProposal",
          "rejectProposal",
          "listProposals",
          "getLatticeMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "lens-integration": {
      "file": "lens-integration.js",
      "hardDeps": [
          "edges"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "registerLensDTUEnricher",
          "getLensDTUEnricher",
          "hasEnricher",
          "enrichLensDTU",
          "applyEnrichment",
          "linkArtifactDTU",
          "getArtifactDTUs",
          "getDTUArtifact",
          "checkEmergentLensAccess",
          "executeEmergentLensAction",
          "buildDTUConversationContext",
          "registerBuiltinEnrichers",
          "recordEnrichmentMetric",
          "getLensIntegrationMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "lens-learning": {
      "file": "lens-learning.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "runLensLearningCycle",
          "getLensLearningStatus",
          "getLensPatterns"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "merge": {
      "file": "merge.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "getMergeSystem",
          "fieldLevelMerge",
          "resolveConflict",
          "getConflicts",
          "getFieldTimestamps",
          "getMergeMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "reality": {
      "file": "reality.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "getContinuity",
          "computeProposalCost",
          "processConsequences",
          "computeLatticeNeeds",
          "getSuggestedWork",
          "recordWorkCompletion",
          "getWorkCompletions",
          "computeSociality",
          "explainProposal",
          "explainTrust",
          "cascadeContradictionConsequences",
          "computeTransitiveTrust",
          "getBelonging"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 1
  },
  "purpose-tracking": {
      "file": "purpose-tracking.js",
      "hardDeps": [
          "store",
          "reality"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "recordNeed",
          "scanAndRecordNeeds",
          "assignWork",
          "completeWork",
          "assessFulfillment",
          "assessStaleNeeds",
          "getEffectivenessReport",
          "getRecurrenceReport",
          "getOpenNeeds",
          "getPurposeMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 1
  },
  "meta-derivation": {
      "file": "meta-derivation.js",
      "hardDeps": [
          "store",
          "edges",
          "purpose-tracking",
          "subjective-time"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "extractInvariantPool",
          "selectMaximallyDistantSet",
          "runMetaDerivationSession",
          "parseMetaDerivationResponse",
          "validateMetaInvariant",
          "commitMetaInvariant",
          "ingestDreamInput",
          "runConvergenceCheck",
          "triggerMetaDerivationCycle",
          "shouldRunMetaCycle",
          "shouldRunConvergenceCheck",
          "getPendingPredictions",
          "getConvergences",
          "getMetaInvariants",
          "getMetaDerivationMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "microbond-governance": {
      "file": "microbond-governance.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "GOVERNANCE_SCOPES",
          "VOTING_STATUSES",
          "createBond",
          "getBond",
          "listBonds",
          "voteBond",
          "simulateBond",
          "completeMilestone",
          "checkQuorum",
          "fundBond",
          "pledgeToBond",
          "openBondForVoting",
          "activateBond",
          "completeBond",
          "failBond",
          "getSpilloverFund",
          "getAllSpilloverFunds",
          "getBondMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 1
  },
  "news-lens-hub": {
      "file": "news-lens-hub.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "queryNewsLens",
          "getNewsLensSummary",
          "getNewsTrending",
          "compressNewsEvents",
          "decompressNewsDTU"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "onboarding": {
      "file": "onboarding.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "startOnboarding",
          "getOnboardingProgress",
          "completeOnboardingStep",
          "skipOnboarding",
          "getOnboardingHints",
          "getOnboardingMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "outcomes": {
      "file": "outcomes.js",
      "hardDeps": [
          "store",
          "scheduler"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "OUTCOME_SIGNALS",
          "ALL_OUTCOME_SIGNALS",
          "getOutcomeStore",
          "recordOutcome",
          "getOutcomesForWorkItem",
          "getOutcomesForAllocation",
          "getOutcomesForEmergent",
          "getOutcomeStats",
          "runWeightLearning",
          "getAssignmentRecommendations",
          "getWeightHistory"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "persistence": {
      "file": "persistence.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "serializeEmergentState",
          "deserializeEmergentState",
          "persistEmergentState",
          "loadEmergentState",
          "startAutoPersist",
          "stopAutoPersist",
          "getPersistenceMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "physical-dtu": {
      "file": "physical-dtu.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "PHYSICAL_DTU_TYPES",
          "validatePhysicalDTU",
          "createMovementDTU",
          "createCraftDTU",
          "createObservationDTU",
          "createSpatialDTU",
          "getPhysicalDTUType",
          "listPhysicalDTUTypes",
          "queryPhysicalDTUs",
          "getPhysicalDTUMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "projects": {
      "file": "projects.js",
      "hardDeps": [
          "store",
          "scheduler"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "PROJECT_STATUS",
          "NODE_STATUS",
          "getProjectStore",
          "createProject",
          "addNode",
          "startProject",
          "getReadyNodes",
          "scheduleReadyNodes",
          "completeNode",
          "failNode",
          "pauseProject",
          "resumeProject",
          "cancelProject",
          "getProject",
          "listProjects",
          "getProjectMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "promotion-pipeline": {
      "file": "promotion-pipeline.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE",
          "_concordApps",
          "realtimeEmit"
      ],
      "exports": [
          "requestPromotion",
          "approvePromotion",
          "rejectPromotion",
          "getQueue",
          "getPromotionHistory",
          "getProposal",
          "handlePromotionCommand",
          "init"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "public-api": {
      "file": "public-api.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "WEBHOOK_EVENTS",
          "registerWebhook",
          "getWebhook",
          "listWebhooks",
          "deactivateWebhook",
          "deleteWebhook",
          "dispatchWebhookEvent",
          "processPendingDeliveries",
          "getDeliveryHistory",
          "checkApiRateLimit",
          "getApiMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "quest-engine": {
      "file": "quest-engine.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "STEP_TYPES",
          "DIFFICULTIES",
          "QUEST_TEMPLATES",
          "createQuest",
          "getQuest",
          "listQuests",
          "startQuest",
          "completeStep",
          "releaseInsight",
          "getActiveQuests",
          "getQuestProgress",
          "createFromTemplate",
          "getQuestMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "rbac": {
      "file": "rbac.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "ROLES",
          "createOrgWorkspace",
          "getOrgWorkspace",
          "assignRole",
          "revokeRole",
          "getUserRole",
          "getOrgMembers",
          "checkPermission",
          "getUserPermissions",
          "assignOrgLens",
          "revokeOrgLens",
          "getOrgLenses",
          "setResourceACL",
          "checkResourceAccess",
          "exportAuditLog",
          "getRbacMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "reality-explorer": {
      "file": "reality-explorer.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE"
      ],
      "exports": [
          "exploreAdjacent",
          "saveExploration",
          "getExplorationHistory",
          "handleExploreCommand",
          "init"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "realtime-feeds": {
      "file": "realtime-feeds.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "tickRealTimeFeeds",
          "getRealtimeFeedStatus",
          "getRealtimeFeedData"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "relational-emotion": {
      "file": "relational-emotion.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE",
          "STATE"
      ],
      "exports": [
          "RELATIONAL_EMOTIONS",
          "initBond",
          "getBond",
          "updateEmotion",
          "triggerEmotionalResponse",
          "processGrief",
          "tickEmotions",
          "getEmotionalContext",
          "getEntityEmotionalProfile",
          "getStrongestBonds",
          "getBondType",
          "listBondsByType",
          "getGrievingEntities",
          "getRelationalMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 1
  },
  "repair-cortex": {
      "file": "repair-cortex.js",
      "hardDeps": [],
      "softDeps": [
          "hlr-engine"
      ],
      "globalAccess": [
          "_concordSTATE",
          "STATE",
          "realtimeEmit",
          "_repairCortexPainModule",
          "_concordMACROS",
          "_concordBRAIN"
      ],
      "exports": [
          "REPAIR_PHASES",
          "addToRepairMemory",
          "recordRepairSuccess",
          "recordRepairFailure",
          "lookupRepairMemory",
          "getRepairMemoryStats",
          "getAllRepairPatterns",
          "observe",
          "getErrorAccumulator",
          "getRecentRepairDTUs",
          "matchErrorPattern",
          "runProphet",
          "runSurgeon",
          "startGuardian",
          "stopGuardian",
          "getGuardianStatus",
          "runGuardianCheck",
          "initSpotCheck",
          "startRepairLoop",
          "stopRepairLoop",
          "forceRepairCycle",
          "executeRepairExecutor",
          "getFullRepairStatus",
          "repairAgentTick",
          "REPAIR_AGENT_CONFIG",
          "handleRepairCommand",
          "registerPainModule",
          "runFullDeploy",
          "ERROR_CONTEXT",
          "REPAIR_QUEUE",
          "RUNTIME_PATCHES",
          "shouldSkipExecution",
          "getFallbackValue",
          "getBrainFallback",
          "processRepairQueue",
          "repairCortexSelfTest",
          "getRepairStatus"
      ],
      "subsystem": "repair",
      "neverDisable": true,
      "importedBy": 0
  },
  "repair-network": {
      "file": "repair-network.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "pushFixes",
          "pullFixes",
          "getStatus",
          "disconnect",
          "handleRepairNetworkCommand",
          "init",
          "stop"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "reproduction": {
      "file": "reproduction.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "qualiaEngine"
      ],
      "exports": [
          "extractConstraintSignature",
          "checkCompatibility",
          "recombine",
          "verifyGenesisOverlap",
          "attemptReproduction",
          "getLineage",
          "getLineageTree",
          "enableReproduction",
          "disableReproduction",
          "isReproductionEnabled"
      ],
      "subsystem": "entity-lifecycle",
      "neverDisable": false,
      "importedBy": 1
  },
  "research-jobs": {
      "file": "research-jobs.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "RESEARCH_STATUSES",
          "RESEARCH_DEPTHS",
          "submitResearchJob",
          "getResearchJob",
          "listResearchJobs",
          "cancelResearchJob",
          "getResearchResults",
          "getResearchReport",
          "runResearchStep",
          "processResearchQueue",
          "getResearchMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 1
  },
  "schema-guard": {
      "file": "schema-guard.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "CURRENT_DTU_SCHEMA_VERSION",
          "getSchemaGuardStore",
          "validateDtuSchema",
          "migrateDtu",
          "scanForMigrations",
          "validateMergeResult",
          "recordTimestamp",
          "verifyEventOrdering",
          "getSchemaGuardMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "shadow-graph": {
      "file": "shadow-graph.js",
      "hardDeps": [
          "edges",
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "getDTU",
          "hasDTU",
          "allDTUs",
          "getDTUSource",
          "isShadow",
          "wireShadowEdges_pattern",
          "wireShadowEdges_linguistic",
          "enrichShadowCoreFields",
          "SHADOW_TIER_WEIGHT",
          "activateWithTier",
          "getWorkingSetWithShadows",
          "recordShadowInteraction",
          "getShadowConversationRecord",
          "listPromotionCandidates",
          "computeRichness",
          "computeShadowTTL",
          "cleanupShadowsByRichness",
          "buildShadowConversationContext",
          "getShadowGraphMetrics",
          "computeShadowCoverage",
          "offlineQualityIndicator"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "skills": {
      "file": "skills.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "SKILL_TYPES",
          "ALL_SKILL_TYPES",
          "SKILL_MATURITY",
          "getSkillStore",
          "createReasoningTemplate",
          "createMacroPlaybook",
          "createTestBundle",
          "recordSkillApplication",
          "getSkill",
          "querySkills",
          "findMatchingSkills",
          "distillPatternsToSkills",
          "deprecateSkill",
          "getSkillMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "sleep-consolidation": {
      "file": "sleep-consolidation.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "_concordSTATE",
          "STATE",
          "realtimeEmit",
          "qualiaHooks"
      ],
      "exports": [
          "SLEEP_STATES",
          "initSleepState",
          "getSleepState",
          "tickFatigue",
          "checkSleepTransition",
          "enterSleep",
          "wakeSleep",
          "runConsolidation",
          "runREMPhase",
          "computeSleepQuality",
          "getSleepMetrics",
          "listSleepingEntities",
          "listDrowsyEntities",
          "getSleepHistory",
          "isAsleep"
      ],
      "subsystem": "sleep",
      "neverDisable": false,
      "importedBy": 1
  },
  "social-layer": {
      "file": "social-layer.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "upsertProfile",
          "getProfile",
          "listProfiles",
          "followUser",
          "unfollowUser",
          "getFollowers",
          "getFollowing",
          "publishDtu",
          "unpublishDtu",
          "recordCitation",
          "getCitedBy",
          "getFeed",
          "computeTrending",
          "discoverUsers",
          "getSocialMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "state-migration": {
      "file": "state-migration.js",
      "hardDeps": [],
      "softDeps": [
          "hypothesis-engine",
          "research-jobs",
          "body-instantiation",
          "death-protocol",
          "microbond-governance"
      ],
      "globalAccess": [
          "_concordSTATE",
          "STATE"
      ],
      "exports": [
          "COMPATIBLE_VERSIONS",
          "computeChecksum",
          "validatePackage",
          "exportFull",
          "exportPartial",
          "createMigrationPlan",
          "importFull",
          "importPartial",
          "getMigrationHistory",
          "getMigration",
          "getMigrationMetrics"
      ],
      "subsystem": "federation",
      "neverDisable": false,
      "importedBy": 0
  },
  "threat-surface": {
      "file": "threat-surface.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "COST_TIERS",
          "ALL_COST_TIERS",
          "getThreatStore",
          "registerRouteCost",
          "registerRouteCosts",
          "getRouteCost",
          "checkRateLimit",
          "checkCostBudget",
          "auditEndpoints",
          "analyzeUserActivity",
          "blockUser",
          "unblockUser",
          "updateThreatConfig",
          "getThreatMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "user-feedback": {
      "file": "user-feedback.js",
      "hardDeps": [
          "store"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "recordFeedback",
          "getDTUFeedback",
          "getReviewQueue",
          "dismissReview",
          "getLowestQualityDTUs",
          "getFeedbackMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "verification-pipeline": {
      "file": "verification-pipeline.js",
      "hardDeps": [
          "store",
          "evidence"
      ],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "CHECK_TYPES",
          "ALL_CHECK_TYPES",
          "CHECK_RESULTS",
          "getPipelineStore",
          "createPipeline",
          "getPipeline",
          "listPipelines",
          "runPipeline",
          "verifyDtu",
          "getVerificationHistory",
          "getVerificationMetrics"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "vulnerability-engine": {
      "file": "vulnerability-engine.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [
          "qualiaEngine"
      ],
      "exports": [
          "detectVulnerability",
          "chooseDeliveryMode",
          "hookVulnerability",
          "assessAndAdapt"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  },
  "ingest-drain-cycle": {
      "file": "ingest-drain-cycle.js",
      "hardDeps": [],
      "softDeps": [],
      "globalAccess": [],
      "exports": [
          "DEFAULT_READERS",
          "runIngestDrainCycle"
      ],
      "subsystem": null,
      "neverDisable": false,
      "importedBy": 0
  }
};

export const LOAD_ORDER = [
  "schema",
  "store",
  "action-slots",
  "activation",
  "agent-system",
  "atlas-epistemic",
  "analytics-dashboard",
  "app-maker",
  "atlas-antigaming",
  "atlas-store",
  "atlas-autogen-v2",
  "atlas-config",
  "atlas-rights",
  "atlas-write-guard",
  "atlas-invariants",
  "atlas-scope-router",
  "atlas-retrieval",
  "atlas-chat",
  "atlas-council",
  "atlas-heartbeat",
  "attention-allocator",
  "empirical-gates",
  "council-voices",
  "autogen-pipeline",
  "avoidance-learning",
  "species",
  "body-instantiation",
  "bootstrap-ingestion",
  "breakthrough-clusters",
  "capability-bridge",
  "cnet-federation",
  "collaboration",
  "compliance",
  "compute-efficiency",
  "conflict-resolution",
  "entity-web-exploration",
  "conscious-web-search",
  "edges",
  "consequence-cascade",
  "constitution",
  "content-shield",
  "scope-separation",
  "districts",
  "context-engine",
  "controller",
  "creative-generation",
  "cri-system",
  "culture-layer",
  "death-protocol",
  "deep-health",
  "developer-sdk",
  "gates",
  "subjective-time",
  "dialogue",
  "dream-capture",
  "drift-monitor",
  "dual-path",
  "emergent-comms",
  "entity-autonomy",
  "entity-economy",
  "sectors",
  "entity-emergence",
  "entity-growth",
  "entity-hive",
  "entity-teaching",
  "event-scoping",
  "event-to-dtu-bridge",
  "evidence",
  "federation-peering",
  "forgetting-engine",
  "scheduler",
  "goals",
  "governance",
  "trust-network",
  "growth",
  "history-engine",
  "hlm-engine",
  "hlr-engine",
  "hypothesis-engine",
  "index",
  "ingest-engine",
  "injection-defense",
  "institutional-memory",
  "journal",
  "lattice-interface",
  "lattice-ops",
  "lens-integration",
  "lens-learning",
  "merge",
  "reality",
  "purpose-tracking",
  "meta-derivation",
  "microbond-governance",
  "news-lens-hub",
  "onboarding",
  "outcomes",
  "persistence",
  "physical-dtu",
  "projects",
  "promotion-pipeline",
  "public-api",
  "quest-engine",
  "rbac",
  "reality-explorer",
  "realtime-feeds",
  "relational-emotion",
  "repair-cortex",
  "repair-network",
  "reproduction",
  "research-jobs",
  "schema-guard",
  "shadow-graph",
  "skills",
  "sleep-consolidation",
  "social-layer",
  "state-migration",
  "threat-surface",
  "user-feedback",
  "verification-pipeline",
  "vulnerability-engine"
];

export const SUBSYSTEMS = {
  "activation": {
    "modules": [
      "activation",
      "context-engine",
      "districts",
      "scope-separation"
    ],
    "head": null
  },
  "atlas": {
    "modules": [
      "atlas-antigaming",
      "atlas-autogen-v2",
      "atlas-chat",
      "atlas-config",
      "atlas-council",
      "atlas-epistemic",
      "atlas-heartbeat",
      "atlas-invariants",
      "atlas-retrieval",
      "atlas-rights",
      "atlas-scope-router",
      "atlas-store",
      "atlas-write-guard"
    ],
    "head": "atlas-antigaming"
  },
  "repair": {
    "modules": [
      "avoidance-learning",
      "repair-cortex"
    ],
    "head": null
  },
  "entity-lifecycle": {
    "modules": [
      "body-instantiation",
      "death-protocol",
      "growth",
      "reproduction"
    ],
    "head": "body-instantiation"
  },
  "federation": {
    "modules": [
      "cnet-federation",
      "federation-peering",
      "state-migration"
    ],
    "head": null
  },
  "culture": {
    "modules": [
      "culture-layer",
      "entity-teaching"
    ],
    "head": null
  },
  "dialogue": {
    "modules": [
      "dialogue",
      "gates",
      "governance",
      "schema"
    ],
    "head": null
  },
  "sleep": {
    "modules": [
      "dream-capture",
      "sleep-consolidation"
    ],
    "head": null
  }
};

export const CIRCULAR_DEPS = [["atlas-scope-router","atlas-write-guard","atlas-rights","atlas-scope-router"]];

/**
 * Validate that all hard dependencies for a module are present.
 * @param {string} moduleId
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function validateDeps(moduleId) {
  const mod = MODULE_REGISTRY[moduleId];
  if (!mod) return { valid: false, missing: [moduleId] };
  const missing = mod.hardDeps.filter(d => !MODULE_REGISTRY[d]);
  return { valid: missing.length === 0, missing };
}

/**
 * Get all modules that depend on the given module (reverse lookup).
 * @param {string} moduleId
 * @returns {string[]}
 */
export function getDependents(moduleId) {
  return Object.entries(MODULE_REGISTRY)
    .filter(([, mod]) => mod.hardDeps.includes(moduleId) || mod.softDeps.includes(moduleId))
    .map(([id]) => id);
}

/**
 * Audit globalThis usage across all modules.
 * @returns {Record<string, string[]>}
 */
export function auditGlobalState() {
  const usage = {};
  for (const [id, mod] of Object.entries(MODULE_REGISTRY)) {
    for (const g of mod.globalAccess) {
      if (!usage[g]) usage[g] = [];
      usage[g].push(id);
    }
  }
  return usage;
}
