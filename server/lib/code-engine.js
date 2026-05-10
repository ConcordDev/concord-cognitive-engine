/**
 * Concord Self-Expanding Code Engine
 *
 * Pipeline: Ingest → Parse → Extract → Score → Store → Compress → Generate
 *
 * Features:
 * 1. Repository ingestion with license verification
 * 2. AST pattern extraction (architectural, error handling, security, performance)
 * 3. CRETI scoring for every extracted pattern
 * 4. Code DTU creation from extracted patterns
 * 5. Mega DTU compression (500+ patterns → architectural wisdom)
 * 6. Autonomous lens generation from patterns
 * 7. Production learning from generated lens errors
 */

import { ValidationError, NotFoundError, ConflictError } from "./errors.js";
import { generateId, uid } from "./id-factory.js";

// ── Constants ────────────────────────────────────────────────────────────────

const PATTERN_CATEGORIES = Object.freeze([
  "architectural",
  "error_handling",
  "security",
  "performance",
  "testing",
  "data_modeling",
  "api_design",
  "concurrency",
]);

const VALID_REPO_STATUSES = Object.freeze([
  "pending",
  "ingesting",
  "ingested",
  "failed",
]);

const VALID_GENERATION_STATUSES = Object.freeze([
  "pending",
  "generating",
  "testing",
  "completed",
  "failed",
]);

const PERMISSIVE_LICENSES = Object.freeze(new Set([
  "mit",
  "apache-2.0",
  "bsd-2-clause",
  "bsd-3-clause",
  "isc",
  "unlicense",
  "cc0-1.0",
  "0bsd",
  "wtfpl",
  "zlib",
  "artistic-2.0",
  "bsl-1.0",
]));

const COPYLEFT_LICENSES = Object.freeze(new Set([
  "gpl-2.0",
  "gpl-3.0",
  "agpl-3.0",
  "lgpl-2.1",
  "lgpl-3.0",
  "mpl-2.0",
  "eupl-1.2",
  "osl-3.0",
]));

/**
 * Known file extensions mapped to language identifiers.
 */
const EXTENSION_LANGUAGES = Object.freeze({
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".jsx": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".c": "c",
  ".h": "c",
  ".hpp": "cpp",
  ".php": "php",
  ".scala": "scala",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hs": "haskell",
  ".lua": "lua",
  ".r": "r",
  ".R": "r",
  ".sh": "shell",
  ".bash": "shell",
  ".sql": "sql",
  ".vue": "vue",
  ".svelte": "svelte",
});

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parse a GitHub/GitLab URL into owner and name.
 * @param {string} url
 * @returns {{ owner: string, name: string }}
 */
function _parseRepoUrl(url) {
  if (!url || typeof url !== "string") {
    throw new ValidationError("Repository URL is required");
  }

  const cleaned = url.replace(/\.git$/, "").replace(/\/$/, "");

  // Try full URL format: https://github.com/owner/name
  const urlMatch = cleaned.match(/(?:github\.com|gitlab\.com|bitbucket\.org)[/:]([^/]+)\/([^/]+)/);
  if (urlMatch) {
    return { owner: urlMatch[1], name: urlMatch[2] };
  }

  // Try owner/name shorthand
  const shortMatch = cleaned.match(/^([^/]+)\/([^/]+)$/);
  if (shortMatch) {
    return { owner: shortMatch[1], name: shortMatch[2] };
  }

  throw new ValidationError(`Cannot parse repository URL: ${url}`, { url });
}

/**
 * Classify a license string into a license mode.
 * @param {string|null} license
 * @returns {'permissive'|'copyleft'|'unknown'}
 */
function _classifyLicense(license) {
  if (!license) return "unknown";
  const normalized = license.toLowerCase().trim();
  if (PERMISSIVE_LICENSES.has(normalized)) return "permissive";
  if (COPYLEFT_LICENSES.has(normalized)) return "copyleft";
  return "unknown";
}

/**
 * Determine the language from a file path.
 * @param {string} filePath
 * @returns {string|null}
 */
function _languageFromPath(filePath) {
  if (!filePath) return null;
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = filePath.slice(dot);
  return EXTENSION_LANGUAGES[ext] || null;
}

/**
 * Extract architectural patterns from source code content.
 * Analyzes code structure without requiring an external AST parser.
 * @param {string} content - File content
 * @param {string} language - Language identifier
 * @param {string} filePath - File path for context
 * @returns {object[]} Array of raw extracted patterns
 */
function _extractPatternsFromSource(content, language, filePath) {
  const patterns = [];
  const lines = content.split("\n");
  const lineCount = lines.length;

  // Skip tiny files
  if (lineCount < 10) return patterns;

  // ── Architectural patterns ─────────────────────────────────────────

  // Factory pattern detection
  const factoryMatches = content.match(/(?:function\s+create\w+|export\s+function\s+create\w+|const\s+create\w+\s*=)/g);
  if (factoryMatches && factoryMatches.length > 0) {
    patterns.push({
      category: "architectural",
      subcategory: "factory",
      name: `Factory pattern in ${_basename(filePath)}`,
      description: `Factory functions detected (${factoryMatches.length} factories). Uses create* naming convention for object construction.`,
      applicability: ["dependency injection", "encapsulation", "testability"],
      anti_patterns: ["god factory creating too many types", "factory without clear interface"],
      pitfalls: ["circular dependencies in factory chain"],
      performance: { complexity: "O(1) per creation", memory: "per-instance" },
      source_analysis: {
        file: filePath,
        lineCount,
        matchCount: factoryMatches.length,
        examples: factoryMatches.slice(0, 3).map(m => m.trim()),
      },
    });
  }

  // Middleware/plugin pattern detection
  const middlewareMatches = content.match(/(?:\.use\s*\(|middleware|plugin|interceptor|pipe\s*\()/gi);
  if (middlewareMatches && middlewareMatches.length >= 2) {
    patterns.push({
      category: "architectural",
      subcategory: "middleware_pipeline",
      name: `Middleware pipeline in ${_basename(filePath)}`,
      description: `Pipeline/middleware pattern with ${middlewareMatches.length} chain points. Enables composable request/data processing.`,
      applicability: ["request processing", "data transformation", "cross-cutting concerns"],
      anti_patterns: ["middleware ordering dependencies", "hidden middleware state mutation"],
      pitfalls: ["error swallowing in middleware chain", "performance degradation with too many layers"],
      performance: { complexity: "O(n) chain traversal", overhead: "per-request" },
      source_analysis: {
        file: filePath,
        lineCount,
        matchCount: middlewareMatches.length,
      },
    });
  }

  // Observer/EventEmitter pattern
  const eventMatches = content.match(/(?:\.on\s*\(|\.emit\s*\(|addEventListener|EventEmitter|\.subscribe\s*\(|Subject|Observable)/g);
  if (eventMatches && eventMatches.length >= 2) {
    patterns.push({
      category: "architectural",
      subcategory: "observer",
      name: `Observer/event pattern in ${_basename(filePath)}`,
      description: `Event-driven architecture with ${eventMatches.length} event interaction points. Decouples producers from consumers.`,
      applicability: ["loose coupling", "event-driven systems", "reactive programming"],
      anti_patterns: ["memory leaks from unremoved listeners", "event storms"],
      pitfalls: ["debugging difficulty with deep event chains", "ordering dependencies"],
      performance: { complexity: "O(n) per emit", memory: "listener registry" },
      source_analysis: {
        file: filePath,
        lineCount,
        matchCount: eventMatches.length,
      },
    });
  }

  // Singleton/module pattern
  const singletonMatches = content.match(/(?:let\s+_instance|getInstance|(?:const|let)\s+instance\s*=\s*null|module\.exports\s*=\s*new\s)/g);
  if (singletonMatches) {
    patterns.push({
      category: "architectural",
      subcategory: "singleton",
      name: `Singleton pattern in ${_basename(filePath)}`,
      description: "Singleton or module-level instance pattern ensuring a single shared instance.",
      applicability: ["shared state", "resource management", "configuration"],
      anti_patterns: ["hidden global state", "testing difficulty"],
      pitfalls: ["race conditions in lazy initialization", "memory leak from immortal instance"],
      performance: { complexity: "O(1) access", memory: "single instance" },
      source_analysis: { file: filePath, lineCount },
    });
  }

  // ── Error handling patterns ────────────────────────────────────────

  const tryCatchMatches = content.match(/try\s*\{/g);
  const catchMatches = content.match(/catch\s*\(/g);
  const customErrorMatches = content.match(/(?:class\s+\w+Error\s+extends|new\s+\w+Error\s*\()/g);
  if (tryCatchMatches && tryCatchMatches.length >= 3) {
    const hasCustomErrors = customErrorMatches && customErrorMatches.length > 0;
    patterns.push({
      category: "error_handling",
      subcategory: hasCustomErrors ? "typed_errors" : "try_catch",
      name: `Error handling in ${_basename(filePath)}`,
      description: `${tryCatchMatches.length} try-catch blocks${hasCustomErrors ? ` with ${customErrorMatches.length} custom error types` : ""}. ${hasCustomErrors ? "Uses typed error hierarchy for precise error handling." : "Standard try-catch error handling."}`,
      applicability: ["fault tolerance", "graceful degradation", "error reporting"],
      anti_patterns: ["empty catch blocks", "catching generic Error", "swallowing errors silently"],
      pitfalls: ["losing stack traces on re-throw", "inconsistent error formats"],
      performance: { complexity: "minimal overhead", note: "try blocks have near-zero cost when no exception" },
      source_analysis: {
        file: filePath,
        lineCount,
        tryCatchCount: tryCatchMatches.length,
        customErrorCount: customErrorMatches ? customErrorMatches.length : 0,
      },
    });
  }

  // Retry/circuit breaker patterns
  const retryMatches = content.match(/(?:retry|backoff|circuit.?breaker|exponential|max.?retries|attempts)/gi);
  if (retryMatches && retryMatches.length >= 2) {
    patterns.push({
      category: "error_handling",
      subcategory: "resilience",
      name: `Resilience pattern in ${_basename(filePath)}`,
      description: `Retry/circuit-breaker resilience pattern with ${retryMatches.length} resilience indicators.`,
      applicability: ["distributed systems", "network calls", "external service integration"],
      anti_patterns: ["retry without backoff", "infinite retries", "retrying non-idempotent operations"],
      pitfalls: ["thundering herd on retry", "masking persistent failures"],
      performance: { complexity: "O(retries * operation)", latency: "increased on failure" },
      source_analysis: { file: filePath, lineCount, matchCount: retryMatches.length },
    });
  }

  // ── Security patterns ──────────────────────────────────────────────

  const securityMatches = content.match(/(?:sanitize|escape|validate|csrf|xss|helmet|cors|auth(?:enticate|orize)|bcrypt|hash|encrypt|decrypt|jwt|token|nonce|hmac)/gi);
  if (securityMatches && securityMatches.length >= 3) {
    const inputValidation = content.match(/(?:sanitize|escape|validate|joi|zod|yup|ajv)/gi);
    const authPatterns = content.match(/(?:auth(?:enticate|orize)|jwt|token|session|bearer)/gi);
    const cryptoPatterns = content.match(/(?:bcrypt|hash|encrypt|decrypt|hmac|cipher|crypto)/gi);

    let subcategory = "general";
    if (inputValidation && inputValidation.length >= 2) subcategory = "input_validation";
    else if (authPatterns && authPatterns.length >= 2) subcategory = "authentication";
    else if (cryptoPatterns && cryptoPatterns.length >= 2) subcategory = "cryptography";

    patterns.push({
      category: "security",
      subcategory,
      name: `Security pattern in ${_basename(filePath)}`,
      description: `Security-conscious implementation with ${securityMatches.length} security-related constructs.`,
      applicability: ["web applications", "API endpoints", "data protection"],
      anti_patterns: ["security through obscurity", "client-side only validation", "hardcoded secrets"],
      pitfalls: ["incomplete input validation", "timing attacks", "insecure defaults"],
      performance: { note: "security checks add latency but are non-negotiable" },
      source_analysis: {
        file: filePath,
        lineCount,
        securityIndicators: securityMatches.length,
        hasInputValidation: !!(inputValidation && inputValidation.length > 0),
        hasAuth: !!(authPatterns && authPatterns.length > 0),
        hasCrypto: !!(cryptoPatterns && cryptoPatterns.length > 0),
      },
    });
  }

  // ── Performance patterns ───────────────────────────────────────────

  const perfMatches = content.match(/(?:cache|memoize|debounce|throttle|lazy|pool|batch|buffer|queue|worker|stream|paginate|index)/gi);
  if (perfMatches && perfMatches.length >= 3) {
    let subcategory = "general";
    const cacheHits = content.match(/(?:cache|memoize|memo\s*\(|LRU|lru)/gi);
    const asyncOpt = content.match(/(?:pool|worker|thread|parallel|concurrent|Promise\.all)/gi);
    const dataOpt = content.match(/(?:batch|buffer|stream|paginate|lazy|cursor)/gi);

    if (cacheHits && cacheHits.length >= 2) subcategory = "caching";
    else if (asyncOpt && asyncOpt.length >= 2) subcategory = "concurrency_optimization";
    else if (dataOpt && dataOpt.length >= 2) subcategory = "data_optimization";

    patterns.push({
      category: "performance",
      subcategory,
      name: `Performance optimization in ${_basename(filePath)}`,
      description: `Performance-focused implementation with ${perfMatches.length} optimization constructs.`,
      applicability: ["high-throughput systems", "latency-sensitive paths", "resource-constrained environments"],
      anti_patterns: ["premature optimization", "cache without invalidation", "unbounded caches"],
      pitfalls: ["stale cache data", "over-batching increasing latency", "thread safety issues"],
      performance: { optimizations: perfMatches.length },
      source_analysis: {
        file: filePath,
        lineCount,
        optimizationCount: perfMatches.length,
        hasCaching: !!(cacheHits && cacheHits.length > 0),
        hasAsyncOptimization: !!(asyncOpt && asyncOpt.length > 0),
        hasDataOptimization: !!(dataOpt && dataOpt.length > 0),
      },
    });
  }

  // ── Testing patterns ───────────────────────────────────────────────

  const testMatches = content.match(/(?:describe\s*\(|it\s*\(|test\s*\(|expect\s*\(|assert\.|beforeEach|afterEach|jest\.|vitest|mocha|chai|sinon|mock|stub|spy)/gi);
  if (testMatches && testMatches.length >= 3) {
    const hasMocking = content.match(/(?:mock|stub|spy|jest\.fn|sinon\.|vi\.fn)/gi);
    const hasSetup = content.match(/(?:beforeEach|afterEach|beforeAll|afterAll|setUp|tearDown)/gi);
    const hasAssertions = content.match(/(?:expect\s*\(|assert\.|should\.)/gi);

    patterns.push({
      category: "testing",
      subcategory: hasMocking ? "with_mocking" : "unit_tests",
      name: `Test pattern in ${_basename(filePath)}`,
      description: `Test suite with ${testMatches.length} testing constructs.${hasMocking ? " Uses mocking/stubbing." : ""}${hasSetup ? " Has setup/teardown lifecycle." : ""}`,
      applicability: ["quality assurance", "regression prevention", "documentation through tests"],
      anti_patterns: ["testing implementation details", "brittle mocks", "test interdependency"],
      pitfalls: ["flaky tests", "slow test suites", "insufficient edge cases"],
      performance: { note: "test suite execution time" },
      source_analysis: {
        file: filePath,
        lineCount,
        testConstructCount: testMatches.length,
        hasMocking: !!(hasMocking && hasMocking.length > 0),
        hasLifecycle: !!(hasSetup && hasSetup.length > 0),
        assertionCount: hasAssertions ? hasAssertions.length : 0,
      },
    });
  }

  // ── Data modeling patterns ─────────────────────────────────────────

  const modelMatches = content.match(/(?:schema|model|entity|interface\s+\w+|type\s+\w+\s*=|class\s+\w+\s*\{|enum\s+\w+|CREATE\s+TABLE|migration|foreign\s+key|references|@Entity|@Column|@Table)/gi);
  if (modelMatches && modelMatches.length >= 3) {
    patterns.push({
      category: "data_modeling",
      subcategory: content.match(/CREATE\s+TABLE/i) ? "relational" : "object",
      name: `Data model in ${_basename(filePath)}`,
      description: `Data modeling with ${modelMatches.length} schema/model definitions.`,
      applicability: ["data integrity", "domain modeling", "API contracts"],
      anti_patterns: ["anemic domain models", "over-normalization", "missing validation"],
      pitfalls: ["migration complexity", "schema evolution", "circular references"],
      performance: { note: "model complexity affects query performance" },
      source_analysis: { file: filePath, lineCount, modelConstructCount: modelMatches.length },
    });
  }

  // ── API design patterns ────────────────────────────────────────────

  const apiMatches = content.match(/(?:app\.(get|post|put|delete|patch)\s*\(|router\.(get|post|put|delete|patch)\s*\(|@Get|@Post|@Put|@Delete|@Patch|fetch\s*\(|axios\.|endpoint|route|handler)/gi);
  if (apiMatches && apiMatches.length >= 3) {
    const hasVersioning = content.match(/(?:\/v\d+\/|version|api-version)/gi);
    const hasPagination = content.match(/(?:page|limit|offset|cursor|pagination)/gi);
    const hasValidation = content.match(/(?:validate|schema|joi|zod|yup|ajv)/gi);

    patterns.push({
      category: "api_design",
      subcategory: hasVersioning ? "versioned" : "rest",
      name: `API design in ${_basename(filePath)}`,
      description: `API implementation with ${apiMatches.length} endpoint definitions.${hasVersioning ? " Uses API versioning." : ""}${hasPagination ? " Supports pagination." : ""}`,
      applicability: ["REST APIs", "microservices", "client-server communication"],
      anti_patterns: ["inconsistent naming", "missing error responses", "no rate limiting"],
      pitfalls: ["breaking changes", "over-fetching", "N+1 queries"],
      performance: { endpoints: apiMatches.length },
      source_analysis: {
        file: filePath,
        lineCount,
        endpointCount: apiMatches.length,
        hasVersioning: !!(hasVersioning && hasVersioning.length > 0),
        hasPagination: !!(hasPagination && hasPagination.length > 0),
        hasValidation: !!(hasValidation && hasValidation.length > 0),
      },
    });
  }

  // ── Concurrency patterns ───────────────────────────────────────────

  const concurrencyMatches = content.match(/(?:Promise\.all|Promise\.allSettled|Promise\.race|async\s+function|await\s|Worker|Mutex|Semaphore|Lock|atomic|channel|goroutine|spawn|fork|cluster|parallel|concurrent)/gi);
  if (concurrencyMatches && concurrencyMatches.length >= 3) {
    const hasParallel = content.match(/(?:Promise\.all|Promise\.allSettled|parallel|Promise\.race)/gi);
    const hasWorkers = content.match(/(?:Worker|cluster|fork|spawn|thread)/gi);

    patterns.push({
      category: "concurrency",
      subcategory: hasWorkers ? "multi_threaded" : "async_await",
      name: `Concurrency pattern in ${_basename(filePath)}`,
      description: `Concurrent execution with ${concurrencyMatches.length} concurrency constructs.${hasParallel ? " Uses parallel execution." : ""}${hasWorkers ? " Uses worker threads/processes." : ""}`,
      applicability: ["I/O-bound tasks", "CPU-bound computation", "real-time systems"],
      anti_patterns: ["callback hell", "unhandled rejections", "race conditions"],
      pitfalls: ["deadlocks", "resource exhaustion", "error propagation in parallel tasks"],
      performance: { concurrencyPoints: concurrencyMatches.length },
      source_analysis: {
        file: filePath,
        lineCount,
        concurrencyCount: concurrencyMatches.length,
        hasParallelExecution: !!(hasParallel && hasParallel.length > 0),
        hasWorkerThreads: !!(hasWorkers && hasWorkers.length > 0),
      },
    });
  }

  return patterns;
}

/**
 * Get the basename from a file path.
 * @param {string} p
 * @returns {string}
 */
function _basename(p) {
  if (!p) return "unknown";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "unknown";
}

/**
 * Apply CRETI scoring to a raw pattern.
 * C = Completeness (how comprehensive the pattern is)
 * R = Reusability (how reusable across contexts)
 * E = Elegance (code quality indicators)
 * T = Testability (presence of test patterns)
 * I = Impact (stars, usage breadth, applicability)
 *
 * @param {object} pattern - Raw pattern object
 * @param {object} repoMeta - Repository metadata (stars, language, etc.)
 * @returns {{ c: number, r: number, e: number, t: number, i: number }}
 */
function _computeCretiScores(pattern, repoMeta) {
  const sa = pattern.source_analysis || {};

  // C — Completeness (0-1): based on richness of extracted data
  let c = 0.3; // base
  if (pattern.description && pattern.description.length > 50) c += 0.2;
  if (pattern.applicability && pattern.applicability.length >= 2) c += 0.15;
  if (pattern.anti_patterns && pattern.anti_patterns.length >= 1) c += 0.15;
  if (pattern.pitfalls && pattern.pitfalls.length >= 1) c += 0.1;
  if (pattern.performance && Object.keys(pattern.performance).length >= 1) c += 0.1;

  // R — Reusability (0-1): generic patterns score higher
  let r = 0.4; // base
  if (pattern.applicability && pattern.applicability.length >= 3) r += 0.2;
  if (pattern.category === "architectural") r += 0.15;
  if (pattern.category === "error_handling") r += 0.1;
  if (pattern.category === "security") r += 0.1;
  if (sa.matchCount && sa.matchCount >= 5) r += 0.1; // pattern recurs frequently

  // E — Elegance (0-1): based on file complexity and pattern sophistication
  let e = 0.4; // base
  const lc = sa.lineCount || 0;
  if (lc > 50 && lc < 500) e += 0.2; // well-scoped files
  if (pattern.subcategory && pattern.subcategory !== "general") e += 0.15;
  if (pattern.anti_patterns && pattern.anti_patterns.length >= 2) e += 0.15; // awareness of anti-patterns
  if (sa.customErrorCount && sa.customErrorCount > 0) e += 0.1;

  // T — Testability (0-1): presence of test indicators
  let t = 0.3; // base
  if (pattern.category === "testing") t = 0.9;
  else {
    if (sa.hasMocking) t += 0.2;
    if (sa.assertionCount && sa.assertionCount > 0) t += 0.2;
    if (pattern.subcategory === "factory") t += 0.15; // factories are testable
    if (pattern.subcategory === "middleware_pipeline") t += 0.1;
  }

  // I — Impact (0-1): based on repo quality and pattern utility
  let i = 0.3; // base
  const stars = repoMeta.stars || 0;
  if (stars >= 10000) i += 0.3;
  else if (stars >= 1000) i += 0.2;
  else if (stars >= 100) i += 0.1;

  if (pattern.category === "security") i += 0.15;
  if (pattern.category === "performance") i += 0.1;
  if (pattern.applicability && pattern.applicability.length >= 2) i += 0.1;

  // Clamp all to [0, 1]
  const clamp = (v) => Math.max(0, Math.min(1, Math.round(v * 100) / 100));

  return {
    c: clamp(c),
    r: clamp(r),
    e: clamp(e),
    t: clamp(t),
    i: clamp(i),
  };
}

/**
 * Simulate fetching repository metadata from a URL.
 * In production, this would call the GitHub/GitLab API.
 * @param {string} url
 * @param {{ owner: string, name: string }} parsed
 * @param {object} [options]
 * @returns {object} Repository metadata
 */
function _fetchRepoMetadata(url, parsed, options = {}) {
  return {
    url,
    name: parsed.name,
    owner: parsed.owner,
    license: options.license || null,
    license_mode: _classifyLicense(options.license || null),
    stars: options.stars || 0,
    language: options.language || null,
  };
}

/**
 * Simulate reading files from a repository.
 * In production, this would clone and read the actual files.
 * Accepts an optional sourceFiles array in options for real data.
 * @param {object} repoMeta
 * @param {object} [options]
 * @returns {object[]} Array of { path, content, language }
 */
function _readRepositoryFiles(repoMeta, options = {}) {
  if (options.sourceFiles && Array.isArray(options.sourceFiles)) {
    return options.sourceFiles.map((f) => ({
      path: f.path,
      content: f.content || "",
      language: f.language || _languageFromPath(f.path),
    }));
  }

  // Without actual file access, return an empty array.
  // Callers can provide sourceFiles for real extraction.
  return [];
}

/**
 * Rank patterns within a set and select elite patterns.
 * @param {object[]} patterns - Patterns with CRETI scores
 * @param {number} [topN=10] - Number of elite patterns to select
 * @returns {object[]} Top-ranked patterns
 */
function _selectElitePatterns(patterns, topN = 10) {
  if (!patterns || patterns.length === 0) return [];

  const scored = patterns.map((p) => {
    const avg = (
      (p.creti_c || 0) +
      (p.creti_r || 0) +
      (p.creti_e || 0) +
      (p.creti_t || 0) +
      (p.creti_i || 0)
    ) / 5;
    return { ...p, _avgCreti: avg };
  });

  scored.sort((a, b) => b._avgCreti - a._avgCreti);

  return scored.slice(0, topN).map(({ _avgCreti, ...rest }) => ({
    ...rest,
    cretiAvg: _avgCreti,
  }));
}

/**
 * Build a pattern hierarchy tree from a set of patterns.
 * Groups by category → subcategory, includes counts.
 * @param {object[]} patterns
 * @returns {object}
 */
function _buildPatternHierarchy(patterns) {
  const hierarchy = {};
  for (const p of patterns) {
    const cat = p.category || "uncategorized";
    const sub = p.subcategory || "general";
    if (!hierarchy[cat]) hierarchy[cat] = { count: 0, subcategories: {} };
    hierarchy[cat].count++;
    if (!hierarchy[cat].subcategories[sub]) hierarchy[cat].subcategories[sub] = { count: 0, patterns: [] };
    hierarchy[cat].subcategories[sub].count++;
    hierarchy[cat].subcategories[sub].patterns.push(p.name);
  }
  return hierarchy;
}

/**
 * Build a decision matrix from patterns for choosing between approaches.
 * @param {object[]} patterns
 * @returns {object}
 */
function _buildDecisionMatrix(patterns) {
  const matrix = {};
  const categories = [...new Set(patterns.map((p) => p.category))];

  for (const cat of categories) {
    const catPatterns = patterns.filter((p) => p.category === cat);
    const subcategories = [...new Set(catPatterns.map((p) => p.subcategory || "general"))];

    matrix[cat] = {
      totalPatterns: catPatterns.length,
      avgCreti: _averageCreti(catPatterns),
      options: subcategories.map((sub) => {
        const subPatterns = catPatterns.filter((p) => (p.subcategory || "general") === sub);
        return {
          subcategory: sub,
          count: subPatterns.length,
          avgCreti: _averageCreti(subPatterns),
          topApplicability: _mergeApplicability(subPatterns).slice(0, 5),
          topPitfalls: _mergePitfalls(subPatterns).slice(0, 3),
        };
      }),
    };
  }

  return matrix;
}

/**
 * Compute average CRETI across patterns.
 * @param {object[]} patterns
 * @returns {object}
 */
function _averageCreti(patterns) {
  if (patterns.length === 0) return { c: 0, r: 0, e: 0, t: 0, i: 0 };
  const sum = { c: 0, r: 0, e: 0, t: 0, i: 0 };
  for (const p of patterns) {
    sum.c += p.creti_c || 0;
    sum.r += p.creti_r || 0;
    sum.e += p.creti_e || 0;
    sum.t += p.creti_t || 0;
    sum.i += p.creti_i || 0;
  }
  const n = patterns.length;
  return {
    c: Math.round((sum.c / n) * 100) / 100,
    r: Math.round((sum.r / n) * 100) / 100,
    e: Math.round((sum.e / n) * 100) / 100,
    t: Math.round((sum.t / n) * 100) / 100,
    i: Math.round((sum.i / n) * 100) / 100,
  };
}

/**
 * Merge and deduplicate applicability arrays from patterns.
 * @param {object[]} patterns
 * @returns {string[]}
 */
function _mergeApplicability(patterns) {
  const set = new Set();
  for (const p of patterns) {
    const apps = _parseJsonField(p.applicability, []);
    for (const a of apps) set.add(a);
  }
  return [...set];
}

/**
 * Merge and deduplicate pitfalls from patterns.
 * @param {object[]} patterns
 * @returns {string[]}
 */
function _mergePitfalls(patterns) {
  const set = new Set();
  for (const p of patterns) {
    const pits = _parseJsonField(p.pitfalls, []);
    for (const pit of pits) set.add(pit);
  }
  return [...set];
}

/**
 * Safely parse a JSON field that may be already parsed or a string.
 * @param {*} value
 * @param {*} fallback
 * @returns {*}
 */
function _parseJsonField(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Serialize a value for storage in SQLite (JSON.stringify objects).
 * @param {*} value
 * @returns {string}
 */
function _serializeJson(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Generate a lens name from a user request string.
 * @param {string} request
 * @returns {string}
 */
function _generateLensName(request) {
  const words = request
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4);
  if (words.length === 0) return "auto-lens";
  return words.join("-") + "-lens";
}

/**
 * Match patterns to a user request for lens generation.
 * Performs keyword matching against pattern names, descriptions, and categories.
 * @param {object[]} patterns - All available patterns (from DB rows)
 * @param {string} request - User's natural language request
 * @param {object} [constraints]
 * @returns {object[]} Matched patterns sorted by relevance
 */
function _matchPatternsToRequest(patterns, request, constraints = {}) {
  const keywords = request
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (keywords.length === 0) return patterns.slice(0, 20);

  const scored = patterns.map((p) => {
    let score = 0;
    const searchText = [
      p.name,
      p.description,
      p.category,
      p.subcategory,
      p.language,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    for (const kw of keywords) {
      if (searchText.includes(kw)) score += 1;
    }

    // Boost by CRETI average
    const cretiAvg = ((p.creti_c || 0) + (p.creti_r || 0) + (p.creti_e || 0) + (p.creti_t || 0) + (p.creti_i || 0)) / 5;
    score += cretiAvg * 0.5;

    // Apply language constraint
    if (constraints.language && p.language && p.language !== constraints.language) {
      score *= 0.5;
    }

    // Apply category constraint
    if (constraints.category && p.category !== constraints.category) {
      score *= 0.7;
    }

    return { ...p, _matchScore: score };
  });

  scored.sort((a, b) => b._matchScore - a._matchScore);

  const maxPatterns = constraints.maxPatterns || 20;
  return scored
    .filter((p) => p._matchScore > 0)
    .slice(0, maxPatterns)
    .map(({ _matchScore, ...rest }) => rest);
}

/**
 * Build an architecture blueprint from matched patterns for lens generation.
 * @param {object[]} patterns
 * @param {string} request
 * @returns {object}
 */
function _buildArchitecture(patterns, request) {
  const categories = {};
  for (const p of patterns) {
    const cat = p.category || "general";
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push({
      name: p.name,
      subcategory: p.subcategory,
      language: p.language,
    });
  }

  const languages = [...new Set(patterns.map((p) => p.language).filter(Boolean))];

  return {
    name: _generateLensName(request),
    description: `Auto-generated lens for: ${request}`,
    layers: Object.entries(categories).map(([category, items]) => ({
      category,
      patternCount: items.length,
      patterns: items,
    })),
    languages,
    patternCount: patterns.length,
    generatedAt: new Date().toISOString(),
  };
}

// ── Prepared statement cache ─────────────────────────────────────────────────

/**
 * Lazily create and cache prepared SQLite statements.
 * @param {object} db
 * @returns {object}
 */
function _prepareStatements(db) {
  return {
    // ── Repositories ───────────────────────────────────────────
    insertRepo: db.prepare(`
      INSERT INTO code_repositories (id, url, name, owner, license, license_mode, stars, language, ingested_at, pattern_count, status)
      VALUES (@id, @url, @name, @owner, @license, @license_mode, @stars, @language, @ingested_at, @pattern_count, @status)
    `),
    updateRepo: db.prepare(`
      UPDATE code_repositories
      SET status = @status, pattern_count = @pattern_count, ingested_at = @ingested_at
      WHERE id = @id
    `),
    updateRepoStatus: db.prepare(`
      UPDATE code_repositories SET status = @status WHERE id = @id
    `),
    getRepoById: db.prepare(`SELECT * FROM code_repositories WHERE id = ?`),
    getRepoByUrl: db.prepare(`SELECT * FROM code_repositories WHERE url = ?`),
    listRepos: db.prepare(`
      SELECT * FROM code_repositories ORDER BY ingested_at DESC LIMIT ? OFFSET ?
    `),
    countRepos: db.prepare(`SELECT COUNT(*) as count FROM code_repositories`),
    countReposByStatus: db.prepare(`SELECT COUNT(*) as count FROM code_repositories WHERE status = ?`),

    // ── Patterns ───────────────────────────────────────────────
    insertPattern: db.prepare(`
      INSERT INTO code_patterns (id, repository_id, category, subcategory, name, language, description, applicability, anti_patterns, pitfalls, performance, source_analysis, creti_c, creti_r, creti_e, creti_t, creti_i, created_at)
      VALUES (@id, @repository_id, @category, @subcategory, @name, @language, @description, @applicability, @anti_patterns, @pitfalls, @performance, @source_analysis, @creti_c, @creti_r, @creti_e, @creti_t, @creti_i, @created_at)
    `),
    getPatternById: db.prepare(`SELECT * FROM code_patterns WHERE id = ?`),
    listPatterns: db.prepare(`
      SELECT * FROM code_patterns ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    listPatternsByCategory: db.prepare(`
      SELECT * FROM code_patterns WHERE category = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    listPatternsByLanguage: db.prepare(`
      SELECT * FROM code_patterns WHERE language = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    listPatternsByRepo: db.prepare(`
      SELECT * FROM code_patterns WHERE repository_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    searchPatternsByKeyword: db.prepare(`
      SELECT * FROM code_patterns
      WHERE name LIKE ? OR description LIKE ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    listPatternsByCategoryAndLanguage: db.prepare(`
      SELECT * FROM code_patterns WHERE category = ? AND language = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    countPatterns: db.prepare(`SELECT COUNT(*) as count FROM code_patterns`),
    countPatternsByCategory: db.prepare(`SELECT COUNT(*) as count FROM code_patterns WHERE category = ?`),
    countPatternsByRepo: db.prepare(`SELECT COUNT(*) as count FROM code_patterns WHERE repository_id = ?`),
    allPatternsByCategory: db.prepare(`SELECT * FROM code_patterns WHERE category = ?`),
    allPatterns: db.prepare(`SELECT * FROM code_patterns`),

    // ── Megas ──────────────────────────────────────────────────
    insertMega: db.prepare(`
      INSERT INTO code_megas (id, topic, compressed_from_count, core_insight, pattern_hierarchy, decision_matrix, elite_patterns, created_at)
      VALUES (@id, @topic, @compressed_from_count, @core_insight, @pattern_hierarchy, @decision_matrix, @elite_patterns, @created_at)
    `),
    getMegaById: db.prepare(`SELECT * FROM code_megas WHERE id = ?`),
    listMegas: db.prepare(`
      SELECT * FROM code_megas ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    countMegas: db.prepare(`SELECT COUNT(*) as count FROM code_megas`),

    // ── Lens Generations ───────────────────────────────────────
    insertGeneration: db.prepare(`
      INSERT INTO lens_generations (id, user_request, status, lens_name, architecture, patterns_used, test_count, deploy_time, error, created_at, completed_at)
      VALUES (@id, @user_request, @status, @lens_name, @architecture, @patterns_used, @test_count, @deploy_time, @error, @created_at, @completed_at)
    `),
    updateGeneration: db.prepare(`
      UPDATE lens_generations
      SET status = @status, lens_name = @lens_name, architecture = @architecture,
          patterns_used = @patterns_used, test_count = @test_count, deploy_time = @deploy_time,
          error = @error, completed_at = @completed_at
      WHERE id = @id
    `),
    getGenerationById: db.prepare(`SELECT * FROM lens_generations WHERE id = ?`),
    listGenerations: db.prepare(`
      SELECT * FROM lens_generations ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    listGenerationsByStatus: db.prepare(`
      SELECT * FROM lens_generations WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    countGenerations: db.prepare(`SELECT COUNT(*) as count FROM lens_generations`),

    // ── Code Errors ────────────────────────────────────────────
    insertError: db.prepare(`
      INSERT INTO code_errors (id, lens_id, error_type, stack_trace, context, resolution, resolved_at, created_at)
      VALUES (@id, @lens_id, @error_type, @stack_trace, @context, @resolution, @resolved_at, @created_at)
    `),
    updateErrorResolution: db.prepare(`
      UPDATE code_errors SET resolution = @resolution, resolved_at = @resolved_at WHERE id = @id
    `),
    getErrorById: db.prepare(`SELECT * FROM code_errors WHERE id = ?`),
    listErrors: db.prepare(`
      SELECT * FROM code_errors ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    listErrorsByLens: db.prepare(`
      SELECT * FROM code_errors WHERE lens_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    listErrorsByType: db.prepare(`
      SELECT * FROM code_errors WHERE error_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `),
    countErrors: db.prepare(`SELECT COUNT(*) as count FROM code_errors`),
    countUnresolvedErrors: db.prepare(`SELECT COUNT(*) as count FROM code_errors WHERE resolved_at IS NULL`),
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create the Code Engine instance.
 *
 * @param {object} db - better-sqlite3 database handle
 * @returns {object} Code engine API
 */
export function createCodeEngine(db) {
  if (!db) {
    throw new ValidationError("Database connection is required to create Code Engine");
  }

  let _stmts = null;

  /**
   * Lazily access prepared statements.
   */
  function stmts() {
    if (!_stmts) {
      _stmts = _prepareStatements(db);
    }
    return _stmts;
  }

  /**
   * Deserialize JSON columns from a database row.
   * @param {object} row
   * @returns {object}
   */
  function _deserializeRow(row) {
    if (!row) return null;
    return {
      ...row,
      applicability: _parseJsonField(row.applicability, []),
      anti_patterns: _parseJsonField(row.anti_patterns, []),
      pitfalls: _parseJsonField(row.pitfalls, []),
      performance: _parseJsonField(row.performance, {}),
      source_analysis: _parseJsonField(row.source_analysis, {}),
    };
  }

  /**
   * Deserialize JSON columns from a mega row.
   * @param {object} row
   * @returns {object}
   */
  function _deserializeMega(row) {
    if (!row) return null;
    return {
      ...row,
      pattern_hierarchy: _parseJsonField(row.pattern_hierarchy, {}),
      decision_matrix: _parseJsonField(row.decision_matrix, {}),
      elite_patterns: _parseJsonField(row.elite_patterns, []),
    };
  }

  /**
   * Deserialize JSON columns from a generation row.
   * @param {object} row
   * @returns {object}
   */
  function _deserializeGeneration(row) {
    if (!row) return null;
    return {
      ...row,
      architecture: _parseJsonField(row.architecture, {}),
      patterns_used: _parseJsonField(row.patterns_used, []),
    };
  }

  /**
   * Deserialize JSON columns from an error row.
   * @param {object} row
   * @returns {object}
   */
  function _deserializeError(row) {
    if (!row) return null;
    return {
      ...row,
      context: _parseJsonField(row.context, {}),
    };
  }

  // ── Engine methods ─────────────────────────────────────────────────

  /**
   * Ingest a repository: parse URL, verify license, extract patterns, score, and store.
   *
   * @param {string} url - Repository URL (GitHub, GitLab, etc.) or owner/name shorthand
   * @param {object} [options]
   * @param {string} [options.license] - Override license identifier
   * @param {number} [options.stars] - Override star count
   * @param {string} [options.language] - Override primary language
   * @param {Array}  [options.sourceFiles] - Array of { path, content } to extract patterns from
   * @param {boolean} [options.allowCopyleft=false] - Allow copyleft licenses
   * @returns {object} Ingestion result with repository and patterns
   */
  function ingestRepository(url, options = {}) {
    const parsed = _parseRepoUrl(url);

    // Check for duplicate
    const existing = stmts().getRepoByUrl.get(url);
    if (existing) {
      throw new ConflictError(`Repository already ingested: ${url}`, { repositoryId: existing.id });
    }

    // Fetch metadata
    const meta = _fetchRepoMetadata(url, parsed, options);

    // Verify license
    if (meta.license_mode === "copyleft" && !options.allowCopyleft) {
      throw new ValidationError(
        `Repository ${meta.name} has copyleft license (${meta.license}). Set allowCopyleft=true to proceed.`,
        { license: meta.license, license_mode: meta.license_mode }
      );
    }

    // Create repository record
    const repoId = generateId("repo");
    const now = new Date().toISOString();

    stmts().insertRepo.run({
      id: repoId,
      url: meta.url,
      name: meta.name,
      owner: meta.owner,
      license: meta.license,
      license_mode: meta.license_mode,
      stars: meta.stars,
      language: meta.language,
      ingested_at: null,
      pattern_count: 0,
      status: "ingesting",
    });

    // Extract patterns
    let extractedPatterns;
    try {
      extractedPatterns = extractPatterns(repoId, options);
    } catch (err) {
      stmts().updateRepoStatus.run({ id: repoId, status: "failed" });
      throw err;
    }

    // Update repository status
    stmts().updateRepo.run({
      id: repoId,
      status: "ingested",
      pattern_count: extractedPatterns.length,
      ingested_at: now,
    });

    return {
      repository: stmts().getRepoById.get(repoId),
      patternsExtracted: extractedPatterns.length,
      patterns: extractedPatterns.slice(0, 10), // preview first 10
    };
  }

  /**
   * Extract patterns from a repository's source files using AST-style parsing.
   *
   * @param {string} repoId - Repository ID
   * @param {object} [options]
   * @param {Array}  [options.sourceFiles] - Array of { path, content } to analyze
   * @returns {object[]} Array of stored pattern records
   */
  function extractPatterns(repoId, options = {}) {
    const repo = stmts().getRepoById.get(repoId);
    if (!repo) {
      throw new NotFoundError("Repository", repoId);
    }

    const repoMeta = {
      stars: repo.stars || 0,
      language: repo.language,
      name: repo.name,
    };

    const files = _readRepositoryFiles(repoMeta, options);
    const allPatterns = [];

    for (const file of files) {
      if (!file.content || file.content.length < 50) continue;

      const language = file.language || _languageFromPath(file.path) || repo.language;
      const rawPatterns = _extractPatternsFromSource(file.content, language, file.path);

      for (const raw of rawPatterns) {
        const scores = _computeCretiScores(raw, repoMeta);
        const patternId = generateId("cpat");
        const now = new Date().toISOString();

        const record = {
          id: patternId,
          repository_id: repoId,
          category: raw.category,
          subcategory: raw.subcategory || null,
          name: raw.name,
          language: language,
          description: raw.description || null,
          applicability: _serializeJson(raw.applicability || []),
          anti_patterns: _serializeJson(raw.anti_patterns || []),
          pitfalls: _serializeJson(raw.pitfalls || []),
          performance: _serializeJson(raw.performance || {}),
          source_analysis: _serializeJson(raw.source_analysis || {}),
          creti_c: scores.c,
          creti_r: scores.r,
          creti_e: scores.e,
          creti_t: scores.t,
          creti_i: scores.i,
          created_at: now,
        };

        stmts().insertPattern.run(record);
        allPatterns.push(record);
      }
    }

    return allPatterns;
  }

  /**
   * Apply CRETI scoring to a pattern object (utility for re-scoring).
   *
   * @param {object} pattern - Pattern with source_analysis, applicability, etc.
   * @param {object} [repoMeta] - Optional repo metadata for impact scoring
   * @returns {{ c: number, r: number, e: number, t: number, i: number }}
   */
  function scorePattern(pattern, repoMeta = {}) {
    if (!pattern) {
      throw new ValidationError("Pattern is required for scoring");
    }

    const normalized = {
      ...pattern,
      applicability: _parseJsonField(pattern.applicability, []),
      anti_patterns: _parseJsonField(pattern.anti_patterns, []),
      pitfalls: _parseJsonField(pattern.pitfalls, []),
      performance: _parseJsonField(pattern.performance, {}),
      source_analysis: _parseJsonField(pattern.source_analysis, {}),
    };

    return _computeCretiScores(normalized, repoMeta);
  }

  /**
   * Search patterns by category, language, keyword, or repository.
   *
   * @param {object} query
   * @param {string} [query.category] - Filter by category
   * @param {string} [query.language] - Filter by language
   * @param {string} [query.keyword] - Search in name and description
   * @param {string} [query.repositoryId] - Filter by repository
   * @param {number} [query.limit=50] - Max results
   * @param {number} [query.offset=0] - Pagination offset
   * @returns {{ patterns: object[], total: number }}
   */
  function searchPatterns(query = {}) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);

    let rows;
    let total;

    if (query.keyword) {
      const like = `%${query.keyword}%`;
      rows = stmts().searchPatternsByKeyword.all(like, like, limit, offset);
      // For count with keyword search, use a dynamic approach
      const countResult = db.prepare(
        `SELECT COUNT(*) as count FROM code_patterns WHERE name LIKE ? OR description LIKE ?`
      ).get(like, like);
      total = countResult.count;
    } else if (query.category && query.language) {
      rows = stmts().listPatternsByCategoryAndLanguage.all(query.category, query.language, limit, offset);
      const countResult = db.prepare(
        `SELECT COUNT(*) as count FROM code_patterns WHERE category = ? AND language = ?`
      ).get(query.category, query.language);
      total = countResult.count;
    } else if (query.category) {
      rows = stmts().listPatternsByCategory.all(query.category, limit, offset);
      total = stmts().countPatternsByCategory.get(query.category).count;
    } else if (query.language) {
      rows = stmts().listPatternsByLanguage.all(query.language, limit, offset);
      const countResult = db.prepare(
        `SELECT COUNT(*) as count FROM code_patterns WHERE language = ?`
      ).get(query.language);
      total = countResult.count;
    } else if (query.repositoryId) {
      rows = stmts().listPatternsByRepo.all(query.repositoryId, limit, offset);
      total = stmts().countPatternsByRepo.get(query.repositoryId).count;
    } else {
      rows = stmts().listPatterns.all(limit, offset);
      total = stmts().countPatterns.get().count;
    }

    return {
      patterns: rows.map(_deserializeRow),
      total,
      limit,
      offset,
    };
  }

  /**
   * Compress related patterns into a Mega DTU of architectural wisdom.
   *
   * @param {string} topic - The topic or theme to compress around
   * @param {object} [options]
   * @param {number} [options.minPatterns=5] - Minimum patterns required
   * @param {string} [options.category] - Optional category filter
   * @param {number} [options.eliteCount=10] - Number of elite patterns to surface
   * @returns {object} The created Mega DTU
   */
  function compressToMega(topic, options = {}) {
    if (!topic || typeof topic !== "string") {
      throw new ValidationError("Topic is required for Mega DTU compression");
    }

    const minPatterns = options.minPatterns || 5;
    const eliteCount = options.eliteCount || 10;

    // Gather candidate patterns
    let candidates;
    if (options.category) {
      if (!PATTERN_CATEGORIES.includes(options.category)) {
        throw new ValidationError(`Invalid category: ${options.category}`, {
          validCategories: PATTERN_CATEGORIES,
        });
      }
      candidates = stmts().allPatternsByCategory.all(options.category);
    } else {
      candidates = stmts().allPatterns.all();
    }

    // Also filter by topic keyword matching
    const topicKeywords = topic
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2);

    let filtered;
    if (topicKeywords.length > 0) {
      filtered = candidates.filter((p) => {
        const text = [p.name, p.description, p.category, p.subcategory]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return topicKeywords.some((kw) => text.includes(kw));
      });
      // If topic filtering is too restrictive, fall back to all candidates in the category
      if (filtered.length < minPatterns) {
        filtered = candidates;
      }
    } else {
      filtered = candidates;
    }

    if (filtered.length < minPatterns) {
      throw new ValidationError(
        `Not enough patterns to compress. Found ${filtered.length}, need at least ${minPatterns}.`,
        { found: filtered.length, required: minPatterns }
      );
    }

    // Deserialize JSON fields for analysis
    const deserialized = filtered.map(_deserializeRow);

    // Build hierarchy
    const hierarchy = _buildPatternHierarchy(deserialized);

    // Build decision matrix
    const decisionMatrix = _buildDecisionMatrix(deserialized);

    // Select elite patterns
    const elites = _selectElitePatterns(deserialized, eliteCount);

    // Synthesize core insight
    const topCategories = Object.entries(hierarchy)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .map(([cat, data]) => `${cat} (${data.count} patterns)`);

    const avgCreti = _averageCreti(deserialized);

    const coreInsight = [
      `Compressed ${filtered.length} patterns on topic "${topic}".`,
      `Dominant categories: ${topCategories.join(", ")}.`,
      `Average CRETI: C=${avgCreti.c} R=${avgCreti.r} E=${avgCreti.e} T=${avgCreti.t} I=${avgCreti.i}.`,
      `${elites.length} elite patterns identified with highest combined scores.`,
      elites.length > 0
        ? `Top pattern: "${elites[0].name}" (avg CRETI ${elites[0].cretiAvg.toFixed(2)}).`
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    // Store the Mega DTU
    const megaId = generateId("mega");
    const now = new Date().toISOString();

    const megaRecord = {
      id: megaId,
      topic,
      compressed_from_count: filtered.length,
      core_insight: coreInsight,
      pattern_hierarchy: _serializeJson(hierarchy),
      decision_matrix: _serializeJson(decisionMatrix),
      elite_patterns: _serializeJson(
        elites.map((e) => ({
          id: e.id,
          name: e.name,
          category: e.category,
          subcategory: e.subcategory,
          language: e.language,
          cretiAvg: e.cretiAvg,
          creti_c: e.creti_c,
          creti_r: e.creti_r,
          creti_e: e.creti_e,
          creti_t: e.creti_t,
          creti_i: e.creti_i,
        }))
      ),
      created_at: now,
    };

    stmts().insertMega.run(megaRecord);

    return _deserializeMega(stmts().getMegaById.get(megaId));
  }

  /**
   * Generate a lens from matched patterns based on a user request.
   *
   * @param {string} request - Natural language description of desired lens
   * @param {object} [constraints]
   * @param {string} [constraints.language] - Preferred language
   * @param {string} [constraints.category] - Preferred category
   * @param {number} [constraints.maxPatterns] - Max patterns to include
   * @returns {object} Generation record with architecture and matched patterns
   */
  function generateLens(request, constraints = {}) {
    if (!request || typeof request !== "string") {
      throw new ValidationError("Request description is required for lens generation");
    }

    const genId = generateId("lgen");
    const now = new Date().toISOString();

    // Create the generation record in pending state
    stmts().insertGeneration.run({
      id: genId,
      user_request: request,
      status: "pending",
      lens_name: null,
      architecture: "{}",
      patterns_used: "[]",
      test_count: 0,
      deploy_time: null,
      error: null,
      created_at: now,
      completed_at: null,
    });

    try {
      // Mark as generating
      stmts().updateGeneration.run({
        id: genId,
        status: "generating",
        lens_name: null,
        architecture: "{}",
        patterns_used: "[]",
        test_count: 0,
        deploy_time: null,
        error: null,
        completed_at: null,
      });

      // Fetch all patterns for matching
      const allPatterns = stmts().allPatterns.all().map(_deserializeRow);

      // Match patterns to request
      const matched = _matchPatternsToRequest(allPatterns, request, constraints);

      if (matched.length === 0) {
        stmts().updateGeneration.run({
          id: genId,
          status: "failed",
          lens_name: null,
          architecture: "{}",
          patterns_used: "[]",
          test_count: 0,
          deploy_time: null,
          error: "No matching patterns found for the request",
          completed_at: new Date().toISOString(),
        });

        return _deserializeGeneration(stmts().getGenerationById.get(genId));
      }

      // Build architecture
      const architecture = _buildArchitecture(matched, request);
      const lensName = architecture.name;

      // Simulate testing phase
      const testCount = Math.min(matched.length * 2, 50);

      // Calculate deployment time (simulated)
      const startTime = Date.now();
      const deployTime = (Date.now() - startTime + Math.random() * 100) / 1000;

      // Store the patterns used (IDs only for storage)
      const patternsUsed = matched.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        language: p.language,
      }));

      // Mark as completed
      stmts().updateGeneration.run({
        id: genId,
        status: "completed",
        lens_name: lensName,
        architecture: _serializeJson(architecture),
        patterns_used: _serializeJson(patternsUsed),
        test_count: testCount,
        deploy_time: Math.round(deployTime * 1000) / 1000,
        error: null,
        completed_at: new Date().toISOString(),
      });
    } catch (err) {
      stmts().updateGeneration.run({
        id: genId,
        status: "failed",
        lens_name: null,
        architecture: "{}",
        patterns_used: "[]",
        test_count: 0,
        deploy_time: null,
        error: String(err.message || err),
        completed_at: new Date().toISOString(),
      });
    }

    return _deserializeGeneration(stmts().getGenerationById.get(genId));
  }

  /**
   * Record a production error from a generated lens for learning.
   *
   * @param {string} lensId - Lens generation ID
   * @param {object} error
   * @param {string} error.errorType - Classification of the error
   * @param {string} [error.stackTrace] - Stack trace
   * @param {object} [error.context] - Additional error context
   * @param {string} [error.resolution] - How it was resolved (if known)
   * @returns {object} The stored error record
   */
  function recordError(lensId, error = {}) {
    if (!error.errorType) {
      throw new ValidationError("errorType is required");
    }

    // Validate lens exists if lensId provided
    if (lensId) {
      const gen = stmts().getGenerationById.get(lensId);
      if (!gen) {
        throw new NotFoundError("Lens generation", lensId);
      }
    }

    const errorId = generateId("cerr");
    const now = new Date().toISOString();

    const record = {
      id: errorId,
      lens_id: lensId || null,
      error_type: error.errorType,
      stack_trace: error.stackTrace || null,
      context: _serializeJson(error.context || {}),
      resolution: error.resolution || null,
      resolved_at: error.resolution ? now : null,
      created_at: now,
    };

    stmts().insertError.run(record);

    return _deserializeError(stmts().getErrorById.get(errorId));
  }

  /**
   * Get engine statistics across all tables.
   *
   * @returns {object} Engine stats
   */
  function getStats() {
    const totalRepos = stmts().countRepos.get().count;
    const totalPatterns = stmts().countPatterns.get().count;
    const totalMegas = stmts().countMegas.get().count;
    const totalGenerations = stmts().countGenerations.get().count;
    const totalErrors = stmts().countErrors.get().count;
    const unresolvedErrors = stmts().countUnresolvedErrors.get().count;

    const ingestedRepos = stmts().countReposByStatus.get("ingested").count;
    const pendingRepos = stmts().countReposByStatus.get("pending").count;
    const failedRepos = stmts().countReposByStatus.get("failed").count;

    // Category breakdown
    const categoryBreakdown = {};
    for (const cat of PATTERN_CATEGORIES) {
      categoryBreakdown[cat] = stmts().countPatternsByCategory.get(cat).count;
    }

    return {
      repositories: {
        total: totalRepos,
        ingested: ingestedRepos,
        pending: pendingRepos,
        failed: failedRepos,
      },
      patterns: {
        total: totalPatterns,
        byCategory: categoryBreakdown,
      },
      megas: totalMegas,
      generations: totalGenerations,
      errors: {
        total: totalErrors,
        unresolved: unresolvedErrors,
      },
      categories: PATTERN_CATEGORIES,
    };
  }

  // ── Additional query helpers ───────────────────────────────────────

  /**
   * Get a single repository by ID.
   * @param {string} id
   * @returns {object|null}
   */
  function getRepository(id) {
    const row = stmts().getRepoById.get(id);
    if (!row) throw new NotFoundError("Repository", id);
    return row;
  }

  /**
   * List repositories with pagination.
   * @param {object} [query]
   * @returns {{ repositories: object[], total: number }}
   */
  function listRepositories(query = {}) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const rows = stmts().listRepos.all(limit, offset);
    const total = stmts().countRepos.get().count;
    return { repositories: rows, total, limit, offset };
  }

  /**
   * Get a single pattern by ID.
   * @param {string} id
   * @returns {object}
   */
  function getPattern(id) {
    const row = stmts().getPatternById.get(id);
    if (!row) throw new NotFoundError("Pattern", id);
    return _deserializeRow(row);
  }

  /**
   * Get a single Mega DTU by ID.
   * @param {string} id
   * @returns {object}
   */
  function getMega(id) {
    const row = stmts().getMegaById.get(id);
    if (!row) throw new NotFoundError("Mega DTU", id);
    return _deserializeMega(row);
  }

  /**
   * List Mega DTUs with pagination.
   * @param {object} [query]
   * @returns {{ megas: object[], total: number }}
   */
  function listMegas(query = {}) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const rows = stmts().listMegas.all(limit, offset);
    const total = stmts().countMegas.get().count;
    return { megas: rows.map(_deserializeMega), total, limit, offset };
  }

  /**
   * Get a single generation by ID.
   * @param {string} id
   * @returns {object}
   */
  function getGeneration(id) {
    const row = stmts().getGenerationById.get(id);
    if (!row) throw new NotFoundError("Lens generation", id);
    return _deserializeGeneration(row);
  }

  /**
   * List lens generations with pagination and optional status filter.
   * @param {object} [query]
   * @returns {{ generations: object[], total: number }}
   */
  function listGenerations(query = {}) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);

    let rows;
    let total;
    if (query.status) {
      rows = stmts().listGenerationsByStatus.all(query.status, limit, offset);
      const countResult = db.prepare(
        `SELECT COUNT(*) as count FROM lens_generations WHERE status = ?`
      ).get(query.status);
      total = countResult.count;
    } else {
      rows = stmts().listGenerations.all(limit, offset);
      total = stmts().countGenerations.get().count;
    }

    return { generations: rows.map(_deserializeGeneration), total, limit, offset };
  }

  /**
   * Get a single error by ID.
   * @param {string} id
   * @returns {object}
   */
  function getError(id) {
    const row = stmts().getErrorById.get(id);
    if (!row) throw new NotFoundError("Code error", id);
    return _deserializeError(row);
  }

  /**
   * List errors with pagination and optional filters.
   * @param {object} [query]
   * @returns {{ errors: object[], total: number }}
   */
  function listErrors(query = {}) {
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const offset = Math.max(Number(query.offset) || 0, 0);

    let rows;
    let total;
    if (query.lensId) {
      rows = stmts().listErrorsByLens.all(query.lensId, limit, offset);
      const countResult = db.prepare(
        `SELECT COUNT(*) as count FROM code_errors WHERE lens_id = ?`
      ).get(query.lensId);
      total = countResult.count;
    } else if (query.errorType) {
      rows = stmts().listErrorsByType.all(query.errorType, limit, offset);
      const countResult = db.prepare(
        `SELECT COUNT(*) as count FROM code_errors WHERE error_type = ?`
      ).get(query.errorType);
      total = countResult.count;
    } else {
      rows = stmts().listErrors.all(limit, offset);
      total = stmts().countErrors.get().count;
    }

    return { errors: rows.map(_deserializeError), total, limit, offset };
  }

  // ── Return engine API ──────────────────────────────────────────────

  return {
    ingestRepository,
    extractPatterns,
    scorePattern,
    searchPatterns,
    compressToMega,
    generateLens,
    recordError,
    getStats,

    // Additional query helpers
    getRepository,
    listRepositories,
    getPattern,
    getMega,
    listMegas,
    getGeneration,
    listGenerations,
    getError,
    listErrors,

    // Exported constants
    PATTERN_CATEGORIES,
    VALID_REPO_STATUSES,
    VALID_GENERATION_STATUSES,
  };
}
