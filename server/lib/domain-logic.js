// ── Domain Logic — validation rules, computed fields, transitions & scoring ──
// Each domain entry defines: types, validStatuses, transitions, requiredFields,
// computedFields, and scoring weights used by the Lens artifact system.

const DOMAIN_RULES = new Map();

// Accepts either an ARRAY of vote objects ({voterId, choice, ...}) or a
// Record<voterId, choice> and returns a normalized array of {voterId, choice}
// for read-only derived-field computation. See the "council" rule below for
// the concrete bug this fixes.
function _normalizeVotesForCompute(votes) {
  if (Array.isArray(votes)) return votes;
  if (votes && typeof votes === "object") {
    return Object.entries(votes).map(([voterId, choice]) => ({ voterId, choice }));
  }
  return [];
}

// === Paper (Research) ===
DOMAIN_RULES.set("paper", {
  types: ["research", "review", "survey", "meta-analysis", "preprint", "commentary"],
  validStatuses: ["draft", "in-review", "validated", "published", "retracted", "archived"],
  transitions: {
    draft: ["in-review", "archived"],
    "in-review": ["draft", "validated", "archived"],
    validated: ["published", "in-review", "archived"],
    published: ["retracted", "archived"],
    retracted: ["archived"],
    archived: [],
  },
  requiredFields: { research: ["title"], review: ["title"], survey: ["title"] },
  computedFields: (type, data) => {
    const claims = data.claims || [];
    data.claimCount = claims.length;
    data.validatedClaimCount = claims.filter(c => c.validated).length;
    data.evidenceCoverage = claims.length > 0
      ? Math.round(claims.filter(c => (c.evidence || c.sources || []).length > 0).length / claims.length * 100) / 100
      : 0;
    return data;
  },
  scoring: (type, data) => {
    const claims = data.claims || [];
    if (claims.length === 0) return 0.1;
    const validated = claims.filter(c => c.validated).length / claims.length;
    const evidenced = claims.filter(c => (c.evidence || c.sources || []).length > 0).length / claims.length;
    return Math.round((validated * 0.6 + evidenced * 0.3 + Math.min(claims.length / 10, 1) * 0.1) * 100) / 100;
  },
});

// === Reasoning ===
DOMAIN_RULES.set("reasoning", {
  types: ["deductive", "inductive", "abductive", "analogical", "chain"],
  validStatuses: ["draft", "in-progress", "concluded", "validated", "archived"],
  transitions: {
    draft: ["in-progress", "archived"],
    "in-progress": ["draft", "concluded", "archived"],
    concluded: ["validated", "in-progress", "archived"],
    validated: ["archived"],
    archived: [],
  },
  requiredFields: { deductive: ["premise"], inductive: [] },
  computedFields: (type, data) => {
    const steps = data.steps || [];
    data.stepCount = steps.length;
    data.hasConclusion = !!data.conclusion;
    return data;
  },
  scoring: (type, data) => {
    const steps = data.steps || [];
    if (steps.length === 0) return 0.1;
    const valid = steps.every(s => s.content && s.content.length > 0);
    const hasConclusion = !!data.conclusion;
    return Math.round((valid ? 0.5 : 0.2) + (hasConclusion ? 0.3 : 0) + Math.min(steps.length / 10, 1) * 0.2) * 100 / 100;
  },
});

// === Council (Governance) ===
DOMAIN_RULES.set("council", {
  types: ["proposal", "resolution", "amendment", "budget", "policy"],
  validStatuses: ["draft", "open", "debating", "voting", "passed", "rejected", "archived"],
  transitions: {
    draft: ["open", "archived"],
    open: ["debating", "voting", "archived"],
    debating: ["voting", "open", "archived"],
    voting: ["passed", "rejected", "debating", "archived"],
    passed: ["archived"],
    rejected: ["draft", "archived"],
    archived: [],
  },
  requiredFields: { proposal: ["title"] },
  // `data.votes` arrives in two real shapes depending on the caller: an ARRAY
  // of { voterId, choice, ... } (the registerLensAction("council","vote"/"audit", ...)
  // handlers in server.js), or a Record<voterId, choice> (the council lens
  // frontend's own `Proposal.votes` type — concord-frontend/app/lenses/council/
  // page.tsx). Both are real, both are in production use. The array-only
  // assumption below used to call `.map`/`.forEach` directly on `data.votes`,
  // which threw `votes.map is not a function` for EVERY update to a proposal
  // artifact carrying Record-shaped votes (including the default empty `{}`
  // every freshly-created proposal starts with) — i.e. every vote cast, status
  // advance, comment, or amendment on a real proposal 500'd. Verified live via
  // runMacro("lens","update",...) before this fix; pinned by
  // tests/domain-logic-council-votes.test.js. `_normalizeVotesForCompute` reads
  // both shapes for the derived-field computation below WITHOUT mutating the
  // stored `data.votes` value itself — callers that persisted a Record keep
  // reading back a Record; only the derived voteCount/uniqueVoters/voteTally/
  // hasVotes fields become shape-agnostic.
  computedFields: (type, data) => {
    const votes = _normalizeVotesForCompute(data.votes);
    data.voteCount = votes.length;
    data.uniqueVoters = [...new Set(votes.map(v => v.voterId))].length;
    if (votes.length > 0) {
      const tally = {};
      votes.forEach(v => { tally[v.choice || "abstain"] = (tally[v.choice || "abstain"] || 0) + 1; });
      data.voteTally = tally;
    }
    return data;
  },
  scoring: (type, data) => {
    const votes = _normalizeVotesForCompute(data.votes);
    const debate = data.debate || {};
    const hasDebate = !!(debate.turns && debate.turns.length > 0);
    const hasVotes = votes.length > 0;
    const hasBudget = !!data.budget;
    return Math.round(((hasDebate ? 0.3 : 0) + (hasVotes ? 0.4 : 0) + (hasBudget ? 0.2 : 0) + 0.1) * 100) / 100;
  },
});

// === Agents ===
DOMAIN_RULES.set("agents", {
  types: ["agent", "swarm", "pipeline", "orchestrator", "worker"],
  validStatuses: ["draft", "configured", "active", "paused", "stopped", "error", "archived"],
  transitions: {
    draft: ["configured", "archived"],
    configured: ["active", "draft", "archived"],
    active: ["paused", "stopped", "error"],
    paused: ["active", "stopped", "archived"],
    stopped: ["configured", "archived"],
    error: ["stopped", "configured", "archived"],
    archived: [],
  },
  requiredFields: { agent: ["title"] },
  computedFields: (type, data) => {
    data.isRunning = data.status === "active";
    return data;
  },
  scoring: (type, data) => {
    const hasConfig = !!data.config || !!data.parameters;
    const isActive = data.status === "active";
    return Math.round(((hasConfig ? 0.4 : 0.1) + (isActive ? 0.4 : 0.1) + 0.1) * 100) / 100;
  },
});

// === Sim (Simulation) ===
DOMAIN_RULES.set("sim", {
  types: ["scenario", "monte-carlo", "agent-based", "system-dynamics", "discrete-event"],
  validStatuses: ["draft", "configured", "running", "completed", "archived"],
  transitions: {
    draft: ["configured", "archived"],
    configured: ["running", "draft", "archived"],
    running: ["completed", "configured"],
    completed: ["configured", "archived"],
    archived: [],
  },
  requiredFields: { scenario: ["title"] },
  computedFields: (type, data) => {
    data.runCount = data.runCount || 0;
    data.hasResults = !!data.lastRun;
    return data;
  },
  scoring: (type, data) => {
    const assumptions = data.assumptions || [];
    const hasRun = !!data.lastRun;
    const runs = data.runs || [];
    return Math.round((
      Math.min(assumptions.length / 5, 1) * 0.3 +
      (hasRun ? 0.4 : 0) +
      Math.min(runs.length / 5, 1) * 0.2 +
      0.1
    ) * 100) / 100;
  },
});

// === Studio (Creative / Audio) ===
DOMAIN_RULES.set("studio", {
  types: ["project", "track", "session", "stem", "mix", "master"],
  validStatuses: ["draft", "recording", "mixing", "mastering", "released", "archived"],
  transitions: {
    draft: ["recording", "mixing", "archived"],
    recording: ["mixing", "draft", "archived"],
    mixing: ["mastering", "recording", "archived"],
    mastering: ["released", "mixing", "archived"],
    released: ["archived"],
    archived: [],
  },
  requiredFields: { project: ["title"] },
  computedFields: (type, data) => {
    const tracks = data.tracks || [];
    data.trackCount = tracks.length;
    data.activeTracks = tracks.filter(t => !t.muted).length;
    data.isMixed = data.mixStatus === "mixed";
    data.isMastered = data.masterStatus === "mastered";
    return data;
  },
  scoring: (type, data) => {
    const tracks = data.tracks || [];
    const isMixed = data.mixStatus === "mixed";
    const isMastered = data.masterStatus === "mastered";
    return Math.round((
      Math.min(tracks.length / 8, 1) * 0.3 +
      (isMixed ? 0.3 : 0) +
      (isMastered ? 0.3 : 0) +
      0.1
    ) * 100) / 100;
  },
});

// === Law (Legal) ===
DOMAIN_RULES.set("law", {
  types: ["case", "contract", "opinion", "brief", "regulation", "compliance-report"],
  validStatuses: ["draft", "review", "filed", "active", "closed", "archived"],
  transitions: {
    draft: ["review", "archived"],
    review: ["filed", "draft", "archived"],
    filed: ["active", "archived"],
    active: ["closed", "archived"],
    closed: ["archived"],
    archived: [],
  },
  requiredFields: { case: ["title"] },
  computedFields: (type, data) => {
    data.citationCount = (data.citations || []).length;
    data.draftCount = (data.drafts || []).length;
    return data;
  },
  scoring: (type, data) => {
    const citations = (data.citations || []).length;
    const drafts = (data.drafts || []).length;
    const hasBody = !!(data.body && data.body.length > 50);
    return Math.round((
      (hasBody ? 0.3 : 0.1) +
      Math.min(citations / 5, 1) * 0.3 +
      Math.min(drafts / 3, 1) * 0.2 +
      0.1
    ) * 100) / 100;
  },
});

// === Graph (Knowledge Graph) ===
DOMAIN_RULES.set("graph", {
  types: ["knowledge-graph", "concept-map", "ontology", "network", "taxonomy"],
  validStatuses: ["draft", "building", "stable", "published", "archived"],
  transitions: {
    draft: ["building", "archived"],
    building: ["stable", "draft", "archived"],
    stable: ["published", "building", "archived"],
    published: ["building", "archived"],
    archived: [],
  },
  requiredFields: { "knowledge-graph": [] },
  computedFields: (type, data) => {
    const nodes = data.nodes || [];
    const edges = data.edges || [];
    data.nodeCount = nodes.length;
    data.edgeCount = edges.length;
    data.density = nodes.length > 1
      ? Math.round(edges.length / (nodes.length * (nodes.length - 1) / 2) * 10000) / 10000
      : 0;
    return data;
  },
  scoring: (type, data) => {
    const nodes = (data.nodes || []).length;
    const edges = (data.edges || []).length;
    const hasStructure = nodes > 0 && edges > 0;
    return Math.round((
      Math.min(nodes / 20, 1) * 0.3 +
      Math.min(edges / 30, 1) * 0.3 +
      (hasStructure ? 0.3 : 0) +
      0.1
    ) * 100) / 100;
  },
});

// === Whiteboard (Collaboration) ===
DOMAIN_RULES.set("whiteboard", {
  types: ["board", "canvas", "diagram", "sketch", "wireframe"],
  validStatuses: ["draft", "active", "shared", "locked", "archived"],
  transitions: {
    draft: ["active", "archived"],
    active: ["shared", "locked", "archived"],
    shared: ["active", "locked", "archived"],
    locked: ["active", "archived"],
    archived: [],
  },
  requiredFields: { board: [] },
  computedFields: (type, data) => {
    const elements = data.elements || [];
    data.elementCount = elements.length;
    return data;
  },
  scoring: (type, data) => {
    const elements = (data.elements || []).length;
    return Math.round((Math.min(elements / 10, 1) * 0.7 + 0.1 + (elements > 0 ? 0.2 : 0)) * 100) / 100;
  },
});

// === Chat (Conversational AI) ===
DOMAIN_RULES.set("chat", {
  types: ["conversation", "thread", "summary", "forged", "analysis"],
  validStatuses: ["active", "archived", "pinned", "exported"],
  transitions: {
    active: ["archived", "pinned", "exported"],
    pinned: ["active", "archived", "exported"],
    archived: ["active"],
    exported: ["archived"],
  },
  requiredFields: { conversation: ["title"] },
  computedFields: (type, data) => {
    const messages = data.messages || [];
    data.messageCount = messages.length;
    data.userMessageCount = messages.filter(m => m.role === "user").length;
    data.assistantMessageCount = messages.filter(m => m.role === "assistant").length;
    data.avgResponseLength = data.assistantMessageCount > 0
      ? Math.round(messages.filter(m => m.role === "assistant").reduce((s, m) => s + (m.content || "").length, 0) / data.assistantMessageCount)
      : 0;
    data.hasFeedback = messages.some(m => m.feedbackGiven);
    data.pinnedCount = messages.filter(m => m.pinned).length;
    return data;
  },
  scoring: (type, data) => {
    const msgs = (data.messages || []).length;
    if (msgs === 0) return 0.1;
    const depth = Math.min(msgs / 20, 1) * 0.4;
    const feedback = data.hasFeedback ? 0.2 : 0;
    const pinned = data.pinnedCount > 0 ? 0.1 : 0;
    return Math.round((depth + feedback + pinned + 0.2) * 100) / 100;
  },
});

// === Feed (Social) ===
DOMAIN_RULES.set("feed", {
  types: ["post", "article", "link", "media", "poll"],
  validStatuses: ["draft", "published", "archived", "flagged"],
  transitions: {
    draft: ["published", "archived"],
    published: ["archived", "flagged"],
    flagged: ["published", "archived"],
    archived: [],
  },
  requiredFields: { post: ["content"] },
  computedFields: (type, data) => {
    data.likeCount = data.likes?.length || 0;
    data.commentCount = data.comments?.length || 0;
    data.repostCount = data.reposts?.length || 0;
    data.engagementScore = data.likeCount + data.commentCount * 2 + data.repostCount * 3;
    return data;
  },
  scoring: (type, data) => {
    const engagement = data.engagementScore || 0;
    return Math.round(Math.min(engagement / 50, 1) * 100) / 100;
  },
});

// === Forum ===
DOMAIN_RULES.set("forum", {
  types: ["thread", "reply", "announcement", "poll"],
  validStatuses: ["open", "closed", "pinned", "locked", "archived"],
  transitions: {
    open: ["closed", "pinned", "locked", "archived"],
    pinned: ["open", "closed", "locked"],
    closed: ["open", "archived"],
    locked: ["open", "archived"],
    archived: [],
  },
  requiredFields: { thread: ["title", "content"] },
  computedFields: (type, data) => {
    data.replyCount = data.replies?.length || 0;
    data.voteScore = (data.upvotes || 0) - (data.downvotes || 0);
    return data;
  },
  scoring: (type, data) => {
    const replies = data.replyCount || 0;
    const votes = Math.max(data.voteScore || 0, 0);
    return Math.round((Math.min(replies / 20, 1) * 0.5 + Math.min(votes / 10, 1) * 0.3 + 0.1) * 100) / 100;
  },
});

// === Marketplace ===
DOMAIN_RULES.set("marketplace", {
  types: ["template", "component", "dataset", "artwork", "plugin", "preset"],
  validStatuses: ["draft", "listed", "sold", "suspended", "archived"],
  transitions: {
    draft: ["listed", "archived"],
    listed: ["sold", "suspended", "archived"],
    sold: ["listed", "archived"],
    suspended: ["listed", "archived"],
    archived: [],
  },
  requiredFields: { template: ["title", "price"], component: ["title", "price"] },
  computedFields: (type, data) => {
    data.salesCount = data.purchases?.length || 0;
    data.totalRevenue = (data.purchases || []).reduce((s, p) => s + (p.price || 0), 0);
    data.avgRating = data.ratings?.length > 0
      ? Math.round(data.ratings.reduce((s, r) => s + r.score, 0) / data.ratings.length * 10) / 10
      : 0;
    return data;
  },
  scoring: (type, data) => {
    const sales = data.salesCount || 0;
    const rating = data.avgRating || 0;
    return Math.round((Math.min(sales / 10, 1) * 0.4 + (rating / 5) * 0.4 + 0.1) * 100) / 100;
  },
});

// === Wallet ===
DOMAIN_RULES.set("wallet", {
  types: ["transaction", "transfer", "purchase", "withdrawal", "earning", "tip"],
  validStatuses: ["pending", "processing", "completed", "failed", "reversed"],
  transitions: {
    pending: ["processing", "completed", "failed"],
    processing: ["completed", "failed"],
    completed: ["reversed"],
    failed: [],
    reversed: [],
  },
  requiredFields: { transaction: ["amount"], transfer: ["amount", "to"] },
  computedFields: (type, data) => {
    data.fee = data.fee || 0;
    data.net = (data.amount || 0) - (data.fee || 0);
    data.isCredit = data.amount > 0;
    return data;
  },
  scoring: (type, data) => {
    const amount = Math.abs(data.amount || 0);
    return Math.round(Math.min(amount / 1000, 1) * 100) / 100;
  },
});

// === Music ===
DOMAIN_RULES.set("music", {
  types: ["track", "album", "playlist", "sample", "beat", "remix"],
  validStatuses: ["draft", "recording", "mixing", "mastering", "released", "archived"],
  transitions: {
    draft: ["recording", "archived"],
    recording: ["mixing", "archived"],
    mixing: ["mastering", "recording"],
    mastering: ["released", "mixing"],
    released: ["archived"],
    archived: [],
  },
  requiredFields: { track: ["title"], album: ["title"] },
  computedFields: (type, data) => {
    data.trackCount = data.tracks?.length || 0;
    data.totalDuration = (data.tracks || []).reduce((s, t) => s + (t.duration || 0), 0);
    data.playCount = data.plays || 0;
    return data;
  },
  scoring: (type, data) => {
    const plays = data.playCount || 0;
    const tracks = data.trackCount || 0;
    return Math.round((Math.min(plays / 1000, 1) * 0.5 + Math.min(tracks / 10, 1) * 0.3 + 0.1) * 100) / 100;
  },
});

// === Artistry / Art ===
DOMAIN_RULES.set("artistry", {
  types: ["painting", "illustration", "sculpture", "photography", "digital", "mixed-media"],
  validStatuses: ["concept", "in-progress", "review", "published", "exhibited", "archived"],
  transitions: {
    concept: ["in-progress", "archived"],
    "in-progress": ["review", "concept"],
    review: ["published", "in-progress"],
    published: ["exhibited", "archived"],
    exhibited: ["archived"],
    archived: [],
  },
  requiredFields: { painting: ["title"], illustration: ["title"] },
  computedFields: (type, data) => {
    data.viewCount = data.views || 0;
    data.likeCount = data.likes || 0;
    data.commentCount = data.comments?.length || 0;
    return data;
  },
  scoring: (type, data) => {
    const views = data.viewCount || 0;
    const likes = data.likeCount || 0;
    return Math.round((Math.min(views / 500, 1) * 0.3 + Math.min(likes / 50, 1) * 0.5 + 0.1) * 100) / 100;
  },
});

// === Code ===
DOMAIN_RULES.set("code", {
  types: ["snippet", "project", "pipeline", "notebook", "algorithm", "library"],
  validStatuses: ["draft", "development", "testing", "review", "deployed", "archived"],
  transitions: {
    draft: ["development", "archived"],
    development: ["testing", "review", "archived"],
    testing: ["review", "development"],
    review: ["deployed", "development"],
    deployed: ["archived", "development"],
    archived: [],
  },
  requiredFields: { snippet: ["title", "language"], project: ["title"] },
  computedFields: (type, data) => {
    data.lineCount = data.lines || 0;
    data.language = data.language || "javascript";
    data.hasTests = !!(data.tests && data.tests.length > 0);
    return data;
  },
  scoring: (type, data) => {
    const lines = data.lineCount || 0;
    const hasTests = data.hasTests ? 1 : 0;
    return Math.round((Math.min(lines / 500, 1) * 0.4 + hasTests * 0.3 + 0.1) * 100) / 100;
  },
});

// === Creative Writing ===
DOMAIN_RULES.set("creative-writing", {
  types: ["story", "poem", "essay", "screenplay", "novel-chapter", "flash-fiction"],
  validStatuses: ["idea", "drafting", "revision", "editing", "published", "archived"],
  transitions: {
    idea: ["drafting", "archived"],
    drafting: ["revision", "idea"],
    revision: ["editing", "drafting"],
    editing: ["published", "revision"],
    published: ["archived"],
    archived: [],
  },
  requiredFields: { story: ["title"], poem: ["title"] },
  computedFields: (type, data) => {
    data.wordCount = typeof data.content === "string" ? data.content.split(/\s+/).filter(Boolean).length : 0;
    data.readTime = Math.ceil((data.wordCount || 0) / 200);
    data.revisionCount = data.revisions?.length || 0;
    return data;
  },
  scoring: (type, data) => {
    const words = data.wordCount || 0;
    const revisions = data.revisionCount || 0;
    return Math.round((Math.min(words / 2000, 1) * 0.4 + Math.min(revisions / 5, 1) * 0.3 + 0.1) * 100) / 100;
  },
});

// === Research ===
DOMAIN_RULES.set("research", {
  types: ["paper", "dataset", "experiment", "literature-review", "thesis", "grant-proposal"],
  validStatuses: ["draft", "in-review", "peer-reviewed", "published", "retracted", "archived"],
  transitions: {
    draft: ["in-review", "archived"],
    "in-review": ["draft", "peer-reviewed", "archived"],
    "peer-reviewed": ["published", "in-review", "archived"],
    published: ["retracted", "archived"],
    retracted: ["archived"],
    archived: [],
  },
  requiredFields: { paper: ["title", "abstract"], dataset: ["title", "format"] },
  computedFields: (type, data) => {
    const citations = data.citations || [];
    data.citationCount = citations.length;
    data.hasPeerReview = data.reviewers?.length > 0;
    data.hasAbstract = !!data.abstract;
    return data;
  },
  scoring: (type, data) => {
    const citations = data.citationCount || 0;
    const hasPeerReview = data.hasPeerReview ? 1 : 0;
    const hasAbstract = data.hasAbstract ? 1 : 0;
    return Math.round((Math.min(citations / 20, 1) * 0.4 + hasPeerReview * 0.3 + hasAbstract * 0.2 + 0.1) * 100) / 100;
  },
});

// === Education ===
DOMAIN_RULES.set("education", {
  types: ["course", "lesson", "quiz", "assignment", "curriculum", "certificate"],
  validStatuses: ["draft", "active", "in-progress", "completed", "graded", "archived"],
  transitions: {
    draft: ["active", "archived"],
    active: ["in-progress", "draft", "archived"],
    "in-progress": ["completed", "active"],
    completed: ["graded", "archived"],
    graded: ["archived"],
    archived: [],
  },
  requiredFields: { course: ["title"], lesson: ["title"], quiz: ["title", "questions"] },
  computedFields: (type, data) => {
    const lessons = data.lessons || [];
    data.lessonCount = lessons.length;
    data.completedLessons = lessons.filter(l => l.completed).length;
    data.progressPercent = lessons.length > 0 ? Math.round((data.completedLessons / lessons.length) * 100) : 0;
    data.totalDuration = lessons.reduce((sum, l) => sum + (l.durationMinutes || 0), 0);
    return data;
  },
  scoring: (type, data) => {
    const progress = (data.progressPercent || 0) / 100;
    const hasQuiz = data.quizzes?.length > 0 ? 1 : 0;
    return Math.round((progress * 0.5 + hasQuiz * 0.2 + Math.min((data.lessonCount || 0) / 10, 1) * 0.2 + 0.1) * 100) / 100;
  },
});

// === Physics ===
DOMAIN_RULES.set("physics", {
  types: ["simulation", "equation", "experiment", "model", "derivation", "problem-set"],
  validStatuses: ["draft", "hypothesis", "testing", "validated", "published", "archived"],
  transitions: {
    draft: ["hypothesis", "archived"],
    hypothesis: ["testing", "draft", "archived"],
    testing: ["validated", "hypothesis", "archived"],
    validated: ["published", "testing", "archived"],
    published: ["archived"],
    archived: [],
  },
  requiredFields: { simulation: ["title", "parameters"], equation: ["title", "expression"] },
  computedFields: (type, data) => {
    data.hasSimulation = !!data.simulationData;
    data.parameterCount = Object.keys(data.parameters || {}).length;
    data.unitConsistency = data.units ? "verified" : "unchecked";
    return data;
  },
  scoring: (type, data) => {
    const hasSimulation = data.hasSimulation ? 1 : 0;
    const params = Math.min((data.parameterCount || 0) / 5, 1);
    const verified = data.unitConsistency === "verified" ? 1 : 0;
    return Math.round((hasSimulation * 0.3 + params * 0.3 + verified * 0.3 + 0.1) * 100) / 100;
  },
});

// === Math ===
DOMAIN_RULES.set("math", {
  types: ["proof", "theorem", "problem", "formula", "visualization", "notebook"],
  validStatuses: ["draft", "conjecture", "in-proof", "proven", "published", "archived"],
  transitions: {
    draft: ["conjecture", "in-proof", "archived"],
    conjecture: ["in-proof", "draft", "archived"],
    "in-proof": ["proven", "conjecture", "archived"],
    proven: ["published", "archived"],
    published: ["archived"],
    archived: [],
  },
  requiredFields: { proof: ["title", "statement"], theorem: ["title", "statement"] },
  computedFields: (type, data) => {
    data.stepCount = (data.steps || []).length;
    data.hasVisualization = !!data.visualization;
    data.complexity = data.stepCount > 10 ? "high" : data.stepCount > 5 ? "medium" : "low";
    return data;
  },
  scoring: (type, data) => {
    const steps = Math.min((data.stepCount || 0) / 10, 1);
    const hasViz = data.hasVisualization ? 1 : 0;
    const isProven = data.status === "proven" || data.status === "published" ? 1 : 0;
    return Math.round((steps * 0.3 + hasViz * 0.2 + isProven * 0.4 + 0.1) * 100) / 100;
  },
});

// === Science ===
DOMAIN_RULES.set("science", {
  types: ["experiment", "observation", "hypothesis", "lab-report", "field-study", "meta-analysis"],
  validStatuses: ["draft", "hypothesis", "experimenting", "analyzing", "concluded", "published", "archived"],
  transitions: {
    draft: ["hypothesis", "archived"],
    hypothesis: ["experimenting", "draft", "archived"],
    experimenting: ["analyzing", "hypothesis", "archived"],
    analyzing: ["concluded", "experimenting", "archived"],
    concluded: ["published", "analyzing", "archived"],
    published: ["archived"],
    archived: [],
  },
  requiredFields: { experiment: ["title", "hypothesis"], "lab-report": ["title", "methodology"] },
  computedFields: (type, data) => {
    const dataPoints = data.dataPoints || [];
    data.dataPointCount = dataPoints.length;
    data.hasControls = !!data.controlGroup;
    data.reproducible = data.methodology && data.results ? true : false;
    return data;
  },
  scoring: (type, data) => {
    const dataPoints = Math.min((data.dataPointCount || 0) / 50, 1);
    const hasControls = data.hasControls ? 1 : 0;
    const reproducible = data.reproducible ? 1 : 0;
    return Math.round((dataPoints * 0.3 + hasControls * 0.3 + reproducible * 0.3 + 0.1) * 100) / 100;
  },
});

// === Healthcare ===
DOMAIN_RULES.set("healthcare", {
  types: ["patient-record", "diagnosis", "treatment-plan", "lab-result", "prescription", "clinical-note"],
  validStatuses: ["draft", "active", "in-treatment", "monitoring", "resolved", "archived"],
  transitions: {
    draft: ["active", "archived"],
    active: ["in-treatment", "monitoring", "archived"],
    "in-treatment": ["monitoring", "active", "resolved"],
    monitoring: ["resolved", "active", "in-treatment"],
    resolved: ["archived", "active"],
    archived: [],
  },
  requiredFields: { "patient-record": ["patientId"], diagnosis: ["condition"], prescription: ["medication", "dosage"] },
  computedFields: (type, data) => {
    data.hasLabResults = (data.labResults || []).length > 0;
    data.medicationCount = (data.medications || []).length;
    data.isCompliant = data.compliance === "compliant";
    return data;
  },
  scoring: (type, data) => {
    const hasLab = data.hasLabResults ? 1 : 0;
    const compliant = data.isCompliant ? 1 : 0;
    const meds = Math.min((data.medicationCount || 0) / 5, 1);
    return Math.round((hasLab * 0.3 + compliant * 0.3 + meds * 0.2 + 0.2) * 100) / 100;
  },
});

// === Trades ===
// This rule was authored for a generic "project/estimate/work-order/
// inspection/invoice/certification" trade-ops shape that was never
// reconciled against the real frontend (`app/lenses/trades/page.tsx`, a
// genuine ServiceTitan/Jobber-parity dispatch board) — the same class of
// stale-vocabulary bug found and fixed for `services`/`security`
// (audit/LENS_DESIGN_UPGRADE_PLAN.md #214/#211). The real page's own
// `ArtifactType` union is `Job | Estimate | MaterialsList | Permit |
// Equipment | Client` and its real `Status` union is `quoted | approved |
// in_progress | inspection | completed | invoiced | paid` — every real
// create/status-update from the UI failed `validateArtifact` against the
// old vocabulary (audit doc #240).
DOMAIN_RULES.set("trades", {
  types: ["Job", "Estimate", "MaterialsList", "Permit", "Equipment", "Client"],
  validStatuses: ["quoted", "approved", "in_progress", "inspection", "completed", "invoiced", "paid"],
  requiredFields: { Job: ["title"], Estimate: ["title"], MaterialsList: ["title"], Permit: ["title"], Equipment: ["title"], Client: ["title"] },
  computedFields: (type, data) => {
    const items = data.lineItems || [];
    data.lineItemCount = items.length;
    data.totalCost = items.reduce((sum, i) => sum + (i.cost || 0), 0);
    data.laborHours = items.reduce((sum, i) => sum + (i.hours || 0), 0);
    data.passedInspection = data.inspectionResult === "pass";
    return data;
  },
  scoring: (type, data) => {
    const items = Math.min((data.lineItemCount || 0) / 10, 1);
    const passed = data.passedInspection ? 1 : 0;
    const hasEstimate = data.totalCost > 0 ? 1 : 0;
    return Math.round((items * 0.3 + passed * 0.3 + hasEstimate * 0.3 + 0.1) * 100) / 100;
  },
});

// === Finance ===
DOMAIN_RULES.set("finance", {
  types: ["portfolio", "analysis", "report", "forecast", "transaction-log", "budget"],
  validStatuses: ["draft", "active", "under-review", "approved", "closed", "archived"],
  transitions: {
    draft: ["active", "under-review", "archived"],
    active: ["under-review", "closed"],
    "under-review": ["approved", "active", "draft"],
    approved: ["closed", "archived"],
    closed: ["archived"],
    archived: [],
  },
  requiredFields: { portfolio: ["title"], analysis: ["title", "dataSource"], budget: ["title", "period"] },
  computedFields: (type, data) => {
    const holdings = data.holdings || [];
    data.holdingCount = holdings.length;
    data.totalValue = holdings.reduce((sum, h) => sum + (h.value || 0), 0);
    data.hasRiskAssessment = !!data.riskScore;
    data.returnRate = data.totalReturn && data.initialInvestment ? ((data.totalReturn / data.initialInvestment - 1) * 100).toFixed(2) : null;
    return data;
  },
  scoring: (type, data) => {
    const holdings = Math.min((data.holdingCount || 0) / 20, 1);
    const hasRisk = data.hasRiskAssessment ? 1 : 0;
    const hasReturn = data.returnRate !== null ? 1 : 0;
    return Math.round((holdings * 0.3 + hasRisk * 0.3 + hasReturn * 0.3 + 0.1) * 100) / 100;
  },
});

// === Engineering ===
DOMAIN_RULES.set("engineering", {
  types: ["design", "specification", "blueprint", "simulation", "test-report", "bom"],
  validStatuses: ["draft", "in-design", "review", "approved", "fabrication", "testing", "released", "archived"],
  transitions: {
    draft: ["in-design", "archived"],
    "in-design": ["review", "draft"],
    review: ["approved", "in-design"],
    approved: ["fabrication", "testing", "released"],
    fabrication: ["testing", "approved"],
    testing: ["released", "fabrication"],
    released: ["archived"],
    archived: [],
  },
  requiredFields: { design: ["title", "revision"], specification: ["title"], blueprint: ["title"] },
  computedFields: (type, data) => {
    data.revisionNumber = data.revision || "A";
    data.componentCount = (data.components || []).length;
    data.hasSimulation = !!data.simulationData;
    data.testsPassed = (data.tests || []).filter(t => t.passed).length;
    data.totalTests = (data.tests || []).length;
    return data;
  },
  scoring: (type, data) => {
    const components = Math.min((data.componentCount || 0) / 20, 1);
    const hasSim = data.hasSimulation ? 1 : 0;
    const testRatio = data.totalTests > 0 ? data.testsPassed / data.totalTests : 0;
    return Math.round((components * 0.2 + hasSim * 0.3 + testRatio * 0.4 + 0.1) * 100) / 100;
  },
});

// === World ===
DOMAIN_RULES.set("world", {
  types: ["region", "event", "entity-link", "timeline", "map-layer", "narrative"],
  validStatuses: ["draft", "active", "historical", "projected", "archived"],
  transitions: {
    draft: ["active", "archived"],
    active: ["historical", "archived"],
    historical: ["archived"],
    projected: ["active", "archived"],
    archived: [],
  },
  requiredFields: { region: ["title"], event: ["title", "date"] },
  computedFields: (type, data) => {
    data.entityCount = (data.entities || []).length;
    data.eventCount = (data.events || []).length;
    data.hasTimeline = (data.timeline || []).length > 0;
    return data;
  },
  scoring: (type, data) => {
    const entities = Math.min((data.entityCount || 0) / 20, 1);
    const events = Math.min((data.eventCount || 0) / 10, 1);
    const timeline = data.hasTimeline ? 1 : 0;
    return Math.round((entities * 0.3 + events * 0.3 + timeline * 0.3 + 0.1) * 100) / 100;
  },
});

// === Entity ===
DOMAIN_RULES.set("entity", {
  types: ["person", "organization", "concept", "location", "artifact", "system"],
  validStatuses: ["draft", "active", "verified", "deprecated", "archived"],
  transitions: {
    draft: ["active", "archived"],
    active: ["verified", "deprecated", "archived"],
    verified: ["deprecated", "archived"],
    deprecated: ["archived"],
    archived: [],
  },
  requiredFields: { person: ["name"], organization: ["name"], concept: ["title"] },
  computedFields: (type, data) => {
    data.relationCount = (data.relations || []).length;
    data.attributeCount = Object.keys(data.attributes || {}).length;
    data.hasDescription = !!data.description;
    return data;
  },
  scoring: (type, data) => {
    const relations = Math.min((data.relationCount || 0) / 10, 1);
    const attrs = Math.min((data.attributeCount || 0) / 5, 1);
    const hasDesc = data.hasDescription ? 1 : 0;
    return Math.round((relations * 0.3 + attrs * 0.3 + hasDesc * 0.3 + 0.1) * 100) / 100;
  },
});

// === Admin ===
DOMAIN_RULES.set("admin", {
  types: ["config", "user-management", "audit-log", "permission", "system-report", "integration"],
  validStatuses: ["draft", "active", "review", "approved", "suspended", "archived"],
  transitions: {
    draft: ["active", "review", "archived"],
    active: ["review", "suspended", "archived"],
    review: ["approved", "active"],
    approved: ["active", "archived"],
    suspended: ["active", "archived"],
    archived: [],
  },
  requiredFields: { config: ["key", "value"], permission: ["role", "resource"] },
  computedFields: (type, data) => {
    data.userCount = (data.users || []).length;
    data.activeIntegrations = (data.integrations || []).filter(i => i.active).length;
    data.auditEntries = (data.auditLog || []).length;
    return data;
  },
  scoring: (type, data) => {
    const users = Math.min((data.userCount || 0) / 100, 1);
    const integrations = Math.min((data.activeIntegrations || 0) / 5, 1);
    const audit = Math.min((data.auditEntries || 0) / 50, 1);
    return Math.round((users * 0.3 + integrations * 0.3 + audit * 0.3 + 0.1) * 100) / 100;
  },
});

// ── Exported helpers ─────────────────────────────────────────────────────────

function validateArtifact(domain, type, data, meta) {
  const rule = DOMAIN_RULES.get(domain);
  const errors = [];
  const warnings = [];

  if (!rule) {
    // Unknown domains pass validation with a warning
    warnings.push(`Unknown domain "${domain}" — no validation rules applied`);
    return { ok: true, errors, warnings };
  }

  // Type check
  if (rule.types.length > 0 && !rule.types.includes(type)) {
    errors.push(`Invalid type "${type}" for domain "${domain}". Valid types: ${rule.types.join(", ")}`);
  }

  // Status check
  if (meta?.status && rule.validStatuses.length > 0 && !rule.validStatuses.includes(meta.status)) {
    errors.push(`Invalid status "${meta.status}" for domain "${domain}". Valid statuses: ${rule.validStatuses.join(", ")}`);
  }

  // Required fields
  const required = rule.requiredFields?.[type] || [];
  for (const field of required) {
    if (data[field] === undefined || data[field] === null || data[field] === "") {
      warnings.push(`Recommended field "${field}" is missing for ${domain}/${type}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function computeFields(domain, type, data) {
  const rule = DOMAIN_RULES.get(domain);
  if (rule?.computedFields) {
    return rule.computedFields(type, data);
  }
  return data;
}

function getValidTransitions(domain, currentStatus) {
  const rule = DOMAIN_RULES.get(domain);
  if (!rule?.transitions) return [];
  return rule.transitions[currentStatus] || [];
}

function scoreArtifact(domain, type, data) {
  const rule = DOMAIN_RULES.get(domain);
  if (rule?.scoring) {
    return rule.scoring(type, data);
  }
  return 0.1; // minimal score for unknown domains
}

function getDomainSchema(domain) {
  const rule = DOMAIN_RULES.get(domain);
  if (!rule) {
    return { domain, known: false, types: [], validStatuses: [], transitions: {} };
  }
  return {
    domain,
    known: true,
    types: rule.types,
    validStatuses: rule.validStatuses,
    transitions: rule.transitions,
    requiredFields: rule.requiredFields || {},
  };
}

export { DOMAIN_RULES, validateArtifact, computeFields, getValidTransitions, scoreArtifact, getDomainSchema };
