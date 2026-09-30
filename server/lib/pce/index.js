// server/lib/pce/index.js
//
// Procedural Coding Engine — public API.

export { buildCodeSpace, codeSpaceSummary } from "./code-space.js";
export { indexFileAst, getCachedAst, invalidateAstCache, parseAndIndexFile } from "./ast-cache.js";
export { applyTransformPlan, applyPrimitive, PRIMITIVES } from "./transform-primitives.js";
export { registerPattern, findPatternsForIntent, recordPatternOutcome, getPattern } from "./pattern-ir.js";
export { registerProvenanceSource, provenanceGate, isLicenseCompatible } from "./provenance.js";
export { compareCodeSimilarity, ipSimilarityGate, structuralFingerprint } from "./ip-similarity.js";
export { runVerificationPipeline } from "./verification-pipeline.js";
export { computeQualityScore, qualityFromVerification } from "./quality-score.js";
export { compileIntent, GENERATION_MODES } from "./intent-compiler.js";
export { seedConcordCorpus, CONCORD_CORPUS_PATTERNS } from "./concord-corpus.js";
export { executePceTask, pceOverview } from "./pce-engine.js";
export { runCodingPipeline } from "./coding-pipeline.js";
export { buildRepoBrain, impactAnalysis } from "./repo-brain.js";
export { recordPceMetric, pceMetricsSummary } from "./pce-metrics.js";
export { runPceBench, PCE_BENCH_CATEGORIES } from "./pce-bench.js";
export { runConcordBench, runBenchSuite, concordBenchHistory, CONCORD_BENCH_CASES, resolveConcordRoot } from "./concord-bench.js";
export { BENCH_SUITES, ALL_BENCH_CASE_COUNT, findBenchCase, listBenchSuites } from "./bench-registry.js";
export {
  getTopFailureSignatures,
  proposePatternFromFailure,
  proposePatternsFromFailures,
  evaluatePatternPromotion,
  evaluatePatternDemotion,
  runPatternLifecyclePass,
} from "./pattern-promotion.js";
export { runPceImprovementCycle, analyzeBenchmarkGaps } from "./pce-improvement-cycle.js";
export { runPceExcellenceCycle, runAllBenchSuites, excellenceRunHistory } from "./pce-excellence-runner.js";
export { runLearningPipeline, promotePatternWithRegression, recordLearningEvent } from "./learning-pipeline.js";
export {
  runRegressionGate,
  updateRegressionBaselines,
  listRegressionBaselines,
} from "./pattern-regression.js";
export { classifySolutionPath, deterministicCoverageReport } from "./deterministic-coverage.js";
export { seedProvenBenchPatterns, fillGapsFromProvenPatterns, PROVEN_BENCH_PATTERNS } from "./concord-bench-patterns.js";
export { buildConcordBenchReport } from "./concord-bench-report.js";
export { gateHonestyScan, gateDangerousSql } from "./verification-pipeline.js";
