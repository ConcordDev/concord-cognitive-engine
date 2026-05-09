/**
 * Productization Roadmap — Step 3 of the Core Lenses Roadmap.
 *
 * Defines the strict execution order for upgrading lenses to product status.
 * Order is non-negotiable: each lens unlocks the next.
 *
 * Do NOT reorder. The dependency chain is:
 *   Research → Simulation → Governance → Agents → Studio
 *
 * Each phase specifies:
 *   - Must-have artifacts before moving on
 *   - Must-have engines
 *   - Must-have pipelines
 *   - Acceptance criteria (what "done" means)
 *   - Dependencies on prior phases
 */

export type PhaseStatus = 'blocked' | 'ready' | 'in_progress' | 'completed';

export interface ProductionArtifact {
  /** Artifact type name */
  name: string;
  /** Whether this artifact persists independently of DTUs */
  persistsWithoutDTU: boolean;
  /** Storage domain (lens artifact API) */
  storageDomain: string;
  /** Fields the artifact must have at minimum */
  requiredFields: string[];
}

export interface ProductionEngine {
  /** Engine name */
  name: string;
  /** What it does in one sentence */
  description: string;
  /** Whether it runs automatically or on-demand */
  trigger: 'automatic' | 'on_demand' | 'scheduled';
}

export interface ProductionPipeline {
  /** Pipeline name */
  name: string;
  /** Ordered steps */
  steps: string[];
  /** Which engines power each step */
  engines: string[];
}

export interface ProductionPhase {
  /** Phase number (execution order) */
  order: number;
  /** Target lens ID */
  lensId: string;
  /** Display name */
  name: string;
  /** Why this goes first / here */
  rationale: string;
  /** Which phases must complete first */
  dependsOn: number[];
  /** Artifacts that must exist before phase is "done" */
  artifacts: ProductionArtifact[];
  /** Engines that must be running */
  engines: ProductionEngine[];
  /** Pipelines that must be wired */
  pipelines: ProductionPipeline[];
  /** Acceptance criteria — every item must be true to mark complete */
  acceptanceCriteria: string[];
  /** Incumbent(s) this lens is designed to beat */
  incumbents: string[];
  /** Current status */
  status: PhaseStatus;
}

/**
 * The 5-phase productization roadmap.
 * This is the minimum number of moves that yields maximum dominance.
 */
export const PRODUCTIZATION_PHASES: ProductionPhase[] = [
  // ── PHASE 1: Research ─────────────────────────────────────────
  {
    order: 1,
    lensId: 'paper',
    name: 'Research',
    rationale: 'Upgrades every other lens. Gives compounding intelligence. If Research is weak, everything else is cosmetic.',
    dependsOn: [],
    incumbents: ['Notion', 'Obsidian', 'Google Docs', 'Semantic Scholar'],
    artifacts: [
      {
        name: 'ResearchProject',
        persistsWithoutDTU: true,
        storageDomain: 'paper',
        requiredFields: ['id', 'title', 'description', 'status', 'claims', 'hypotheses', 'createdAt', 'updatedAt'],
      },
      {
        name: 'Claim',
        persistsWithoutDTU: true,
        storageDomain: 'paper',
        requiredFields: ['id', 'text', 'confidence', 'evidence', 'status', 'projectId'],
      },
      {
        name: 'Hypothesis',
        persistsWithoutDTU: true,
        storageDomain: 'paper',
        requiredFields: ['id', 'statement', 'status', 'evidence_for', 'evidence_against', 'projectId'],
      },
      {
        name: 'Evidence',
        persistsWithoutDTU: true,
        storageDomain: 'paper',
        requiredFields: ['id', 'type', 'source', 'content', 'confidence', 'claimIds'],
      },
      {
        name: 'Experiment',
        persistsWithoutDTU: true,
        storageDomain: 'paper',
        requiredFields: ['id', 'hypothesisId', 'method', 'status', 'results', 'conclusions'],
      },
      {
        name: 'Synthesis',
        persistsWithoutDTU: true,
        storageDomain: 'paper',
        requiredFields: ['id', 'projectId', 'claims', 'narrative', 'confidence', 'version'],
      },
    ],
    engines: [
      { name: 'claim-evidence-consistency', description: 'Validates that evidence actually supports linked claims', trigger: 'automatic' },
      { name: 'hypothesis-mutation-retest', description: 'Mutates hypotheses when new evidence appears and re-evaluates', trigger: 'automatic' },
      { name: 'contradiction-detection', description: 'Finds claims that conflict with each other across projects', trigger: 'automatic' },
      { name: 'temporal-lineage-tracking', description: 'Tracks how knowledge evolves over time with full provenance', trigger: 'automatic' },
    ],
    pipelines: [
      {
        name: 'ingest-validate-synthesize',
        steps: ['ingest', 'extract-claims', 'validate-evidence', 'detect-contradictions', 'synthesize'],
        engines: ['claim-evidence-consistency', 'contradiction-detection'],
      },
      {
        name: 'hypothesis-lifecycle',
        steps: ['propose', 'design-experiment', 'run', 'evaluate', 'update-hypothesis'],
        engines: ['hypothesis-mutation-retest', 'temporal-lineage-tracking'],
      },
    ],
    acceptanceCriteria: [
      'ResearchProject artifact persists in lens store with full CRUD',
      'Claims are first-class objects linked to Evidence',
      'Hypothesis lifecycle runs without manual intervention',
      'Contradiction detection fires automatically on new evidence ingest',
      'DTU exhaust is generated for every claim/evidence/hypothesis mutation',
      'At least one pipeline is end-to-end functional',
      'All merged modes (hypothesis, reflection, metacognition, etc.) are accessible within Research UI',
    ],
    status: 'ready',
  },

  // ── PHASE 2: Simulation ───────────────────────────────────────
  {
    order: 2,
    lensId: 'sim',
    name: 'Simulation',
    rationale: 'Governance, science, and finance all depend on it. Turns ideas into testable outcomes.',
    dependsOn: [1],
    incumbents: ['Excel', '@Risk', 'MATLAB', 'Wolfram Alpha'],
    artifacts: [
      {
        name: 'Scenario',
        persistsWithoutDTU: true,
        storageDomain: 'sim',
        requiredFields: ['id', 'name', 'description', 'assumptionSetId', 'status', 'createdAt'],
      },
      {
        name: 'AssumptionSet',
        persistsWithoutDTU: true,
        storageDomain: 'sim',
        requiredFields: ['id', 'scenarioId', 'assumptions', 'version', 'locked'],
      },
      {
        name: 'SimulationRun',
        persistsWithoutDTU: true,
        storageDomain: 'sim',
        requiredFields: ['id', 'scenarioId', 'assumptionSetId', 'config', 'status', 'startedAt', 'completedAt'],
      },
      {
        name: 'OutcomeDistribution',
        persistsWithoutDTU: true,
        storageDomain: 'sim',
        requiredFields: ['id', 'runId', 'metric', 'distribution', 'percentiles', 'summary'],
      },
    ],
    engines: [
      { name: 'monte-carlo', description: 'Runs Monte Carlo simulations over assumption sets', trigger: 'on_demand' },
      { name: 'sensitivity-analysis', description: 'Identifies which assumptions most affect outcomes', trigger: 'on_demand' },
      { name: 'regime-detection', description: 'Detects phase transitions and non-linear regime changes', trigger: 'automatic' },
    ],
    pipelines: [
      {
        name: 'scenario-sim-summarize',
        steps: ['define-scenario', 'set-assumptions', 'simulate', 'summarize-outcomes', 'archive'],
        engines: ['monte-carlo', 'sensitivity-analysis'],
      },
      {
        name: 'assumption-retest',
        steps: ['load-assumptions', 'perturb', 're-simulate', 'compare-outcomes'],
        engines: ['monte-carlo', 'regime-detection'],
      },
    ],
    acceptanceCriteria: [
      'Scenario artifact persists with full CRUD',
      'AssumptionSet is versioned and lockable',
      'Monte Carlo engine runs and produces OutcomeDistribution',
      'Sensitivity analysis identifies top-3 influential assumptions',
      'Results from Phase 1 Research feed into Simulation scenarios',
      'DTU exhaust is generated for every simulation run',
      'All merged science engines (math, physics, chem, bio, neuro, quantum) are callable',
    ],
    status: 'blocked',
  },

  // ── PHASE 3: Governance / City ────────────────────────────────
  {
    order: 3,
    lensId: 'council',
    name: 'Governance',
    rationale: 'Real-world proof. Investors and cities understand this immediately. Policy becomes executable.',
    dependsOn: [1, 2],
    incumbents: ['PDFs', 'Spreadsheets', 'Civic portals', 'Decidim'],
    artifacts: [
      {
        name: 'Proposal',
        persistsWithoutDTU: true,
        storageDomain: 'council',
        requiredFields: ['id', 'title', 'body', 'author', 'status', 'budgetImpact', 'simulationId', 'createdAt'],
      },
      {
        name: 'Vote',
        persistsWithoutDTU: true,
        storageDomain: 'council',
        requiredFields: ['id', 'proposalId', 'voterId', 'choice', 'weight', 'rationale', 'timestamp'],
      },
      {
        name: 'BudgetModel',
        persistsWithoutDTU: true,
        storageDomain: 'council',
        requiredFields: ['id', 'projectId', 'lineItems', 'assumptions', 'simulationRunId', 'version'],
      },
      {
        name: 'Project',
        persistsWithoutDTU: true,
        storageDomain: 'council',
        requiredFields: ['id', 'proposalId', 'status', 'milestones', 'budget', 'team', 'auditTrailId'],
      },
      {
        name: 'AuditTrail',
        persistsWithoutDTU: true,
        storageDomain: 'council',
        requiredFields: ['id', 'entityType', 'entityId', 'action', 'actor', 'timestamp', 'details'],
      },
    ],
    engines: [
      { name: 'budget-monte-carlo', description: 'Monte Carlo simulation for budget projections using Phase 2 sim engine', trigger: 'on_demand' },
      { name: 'fraud-feasibility-check', description: 'Flags proposals with unrealistic budgets or impossible timelines', trigger: 'automatic' },
      { name: 'spillover-modeling', description: 'Models second-order effects of policy decisions', trigger: 'on_demand' },
    ],
    pipelines: [
      {
        name: 'proposal-to-execution',
        steps: ['draft-proposal', 'simulate-budget', 'vote', 'execute', 'audit'],
        engines: ['budget-monte-carlo', 'fraud-feasibility-check'],
      },
      {
        name: 'policy-impact',
        steps: ['define-policy', 'model-spillover', 'simulate', 'review', 'decide'],
        engines: ['spillover-modeling', 'budget-monte-carlo'],
      },
    ],
    acceptanceCriteria: [
      'Proposal → Simulate → Vote → Execute → Audit pipeline is end-to-end functional',
      'BudgetModel links to Simulation Phase 2 AssumptionSets',
      'Votes are immutable and auditable',
      'AuditTrail captures every state transition',
      'DTU exhaust provides full transparency for every governance action',
      'All merged modes (vote, ethics, alliance) are accessible within Governance UI',
    ],
    status: 'blocked',
  },

  // ── PHASE 4: Agents + Council ─────────────────────────────────
  {
    order: 4,
    lensId: 'agents',
    name: 'Agents',
    rationale: 'Agents without governance are toys. Governance + agents = enterprise-grade AI.',
    dependsOn: [1, 3],
    incumbents: ['AutoGPT', 'CrewAI', 'LangChain Agents', 'Microsoft Copilot'],
    artifacts: [
      {
        name: 'Agent',
        persistsWithoutDTU: true,
        storageDomain: 'agents',
        requiredFields: ['id', 'name', 'role', 'capabilities', 'constraints', 'status', 'memoryId'],
      },
      {
        name: 'Role',
        persistsWithoutDTU: true,
        storageDomain: 'agents',
        requiredFields: ['id', 'name', 'permissions', 'constraints', 'safetyEnvelope'],
      },
      {
        name: 'Task',
        persistsWithoutDTU: true,
        storageDomain: 'agents',
        requiredFields: ['id', 'agentId', 'description', 'status', 'input', 'output', 'auditTrailId'],
      },
      {
        name: 'Deliberation',
        persistsWithoutDTU: true,
        storageDomain: 'agents',
        requiredFields: ['id', 'participants', 'topic', 'arguments', 'outcome', 'consensusScore'],
      },
      {
        name: 'Decision',
        persistsWithoutDTU: true,
        storageDomain: 'agents',
        requiredFields: ['id', 'deliberationId', 'choice', 'rationale', 'confidence', 'approvedBy'],
      },
    ],
    engines: [
      { name: 'multi-agent-arbitration', description: 'Resolves conflicts between agents with competing objectives', trigger: 'automatic' },
      { name: 'role-based-constraints', description: 'Enforces role permissions and safety envelopes', trigger: 'automatic' },
      { name: 'memory-reconciliation', description: 'Reconciles divergent agent memories after parallel execution', trigger: 'automatic' },
      { name: 'safety-envelope-enforcement', description: 'Prevents agents from acting outside their safety bounds', trigger: 'automatic' },
    ],
    pipelines: [
      {
        name: 'task-lifecycle',
        steps: ['assign', 'deliberate', 'decide', 'act', 'learn'],
        engines: ['multi-agent-arbitration', 'role-based-constraints'],
      },
      {
        name: 'safety-audit',
        steps: ['monitor', 'detect-violation', 'halt', 'review', 'resume-or-terminate'],
        engines: ['safety-envelope-enforcement', 'memory-reconciliation'],
      },
    ],
    acceptanceCriteria: [
      'Agents are governed by Phase 3 governance primitives',
      'Multi-agent arbitration resolves conflicts with audit trail',
      'Safety envelope prevents unauthorized actions',
      'Memory reconciliation handles parallel agent execution',
      'Every agent action generates DTU exhaust for auditability',
      'Council deliberation produces persistent Decision artifacts',
      'ML engine from merge is callable for model training/inference',
    ],
    status: 'blocked',
  },

  // ── PHASE 5: Studio (Creative) ────────────────────────────────
  {
    order: 5,
    lensId: 'studio',
    name: 'Studio',
    rationale: 'User magnet. Proves Concord is not just thinking. Creative decisions become reusable knowledge.',
    dependsOn: [1],
    incumbents: ['Ableton', 'Figma', 'Adobe Creative Suite', 'Notion'],
    artifacts: [
      {
        name: 'Project',
        persistsWithoutDTU: true,
        storageDomain: 'studio',
        requiredFields: ['id', 'name', 'type', 'assets', 'status', 'version', 'createdAt'],
      },
      {
        name: 'Track',
        persistsWithoutDTU: true,
        storageDomain: 'studio',
        requiredFields: ['id', 'projectId', 'type', 'data', 'effects', 'version'],
      },
      {
        name: 'Canvas',
        persistsWithoutDTU: true,
        storageDomain: 'studio',
        requiredFields: ['id', 'projectId', 'layers', 'dimensions', 'exportFormats'],
      },
      {
        name: 'Asset',
        persistsWithoutDTU: true,
        storageDomain: 'studio',
        requiredFields: ['id', 'projectId', 'type', 'url', 'metadata', 'tags'],
      },
      {
        name: 'Preset',
        persistsWithoutDTU: true,
        storageDomain: 'studio',
        requiredFields: ['id', 'domain', 'name', 'config', 'isShared'],
      },
      {
        name: 'Render',
        persistsWithoutDTU: true,
        storageDomain: 'studio',
        requiredFields: ['id', 'projectId', 'format', 'status', 'outputUrl', 'createdAt'],
      },
    ],
    engines: [
      { name: 'audio-engine', description: 'Audio processing, mixing, mastering', trigger: 'on_demand' },
      { name: 'visual-layout-engine', description: 'Layout computation, responsive design', trigger: 'on_demand' },
      { name: 'text-generation-engine', description: 'Structured creative writing with style analysis', trigger: 'on_demand' },
      { name: 'style-analysis', description: 'Extracts and compares stylistic patterns across projects', trigger: 'on_demand' },
      { name: 'iteration-comparison', description: 'Compares versions of creative work with diff analysis', trigger: 'on_demand' },
    ],
    pipelines: [
      {
        name: 'create-refine-publish',
        steps: ['create', 'refine', 'evaluate', 'render', 'publish'],
        engines: ['audio-engine', 'visual-layout-engine', 'style-analysis'],
      },
      {
        name: 'iteration-learning',
        steps: ['create-version', 'compare-iterations', 'extract-patterns', 'update-presets'],
        engines: ['iteration-comparison', 'style-analysis'],
      },
    ],
    acceptanceCriteria: [
      'Project artifact supports music, visual, and text types',
      'At least one domain engine (audio, visual, or text) is functional',
      'Presets are shareable across projects',
      'Render pipeline produces exportable output',
      'Creative decisions generate DTU exhaust for technique reuse',
      'All merged modes (music, game, AR, fractal, voice) are accessible within Studio UI',
      'Style analysis works across project types',
    ],
    status: 'blocked',
  },

  // ── PHASE 6: Reasoning / Argument ───────────────────────────────
  {
    order: 6,
    lensId: 'reasoning',
    name: 'Reasoning',
    rationale: 'Logical argument construction and validation. Bridges Research and Governance with formal reasoning chains.',
    dependsOn: [1],
    incumbents: ['Roam Research', 'Logseq', 'Prolog IDEs', 'Argument mapping tools'],
    artifacts: [
      {
        name: 'ArgumentTree',
        persistsWithoutDTU: true,
        storageDomain: 'reasoning',
        requiredFields: ['id', 'premise', 'type', 'steps', 'conclusion', 'status', 'createdAt'],
      },
      {
        name: 'Premise',
        persistsWithoutDTU: true,
        storageDomain: 'reasoning',
        requiredFields: ['id', 'text', 'confidence', 'sources', 'chainId'],
      },
      {
        name: 'Inference',
        persistsWithoutDTU: true,
        storageDomain: 'reasoning',
        requiredFields: ['id', 'fromPremises', 'rule', 'conclusion', 'validity', 'chainId'],
      },
    ],
    engines: [
      { name: 'validity-checker', description: 'Validates logical structure of argument chains', trigger: 'automatic' },
      { name: 'counterexample-generator', description: 'Generates counterexamples to test argument strength', trigger: 'on_demand' },
      { name: 'argument-strength-scorer', description: 'Scores overall argument quality on multiple dimensions', trigger: 'automatic' },
    ],
    pipelines: [
      {
        name: 'premise-to-conclusion',
        steps: ['state-premise', 'add-steps', 'validate-logic', 'check-counterexamples', 'conclude'],
        engines: ['validity-checker', 'counterexample-generator'],
      },
      {
        name: 'argument-audit',
        steps: ['load-chain', 'score-strength', 'identify-weaknesses', 'suggest-improvements'],
        engines: ['argument-strength-scorer', 'validity-checker'],
      },
    ],
    acceptanceCriteria: [
      'ArgumentTree artifact persists with full CRUD',
      'Deductive, inductive, abductive, and analogical chains supported',
      'Validity checker flags invalid inference steps automatically',
      'Counterexample generator tests argument robustness',
      'DTU exhaust generated for every chain mutation',
      'Trace visualization shows full reasoning path',
    ],
    status: 'blocked',
  },

  // ── PHASE 7: Knowledge Graph ────────────────────────────────────
  {
    order: 7,
    lensId: 'graph',
    name: 'Knowledge Graph',
    rationale: 'The connective tissue of all knowledge. Every lens produces entities and relations that the graph unifies.',
    dependsOn: [1, 6],
    incumbents: ['Neo4j', 'Obsidian Graph', 'Roam', 'Notion Relations'],
    artifacts: [
      {
        name: 'Entity',
        persistsWithoutDTU: true,
        storageDomain: 'graph',
        requiredFields: ['id', 'label', 'type', 'properties', 'tags', 'createdAt'],
      },
      {
        name: 'Relation',
        persistsWithoutDTU: true,
        storageDomain: 'graph',
        requiredFields: ['id', 'sourceId', 'targetId', 'type', 'weight', 'properties'],
      },
      {
        name: 'Assertion',
        persistsWithoutDTU: true,
        storageDomain: 'graph',
        requiredFields: ['id', 'subject', 'predicate', 'object', 'confidence', 'sources'],
      },
    ],
    engines: [
      { name: 'entity-resolution', description: 'Deduplicates and merges entities across sources', trigger: 'automatic' },
      { name: 'cluster-detection', description: 'Identifies clusters and communities in the graph', trigger: 'on_demand' },
      { name: 'path-analysis', description: 'Finds shortest/weighted paths between entities', trigger: 'on_demand' },
    ],
    pipelines: [
      {
        name: 'ingest-resolve-cluster',
        steps: ['ingest-entities', 'resolve-duplicates', 'compute-relations', 'detect-clusters', 'summarize'],
        engines: ['entity-resolution', 'cluster-detection'],
      },
      {
        name: 'graph-query',
        steps: ['parse-query', 'traverse-graph', 'score-results', 'render-subgraph'],
        engines: ['path-analysis', 'cluster-detection'],
      },
    ],
    acceptanceCriteria: [
      'Entity and Relation artifacts persist with full CRUD',
      'Force-directed layout renders interactively',
      'Entity resolution deduplicates on ingest',
      'Cluster detection identifies knowledge communities',
      'DTU exhaust generated for every graph mutation',
      'Export to JSON and GraphML formats',
    ],
    status: 'blocked',
  },

  // ── PHASE 8: Collaboration / Whiteboard ─────────────────────────
  {
    order: 8,
    lensId: 'whiteboard',
    name: 'Collaboration',
    rationale: 'Visual thinking and real-time collaboration. The shared workspace where ideas become visible.',
    dependsOn: [1],
    incumbents: ['Miro', 'FigJam', 'AFFiNE', 'Excalidraw'],
    artifacts: [
      {
        name: 'Board',
        persistsWithoutDTU: true,
        storageDomain: 'whiteboard',
        requiredFields: ['id', 'name', 'mode', 'elements', 'createdAt', 'updatedAt'],
      },
      {
        name: 'Element',
        persistsWithoutDTU: true,
        storageDomain: 'whiteboard',
        requiredFields: ['id', 'boardId', 'type', 'x', 'y', 'width', 'height', 'data'],
      },
      {
        name: 'Connection',
        persistsWithoutDTU: true,
        storageDomain: 'whiteboard',
        requiredFields: ['id', 'boardId', 'fromElementId', 'toElementId', 'type'],
      },
    ],
    engines: [
      { name: 'auto-layout', description: 'Automatically arranges elements for optimal readability', trigger: 'on_demand' },
      { name: 'canvas-renderer', description: 'High-performance canvas rendering with zoom/pan', trigger: 'automatic' },
      { name: 'export-renderer', description: 'Renders boards to PNG/SVG for export', trigger: 'on_demand' },
    ],
    pipelines: [
      {
        name: 'create-arrange-export',
        steps: ['create-board', 'add-elements', 'auto-layout', 'render', 'export'],
        engines: ['auto-layout', 'canvas-renderer', 'export-renderer'],
      },
      {
        name: 'moodboard-to-arrangement',
        steps: ['collect-references', 'organize-moodboard', 'derive-structure', 'create-arrangement'],
        engines: ['auto-layout', 'canvas-renderer'],
      },
    ],
    acceptanceCriteria: [
      'Board artifact persists with full CRUD',
      'Canvas, moodboard, and arrangement modes all functional',
      'Elements support shapes, text, images, audio pins, DTU links',
      'Undo/redo with history',
      'Export to PNG works',
      'DTU exhaust generated for board mutations',
    ],
    status: 'blocked',
  },

  // ── PHASE 9: Legal / Policy ─────────────────────────────────────
  {
    order: 9,
    lensId: 'law',
    name: 'Legal',
    rationale: 'Compliance and legal frameworks are required for enterprise adoption. Makes governance decisions legally defensible.',
    dependsOn: [3],
    incumbents: ['LexisNexis', 'Westlaw', 'Clio', 'Contract management tools'],
    artifacts: [
      {
        name: 'CaseFile',
        persistsWithoutDTU: true,
        storageDomain: 'law',
        requiredFields: ['id', 'title', 'jurisdiction', 'status', 'frameworks', 'createdAt'],
      },
      {
        name: 'Clause',
        persistsWithoutDTU: true,
        storageDomain: 'law',
        requiredFields: ['id', 'caseId', 'text', 'type', 'framework', 'status'],
      },
      {
        name: 'Draft',
        persistsWithoutDTU: true,
        storageDomain: 'law',
        requiredFields: ['id', 'caseId', 'title', 'body', 'version', 'status'],
      },
      {
        name: 'PrecedentGraph',
        persistsWithoutDTU: true,
        storageDomain: 'law',
        requiredFields: ['id', 'caseId', 'nodes', 'edges', 'jurisdiction'],
      },
    ],
    engines: [
      { name: 'compliance-checker', description: 'Checks proposals against legal frameworks (GDPR, DMCA, AI Act)', trigger: 'automatic' },
      { name: 'precedent-search', description: 'Finds relevant legal precedents for a given case', trigger: 'on_demand' },
      { name: 'risk-assessor', description: 'Assesses legal risk of proposed actions', trigger: 'on_demand' },
    ],
    pipelines: [
      {
        name: 'compliance-review',
        steps: ['ingest-proposal', 'identify-frameworks', 'check-compliance', 'assess-risk', 'generate-report'],
        engines: ['compliance-checker', 'risk-assessor'],
      },
      {
        name: 'draft-review',
        steps: ['draft-clause', 'check-precedents', 'validate-compliance', 'finalize'],
        engines: ['precedent-search', 'compliance-checker'],
      },
    ],
    acceptanceCriteria: [
      'CaseFile artifact persists with full CRUD',
      'Compliance checker validates against GDPR, CCPA, DMCA, EU AI Act',
      'Legality gate blocks non-compliant proposals',
      'Precedent search returns relevant citations',
      'DTU exhaust generated for every legal action',
      'Risk assessment produces quantified risk scores',
    ],
    status: 'blocked',
  },

  // ── PHASE 10: Database / Structured Knowledge ───────────────────
  {
    order: 10,
    lensId: 'database',
    name: 'Database',
    rationale: 'Structured data is the foundation for all analytics. Gives every lens a queryable substrate.',
    dependsOn: [1],
    incumbents: ['DBeaver', 'TablePlus', 'Retool', 'Airtable'],
    artifacts: [
      {
        name: 'SavedQuery',
        persistsWithoutDTU: true,
        storageDomain: 'database',
        requiredFields: ['id', 'title', 'sql', 'description', 'createdAt'],
      },
      {
        name: 'Snapshot',
        persistsWithoutDTU: true,
        storageDomain: 'database',
        requiredFields: ['id', 'queryId', 'results', 'rowCount', 'executionTime', 'createdAt'],
      },
      {
        name: 'SchemaView',
        persistsWithoutDTU: true,
        storageDomain: 'database',
        requiredFields: ['id', 'tables', 'indexes', 'relations', 'version'],
      },
    ],
    engines: [
      { name: 'query-optimizer', description: 'Analyzes and optimizes SQL queries', trigger: 'on_demand' },
      { name: 'schema-inspector', description: 'Introspects database schema and detects issues', trigger: 'on_demand' },
      { name: 'data-profiler', description: 'Profiles data quality and generates statistics', trigger: 'on_demand' },
    ],
    pipelines: [
      {
        name: 'query-optimize-export',
        steps: ['write-query', 'analyze-plan', 'optimize', 'execute', 'export-results'],
        engines: ['query-optimizer', 'data-profiler'],
      },
      {
        name: 'schema-audit',
        steps: ['inspect-schema', 'detect-issues', 'suggest-indexes', 'generate-report'],
        engines: ['schema-inspector', 'query-optimizer'],
      },
    ],
    acceptanceCriteria: [
      'SavedQuery artifact persists with full CRUD',
      'Query editor with syntax highlighting',
      'Results displayed in paginated table',
      'Schema browser shows tables, columns, indexes',
      'Export to JSON and CSV',
      'DTU exhaust generated for query execution',
    ],
    status: 'blocked',
  },

  // ── PHASE 11: Calendar ───────────────────────────────────────────
  {
    order: 11,
    lensId: 'calendar',
    name: 'Calendar',
    rationale: 'Time management is universal. Calendar becomes the scheduling substrate for all other lenses.',
    dependsOn: [1],
    incumbents: ['Google Calendar', 'Outlook', 'Fantastical', 'Cal.com'],
    artifacts: [
      { name: 'Event', persistsWithoutDTU: true, storageDomain: 'calendar', requiredFields: ['id', 'title', 'start', 'end', 'category', 'status'] },
      { name: 'Category', persistsWithoutDTU: true, storageDomain: 'calendar', requiredFields: ['id', 'name', 'color'] },
      { name: 'Recurrence', persistsWithoutDTU: true, storageDomain: 'calendar', requiredFields: ['id', 'eventId', 'pattern', 'until'] },
    ],
    engines: [
      { name: 'conflict-resolver', description: 'Detects and resolves overlapping events', trigger: 'automatic' },
      { name: 'day-planner', description: 'Generates optimized daily schedules', trigger: 'on_demand' },
      { name: 'week-planner', description: 'Plans weekly blocks for deep work', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'plan-resolve-notify', steps: ['gather-events', 'detect-conflicts', 'resolve', 'notify'], engines: ['conflict-resolver', 'day-planner'] },
      { name: 'weekly-review', steps: ['load-week', 'analyze-utilization', 'suggest-optimizations', 'replan'], engines: ['week-planner', 'day-planner'] },
    ],
    acceptanceCriteria: ['Event artifact persists with full CRUD', 'Conflict detection is automatic', 'ICS export works', 'DTU exhaust for scheduling actions'],
    status: 'blocked',
  },

  // ── PHASE 12: Daily ─────────────────────────────────────────────
  {
    order: 12,
    lensId: 'daily',
    name: 'Daily',
    rationale: 'Daily journaling is the personal knowledge capture layer. Feeds Research and Experience lenses.',
    dependsOn: [1],
    incumbents: ['Day One', 'Notion Daily', 'Logseq Daily', 'Obsidian Daily Notes'],
    artifacts: [
      { name: 'Entry', persistsWithoutDTU: true, storageDomain: 'daily', requiredFields: ['id', 'date', 'content', 'mood', 'tags'] },
      { name: 'Session', persistsWithoutDTU: true, storageDomain: 'daily', requiredFields: ['id', 'type', 'startedAt', 'duration', 'summary'] },
      { name: 'Insight', persistsWithoutDTU: true, storageDomain: 'daily', requiredFields: ['id', 'entryIds', 'pattern', 'confidence'] },
    ],
    engines: [
      { name: 'pattern-detector', description: 'Detects recurring patterns across daily entries', trigger: 'automatic' },
      { name: 'insight-generator', description: 'Generates insights from entry clusters', trigger: 'on_demand' },
      { name: 'summarizer', description: 'Summarizes daily/weekly/monthly entries', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'capture-analyze-insight', steps: ['capture-entry', 'tag-and-categorize', 'detect-patterns', 'generate-insights'], engines: ['pattern-detector', 'insight-generator'] },
      { name: 'periodic-review', steps: ['load-period', 'summarize', 'extract-themes', 'report'], engines: ['summarizer', 'pattern-detector'] },
    ],
    acceptanceCriteria: ['Entry artifact persists with full CRUD', 'Pattern detection runs automatically', 'Markdown export works', 'DTU exhaust for all mutations'],
    status: 'blocked',
  },

  // ── PHASE 13: Collab ────────────────────────────────────────────
  {
    order: 13,
    lensId: 'collab',
    name: 'Collaboration',
    rationale: 'Real-time collaboration is essential for team productivity. Bridges all social lenses.',
    dependsOn: [3],
    incumbents: ['Google Docs', 'Notion', 'Linear', 'Figma'],
    artifacts: [
      { name: 'CollabSession', persistsWithoutDTU: true, storageDomain: 'collab', requiredFields: ['id', 'title', 'participants', 'status', 'createdAt'] },
      { name: 'Change', persistsWithoutDTU: true, storageDomain: 'collab', requiredFields: ['id', 'sessionId', 'userId', 'operation', 'path', 'value'] },
      { name: 'Decision', persistsWithoutDTU: true, storageDomain: 'collab', requiredFields: ['id', 'sessionId', 'summary', 'participants', 'decidedAt'] },
    ],
    engines: [
      { name: 'thread-summarizer', description: 'Summarizes discussion threads', trigger: 'on_demand' },
      { name: 'action-extractor', description: 'Extracts action items from discussions', trigger: 'on_demand' },
      { name: 'council-runner', description: 'Runs council votes on contested changes', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'discuss-decide-act', steps: ['open-thread', 'discuss', 'summarize', 'extract-actions', 'decide'], engines: ['thread-summarizer', 'action-extractor'] },
      { name: 'contested-merge', steps: ['propose-merge', 'run-council', 'vote', 'apply-or-reject'], engines: ['council-runner', 'thread-summarizer'] },
    ],
    acceptanceCriteria: ['Session artifact persists with full CRUD', 'Thread summarization works', 'Action extraction produces items', 'DTU exhaust for all mutations'],
    status: 'blocked',
  },

  // ── PHASE 14: Experience ────────────────────────────────────────
  {
    order: 14,
    lensId: 'experience',
    name: 'Experience',
    rationale: 'Professional portfolio and skill tracking. Bridges social identity with verifiable achievements.',
    dependsOn: [1],
    incumbents: ['LinkedIn', 'GitHub Profile', 'Polywork', 'Read.cv'],
    artifacts: [
      { name: 'Portfolio', persistsWithoutDTU: true, storageDomain: 'experience', requiredFields: ['id', 'title', 'items', 'visibility', 'version'] },
      { name: 'Skill', persistsWithoutDTU: true, storageDomain: 'experience', requiredFields: ['id', 'name', 'level', 'endorsements', 'evidence'] },
      { name: 'Credential', persistsWithoutDTU: true, storageDomain: 'experience', requiredFields: ['id', 'type', 'issuer', 'verified', 'issuedAt'] },
    ],
    engines: [
      { name: 'resume-generator', description: 'Generates formatted resumes from portfolio data', trigger: 'on_demand' },
      { name: 'claim-validator', description: 'Validates skill claims against evidence', trigger: 'on_demand' },
      { name: 'version-comparer', description: 'Compares portfolio versions over time', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'build-validate-publish', steps: ['add-items', 'validate-claims', 'generate-resume', 'publish'], engines: ['claim-validator', 'resume-generator'] },
      { name: 'skill-growth', steps: ['track-skill', 'gather-evidence', 'validate', 'endorse', 'level-up'], engines: ['claim-validator', 'version-comparer'] },
    ],
    acceptanceCriteria: ['Portfolio artifact persists with full CRUD', 'Resume generation produces exportable output', 'Skill validation cross-references evidence', 'DTU exhaust for all mutations'],
    status: 'blocked',
  },

  // ── PHASE 15: Marketplace ───────────────────────────────────────
  {
    order: 15,
    lensId: 'marketplace',
    name: 'Marketplace',
    rationale: 'Artifact exchange and licensing. Makes knowledge artifacts tradeable.',
    dependsOn: [1],
    incumbents: ['Gumroad', 'Shopify', 'Notion Templates', 'GitHub Marketplace'],
    artifacts: [
      { name: 'Listing', persistsWithoutDTU: true, storageDomain: 'marketplace', requiredFields: ['id', 'title', 'price', 'artifactHash', 'status'] },
      { name: 'Purchase', persistsWithoutDTU: true, storageDomain: 'marketplace', requiredFields: ['id', 'listingId', 'buyerId', 'amount', 'purchasedAt'] },
      { name: 'License', persistsWithoutDTU: true, storageDomain: 'marketplace', requiredFields: ['id', 'listingId', 'type', 'grantedTo', 'expiresAt'] },
    ],
    engines: [
      { name: 'hash-verifier', description: 'Verifies artifact integrity via content hashing', trigger: 'automatic' },
      { name: 'license-issuer', description: 'Issues licenses for purchased artifacts', trigger: 'automatic' },
      { name: 'royalty-distributor', description: 'Calculates and distributes royalties', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'list-sell-license', steps: ['create-listing', 'verify-hash', 'publish', 'process-purchase', 'issue-license'], engines: ['hash-verifier', 'license-issuer'] },
      { name: 'royalty-cycle', steps: ['aggregate-sales', 'calculate-royalties', 'distribute', 'report'], engines: ['royalty-distributor', 'hash-verifier'] },
    ],
    acceptanceCriteria: ['Listing artifact persists with full CRUD', 'Hash verification ensures integrity', 'License issuance is automatic', 'DTU exhaust for all transactions'],
    status: 'blocked',
  },

  // ── PHASE 16: Forum ─────────────────────────────────────────────
  {
    order: 16,
    lensId: 'forum',
    name: 'Forum',
    rationale: 'Community discourse and knowledge exchange. Structured discussion with voting and moderation.',
    dependsOn: [3],
    incumbents: ['Reddit', 'Discourse', 'Stack Overflow', 'Circle'],
    artifacts: [
      { name: 'Post', persistsWithoutDTU: true, storageDomain: 'forum', requiredFields: ['id', 'title', 'body', 'authorId', 'communityId', 'votes'] },
      { name: 'Comment', persistsWithoutDTU: true, storageDomain: 'forum', requiredFields: ['id', 'postId', 'authorId', 'body', 'votes'] },
      { name: 'Community', persistsWithoutDTU: true, storageDomain: 'forum', requiredFields: ['id', 'name', 'rules', 'memberCount'] },
    ],
    engines: [
      { name: 'post-ranker', description: 'Ranks posts by quality, relevance, and recency', trigger: 'automatic' },
      { name: 'thesis-extractor', description: 'Extracts core thesis from long posts', trigger: 'on_demand' },
      { name: 'summary-generator', description: 'Generates discussion summaries as DTUs', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'post-rank-surface', steps: ['submit-post', 'rank', 'surface-to-feed', 'collect-votes', 're-rank'], engines: ['post-ranker', 'thesis-extractor'] },
      { name: 'discussion-distill', steps: ['load-thread', 'extract-thesis', 'summarize', 'generate-dtu'], engines: ['thesis-extractor', 'summary-generator'] },
    ],
    acceptanceCriteria: ['Post artifact persists with full CRUD', 'Ranking algorithm surfaces quality content', 'Thesis extraction works on long posts', 'DTU exhaust for all forum actions'],
    status: 'blocked',
  },

  // ── PHASE 17: Feed ──────────────────────────────────────────────
  {
    order: 17,
    lensId: 'feed',
    name: 'Feed',
    rationale: 'Personalized content stream. Aggregates and ranks content from all social lenses.',
    dependsOn: [16],
    incumbents: ['Twitter', 'Mastodon', 'Medium', 'Substack'],
    artifacts: [
      { name: 'FeedPost', persistsWithoutDTU: true, storageDomain: 'feed', requiredFields: ['id', 'content', 'authorId', 'type', 'createdAt'] },
      { name: 'Interaction', persistsWithoutDTU: true, storageDomain: 'feed', requiredFields: ['id', 'postId', 'userId', 'type', 'createdAt'] },
      { name: 'Topic', persistsWithoutDTU: true, storageDomain: 'feed', requiredFields: ['id', 'name', 'keywords', 'postCount'] },
    ],
    engines: [
      { name: 'feed-ranker', description: 'Ranks feed items by relevance and engagement', trigger: 'automatic' },
      { name: 'personalizer', description: 'Personalizes feed based on user interests', trigger: 'automatic' },
      { name: 'topic-clusterer', description: 'Clusters posts into coherent topics', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'ingest-rank-serve', steps: ['ingest-post', 'rank', 'personalize', 'serve'], engines: ['feed-ranker', 'personalizer'] },
      { name: 'topic-digest', steps: ['cluster-topics', 'summarize-clusters', 'generate-digest', 'notify'], engines: ['topic-clusterer', 'feed-ranker'] },
    ],
    acceptanceCriteria: ['Post artifact persists with full CRUD', 'Feed ranking personalizes content', 'Topic clustering groups related posts', 'DTU exhaust for all interactions'],
    status: 'blocked',
  },

  // ── PHASE 18: Thread ────────────────────────────────────────────
  {
    order: 18,
    lensId: 'thread',
    name: 'Thread',
    rationale: 'Branching conversation trees. Enables non-linear discourse with consensus detection.',
    dependsOn: [1],
    incumbents: ['Slack', 'Discord', 'Twist', 'Threads'],
    artifacts: [
      { name: 'Thread', persistsWithoutDTU: true, storageDomain: 'thread', requiredFields: ['id', 'title', 'rootNodeId', 'status', 'createdAt'] },
      { name: 'Node', persistsWithoutDTU: true, storageDomain: 'thread', requiredFields: ['id', 'threadId', 'parentId', 'content', 'authorId'] },
      { name: 'ThreadDecision', persistsWithoutDTU: true, storageDomain: 'thread', requiredFields: ['id', 'threadId', 'summary', 'confidence', 'decidedAt'] },
    ],
    engines: [
      { name: 'consensus-detector', description: 'Detects emerging consensus in branching discussions', trigger: 'automatic' },
      { name: 'decision-extractor', description: 'Extracts decisions from thread conclusions', trigger: 'on_demand' },
      { name: 'branch-summarizer', description: 'Summarizes individual branches', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'discuss-detect-decide', steps: ['open-thread', 'branch', 'discuss', 'detect-consensus', 'extract-decision'], engines: ['consensus-detector', 'decision-extractor'] },
      { name: 'thread-archive', steps: ['load-thread', 'summarize-branches', 'compile-decisions', 'archive'], engines: ['branch-summarizer', 'decision-extractor'] },
    ],
    acceptanceCriteria: ['Thread artifact persists with full CRUD', 'Branching and merging work', 'Consensus detection flags agreement', 'DTU exhaust for all thread actions'],
    status: 'blocked',
  },

  // ── PHASE 19: Music ─────────────────────────────────────────────
  {
    order: 19,
    lensId: 'music',
    name: 'Music',
    rationale: 'Music creation and analysis. Creative expression meets structured knowledge.',
    dependsOn: [5],
    incumbents: ['Spotify', 'SoundCloud', 'Bandcamp', 'Apple Music'],
    artifacts: [
      { name: 'Track', persistsWithoutDTU: true, storageDomain: 'music', requiredFields: ['id', 'title', 'artist', 'duration', 'bpm', 'key'] },
      { name: 'Playlist', persistsWithoutDTU: true, storageDomain: 'music', requiredFields: ['id', 'name', 'trackIds', 'description'] },
      { name: 'Album', persistsWithoutDTU: true, storageDomain: 'music', requiredFields: ['id', 'title', 'artistId', 'trackIds', 'releaseDate'] },
    ],
    engines: [
      { name: 'audio-analyzer', description: 'Analyzes audio features (BPM, key, energy)', trigger: 'on_demand' },
      { name: 'arrangement-generator', description: 'Generates arrangements from stems', trigger: 'on_demand' },
      { name: 'stem-exporter', description: 'Exports individual stems from tracks', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'create-analyze-publish', steps: ['create-track', 'analyze-audio', 'tag-features', 'add-to-playlist', 'publish'], engines: ['audio-analyzer', 'arrangement-generator'] },
      { name: 'stem-remix', steps: ['load-track', 'export-stems', 'arrange', 'render', 'publish'], engines: ['stem-exporter', 'arrangement-generator'] },
    ],
    acceptanceCriteria: ['Track artifact persists with full CRUD', 'Audio analysis extracts features', 'Stem export works', 'DTU exhaust for all music actions'],
    status: 'blocked',
  },

  // ── PHASE 20: Finance ───────────────────────────────────────────
  {
    order: 20,
    lensId: 'finance',
    name: 'Finance',
    rationale: 'Financial tracking and simulation. Makes economic decisions data-driven.',
    dependsOn: [2],
    incumbents: ['Mint', 'YNAB', 'Robinhood', 'Bloomberg Terminal'],
    artifacts: [
      { name: 'Asset', persistsWithoutDTU: true, storageDomain: 'finance', requiredFields: ['id', 'symbol', 'type', 'quantity', 'currentPrice'] },
      { name: 'Transaction', persistsWithoutDTU: true, storageDomain: 'finance', requiredFields: ['id', 'assetId', 'type', 'amount', 'executedAt'] },
      { name: 'Report', persistsWithoutDTU: true, storageDomain: 'finance', requiredFields: ['id', 'type', 'period', 'data', 'generatedAt'] },
    ],
    engines: [
      { name: 'portfolio-simulator', description: 'Simulates portfolio performance under scenarios', trigger: 'on_demand' },
      { name: 'report-generator', description: 'Generates financial reports', trigger: 'on_demand' },
      { name: 'alert-engine', description: 'Monitors conditions and triggers alerts', trigger: 'automatic' },
    ],
    pipelines: [
      { name: 'track-simulate-report', steps: ['record-transaction', 'update-portfolio', 'simulate', 'generate-report'], engines: ['portfolio-simulator', 'report-generator'] },
      { name: 'monitor-alert', steps: ['load-conditions', 'evaluate', 'trigger-alerts', 'notify'], engines: ['alert-engine', 'portfolio-simulator'] },
    ],
    acceptanceCriteria: ['Asset artifact persists with full CRUD', 'Portfolio simulation works', 'Report generation produces CSV', 'DTU exhaust for all financial actions'],
    status: 'blocked',
  },

  // ── PHASE 21: ML ────────────────────────────────────────────────
  {
    order: 21,
    lensId: 'ml',
    name: 'ML',
    rationale: 'Machine learning experiment tracking. Makes ML workflows reproducible and auditable.',
    dependsOn: [1, 10],
    incumbents: ['MLflow', 'Weights & Biases', 'Neptune', 'DVC'],
    artifacts: [
      { name: 'Model', persistsWithoutDTU: true, storageDomain: 'ml', requiredFields: ['id', 'name', 'framework', 'version', 'metrics'] },
      { name: 'Experiment', persistsWithoutDTU: true, storageDomain: 'ml', requiredFields: ['id', 'modelId', 'config', 'status', 'results'] },
      { name: 'RunLog', persistsWithoutDTU: true, storageDomain: 'ml', requiredFields: ['id', 'experimentId', 'epoch', 'metrics', 'timestamp'] },
    ],
    engines: [
      { name: 'experiment-runner', description: 'Runs ML experiments with parameter tracking', trigger: 'on_demand' },
      { name: 'run-comparer', description: 'Compares metrics across experiment runs', trigger: 'on_demand' },
      { name: 'report-generator', description: 'Generates experiment reports', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'train-evaluate-deploy', steps: ['configure-experiment', 'train', 'evaluate', 'compare-runs', 'deploy'], engines: ['experiment-runner', 'run-comparer'] },
      { name: 'experiment-report', steps: ['load-runs', 'compare-metrics', 'generate-charts', 'publish-report'], engines: ['run-comparer', 'report-generator'] },
    ],
    acceptanceCriteria: ['Model artifact persists with full CRUD', 'Experiment tracking is reproducible', 'Run comparison shows metric diffs', 'DTU exhaust for all ML actions'],
    status: 'blocked',
  },

  // ── PHASE 22: SRS ───────────────────────────────────────────────
  {
    order: 22,
    lensId: 'srs',
    name: 'SRS',
    rationale: 'Spaced repetition for knowledge retention. Makes learning compounding.',
    dependsOn: [1],
    incumbents: ['Anki', 'SuperMemo', 'Mochi', 'RemNote'],
    artifacts: [
      { name: 'Deck', persistsWithoutDTU: true, storageDomain: 'srs', requiredFields: ['id', 'name', 'cardCount', 'lastReviewedAt'] },
      { name: 'Card', persistsWithoutDTU: true, storageDomain: 'srs', requiredFields: ['id', 'deckId', 'front', 'back', 'interval', 'nextReviewAt'] },
      { name: 'ReviewLog', persistsWithoutDTU: true, storageDomain: 'srs', requiredFields: ['id', 'cardId', 'rating', 'reviewedAt', 'interval'] },
    ],
    engines: [
      { name: 'interval-optimizer', description: 'Optimizes review intervals using SM-2+ algorithm', trigger: 'automatic' },
      { name: 'card-generator', description: 'Generates cards from DTU content', trigger: 'on_demand' },
      { name: 'retention-analyzer', description: 'Analyzes retention curves and suggests improvements', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'review-optimize-schedule', steps: ['present-card', 'record-response', 'optimize-interval', 'schedule-next'], engines: ['interval-optimizer', 'retention-analyzer'] },
      { name: 'dtu-to-cards', steps: ['select-dtus', 'extract-concepts', 'generate-cards', 'add-to-deck'], engines: ['card-generator', 'interval-optimizer'] },
    ],
    acceptanceCriteria: ['Deck artifact persists with full CRUD', 'Interval optimization adapts to performance', 'Card generation from DTUs works', 'DTU exhaust for all review actions'],
    status: 'blocked',
  },

  // ── PHASE 23: Voice ─────────────────────────────────────────────
  {
    order: 23,
    lensId: 'voice',
    name: 'Voice',
    rationale: 'Voice capture and processing. Audio-first knowledge capture with transcription and analysis.',
    dependsOn: [5],
    incumbents: ['Otter.ai', 'Whisper', 'Rev', 'Descript'],
    artifacts: [
      { name: 'Take', persistsWithoutDTU: true, storageDomain: 'voice', requiredFields: ['id', 'title', 'duration', 'format', 'status'] },
      { name: 'Transcript', persistsWithoutDTU: true, storageDomain: 'voice', requiredFields: ['id', 'takeId', 'text', 'segments', 'language'] },
      { name: 'VoiceNote', persistsWithoutDTU: true, storageDomain: 'voice', requiredFields: ['id', 'takeId', 'summary', 'tasks', 'createdAt'] },
    ],
    engines: [
      { name: 'transcriber', description: 'Transcribes audio to text with timestamps', trigger: 'on_demand' },
      { name: 'summarizer', description: 'Summarizes transcripts into key points', trigger: 'on_demand' },
      { name: 'task-extractor', description: 'Extracts action items from voice notes', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'record-transcribe-summarize', steps: ['record-take', 'transcribe', 'summarize', 'extract-tasks'], engines: ['transcriber', 'summarizer'] },
      { name: 'voice-to-knowledge', steps: ['load-transcript', 'extract-concepts', 'link-to-graph', 'generate-dtu'], engines: ['task-extractor', 'summarizer'] },
    ],
    acceptanceCriteria: ['Take artifact persists with full CRUD', 'Transcription produces timestamped text', 'Task extraction finds action items', 'DTU exhaust for all voice actions'],
    status: 'blocked',
  },

  // ── PHASE 24: Crafting ──────────────────────────────────────────
  {
    order: 24,
    lensId: 'crafting',
    name: 'Crafting',
    rationale: 'Production-grade crafting workbench. Surfaces the full recipe substrate (food/style/spell/blueprint) plus the forge, marketplace, and skill progression. Rivals Paprika + the Skyrim crafting menu in one workspace.',
    dependsOn: [],
    incumbents: ['Paprika', 'Skyrim crafting', 'NoteBook LM cookbooks', 'Whetstone'],
    artifacts: [
      { name: 'Recipe',           persistsWithoutDTU: true, storageDomain: 'crafting', requiredFields: ['id', 'title', 'type', 'meta', 'created_at'] },
      { name: 'CraftSession',     persistsWithoutDTU: true, storageDomain: 'crafting', requiredFields: ['id', 'recipeId', 'worldId', 'userId', 'output', 'created_at'] },
      { name: 'TierListing',      persistsWithoutDTU: true, storageDomain: 'crafting', requiredFields: ['id', 'dtuId', 'price', 'tier_prices', 'creator_id'] },
      { name: 'ResourceBar',      persistsWithoutDTU: true, storageDomain: 'crafting', requiredFields: ['user_id', 'world_id', 'bar_type', 'current', 'max'] },
      { name: 'PlayerSkillLevel', persistsWithoutDTU: true, storageDomain: 'crafting', requiredFields: ['user_id', 'skill_type', 'level', 'experience'] },
    ],
    engines: [
      { name: 'recipe-validator',        description: 'Validates recipe spec for skill + resource requirements', trigger: 'on_demand' },
      { name: 'craft-engine',            description: 'Executes a recipe: deducts resources, mints output DTU, awards XP', trigger: 'on_demand' },
      { name: 'skill-progression',       description: 'Awards XP, recomputes mastery thresholds, unlocks cross-skill flags', trigger: 'automatic' },
      { name: 'royalty-cascade',         description: 'Half-rate royalty pass on derivative purchases (95/5 floor at 0.0005)', trigger: 'automatic' },
    ],
    pipelines: [
      { name: 'author-validate-list',     steps: ['author-recipe', 'validate', 'mint-dtu', 'list-on-marketplace', 'announce'], engines: ['recipe-validator'] },
      { name: 'forge-craft-cycle',        steps: ['load-recipe', 'check-skills', 'check-resources', 'execute', 'award-xp', 'emit-dtu'], engines: ['recipe-validator', 'craft-engine', 'skill-progression'] },
      { name: 'cook-eat-buff',            steps: ['cook', 'add-to-inventory', 'consume', 'apply-active-effect', 'emit-buff'], engines: ['craft-engine'] },
      { name: 'browse-buy-cascade',       steps: ['search-marketplace', 'purchase-with-royalties', 'cascade-ancestors', 'register-citation'], engines: ['royalty-cascade'] },
    ],
    acceptanceCriteria: [
      'Recipe artifact persists in personal-locker with full CRUD',
      'Forge tab executes crafting end-to-end with resource deduction',
      'Browse tab purchases route through royalty cascade',
      'Skills tab surfaces practiced skills + crafting skill levels',
      'Resource bars upgrade via /api/crafting/upgrade-bar',
      'DTU exhaust generated for every craft, cook, mint, and purchase',
    ],
    status: 'in_progress',
  },

  // ── PHASE 25: Creator ───────────────────────────────────────────
  {
    order: 25,
    lensId: 'creator',
    name: 'Creator',
    rationale: 'Production-grade creator dashboard. Earnings, royalty cascade, profile, followers, and listings management. Rivals Patreon + Substack + Bandcamp Artist Tools in one view.',
    dependsOn: [],
    incumbents: ['Patreon', 'Substack', 'Bandcamp', 'Gumroad'],
    artifacts: [
      { name: 'CreatorProfile',  persistsWithoutDTU: true, storageDomain: 'creator', requiredFields: ['userId', 'displayName', 'bio', 'avatar', 'isPublic', 'specialization'] },
      { name: 'Broadcast',       persistsWithoutDTU: true, storageDomain: 'creator', requiredFields: ['id', 'kind', 'message', 'at'] },
      { name: 'RoyaltyStream',   persistsWithoutDTU: true, storageDomain: 'creator', requiredFields: ['rootId', 'generations', 'totalDownstream', 'maxObservedDepth'] },
      { name: 'TierListing',     persistsWithoutDTU: true, storageDomain: 'creator', requiredFields: ['id', 'price', 'tierPrices', 'status'] },
      { name: 'CreatorScore',    persistsWithoutDTU: true, storageDomain: 'creator', requiredFields: ['userId', 'reputationScore', 'lineageDepth', 'citationsReceived'] },
    ],
    engines: [
      { name: 'reputation-tracker',    description: 'Recomputes reputation/influence on each citation/download', trigger: 'automatic' },
      { name: 'cascade-walker',        description: 'Walks downstream lineage to compute per-generation royalty share', trigger: 'on_demand' },
      { name: 'withdrawal-eligibility', description: 'Filters credits by 48h hold gate, returns eligible vs pending', trigger: 'on_demand' },
      { name: 'broadcast-publisher',    description: 'Publishes a creator broadcast that followers see across lenses', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'profile-broadcast-feed',   steps: ['upsert-profile', 'mint-broadcast', 'emit-realtime', 'fan-out-to-followers'], engines: ['broadcast-publisher'] },
      { name: 'cascade-projection',       steps: ['load-top-cited', 'walk-lineage', 'project-shares', 'render-tree'], engines: ['cascade-walker'] },
      { name: 'eligible-earnings-cycle',  steps: ['load-credits', 'apply-48h-gate', 'aggregate-eligible', 'request-withdrawal'], engines: ['withdrawal-eligibility'] },
      { name: 'reputation-update',        steps: ['observe-event', 'recompute-score', 'emit-leaderboard-delta'], engines: ['reputation-tracker'] },
    ],
    acceptanceCriteria: [
      'Profile artifact persists via /api/social/profile with full CRUD',
      'Followers + Following lists rendered from /api/social/followers + /following',
      'Top-3 earners surface from listing × downloads or totalEarnings',
      'Tier-pricing edit flow (usage / remix / commercial) PATCHes /api/marketplace/listings/:id',
      'Withdrawal eligibility distinguishes eligible vs pending vs hold',
      'Cascade panel walks downstream lineage with per-generation share',
      'Broadcast artifact persists in lens-artifact runtime on each profile save',
    ],
    status: 'in_progress',
  },

  // ── PHASE 26: Federation ────────────────────────────────────────
  {
    order: 26,
    lensId: 'federation',
    name: 'Federation',
    rationale: 'Production-grade peer manager + cross-instance search. Surfaces every federation surface (status, peers, sync, search, trust graph) in one workspace. Rivals ActivityPub admin tools and Mastodon federation UI.',
    dependsOn: [],
    incumbents: ['Mastodon admin', 'ActivityPub Relay UI', 'Matrix federation tester'],
    artifacts: [
      { name: 'Peer',           persistsWithoutDTU: true, storageDomain: 'federation', requiredFields: ['instanceId', 'name', 'registryUrl', 'lastSeen', 'status'] },
      { name: 'PeerEvent',      persistsWithoutDTU: true, storageDomain: 'federation', requiredFields: ['kind', 'at', 'instanceId'] },
      { name: 'TrustEdge',      persistsWithoutDTU: true, storageDomain: 'federation', requiredFields: ['fromId', 'toId', 'weight', 'observedAt'] },
      { name: 'ShadowDTU',      persistsWithoutDTU: true, storageDomain: 'federation', requiredFields: ['id', 'sourceInstanceId', 'title', 'snippet'] },
      { name: 'FederationToken', persistsWithoutDTU: true, storageDomain: 'federation', requiredFields: ['token', 'createdAt', 'scope'] },
    ],
    engines: [
      { name: 'peer-prober',       description: 'Probes peer URL → returns instanceId + name + capabilities', trigger: 'on_demand' },
      { name: 'sync-pass',         description: 'Pulls new shadow DTUs from peers, pushes pending posts', trigger: 'scheduled' },
      { name: 'trust-aggregator',  description: 'Maintains trust edge weights from rolling DTU exchange', trigger: 'automatic' },
      { name: 'cross-search',      description: 'Fans search query across all federated instances + merges', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'probe-register-peer',     steps: ['probe-url', 'verify-capabilities', 'register-peer', 'mint-peer-event'], engines: ['peer-prober'] },
      { name: 'manual-sync-pass',        steps: ['enumerate-peers', 'pull-shadows', 'push-pending', 'update-last-seen', 'mint-sync-event'], engines: ['sync-pass'] },
      { name: 'cross-instance-search',   steps: ['fan-out-query', 'collect-hits', 'rank-by-score', 'render-results'], engines: ['cross-search'] },
      { name: 'trust-graph-update',      steps: ['observe-exchange', 'roll-weights', 'emit-graph-delta'], engines: ['trust-aggregator'] },
    ],
    acceptanceCriteria: [
      'Status strip shows enabled, instanceId, peer count, pending posts',
      'Peers tab probes / registers / removes peers with last-seen timestamps',
      'Search tab fans across instances and lets the operator scope local vs remote',
      'Sync tab triggers /api/federation/sync and persists a peer-event artifact per pass',
      'Trust graph rendered on the Network tab',
      'Probe + register + sync events persist in lens-artifact runtime',
    ],
    status: 'in_progress',
  },

  // ── PHASE 27: Game ──────────────────────────────────────────────
  {
    order: 27,
    lensId: 'game',
    name: 'Game',
    rationale: 'Gamification engine. Adds progression, achievements, and quests to all lenses.',
    dependsOn: [1],
    incumbents: ['Habitica', 'Duolingo', 'Forest', 'Level.fyi'],
    artifacts: [
      { name: 'Profile', persistsWithoutDTU: true, storageDomain: 'game', requiredFields: ['id', 'userId', 'level', 'xp', 'stats'] },
      { name: 'Quest', persistsWithoutDTU: true, storageDomain: 'game', requiredFields: ['id', 'title', 'objectives', 'reward', 'status'] },
      { name: 'GameState', persistsWithoutDTU: true, storageDomain: 'game', requiredFields: ['id', 'profileId', 'activeQuests', 'inventory', 'updatedAt'] },
      { name: 'RewardEvent', persistsWithoutDTU: true, storageDomain: 'game', requiredFields: ['id', 'profileId', 'type', 'amount', 'source', 'awardedAt'] },
    ],
    engines: [
      { name: 'turn-resolver', description: 'Resolves game turns and applies outcomes', trigger: 'on_demand' },
      { name: 'balance-engine', description: 'Balances XP curves and reward rates', trigger: 'on_demand' },
      { name: 'simulator', description: 'Simulates quest outcomes', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'quest-complete-reward', steps: ['check-objectives', 'resolve-turn', 'award-xp', 'check-levelup', 'emit-reward'], engines: ['turn-resolver', 'balance-engine'] },
      { name: 'balance-cycle', steps: ['analyze-progression', 'simulate-curves', 'adjust-rates', 'publish-config'], engines: ['balance-engine', 'simulator'] },
    ],
    acceptanceCriteria: ['Profile artifact persists with full CRUD', 'Quest completion awards XP', 'Turn resolution applies outcomes', 'DTU exhaust for all game actions'],
    status: 'blocked',
  },
];

// ── Derived helpers ─────────────────────────────────────────────

/** Get all phases in execution order. */
export function getProductionPhases(): ProductionPhase[] {
  return [...PRODUCTIZATION_PHASES].sort((a, b) => a.order - b.order);
}

/** Get the current phase (first non-completed in order). */
export function getCurrentPhase(): ProductionPhase | undefined {
  return getProductionPhases().find(p => p.status !== 'completed');
}

/** Get a phase by lens ID. */
export function getPhaseByLens(lensId: string): ProductionPhase | undefined {
  return PRODUCTIZATION_PHASES.find(p => p.lensId === lensId);
}

/** Check if all dependencies for a phase are met. */
export function areDependenciesMet(phase: ProductionPhase): boolean {
  return phase.dependsOn.every(depOrder => {
    const dep = PRODUCTIZATION_PHASES.find(p => p.order === depOrder);
    return dep?.status === 'completed';
  });
}

/** Get the total artifact count across all phases. */
export function getTotalArtifactCount(): number {
  return PRODUCTIZATION_PHASES.reduce((sum, p) => sum + p.artifacts.length, 0);
}

/** Get the total engine count across all phases. */
export function getTotalEngineCount(): number {
  return PRODUCTIZATION_PHASES.reduce((sum, p) => sum + p.engines.length, 0);
}
