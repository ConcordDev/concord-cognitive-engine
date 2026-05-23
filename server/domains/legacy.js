// server/domains/legacy.js
// Domain actions for legacy system management: technical debt computation,
// migration readiness assessment, and risk mapping.

export default function registerLegacyActions(registerLensAction) {
  /**
   * technicalDebt
   * Compute technical debt: complexity metrics, dependency age, test coverage
   * gaps, and maintainability index.
   * artifact.data.modules = [{ name, linesOfCode, cyclomaticComplexity?, dependencyCount?, dependencyAgeYears?, testCoverage?, duplicateRatio?, lastModifiedDaysAgo? }]
   */
  registerLensAction("legacy", "technicalDebt", (ctx, artifact, params) => {
  try {
    const modules = artifact.data?.modules || [];
    if (modules.length === 0) return { ok: true, result: { message: "No modules to analyze." } };

    const analyzed = modules.map(mod => {
      const loc = mod.linesOfCode || 0;
      const cc = mod.cyclomaticComplexity || 1;
      const depCount = mod.dependencyCount || 0;
      const depAge = mod.dependencyAgeYears || 0;
      const testCoverage = mod.testCoverage != null ? mod.testCoverage : 50;
      const duplicateRatio = mod.duplicateRatio || 0;
      const lastModifiedDays = mod.lastModifiedDaysAgo || 0;

      // Halstead-inspired volume (simplified)
      const volume = loc > 0 ? loc * Math.log2(Math.max(2, cc)) : 0;

      // Maintainability Index (MI) — SEI formula adapted
      // MI = 171 - 5.2*ln(V) - 0.23*CC - 16.2*ln(LOC) + 50*sin(sqrt(2.4*CM))
      // where CM = comment ratio (estimated from coverage as proxy)
      const lnVolume = volume > 0 ? Math.log(volume) : 0;
      const lnLoc = loc > 0 ? Math.log(loc) : 0;
      const commentProxy = testCoverage / 100; // rough proxy
      const rawMI = 171 - 5.2 * lnVolume - 0.23 * cc - 16.2 * lnLoc + 50 * Math.sin(Math.sqrt(2.4 * commentProxy));
      const maintainabilityIndex = Math.round(Math.max(0, Math.min(100, rawMI)) * 100) / 100;

      // Technical debt score (0-100, higher = more debt)
      const complexityDebt = Math.min(30, cc > 10 ? (cc - 10) * 1.5 : 0);
      const coverageDebt = Math.min(25, Math.max(0, (100 - testCoverage) * 0.25));
      const dependencyDebt = Math.min(20, depAge * 3 + depCount * 0.5);
      const duplicationDebt = Math.min(15, duplicateRatio * 100);
      const staleDebt = Math.min(10, lastModifiedDays > 365 ? 10 : lastModifiedDays > 180 ? 5 : 0);

      const debtScore = Math.round((complexityDebt + coverageDebt + dependencyDebt + duplicationDebt + staleDebt) * 100) / 100;

      // Estimated remediation hours (rough: 1 debt point ≈ 2 hours)
      const remediationHours = Math.round(debtScore * 2 * 10) / 10;

      return {
        name: mod.name,
        metrics: { linesOfCode: loc, cyclomaticComplexity: cc, testCoverage, duplicateRatio, dependencyCount: depCount, dependencyAgeYears: depAge },
        maintainabilityIndex,
        maintainabilityLevel: maintainabilityIndex >= 65 ? "good" : maintainabilityIndex >= 40 ? "moderate" : "poor",
        debtScore,
        debtLevel: debtScore >= 60 ? "critical" : debtScore >= 40 ? "high" : debtScore >= 20 ? "moderate" : "low",
        debtBreakdown: { complexity: Math.round(complexityDebt * 100) / 100, coverage: Math.round(coverageDebt * 100) / 100, dependencies: Math.round(dependencyDebt * 100) / 100, duplication: Math.round(duplicationDebt * 100) / 100, staleness: Math.round(staleDebt * 100) / 100 },
        remediationHours,
      };
    });

    // Sort by debt score descending
    analyzed.sort((a, b) => b.debtScore - a.debtScore);

    const totalDebt = analyzed.reduce((s, m) => s + m.debtScore, 0);
    const avgDebt = totalDebt / analyzed.length;
    const totalRemediation = analyzed.reduce((s, m) => s + m.remediationHours, 0);

    artifact.data.debtReport = { timestamp: new Date().toISOString(), totalDebt: Math.round(totalDebt * 100) / 100, moduleCount: modules.length };

    return {
      ok: true, result: {
        modules: analyzed,
        summary: {
          totalModules: modules.length,
          avgDebtScore: Math.round(avgDebt * 100) / 100,
          totalDebtScore: Math.round(totalDebt * 100) / 100,
          totalRemediationHours: Math.round(totalRemediation * 10) / 10,
          criticalModules: analyzed.filter(m => m.debtLevel === "critical").length,
          highDebtModules: analyzed.filter(m => m.debtLevel === "high").length,
          avgMaintainability: Math.round((analyzed.reduce((s, m) => s + m.maintainabilityIndex, 0) / analyzed.length) * 100) / 100,
        },
        topDebtSources: analyzed.slice(0, 5).map(m => ({ name: m.name, debtScore: m.debtScore, primaryFactor: Object.entries(m.debtBreakdown).sort((a, b) => b[1] - a[1])[0] })),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * migrationReadiness
   * Assess migration readiness: dependency mapping, API surface analysis,
   * and data portability scoring.
   * artifact.data.system = { modules: [{ name, dependencies: [string], apis: [{ endpoint, method?, consumers?: number }], dataStores: [{ type, sizeGb?, portable?: bool }] }] }
   */
  registerLensAction("legacy", "migrationReadiness", (ctx, artifact, params) => {
  try {
    const system = artifact.data?.system || {};
    const modules = system.modules || [];
    if (modules.length === 0) return { ok: true, result: { message: "No system modules defined." } };

    // Dependency mapping
    const depGraph = {};
    const allDeps = new Set();
    for (const mod of modules) {
      depGraph[mod.name] = mod.dependencies || [];
      for (const dep of mod.dependencies || []) allDeps.add(dep);
    }

    // Internal vs external dependencies
    const moduleNames = new Set(modules.map(m => m.name));
    const internalDeps = {};
    const externalDeps = {};
    for (const mod of modules) {
      internalDeps[mod.name] = (mod.dependencies || []).filter(d => moduleNames.has(d));
      externalDeps[mod.name] = (mod.dependencies || []).filter(d => !moduleNames.has(d));
    }

    // Coupling score: ratio of internal dependencies to total possible
    const maxPossibleInternal = modules.length * (modules.length - 1);
    const totalInternalDeps = Object.values(internalDeps).reduce((s, arr) => s + arr.length, 0);
    const couplingScore = maxPossibleInternal > 0
      ? Math.round((totalInternalDeps / maxPossibleInternal) * 10000) / 100
      : 0;

    // API surface analysis
    const apiSurface = modules.map(mod => {
      const apis = mod.apis || [];
      const totalConsumers = apis.reduce((s, a) => s + (a.consumers || 0), 0);
      return {
        module: mod.name,
        endpointCount: apis.length,
        totalConsumers,
        avgConsumers: apis.length > 0 ? Math.round((totalConsumers / apis.length) * 100) / 100 : 0,
        highTrafficEndpoints: apis.filter(a => (a.consumers || 0) > 5).map(a => a.endpoint),
      };
    });

    // Data portability scoring
    const portableTypes = new Set(["postgres", "mysql", "sqlite", "json", "csv", "parquet", "s3"]);
    const dataAnalysis = modules.map(mod => {
      const stores = mod.dataStores || [];
      const totalSize = stores.reduce((s, d) => s + (d.sizeGb || 0), 0);
      const portableStores = stores.filter(d => d.portable !== false && portableTypes.has((d.type || "").toLowerCase()));
      const portabilityScore = stores.length > 0
        ? Math.round((portableStores.length / stores.length) * 100)
        : 100;

      return {
        module: mod.name,
        storeCount: stores.length,
        totalSizeGb: Math.round(totalSize * 100) / 100,
        portabilityScore,
        stores: stores.map(d => ({ type: d.type, sizeGb: d.sizeGb || 0, portable: portableTypes.has((d.type || "").toLowerCase()) || d.portable === true })),
      };
    });

    // Per-module readiness score
    const moduleReadiness = modules.map(mod => {
      const api = apiSurface.find(a => a.module === mod.name) || {};
      const data = dataAnalysis.find(d => d.module === mod.name) || {};
      const extDeps = (externalDeps[mod.name] || []).length;
      const intDeps = (internalDeps[mod.name] || []).length;

      // Readiness factors (each 0-25, total 0-100)
      const depScore = Math.max(0, 25 - (extDeps * 3 + intDeps * 2));
      const apiScore = Math.max(0, 25 - (api.totalConsumers || 0) * 0.5);
      const dataScore = (data.portabilityScore || 100) * 0.25;
      const sizeScore = Math.max(0, 25 - (data.totalSizeGb || 0) * 0.5);

      const readiness = Math.round((depScore + apiScore + dataScore + sizeScore) * 100) / 100;

      return {
        module: mod.name,
        readinessScore: readiness,
        readinessLevel: readiness >= 75 ? "ready" : readiness >= 50 ? "moderate" : readiness >= 25 ? "difficult" : "blocked",
        factors: { dependencies: Math.round(depScore * 100) / 100, apiImpact: Math.round(apiScore * 100) / 100, dataPortability: Math.round(dataScore * 100) / 100, dataSize: Math.round(sizeScore * 100) / 100 },
        externalDependencies: externalDeps[mod.name] || [],
        internalDependencies: internalDeps[mod.name] || [],
      };
    });

    moduleReadiness.sort((a, b) => b.readinessScore - a.readinessScore);

    // Suggested migration order: modules with fewest dependencies first
    const migrationOrder = [...moduleReadiness].sort((a, b) => {
      const aDeps = (internalDeps[a.module] || []).length;
      const bDeps = (internalDeps[b.module] || []).length;
      return aDeps - bDeps;
    }).map((m, idx) => ({ phase: idx + 1, module: m.module, readiness: m.readinessScore }));

    return {
      ok: true, result: {
        moduleReadiness,
        migrationOrder,
        apiSurface,
        dataAnalysis,
        coupling: { score: couplingScore, level: couplingScore > 50 ? "tightly_coupled" : couplingScore > 20 ? "moderately_coupled" : "loosely_coupled" },
        summary: {
          totalModules: modules.length,
          avgReadiness: Math.round((moduleReadiness.reduce((s, m) => s + m.readinessScore, 0) / moduleReadiness.length) * 100) / 100,
          readyModules: moduleReadiness.filter(m => m.readinessLevel === "ready").length,
          blockedModules: moduleReadiness.filter(m => m.readinessLevel === "blocked").length,
          totalDataGb: Math.round(dataAnalysis.reduce((s, d) => s + d.totalSizeGb, 0) * 100) / 100,
          externalDependencyCount: [...new Set(Object.values(externalDeps).flat())].length,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * riskMap
   * Map legacy risks: component criticality, knowledge concentration (bus factor),
   * and failure frequency trending.
   * artifact.data.components = [{ name, criticality: 1-5, knowledgeHolders: [string], failures: [{ date, severity: 1-5 }], revenueImpact?: number }]
   */
  registerLensAction("legacy", "riskMap", (ctx, artifact, params) => {
  try {
    const components = artifact.data?.components || [];
    if (components.length === 0) return { ok: true, result: { message: "No components to assess." } };

    const riskAnalysis = components.map(comp => {
      const criticality = Math.max(1, Math.min(5, comp.criticality || 3));
      const holders = comp.knowledgeHolders || [];
      const failures = comp.failures || [];

      // Bus factor: number of knowledge holders
      const busFactor = holders.length;
      const busFactorRisk = busFactor === 0 ? 5 : busFactor === 1 ? 4 : busFactor === 2 ? 3 : busFactor <= 4 ? 2 : 1;

      // Failure frequency trending
      const now = Date.now();
      const failureDates = failures
        .map(f => new Date(f.date).getTime())
        .filter(t => !isNaN(t))
        .sort((a, b) => a - b);

      let failureTrend = "stable";
      let recentFailureRate = 0;
      let historicFailureRate = 0;

      if (failureDates.length >= 2) {
        const midpoint = failureDates[0] + (failureDates[failureDates.length - 1] - failureDates[0]) / 2;
        const firstHalf = failureDates.filter(d => d <= midpoint).length;
        const secondHalf = failureDates.filter(d => d > midpoint).length;
        const halfDuration = (failureDates[failureDates.length - 1] - failureDates[0]) / 2;
        const durationDays = halfDuration / (1000 * 60 * 60 * 24);

        if (durationDays > 0) {
          historicFailureRate = Math.round((firstHalf / durationDays) * 3000) / 100; // per 30 days
          recentFailureRate = Math.round((secondHalf / durationDays) * 3000) / 100;
        }

        if (secondHalf > firstHalf * 1.5) failureTrend = "increasing";
        else if (secondHalf < firstHalf * 0.5) failureTrend = "decreasing";
      }

      // Mean severity of failures
      const avgSeverity = failures.length > 0
        ? Math.round((failures.reduce((s, f) => s + (f.severity || 3), 0) / failures.length) * 100) / 100
        : 0;

      // Mean time between failures (MTBF) in days
      let mtbf = null;
      if (failureDates.length >= 2) {
        const totalSpanDays = (failureDates[failureDates.length - 1] - failureDates[0]) / (1000 * 60 * 60 * 24);
        mtbf = Math.round((totalSpanDays / (failureDates.length - 1)) * 100) / 100;
      }

      // Composite risk score (0-100)
      const criticalityWeight = (criticality / 5) * 30;
      const busFactorWeight = (busFactorRisk / 5) * 25;
      const failureWeight = Math.min(25, failures.length * 2 + (failureTrend === "increasing" ? 10 : 0));
      const severityWeight = (avgSeverity / 5) * 20;

      const riskScore = Math.round((criticalityWeight + busFactorWeight + failureWeight + severityWeight) * 100) / 100;

      return {
        name: comp.name,
        riskScore,
        riskLevel: riskScore >= 70 ? "critical" : riskScore >= 50 ? "high" : riskScore >= 30 ? "moderate" : "low",
        criticality: { score: criticality, label: ["", "minimal", "low", "moderate", "high", "critical"][criticality] },
        busFactor: { holders: holders.length, names: holders, riskScore: busFactorRisk, warning: busFactor <= 1 ? "Single point of knowledge failure" : null },
        failures: {
          total: failures.length,
          avgSeverity,
          trend: failureTrend,
          historicRate: historicFailureRate,
          recentRate: recentFailureRate,
          mtbfDays: mtbf,
        },
        revenueImpact: comp.revenueImpact || null,
        riskBreakdown: { criticality: Math.round(criticalityWeight * 100) / 100, busFactor: Math.round(busFactorWeight * 100) / 100, failureHistory: Math.round(failureWeight * 100) / 100, severity: Math.round(severityWeight * 100) / 100 },
      };
    });

    riskAnalysis.sort((a, b) => b.riskScore - a.riskScore);

    // Knowledge concentration: find people who are single holders
    const holderCounts = {};
    for (const comp of components) {
      for (const holder of comp.knowledgeHolders || []) {
        if (!holderCounts[holder]) holderCounts[holder] = [];
        holderCounts[holder].push(comp.name);
      }
    }
    const keyPersonRisks = Object.entries(holderCounts)
      .map(([person, comps]) => ({ person, componentCount: comps.length, components: comps }))
      .sort((a, b) => b.componentCount - a.componentCount);

    return {
      ok: true, result: {
        components: riskAnalysis,
        keyPersonRisks: keyPersonRisks.slice(0, 10),
        summary: {
          totalComponents: components.length,
          avgRiskScore: Math.round((riskAnalysis.reduce((s, c) => s + c.riskScore, 0) / riskAnalysis.length) * 100) / 100,
          criticalRiskCount: riskAnalysis.filter(c => c.riskLevel === "critical").length,
          singleHolderCount: riskAnalysis.filter(c => c.busFactor.holders <= 1).length,
          increasingFailureCount: riskAnalysis.filter(c => c.failures.trend === "increasing").length,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ──────────────────────────────────────────────────────────────────
  // Codebase scanning + modernization analysis (SonarQube / CAST parity)
  // ──────────────────────────────────────────────────────────────────

  const lgState = () => {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.legacyLens) STATE.legacyLens = {};
    const s = STATE.legacyLens;
    for (const k of ["codebases", "snapshots"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  };
  const lgSave = () => {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  };
  const lgUid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const lgId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const lgNow = () => new Date().toISOString();
  const lgClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const lgNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const lgList = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const r2 = (n) => Math.round(n * 100) / 100;

  // Language inference + crude metric extraction from a raw source string.
  const LANG_EXT = {
    js: "JavaScript", jsx: "JavaScript", ts: "TypeScript", tsx: "TypeScript",
    py: "Python", java: "Java", rb: "Ruby", go: "Go", rs: "Rust",
    c: "C", h: "C", cpp: "C++", cc: "C++", cs: "C#", php: "PHP",
    cob: "COBOL", cbl: "COBOL", pli: "PL/I", f: "Fortran", f90: "Fortran",
    sql: "SQL", sh: "Shell", pl: "Perl", scala: "Scala", kt: "Kotlin",
    swift: "Swift", vb: "VB.NET", asp: "Classic ASP", jsp: "JSP",
  };
  const LEGACY_LANGS = new Set(["COBOL", "PL/I", "Fortran", "Perl", "VB.NET", "Classic ASP", "JSP"]);

  // Branch/decision keywords used as a cyclomatic-complexity proxy.
  const BRANCH_RE = /\b(if|else if|elif|for|while|case|when|catch|&&|\|\||\?|EVALUATE|PERFORM\s+UNTIL)\b/g;
  // Import/include keywords used as a dependency proxy.
  const IMPORT_RE = /^\s*(import\s+[\w.{} *,]+\s+from\s+['"][^'"]+['"]|import\s+['"][^'"]+['"]|from\s+[\w.]+\s+import|#include\s*[<"][^>"]+[>"]|require\(\s*['"][^'"]+['"]\s*\)|use\s+[\w:]+|COPY\s+\w+)/gmi;
  const IMPORT_TARGET_RE = /from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|#include\s*[<"]([^>"]+)[>"]|require\(\s*['"]([^'"]+)['"]\s*\)|COPY\s+(\w+)/i;
  const TODO_RE = /\b(TODO|FIXME|HACK|XXX|DEPRECATED)\b/g;

  function scanFile(file) {
    const path = lgClean(file.path || file.name || "unknown", 300);
    const content = String(file.content || "");
    const ext = (path.split(".").pop() || "").toLowerCase();
    const language = file.language ? lgClean(file.language, 40) : (LANG_EXT[ext] || "Unknown");
    const rawLines = content.split("\n");
    const linesOfCode = content
      ? rawLines.filter(l => l.trim() && !/^\s*(\/\/|#|\*|--|\*>)/.test(l)).length
      : lgNum(file.linesOfCode, 0);
    const commentLines = rawLines.filter(l => /^\s*(\/\/|#|\*|--|\*>)/.test(l)).length;
    const branchHits = content ? (content.match(BRANCH_RE) || []).length : 0;
    const cyclomaticComplexity = content
      ? Math.max(1, branchHits + 1)
      : Math.max(1, lgNum(file.cyclomaticComplexity, 1));
    const importLines = content ? (content.match(IMPORT_RE) || []) : [];
    const dependencies = [];
    for (const line of importLines) {
      const m = line.match(IMPORT_TARGET_RE);
      if (m) {
        const target = (m[1] || m[2] || m[3] || m[4] || m[5] || "").trim();
        if (target && !dependencies.includes(target)) dependencies.push(target);
      }
    }
    const todoCount = content ? (content.match(TODO_RE) || []).length : 0;
    const commentRatio = linesOfCode > 0 ? r2(commentLines / (linesOfCode + commentLines)) : 0;
    const testCoverage = file.testCoverage != null ? lgNum(file.testCoverage, 0)
      : (/\.(test|spec)\.|_test\.|test_/i.test(path) ? 100 : 0);
    return {
      path, language,
      linesOfCode, commentLines, commentRatio,
      cyclomaticComplexity,
      dependencies, dependencyCount: dependencies.length,
      todoCount,
      isTest: /\.(test|spec)\.|_test\.|test_/i.test(path),
      isLegacyLanguage: LEGACY_LANGS.has(language),
      churn: Math.max(0, Math.round(lgNum(file.churn ?? file.commits, 0))),
      lastModifiedDaysAgo: Math.max(0, Math.round(lgNum(file.lastModifiedDaysAgo, 0))),
    };
  }

  /**
   * scanCodebase — ingest an actual set of source files, derive per-file
   * metrics, and persist as a named codebase snapshot.
   * params = { name, files: [{ path, content?, language?, churn?, lastModifiedDaysAgo?, testCoverage? }] }
   */
  registerLensAction("legacy", "scanCodebase", (ctx, _artifact, params = {}) => {
    try {
      const s = lgState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const files = Array.isArray(params.files) ? params.files : [];
      if (files.length === 0) return { ok: false, error: "no files supplied to scan" };
      const name = lgClean(params.name, 120) || "untitled-codebase";
      const scanned = files.slice(0, 5000).map(scanFile);

      const totalLoc = scanned.reduce((a, f) => a + f.linesOfCode, 0);
      const langTotals = {};
      for (const f of scanned) {
        langTotals[f.language] = (langTotals[f.language] || 0) + f.linesOfCode;
      }
      const languages = Object.entries(langTotals)
        .map(([lang, loc]) => ({ language: lang, linesOfCode: loc, pctOfCodebase: totalLoc > 0 ? r2(loc / totalLoc * 100) : 0, legacy: LEGACY_LANGS.has(lang) }))
        .sort((a, b) => b.linesOfCode - a.linesOfCode);
      const testFiles = scanned.filter(f => f.isTest);
      const prodFiles = scanned.filter(f => !f.isTest);
      const prodLoc = prodFiles.reduce((a, f) => a + f.linesOfCode, 0);
      const testLoc = testFiles.reduce((a, f) => a + f.linesOfCode, 0);

      const summary = {
        fileCount: scanned.length,
        totalLinesOfCode: totalLoc,
        productionFiles: prodFiles.length,
        testFiles: testFiles.length,
        testToCodeRatio: prodLoc > 0 ? r2(testLoc / prodLoc) : 0,
        avgComplexity: scanned.length > 0 ? r2(scanned.reduce((a, f) => a + f.cyclomaticComplexity, 0) / scanned.length) : 0,
        totalTodos: scanned.reduce((a, f) => a + f.todoCount, 0),
        legacyLanguageFiles: scanned.filter(f => f.isLegacyLanguage).length,
        avgCommentRatio: scanned.length > 0 ? r2(scanned.reduce((a, f) => a + f.commentRatio, 0) / scanned.length) : 0,
      };

      const codebase = {
        id: lgId("cb"), name,
        files: scanned,
        languages, summary,
        scannedAt: lgNow(),
      };
      const arr = lgList(s.codebases, lgUid(ctx));
      arr.unshift(codebase);
      if (arr.length > 30) arr.length = 30;
      lgSave();
      return { ok: true, result: { codebase: { id: codebase.id, name, languages, summary, scannedAt: codebase.scannedAt }, files: scanned } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** listCodebases — all scanned codebases for the user. */
  registerLensAction("legacy", "listCodebases", (ctx, _a, _p = {}) => {
    try {
      const s = lgState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const list = (s.codebases.get(lgUid(ctx)) || []).map(cb => ({
        id: cb.id, name: cb.name, scannedAt: cb.scannedAt,
        languages: cb.languages, summary: cb.summary,
      }));
      return { ok: true, result: { codebases: list, count: list.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** getCodebase — full scan record incl. per-file metrics. params = { id } */
  registerLensAction("legacy", "getCodebase", (ctx, _a, params = {}) => {
    try {
      const s = lgState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const cb = (s.codebases.get(lgUid(ctx)) || []).find(c => c.id === params.id);
      if (!cb) return { ok: false, error: "codebase not found" };
      return { ok: true, result: { codebase: cb } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /** deleteCodebase — params = { id } */
  registerLensAction("legacy", "deleteCodebase", (ctx, _a, params = {}) => {
    try {
      const s = lgState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const arr = s.codebases.get(lgUid(ctx)) || [];
      const i = arr.findIndex(c => c.id === params.id);
      if (i < 0) return { ok: false, error: "codebase not found" };
      arr.splice(i, 1);
      lgSave();
      return { ok: true, result: { deleted: params.id } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Resolve a file's import targets to other files in the same codebase.
  function buildDependencyGraph(files) {
    // index by basename (no extension) and by path tail
    const byKey = new Map();
    for (const f of files) {
      const base = (f.path.split("/").pop() || f.path).replace(/\.[^.]+$/, "");
      if (!byKey.has(base)) byKey.set(base, []);
      byKey.get(base).push(f.path);
    }
    const nodes = files.map(f => f.path);
    const edges = [];
    const adj = new Map(nodes.map(n => [n, new Set()]));
    for (const f of files) {
      for (const dep of f.dependencies) {
        const depBase = (dep.split("/").pop() || dep).replace(/\.[^.]+$/, "");
        const matches = byKey.get(depBase) || [];
        for (const target of matches) {
          if (target !== f.path && !adj.get(f.path).has(target)) {
            adj.get(f.path).add(target);
            edges.push({ from: f.path, to: target });
          }
        }
      }
    }
    return { nodes, edges, adj };
  }

  // Tarjan SCC to find cycles in a directed graph.
  function findCycles(nodes, adj) {
    let idx = 0;
    const index = new Map(), low = new Map(), onStack = new Set();
    const stack = [];
    const sccs = [];
    function strongconnect(v) {
      index.set(v, idx); low.set(v, idx); idx++;
      stack.push(v); onStack.add(v);
      for (const w of adj.get(v) || []) {
        if (!index.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
        else if (onStack.has(w)) { low.set(v, Math.min(low.get(v), index.get(w))); }
      }
      if (low.get(v) === index.get(v)) {
        const comp = [];
        let w;
        do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
        sccs.push(comp);
      }
    }
    for (const v of nodes) if (!index.has(v)) strongconnect(v);
    // a cycle = SCC of size > 1, or a self-loop
    return sccs.filter(c => c.length > 1 || (c.length === 1 && (adj.get(c[0]) || new Set()).has(c[0])));
  }

  /**
   * dependencyGraph — build a dependency graph from a scanned codebase,
   * highlight cycles + fan-in/fan-out hotspots.
   * params = { codebaseId } OR { files: [...] }
   */
  registerLensAction("legacy", "dependencyGraph", (ctx, artifact, params = {}) => {
    try {
      const s = lgState();
      let files = null;
      if (params.codebaseId && s) {
        const cb = (s.codebases.get(lgUid(ctx)) || []).find(c => c.id === params.codebaseId);
        if (!cb) return { ok: false, error: "codebase not found" };
        files = cb.files;
      } else if (Array.isArray(params.files)) {
        files = params.files.map(scanFile);
      } else if (Array.isArray(artifact?.data?.files)) {
        files = artifact.data.files.map(scanFile);
      }
      if (!files || files.length === 0) return { ok: false, error: "no codebase or files supplied" };

      const { nodes, edges, adj } = buildDependencyGraph(files);
      const fanOut = new Map(nodes.map(n => [n, 0]));
      const fanIn = new Map(nodes.map(n => [n, 0]));
      for (const e of edges) {
        fanOut.set(e.from, (fanOut.get(e.from) || 0) + 1);
        fanIn.set(e.to, (fanIn.get(e.to) || 0) + 1);
      }
      const cycles = findCycles(nodes, adj);
      const inCycle = new Set(cycles.flat());

      const graphNodes = nodes.map(n => {
        const out = fanOut.get(n) || 0;
        const inn = fanIn.get(n) || 0;
        // instability metric (Robert Martin): I = Ce / (Ca + Ce)
        const instability = (out + inn) > 0 ? r2(out / (out + inn)) : 0;
        return {
          id: n, label: n.split("/").pop() || n, path: n,
          fanIn: inn, fanOut: out, coupling: inn + out,
          instability,
          inCycle: inCycle.has(n),
          hotspot: (inn + out) >= 6 || inCycle.has(n),
        };
      }).sort((a, b) => b.coupling - a.coupling);

      const hotspots = graphNodes.filter(n => n.hotspot).slice(0, 15);
      return {
        ok: true, result: {
          nodes: graphNodes, edges,
          cycles: cycles.map((c, i) => ({ id: i + 1, members: c, size: c.length })),
          hotspots,
          summary: {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            cycleCount: cycles.length,
            filesInCycles: inCycle.size,
            maxFanOut: Math.max(0, ...[...fanOut.values()]),
            maxFanIn: Math.max(0, ...[...fanIn.values()]),
            avgCoupling: nodes.length > 0 ? r2(edges.length * 2 / nodes.length) : 0,
          },
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * hotspotRanking — rank files by churn × complexity (the SonarQube
   * "hotspot" prioritization heuristic).
   * params = { codebaseId } OR { files: [...] }
   */
  registerLensAction("legacy", "hotspotRanking", (ctx, artifact, params = {}) => {
    try {
      const s = lgState();
      let files = null;
      if (params.codebaseId && s) {
        const cb = (s.codebases.get(lgUid(ctx)) || []).find(c => c.id === params.codebaseId);
        if (!cb) return { ok: false, error: "codebase not found" };
        files = cb.files;
      } else if (Array.isArray(params.files)) {
        files = params.files.map(scanFile);
      } else if (Array.isArray(artifact?.data?.files)) {
        files = artifact.data.files.map(scanFile);
      }
      if (!files || files.length === 0) return { ok: false, error: "no codebase or files supplied" };

      const prod = files.filter(f => !f.isTest);
      const maxChurn = Math.max(1, ...prod.map(f => f.churn));
      const maxCx = Math.max(1, ...prod.map(f => f.cyclomaticComplexity));
      const ranked = prod.map(f => {
        const churnN = f.churn / maxChurn;          // 0..1
        const cxN = f.cyclomaticComplexity / maxCx; // 0..1
        // hotspot index — geometric blend so a file must be high on BOTH
        const hotspotIndex = r2(Math.sqrt(churnN * cxN) * 100);
        const priority = hotspotIndex >= 60 ? "critical" : hotspotIndex >= 35 ? "high" : hotspotIndex >= 15 ? "moderate" : "low";
        return {
          path: f.path, language: f.language,
          churn: f.churn, complexity: f.cyclomaticComplexity,
          linesOfCode: f.linesOfCode, todoCount: f.todoCount,
          hotspotIndex, priority,
        };
      }).sort((a, b) => b.hotspotIndex - a.hotspotIndex);

      return {
        ok: true, result: {
          hotspots: ranked,
          topHotspots: ranked.slice(0, 10),
          summary: {
            fileCount: prod.length,
            criticalCount: ranked.filter(h => h.priority === "critical").length,
            highCount: ranked.filter(h => h.priority === "high").length,
            avgHotspotIndex: ranked.length > 0 ? r2(ranked.reduce((a, h) => a + h.hotspotIndex, 0) / ranked.length) : 0,
          },
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * migrationRoadmap — generate a sequenced refactor plan with effort
   * estimates from a scanned codebase. Topologically orders by dependency
   * depth so leaf modules migrate first.
   * params = { codebaseId, hoursPerKloc?, hoursPerComplexity? } OR { files: [...] }
   */
  registerLensAction("legacy", "migrationRoadmap", (ctx, artifact, params = {}) => {
    try {
      const s = lgState();
      let files = null, cbName = "codebase";
      if (params.codebaseId && s) {
        const cb = (s.codebases.get(lgUid(ctx)) || []).find(c => c.id === params.codebaseId);
        if (!cb) return { ok: false, error: "codebase not found" };
        files = cb.files; cbName = cb.name;
      } else if (Array.isArray(params.files)) {
        files = params.files.map(scanFile);
      } else if (Array.isArray(artifact?.data?.files)) {
        files = artifact.data.files.map(scanFile);
      }
      if (!files || files.length === 0) return { ok: false, error: "no codebase or files supplied" };

      const prod = files.filter(f => !f.isTest);
      const { nodes, adj } = buildDependencyGraph(prod);
      const fileByPath = new Map(prod.map(f => [f.path, f]));

      // dependency depth: longest path of outgoing deps (memoized, cycle-safe)
      const depthMemo = new Map();
      function depthOf(n, seen = new Set()) {
        if (depthMemo.has(n)) return depthMemo.get(n);
        if (seen.has(n)) return 0;
        seen.add(n);
        let d = 0;
        for (const w of adj.get(n) || []) d = Math.max(d, 1 + depthOf(w, seen));
        seen.delete(n);
        depthMemo.set(n, d);
        return d;
      }

      const hoursPerKloc = lgNum(params.hoursPerKloc, 40);
      const hoursPerComplexity = lgNum(params.hoursPerComplexity, 1.5);

      const planned = nodes.map(n => {
        const f = fileByPath.get(n);
        const loc = f?.linesOfCode || 0;
        const cx = f?.cyclomaticComplexity || 1;
        const effortHours = r2((loc / 1000) * hoursPerKloc + cx * hoursPerComplexity);
        return {
          path: n, label: n.split("/").pop() || n,
          depth: depthOf(n),
          linesOfCode: loc, complexity: cx,
          legacy: !!f?.isLegacyLanguage,
          effortHours,
          riskTag: cx > 30 ? "high-complexity" : f?.isLegacyLanguage ? "legacy-language" : loc > 1500 ? "large-file" : "standard",
        };
      });

      // group into phases by ascending depth (leaves first)
      const maxDepth = Math.max(0, ...planned.map(p => p.depth));
      const phases = [];
      for (let d = 0; d <= maxDepth; d++) {
        const members = planned.filter(p => p.depth === d).sort((a, b) => a.effortHours - b.effortHours);
        if (members.length === 0) continue;
        phases.push({
          phase: phases.length + 1,
          dependencyDepth: d,
          rationale: d === 0 ? "Leaf modules — no internal dependents to break"
            : `Modules whose dependencies are all migrated by phase ${phases.length}`,
          modules: members,
          moduleCount: members.length,
          effortHours: r2(members.reduce((a, m) => a + m.effortHours, 0)),
        });
      }
      const totalEffort = r2(planned.reduce((a, p) => a + p.effortHours, 0));

      return {
        ok: true, result: {
          codebase: cbName,
          phases,
          summary: {
            totalModules: planned.length,
            totalPhases: phases.length,
            totalEffortHours: totalEffort,
            totalEffortWeeks: r2(totalEffort / 40),
            highRiskModules: planned.filter(p => p.riskTag !== "standard").length,
            assumptions: { hoursPerKloc, hoursPerComplexity },
          },
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * modernizationROI — rewrite vs refactor vs retire decision model for a
   * set of modules.
   * params = { modules: [{ name, linesOfCode, debtScore?, businessValue? (1-5), usageFrequency? (1-5), annualMaintenanceCost? }],
   *            blendedRate? }  OR  { codebaseId } (derives modules from scan)
   */
  registerLensAction("legacy", "modernizationROI", (ctx, artifact, params = {}) => {
    try {
      const s = lgState();
      let modules = Array.isArray(params.modules) ? params.modules : null;
      if (!modules && params.codebaseId && s) {
        const cb = (s.codebases.get(lgUid(ctx)) || []).find(c => c.id === params.codebaseId);
        if (!cb) return { ok: false, error: "codebase not found" };
        modules = cb.files.filter(f => !f.isTest).map(f => ({
          name: f.path, linesOfCode: f.linesOfCode,
          debtScore: Math.min(100, f.cyclomaticComplexity * 1.5 + f.todoCount * 3),
          businessValue: 3, usageFrequency: 3,
        }));
      }
      if (!modules || modules.length === 0) return { ok: false, error: "no modules supplied" };

      const blendedRate = lgNum(params.blendedRate, 120); // $/hour
      const analysis = modules.map(m => {
        const loc = lgNum(m.linesOfCode, 0);
        const debt = Math.max(0, Math.min(100, lgNum(m.debtScore, 30)));
        const businessValue = Math.max(1, Math.min(5, lgNum(m.businessValue, 3)));
        const usage = Math.max(1, Math.min(5, lgNum(m.usageFrequency, 3)));

        // cost models (hours)
        const rewriteHours = (loc / 1000) * 55;
        const refactorHours = (loc / 1000) * 18 * (debt / 50);
        const retireHours = (loc / 1000) * 6;

        const rewriteCost = r2(rewriteHours * blendedRate);
        const refactorCost = r2(refactorHours * blendedRate);
        const retireCost = r2(retireHours * blendedRate);

        // annual carrying cost if nothing is done (debt tax)
        const annualMaintenance = m.annualMaintenanceCost != null
          ? lgNum(m.annualMaintenanceCost, 0)
          : r2((loc / 1000) * (debt / 100) * 20 * blendedRate);

        // recommendation logic
        let recommendation, reasoning;
        if (businessValue <= 2 && usage <= 2) {
          recommendation = "retire";
          reasoning = "Low business value and low usage — decommission rather than invest.";
        } else if (debt >= 60 && businessValue >= 4) {
          recommendation = "rewrite";
          reasoning = "High debt on a high-value module — a clean rewrite pays back fastest.";
        } else if (debt >= 35) {
          recommendation = "refactor";
          reasoning = "Moderate debt on a worth-keeping module — incremental refactor is cheapest path.";
        } else {
          recommendation = "retain";
          reasoning = "Debt is manageable — keep as-is and monitor.";
        }

        // payback period (years) for the chosen action vs doing nothing
        const actionCost = recommendation === "rewrite" ? rewriteCost
          : recommendation === "refactor" ? refactorCost
          : recommendation === "retire" ? retireCost : 0;
        // post-action maintenance is assumed reduced (rewrite 15%, refactor 50%, retire 0%)
        const postFactor = recommendation === "rewrite" ? 0.15 : recommendation === "refactor" ? 0.5 : recommendation === "retire" ? 0 : 1;
        const annualSaving = r2(annualMaintenance * (1 - postFactor));
        const paybackYears = annualSaving > 0 ? r2(actionCost / annualSaving) : null;
        const fiveYearNet = r2(annualSaving * 5 - actionCost);

        return {
          name: lgClean(m.name, 200),
          linesOfCode: loc, debtScore: r2(debt),
          businessValue, usageFrequency: usage,
          costs: { rewrite: rewriteCost, refactor: refactorCost, retire: retireCost },
          annualMaintenanceCost: r2(annualMaintenance),
          recommendation, reasoning,
          actionCost: r2(actionCost),
          annualSaving, paybackYears, fiveYearNetBenefit: fiveYearNet,
        };
      }).sort((a, b) => (b.fiveYearNetBenefit || 0) - (a.fiveYearNetBenefit || 0));

      const counts = { rewrite: 0, refactor: 0, retire: 0, retain: 0 };
      for (const a of analysis) counts[a.recommendation]++;
      return {
        ok: true, result: {
          modules: analysis,
          summary: {
            totalModules: analysis.length,
            recommendations: counts,
            totalActionCost: r2(analysis.reduce((s2, a) => s2 + a.actionCost, 0)),
            totalAnnualSaving: r2(analysis.reduce((s2, a) => s2 + a.annualSaving, 0)),
            totalFiveYearNet: r2(analysis.reduce((s2, a) => s2 + a.fiveYearNetBenefit, 0)),
            blendedRate,
          },
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * cloudReadiness — score a system for cloud migration / containerization
   * across the standard "12-factor"-style dimensions.
   * params = { components: [{ name, statefulFilesystem?, hardcodedConfig?, externalProcessDeps?,
   *            scalesHorizontally?, healthCheckEndpoint?, logsToStdout?, sessionAffinity?,
   *            secretsInCode? }] }  OR  { codebaseId }
   */
  registerLensAction("legacy", "cloudReadiness", (ctx, artifact, params = {}) => {
    try {
      const s = lgState();
      let components = Array.isArray(params.components) ? params.components
        : Array.isArray(artifact?.data?.components) ? artifact.data.components : null;
      let derived = false;
      if (!components && params.codebaseId && s) {
        const cb = (s.codebases.get(lgUid(ctx)) || []).find(c => c.id === params.codebaseId);
        if (!cb) return { ok: false, error: "codebase not found" };
        derived = true;
        components = cb.files.filter(f => !f.isTest).map(f => ({ name: f.path }));
      }
      if (!components || components.length === 0) return { ok: false, error: "no components supplied" };

      // each dimension: weight + boolean predicate (true = cloud-friendly)
      const DIMS = [
        { key: "statelessProcess", weight: 18, get: c => c.statefulFilesystem !== true },
        { key: "externalizedConfig", weight: 16, get: c => c.hardcodedConfig !== true },
        { key: "noSecretsInCode", weight: 16, get: c => c.secretsInCode !== true },
        { key: "horizontalScalability", weight: 14, get: c => c.scalesHorizontally === true },
        { key: "healthChecks", weight: 10, get: c => c.healthCheckEndpoint === true },
        { key: "logsToStdout", weight: 10, get: c => c.logsToStdout === true },
        { key: "noSessionAffinity", weight: 8, get: c => c.sessionAffinity !== true },
        { key: "noLocalProcessDeps", weight: 8, get: c => !(Array.isArray(c.externalProcessDeps) && c.externalProcessDeps.length > 0) },
      ];

      const assessed = components.map(c => {
        const dimResults = DIMS.map(d => {
          const pass = derived ? null : !!d.get(c);
          return { dimension: d.key, weight: d.weight, pass };
        });
        // when derived from a raw scan we can't infer runtime traits — flag as unknown
        const known = dimResults.filter(d => d.pass !== null);
        const score = known.length > 0
          ? r2(known.filter(d => d.pass).reduce((a, d) => a + d.weight, 0) / known.reduce((a, d) => a + d.weight, 0) * 100)
          : null;
        const blockers = dimResults.filter(d => d.pass === false).map(d => d.dimension);
        return {
          name: lgClean(c.name, 200),
          dimensions: dimResults,
          readinessScore: score,
          readinessLevel: score == null ? "unknown"
            : score >= 80 ? "lift-and-shift"
            : score >= 55 ? "minor-refactor"
            : score >= 30 ? "significant-refactor" : "re-architect",
          blockers,
          containerizable: score == null ? null : score >= 55,
        };
      }).sort((a, b) => (b.readinessScore ?? -1) - (a.readinessScore ?? -1));

      const scored = assessed.filter(a => a.readinessScore != null);
      return {
        ok: true, result: {
          components: assessed,
          derivedFromScan: derived,
          summary: {
            totalComponents: assessed.length,
            avgReadiness: scored.length > 0 ? r2(scored.reduce((a, c) => a + c.readinessScore, 0) / scored.length) : null,
            liftAndShiftReady: assessed.filter(a => a.readinessLevel === "lift-and-shift").length,
            needsReArchitecture: assessed.filter(a => a.readinessLevel === "re-architect").length,
            note: derived ? "Runtime traits cannot be inferred from source alone — supply a components array for a real score." : null,
          },
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * recordDebtSnapshot — persist a point-in-time debt measurement so trend
   * tracking has history. params = { codebaseId?, label?, totalDebt, moduleCount?, avgMaintainability?, criticalModules? }
   */
  registerLensAction("legacy", "recordDebtSnapshot", (ctx, _a, params = {}) => {
    try {
      const s = lgState(); if (!s) return { ok: false, error: "STATE unavailable" };
      if (params.totalDebt == null) return { ok: false, error: "totalDebt is required" };
      const snap = {
        id: lgId("snap"),
        codebaseId: params.codebaseId ? lgClean(params.codebaseId, 80) : null,
        label: lgClean(params.label, 80) || lgNow().slice(0, 10),
        totalDebt: r2(lgNum(params.totalDebt, 0)),
        moduleCount: Math.max(0, Math.round(lgNum(params.moduleCount, 0))),
        avgMaintainability: params.avgMaintainability != null ? r2(lgNum(params.avgMaintainability, 0)) : null,
        criticalModules: Math.max(0, Math.round(lgNum(params.criticalModules, 0))),
        recordedAt: lgNow(),
      };
      const arr = lgList(s.snapshots, lgUid(ctx));
      arr.push(snap);
      if (arr.length > 200) arr.splice(0, arr.length - 200);
      lgSave();
      return { ok: true, result: { snapshot: snap, totalSnapshots: arr.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * debtTrend — historical debt trend across recorded snapshots, with a
   * linear slope + projection. params = { codebaseId? }
   */
  registerLensAction("legacy", "debtTrend", (ctx, _a, params = {}) => {
    try {
      const s = lgState(); if (!s) return { ok: false, error: "STATE unavailable" };
      let snaps = (s.snapshots.get(lgUid(ctx)) || []).slice();
      if (params.codebaseId) snaps = snaps.filter(x => x.codebaseId === params.codebaseId);
      snaps.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
      if (snaps.length === 0) return { ok: true, result: { snapshots: [], message: "No debt snapshots recorded yet." } };

      const series = snaps.map((sn, i) => ({
        index: i, id: sn.id, label: sn.label,
        totalDebt: sn.totalDebt, moduleCount: sn.moduleCount,
        avgMaintainability: sn.avgMaintainability, criticalModules: sn.criticalModules,
        recordedAt: sn.recordedAt,
      }));

      // least-squares slope on totalDebt vs index
      let direction = "stable", slopePerSnapshot = 0, projectedNext = series[series.length - 1].totalDebt;
      if (series.length >= 2) {
        const n = series.length;
        const sx = series.reduce((a, p) => a + p.index, 0);
        const sy = series.reduce((a, p) => a + p.totalDebt, 0);
        const sxy = series.reduce((a, p) => a + p.index * p.totalDebt, 0);
        const sxx = series.reduce((a, p) => a + p.index * p.index, 0);
        const denom = n * sxx - sx * sx;
        slopePerSnapshot = denom !== 0 ? r2((n * sxy - sx * sy) / denom) : 0;
        const intercept = (sy - slopePerSnapshot * sx) / n;
        projectedNext = r2(slopePerSnapshot * n + intercept);
        direction = slopePerSnapshot > 0.5 ? "increasing" : slopePerSnapshot < -0.5 ? "decreasing" : "stable";
      }
      const first = series[0].totalDebt, last = series[series.length - 1].totalDebt;
      return {
        ok: true, result: {
          snapshots: series,
          trend: {
            direction,
            slopePerSnapshot,
            firstDebt: first, latestDebt: last,
            netChange: r2(last - first),
            pctChange: first > 0 ? r2((last - first) / first * 100) : null,
            projectedNextDebt: projectedNext,
          },
          summary: {
            snapshotCount: series.length,
            latestLabel: series[series.length - 1].label,
          },
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
