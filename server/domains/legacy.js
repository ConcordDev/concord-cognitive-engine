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
  });

  /**
   * migrationReadiness
   * Assess migration readiness: dependency mapping, API surface analysis,
   * and data portability scoring.
   * artifact.data.system = { modules: [{ name, dependencies: [string], apis: [{ endpoint, method?, consumers?: number }], dataStores: [{ type, sizeGb?, portable?: bool }] }] }
   */
  registerLensAction("legacy", "migrationReadiness", (ctx, artifact, params) => {
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
  });

  /**
   * riskMap
   * Map legacy risks: component criticality, knowledge concentration (bus factor),
   * and failure frequency trending.
   * artifact.data.components = [{ name, criticality: 1-5, knowledgeHolders: [string], failures: [{ date, severity: 1-5 }], revenueImpact?: number }]
   */
  registerLensAction("legacy", "riskMap", (ctx, artifact, params) => {
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
  });
}
