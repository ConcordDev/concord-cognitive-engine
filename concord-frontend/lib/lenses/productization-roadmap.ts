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

  // ── PHASE 27: Code ──────────────────────────────────────────────
  {
    order: 27,
    lensId: 'code',
    name: 'Code',
    rationale: 'Production-grade IDE in the browser. Monaco editor + multi-file project + multi-script-type (snippet/project/pipeline/notebook/algorithm/library) + DTU exhaust + execution + lint + diff + review. Rivals VS Code Web, GitHub Codespaces, and Replit.',
    dependsOn: [],
    incumbents: ['VS Code Web', 'GitHub Codespaces', 'Replit', 'CodeSandbox'],
    artifacts: [
      { name: 'File',       persistsWithoutDTU: true, storageDomain: 'code', requiredFields: ['id', 'name', 'language', 'content'] },
      { name: 'Snippet',    persistsWithoutDTU: true, storageDomain: 'code', requiredFields: ['id', 'name', 'language', 'content', 'scriptType'] },
      { name: 'Project',    persistsWithoutDTU: true, storageDomain: 'code', requiredFields: ['id', 'files', 'rootDir', 'createdAt'] },
      { name: 'Diff',       persistsWithoutDTU: true, storageDomain: 'code', requiredFields: ['id', 'fromSha', 'toSha', 'patch'] },
      { name: 'Review',     persistsWithoutDTU: true, storageDomain: 'code', requiredFields: ['id', 'projectId', 'reviewer', 'comments', 'status'] },
    ],
    engines: [
      { name: 'monaco-editor',   description: 'Browser-side syntax highlighting + LSP-lite IntelliSense', trigger: 'on_demand' },
      { name: 'lint-runner',     description: 'Runs configured linter against active file/project', trigger: 'on_demand' },
      { name: 'diff-engine',     description: 'Computes patch between two project snapshots', trigger: 'on_demand' },
      { name: 'execute-runner',  description: 'Sandboxed execution + stdout capture for snippets / pipelines', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'author-execute-package',  steps: ['edit', 'lint', 'execute', 'capture-output', 'package-as-dtu'], engines: ['monaco-editor', 'lint-runner', 'execute-runner'] },
      { name: 'review-cycle',            steps: ['snapshot-project', 'request-review', 'collect-comments', 'patch', 'merge'], engines: ['diff-engine'] },
      { name: 'pipeline-run',            steps: ['load-pipeline', 'validate-stages', 'execute-each', 'collect-artifacts', 'emit-dtu'], engines: ['execute-runner'] },
    ],
    acceptanceCriteria: [
      'Monaco editor with multi-tab + dirty-buffer state',
      'File-tree CRUD with drag-and-drop reorder',
      'Six script types (snippet / project / pipeline / notebook / algorithm / library)',
      'Real /api/lens/code persistence via useLensData',
      'Vision analyse button accepts screenshots of code',
      'DTU export of any file or project',
    ],
    status: 'in_progress',
  },

  // ── PHASE 28: Chat ──────────────────────────────────────────────
  {
    order: 28,
    lensId: 'chat',
    name: 'Chat',
    rationale: 'Production-grade conversational interface with branching, summarization, multi-thread merge, persona switching, and DTU citation. Rivals ChatGPT, Claude, and Gemini.',
    dependsOn: [],
    incumbents: ['ChatGPT', 'Claude.ai', 'Gemini', 'Poe'],
    artifacts: [
      { name: 'Conversation', persistsWithoutDTU: true, storageDomain: 'chat', requiredFields: ['id', 'title', 'messages', 'createdAt', 'updatedAt'] },
      { name: 'Message',      persistsWithoutDTU: true, storageDomain: 'chat', requiredFields: ['id', 'role', 'content', 'timestamp', 'conversationId'] },
      { name: 'Session',      persistsWithoutDTU: true, storageDomain: 'chat', requiredFields: ['id', 'userId', 'persona', 'startedAt'] },
      { name: 'Branch',       persistsWithoutDTU: true, storageDomain: 'chat', requiredFields: ['id', 'parentMessageId', 'forkedAt'] },
    ],
    engines: [
      { name: 'streaming-completion', description: 'Streams token output from the conscious brain via WebSocket', trigger: 'on_demand' },
      { name: 'summarizer',           description: 'Compresses conversation tail into archived summary when SESSION_HISTORY cap nears', trigger: 'automatic' },
      { name: 'thread-merger',        description: 'Merges two conversation branches preserving lineage', trigger: 'on_demand' },
      { name: 'history-search',       description: 'Full-text + embedding search across conversation history', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'send-receive-cite',   steps: ['user-message', 'route-to-brain', 'stream-tokens', 'extract-citations', 'persist'], engines: ['streaming-completion'] },
      { name: 'branch-from-message', steps: ['fork-at-message', 'spawn-new-conversation', 'inherit-context'], engines: ['thread-merger'] },
      { name: 'export-transcript',   steps: ['load-conversation', 'render-format', 'attach-citations', 'package'], engines: [] },
    ],
    acceptanceCriteria: [
      'WebSocket streaming with tokens visible as generated',
      'Branch any message into a new conversation',
      'Search history with embedding similarity',
      'Persona switching mid-conversation',
      'Export to json / md / txt / pdf',
      'DTU citations inline in responses',
    ],
    status: 'in_progress',
  },

  // ── PHASE 29: Healthcare ────────────────────────────────────────
  {
    order: 29,
    lensId: 'healthcare',
    name: 'Healthcare',
    rationale: 'Production-grade EHR-shape. Patient record + encounter + protocol + interaction check + risk flagging + discharge package. Rivals Epic + Cerner with FHIR import/export and HL7 v2 messaging.',
    dependsOn: [],
    incumbents: ['Epic', 'Cerner', 'AthenaHealth', 'OpenEMR'],
    artifacts: [
      { name: 'Patient',        persistsWithoutDTU: true, storageDomain: 'healthcare', requiredFields: ['id', 'name', 'dob', 'allergies', 'history'] },
      { name: 'Encounter',      persistsWithoutDTU: true, storageDomain: 'healthcare', requiredFields: ['id', 'patientId', 'date', 'kind', 'notes'] },
      { name: 'CareProtocol',   persistsWithoutDTU: true, storageDomain: 'healthcare', requiredFields: ['id', 'condition', 'steps', 'evidence'] },
      { name: 'Prescription',   persistsWithoutDTU: true, storageDomain: 'healthcare', requiredFields: ['id', 'patientId', 'drug', 'dose', 'duration'] },
      { name: 'LabResult',      persistsWithoutDTU: true, storageDomain: 'healthcare', requiredFields: ['id', 'patientId', 'analyte', 'value', 'units'] },
    ],
    engines: [
      { name: 'interaction-checker', description: 'Cross-references active prescriptions for known interactions', trigger: 'automatic' },
      { name: 'protocol-matcher',    description: 'Matches a presentation to evidence-graded care protocols', trigger: 'on_demand' },
      { name: 'risk-flagger',        description: 'Scans labs + history for risk signals (sepsis, cardiac, oncology)', trigger: 'automatic' },
      { name: 'fhir-bridge',         description: 'Imports / exports artifacts in FHIR R4 / HL7 v2 envelopes', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'intake-flag-protocol',    steps: ['intake', 'check-interactions', 'flag-risk', 'match-protocol', 'emit-care-plan'], engines: ['interaction-checker', 'risk-flagger', 'protocol-matcher'] },
      { name: 'lab-import-trend',        steps: ['fhir-import', 'normalize', 'trend-vs-baseline', 'flag-out-of-range'], engines: ['fhir-bridge', 'risk-flagger'] },
      { name: 'discharge-package',       steps: ['summarize-encounter', 'attach-prescriptions', 'attach-instructions', 'export-pdf-fhir'], engines: ['fhir-bridge'] },
    ],
    acceptanceCriteria: [
      'Patient record persists with full CRUD',
      'Drug-interaction check fires on prescription add',
      'Lab import accepts FHIR R4',
      'Discharge package exports PDF + FHIR',
      'Protocol-match returns evidence-graded recommendations',
    ],
    status: 'in_progress',
  },

  // ── PHASE 30: Legal ─────────────────────────────────────────────
  {
    order: 30,
    lensId: 'legal',
    name: 'Legal',
    rationale: 'Production-grade matter management with clause checker, citation packager, deadline calendar, conflict check, and brief export. Rivals Clio + LexisNexis + Westlaw.',
    dependsOn: [],
    incumbents: ['Clio', 'LexisNexis', 'Westlaw', 'PracticePanther'],
    artifacts: [
      { name: 'Case',           persistsWithoutDTU: true, storageDomain: 'legal', requiredFields: ['id', 'caption', 'jurisdiction', 'parties', 'status'] },
      { name: 'Contract',       persistsWithoutDTU: true, storageDomain: 'legal', requiredFields: ['id', 'title', 'parties', 'clauses', 'effectiveDate'] },
      { name: 'ComplianceItem', persistsWithoutDTU: true, storageDomain: 'legal', requiredFields: ['id', 'title', 'jurisdiction', 'status', 'dueDate'] },
      { name: 'BriefBundle',    persistsWithoutDTU: true, storageDomain: 'legal', requiredFields: ['id', 'caseId', 'sections', 'citations'] },
    ],
    engines: [
      { name: 'deadline-watcher',    description: 'Tracks filing deadlines + sends warnings 48h / 24h / 4h before', trigger: 'automatic' },
      { name: 'clause-checker',      description: 'Compares contract clauses against firm template + flags drift', trigger: 'on_demand' },
      { name: 'citation-packager',   description: 'Bundles cited authorities with hyperlinked Bluebook formatting', trigger: 'on_demand' },
      { name: 'conflict-check',      description: 'Cross-references new matter against current + closed cases', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'matter-intake-cycle',    steps: ['intake', 'conflict-check', 'open-matter', 'attach-template'], engines: ['conflict-check'] },
      { name: 'contract-review',        steps: ['ingest', 'clause-by-clause', 'flag-drift', 'redline-export'], engines: ['clause-checker'] },
      { name: 'brief-package',          steps: ['compose', 'attach-citations', 'bluebook-format', 'export-pdf-docx'], engines: ['citation-packager'] },
    ],
    acceptanceCriteria: [
      'Case + contract + compliance item CRUD',
      'Deadline watcher fires alerts at 48h / 24h / 4h windows',
      'Clause checker compares against firm template',
      'Brief bundle exports to PDF + DOCX with Bluebook citations',
    ],
    status: 'in_progress',
  },

  // ── PHASE 31: Accounting ────────────────────────────────────────
  {
    order: 31,
    lensId: 'accounting',
    name: 'Accounting',
    rationale: 'Production-grade general ledger + AP/AR + payroll + tax engine. Rivals QuickBooks + Xero + Wave with KPI strip rival-shape.',
    dependsOn: [],
    incumbents: ['QuickBooks', 'Xero', 'Wave', 'FreshBooks'],
    artifacts: [
      { name: 'Account',        persistsWithoutDTU: true, storageDomain: 'accounting', requiredFields: ['id', 'name', 'type', 'parentId'] },
      { name: 'Transaction',    persistsWithoutDTU: true, storageDomain: 'accounting', requiredFields: ['id', 'date', 'debits', 'credits', 'memo'] },
      { name: 'Invoice',        persistsWithoutDTU: true, storageDomain: 'accounting', requiredFields: ['id', 'customerId', 'lineItems', 'total', 'status'] },
      { name: 'Reconciliation', persistsWithoutDTU: true, storageDomain: 'accounting', requiredFields: ['id', 'accountId', 'period', 'matched', 'discrepancies'] },
    ],
    engines: [
      { name: 'trial-balance',     description: 'Walks every account and asserts debits === credits', trigger: 'on_demand' },
      { name: 'reconciler',        description: 'Matches statement lines against ledger transactions', trigger: 'on_demand' },
      { name: 'tax-estimator',     description: 'Projects quarterly + annual tax liability from current ledger', trigger: 'on_demand' },
      { name: 'aging-analyzer',    description: 'Buckets receivables / payables by 30/60/90/120+ day windows', trigger: 'automatic' },
    ],
    pipelines: [
      { name: 'monthly-close',       steps: ['categorize', 'reconcile', 'trial-balance', 'p-and-l', 'export'], engines: ['reconciler', 'trial-balance'] },
      { name: 'invoice-collect',     steps: ['issue-invoice', 'send', 'track-aging', 'remind', 'reconcile-payment'], engines: ['aging-analyzer', 'reconciler'] },
      { name: 'tax-package',         steps: ['close-period', 'estimate', 'generate-1099', 'export-qbo'], engines: ['tax-estimator'] },
    ],
    acceptanceCriteria: [
      'Chart of accounts CRUD',
      'Double-entry transaction posting',
      'Trial balance + P&L + balance sheet exports',
      'Invoice aging report (30/60/90/120+)',
      'Reconciliation against bank statement',
    ],
    status: 'in_progress',
  },

  // ── PHASE 32: Ingest ────────────────────────────────────────────
  {
    order: 32,
    lensId: 'ingest',
    name: 'Ingest',
    rationale: 'Production-grade ETL workbench. Source connectors, transform pipelines, validation rules, batch scheduler. Rivals Airbyte + Fivetran + dbt.',
    dependsOn: [],
    incumbents: ['Airbyte', 'Fivetran', 'dbt', 'Stitch'],
    artifacts: [
      { name: 'Source',     persistsWithoutDTU: true, storageDomain: 'ingest', requiredFields: ['id', 'kind', 'config', 'schedule'] },
      { name: 'Pipeline',   persistsWithoutDTU: true, storageDomain: 'ingest', requiredFields: ['id', 'name', 'stages', 'sourceId'] },
      { name: 'Transform',  persistsWithoutDTU: true, storageDomain: 'ingest', requiredFields: ['id', 'pipelineId', 'kind', 'spec'] },
      { name: 'Validation', persistsWithoutDTU: true, storageDomain: 'ingest', requiredFields: ['id', 'pipelineId', 'rule', 'lastResult'] },
      { name: 'Batch',      persistsWithoutDTU: true, storageDomain: 'ingest', requiredFields: ['id', 'pipelineId', 'startedAt', 'finishedAt', 'rowsIn', 'rowsOut'] },
    ],
    engines: [
      { name: 'source-poller',     description: 'Polls source on schedule + emits raw rows', trigger: 'scheduled' },
      { name: 'transform-runner',  description: 'Executes transform stages in declared order', trigger: 'on_demand' },
      { name: 'validator',         description: 'Runs validation rules + raises a failed batch on violation', trigger: 'automatic' },
    ],
    pipelines: [
      { name: 'source-to-dtu',     steps: ['poll-source', 'transform', 'validate', 'persist', 'emit-dtu'], engines: ['source-poller', 'transform-runner', 'validator'] },
      { name: 'replay-batch',      steps: ['load-batch', 'rerun-transforms', 'compare-output', 'tag-drift'], engines: ['transform-runner'] },
    ],
    acceptanceCriteria: [
      'Source CRUD with multiple kinds (api / s3 / db / file)',
      'Pipeline with ordered transform stages',
      'Validation rules with on-fail policy',
      'Scheduler with cron-shape config',
      'Batch history with row counts in / out',
    ],
    status: 'in_progress',
  },

  // ── PHASE 33: Art ───────────────────────────────────────────────
  {
    order: 33,
    lensId: 'art',
    name: 'Art',
    rationale: 'Production-grade generative art workbench. Generate, remix, style-transfer, gallery, exhibition. Rivals Midjourney + DALL·E + Artbreeder + Layer.',
    dependsOn: [],
    incumbents: ['Midjourney', 'DALL·E', 'Artbreeder', 'Layer.ai'],
    artifacts: [
      { name: 'Artwork',    persistsWithoutDTU: true, storageDomain: 'art', requiredFields: ['id', 'title', 'image', 'prompt', 'createdAt'] },
      { name: 'Collection', persistsWithoutDTU: true, storageDomain: 'art', requiredFields: ['id', 'title', 'works', 'curator'] },
      { name: 'Style',      persistsWithoutDTU: true, storageDomain: 'art', requiredFields: ['id', 'name', 'reference', 'parameters'] },
      { name: 'Gallery',    persistsWithoutDTU: true, storageDomain: 'art', requiredFields: ['id', 'name', 'works', 'visibility'] },
      { name: 'Exhibition', persistsWithoutDTU: true, storageDomain: 'art', requiredFields: ['id', 'title', 'galleryId', 'openAt', 'closeAt'] },
    ],
    engines: [
      { name: 'generate',         description: 'Text → image via LLaVA-vision or external model', trigger: 'on_demand' },
      { name: 'style-transfer',   description: 'Applies a registered style to an existing artwork', trigger: 'on_demand' },
      { name: 'curator',          description: 'Composes a collection from a query against the gallery', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'generate-publish',   steps: ['prompt', 'generate', 'select', 'publish-to-gallery'], engines: ['generate'] },
      { name: 'remix-cycle',        steps: ['pick-source', 'pick-style', 'transfer', 'mint-derivative-dtu'], engines: ['style-transfer'] },
      { name: 'exhibition-cycle',   steps: ['curate', 'open', 'invite', 'close'], engines: ['curator'] },
    ],
    acceptanceCriteria: [
      'Artwork generation from prompt',
      'Style transfer between artworks',
      'Gallery + exhibition workflow',
      'PNG / SVG export',
      'Citation cascade on remix (royalties)',
    ],
    status: 'in_progress',
  },

  // ── PHASE 34: Podcast ───────────────────────────────────────────
  {
    order: 34,
    lensId: 'podcast',
    name: 'Podcast',
    rationale: 'Production-grade podcast publishing. Episode authoring, RSS generation, scheduling, transcription, listener analytics. Rivals Anchor + Buzzsprout + Transistor.',
    dependsOn: [],
    incumbents: ['Anchor', 'Buzzsprout', 'Transistor', 'Captivate'],
    artifacts: [
      { name: 'Episode',     persistsWithoutDTU: true, storageDomain: 'podcast', requiredFields: ['id', 'title', 'audioUrl', 'duration', 'publishedAt'] },
      { name: 'Subscriber',  persistsWithoutDTU: true, storageDomain: 'podcast', requiredFields: ['id', 'platform', 'subscribedAt'] },
      { name: 'Analytics',   persistsWithoutDTU: true, storageDomain: 'podcast', requiredFields: ['episodeId', 'listens', 'completion', 'geo'] },
      { name: 'Feed',        persistsWithoutDTU: true, storageDomain: 'podcast', requiredFields: ['id', 'title', 'rss', 'updatedAt'] },
    ],
    engines: [
      { name: 'rss-generator',    description: 'Renders the show feed as iTunes-compatible RSS 2.0', trigger: 'on_demand' },
      { name: 'transcriber',      description: 'Calls Whisper-equivalent for episode transcript', trigger: 'on_demand' },
      { name: 'distributor',      description: 'Pushes episode to configured directories (Apple, Spotify, etc.)', trigger: 'on_demand' },
      { name: 'analytics-roll',   description: 'Rolls listen events into per-episode + per-day buckets', trigger: 'automatic' },
    ],
    pipelines: [
      { name: 'episode-publish',   steps: ['upload-audio', 'transcribe', 'generate-show-notes', 'render-rss', 'distribute'], engines: ['transcriber', 'rss-generator', 'distributor'] },
      { name: 'analytics-cycle',   steps: ['ingest-events', 'roll-up', 'detect-trend', 'notify-creator'], engines: ['analytics-roll'] },
    ],
    acceptanceCriteria: [
      'Episode CRUD with audio upload',
      'RSS generation with iTunes tags',
      'Transcription pipeline',
      'Listener analytics roll-up',
      'Distribution to multiple platforms',
    ],
    status: 'in_progress',
  },

  // ── PHASE 35: DTUs ──────────────────────────────────────────────
  {
    order: 35,
    lensId: 'dtus',
    name: 'DTU Manager',
    rationale: 'Production-grade DTU management. Validate envelope hashes, walk lineage, register citations, audit consolidation. The substrate console for the whole platform.',
    dependsOn: [],
    incumbents: ['IPFS pinning UIs', 'Pinecone admin', 'Chroma admin'],
    artifacts: [
      { name: 'DTU',         persistsWithoutDTU: true,  storageDomain: 'dtus', requiredFields: ['id', 'kind', 'tier', 'creator_id', 'meta'] },
      { name: 'Validation',  persistsWithoutDTU: true,  storageDomain: 'dtus', requiredFields: ['id', 'dtuId', 'ok', 'reason', 'at'] },
      { name: 'Citation',    persistsWithoutDTU: true,  storageDomain: 'dtus', requiredFields: ['parentId', 'childId', 'kind', 'at'] },
      { name: 'Lineage',     persistsWithoutDTU: true,  storageDomain: 'dtus', requiredFields: ['rootId', 'depth', 'descendants'] },
      { name: 'Hash',        persistsWithoutDTU: true,  storageDomain: 'dtus', requiredFields: ['dtuId', 'algorithm', 'value'] },
    ],
    engines: [
      { name: 'envelope-validator',  description: 'Verifies SHA-256 content hash + DTU protocol envelope', trigger: 'on_demand' },
      { name: 'lineage-walker',      description: 'BFS through citations to compute lineage tree + projected royalty share', trigger: 'on_demand' },
      { name: 'consolidator',        description: 'Compresses regular DTUs into MEGA / HYPER tiers (33:1)', trigger: 'scheduled' },
    ],
    pipelines: [
      { name: 'import-validate-persist',  steps: ['receive-envelope', 'validate-hash', 'check-citations', 'persist'], engines: ['envelope-validator'] },
      { name: 'lineage-explore',          steps: ['select-root', 'walk-citations', 'project-royalties', 'render-tree'], engines: ['lineage-walker'] },
      { name: 'tier-consolidation',       steps: ['cluster', 'gap-promote', 'transfer-edges', 'demote-source'], engines: ['consolidator'] },
    ],
    acceptanceCriteria: [
      'DTU CRUD + envelope validation',
      'Citation walk with royalty projection',
      'Tier filter (regular / MEGA / HYPER)',
      'Hash verification button',
      'Consolidation history + audit trail',
    ],
    status: 'in_progress',
  },

  // ── PHASE 36: Trades ────────────────────────────────────────────
  {
    order: 36,
    lensId: 'trades',
    name: 'Trades & Construction',
    rationale: 'Production-grade jobsite management. Estimate, materials, permits, equipment, inspections, change-orders, safety. Rivals Buildertrend + JobNimbus + ServiceTitan.',
    dependsOn: [],
    incumbents: ['Buildertrend', 'JobNimbus', 'ServiceTitan', 'Procore'],
    artifacts: [
      { name: 'Job',           persistsWithoutDTU: true, storageDomain: 'trades', requiredFields: ['id', 'address', 'status', 'crewId'] },
      { name: 'Estimate',      persistsWithoutDTU: true, storageDomain: 'trades', requiredFields: ['id', 'jobId', 'lineItems', 'total'] },
      { name: 'MaterialsList', persistsWithoutDTU: true, storageDomain: 'trades', requiredFields: ['id', 'jobId', 'items', 'cost'] },
      { name: 'Permit',        persistsWithoutDTU: true, storageDomain: 'trades', requiredFields: ['id', 'jobId', 'jurisdiction', 'status'] },
      { name: 'Inspection',    persistsWithoutDTU: true, storageDomain: 'trades', requiredFields: ['id', 'jobId', 'inspector', 'result', 'date'] },
    ],
    engines: [
      { name: 'estimator',         description: 'Builds estimate from materials + labour rates + markup', trigger: 'on_demand' },
      { name: 'compliance-scanner', description: 'Cross-references work against jurisdiction code requirements', trigger: 'on_demand' },
      { name: 'photo-logger',      description: 'Stamps progress photos with GPS + timestamp + worker', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'estimate-to-permit',     steps: ['scope', 'estimate', 'pull-permits', 'order-materials'], engines: ['estimator', 'compliance-scanner'] },
      { name: 'inspection-cycle',       steps: ['schedule', 'pre-check', 'inspect', 'log-photos', 'close-or-remediate'], engines: ['compliance-scanner', 'photo-logger'] },
      { name: 'change-order-cycle',     steps: ['identify', 'estimate-delta', 'client-approve', 'amend-job'], engines: ['estimator'] },
    ],
    acceptanceCriteria: ['Job CRUD', 'Estimate generation', 'Permit + inspection log', 'Change-order workflow', 'Photo log with GPS'],
    status: 'in_progress',
  },

  // ── PHASE 37: Food ──────────────────────────────────────────────
  {
    order: 37,
    lensId: 'food',
    name: 'Food & Hospitality',
    rationale: 'Production-grade restaurant + kitchen ops. Recipe scaling, plate cost, allergen validation, shift scheduling, supplier comparison. Rivals Toast + Square for Restaurants + MarketMan.',
    dependsOn: [],
    incumbents: ['Toast', 'Square for Restaurants', 'MarketMan', 'Resy'],
    artifacts: [
      { name: 'Recipe',        persistsWithoutDTU: true, storageDomain: 'food', requiredFields: ['id', 'name', 'ingredients', 'yield', 'method'] },
      { name: 'Menu',          persistsWithoutDTU: true, storageDomain: 'food', requiredFields: ['id', 'name', 'items', 'effectiveDate'] },
      { name: 'InventoryItem', persistsWithoutDTU: true, storageDomain: 'food', requiredFields: ['id', 'sku', 'quantity', 'reorderPoint'] },
      { name: 'Booking',       persistsWithoutDTU: true, storageDomain: 'food', requiredFields: ['id', 'guestId', 'time', 'partySize'] },
      { name: 'Shift',         persistsWithoutDTU: true, storageDomain: 'food', requiredFields: ['id', 'staffId', 'role', 'start', 'end'] },
    ],
    engines: [
      { name: 'recipe-scaler',     description: 'Scales recipe yield up/down preserving ratios', trigger: 'on_demand' },
      { name: 'plate-coster',      description: 'Prices a plated dish from current inventory cost + waste %', trigger: 'on_demand' },
      { name: 'allergen-validator', description: 'Cross-checks recipe ingredients against guest allergens', trigger: 'automatic' },
      { name: 'shift-optimizer',    description: 'Builds shift schedule satisfying coverage + max-hours constraints', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'menu-engineer',       steps: ['cost-each-plate', 'tag-popularity', 'classify-stars-puzzles-plowhorses-dogs', 'recommend'], engines: ['plate-coster'] },
      { name: 'service-prep',        steps: ['load-bookings', 'forecast-covers', 'order-supplies', 'staff'], engines: ['shift-optimizer'] },
      { name: 'allergen-flow',       steps: ['intake-allergens', 'cross-check', 'flag-substitutions'], engines: ['allergen-validator'] },
    ],
    acceptanceCriteria: ['Recipe scaling', 'Plate cost from inventory', 'Allergen validation', 'Shift schedule with constraints', 'Supplier compare'],
    status: 'in_progress',
  },

  // ── PHASE 38: Retail ────────────────────────────────────────────
  {
    order: 38,
    lensId: 'retail',
    name: 'Retail & Commerce',
    rationale: 'Production-grade retail ops. Inventory forecasting, customer LTV, churn prediction, price optimization, promotion ROI. Rivals Shopify + Lightspeed + Vend.',
    dependsOn: [],
    incumbents: ['Shopify', 'Lightspeed', 'Vend', 'Square Retail'],
    artifacts: [
      { name: 'Product',   persistsWithoutDTU: true, storageDomain: 'retail', requiredFields: ['id', 'sku', 'name', 'price', 'stock'] },
      { name: 'Order',     persistsWithoutDTU: true, storageDomain: 'retail', requiredFields: ['id', 'customerId', 'lineItems', 'status'] },
      { name: 'Customer',  persistsWithoutDTU: true, storageDomain: 'retail', requiredFields: ['id', 'name', 'email', 'ltv'] },
      { name: 'Promotion', persistsWithoutDTU: true, storageDomain: 'retail', requiredFields: ['id', 'code', 'discount', 'startsAt', 'endsAt'] },
    ],
    engines: [
      { name: 'reorder-point-calc', description: 'Sets reorder point from rolling demand × lead time', trigger: 'automatic' },
      { name: 'ltv-projector',      description: 'Projects per-customer lifetime value from purchase history', trigger: 'automatic' },
      { name: 'price-optimizer',    description: 'Recommends price adjustments based on elasticity + competitor scrape', trigger: 'on_demand' },
      { name: 'churn-predictor',    description: 'Flags customers likely to churn within 30 days', trigger: 'automatic' },
    ],
    pipelines: [
      { name: 'reorder-cycle',          steps: ['observe-stock', 'forecast-demand', 'compute-reorder-point', 'place-order'], engines: ['reorder-point-calc'] },
      { name: 'promotion-evaluation',   steps: ['design-promo', 'launch', 'track-redemption', 'compute-roi', 'iterate'], engines: ['price-optimizer'] },
      { name: 'churn-rescue',           steps: ['flag-at-risk', 'segment-by-value', 'send-offer', 'measure-recovery'], engines: ['churn-predictor', 'ltv-projector'] },
    ],
    acceptanceCriteria: ['Product CRUD with stock', 'Order pipeline', 'Customer LTV', 'Promotion ROI', 'Reorder forecasting'],
    status: 'in_progress',
  },

  // ── PHASE 39: Household ─────────────────────────────────────────
  {
    order: 39,
    lensId: 'household',
    name: 'Home & Family',
    rationale: 'Production-grade household manager. Meal planning, chore rotation, maintenance schedule, family budget, emergency contacts. Rivals OurHome + Cozi + AnyList.',
    dependsOn: [],
    incumbents: ['OurHome', 'Cozi', 'AnyList', 'Notion families'],
    artifacts: [
      { name: 'FamilyMember',   persistsWithoutDTU: true, storageDomain: 'household', requiredFields: ['id', 'name', 'role', 'allergies'] },
      { name: 'MealPlan',       persistsWithoutDTU: true, storageDomain: 'household', requiredFields: ['id', 'weekOf', 'days'] },
      { name: 'Chore',          persistsWithoutDTU: true, storageDomain: 'household', requiredFields: ['id', 'title', 'rotation', 'assignedTo'] },
      { name: 'MaintenanceItem', persistsWithoutDTU: true, storageDomain: 'household', requiredFields: ['id', 'asset', 'cadence', 'lastDone', 'nextDue'] },
      { name: 'Budget',         persistsWithoutDTU: true, storageDomain: 'household', requiredFields: ['id', 'category', 'monthly', 'spent'] },
    ],
    engines: [
      { name: 'meal-planner',       description: 'Builds 7-day meal plan honouring allergies + budget + leftovers', trigger: 'on_demand' },
      { name: 'chore-rotator',      description: 'Rotates chores across family members with fairness weighting', trigger: 'scheduled' },
      { name: 'maintenance-watcher', description: 'Computes next-due date from cadence; warns at 14d / 7d / 1d', trigger: 'automatic' },
    ],
    pipelines: [
      { name: 'weekly-meal-plan',   steps: ['inventory', 'plan-meals', 'generate-grocery-list', 'export-ics'], engines: ['meal-planner'] },
      { name: 'maintenance-cycle',  steps: ['scan-assets', 'find-due', 'remind', 'log-completion'], engines: ['maintenance-watcher'] },
      { name: 'chore-rotation',     steps: ['load-chores', 'rotate', 'notify', 'track-completion'], engines: ['chore-rotator'] },
    ],
    acceptanceCriteria: ['Family member roster', 'Meal plan with grocery list', 'Chore rotation', 'Maintenance schedule', 'Budget tracking'],
    status: 'in_progress',
  },

  // ── PHASE 40: Agriculture ───────────────────────────────────────
  {
    order: 40,
    lensId: 'agriculture',
    name: 'Agriculture & Farming',
    rationale: 'Production-grade farm management. Crop rotation, yield analysis, soil health, water scheduling, certification audit. Rivals Granular + Climate FieldView + AgriWebb.',
    dependsOn: [],
    incumbents: ['Granular', 'Climate FieldView', 'AgriWebb', 'Bushel'],
    artifacts: [
      { name: 'Field',     persistsWithoutDTU: true, storageDomain: 'agriculture', requiredFields: ['id', 'acres', 'geometry', 'soilType'] },
      { name: 'Crop',      persistsWithoutDTU: true, storageDomain: 'agriculture', requiredFields: ['id', 'fieldId', 'variety', 'plantedAt'] },
      { name: 'Animal',    persistsWithoutDTU: true, storageDomain: 'agriculture', requiredFields: ['id', 'tag', 'species', 'birthDate'] },
      { name: 'Harvest',   persistsWithoutDTU: true, storageDomain: 'agriculture', requiredFields: ['id', 'cropId', 'date', 'yield', 'quality'] },
      { name: 'SoilTest',  persistsWithoutDTU: true, storageDomain: 'agriculture', requiredFields: ['id', 'fieldId', 'date', 'pH', 'NPK'] },
    ],
    engines: [
      { name: 'rotation-planner',    description: 'Suggests crop rotation honouring soil + market signals', trigger: 'on_demand' },
      { name: 'yield-analyzer',      description: 'Compares actual yield to forecast + field-level history', trigger: 'automatic' },
      { name: 'water-scheduler',     description: 'Optimises irrigation against soil moisture + weather forecast', trigger: 'scheduled' },
      { name: 'certification-auditor', description: 'Walks the audit checklist for organic / GAP / FairTrade', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'plant-to-harvest',   steps: ['rotate', 'plant', 'monitor', 'harvest', 'analyze-yield'], engines: ['rotation-planner', 'yield-analyzer'] },
      { name: 'soil-health-cycle',  steps: ['test', 'amend', 'retest', 'recommend'], engines: ['rotation-planner'] },
      { name: 'cert-audit',         steps: ['intake', 'walk-checklist', 'flag-gaps', 'package'], engines: ['certification-auditor'] },
    ],
    acceptanceCriteria: ['Field + crop CRUD', 'Yield tracking vs forecast', 'Soil test history', 'Water schedule with weather hook', 'Certification audit pack'],
    status: 'in_progress',
  },

  // ── PHASE 41: Logistics ─────────────────────────────────────────
  {
    order: 41,
    lensId: 'logistics',
    name: 'Transportation & Logistics',
    rationale: 'Production-grade fleet + route ops. HOS compliance, route optimisation, ETA, load planning, EDI manifest. Rivals Samsara + KeepTruckin + Project44.',
    dependsOn: [],
    incumbents: ['Samsara', 'KeepTruckin', 'Project44', 'FleetComplete'],
    artifacts: [
      { name: 'Vehicle',    persistsWithoutDTU: true, storageDomain: 'logistics', requiredFields: ['id', 'plate', 'kind', 'odometer'] },
      { name: 'Driver',     persistsWithoutDTU: true, storageDomain: 'logistics', requiredFields: ['id', 'license', 'hosRemaining'] },
      { name: 'Shipment',   persistsWithoutDTU: true, storageDomain: 'logistics', requiredFields: ['id', 'origin', 'dest', 'status', 'eta'] },
      { name: 'Route',      persistsWithoutDTU: true, storageDomain: 'logistics', requiredFields: ['id', 'stops', 'estDuration'] },
      { name: 'Manifest',   persistsWithoutDTU: true, storageDomain: 'logistics', requiredFields: ['id', 'shipmentId', 'lineItems', 'sealNumber'] },
    ],
    engines: [
      { name: 'route-optimizer',  description: 'Re-orders stops to minimize duration + fuel', trigger: 'on_demand' },
      { name: 'hos-checker',      description: 'Verifies driver hours-of-service before dispatch', trigger: 'automatic' },
      { name: 'eta-calculator',   description: 'Recomputes ETA from current location + traffic', trigger: 'automatic' },
      { name: 'edi-bridge',       description: 'Translates manifest to / from EDI 204 / 214 / 990', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'plan-dispatch-deliver',   steps: ['load-orders', 'optimise-route', 'check-hos', 'dispatch', 'track', 'deliver'], engines: ['route-optimizer', 'hos-checker', 'eta-calculator'] },
      { name: 'compliance-report',       steps: ['ingest-events', 'compute-hos-utilisation', 'flag-violations', 'export'], engines: ['hos-checker'] },
    ],
    acceptanceCriteria: ['Vehicle + driver roster', 'Route optimisation', 'HOS compliance', 'ETA recompute', 'EDI manifest export'],
    status: 'in_progress',
  },

  // ── PHASE 42: Education ─────────────────────────────────────────
  {
    order: 42,
    lensId: 'education',
    name: 'Education',
    rationale: 'Production-grade SIS + LMS hybrid. Roster, gradebook, attendance, lesson plans, rubrics, parent reports. Rivals PowerSchool + Canvas + Schoology.',
    dependsOn: [],
    incumbents: ['PowerSchool', 'Canvas', 'Schoology', 'Google Classroom'],
    artifacts: [
      { name: 'Student',     persistsWithoutDTU: true, storageDomain: 'education', requiredFields: ['id', 'name', 'grade', 'guardian'] },
      { name: 'Course',      persistsWithoutDTU: true, storageDomain: 'education', requiredFields: ['id', 'title', 'teacher', 'period'] },
      { name: 'Assignment',  persistsWithoutDTU: true, storageDomain: 'education', requiredFields: ['id', 'courseId', 'title', 'dueDate', 'rubricId'] },
      { name: 'Grade',       persistsWithoutDTU: true, storageDomain: 'education', requiredFields: ['id', 'studentId', 'assignmentId', 'score'] },
      { name: 'Rubric',      persistsWithoutDTU: true, storageDomain: 'education', requiredFields: ['id', 'criteria', 'levels'] },
    ],
    engines: [
      { name: 'gradebook-engine',    description: 'Computes weighted grade from rubric + criteria scores', trigger: 'automatic' },
      { name: 'attendance-tracker',  description: 'Records per-period attendance + flags chronic absence', trigger: 'automatic' },
      { name: 'differentiator',      description: 'Suggests differentiated assignments by student level', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'assign-grade-report',  steps: ['author-assignment', 'attach-rubric', 'collect-submissions', 'grade', 'export-parent-report'], engines: ['gradebook-engine', 'differentiator'] },
      { name: 'attendance-cycle',     steps: ['take-attendance', 'aggregate', 'flag-chronic', 'notify-guardian'], engines: ['attendance-tracker'] },
    ],
    acceptanceCriteria: ['Roster + course CRUD', 'Gradebook with weighted rubrics', 'Attendance tracker', 'Parent report PDF', 'Differentiated lesson plan'],
    status: 'in_progress',
  },

  // ── PHASE 43: Fitness ───────────────────────────────────────────
  {
    order: 43,
    lensId: 'fitness',
    name: 'Fitness & Wellness',
    rationale: 'Production-grade trainer + studio platform. Programming, periodisation, body comp, injury risk, nutrition. Rivals MindBody + Trainerize + TrueCoach.',
    dependsOn: [],
    incumbents: ['MindBody', 'Trainerize', 'TrueCoach', 'MyFitnessPal Pro'],
    artifacts: [
      { name: 'Client',     persistsWithoutDTU: true, storageDomain: 'fitness', requiredFields: ['id', 'name', 'goals', 'level'] },
      { name: 'Program',    persistsWithoutDTU: true, storageDomain: 'fitness', requiredFields: ['id', 'clientId', 'weeks', 'phase'] },
      { name: 'Workout',    persistsWithoutDTU: true, storageDomain: 'fitness', requiredFields: ['id', 'programId', 'day', 'sets'] },
      { name: 'Assessment', persistsWithoutDTU: true, storageDomain: 'fitness', requiredFields: ['id', 'clientId', 'date', 'metrics'] },
    ],
    engines: [
      { name: 'periodiser',      description: 'Builds 4/8/12-week periodised program from goal + level', trigger: 'on_demand' },
      { name: 'body-comp-calc',  description: 'Tracks LBM / fat-mass / hydration over time', trigger: 'automatic' },
      { name: 'injury-screener', description: 'Flags movement-pattern asymmetry from FMS-style screening', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'design-track-adjust',  steps: ['intake', 'periodise', 'execute', 'reassess', 'adjust'], engines: ['periodiser', 'body-comp-calc'] },
      { name: 'screen-flag-prescribe', steps: ['screen', 'flag-asymmetry', 'prescribe-correctives'], engines: ['injury-screener'] },
    ],
    acceptanceCriteria: ['Client roster + goals', 'Periodised program', 'Workout CRUD', 'Assessment over time', 'Injury risk screening'],
    status: 'in_progress',
  },

  // ── PHASE 44: Creative ──────────────────────────────────────────
  {
    order: 44,
    lensId: 'creative',
    name: 'Creative Production',
    rationale: 'Production-grade creative-shop ops. Shoot list, asset organise, deliverable package, client proof + review. Rivals Frame.io + Wipster + Air.',
    dependsOn: [],
    incumbents: ['Frame.io', 'Wipster', 'Air', 'Adobe Workfront'],
    artifacts: [
      { name: 'Project',     persistsWithoutDTU: true, storageDomain: 'creative', requiredFields: ['id', 'title', 'client', 'status'] },
      { name: 'Shoot',       persistsWithoutDTU: true, storageDomain: 'creative', requiredFields: ['id', 'projectId', 'date', 'location'] },
      { name: 'Asset',       persistsWithoutDTU: true, storageDomain: 'creative', requiredFields: ['id', 'projectId', 'kind', 'url'] },
      { name: 'ClientProof', persistsWithoutDTU: true, storageDomain: 'creative', requiredFields: ['id', 'projectId', 'comments', 'status'] },
    ],
    engines: [
      { name: 'shotlist-generator', description: 'Builds shot list from script / brief + auto-checks coverage', trigger: 'on_demand' },
      { name: 'asset-organiser',    description: 'Auto-tags + folders assets by metadata + visual class', trigger: 'automatic' },
      { name: 'proof-router',       description: 'Routes proofs to clients with comment-by-timecode UI', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'brief-to-deliverable',  steps: ['intake-brief', 'shotlist', 'shoot', 'organise', 'deliver-proof', 'iterate'], engines: ['shotlist-generator', 'asset-organiser', 'proof-router'] },
      { name: 'client-review-cycle',   steps: ['publish-proof', 'collect-comments', 'compile-revisions', 'redeliver'], engines: ['proof-router'] },
    ],
    acceptanceCriteria: ['Project + shoot + asset CRUD', 'Shot list generation', 'Asset auto-organise', 'Client proof with comments', 'Deliverable package'],
    status: 'in_progress',
  },

  // ── PHASE 45: Manufacturing ─────────────────────────────────────
  {
    order: 45,
    lensId: 'manufacturing',
    name: 'Manufacturing',
    rationale: 'Production-grade shop-floor ops. Work order, BOM, OEE, quality control, predictive maintenance. Rivals Plex + Fishbowl + Katana.',
    dependsOn: [],
    incumbents: ['Plex', 'Fishbowl', 'Katana', 'NetSuite Manufacturing'],
    artifacts: [
      { name: 'WorkOrder',     persistsWithoutDTU: true, storageDomain: 'manufacturing', requiredFields: ['id', 'partId', 'qty', 'status', 'dueDate'] },
      { name: 'BOM',           persistsWithoutDTU: true, storageDomain: 'manufacturing', requiredFields: ['id', 'partId', 'components', 'cost'] },
      { name: 'QCInspection',  persistsWithoutDTU: true, storageDomain: 'manufacturing', requiredFields: ['id', 'workOrderId', 'inspector', 'pass'] },
      { name: 'Machine',       persistsWithoutDTU: true, storageDomain: 'manufacturing', requiredFields: ['id', 'name', 'oee', 'lastService'] },
    ],
    engines: [
      { name: 'oee-calculator',       description: 'Aggregates availability × performance × quality into OEE', trigger: 'automatic' },
      { name: 'maintenance-predictor', description: 'Predicts machine failure window from usage telemetry', trigger: 'automatic' },
      { name: 'capacity-planner',      description: 'Builds work-center load chart from open work orders', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'work-order-cycle',    steps: ['release-wo', 'consume-materials', 'execute', 'qc-inspect', 'close'], engines: ['oee-calculator'] },
      { name: 'predict-prevent',     steps: ['observe-telemetry', 'predict-failure', 'schedule-pm', 'execute-pm'], engines: ['maintenance-predictor'] },
      { name: 'capacity-plan',       steps: ['load-orders', 'group-by-workcenter', 'detect-bottleneck', 'rebalance'], engines: ['capacity-planner'] },
    ],
    acceptanceCriteria: ['Work order + BOM CRUD', 'OEE per machine', 'QC inspection log', 'Maintenance prediction', 'Capacity load chart'],
    status: 'in_progress',
  },

  // ── PHASE 46: Nonprofit ─────────────────────────────────────────
  {
    order: 46,
    lensId: 'nonprofit',
    name: 'Nonprofit & Community',
    rationale: 'Production-grade nonprofit ops. Donor retention, grant reporting, volunteer matching, impact metrics, tax receipts. Rivals Bloomerang + Salsa + DonorPerfect.',
    dependsOn: [],
    incumbents: ['Bloomerang', 'Salsa', 'DonorPerfect', 'Neon CRM'],
    artifacts: [
      { name: 'Donor',     persistsWithoutDTU: true, storageDomain: 'nonprofit', requiredFields: ['id', 'name', 'history', 'lifetimeGiving'] },
      { name: 'Grant',     persistsWithoutDTU: true, storageDomain: 'nonprofit', requiredFields: ['id', 'funder', 'amount', 'milestones'] },
      { name: 'Volunteer', persistsWithoutDTU: true, storageDomain: 'nonprofit', requiredFields: ['id', 'name', 'skills', 'availability'] },
      { name: 'Campaign',  persistsWithoutDTU: true, storageDomain: 'nonprofit', requiredFields: ['id', 'goal', 'raised', 'startsAt', 'endsAt'] },
    ],
    engines: [
      { name: 'donor-retention',  description: 'Computes per-donor retention probability', trigger: 'automatic' },
      { name: 'grant-reporter',   description: 'Builds milestone-by-milestone grant report', trigger: 'on_demand' },
      { name: 'impact-roller',    description: 'Aggregates per-program impact metrics', trigger: 'automatic' },
    ],
    pipelines: [
      { name: 'donor-rescue',      steps: ['flag-lapsed', 'segment', 'send-appeal', 'measure-recovery'], engines: ['donor-retention'] },
      { name: 'grant-cycle',       steps: ['apply', 'track-milestones', 'report', 'close'], engines: ['grant-reporter'] },
      { name: 'campaign-cycle',    steps: ['plan', 'launch', 'track-progress', 'report-impact'], engines: ['impact-roller'] },
    ],
    acceptanceCriteria: ['Donor + grant + volunteer CRUD', 'Retention scoring', 'Grant milestone reporting', 'Impact aggregation', 'Tax-receipt export'],
    status: 'in_progress',
  },

  // ── PHASE 47: Real Estate ───────────────────────────────────────
  {
    order: 47,
    lensId: 'realestate',
    name: 'Real Estate',
    rationale: 'Production-grade real-estate brokerage + investor toolkit. Cap rate, cash flow, comps, mortgage calc, vacancy. Rivals Buildium + AppFolio + Stessa.',
    dependsOn: [],
    incumbents: ['Buildium', 'AppFolio', 'Stessa', 'PropertyWare'],
    artifacts: [
      { name: 'Listing',     persistsWithoutDTU: true, storageDomain: 'realestate', requiredFields: ['id', 'address', 'price', 'beds', 'baths'] },
      { name: 'Showing',     persistsWithoutDTU: true, storageDomain: 'realestate', requiredFields: ['id', 'listingId', 'agentId', 'date'] },
      { name: 'Transaction', persistsWithoutDTU: true, storageDomain: 'realestate', requiredFields: ['id', 'listingId', 'closeDate', 'salePrice'] },
      { name: 'RentalUnit',  persistsWithoutDTU: true, storageDomain: 'realestate', requiredFields: ['id', 'address', 'rent', 'tenantId'] },
    ],
    engines: [
      { name: 'cap-rate-calc',    description: 'Computes cap rate from NOI / property value', trigger: 'on_demand' },
      { name: 'cash-flow-engine', description: 'Projects cash flow from rent − expenses − debt service', trigger: 'on_demand' },
      { name: 'comps-aggregator', description: 'Pulls comparable sold listings within radius + filters', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'investment-analysis',  steps: ['ingest', 'estimate-noi', 'compute-cap-rate', 'project-cashflow', 'output-report'], engines: ['cap-rate-calc', 'cash-flow-engine'] },
      { name: 'closing-timeline',     steps: ['offer', 'inspection', 'appraisal', 'underwriting', 'close'], engines: [] },
      { name: 'comp-pull',            steps: ['select-subject', 'radius-search', 'filter', 'rank', 'export'], engines: ['comps-aggregator'] },
    ],
    acceptanceCriteria: ['Listing + transaction CRUD', 'Cap rate + cash flow projection', 'Closing timeline tracker', 'Rental unit roll', 'Comp aggregation'],
    status: 'in_progress',
  },

  // ── PHASE 48: Environment ───────────────────────────────────────
  {
    order: 48,
    lensId: 'environment',
    name: 'Environmental & Outdoors',
    rationale: 'Production-grade environmental management. Habitat assessment, species survey, compliance check, emissions calc, sample chain-of-custody. Rivals Ecocount + Survey123 + Trimble Forestry.',
    dependsOn: [],
    incumbents: ['Ecocount', 'ESRI Survey123', 'Trimble Forestry', 'Wildlife Insights'],
    artifacts: [
      { name: 'Site',                  persistsWithoutDTU: true, storageDomain: 'environment', requiredFields: ['id', 'geometry', 'classification'] },
      { name: 'Species',               persistsWithoutDTU: true, storageDomain: 'environment', requiredFields: ['id', 'taxonomy', 'status'] },
      { name: 'Survey',                persistsWithoutDTU: true, storageDomain: 'environment', requiredFields: ['id', 'siteId', 'date', 'observations'] },
      { name: 'EnvironmentalSample',   persistsWithoutDTU: true, storageDomain: 'environment', requiredFields: ['id', 'kind', 'collectedAt', 'chainOfCustody'] },
      { name: 'ComplianceRecord',      persistsWithoutDTU: true, storageDomain: 'environment', requiredFields: ['id', 'siteId', 'rule', 'status'] },
    ],
    engines: [
      { name: 'population-trend',  description: 'Tracks species count over time + flags decline', trigger: 'automatic' },
      { name: 'emissions-calc',    description: 'Computes scope-1/2/3 emissions from activity log', trigger: 'on_demand' },
      { name: 'habitat-assessor',  description: 'Scores habitat quality from indicator-species presence', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'survey-to-trend',    steps: ['plan-survey', 'collect', 'enter-observations', 'compute-trend'], engines: ['population-trend'] },
      { name: 'sample-chain',       steps: ['collect', 'label', 'transport', 'lab-receipt', 'analyze', 'archive'], engines: [] },
      { name: 'compliance-cycle',   steps: ['load-rules', 'check-each', 'flag-violations', 'export-report'], engines: ['emissions-calc'] },
    ],
    acceptanceCriteria: ['Site + species + survey CRUD', 'Population trend chart', 'Sample chain-of-custody', 'Emissions calc', 'Compliance report (PDF/GeoJSON)'],
    status: 'in_progress',
  },

  // ── PHASE 49: Government ────────────────────────────────────────
  {
    order: 49,
    lensId: 'government',
    name: 'Government & Public Service',
    rationale: 'Production-grade municipal + agency platform. Permit timeline, FOIA processing, ordinance package, public notice generation. Rivals OpenGov + Tyler Technologies + Granicus.',
    dependsOn: [],
    incumbents: ['OpenGov', 'Tyler Technologies', 'Granicus', 'CivicPlus'],
    artifacts: [
      { name: 'Permit',         persistsWithoutDTU: true, storageDomain: 'government', requiredFields: ['id', 'kind', 'applicant', 'status'] },
      { name: 'Project',        persistsWithoutDTU: true, storageDomain: 'government', requiredFields: ['id', 'title', 'budget', 'milestones'] },
      { name: 'Violation',      persistsWithoutDTU: true, storageDomain: 'government', requiredFields: ['id', 'subject', 'rule', 'status'] },
      { name: 'EmergencyPlan',  persistsWithoutDTU: true, storageDomain: 'government', requiredFields: ['id', 'kind', 'resources', 'roles'] },
      { name: 'Ordinance',      persistsWithoutDTU: true, storageDomain: 'government', requiredFields: ['id', 'number', 'text', 'enactedAt'] },
    ],
    engines: [
      { name: 'permit-timeline',     description: 'Walks the permit lifecycle and flags overdue stages', trigger: 'automatic' },
      { name: 'violation-escalator', description: 'Escalates violations through warning → fine → court referral', trigger: 'automatic' },
      { name: 'foia-processor',      description: 'Routes FOIA requests through retention + redaction', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'permit-cycle',         steps: ['apply', 'review', 'public-comment', 'decide', 'issue'], engines: ['permit-timeline'] },
      { name: 'enforcement-cycle',    steps: ['detect', 'warn', 'fine', 'refer-to-court'], engines: ['violation-escalator'] },
      { name: 'foia-cycle',           steps: ['receive', 'classify', 'redact', 'fulfill', 'archive'], engines: ['foia-processor'] },
    ],
    acceptanceCriteria: ['Permit + violation CRUD', 'FOIA flow with redaction', 'Ordinance package export', 'Public notice generation', 'Emergency plan staging'],
    status: 'in_progress',
  },

  // ── PHASE 50: Aviation ──────────────────────────────────────────
  {
    order: 50,
    lensId: 'aviation',
    name: 'Aviation & Maritime',
    rationale: 'Production-grade aircraft + vessel ops. Currency check, weight & balance, hobbs log, crew schedule. Rivals ForeFlight + Dock Master + Marine Traffic.',
    dependsOn: [],
    incumbents: ['ForeFlight', 'Dock Master', 'Marine Traffic', 'Garmin Pilot'],
    artifacts: [
      { name: 'Flight',       persistsWithoutDTU: true, storageDomain: 'aviation', requiredFields: ['id', 'aircraftId', 'route', 'status'] },
      { name: 'Aircraft',     persistsWithoutDTU: true, storageDomain: 'aviation', requiredFields: ['id', 'tail', 'kind', 'hobbs'] },
      { name: 'CrewMember',   persistsWithoutDTU: true, storageDomain: 'aviation', requiredFields: ['id', 'name', 'currency', 'ratings'] },
      { name: 'LogbookEntry', persistsWithoutDTU: true, storageDomain: 'aviation', requiredFields: ['id', 'pilotId', 'date', 'hours', 'route'] },
    ],
    engines: [
      { name: 'currency-checker',  description: 'Verifies pilot currency (recency, BFR, medical) before dispatch', trigger: 'automatic' },
      { name: 'weight-balance',    description: 'Computes weight & balance for the loaded aircraft', trigger: 'on_demand' },
      { name: 'maintenance-tracker', description: 'Tracks airworthiness directives + scheduled maintenance', trigger: 'automatic' },
    ],
    pipelines: [
      { name: 'preflight-cycle',   steps: ['weight-balance', 'currency-check', 'maintenance-clear', 'fuel-plan', 'release'], engines: ['weight-balance', 'currency-checker', 'maintenance-tracker'] },
      { name: 'logbook-cycle',     steps: ['capture-hobbs', 'log-route', 'auto-fill-totals', 'export-faa'], engines: [] },
    ],
    acceptanceCriteria: ['Aircraft + flight CRUD', 'Pilot currency check', 'Weight & balance calc', 'Logbook with hobbs', 'Maintenance ADs'],
    status: 'in_progress',
  },

  // ── PHASE 51: Events ────────────────────────────────────────────
  {
    order: 51,
    lensId: 'events',
    name: 'Events & Entertainment',
    rationale: 'Production-grade event ops. Advance sheet, settlement calc, run of show, ticket forecast, vendor compare. Rivals Eventbrite + Cvent + Master Tour.',
    dependsOn: [],
    incumbents: ['Eventbrite', 'Cvent', 'Master Tour', 'Universe'],
    artifacts: [
      { name: 'Event',           persistsWithoutDTU: true, storageDomain: 'events', requiredFields: ['id', 'title', 'venue', 'date'] },
      { name: 'Venue',           persistsWithoutDTU: true, storageDomain: 'events', requiredFields: ['id', 'name', 'capacity', 'address'] },
      { name: 'Performer',       persistsWithoutDTU: true, storageDomain: 'events', requiredFields: ['id', 'name', 'rider', 'fee'] },
      { name: 'SettlementRecord', persistsWithoutDTU: true, storageDomain: 'events', requiredFields: ['id', 'eventId', 'gross', 'expenses', 'net'] },
    ],
    engines: [
      { name: 'advance-sheet',  description: 'Builds day-of advance sheet from rider + venue + crew', trigger: 'on_demand' },
      { name: 'settlement-calc', description: 'Reconciles ticket gross − expenses − splits', trigger: 'on_demand' },
      { name: 'tech-rider-matcher', description: 'Validates venue meets rider requirements', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'plan-execute-settle', steps: ['book', 'advance', 'load-in', 'show', 'load-out', 'settle'], engines: ['advance-sheet', 'settlement-calc'] },
      { name: 'tour-package',         steps: ['route-cities', 'book-venues', 'tech-rider-match', 'publish'], engines: ['tech-rider-matcher'] },
    ],
    acceptanceCriteria: ['Event + venue + performer CRUD', 'Advance sheet generation', 'Settlement reconciliation', 'Run-of-show export', 'Tech rider match'],
    status: 'in_progress',
  },

  // ── PHASE 52: Science ───────────────────────────────────────────
  {
    order: 52,
    lensId: 'science',
    name: 'Science & Field Work',
    rationale: 'Production-grade research workbench. Expedition planning, sample chain, lab protocol, statistical test, peer-review package. Rivals LabArchives + Open Science Framework + Benchling.',
    dependsOn: [],
    incumbents: ['LabArchives', 'Open Science Framework', 'Benchling', 'LabKey'],
    artifacts: [
      { name: 'Expedition',  persistsWithoutDTU: true, storageDomain: 'science', requiredFields: ['id', 'team', 'dates', 'site'] },
      { name: 'Observation', persistsWithoutDTU: true, storageDomain: 'science', requiredFields: ['id', 'expeditionId', 'kind', 'value', 'at'] },
      { name: 'Sample',      persistsWithoutDTU: true, storageDomain: 'science', requiredFields: ['id', 'kind', 'collectedAt', 'chainOfCustody'] },
      { name: 'LabProtocol', persistsWithoutDTU: true, storageDomain: 'science', requiredFields: ['id', 'name', 'steps', 'version'] },
      { name: 'Dataset',     persistsWithoutDTU: true, storageDomain: 'science', requiredFields: ['id', 'rows', 'schema', 'license'] },
    ],
    engines: [
      { name: 'chain-of-custody', description: 'Maintains tamper-evident sample chain', trigger: 'automatic' },
      { name: 'replication-checker', description: 'Re-runs protocol against fresh sample', trigger: 'on_demand' },
      { name: 'statistical-engine', description: 'Runs registered tests (t / chi-sq / regression / ANOVA)', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'observe-analyze-publish', steps: ['plan', 'observe', 'sample', 'analyze', 'peer-review', 'publish'], engines: ['statistical-engine', 'replication-checker'] },
      { name: 'protocol-revision',        steps: ['author', 'pilot', 'collect-feedback', 'revise', 'publish'], engines: [] },
    ],
    acceptanceCriteria: ['Expedition + observation CRUD', 'Sample chain-of-custody', 'Protocol versioning', 'Statistical test runner', 'Peer-review package export'],
    status: 'in_progress',
  },

  // ── PHASE 53: Security ──────────────────────────────────────────
  {
    order: 53,
    lensId: 'security',
    name: 'Security',
    rationale: 'Production-grade physical + cyber security ops. Incident, patrol coverage, threat matrix, evidence chain, vulnerability scan. Rivals Splunk + Trackforce + Genetec.',
    dependsOn: [],
    incumbents: ['Splunk', 'Trackforce', 'Genetec', 'Resolver'],
    artifacts: [
      { name: 'Incident',          persistsWithoutDTU: true, storageDomain: 'security', requiredFields: ['id', 'kind', 'severity', 'status'] },
      { name: 'Patrol',            persistsWithoutDTU: true, storageDomain: 'security', requiredFields: ['id', 'route', 'guard', 'completedAt'] },
      { name: 'Threat',            persistsWithoutDTU: true, storageDomain: 'security', requiredFields: ['id', 'kind', 'severity', 'observedAt'] },
      { name: 'Investigation',     persistsWithoutDTU: true, storageDomain: 'security', requiredFields: ['id', 'incidentId', 'lead', 'status'] },
      { name: 'ComplianceReport',  persistsWithoutDTU: true, storageDomain: 'security', requiredFields: ['id', 'standard', 'gaps', 'date'] },
    ],
    engines: [
      { name: 'incident-trender',    description: 'Detects rising incident kinds + emits alert', trigger: 'automatic' },
      { name: 'patrol-coverage',     description: 'Validates that all checkpoints were hit on schedule', trigger: 'automatic' },
      { name: 'vulnerability-scanner', description: 'Runs nmap-style scan against asset inventory', trigger: 'scheduled' },
    ],
    pipelines: [
      { name: 'incident-cycle',     steps: ['report', 'classify', 'investigate', 'remediate', 'close'], engines: ['incident-trender'] },
      { name: 'patrol-cycle',       steps: ['plan', 'execute', 'verify-coverage', 'log-anomalies'], engines: ['patrol-coverage'] },
      { name: 'vuln-scan-cycle',    steps: ['enumerate', 'scan', 'rank', 'remediate', 'rescan'], engines: ['vulnerability-scanner'] },
    ],
    acceptanceCriteria: ['Incident + threat CRUD', 'Patrol coverage validation', 'Vulnerability scan history', 'Evidence chain', 'Compliance report (STIX export)'],
    status: 'in_progress',
  },

  // ── PHASE 54: Services ──────────────────────────────────────────
  {
    order: 54,
    lensId: 'services',
    name: 'Personal Services',
    rationale: 'Production-grade salon / studio / shop scheduler. Provider revenue, client retention, supply check, waitlist. Rivals Square Appointments + Vagaro + Booksy.',
    dependsOn: [],
    incumbents: ['Square Appointments', 'Vagaro', 'Booksy', 'Acuity'],
    artifacts: [
      { name: 'Client',       persistsWithoutDTU: true, storageDomain: 'services', requiredFields: ['id', 'name', 'preferences', 'history'] },
      { name: 'Appointment',  persistsWithoutDTU: true, storageDomain: 'services', requiredFields: ['id', 'clientId', 'providerId', 'serviceId', 'time'] },
      { name: 'ServiceType',  persistsWithoutDTU: true, storageDomain: 'services', requiredFields: ['id', 'name', 'duration', 'price'] },
      { name: 'Provider',     persistsWithoutDTU: true, storageDomain: 'services', requiredFields: ['id', 'name', 'specialties', 'schedule'] },
    ],
    engines: [
      { name: 'schedule-optimizer', description: 'Minimises gaps + maximises utilisation across providers', trigger: 'on_demand' },
      { name: 'reminder-sender',    description: 'Sends 48h / 24h / 4h SMS+email reminders', trigger: 'scheduled' },
      { name: 'retention-tracker',  description: 'Scores client repeat probability + flags lapses', trigger: 'automatic' },
    ],
    pipelines: [
      { name: 'book-confirm-fulfil',  steps: ['book', 'remind', 'execute', 'collect-feedback', 'rebook'], engines: ['schedule-optimizer', 'reminder-sender'] },
      { name: 'rescue-lapsed-clients', steps: ['flag-lapsed', 'segment', 'send-offer', 'measure'], engines: ['retention-tracker'] },
    ],
    acceptanceCriteria: ['Client + appointment CRUD', 'Schedule optimisation', 'Reminder cadence', 'Provider revenue report', 'Waitlist'],
    status: 'in_progress',
  },

  // ── PHASE 55: Insurance ─────────────────────────────────────────
  {
    order: 55,
    lensId: 'insurance',
    name: 'Insurance & Risk',
    rationale: 'Production-grade insurance ops. Coverage gap analysis, claim status, risk scoring, fraud indicators, ACORD export. Rivals Applied Epic + Vertafore + EZLynx.',
    dependsOn: [],
    incumbents: ['Applied Epic', 'Vertafore', 'EZLynx', 'AMS360'],
    artifacts: [
      { name: 'Policy',     persistsWithoutDTU: true, storageDomain: 'insurance', requiredFields: ['id', 'insured', 'coverage', 'premium', 'effectiveDate'] },
      { name: 'Claim',      persistsWithoutDTU: true, storageDomain: 'insurance', requiredFields: ['id', 'policyId', 'kind', 'amount', 'status'] },
      { name: 'Risk',       persistsWithoutDTU: true, storageDomain: 'insurance', requiredFields: ['id', 'kind', 'severity', 'factor'] },
      { name: 'Renewal',    persistsWithoutDTU: true, storageDomain: 'insurance', requiredFields: ['id', 'policyId', 'date', 'premium'] },
    ],
    engines: [
      { name: 'coverage-gap',     description: 'Compares portfolio against best-practice coverage matrix', trigger: 'on_demand' },
      { name: 'risk-scorer',      description: 'Scores risk from factors (location, history, occupancy)', trigger: 'automatic' },
      { name: 'fraud-detector',   description: 'Flags claims with patterns matching known fraud signatures', trigger: 'automatic' },
    ],
    pipelines: [
      { name: 'quote-bind-issue',     steps: ['gather-info', 'risk-score', 'quote', 'bind', 'issue'], engines: ['risk-scorer'] },
      { name: 'claim-cycle',          steps: ['fnol', 'investigate', 'reserve', 'pay-or-deny', 'close'], engines: ['fraud-detector'] },
      { name: 'renewal-cycle',        steps: ['notify', 'review-loss', 'requote', 'renew-or-non-renew'], engines: ['risk-scorer'] },
    ],
    acceptanceCriteria: ['Policy + claim CRUD', 'Coverage-gap analysis', 'Risk scoring', 'Fraud-pattern detector', 'ACORD export'],
    status: 'in_progress',
  },

  // ── PHASE 56: Home Improvement ──────────────────────────────────
  {
    order: 56,
    lensId: 'home-improvement',
    name: 'Home Improvement',
    rationale: 'Production-grade DIY + contractor coordination. Cost estimate, permit check, contractor compare, before/after gallery. Rivals Houzz + Angi + HomeAdvisor.',
    dependsOn: [],
    incumbents: ['Houzz', 'Angi', 'HomeAdvisor', 'Thumbtack'],
    artifacts: [
      { name: 'Project',    persistsWithoutDTU: true, storageDomain: 'home-improvement', requiredFields: ['id', 'name', 'scope', 'budget'] },
      { name: 'Material',   persistsWithoutDTU: true, storageDomain: 'home-improvement', requiredFields: ['id', 'projectId', 'name', 'qty', 'unitCost'] },
      { name: 'Contractor', persistsWithoutDTU: true, storageDomain: 'home-improvement', requiredFields: ['id', 'name', 'trade', 'rating'] },
      { name: 'Inspection', persistsWithoutDTU: true, storageDomain: 'home-improvement', requiredFields: ['id', 'projectId', 'inspector', 'pass'] },
    ],
    engines: [
      { name: 'cost-estimator',     description: 'Estimates project cost from materials + labour + region', trigger: 'on_demand' },
      { name: 'permit-checker',     description: 'Validates whether work requires a permit by jurisdiction', trigger: 'on_demand' },
      { name: 'contractor-compare', description: 'Ranks contractors by rating × proximity × bid', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'plan-bid-build',     steps: ['scope', 'estimate', 'permit-check', 'bid', 'select-contractor', 'execute'], engines: ['cost-estimator', 'permit-checker', 'contractor-compare'] },
      { name: 'before-after',       steps: ['photo-before', 'execute', 'photo-after', 'package'], engines: [] },
    ],
    acceptanceCriteria: ['Project + material CRUD', 'Cost estimate', 'Permit check', 'Contractor compare', 'Before/after gallery'],
    status: 'in_progress',
  },

  // ── PHASE 57: World ─────────────────────────────────────────────
  {
    order: 57,
    lensId: 'world',
    name: 'World (Concordia)',
    rationale: 'Production-grade 3D civilization simulator. The world lens is the front-door to Concordia — terrain, avatars, NPCs, factions, quests, combat, weather, day/night, mounted travel. Rivals BotW + Skyrim + EVE Online + No Man\'s Sky.',
    dependsOn: [],
    incumbents: ['Skyrim', 'BotW', 'No Man\'s Sky', 'EVE Online'],
    artifacts: [
      { name: 'World',           persistsWithoutDTU: true, storageDomain: 'world', requiredFields: ['id', 'name', 'rule_modulators', 'climate'] },
      { name: 'Avatar',          persistsWithoutDTU: true, storageDomain: 'world', requiredFields: ['id', 'userId', 'worldId', 'position', 'inventory'] },
      { name: 'NPC',             persistsWithoutDTU: true, storageDomain: 'world', requiredFields: ['id', 'archetype', 'factionId', 'position', 'state'] },
      { name: 'Faction',         persistsWithoutDTU: true, storageDomain: 'world', requiredFields: ['id', 'name', 'stance', 'momentum'] },
      { name: 'Quest',           persistsWithoutDTU: true, storageDomain: 'world', requiredFields: ['id', 'title', 'objectives', 'reward', 'status'] },
      { name: 'Mount',           persistsWithoutDTU: true, storageDomain: 'world', requiredFields: ['id', 'species', 'tame_state', 'gear'] },
    ],
    engines: [
      { name: 'governor-tick',         description: 'Drives the 15s heartbeat (42 modules) for every emergent system', trigger: 'scheduled' },
      { name: 'physics-world',         description: 'Rapier3D collision + character controller + height clamp', trigger: 'automatic' },
      { name: 'narrative-bridge',      description: 'Enriches LLM prompts with authored NPC + faction + lore context', trigger: 'on_demand' },
      { name: 'combat-resolver',       description: 'Server-validated combat with reach + damage caps + env amplification', trigger: 'on_demand' },
      { name: 'embodied-substrate',    description: 'Layers 7-13: signals, pain, dreams, predictions, factions, dialogue', trigger: 'automatic' },
    ],
    pipelines: [
      { name: 'enter-world-cycle',     steps: ['load-world', 'spawn-avatar', 'restore-inventory', 'apply-presence', 'render'], engines: ['physics-world'] },
      { name: 'combat-attack',         steps: ['validate-reach', 'cap-damage', 'apply-env-boost', 'apply-feedback', 'check-stagger', 'apply-stress'], engines: ['combat-resolver', 'embodied-substrate'] },
      { name: 'quest-cycle',           steps: ['propose', 'accept', 'breadcrumb', 'evaluate-objectives', 'realise-prediction', 'reward'], engines: ['narrative-bridge'] },
      { name: 'tick-emergent',         steps: ['heartbeat', 'route-modules', 'try-each', 'log-skipped', 'emit-metrics'], engines: ['governor-tick', 'embodied-substrate'] },
    ],
    acceptanceCriteria: [
      'Three.js render with terrain + avatars + IK',
      '/api/worlds/:worldId/combat/attack with anti-cheat',
      'NPC dialogue via narrative-bridge (no LLM secret leak)',
      'Quest engine with breadcrumb protocol',
      'Mount taming + riding + gear',
      'World event auto-generation',
      'Real-time presence + WebSocket fan-out',
    ],
    status: 'in_progress',
  },

  // ── PHASE 58: Analytics ─────────────────────────────────────────
  {
    order: 58,
    lensId: 'analytics',
    name: 'Analytics',
    rationale: 'Production-grade analytics workbench. Time-series, cohort, funnel, retention, segment, dashboard publish. Rivals Mixpanel + Amplitude + Looker.',
    dependsOn: [],
    incumbents: ['Mixpanel', 'Amplitude', 'Looker', 'Heap'],
    artifacts: [
      { name: 'Event',     persistsWithoutDTU: true, storageDomain: 'analytics', requiredFields: ['id', 'name', 'userId', 'props', 'timestamp'] },
      { name: 'Cohort',    persistsWithoutDTU: true, storageDomain: 'analytics', requiredFields: ['id', 'definition', 'population'] },
      { name: 'Funnel',    persistsWithoutDTU: true, storageDomain: 'analytics', requiredFields: ['id', 'steps', 'conversion'] },
      { name: 'Dashboard', persistsWithoutDTU: true, storageDomain: 'analytics', requiredFields: ['id', 'panels', 'sharedWith'] },
      { name: 'Segment',   persistsWithoutDTU: true, storageDomain: 'analytics', requiredFields: ['id', 'rule', 'lastEvaluated'] },
    ],
    engines: [
      { name: 'time-series-aggregator', description: 'Buckets events by minute / hour / day / week / month', trigger: 'on_demand' },
      { name: 'cohort-evaluator',       description: 'Computes retention curves for any cohort × event', trigger: 'on_demand' },
      { name: 'funnel-engine',          description: 'Computes step-by-step conversion + drop-off', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'event-to-dashboard',  steps: ['ingest', 'enrich', 'aggregate', 'render-panel', 'publish-dashboard'], engines: ['time-series-aggregator'] },
      { name: 'cohort-retention',    steps: ['define-cohort', 'compute-retention', 'render-curve', 'compare'], engines: ['cohort-evaluator'] },
      { name: 'funnel-analyze',      steps: ['define-funnel', 'eval-each-step', 'compute-conversion', 'render'], engines: ['funnel-engine'] },
    ],
    acceptanceCriteria: ['Event ingestion', 'Time-series aggregation', 'Cohort retention', 'Funnel conversion', 'Dashboard publish'],
    status: 'in_progress',
  },

  // ── PHASE 59: Wallet ────────────────────────────────────────────
  {
    order: 59,
    lensId: 'wallet',
    name: 'Wallet',
    rationale: 'Production-grade Concord Coin wallet. Balance, transaction history, royalty stream, withdrawal eligibility, tier badge. Rivals MetaMask + Phantom + Concord-native.',
    dependsOn: [],
    incumbents: ['MetaMask', 'Phantom', 'Trust Wallet', 'Stripe wallet'],
    artifacts: [
      { name: 'Balance',     persistsWithoutDTU: true, storageDomain: 'wallet', requiredFields: ['userId', 'balance', 'tier'] },
      { name: 'Transaction', persistsWithoutDTU: true, storageDomain: 'wallet', requiredFields: ['id', 'kind', 'amount', 'refId', 'at'] },
      { name: 'Token',       persistsWithoutDTU: true, storageDomain: 'wallet', requiredFields: ['id', 'symbol', 'amount', 'sourceTxId'] },
      { name: 'Address',     persistsWithoutDTU: true, storageDomain: 'wallet', requiredFields: ['id', 'kind', 'value', 'addedAt'] },
    ],
    engines: [
      { name: 'mint-coin',         description: 'Mints CC with idempotent refId (event_reward / royalty / purchase)', trigger: 'on_demand' },
      { name: 'withdraw-gate',     description: 'Filters credits by 48h hold gate', trigger: 'on_demand' },
      { name: 'royalty-stream',    description: 'Streams the per-tx royalty cascade for the wallet owner', trigger: 'automatic' },
    ],
    pipelines: [
      { name: 'mint-on-event',     steps: ['observe-event', 'idempotent-mint', 'update-balance', 'emit-realtime'], engines: ['mint-coin'] },
      { name: 'withdraw-cycle',    steps: ['load-credits', 'apply-48h-gate', 'aggregate-eligible', 'request', 'fulfil'], engines: ['withdraw-gate'] },
      { name: 'royalty-receipts',  steps: ['observe-cascade', 'mint-share', 'attribute-to-ancestor', 'log'], engines: ['royalty-stream', 'mint-coin'] },
    ],
    acceptanceCriteria: ['Balance + tier', 'Transaction history', 'Royalty stream display', '48h hold visibility', 'Idempotent mint'],
    status: 'in_progress',
  },

  // ── PHASE 60: App Maker ─────────────────────────────────────────
  {
    order: 60,
    lensId: 'app-maker',
    name: 'App Maker',
    rationale: 'Production-grade no-code app builder. Form, list, detail, action, deploy. Rivals Glide + Adalo + Bubble + Retool.',
    dependsOn: [],
    incumbents: ['Glide', 'Adalo', 'Bubble', 'Retool'],
    artifacts: [
      { name: 'App',        persistsWithoutDTU: true, storageDomain: 'app-maker', requiredFields: ['id', 'name', 'pages', 'datasource'] },
      { name: 'Page',       persistsWithoutDTU: true, storageDomain: 'app-maker', requiredFields: ['id', 'appId', 'kind', 'components'] },
      { name: 'Component',  persistsWithoutDTU: true, storageDomain: 'app-maker', requiredFields: ['id', 'pageId', 'kind', 'props'] },
      { name: 'Datasource', persistsWithoutDTU: true, storageDomain: 'app-maker', requiredFields: ['id', 'kind', 'connection', 'schema'] },
      { name: 'Deploy',     persistsWithoutDTU: true, storageDomain: 'app-maker', requiredFields: ['id', 'appId', 'environment', 'url', 'at'] },
    ],
    engines: [
      { name: 'page-renderer',     description: 'Renders a page schema to runnable React tree', trigger: 'on_demand' },
      { name: 'datasource-binder', description: 'Wires page components to live data via /api/lens/:domain', trigger: 'automatic' },
      { name: 'deployer',          description: 'Packages app + serves at a unique subroute', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'design-publish',    steps: ['design-page', 'bind-data', 'preview', 'deploy'], engines: ['page-renderer', 'datasource-binder', 'deployer'] },
      { name: 'iterate-cycle',     steps: ['load-version', 'edit', 'diff', 'redeploy'], engines: ['deployer'] },
    ],
    acceptanceCriteria: ['App + page CRUD', 'Datasource binding', 'Live preview', 'Deploy with unique URL', 'Version history'],
    status: 'in_progress',
  },

  // ── PHASE 61: Construction ──────────────────────────────────────
  {
    order: 61,
    lensId: 'construction',
    name: 'Construction',
    rationale: 'Production-grade construction PM. Project, schedule, RFI, submittal, punch list. Rivals Procore + Autodesk Construction Cloud + PlanGrid.',
    dependsOn: [],
    incumbents: ['Procore', 'Autodesk Construction Cloud', 'PlanGrid', 'CoConstruct'],
    artifacts: [
      { name: 'Project',    persistsWithoutDTU: true, storageDomain: 'construction', requiredFields: ['id', 'name', 'budget', 'completion'] },
      { name: 'Schedule',   persistsWithoutDTU: true, storageDomain: 'construction', requiredFields: ['id', 'projectId', 'tasks', 'dependencies'] },
      { name: 'RFI',        persistsWithoutDTU: true, storageDomain: 'construction', requiredFields: ['id', 'projectId', 'subject', 'response'] },
      { name: 'Submittal',  persistsWithoutDTU: true, storageDomain: 'construction', requiredFields: ['id', 'projectId', 'spec', 'status'] },
      { name: 'PunchItem',  persistsWithoutDTU: true, storageDomain: 'construction', requiredFields: ['id', 'projectId', 'description', 'status'] },
    ],
    engines: [
      { name: 'cpm-scheduler',  description: 'Critical-path schedule from task + dependency graph', trigger: 'on_demand' },
      { name: 'rfi-router',     description: 'Routes RFI to responsible party + tracks SLA', trigger: 'automatic' },
      { name: 'punch-list',     description: 'Tracks punch items + reopens on inspector return', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'project-cycle',     steps: ['plan', 'submit', 'execute', 'inspect', 'closeout'], engines: ['cpm-scheduler', 'rfi-router'] },
      { name: 'rfi-cycle',         steps: ['raise', 'route', 'respond', 'verify', 'close'], engines: ['rfi-router'] },
      { name: 'punch-list-cycle',  steps: ['walk', 'log-items', 'remediate', 'reinspect', 'close'], engines: ['punch-list'] },
    ],
    acceptanceCriteria: ['Project + schedule + RFI CRUD', 'CPM critical path', 'Submittal log', 'Punch list', 'Daily report export'],
    status: 'in_progress',
  },

  // ── PHASE 62: Engineering ───────────────────────────────────────
  {
    order: 62,
    lensId: 'engineering',
    name: 'Engineering',
    rationale: 'Production-grade engineering CAD/PLM. Drawing, BOM, change order, version, tolerance stack. Rivals SolidWorks PDM + Onshape + Fusion 360 Manage.',
    dependsOn: [],
    incumbents: ['SolidWorks PDM', 'Onshape', 'Fusion 360 Manage', 'Aras'],
    artifacts: [
      { name: 'Drawing',     persistsWithoutDTU: true, storageDomain: 'engineering', requiredFields: ['id', 'partId', 'revision', 'sheets'] },
      { name: 'BOM',         persistsWithoutDTU: true, storageDomain: 'engineering', requiredFields: ['id', 'partId', 'lines', 'version'] },
      { name: 'ChangeOrder', persistsWithoutDTU: true, storageDomain: 'engineering', requiredFields: ['id', 'subject', 'reason', 'status'] },
      { name: 'Tolerance',   persistsWithoutDTU: true, storageDomain: 'engineering', requiredFields: ['id', 'partId', 'feature', 'spec'] },
    ],
    engines: [
      { name: 'cad-renderer',         description: 'Renders STEP / IGES drawings in-browser', trigger: 'on_demand' },
      { name: 'change-router',        description: 'Routes ECO through review board with sign-off chain', trigger: 'automatic' },
      { name: 'tolerance-stack',      description: 'Computes worst-case + RSS tolerance stack-up', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'design-release',     steps: ['draft', 'review', 'approve', 'release-revision', 'ECO-stamp'], engines: ['change-router'] },
      { name: 'tolerance-analysis', steps: ['enumerate-features', 'apply-spec', 'stack', 'flag-violations'], engines: ['tolerance-stack'] },
    ],
    acceptanceCriteria: ['Drawing + BOM CRUD', 'Change order routing', 'Tolerance stack', 'Revision tracking', 'CAD render'],
    status: 'in_progress',
  },

  // ── PHASE 63: Geology ───────────────────────────────────────────
  {
    order: 63,
    lensId: 'geology',
    name: 'Geology',
    rationale: 'Production-grade geological survey + interpretation. Borehole, formation, fault, sample, cross-section. Rivals Leapfrog + Petrel + GeoStudio.',
    dependsOn: [],
    incumbents: ['Leapfrog', 'Petrel', 'GeoStudio', 'RockWorks'],
    artifacts: [
      { name: 'Borehole',     persistsWithoutDTU: true, storageDomain: 'geology', requiredFields: ['id', 'location', 'depth', 'log'] },
      { name: 'Formation',    persistsWithoutDTU: true, storageDomain: 'geology', requiredFields: ['id', 'name', 'age', 'lithology'] },
      { name: 'Fault',        persistsWithoutDTU: true, storageDomain: 'geology', requiredFields: ['id', 'kind', 'orientation', 'displacement'] },
      { name: 'CrossSection', persistsWithoutDTU: true, storageDomain: 'geology', requiredFields: ['id', 'azimuth', 'features'] },
    ],
    engines: [
      { name: 'log-correlator',    description: 'Correlates borehole logs across a transect', trigger: 'on_demand' },
      { name: 'volumetric-engine', description: 'Computes mineral / fluid volume estimates', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'survey-to-section',   steps: ['drill', 'log', 'correlate', 'render-section'], engines: ['log-correlator'] },
      { name: 'volumetric-estimate', steps: ['define-prospect', 'load-grid', 'integrate', 'report'], engines: ['volumetric-engine'] },
    ],
    acceptanceCriteria: ['Borehole + formation CRUD', 'Cross-section render', 'Volumetric estimate', 'Fault catalog', 'Geo-export'],
    status: 'in_progress',
  },

  // ── PHASE 64: HR ────────────────────────────────────────────────
  {
    order: 64,
    lensId: 'hr',
    name: 'HR',
    rationale: 'Production-grade HRIS. Roster, onboarding, time-off, performance, comp band, headcount plan. Rivals BambooHR + Gusto + Rippling.',
    dependsOn: [],
    incumbents: ['BambooHR', 'Gusto', 'Rippling', 'Workday'],
    artifacts: [
      { name: 'Employee',    persistsWithoutDTU: true, storageDomain: 'hr', requiredFields: ['id', 'name', 'role', 'department', 'startDate'] },
      { name: 'Onboarding',  persistsWithoutDTU: true, storageDomain: 'hr', requiredFields: ['id', 'employeeId', 'tasks', 'progress'] },
      { name: 'TimeOff',     persistsWithoutDTU: true, storageDomain: 'hr', requiredFields: ['id', 'employeeId', 'kind', 'start', 'end'] },
      { name: 'Performance', persistsWithoutDTU: true, storageDomain: 'hr', requiredFields: ['id', 'employeeId', 'cycle', 'rating'] },
      { name: 'CompBand',    persistsWithoutDTU: true, storageDomain: 'hr', requiredFields: ['id', 'role', 'level', 'min', 'max'] },
    ],
    engines: [
      { name: 'onboarding-tracker',  description: 'Tracks per-task onboarding completion', trigger: 'automatic' },
      { name: 'pto-accruer',         description: 'Accrues PTO per pay period + caps at policy', trigger: 'scheduled' },
      { name: 'comp-recommender',    description: 'Recommends comp adjustment from band + tenure + perf', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'onboarding-cycle',  steps: ['offer-accept', 'i9-everify', 'equipment', 'training', 'first-1-on-1'], engines: ['onboarding-tracker'] },
      { name: 'review-cycle',      steps: ['self-review', 'manager-review', 'calibration', 'comp-adjust', 'communicate'], engines: ['comp-recommender'] },
    ],
    acceptanceCriteria: ['Employee CRUD', 'Onboarding checklist', 'Time-off accrual', 'Performance cycle', 'Comp band'],
    status: 'in_progress',
  },

  // ── PHASE 65: Film Studios ──────────────────────────────────────
  {
    order: 65,
    lensId: 'film-studios',
    name: 'Film Studios',
    rationale: 'Production-grade film production. Script breakdown, schedule, cast/crew, dailies, post pipeline. Rivals Studio Binder + Movie Magic + StudioSuite.',
    dependsOn: [],
    incumbents: ['Studio Binder', 'Movie Magic', 'StudioSuite', 'Yamdu'],
    artifacts: [
      { name: 'Script',     persistsWithoutDTU: true, storageDomain: 'film-studios', requiredFields: ['id', 'title', 'scenes', 'version'] },
      { name: 'Breakdown',  persistsWithoutDTU: true, storageDomain: 'film-studios', requiredFields: ['id', 'scriptId', 'props', 'cast', 'fx'] },
      { name: 'Schedule',   persistsWithoutDTU: true, storageDomain: 'film-studios', requiredFields: ['id', 'scriptId', 'days', 'callSheet'] },
      { name: 'Daily',      persistsWithoutDTU: true, storageDomain: 'film-studios', requiredFields: ['id', 'date', 'shotsFilmed', 'notes'] },
    ],
    engines: [
      { name: 'breakdown-engine',  description: 'Auto-extracts elements from screenplay text', trigger: 'on_demand' },
      { name: 'stripboard',        description: 'Builds stripboard schedule from breakdown', trigger: 'on_demand' },
      { name: 'callsheet-builder', description: 'Generates day-of call sheet for cast + crew', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'pre-to-post',     steps: ['breakdown', 'schedule', 'shoot', 'log-dailies', 'editorial', 'finish'], engines: ['breakdown-engine', 'stripboard', 'callsheet-builder'] },
      { name: 'callsheet-cycle', steps: ['publish-day', 'distribute', 'collect-confirms', 'amend'], engines: ['callsheet-builder'] },
    ],
    acceptanceCriteria: ['Script breakdown', 'Stripboard schedule', 'Call sheet', 'Daily log', 'Post-pipeline'],
    status: 'in_progress',
  },

  // ── PHASE 66: Photography ───────────────────────────────────────
  {
    order: 66,
    lensId: 'photography',
    name: 'Photography',
    rationale: 'Production-grade photography studio. Shoot, gallery, client proof, deliverable, watermark. Rivals ShootProof + Pixieset + Pic-Time.',
    dependsOn: [],
    incumbents: ['ShootProof', 'Pixieset', 'Pic-Time', 'SmugMug Pro'],
    artifacts: [
      { name: 'Shoot',      persistsWithoutDTU: true, storageDomain: 'photography', requiredFields: ['id', 'client', 'date', 'location'] },
      { name: 'Gallery',    persistsWithoutDTU: true, storageDomain: 'photography', requiredFields: ['id', 'shootId', 'photos', 'visibility'] },
      { name: 'Proof',      persistsWithoutDTU: true, storageDomain: 'photography', requiredFields: ['id', 'galleryId', 'selected', 'comments'] },
      { name: 'Deliverable', persistsWithoutDTU: true, storageDomain: 'photography', requiredFields: ['id', 'galleryId', 'package', 'sentAt'] },
    ],
    engines: [
      { name: 'gallery-publisher',   description: 'Publishes gallery with optional watermark + download gating', trigger: 'on_demand' },
      { name: 'metadata-embedder',   description: 'Embeds IPTC + EXIF + copyright metadata into final deliverables', trigger: 'on_demand' },
      { name: 'auto-organiser',      description: 'Auto-groups photos by date + location + face cluster', trigger: 'automatic' },
    ],
    pipelines: [
      { name: 'shoot-to-deliver',  steps: ['shoot', 'cull', 'edit', 'gallery', 'proof', 'deliver'], engines: ['gallery-publisher', 'metadata-embedder'] },
      { name: 'proof-cycle',       steps: ['publish-proofs', 'collect-selects', 'finalise', 'deliver'], engines: ['gallery-publisher'] },
    ],
    acceptanceCriteria: ['Shoot + gallery CRUD', 'Proof flow', 'Watermark + download gate', 'Metadata embed', 'Deliverable package'],
    status: 'in_progress',
  },

  // ── PHASE 67: Atlas ─────────────────────────────────────────────
  {
    order: 67,
    lensId: 'atlas',
    name: 'Atlas',
    rationale: 'Production-grade map + GIS workbench. Layer, geocode, query, route, shape. Rivals ArcGIS Online + QGIS + Mapbox Studio.',
    dependsOn: [],
    incumbents: ['ArcGIS Online', 'QGIS', 'Mapbox Studio', 'Felt'],
    artifacts: [
      { name: 'Map',          persistsWithoutDTU: true, storageDomain: 'atlas', requiredFields: ['id', 'title', 'center', 'zoom', 'layers'] },
      { name: 'Layer',        persistsWithoutDTU: true, storageDomain: 'atlas', requiredFields: ['id', 'mapId', 'kind', 'data', 'style'] },
      { name: 'Feature',      persistsWithoutDTU: true, storageDomain: 'atlas', requiredFields: ['id', 'layerId', 'geometry', 'properties'] },
      { name: 'Route',        persistsWithoutDTU: true, storageDomain: 'atlas', requiredFields: ['id', 'from', 'to', 'geometry'] },
    ],
    engines: [
      { name: 'geocoder',       description: 'Resolves address text → coordinates', trigger: 'on_demand' },
      { name: 'router',         description: 'Computes turn-by-turn route between two points', trigger: 'on_demand' },
      { name: 'spatial-query',  description: 'Runs within / intersects / nearest queries against features', trigger: 'on_demand' },
    ],
    pipelines: [
      { name: 'map-publish',     steps: ['create-map', 'add-layers', 'style', 'publish'], engines: [] },
      { name: 'route-cycle',     steps: ['geocode-from', 'geocode-to', 'route', 'export-gpx'], engines: ['geocoder', 'router'] },
      { name: 'spatial-cycle',   steps: ['select-layer', 'query', 'render-results', 'export-geojson'], engines: ['spatial-query'] },
    ],
    acceptanceCriteria: ['Map + layer CRUD', 'Geocoding', 'Routing', 'Spatial query', 'GeoJSON / KML / SVG export'],
    status: 'in_progress',
  },

  // ── PHASE 68: Space ─────────────────────────────────────────────
  {
    order: 68,
    lensId: 'space',
    name: 'Space',
    rationale: 'Production-grade orbital + mission ops. Satellite, pass schedule, mission, telemetry. Rivals AGI STK + GMAT + Cosmos.',
    dependsOn: [],
    incumbents: ['AGI STK', 'GMAT', 'NASA Cosmos', 'Slingshot Aerospace'],
    artifacts: [
      { name: 'Satellite',  persistsWithoutDTU: true, storageDomain: 'space', requiredFields: ['id', 'name', 'tle', 'status'] },
      { name: 'Pass',       persistsWithoutDTU: true, storageDomain: 'space', requiredFields: ['id', 'satId', 'station', 'startsAt', 'endsAt'] },
      { name: 'Mission',    persistsWithoutDTU: true, storageDomain: 'space', requiredFields: ['id', 'name', 'objective', 'phase'] },
      { name: 'Telemetry',  persistsWithoutDTU: true, storageDomain: 'space', requiredFields: ['id', 'satId', 'channel', 'value', 'at'] },
    ],
    engines: [
      { name: 'orbit-propagator',  description: 'SGP4 propagates TLE to predicted position', trigger: 'on_demand' },
      { name: 'pass-predictor',    description: 'Predicts ground-station passes for next 7 days', trigger: 'on_demand' },
      { name: 'telemetry-decoder', description: 'Decodes raw telemetry per spacecraft schema', trigger: 'automatic' },
    ],
    pipelines: [
      { name: 'pass-schedule',     steps: ['load-tle', 'propagate', 'predict-passes', 'publish-schedule'], engines: ['orbit-propagator', 'pass-predictor'] },
      { name: 'telemetry-cycle',   steps: ['receive', 'decode', 'check-limits', 'alert'], engines: ['telemetry-decoder'] },
    ],
    acceptanceCriteria: ['Satellite + pass + telemetry CRUD', 'TLE → position', 'Pass prediction', 'Telemetry decode', 'Mission phase tracker'],
    status: 'in_progress',
  },

  // ── PHASE 69: Game ──────────────────────────────────────────────
  {
    order: 69,
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
