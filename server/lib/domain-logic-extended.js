// ── Extended Domain Rules — additional domains merged into DOMAIN_RULES at startup ──
// These are less common / specialized domains that extend the core set.

const EXTENDED_DOMAIN_RULES = new Map();

// === Data (Datasets & Data Science) ===
EXTENDED_DOMAIN_RULES.set("data", {
  types: ["dataset", "pipeline", "query", "report", "dashboard"],
  validStatuses: ["draft", "ingesting", "validated", "published", "deprecated", "archived"],
  transitions: {
    draft: ["ingesting", "archived"],
    ingesting: ["validated", "draft", "archived"],
    validated: ["published", "draft", "archived"],
    published: ["deprecated", "archived"],
    deprecated: ["archived"],
    archived: [],
  },
  requiredFields: { dataset: ["title"] },
  computedFields: (type, data) => {
    data.recordCount = data.recordCount || 0;
    data.fieldCount = (data.fields || data.columns || []).length;
    return data;
  },
  scoring: (type, data) => {
    const hasRecords = (data.recordCount || 0) > 0;
    const hasSchema = (data.fields || data.columns || []).length > 0;
    return Math.round(((hasRecords ? 0.4 : 0.1) + (hasSchema ? 0.3 : 0) + 0.1) * 100) / 100;
  },
});

// === Design (UI/UX) ===
EXTENDED_DOMAIN_RULES.set("design", {
  types: ["mockup", "prototype", "component", "system", "flow"],
  validStatuses: ["draft", "in-review", "approved", "implemented", "archived"],
  transitions: {
    draft: ["in-review", "archived"],
    "in-review": ["approved", "draft", "archived"],
    approved: ["implemented", "in-review", "archived"],
    implemented: ["archived"],
    archived: [],
  },
  requiredFields: { mockup: ["title"] },
  computedFields: (type, data) => {
    data.componentCount = (data.components || []).length;
    data.screenCount = (data.screens || []).length;
    return data;
  },
  scoring: (type, data) => {
    const screens = (data.screens || []).length;
    const components = (data.components || []).length;
    return Math.round((Math.min((screens + components) / 10, 1) * 0.6 + 0.2 + (data.approved ? 0.2 : 0)) * 100) / 100;
  },
});

// === Education ===
EXTENDED_DOMAIN_RULES.set("education", {
  types: ["course", "lesson", "quiz", "curriculum", "assessment"],
  validStatuses: ["draft", "review", "active", "completed", "archived"],
  transitions: {
    draft: ["review", "archived"],
    review: ["active", "draft", "archived"],
    active: ["completed", "review", "archived"],
    completed: ["archived"],
    archived: [],
  },
  requiredFields: { course: ["title"] },
  computedFields: (type, data) => {
    data.lessonCount = (data.lessons || []).length;
    data.questionCount = (data.questions || []).length;
    return data;
  },
  scoring: (type, data) => {
    const lessons = (data.lessons || []).length;
    const questions = (data.questions || []).length;
    return Math.round((Math.min(lessons / 10, 1) * 0.4 + Math.min(questions / 20, 1) * 0.3 + 0.1) * 100) / 100;
  },
});

// === Finance ===
EXTENDED_DOMAIN_RULES.set("finance", {
  types: ["ledger", "invoice", "forecast", "audit", "portfolio"],
  validStatuses: ["draft", "pending", "approved", "reconciled", "closed", "archived"],
  transitions: {
    draft: ["pending", "archived"],
    pending: ["approved", "draft", "archived"],
    approved: ["reconciled", "pending", "archived"],
    reconciled: ["closed", "archived"],
    closed: ["archived"],
    archived: [],
  },
  requiredFields: { invoice: ["title"] },
  computedFields: (type, data) => {
    const items = data.lineItems || data.items || [];
    data.lineItemCount = items.length;
    data.totalAmount = items.reduce((s, i) => s + (i.amount || i.cost || 0), 0);
    return data;
  },
  scoring: (type, data) => {
    const items = (data.lineItems || data.items || []).length;
    const hasTotal = (data.totalAmount || 0) > 0;
    return Math.round(((hasTotal ? 0.4 : 0.1) + Math.min(items / 10, 1) * 0.3 + 0.1) * 100) / 100;
  },
});

// === Health ===
EXTENDED_DOMAIN_RULES.set("health", {
  types: ["record", "observation", "plan", "report", "protocol"],
  validStatuses: ["draft", "active", "completed", "reviewed", "archived"],
  transitions: {
    draft: ["active", "archived"],
    active: ["completed", "draft", "archived"],
    completed: ["reviewed", "archived"],
    reviewed: ["archived"],
    archived: [],
  },
  requiredFields: { record: ["title"] },
  computedFields: (type, data) => {
    data.observationCount = (data.observations || []).length;
    return data;
  },
  scoring: (type, data) => {
    const observations = (data.observations || []).length;
    return Math.round((Math.min(observations / 10, 1) * 0.5 + 0.2 + (data.reviewed ? 0.2 : 0)) * 100) / 100;
  },
});

// === Project (Project Management) ===
EXTENDED_DOMAIN_RULES.set("project", {
  types: ["project", "epic", "task", "milestone", "sprint"],
  validStatuses: ["draft", "planned", "active", "blocked", "completed", "archived"],
  transitions: {
    draft: ["planned", "archived"],
    planned: ["active", "draft", "archived"],
    active: ["blocked", "completed", "archived"],
    blocked: ["active", "archived"],
    completed: ["archived"],
    archived: [],
  },
  requiredFields: { project: ["title"], task: ["title"] },
  computedFields: (type, data) => {
    const tasks = data.tasks || [];
    data.taskCount = tasks.length;
    data.completedTasks = tasks.filter(t => t.status === "completed" || t.done).length;
    data.progress = tasks.length > 0
      ? Math.round(data.completedTasks / tasks.length * 100)
      : 0;
    return data;
  },
  scoring: (type, data) => {
    const tasks = (data.tasks || []).length;
    const progress = (data.progress || 0) / 100;
    return Math.round((Math.min(tasks / 10, 1) * 0.3 + progress * 0.5 + 0.1) * 100) / 100;
  },
});

// === Crypto (Blockchain / Digital Assets) ===
EXTENDED_DOMAIN_RULES.set("crypto", {
  types: ["wallet", "portfolio", "transaction", "contract", "token"],
  validStatuses: ["draft", "pending", "confirmed", "active", "suspended", "archived"],
  transitions: {
    draft: ["pending", "archived"],
    pending: ["confirmed", "draft", "archived"],
    confirmed: ["active", "archived"],
    active: ["suspended", "archived"],
    suspended: ["active", "archived"],
    archived: [],
  },
  requiredFields: { wallet: ["title"] },
  computedFields: (type, data) => {
    data.holdingCount = (data.holdings || []).length;
    data.transactionCount = (data.transactions || []).length;
    data.totalValue = (data.holdings || []).reduce((s, h) => s + (h.amount || 0) * (h.priceUsd || 0), 0);
    return data;
  },
  scoring: (type, data) => {
    const holdings = (data.holdings || []).length;
    const hasAnalysis = !!data.lastAnalysis;
    return Math.round((Math.min(holdings / 5, 1) * 0.4 + (hasAnalysis ? 0.3 : 0) + 0.1) * 100) / 100;
  },
});

// === Code (Software Development) ===
EXTENDED_DOMAIN_RULES.set("code", {
  types: ["repository", "module", "package", "changeset", "review"],
  validStatuses: ["draft", "in-development", "in-review", "merged", "released", "archived"],
  transitions: {
    draft: ["in-development", "archived"],
    "in-development": ["in-review", "draft", "archived"],
    "in-review": ["merged", "in-development", "archived"],
    merged: ["released", "archived"],
    released: ["archived"],
    archived: [],
  },
  requiredFields: { repository: ["title"] },
  computedFields: (type, data) => {
    data.moduleCount = (data.modules || []).length;
    data.dependencyCount = (data.dependencies || []).length;
    return data;
  },
  scoring: (type, data) => {
    const modules = (data.modules || []).length;
    const hasAnalysis = !!data.lastComplexityAnalysis;
    const hasCoverage = !!(data.coverage && data.coverage.length > 0);
    return Math.round((Math.min(modules / 10, 1) * 0.3 + (hasAnalysis ? 0.3 : 0) + (hasCoverage ? 0.2 : 0) + 0.1) * 100) / 100;
  },
});

// === Math (Mathematics) ===
EXTENDED_DOMAIN_RULES.set("math", {
  types: ["proof", "computation", "dataset", "model", "formula"],
  validStatuses: ["draft", "computing", "verified", "published", "archived"],
  transitions: {
    draft: ["computing", "archived"],
    computing: ["verified", "draft", "archived"],
    verified: ["published", "computing", "archived"],
    published: ["archived"],
    archived: [],
  },
  requiredFields: {},
  computedFields: (type, data) => {
    data.hasRegression = !!data.regression;
    data.pointCount = (data.points || data.values || []).length;
    return data;
  },
  scoring: (type, data) => {
    const points = (data.points || data.values || []).length;
    const hasResult = !!data.regression || !!data.matrixA;
    return Math.round((Math.min(points / 20, 1) * 0.4 + (hasResult ? 0.4 : 0) + 0.1) * 100) / 100;
  },
});

// === Bio (Biology / Bioinformatics) ===
EXTENDED_DOMAIN_RULES.set("bio", {
  types: ["sequence", "experiment", "alignment", "expression", "phylogeny"],
  validStatuses: ["draft", "sequencing", "aligned", "analyzed", "published", "archived"],
  transitions: {
    draft: ["sequencing", "archived"],
    sequencing: ["aligned", "draft", "archived"],
    aligned: ["analyzed", "sequencing", "archived"],
    analyzed: ["published", "aligned", "archived"],
    published: ["archived"],
    archived: [],
  },
  requiredFields: { sequence: ["title"] },
  computedFields: (type, data) => {
    data.sequenceCount = (data.sequences || []).length;
    data.sampleCount = (data.samples || []).length;
    return data;
  },
  scoring: (type, data) => {
    const sequences = (data.sequences || []).length;
    const hasAnalysis = !!data.lastExpressionAnalysis;
    return Math.round((Math.min(sequences / 5, 1) * 0.4 + (hasAnalysis ? 0.3 : 0) + 0.1) * 100) / 100;
  },
});

// === Quantum (Quantum Computing) ===
EXTENDED_DOMAIN_RULES.set("quantum", {
  types: ["circuit", "algorithm", "experiment", "simulation", "error-model"],
  validStatuses: ["draft", "designing", "simulating", "verified", "deployed", "archived"],
  transitions: {
    draft: ["designing", "archived"],
    designing: ["simulating", "draft", "archived"],
    simulating: ["verified", "designing", "archived"],
    verified: ["deployed", "simulating", "archived"],
    deployed: ["archived"],
    archived: [],
  },
  requiredFields: { circuit: ["title"] },
  computedFields: (type, data) => {
    const circuit = data.circuit || {};
    data.qubitCount = circuit.qubits || 0;
    data.gateCount = (circuit.gates || []).length;
    return data;
  },
  scoring: (type, data) => {
    const circuit = data.circuit || {};
    const hasGates = (circuit.gates || []).length > 0;
    const hasSimulation = !!data.lastSimulation;
    return Math.round(((hasGates ? 0.4 : 0.1) + (hasSimulation ? 0.3 : 0) + 0.1) * 100) / 100;
  },
});

// === Art (Visual Art) ===
EXTENDED_DOMAIN_RULES.set("art", {
  types: ["painting", "illustration", "sculpture", "digital", "photography", "mixed-media"],
  validStatuses: ["draft", "in-progress", "critique", "exhibited", "sold", "archived"],
  transitions: {
    draft: ["in-progress", "archived"],
    "in-progress": ["critique", "draft", "archived"],
    critique: ["exhibited", "in-progress", "archived"],
    exhibited: ["sold", "archived"],
    sold: ["archived"],
    archived: [],
  },
  requiredFields: { painting: ["title"] },
  computedFields: (type, data) => {
    data.paletteSize = (data.palette || []).length;
    data.elementCount = (data.elements || []).length;
    return data;
  },
  scoring: (type, data) => {
    const palette = (data.palette || []).length;
    const elements = (data.elements || []).length;
    return Math.round((Math.min(palette / 5, 1) * 0.3 + Math.min(elements / 5, 1) * 0.3 + 0.1) * 100) / 100;
  },
});

// === Platform (Platform Engineering) ===
EXTENDED_DOMAIN_RULES.set("platform", {
  types: ["service", "infrastructure", "deployment", "incident", "runbook"],
  validStatuses: ["draft", "provisioning", "active", "degraded", "maintenance", "decommissioned", "archived"],
  transitions: {
    draft: ["provisioning", "archived"],
    provisioning: ["active", "draft", "archived"],
    active: ["degraded", "maintenance", "decommissioned"],
    degraded: ["active", "maintenance"],
    maintenance: ["active", "decommissioned"],
    decommissioned: ["archived"],
    archived: [],
  },
  requiredFields: { service: ["title"] },
  computedFields: (type, data) => {
    data.serviceCount = (data.services || []).length;
    data.incidentCount = (data.incidents || []).length;
    data.eventCount = (data.events || []).length;
    return data;
  },
  scoring: (type, data) => {
    const services = (data.services || []).length;
    const hasSlA = !!data.lastSlaReport;
    return Math.round((Math.min(services / 10, 1) * 0.3 + (hasSlA ? 0.4 : 0) + 0.1) * 100) / 100;
  },
});

// === Neuro (Neuroscience) ===
EXTENDED_DOMAIN_RULES.set("neuro", {
  types: ["recording", "experiment", "analysis", "model", "protocol"],
  validStatuses: ["draft", "recording", "processing", "analyzed", "published", "archived"],
  transitions: {
    draft: ["recording", "archived"],
    recording: ["processing", "draft", "archived"],
    processing: ["analyzed", "recording", "archived"],
    analyzed: ["published", "processing", "archived"],
    published: ["archived"],
    archived: [],
  },
  requiredFields: { recording: ["title"] },
  computedFields: (type, data) => {
    data.channelCount = (data.channels || []).length;
    data.epochCount = (data.epochs || []).length;
    return data;
  },
  scoring: (type, data) => {
    const channels = (data.channels || []).length;
    const epochs = (data.epochs || []).length;
    return Math.round((Math.min(channels / 8, 1) * 0.3 + Math.min(epochs / 20, 1) * 0.3 + 0.1) * 100) / 100;
  },
});

// === Physics ===
EXTENDED_DOMAIN_RULES.set("physics", {
  types: ["simulation", "experiment", "model", "problem-set", "derivation"],
  validStatuses: ["draft", "configuring", "running", "completed", "verified", "archived"],
  transitions: {
    draft: ["configuring", "archived"],
    configuring: ["running", "draft", "archived"],
    running: ["completed", "configuring"],
    completed: ["verified", "configuring", "archived"],
    verified: ["archived"],
    archived: [],
  },
  requiredFields: {},
  computedFields: (type, data) => {
    data.bodyCount = (data.bodies || []).length;
    data.hasOrbit = !!data.orbit || !!data.stateVector;
    return data;
  },
  scoring: (type, data) => {
    const hasBodies = (data.bodies || []).length > 0;
    const hasState = !!data.state || !!data.orbit;
    return Math.round(((hasBodies ? 0.4 : 0) + (hasState ? 0.3 : 0) + 0.1) * 100) / 100;
  },
});

// === Chemistry ===
EXTENDED_DOMAIN_RULES.set("chem", {
  types: ["compound", "reaction", "solution", "mixture", "analysis"],
  validStatuses: ["draft", "proposed", "balanced", "verified", "published", "archived"],
  transitions: {
    draft: ["proposed", "archived"],
    proposed: ["balanced", "draft", "archived"],
    balanced: ["verified", "proposed", "archived"],
    verified: ["published", "archived"],
    published: ["archived"],
    archived: [],
  },
  requiredFields: {},
  computedFields: (type, data) => {
    data.hasFormula = !!data.formula;
    data.standardCount = (data.standards || []).length;
    return data;
  },
  scoring: (type, data) => {
    const hasFormula = !!data.formula;
    const hasReaction = !!(data.reactants || data.products);
    return Math.round(((hasFormula ? 0.4 : 0) + (hasReaction ? 0.3 : 0) + 0.1) * 100) / 100;
  },
});

// === Hypothesis (Statistical Testing) ===
EXTENDED_DOMAIN_RULES.set("hypothesis", {
  types: ["test", "experiment", "ab-test", "inference", "power-analysis"],
  validStatuses: ["draft", "designing", "collecting", "analyzing", "concluded", "archived"],
  transitions: {
    draft: ["designing", "archived"],
    designing: ["collecting", "draft", "archived"],
    collecting: ["analyzing", "designing", "archived"],
    analyzing: ["concluded", "collecting", "archived"],
    concluded: ["archived"],
    archived: [],
  },
  requiredFields: {},
  computedFields: (type, data) => {
    data.hasSample = !!data.sample;
    data.hasResult = !!data.posterior || !!data.control;
    return data;
  },
  scoring: (type, data) => {
    const hasSample = !!data.sample;
    const hasResult = !!data.posterior;
    return Math.round(((hasSample ? 0.4 : 0) + (hasResult ? 0.3 : 0) + 0.1) * 100) / 100;
  },
});

// === Timeline (Temporal Analysis) ===
EXTENDED_DOMAIN_RULES.set("timeline", {
  types: ["project", "event-stream", "schedule", "gantt", "time-series"],
  validStatuses: ["draft", "planning", "active", "tracking", "completed", "archived"],
  transitions: {
    draft: ["planning", "archived"],
    planning: ["active", "draft", "archived"],
    active: ["tracking", "completed", "archived"],
    tracking: ["completed", "active", "archived"],
    completed: ["archived"],
    archived: [],
  },
  requiredFields: {},
  computedFields: (type, data) => {
    data.taskCount = (data.tasks || []).length;
    data.eventCount = (data.events || data.series || []).length;
    return data;
  },
  scoring: (type, data) => {
    const tasks = (data.tasks || []).length;
    const events = (data.events || data.series || []).length;
    return Math.round((Math.min((tasks + events) / 10, 1) * 0.6 + 0.1) * 100) / 100;
  },
});

// === Ethics ===
EXTENDED_DOMAIN_RULES.set("ethics", {
  types: ["assessment", "framework", "policy", "audit", "case-study"],
  validStatuses: ["draft", "under-review", "assessed", "approved", "archived"],
  transitions: {
    draft: ["under-review", "archived"],
    "under-review": ["assessed", "draft", "archived"],
    assessed: ["approved", "under-review", "archived"],
    approved: ["archived"],
    archived: [],
  },
  requiredFields: {},
  computedFields: (type, data) => {
    data.stakeholderCount = (data.stakeholders || []).length;
    data.hasAction = !!data.action;
    return data;
  },
  scoring: (type, data) => {
    const stakeholders = (data.stakeholders || []).length;
    const hasAction = !!data.action;
    return Math.round((Math.min(stakeholders / 5, 1) * 0.4 + (hasAction ? 0.3 : 0) + 0.1) * 100) / 100;
  },
});

// === Debug ===
EXTENDED_DOMAIN_RULES.set("debug", {
  types: ["session", "incident", "trace", "profile", "crash-report"],
  validStatuses: ["draft", "investigating", "root-caused", "fixed", "verified", "archived"],
  transitions: {
    draft: ["investigating", "archived"],
    investigating: ["root-caused", "draft", "archived"],
    "root-caused": ["fixed", "investigating", "archived"],
    fixed: ["verified", "archived"],
    verified: ["archived"],
    archived: [],
  },
  requiredFields: {},
  computedFields: (type, data) => {
    data.logCount = (data.logs || []).length;
    data.errorCount = (data.errors || []).length;
    data.traceCount = (data.traces || data.stackTraces || []).length;
    return data;
  },
  scoring: (type, data) => {
    const logs = (data.logs || []).length;
    const errors = (data.errors || []).length;
    return Math.round((Math.min((logs + errors) / 20, 1) * 0.5 + 0.1) * 100) / 100;
  },
});

// === Lab (Laboratory) ===
EXTENDED_DOMAIN_RULES.set("lab", {
  types: ["experiment", "assay", "calibration", "sample-batch", "protocol"],
  validStatuses: ["draft", "prepared", "running", "analyzing", "reported", "archived"],
  transitions: {
    draft: ["prepared", "archived"],
    prepared: ["running", "draft", "archived"],
    running: ["analyzing", "prepared", "archived"],
    analyzing: ["reported", "running", "archived"],
    reported: ["archived"],
    archived: [],
  },
  requiredFields: {},
  computedFields: (type, data) => {
    data.standardCount = (data.standards || []).length;
    data.sampleCount = (data.samples || []).length;
    data.controlCount = (data.controls || []).length;
    return data;
  },
  scoring: (type, data) => {
    const standards = (data.standards || []).length;
    const samples = (data.samples || []).length;
    const hasCalibration = !!data.calibration;
    return Math.round((Math.min(standards / 5, 1) * 0.3 + Math.min(samples / 10, 1) * 0.2 + (hasCalibration ? 0.3 : 0) + 0.1) * 100) / 100;
  },
});

// === Research ===
EXTENDED_DOMAIN_RULES.set("research", {
  types: ["study", "review", "meta-analysis", "proposal", "dataset"],
  validStatuses: ["draft", "in-progress", "peer-review", "published", "retracted", "archived"],
  transitions: {
    draft: ["in-progress", "archived"],
    "in-progress": ["peer-review", "draft", "archived"],
    "peer-review": ["published", "in-progress", "archived"],
    published: ["retracted", "archived"],
    retracted: ["archived"],
    archived: [],
  },
  requiredFields: { study: ["title"] },
  computedFields: (type, data) => {
    data.paperCount = (data.papers || []).length;
    data.hasMethodology = !!data.methodology;
    return data;
  },
  scoring: (type, data) => {
    const papers = (data.papers || []).length;
    const hasMeth = !!data.methodology;
    return Math.round((Math.min(papers / 10, 1) * 0.3 + (hasMeth ? 0.4 : 0) + 0.1) * 100) / 100;
  },
});

// === Admin ===
EXTENDED_DOMAIN_RULES.set("admin", {
  types: ["config", "policy", "audit-log", "user", "role"],
  validStatuses: ["draft", "active", "suspended", "archived"],
  transitions: { draft: ["active", "archived"], active: ["suspended", "archived"], suspended: ["active", "archived"], archived: [] },
  requiredFields: { policy: ["title"], role: ["title"] },
  computedFields: (type, data) => { data.entryCount = (data.entries || []).length; return data; },
  scoring: (type, data) => Math.round(((data.entries || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Affect ===
EXTENDED_DOMAIN_RULES.set("affect", {
  types: ["analysis", "timeline", "empathy-map", "mood-board"],
  validStatuses: ["draft", "analyzing", "complete", "archived"],
  transitions: { draft: ["analyzing", "archived"], analyzing: ["complete", "draft"], complete: ["archived"], archived: [] },
  requiredFields: { analysis: ["title"] },
  computedFields: (type, data) => { data.entryCount = (data.entries || data.texts || []).length; return data; },
  scoring: (type, data) => Math.round(((data.entries || data.texts || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Alliance ===
EXTENDED_DOMAIN_RULES.set("alliance", {
  types: ["partnership", "network", "assessment", "agreement"],
  validStatuses: ["proposed", "negotiating", "active", "dissolved", "archived"],
  transitions: { proposed: ["negotiating", "archived"], negotiating: ["active", "proposed", "archived"], active: ["dissolved", "archived"], dissolved: ["archived"], archived: [] },
  requiredFields: { partnership: ["title"] },
  computedFields: (type, data) => { data.partnerCount = (data.partners || []).length; return data; },
  scoring: (type, data) => Math.round(((data.partners || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Anon ===
EXTENDED_DOMAIN_RULES.set("anon", {
  types: ["dataset", "policy", "assessment", "report"],
  validStatuses: ["draft", "processing", "anonymized", "verified", "archived"],
  transitions: { draft: ["processing", "archived"], processing: ["anonymized", "draft"], anonymized: ["verified", "archived"], verified: ["archived"], archived: [] },
  requiredFields: { dataset: ["title"] },
  computedFields: (type, data) => { data.recordCount = (data.records || []).length; data.fieldCount = (data.fields || []).length; return data; },
  scoring: (type, data) => Math.round(((data.records || []).length > 0 ? 0.4 : 0.1) * 100) / 100,
});

// === App-Maker ===
EXTENDED_DOMAIN_RULES.set("app-maker", {
  types: ["app", "component", "screen", "workflow"],
  validStatuses: ["draft", "prototyping", "testing", "deployed", "archived"],
  transitions: { draft: ["prototyping", "archived"], prototyping: ["testing", "draft"], testing: ["deployed", "prototyping"], deployed: ["archived"], archived: [] },
  requiredFields: { app: ["title"] },
  computedFields: (type, data) => { data.componentCount = (data.components || []).length; return data; },
  scoring: (type, data) => Math.round(((data.components || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === AR ===
EXTENDED_DOMAIN_RULES.set("ar", {
  types: ["scene", "marker", "anchor", "overlay"],
  validStatuses: ["draft", "calibrating", "active", "archived"],
  transitions: { draft: ["calibrating", "archived"], calibrating: ["active", "draft"], active: ["archived"], archived: [] },
  requiredFields: { scene: ["title"] },
  computedFields: (type, data) => { data.objectCount = (data.objects || data.anchors || []).length; return data; },
  scoring: (type, data) => Math.round(((data.objects || data.anchors || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Attention ===
EXTENDED_DOMAIN_RULES.set("attention", {
  types: ["session", "budget", "report", "matrix"],
  validStatuses: ["draft", "active", "paused", "complete", "archived"],
  transitions: { draft: ["active", "archived"], active: ["paused", "complete"], paused: ["active", "archived"], complete: ["archived"], archived: [] },
  requiredFields: { session: ["title"] },
  computedFields: (type, data) => { data.taskCount = (data.tasks || []).length; return data; },
  scoring: (type, data) => Math.round(((data.tasks || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Audit ===
EXTENDED_DOMAIN_RULES.set("audit", {
  types: ["finding", "report", "checklist", "trail", "sample-plan"],
  validStatuses: ["draft", "in-progress", "review", "final", "archived"],
  transitions: { draft: ["in-progress", "archived"], "in-progress": ["review", "draft"], review: ["final", "in-progress"], final: ["archived"], archived: [] },
  requiredFields: { finding: ["title"], report: ["title"] },
  computedFields: (type, data) => { data.findingCount = (data.findings || data.rules || []).length; return data; },
  scoring: (type, data) => Math.round(((data.findings || data.rules || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Billing ===
EXTENDED_DOMAIN_RULES.set("billing", {
  types: ["invoice", "subscription", "payment", "report"],
  validStatuses: ["draft", "pending", "paid", "overdue", "cancelled", "archived"],
  transitions: { draft: ["pending", "archived"], pending: ["paid", "overdue", "cancelled"], paid: ["archived"], overdue: ["paid", "cancelled"], cancelled: ["archived"], archived: [] },
  requiredFields: { invoice: ["title"] },
  computedFields: (type, data) => { data.lineItemCount = (data.lineItems || data.items || []).length; return data; },
  scoring: (type, data) => Math.round(((data.lineItems || data.items || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Board ===
EXTENDED_DOMAIN_RULES.set("board", {
  types: ["board", "card", "column", "swimlane"],
  validStatuses: ["backlog", "todo", "in-progress", "review", "done", "archived"],
  transitions: { backlog: ["todo", "archived"], todo: ["in-progress", "backlog"], "in-progress": ["review", "todo"], review: ["done", "in-progress"], done: ["archived"], archived: [] },
  requiredFields: { board: ["title"], card: ["title"] },
  computedFields: (type, data) => { data.cardCount = (data.cards || []).length; return data; },
  scoring: (type, data) => Math.round(((data.cards || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Chat ===
EXTENDED_DOMAIN_RULES.set("chat", {
  types: ["conversation", "thread", "message", "channel"],
  validStatuses: ["active", "paused", "resolved", "archived"],
  transitions: { active: ["paused", "resolved"], paused: ["active", "archived"], resolved: ["archived"], archived: [] },
  requiredFields: { conversation: ["title"] },
  computedFields: (type, data) => { data.messageCount = (data.messages || []).length; return data; },
  scoring: (type, data) => Math.round(((data.messages || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Command-Center ===
EXTENDED_DOMAIN_RULES.set("command-center", {
  types: ["dashboard", "alert", "incident", "sitrep"],
  validStatuses: ["green", "yellow", "orange", "red", "archived"],
  transitions: { green: ["yellow", "archived"], yellow: ["green", "orange"], orange: ["yellow", "red"], red: ["orange", "archived"], archived: [] },
  requiredFields: { incident: ["title"] },
  computedFields: (type, data) => { data.feedCount = (data.feeds || []).length; return data; },
  scoring: (type, data) => Math.round(((data.feeds || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Commonsense ===
EXTENDED_DOMAIN_RULES.set("commonsense", {
  types: ["assertion", "rule", "analogy", "reasoning-chain"],
  validStatuses: ["draft", "validated", "contested", "archived"],
  transitions: { draft: ["validated", "contested", "archived"], validated: ["contested", "archived"], contested: ["validated", "archived"], archived: [] },
  requiredFields: { assertion: ["title"] },
  computedFields: (type, data) => { data.constraintCount = (data.constraints || data.statements || []).length; return data; },
  scoring: (type, data) => Math.round(((data.constraints || data.statements || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === CRI (Crisis) ===
EXTENDED_DOMAIN_RULES.set("cri", {
  types: ["incident", "response-plan", "assessment", "timeline"],
  validStatuses: ["monitoring", "escalated", "active", "resolved", "post-mortem", "archived"],
  transitions: { monitoring: ["escalated", "archived"], escalated: ["active", "monitoring"], active: ["resolved", "escalated"], resolved: ["post-mortem", "archived"], "post-mortem": ["archived"], archived: [] },
  requiredFields: { incident: ["title"] },
  computedFields: (type, data) => { data.stakeholderCount = (data.stakeholders || []).length; return data; },
  scoring: (type, data) => Math.round(((data.stakeholders || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Docs ===
EXTENDED_DOMAIN_RULES.set("docs", {
  types: ["document", "page", "guide", "reference", "changelog"],
  validStatuses: ["draft", "review", "published", "deprecated", "archived"],
  transitions: { draft: ["review", "archived"], review: ["published", "draft"], published: ["deprecated", "review"], deprecated: ["archived"], archived: [] },
  requiredFields: { document: ["title"] },
  computedFields: (type, data) => { data.wordCount = (data.content || data.text || "").split(/\s+/).filter(Boolean).length; return data; },
  scoring: (type, data) => { const wc = (data.content || data.text || "").split(/\s+/).filter(Boolean).length; return Math.round((wc > 100 ? 0.6 : wc > 0 ? 0.3 : 0.1) * 100) / 100; },
});

// === Eco ===
EXTENDED_DOMAIN_RULES.set("eco", {
  types: ["assessment", "footprint", "survey", "report"],
  validStatuses: ["draft", "collecting", "analyzed", "published", "archived"],
  transitions: { draft: ["collecting", "archived"], collecting: ["analyzed", "draft"], analyzed: ["published", "archived"], published: ["archived"], archived: [] },
  requiredFields: { assessment: ["title"] },
  computedFields: (type, data) => { data.activityCount = (data.activities || []).length; return data; },
  scoring: (type, data) => Math.round(((data.activities || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Entity ===
EXTENDED_DOMAIN_RULES.set("entity", {
  types: ["record", "profile", "relationship", "schema"],
  validStatuses: ["draft", "active", "merged", "deprecated", "archived"],
  transitions: { draft: ["active", "archived"], active: ["merged", "deprecated"], merged: ["archived"], deprecated: ["archived"], archived: [] },
  requiredFields: { record: ["title"] },
  computedFields: (type, data) => { data.fieldCount = Object.keys(data.attributes || data.fields || {}).length; return data; },
  scoring: (type, data) => Math.round((Object.keys(data.attributes || data.fields || {}).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Goals ===
EXTENDED_DOMAIN_RULES.set("goals", {
  types: ["objective", "key-result", "initiative", "milestone"],
  validStatuses: ["draft", "active", "at-risk", "achieved", "abandoned", "archived"],
  transitions: { draft: ["active", "archived"], active: ["at-risk", "achieved", "abandoned"], "at-risk": ["active", "abandoned"], achieved: ["archived"], abandoned: ["archived"], archived: [] },
  requiredFields: { objective: ["title"] },
  computedFields: (type, data) => { data.keyResultCount = (data.keyResults || []).length; return data; },
  scoring: (type, data) => { const kr = data.keyResults || []; const progress = kr.length > 0 ? kr.reduce((s, r) => s + (r.progress || 0), 0) / kr.length : 0; return Math.round(progress * 100) / 100; },
});

// === Grounding ===
EXTENDED_DOMAIN_RULES.set("grounding", {
  types: ["claim", "evidence", "source", "verdict"],
  validStatuses: ["unverified", "checking", "supported", "refuted", "inconclusive", "archived"],
  transitions: { unverified: ["checking", "archived"], checking: ["supported", "refuted", "inconclusive"], supported: ["archived"], refuted: ["archived"], inconclusive: ["checking", "archived"], archived: [] },
  requiredFields: { claim: ["title"] },
  computedFields: (type, data) => { data.evidenceCount = (data.evidence || data.sources || []).length; return data; },
  scoring: (type, data) => Math.round(((data.evidence || data.sources || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Market ===
EXTENDED_DOMAIN_RULES.set("market", {
  types: ["analysis", "trend", "competitor", "forecast"],
  validStatuses: ["draft", "collecting", "analyzed", "published", "stale", "archived"],
  transitions: { draft: ["collecting", "archived"], collecting: ["analyzed", "draft"], analyzed: ["published", "stale"], published: ["stale", "archived"], stale: ["collecting", "archived"], archived: [] },
  requiredFields: { analysis: ["title"] },
  computedFields: (type, data) => { data.dataPointCount = (data.prices || data.dataPoints || []).length; return data; },
  scoring: (type, data) => Math.round(((data.prices || data.dataPoints || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Meta ===
EXTENDED_DOMAIN_RULES.set("meta", {
  types: ["reflection", "metric", "pattern", "insight"],
  validStatuses: ["draft", "active", "validated", "archived"],
  transitions: { draft: ["active", "archived"], active: ["validated", "archived"], validated: ["archived"], archived: [] },
  requiredFields: { reflection: ["title"] },
  computedFields: (type, data) => { data.metricCount = (data.metrics || []).length; return data; },
  scoring: (type, data) => Math.round(((data.metrics || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Metacognition ===
EXTENDED_DOMAIN_RULES.set("metacognition", {
  types: ["assessment", "calibration", "bias-report", "learning-curve"],
  validStatuses: ["draft", "monitoring", "analyzed", "archived"],
  transitions: { draft: ["monitoring", "archived"], monitoring: ["analyzed", "draft"], analyzed: ["archived"], archived: [] },
  requiredFields: { assessment: ["title"] },
  computedFields: (type, data) => { data.predictionCount = (data.predictions || []).length; return data; },
  scoring: (type, data) => Math.round(((data.predictions || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Metalearning ===
EXTENDED_DOMAIN_RULES.set("metalearning", {
  types: ["strategy", "profile", "transfer-plan", "benchmark"],
  validStatuses: ["draft", "learning", "optimized", "archived"],
  transitions: { draft: ["learning", "archived"], learning: ["optimized", "draft"], optimized: ["archived"], archived: [] },
  requiredFields: { strategy: ["title"] },
  computedFields: (type, data) => { data.taskCount = (data.tasks || data.landmarks || []).length; return data; },
  scoring: (type, data) => Math.round(((data.tasks || data.landmarks || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === News ===
EXTENDED_DOMAIN_RULES.set("news", {
  types: ["article", "feed", "event", "narrative"],
  validStatuses: ["draft", "breaking", "developing", "published", "stale", "archived"],
  transitions: { draft: ["breaking", "developing", "published"], breaking: ["developing", "published"], developing: ["published", "stale"], published: ["stale", "archived"], stale: ["archived"], archived: [] },
  requiredFields: { article: ["title"] },
  computedFields: (type, data) => { data.sourceCount = (data.sources || []).length; return data; },
  scoring: (type, data) => Math.round(((data.sources || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Reflection ===
EXTENDED_DOMAIN_RULES.set("reflection", {
  types: ["journal", "insight", "pattern", "growth-report"],
  validStatuses: ["draft", "active", "reviewed", "archived"],
  transitions: { draft: ["active", "archived"], active: ["reviewed", "archived"], reviewed: ["archived"], archived: [] },
  requiredFields: { journal: ["title"] },
  computedFields: (type, data) => { data.entryCount = (data.entries || []).length; return data; },
  scoring: (type, data) => Math.round(((data.entries || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Repos ===
EXTENDED_DOMAIN_RULES.set("repos", {
  types: ["repository", "commit-log", "dependency-tree", "report"],
  validStatuses: ["draft", "active", "audited", "archived"],
  transitions: { draft: ["active", "archived"], active: ["audited", "archived"], audited: ["archived"], archived: [] },
  requiredFields: { repository: ["title"] },
  computedFields: (type, data) => { data.fileCount = (data.files || []).length; return data; },
  scoring: (type, data) => Math.round(((data.files || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Resonance ===
EXTENDED_DOMAIN_RULES.set("resonance", {
  types: ["content", "analysis", "prediction", "report"],
  validStatuses: ["draft", "measuring", "analyzed", "archived"],
  transitions: { draft: ["measuring", "archived"], measuring: ["analyzed", "draft"], analyzed: ["archived"], archived: [] },
  requiredFields: { content: ["title"] },
  computedFields: (type, data) => { data.metricCount = (data.metrics || []).length; return data; },
  scoring: (type, data) => Math.round(((data.metrics || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Organ (Organization) ===
EXTENDED_DOMAIN_RULES.set("organ", {
  types: ["org-chart", "team", "role", "communication-map"],
  validStatuses: ["draft", "active", "restructuring", "archived"],
  transitions: { draft: ["active", "archived"], active: ["restructuring", "archived"], restructuring: ["active", "archived"], archived: [] },
  requiredFields: { team: ["title"] },
  computedFields: (type, data) => { data.memberCount = (data.members || data.nodes || []).length; return data; },
  scoring: (type, data) => Math.round(((data.members || data.nodes || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Suffering ===
EXTENDED_DOMAIN_RULES.set("suffering", {
  types: ["pain-point", "root-cause", "intervention", "report"],
  validStatuses: ["identified", "analyzing", "addressed", "resolved", "archived"],
  transitions: { identified: ["analyzing", "archived"], analyzing: ["addressed", "identified"], addressed: ["resolved", "analyzing"], resolved: ["archived"], archived: [] },
  requiredFields: { "pain-point": ["title"] },
  computedFields: (type, data) => { data.issueCount = (data.issues || data.complaints || []).length; return data; },
  scoring: (type, data) => Math.round(((data.issues || data.complaints || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Temporal ===
EXTENDED_DOMAIN_RULES.set("temporal", {
  types: ["time-series", "forecast", "anomaly-report", "decomposition"],
  validStatuses: ["draft", "collecting", "analyzed", "published", "archived"],
  transitions: { draft: ["collecting", "archived"], collecting: ["analyzed", "draft"], analyzed: ["published", "archived"], published: ["archived"], archived: [] },
  requiredFields: { "time-series": ["title"] },
  computedFields: (type, data) => { data.pointCount = (data.values || data.series || []).length; return data; },
  scoring: (type, data) => Math.round(((data.values || data.series || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Vote ===
EXTENDED_DOMAIN_RULES.set("vote", {
  types: ["election", "poll", "ballot", "result"],
  validStatuses: ["draft", "open", "closed", "tallied", "archived"],
  transitions: { draft: ["open", "archived"], open: ["closed"], closed: ["tallied"], tallied: ["archived"], archived: [] },
  requiredFields: { election: ["title"] },
  computedFields: (type, data) => { data.voterCount = (data.ballots || data.votes || []).length; data.candidateCount = (data.candidates || data.options || []).length; return data; },
  scoring: (type, data) => Math.round(((data.ballots || data.votes || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Transfer ===
EXTENDED_DOMAIN_RULES.set("transfer", {
  types: ["migration", "mapping", "quality-report", "plan"],
  validStatuses: ["draft", "mapping", "validating", "executing", "complete", "archived"],
  transitions: { draft: ["mapping", "archived"], mapping: ["validating", "draft"], validating: ["executing", "mapping"], executing: ["complete", "validating"], complete: ["archived"], archived: [] },
  requiredFields: { migration: ["title"] },
  computedFields: (type, data) => { data.fieldCount = (data.mappings || data.fields || []).length; return data; },
  scoring: (type, data) => Math.round(((data.mappings || data.fields || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Inference ===
EXTENDED_DOMAIN_RULES.set("inference", {
  types: ["rule-set", "fact-base", "proof", "query"],
  validStatuses: ["draft", "active", "saturated", "archived"],
  transitions: { draft: ["active", "archived"], active: ["saturated", "archived"], saturated: ["active", "archived"], archived: [] },
  requiredFields: { "rule-set": ["title"] },
  computedFields: (type, data) => { data.ruleCount = (data.rules || []).length; data.factCount = (data.facts || []).length; return data; },
  scoring: (type, data) => { const s = ((data.rules || []).length > 0 ? 0.3 : 0) + ((data.facts || []).length > 0 ? 0.3 : 0) + 0.1; return Math.round(s * 100) / 100; },
});

// === Fractal ===
EXTENDED_DOMAIN_RULES.set("fractal", {
  types: ["dataset", "analysis", "pattern", "report"],
  validStatuses: ["draft", "computing", "analyzed", "archived"],
  transitions: { draft: ["computing", "archived"], computing: ["analyzed", "draft"], analyzed: ["archived"], archived: [] },
  requiredFields: { dataset: ["title"] },
  computedFields: (type, data) => { data.pointCount = (data.points || data.series || []).length; return data; },
  scoring: (type, data) => Math.round(((data.points || data.series || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Global ===
EXTENDED_DOMAIN_RULES.set("global", {
  types: ["dashboard", "search", "correlation", "report"],
  validStatuses: ["draft", "aggregating", "ready", "archived"],
  transitions: { draft: ["aggregating", "archived"], aggregating: ["ready", "draft"], ready: ["archived"], archived: [] },
  requiredFields: { dashboard: ["title"] },
  computedFields: (type, data) => { data.sourceCount = (data.sources || data.domains || []).length; return data; },
  scoring: (type, data) => Math.round(((data.sources || data.domains || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Integrations ===
EXTENDED_DOMAIN_RULES.set("integrations", {
  types: ["connector", "flow", "health-check", "mapping"],
  validStatuses: ["draft", "testing", "active", "degraded", "disabled", "archived"],
  transitions: { draft: ["testing", "archived"], testing: ["active", "draft"], active: ["degraded", "disabled"], degraded: ["active", "disabled"], disabled: ["testing", "archived"], archived: [] },
  requiredFields: { connector: ["title"] },
  computedFields: (type, data) => { data.endpointCount = (data.endpoints || []).length; return data; },
  scoring: (type, data) => Math.round(((data.endpoints || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Legacy ===
EXTENDED_DOMAIN_RULES.set("legacy", {
  types: ["system", "assessment", "migration-plan", "risk-map"],
  validStatuses: ["draft", "assessed", "migrating", "decommissioned", "archived"],
  transitions: { draft: ["assessed", "archived"], assessed: ["migrating", "archived"], migrating: ["decommissioned", "assessed"], decommissioned: ["archived"], archived: [] },
  requiredFields: { system: ["title"] },
  computedFields: (type, data) => { data.componentCount = (data.components || []).length; return data; },
  scoring: (type, data) => Math.round(((data.components || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Offline ===
EXTENDED_DOMAIN_RULES.set("offline", {
  types: ["cache", "sync-plan", "conflict-log", "delta"],
  validStatuses: ["draft", "syncing", "synced", "conflict", "archived"],
  transitions: { draft: ["syncing", "archived"], syncing: ["synced", "conflict"], synced: ["syncing", "archived"], conflict: ["syncing", "archived"], archived: [] },
  requiredFields: { cache: ["title"] },
  computedFields: (type, data) => { data.entryCount = (data.entries || data.items || []).length; return data; },
  scoring: (type, data) => Math.round(((data.entries || data.items || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Queue ===
EXTENDED_DOMAIN_RULES.set("queue", {
  types: ["queue", "job", "schedule", "report"],
  validStatuses: ["empty", "active", "paused", "draining", "archived"],
  transitions: { empty: ["active", "archived"], active: ["paused", "draining"], paused: ["active", "archived"], draining: ["empty", "archived"], archived: [] },
  requiredFields: { queue: ["title"] },
  computedFields: (type, data) => { data.jobCount = (data.jobs || data.items || []).length; return data; },
  scoring: (type, data) => Math.round(((data.jobs || data.items || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Schema ===
EXTENDED_DOMAIN_RULES.set("schema", {
  types: ["schema", "migration", "diff", "validation-report"],
  validStatuses: ["draft", "proposed", "active", "deprecated", "archived"],
  transitions: { draft: ["proposed", "archived"], proposed: ["active", "draft"], active: ["deprecated"], deprecated: ["archived"], archived: [] },
  requiredFields: { schema: ["title"] },
  computedFields: (type, data) => { data.fieldCount = (data.fields || data.properties || []).length; return data; },
  scoring: (type, data) => Math.round(((data.fields || data.properties || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Tick ===
EXTENDED_DOMAIN_RULES.set("tick", {
  types: ["heartbeat", "metric", "alert", "report"],
  validStatuses: ["healthy", "degraded", "critical", "offline", "archived"],
  transitions: { healthy: ["degraded", "archived"], degraded: ["healthy", "critical"], critical: ["degraded", "offline"], offline: ["healthy", "archived"], archived: [] },
  requiredFields: { heartbeat: ["title"] },
  computedFields: (type, data) => { data.tickCount = (data.ticks || data.samples || []).length; return data; },
  scoring: (type, data) => Math.round(((data.ticks || data.samples || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Lock ===
EXTENDED_DOMAIN_RULES.set("lock", {
  types: ["lock", "contention-report", "deadlock-report", "policy"],
  validStatuses: ["free", "held", "waiting", "deadlocked", "archived"],
  transitions: { free: ["held"], held: ["free", "waiting"], waiting: ["held", "deadlocked"], deadlocked: ["free", "archived"], archived: [] },
  requiredFields: { lock: ["title"] },
  computedFields: (type, data) => { data.lockCount = (data.locks || []).length; return data; },
  scoring: (type, data) => Math.round(((data.locks || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Fork ===
EXTENDED_DOMAIN_RULES.set("fork", {
  types: ["fork", "diff", "merge-plan", "comparison"],
  validStatuses: ["draft", "diverged", "merging", "merged", "abandoned", "archived"],
  transitions: { draft: ["diverged", "archived"], diverged: ["merging", "abandoned"], merging: ["merged", "diverged"], merged: ["archived"], abandoned: ["archived"], archived: [] },
  requiredFields: { fork: ["title"] },
  computedFields: (type, data) => { data.changeCount = (data.changes || []).length; return data; },
  scoring: (type, data) => Math.round(((data.changes || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Invariant ===
EXTENDED_DOMAIN_RULES.set("invariant", {
  types: ["invariant", "constraint", "proof", "violation-report"],
  validStatuses: ["draft", "active", "violated", "satisfied", "archived"],
  transitions: { draft: ["active", "archived"], active: ["violated", "satisfied"], violated: ["active", "archived"], satisfied: ["active", "archived"], archived: [] },
  requiredFields: { invariant: ["title"] },
  computedFields: (type, data) => { data.constraintCount = (data.constraints || data.invariants || []).length; return data; },
  scoring: (type, data) => Math.round(((data.constraints || data.invariants || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Accounting ===
EXTENDED_DOMAIN_RULES.set("accounting", {
  types: ["ledger", "journal", "invoice", "report", "reconciliation"],
  validStatuses: ["draft", "posted", "reconciled", "closed", "archived"],
  transitions: { draft: ["posted", "archived"], posted: ["reconciled", "closed"], reconciled: ["closed"], closed: ["archived"], archived: [] },
  requiredFields: { ledger: ["title"] },
  computedFields: (type, data) => { data.entryCount = (data.entries || []).length; data.balance = (data.entries || []).reduce((s, e) => s + (e.debit || 0) - (e.credit || 0), 0); return data; },
  scoring: (type, data) => Math.round(((data.entries || []).length > 0 ? 0.5 : 0.1) * 100) / 100,
});

// === Agriculture ===
EXTENDED_DOMAIN_RULES.set("agriculture", {
  types: ["crop", "field", "harvest", "plan", "sensor-data"],
  validStatuses: ["draft", "planted", "growing", "harvested", "analyzed", "archived"],
  transitions: { draft: ["planted", "archived"], planted: ["growing", "archived"], growing: ["harvested"], harvested: ["analyzed", "archived"], analyzed: ["archived"], archived: [] },
  requiredFields: { crop: ["title"] },
  computedFields: (type, data) => { data.fieldCount = (data.fields || []).length; return data; },
  scoring: (type, data) => Math.round(((data.yield || 0) > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === All (Meta-domain) ===
EXTENDED_DOMAIN_RULES.set("all", {
  types: ["aggregate", "summary", "cross-domain"],
  validStatuses: ["active", "archived"],
  transitions: { active: ["archived"], archived: [] },
  requiredFields: {},
  computedFields: (type, data) => { data.domainCount = (data.domains || []).length; return data; },
  scoring: () => 0.5,
});

// === Aviation ===
EXTENDED_DOMAIN_RULES.set("aviation", {
  types: ["flight-plan", "inspection", "logbook", "checklist", "incident"],
  validStatuses: ["draft", "filed", "approved", "active", "completed", "archived"],
  transitions: { draft: ["filed", "archived"], filed: ["approved", "draft"], approved: ["active"], active: ["completed"], completed: ["archived"], archived: [] },
  requiredFields: { "flight-plan": ["title"] },
  computedFields: (type, data) => { data.checklistComplete = (data.items || []).filter(i => i.checked).length; return data; },
  scoring: (type, data) => Math.round(((data.items || []).length > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Calendar ===
EXTENDED_DOMAIN_RULES.set("calendar", {
  types: ["event", "reminder", "schedule", "availability"],
  validStatuses: ["draft", "scheduled", "active", "completed", "cancelled", "archived"],
  transitions: { draft: ["scheduled", "archived"], scheduled: ["active", "cancelled"], active: ["completed", "cancelled"], completed: ["archived"], cancelled: ["archived"], archived: [] },
  requiredFields: { event: ["title"] },
  computedFields: (type, data) => { if (data.start && data.end) data.durationMinutes = Math.round((new Date(data.end) - new Date(data.start)) / 60000); return data; },
  scoring: (type, data) => Math.round((data.start && data.end ? 0.6 : 0.2) * 100) / 100,
});

// === Collab ===
EXTENDED_DOMAIN_RULES.set("collab", {
  types: ["workspace", "thread", "decision", "action-item"],
  validStatuses: ["draft", "active", "resolved", "archived"],
  transitions: { draft: ["active", "archived"], active: ["resolved", "archived"], resolved: ["archived"], archived: [] },
  requiredFields: { workspace: ["title"] },
  computedFields: (type, data) => { data.participantCount = (data.participants || []).length; return data; },
  scoring: (type, data) => Math.round(((data.participants || []).length > 1 ? 0.5 : 0.2) * 100) / 100,
});

// === Creative ===
EXTENDED_DOMAIN_RULES.set("creative", {
  types: ["project", "asset", "brief", "storyboard", "composition"],
  validStatuses: ["draft", "in-progress", "review", "final", "published", "archived"],
  transitions: { draft: ["in-progress", "archived"], "in-progress": ["review", "draft"], review: ["final", "in-progress"], final: ["published", "archived"], published: ["archived"], archived: [] },
  requiredFields: { project: ["title"] },
  computedFields: (type, data) => { data.assetCount = (data.assets || []).length; return data; },
  scoring: (type, data) => Math.round(((data.assets || []).length > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Custom ===
EXTENDED_DOMAIN_RULES.set("custom", {
  types: ["custom-type", "template", "config"],
  validStatuses: ["draft", "active", "archived"],
  transitions: { draft: ["active", "archived"], active: ["archived"], archived: [] },
  requiredFields: {},
  computedFields: (type, data) => data,
  scoring: () => 0.5,
});

// === Daily ===
EXTENDED_DOMAIN_RULES.set("daily", {
  types: ["journal", "summary", "log", "habit", "mood"],
  validStatuses: ["draft", "logged", "reviewed", "archived"],
  transitions: { draft: ["logged", "archived"], logged: ["reviewed", "archived"], reviewed: ["archived"], archived: [] },
  requiredFields: { journal: ["title"] },
  computedFields: (type, data) => { data.wordCount = (data.content || "").split(/\s+/).filter(Boolean).length; return data; },
  scoring: (type, data) => Math.round(((data.content || "").length > 50 ? 0.5 : 0.2) * 100) / 100,
});

// === Database ===
EXTENDED_DOMAIN_RULES.set("database", {
  types: ["query", "schema", "migration", "index", "report"],
  validStatuses: ["draft", "validated", "executed", "optimized", "archived"],
  transitions: { draft: ["validated", "archived"], validated: ["executed", "draft"], executed: ["optimized", "archived"], optimized: ["archived"], archived: [] },
  requiredFields: { query: ["title"] },
  computedFields: (type, data) => { data.tableCount = (data.tables || []).length; return data; },
  scoring: (type, data) => Math.round(((data.query || data.sql || "").length > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Environment ===
EXTENDED_DOMAIN_RULES.set("environment", {
  types: ["assessment", "monitoring", "policy", "report", "impact-study"],
  validStatuses: ["draft", "collecting", "analyzed", "published", "archived"],
  transitions: { draft: ["collecting", "archived"], collecting: ["analyzed"], analyzed: ["published", "collecting"], published: ["archived"], archived: [] },
  requiredFields: { assessment: ["title"] },
  computedFields: (type, data) => { data.metricCount = (data.metrics || []).length; return data; },
  scoring: (type, data) => Math.round(((data.metrics || []).length > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Events ===
EXTENDED_DOMAIN_RULES.set("events", {
  types: ["event", "venue", "attendee-list", "agenda", "budget"],
  validStatuses: ["draft", "planning", "confirmed", "active", "completed", "archived"],
  transitions: { draft: ["planning", "archived"], planning: ["confirmed", "draft"], confirmed: ["active", "planning"], active: ["completed"], completed: ["archived"], archived: [] },
  requiredFields: { event: ["title"] },
  computedFields: (type, data) => { data.attendeeCount = (data.attendees || []).length; return data; },
  scoring: (type, data) => Math.round(((data.attendees || []).length > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Experience ===
EXTENDED_DOMAIN_RULES.set("experience", {
  types: ["resume", "portfolio", "endorsement", "skill", "certificate"],
  validStatuses: ["draft", "active", "verified", "archived"],
  transitions: { draft: ["active", "archived"], active: ["verified", "archived"], verified: ["archived"], archived: [] },
  requiredFields: { resume: ["title"] },
  computedFields: (type, data) => { data.skillCount = (data.skills || []).length; return data; },
  scoring: (type, data) => Math.round(((data.skills || []).length > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Export ===
EXTENDED_DOMAIN_RULES.set("export", {
  types: ["export-job", "format-config", "batch"],
  validStatuses: ["pending", "processing", "completed", "failed", "archived"],
  transitions: { pending: ["processing"], processing: ["completed", "failed"], completed: ["archived"], failed: ["pending", "archived"], archived: [] },
  requiredFields: {},
  computedFields: (type, data) => { data.recordCount = data.recordCount || 0; return data; },
  scoring: () => 0.5,
});

// === Feed ===
EXTENDED_DOMAIN_RULES.set("feed", {
  types: ["post", "story", "share", "bookmark", "collection"],
  validStatuses: ["draft", "published", "hidden", "archived"],
  transitions: { draft: ["published", "archived"], published: ["hidden", "archived"], hidden: ["published", "archived"], archived: [] },
  requiredFields: { post: ["title"] },
  computedFields: (type, data) => { data.likeCount = data.likeCount || 0; data.repostCount = data.repostCount || 0; return data; },
  scoring: (type, data) => Math.round((((data.likeCount || 0) > 0 ? 0.3 : 0) + ((data.content || "").length > 0 ? 0.3 : 0) + 0.1) * 100) / 100,
});

// === Fitness ===
EXTENDED_DOMAIN_RULES.set("fitness", {
  types: ["workout", "plan", "progress", "exercise", "goal"],
  validStatuses: ["draft", "active", "completed", "paused", "archived"],
  transitions: { draft: ["active", "archived"], active: ["completed", "paused"], paused: ["active", "archived"], completed: ["archived"], archived: [] },
  requiredFields: { workout: ["title"] },
  computedFields: (type, data) => { data.exerciseCount = (data.exercises || []).length; return data; },
  scoring: (type, data) => Math.round(((data.exercises || []).length > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Food ===
EXTENDED_DOMAIN_RULES.set("food", {
  types: ["recipe", "meal-plan", "inventory", "nutrition", "review"],
  validStatuses: ["draft", "tested", "published", "archived"],
  transitions: { draft: ["tested", "archived"], tested: ["published", "draft"], published: ["archived"], archived: [] },
  requiredFields: { recipe: ["title"] },
  computedFields: (type, data) => { data.ingredientCount = (data.ingredients || []).length; data.totalCalories = (data.ingredients || []).reduce((s, i) => s + (i.calories || 0), 0); return data; },
  scoring: (type, data) => Math.round(((data.ingredients || []).length > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Forum ===
EXTENDED_DOMAIN_RULES.set("forum", {
  types: ["thread", "post", "reply", "poll", "announcement"],
  validStatuses: ["draft", "open", "pinned", "locked", "archived"],
  transitions: { draft: ["open", "archived"], open: ["pinned", "locked", "archived"], pinned: ["open", "locked"], locked: ["open", "archived"], archived: [] },
  requiredFields: { thread: ["title"] },
  computedFields: (type, data) => { data.replyCount = (data.replies || []).length; data.voteScore = (data.upvotes || 0) - (data.downvotes || 0); return data; },
  scoring: (type, data) => Math.round((((data.replies || []).length > 0 ? 0.3 : 0) + ((data.upvotes || 0) > 0 ? 0.3 : 0) + 0.1) * 100) / 100,
});

// === Game ===
EXTENDED_DOMAIN_RULES.set("game", {
  types: ["quest", "achievement", "character", "item", "world"],
  validStatuses: ["draft", "active", "completed", "paused", "archived"],
  transitions: { draft: ["active", "archived"], active: ["completed", "paused"], paused: ["active", "archived"], completed: ["archived"], archived: [] },
  requiredFields: { quest: ["title"] },
  computedFields: (type, data) => { data.level = data.level || 1; data.xp = data.xp || 0; return data; },
  scoring: (type, data) => Math.round(((data.level || 1) > 1 ? 0.5 : 0.2) * 100) / 100,
});

// === Government ===
EXTENDED_DOMAIN_RULES.set("government", {
  types: ["policy", "regulation", "permit", "report", "public-comment"],
  validStatuses: ["draft", "proposed", "public-comment", "enacted", "repealed", "archived"],
  transitions: { draft: ["proposed", "archived"], proposed: ["public-comment", "draft"], "public-comment": ["enacted", "proposed"], enacted: ["repealed", "archived"], repealed: ["archived"], archived: [] },
  requiredFields: { policy: ["title"] },
  computedFields: (type, data) => { data.sectionCount = (data.sections || []).length; return data; },
  scoring: (type, data) => Math.round(((data.sections || []).length > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Healthcare ===
EXTENDED_DOMAIN_RULES.set("healthcare", {
  types: ["patient-record", "protocol", "prescription", "lab-result", "referral"],
  validStatuses: ["draft", "active", "reviewed", "completed", "archived"],
  transitions: { draft: ["active", "archived"], active: ["reviewed", "completed"], reviewed: ["completed", "active"], completed: ["archived"], archived: [] },
  requiredFields: { "patient-record": ["title"] },
  computedFields: (type, data) => { data.medicationCount = (data.medications || []).length; return data; },
  scoring: (type, data) => Math.round(((data.medications || data.results || []).length > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Household ===
EXTENDED_DOMAIN_RULES.set("household", {
  types: ["task", "inventory", "maintenance", "budget", "schedule"],
  validStatuses: ["draft", "pending", "in-progress", "completed", "archived"],
  transitions: { draft: ["pending", "archived"], pending: ["in-progress", "archived"], "in-progress": ["completed"], completed: ["archived"], archived: [] },
  requiredFields: { task: ["title"] },
  computedFields: (type, data) => { data.taskCount = (data.tasks || []).length; return data; },
  scoring: (type, data) => Math.round(((data.tasks || []).length > 0 ? 0.4 : 0.2) * 100) / 100,
});

// === Import ===
EXTENDED_DOMAIN_RULES.set("import", {
  types: ["import-job", "mapping", "validation-report"],
  validStatuses: ["pending", "validating", "importing", "completed", "failed", "archived"],
  transitions: { pending: ["validating"], validating: ["importing", "failed"], importing: ["completed", "failed"], completed: ["archived"], failed: ["pending", "archived"], archived: [] },
  requiredFields: {},
  computedFields: (type, data) => { data.recordCount = data.recordCount || 0; return data; },
  scoring: () => 0.5,
});

// === Ingest ===
EXTENDED_DOMAIN_RULES.set("ingest", {
  types: ["pipeline", "source", "batch", "transform"],
  validStatuses: ["draft", "active", "paused", "completed", "failed", "archived"],
  transitions: { draft: ["active", "archived"], active: ["paused", "completed", "failed"], paused: ["active", "archived"], completed: ["archived"], failed: ["draft", "archived"], archived: [] },
  requiredFields: {},
  computedFields: (type, data) => { data.recordsProcessed = data.recordsProcessed || 0; return data; },
  scoring: () => 0.5,
});

// === Insurance ===
EXTENDED_DOMAIN_RULES.set("insurance", {
  types: ["policy", "claim", "assessment", "quote", "rider"],
  validStatuses: ["draft", "quoted", "active", "under-review", "settled", "archived"],
  transitions: { draft: ["quoted", "archived"], quoted: ["active", "draft"], active: ["under-review", "archived"], "under-review": ["settled", "active"], settled: ["archived"], archived: [] },
  requiredFields: { policy: ["title"] },
  computedFields: (type, data) => { data.premium = data.premium || 0; data.coverage = data.coverage || 0; return data; },
  scoring: (type, data) => Math.round(((data.premium || 0) > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Legal ===
EXTENDED_DOMAIN_RULES.set("legal", {
  types: ["case", "contract", "statute", "brief", "filing"],
  validStatuses: ["draft", "filed", "active", "settled", "closed", "archived"],
  transitions: { draft: ["filed", "archived"], filed: ["active", "draft"], active: ["settled", "closed"], settled: ["closed", "archived"], closed: ["archived"], archived: [] },
  requiredFields: { case: ["title"] },
  computedFields: (type, data) => { data.documentCount = (data.documents || []).length; return data; },
  scoring: (type, data) => Math.round(((data.documents || []).length > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Logistics ===
EXTENDED_DOMAIN_RULES.set("logistics", {
  types: ["shipment", "route", "warehouse", "inventory", "order"],
  validStatuses: ["draft", "pending", "in-transit", "delivered", "returned", "archived"],
  transitions: { draft: ["pending", "archived"], pending: ["in-transit", "archived"], "in-transit": ["delivered", "returned"], delivered: ["archived"], returned: ["pending", "archived"], archived: [] },
  requiredFields: { shipment: ["title"] },
  computedFields: (type, data) => { data.itemCount = (data.items || []).length; return data; },
  scoring: (type, data) => Math.round(((data.items || []).length > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Manufacturing ===
EXTENDED_DOMAIN_RULES.set("manufacturing", {
  types: ["work-order", "bom", "quality-check", "process", "batch"],
  validStatuses: ["draft", "scheduled", "in-production", "qa", "completed", "archived"],
  transitions: { draft: ["scheduled", "archived"], scheduled: ["in-production", "draft"], "in-production": ["qa", "completed"], qa: ["completed", "in-production"], completed: ["archived"], archived: [] },
  requiredFields: { "work-order": ["title"] },
  computedFields: (type, data) => { data.partCount = (data.parts || data.components || []).length; return data; },
  scoring: (type, data) => Math.round(((data.parts || data.components || []).length > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Marketplace ===
EXTENDED_DOMAIN_RULES.set("marketplace", {
  types: ["listing", "purchase", "review", "license", "storefront"],
  validStatuses: ["draft", "listed", "sold", "disputed", "archived"],
  transitions: { draft: ["listed", "archived"], listed: ["sold", "archived"], sold: ["disputed", "archived"], disputed: ["sold", "archived"], archived: [] },
  requiredFields: { listing: ["title"] },
  computedFields: (type, data) => { data.price = data.price || 0; data.reviewCount = (data.reviews || []).length; return data; },
  scoring: (type, data) => Math.round((((data.price || 0) > 0 ? 0.3 : 0) + ((data.reviews || []).length > 0 ? 0.3 : 0) + 0.1) * 100) / 100,
});

// === ML ===
EXTENDED_DOMAIN_RULES.set("ml", {
  types: ["model", "dataset", "experiment", "pipeline", "deployment"],
  validStatuses: ["draft", "training", "evaluating", "deployed", "retired", "archived"],
  transitions: { draft: ["training", "archived"], training: ["evaluating", "draft"], evaluating: ["deployed", "training"], deployed: ["retired", "archived"], retired: ["archived"], archived: [] },
  requiredFields: { model: ["title"] },
  computedFields: (type, data) => { data.accuracy = data.accuracy || null; data.epochCount = data.epochCount || 0; return data; },
  scoring: (type, data) => Math.round(((data.accuracy || 0) > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Music ===
EXTENDED_DOMAIN_RULES.set("music", {
  types: ["track", "composition", "arrangement", "album", "stem"],
  validStatuses: ["draft", "recording", "mixing", "mastered", "published", "archived"],
  transitions: { draft: ["recording", "archived"], recording: ["mixing", "draft"], mixing: ["mastered", "recording"], mastered: ["published", "archived"], published: ["archived"], archived: [] },
  requiredFields: { track: ["title"] },
  computedFields: (type, data) => { data.durationSeconds = data.durationSeconds || 0; data.bpm = data.bpm || null; return data; },
  scoring: (type, data) => Math.round(((data.durationSeconds || 0) > 0 ? 0.4 : 0.1) + ((data.bpm || 0) > 0 ? 0.2 : 0)) * 100 / 100,
});

// === Nonprofit ===
EXTENDED_DOMAIN_RULES.set("nonprofit", {
  types: ["campaign", "donor", "grant", "volunteer", "report"],
  validStatuses: ["draft", "active", "funded", "completed", "archived"],
  transitions: { draft: ["active", "archived"], active: ["funded", "completed", "archived"], funded: ["completed", "archived"], completed: ["archived"], archived: [] },
  requiredFields: { campaign: ["title"] },
  computedFields: (type, data) => { data.totalRaised = (data.donations || []).reduce((s, d) => s + (d.amount || 0), 0); return data; },
  scoring: (type, data) => Math.round(((data.donations || []).length > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Questmarket ===
EXTENDED_DOMAIN_RULES.set("questmarket", {
  types: ["quest", "bounty", "submission", "rating"],
  validStatuses: ["draft", "open", "in-progress", "submitted", "judged", "archived"],
  transitions: { draft: ["open", "archived"], open: ["in-progress", "archived"], "in-progress": ["submitted"], submitted: ["judged", "in-progress"], judged: ["archived"], archived: [] },
  requiredFields: { quest: ["title"] },
  computedFields: (type, data) => { data.reward = data.reward || 0; data.submissionCount = (data.submissions || []).length; return data; },
  scoring: (type, data) => Math.round(((data.reward || 0) > 0 ? 0.4 : 0.1) * 100) / 100,
});

// === Realestate ===
EXTENDED_DOMAIN_RULES.set("realestate", {
  types: ["listing", "property", "appraisal", "contract", "inspection"],
  validStatuses: ["draft", "listed", "under-contract", "sold", "leased", "archived"],
  transitions: { draft: ["listed", "archived"], listed: ["under-contract", "archived"], "under-contract": ["sold", "leased", "listed"], sold: ["archived"], leased: ["archived"], archived: [] },
  requiredFields: { listing: ["title"] },
  computedFields: (type, data) => { data.sqft = data.sqft || 0; data.pricePerSqft = data.sqft > 0 ? Math.round((data.price || 0) / data.sqft) : 0; return data; },
  scoring: (type, data) => Math.round(((data.price || 0) > 0 ? 0.4 : 0.1) * 100) / 100,
});

// === Retail ===
EXTENDED_DOMAIN_RULES.set("retail", {
  types: ["product", "order", "inventory", "promotion", "return"],
  validStatuses: ["draft", "active", "sold", "returned", "archived"],
  transitions: { draft: ["active", "archived"], active: ["sold", "archived"], sold: ["returned", "archived"], returned: ["archived"], archived: [] },
  requiredFields: { product: ["title"] },
  computedFields: (type, data) => { data.unitCount = data.unitCount || 0; data.revenue = (data.unitsSold || 0) * (data.price || 0); return data; },
  scoring: (type, data) => Math.round(((data.unitsSold || 0) > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Science ===
EXTENDED_DOMAIN_RULES.set("science", {
  types: ["experiment", "observation", "paper", "dataset", "method"],
  validStatuses: ["draft", "hypothesis", "testing", "analyzed", "published", "archived"],
  transitions: { draft: ["hypothesis", "archived"], hypothesis: ["testing", "draft"], testing: ["analyzed"], analyzed: ["published", "testing"], published: ["archived"], archived: [] },
  requiredFields: { experiment: ["title"] },
  computedFields: (type, data) => { data.sampleSize = data.sampleSize || 0; data.pValue = data.pValue || null; return data; },
  scoring: (type, data) => Math.round(((data.sampleSize || 0) > 0 ? 0.4 : 0.1) + ((data.pValue || 1) < 0.05 ? 0.3 : 0)) * 100 / 100,
});

// === Security ===
EXTENDED_DOMAIN_RULES.set("security", {
  types: ["vulnerability", "incident", "policy", "audit", "scan"],
  validStatuses: ["draft", "identified", "triaging", "mitigated", "resolved", "archived"],
  transitions: { draft: ["identified", "archived"], identified: ["triaging"], triaging: ["mitigated", "resolved"], mitigated: ["resolved", "triaging"], resolved: ["archived"], archived: [] },
  requiredFields: { vulnerability: ["title"] },
  computedFields: (type, data) => { data.severity = data.severity || "medium"; data.cvss = data.cvss || null; return data; },
  scoring: (type, data) => Math.round(((data.cvss || 0) > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Services ===
// This rule was authored for a generic support-ticket shape (ticket/sla/
// catalog/request/feedback) while the real frontend page
// (app/lenses/services/page.tsx — a genuine Vagaro-style appointment-
// booking business) sends Appointment/Client/ServiceItem/StaffMember/
// Transaction/Product — two independently-authored vocabularies that were
// never reconciled, so every "New Client"/"New Appointment" etc. create
// hit `validation_failed` ("Invalid type ... for domain services"), read
// by the page as a silent no-op (see the use-lens-data.ts throw-on-
// rejected-write fix — before that fix this failed completely silently).
// `validStatuses` is the union of every value the page's own
// getStatusesForTab() can produce per tab, so whichever status a tab's
// dropdown sends is always valid.
EXTENDED_DOMAIN_RULES.set("services", {
  types: ["Appointment", "Client", "ServiceItem", "StaffMember", "Transaction", "Product"],
  validStatuses: ["booked", "confirmed", "in_progress", "completed", "no_show", "cancelled", "active", "inactive"],
  requiredFields: { Appointment: ["title"], Client: ["title"], ServiceItem: ["title"], StaffMember: ["title"], Transaction: ["title"], Product: ["title"] },
  computedFields: (type, data) => data,
  scoring: (type, data) => Math.round(((data && Object.keys(data).length > 0) ? 0.5 : 0.2) * 100) / 100,
});

// === SRS (Spaced Repetition) ===
EXTENDED_DOMAIN_RULES.set("srs", {
  types: ["card", "deck", "review-session", "schedule"],
  validStatuses: ["draft", "learning", "reviewing", "mastered", "archived"],
  transitions: { draft: ["learning", "archived"], learning: ["reviewing", "archived"], reviewing: ["mastered", "learning"], mastered: ["reviewing", "archived"], archived: [] },
  requiredFields: { card: ["title"] },
  computedFields: (type, data) => { data.cardCount = (data.cards || []).length; data.masteryRate = data.cardCount > 0 ? (data.cards || []).filter(c => c.mastered).length / data.cardCount : 0; return data; },
  scoring: (type, data) => Math.round((data.masteryRate || 0) * 0.6 + 0.2) * 100 / 100,
});

// === Thread ===
EXTENDED_DOMAIN_RULES.set("thread", {
  types: ["conversation", "branch", "summary", "decision"],
  validStatuses: ["active", "branched", "merged", "resolved", "archived"],
  transitions: { active: ["branched", "merged", "resolved", "archived"], branched: ["merged", "active"], merged: ["archived"], resolved: ["archived"], archived: [] },
  requiredFields: { conversation: ["title"] },
  computedFields: (type, data) => { data.messageCount = (data.messages || []).length; data.branchCount = (data.branches || []).length; return data; },
  scoring: (type, data) => Math.round(((data.messages || []).length > 0 ? 0.5 : 0.2) * 100) / 100,
});

// === Trades ===
// NOTE: this "trades" entry is dead for the real /lenses/trades page — the
// merge in server.js (`if (!DOMAIN_RULES.has(k)) DOMAIN_RULES.set(k, v)`)
// only applies an EXTENDED entry when no native `DOMAIN_RULES` entry already
// exists, and `lib/domain-logic.js` already registers its own native
// "trades" rule (a THIRD, independently-authored vocabulary) that always
// wins. The real fix for the frontend's actual Job/Estimate/MaterialsList/
// Permit/Equipment/Client vocabulary lives on that native rule instead — see
// audit/LENS_DESIGN_UPGRADE_PLAN.md #240 and `domain-logic.js`'s own comment
// at its "trades" entry. Left this entry as-is (harmless, unreachable).
EXTENDED_DOMAIN_RULES.set("trades", {
  types: ["job", "estimate", "material-list", "invoice", "photo-doc"],
  validStatuses: ["draft", "quoted", "scheduled", "in-progress", "completed", "invoiced", "archived"],
  transitions: { draft: ["quoted", "archived"], quoted: ["scheduled", "draft"], scheduled: ["in-progress"], "in-progress": ["completed"], completed: ["invoiced", "archived"], invoiced: ["archived"], archived: [] },
  requiredFields: { job: ["title"] },
  computedFields: (type, data) => { data.materialCost = (data.materials || []).reduce((s, m) => s + (m.cost || 0) * (m.qty || 1), 0); return data; },
  scoring: (type, data) => Math.round(((data.materials || []).length > 0 ? 0.4 : 0.1) * 100) / 100,
});

// === Voice ===
EXTENDED_DOMAIN_RULES.set("voice", {
  types: ["recording", "transcription", "analysis", "summary", "command"],
  validStatuses: ["draft", "recording", "transcribing", "analyzed", "published", "archived"],
  transitions: { draft: ["recording", "archived"], recording: ["transcribing"], transcribing: ["analyzed", "draft"], analyzed: ["published", "archived"], published: ["archived"], archived: [] },
  requiredFields: { recording: ["title"] },
  computedFields: (type, data) => { data.durationSeconds = data.durationSeconds || 0; data.wordCount = (data.transcript || "").split(/\s+/).filter(Boolean).length; return data; },
  scoring: (type, data) => Math.round(((data.durationSeconds || 0) > 0 ? 0.4 : 0.1) * 100) / 100,
});

export { EXTENDED_DOMAIN_RULES };
