// server/domains/repos.js
// Domain actions for repository/code management: code complexity
// analysis, commit pattern analysis, dependency tree auditing, plus
// real GitHub API lookups (commits, issues, language breakdown).
// Free at 60 req/hr; GITHUB_TOKEN env raises to 5000/hr.

import { guardAnonWrites } from "../lib/lens-authz.js";
import vm from "node:vm";
import { cachedFetchJson, fetchJsonWithTimeout } from "../lib/external-fetch.js";
import { analyzeSourceComplexity } from "../lib/code-ast-complexity.js";
import { githubTopicSearch, githubTrending, githubRepoMeta, githubGistsPublic, githubAdvisories } from "../lib/github-feed-sources.js";

const GITHUB_API_REPOS = "https://api.github.com";

// ── OSV.dev — free, keyless vulnerability feed for security-scan's
// Dependabot-style dependency alerts. Docs: https://osv.dev/docs/.
// No API key, no per-user auth — a plain public data feed (unlike the
// connector-fetch chokepoint, which is for user-authenticated 3rd-party
// accounts). Two-step lookup because OSV's batch endpoint intentionally
// returns only {id, modified} per hit (to keep the batch response small);
// full advisory text/severity needs a follow-up per-id GET.
const OSV_API_BASE = "https://api.osv.dev/v1";
const OSV_BATCH_TIMEOUT_MS = 10000;
const OSV_DETAIL_TTL_MS = 6 * 60 * 60 * 1000; // advisory records change rarely
const OSV_MAX_QUERIES = 200; // defensive cap — OSV allows up to 1000/batch
const OSV_MAX_DETAIL_FETCHES = 40; // cap per-id fan-out on a pathological package.json

/**
 * osvSeverityBucket — map an OSV vulnerability record onto Concord's
 * 4-bucket severity scale (critical/high/moderate/low). GitHub Security
 * Advisories — OSV's largest npm source — publish exactly this scale via
 * `database_specific.severity`. When a record has no explicit rating
 * (uncommon for npm/GHSA-sourced entries) it's labeled "moderate" rather
 * than inventing a number — the same convention `npm audit` uses for an
 * unrated advisory. The underlying finding is still real; only its
 * severity bucket is an honest best-effort default.
 */
function osvSeverityBucket(vuln) {
  const raw = vuln?.database_specific?.severity
    || vuln?.affected?.find((a) => a?.database_specific?.severity)?.database_specific?.severity;
  if (raw) {
    const lc = String(raw).toLowerCase();
    if (lc === "medium") return "moderate"; // some non-GHSA sources use CVSS "MEDIUM"
    if (["critical", "high", "moderate", "low"].includes(lc)) return lc;
  }
  return "moderate";
}

/** osvFixedVersion — earliest "fixed" SEMVER-range event for pkgName in a vuln record. */
function osvFixedVersion(vuln, pkgName) {
  for (const a of vuln?.affected || []) {
    if (String(a?.package?.name || "").toLowerCase() !== String(pkgName).toLowerCase()) continue;
    for (const range of a?.ranges || []) {
      if (range?.type !== "SEMVER" && range?.type !== "ECOSYSTEM") continue;
      const fixed = (range.events || []).find((e) => e?.fixed)?.fixed;
      if (fixed) return fixed;
    }
  }
  return null;
}

/**
 * osvScanDependencies — real OSV.dev lookup for an npm dependency map
 * (`{ name: declaredVersionRange }`, e.g. parsed from package.json).
 * Returns `{ dependabot, source, unreachable, error?, truncated? }`.
 * Honest on failure: network/timeout errors surface `unreachable: true`
 * with an empty `dependabot` list — never a fabricated finding. Packages
 * OSV has no record for are legitimately clean; they simply produce no
 * entry, which is not an error.
 */
async function osvScanDependencies(depVersions) {
  const entries = Object.entries(depVersions || {})
    .map(([name, ver]) => ({ name, version: String(ver).replace(/^[^0-9]*/, "") }))
    .filter((d) => d.name && d.version)
    .slice(0, OSV_MAX_QUERIES);
  if (entries.length === 0) return { dependabot: [], source: "osv.dev", unreachable: false };

  let batchResults;
  try {
    const body = {
      queries: entries.map((d) => ({ package: { name: d.name, ecosystem: "npm" }, version: d.version })),
    };
    // Not routed through cachedFetchJson: the batch endpoint's URL is
    // constant while the POST body (the dependency set) varies per repo,
    // and cachedFetchJson keys its TTL cache by URL alone — caching here
    // would serve one repo's scan results to a different repo's request.
    const data = await fetchJsonWithTimeout(
      `${OSV_API_BASE}/querybatch`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      OSV_BATCH_TIMEOUT_MS,
    );
    batchResults = data?.results || [];
  } catch (e) {
    return { dependabot: [], source: "osv.dev", unreachable: true, error: e instanceof Error ? e.message : String(e) };
  }

  const hitsByPkg = entries.map((d, i) => ({ ...d, ids: (batchResults[i]?.vulns || []).map((v) => v.id).filter(Boolean) }));
  const allIds = [...new Set(hitsByPkg.flatMap((h) => h.ids))];
  const idsToFetch = allIds.slice(0, OSV_MAX_DETAIL_FETCHES);
  const truncated = idsToFetch.length < allIds.length;

  // Per-id GET is a stable URL per advisory, so this leg fits
  // cachedFetchJson's URL-keyed TTL cache correctly.
  const detailById = new Map();
  await Promise.all(idsToFetch.map(async (id) => {
    try {
      const vuln = await cachedFetchJson(`${OSV_API_BASE}/vulns/${encodeURIComponent(id)}`, { ttlMs: OSV_DETAIL_TTL_MS });
      detailById.set(id, vuln);
    } catch (_e) { /* one advisory failing to resolve doesn't fail the whole scan */ }
  }));

  const dependabot = [];
  for (const h of hitsByPkg) {
    for (const id of h.ids) {
      const vuln = detailById.get(id);
      if (!vuln) continue; // truncated or failed detail fetch — omit, never fabricate
      dependabot.push({
        kind: "dependency",
        package: h.name,
        version: h.version,
        severity: osvSeverityBucket(vuln),
        summary: vuln.summary || vuln.id,
        fixedIn: osvFixedVersion(vuln, h.name),
        osvId: vuln.id,
      });
    }
  }
  return { dependabot, source: "osv.dev", unreachable: false, truncated };
}

export default function registerReposActions(registerLensAction) {
  registerLensAction = guardAnonWrites(registerLensAction); // anonymous callers can read, not write (lib/lens-authz.js)
  /**
   * codeComplexity
   * Compute code complexity metrics — cyclomatic complexity, cognitive complexity,
   * dependency depth, and coupling/cohesion ratios.
   *
   * Two input shapes, checked in priority order:
   *   1. artifact.data.sourceFiles = [{ path, content }] — REAL per-file
   *      source text. Each file is AST-walked by
   *      `server/lib/code-ast-complexity.js` (the same `typescript` compiler
   *      package server/lib/ts-language-service.js already uses for the code
   *      lens's LanguageService) into REAL per-function boundaries with real
   *      branch/loop/condition/nesting counts — not a regex decision-point
   *      count over the whole file treated as one function. This is the path
   *      the repos lens's Analysis tab calls
   *      (concord-frontend/components/repos/ConcordRepoWorkspace.tsx).
   *   2. artifact.data.modules = [{ name, functions: [{ name, branches, nesting, lines, loops, conditions, dependencies?: [string] }], imports?: [string], exports?: [string] }]
   *      — legacy pre-computed-metrics shape, kept for any caller that
   *      already did its own counting (and for the exact-value contract
   *      tests that pin this macro's arithmetic in isolation). This macro
   *      only ever aggregates the counts it's given into cyclomatic/cognitive
   *      complexity + risk — shape 1 just makes the default caller feed it
   *      honest, AST-derived counts instead of regex-derived ones.
   */
  registerLensAction("repos", "codeComplexity", (ctx, artifact, params = {}) => {
  try {
    // Dual-shape input (Database contract): the Analysis tab sends
    // its payload as lens params; the desk path sends a DTU artifact.
    // Reading only the artifact is what made this engine report "No
    // files to analyze" on a repo full of files (Review F6).
    const sourceFiles = artifact.data?.sourceFiles || params.sourceFiles || params.input?.sourceFiles;
    let modules;
    if (Array.isArray(sourceFiles) && sourceFiles.length > 0) {
      const analyzed = [];
      for (const f of sourceFiles) {
        const m = analyzeSourceComplexity(f?.path || f?.name || "file", String(f?.content ?? ""));
        if (!m) {
          // Honest failure — never silently fall back to a fabricated/regex
          // count when the caller explicitly asked for real-source analysis.
          return {
            ok: false,
            error: "ast_engine_unavailable",
            message: "The TypeScript parser package is not loadable on this server, so complexity can't be honestly computed from source text.",
          };
        }
        analyzed.push(m);
      }
      modules = analyzed;
    } else {
      modules = artifact.data?.modules || params.modules || params.input?.modules || [];
    }
    if (modules.length === 0) {
      return { ok: true, result: { message: "No modules to analyze." } };
    }

    const r = (v) => Math.round(v * 10000) / 10000;

    const moduleAnalyses = modules.map(mod => {
      const functions = mod.functions || [];

      const funcMetrics = functions.map(fn => {
        const branches = parseInt(fn.branches) || 0;
        const nesting = parseInt(fn.nesting) || 0;
        const lines = parseInt(fn.lines) || 0;
        const loops = parseInt(fn.loops) || 0;
        const conditions = parseInt(fn.conditions) || 0;

        // Cyclomatic complexity: 1 + decision points
        const cyclomaticComplexity = 1 + branches + loops + conditions;

        // Cognitive complexity: accounts for nesting depth
        // Each branch/loop/condition adds (1 + nesting_level) to complexity
        const cognitiveComplexity = (branches + loops + conditions) * (1 + nesting * 0.5);

        // Halstead-inspired size metric
        const operandEstimate = lines * 3; // rough estimate
        const operatorEstimate = branches + loops + conditions + Math.floor(lines * 0.5);
        const halsteadVolume = (operandEstimate + operatorEstimate) > 0
          ? (operandEstimate + operatorEstimate) * Math.log2(Math.max(2, operandEstimate + operatorEstimate))
          : 0;

        // Maintainability index (simplified Microsoft formula)
        const avgVolume = halsteadVolume > 0 ? halsteadVolume : 1;
        const maintainabilityIndex = Math.max(0, Math.min(100,
          171 - 5.2 * Math.log(avgVolume) - 0.23 * cyclomaticComplexity - 16.2 * Math.log(Math.max(1, lines))
        ));

        // Risk classification
        let risk;
        if (cyclomaticComplexity > 20) risk = "critical";
        else if (cyclomaticComplexity > 10) risk = "high";
        else if (cyclomaticComplexity > 5) risk = "moderate";
        else risk = "low";

        return {
          name: fn.name,
          lines,
          cyclomaticComplexity,
          cognitiveComplexity: r(cognitiveComplexity),
          maintainabilityIndex: r(maintainabilityIndex),
          risk,
        };
      });

      // Module-level metrics
      const totalFunctions = funcMetrics.length;
      const avgCyclomatic = totalFunctions > 0
        ? funcMetrics.reduce((s, f) => s + f.cyclomaticComplexity, 0) / totalFunctions
        : 0;
      const maxCyclomatic = totalFunctions > 0
        ? Math.max(...funcMetrics.map(f => f.cyclomaticComplexity))
        : 0;
      const totalLines = funcMetrics.reduce((s, f) => s + f.lines, 0);

      // Coupling: number of external dependencies (imports)
      const imports = mod.imports || [];
      const afferentCoupling = imports.length; // incoming dependencies

      // Exports as a proxy for efferent coupling
      const exports = mod.exports || [];
      const efferentCoupling = exports.length;

      // Instability: Ce / (Ca + Ce) — how susceptible to change
      const instability = (afferentCoupling + efferentCoupling) > 0
        ? efferentCoupling / (afferentCoupling + efferentCoupling)
        : 0;

      // Cohesion approximation: ratio of internal function dependencies
      // to total possible internal connections
      const internalDeps = functions.reduce((s, fn) => {
        const deps = fn.dependencies || [];
        const internalNames = new Set(functions.map(f => f.name));
        return s + deps.filter(d => internalNames.has(d)).length;
      }, 0);
      const maxInternalDeps = totalFunctions * (totalFunctions - 1);
      const cohesion = maxInternalDeps > 0 ? internalDeps / maxInternalDeps : 1;

      return {
        name: mod.name,
        totalFunctions,
        totalLines,
        avgCyclomaticComplexity: r(avgCyclomatic),
        maxCyclomaticComplexity: maxCyclomatic,
        coupling: {
          afferent: afferentCoupling,
          efferent: efferentCoupling,
          instability: r(instability),
        },
        cohesion: r(cohesion),
        functions: funcMetrics.sort((a, b) => b.cyclomaticComplexity - a.cyclomaticComplexity),
      };
    });

    // --- Overall project metrics ---
    const totalModules = moduleAnalyses.length;
    const allFunctions = moduleAnalyses.flatMap(m => m.functions);
    const overallAvgComplexity = allFunctions.length > 0
      ? allFunctions.reduce((s, f) => s + f.cyclomaticComplexity, 0) / allFunctions.length
      : 0;

    // Hotspots: functions with highest complexity
    const hotspots = allFunctions
      .map(f => ({ ...f, module: moduleAnalyses.find(m => m.functions.includes(f))?.name }))
      .sort((a, b) => b.cyclomaticComplexity - a.cyclomaticComplexity)
      .slice(0, 10);

    // Risk distribution
    const riskDist = { critical: 0, high: 0, moderate: 0, low: 0 };
    for (const f of allFunctions) riskDist[f.risk]++;

    // Dependency depth (longest import chain)
    const depGraph = {};
    for (const mod of modules) {
      depGraph[mod.name] = mod.imports || [];
    }
    function depDepth(name, visited = new Set()) {
      if (visited.has(name)) return 0;
      visited.add(name);
      const deps = depGraph[name] || [];
      if (deps.length === 0) return 0;
      return 1 + Math.max(...deps.map(d => depDepth(d, new Set(visited))), 0);
    }
    const maxDepDepth = Math.max(...modules.map(m => depDepth(m.name)), 0);

    return {
      ok: true,
      result: {
        totalModules,
        totalFunctions: allFunctions.length,
        totalLines: moduleAnalyses.reduce((s, m) => s + m.totalLines, 0),
        overallAvgComplexity: r(overallAvgComplexity),
        maxDependencyDepth: maxDepDepth,
        riskDistribution: riskDist,
        hotspots,
        modules: moduleAnalyses.sort((a, b) => b.avgCyclomaticComplexity - a.avgCyclomaticComplexity),
        healthScore: r(Math.max(0, 100 - overallAvgComplexity * 5 - (riskDist.critical * 10) - (riskDist.high * 3))),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * commitAnalysis
   * Analyze commit patterns — frequency, size distribution, bus factor,
   * and hotspot detection.
   * artifact.data.commits = [{ hash, author, date, files: [string], additions?, deletions?, message? }]
   */
  registerLensAction("repos", "commitAnalysis", (ctx, artifact, params = {}) => {
  try {
    const commits = artifact.data?.commits || params.commits || params.input?.commits || [];
    if (commits.length === 0) {
      return { ok: true, result: { message: "No commits to analyze." } };
    }

    const r = (v) => Math.round(v * 10000) / 10000;

    // Sort chronologically
    const sorted = [...commits]
      .map(c => ({ ...c, ts: new Date(c.date).getTime() }))
      .filter(c => !isNaN(c.ts))
      .sort((a, b) => a.ts - b.ts);

    // --- Author contribution analysis ---
    const authorStats = {};
    for (const commit of sorted) {
      const author = commit.author || "unknown";
      if (!authorStats[author]) {
        authorStats[author] = { commits: 0, additions: 0, deletions: 0, files: new Set(), firstCommit: commit.ts, lastCommit: commit.ts };
      }
      authorStats[author].commits++;
      authorStats[author].additions += parseInt(commit.additions) || 0;
      authorStats[author].deletions += parseInt(commit.deletions) || 0;
      for (const f of (commit.files || [])) authorStats[author].files.add(f);
      authorStats[author].lastCommit = Math.max(authorStats[author].lastCommit, commit.ts);
    }

    const authors = Object.entries(authorStats)
      .map(([name, stats]) => ({
        name,
        commits: stats.commits,
        additions: stats.additions,
        deletions: stats.deletions,
        filesChanged: stats.files.size,
        commitShare: r(stats.commits / sorted.length),
        activeDays: Math.ceil((stats.lastCommit - stats.firstCommit) / 86400000) || 1,
      }))
      .sort((a, b) => b.commits - a.commits);

    // --- Bus factor computation ---
    // Minimum number of authors who contribute >= 50% of commits
    const totalCommits = sorted.length;
    let cumulativeShare = 0;
    let busFactor = 0;
    for (const author of authors) {
      cumulativeShare += author.commitShare;
      busFactor++;
      if (cumulativeShare >= 0.5) break;
    }

    // --- Commit frequency analysis ---
    const timespan = sorted.length > 1 ? sorted[sorted.length - 1].ts - sorted[0].ts : 0;
    const daySpan = Math.max(1, timespan / 86400000);
    const commitsPerDay = sorted.length / daySpan;

    // Day-of-week distribution
    const dowCounts = new Array(7).fill(0);
    const dowNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (const c of sorted) {
      dowCounts[new Date(c.ts).getDay()]++;
    }

    // Hour-of-day distribution
    const hourCounts = new Array(24).fill(0);
    for (const c of sorted) {
      hourCounts[new Date(c.ts).getHours()]++;
    }

    // --- Commit size distribution ---
    const sizes = sorted.map(c => (parseInt(c.additions) || 0) + (parseInt(c.deletions) || 0));
    const sortedSizes = [...sizes].sort((a, b) => a - b);
    const medianSize = sortedSizes[Math.floor(sortedSizes.length / 2)];
    const avgSize = sizes.reduce((s, v) => s + v, 0) / sizes.length;
    const largeCommits = sizes.filter(s => s > avgSize * 3).length;

    // --- File hotspot detection ---
    const fileChangeCounts = {};
    const fileAuthorCounts = {};
    for (const commit of sorted) {
      for (const file of (commit.files || [])) {
        fileChangeCounts[file] = (fileChangeCounts[file] || 0) + 1;
        if (!fileAuthorCounts[file]) fileAuthorCounts[file] = new Set();
        fileAuthorCounts[file].add(commit.author || "unknown");
      }
    }

    const hotspots = Object.entries(fileChangeCounts)
      .map(([file, changes]) => ({
        file,
        changes,
        authors: fileAuthorCounts[file]?.size || 0,
        changeRate: r(changes / daySpan),
        riskScore: r(changes * (1 / Math.max(1, fileAuthorCounts[file]?.size || 1))),
      }))
      .sort((a, b) => b.changes - a.changes)
      .slice(0, 15);

    // --- Commit message patterns ---
    const prefixCounts = {};
    for (const c of sorted) {
      const msg = (c.message || "").trim();
      const prefix = msg.match(/^(\w+)[\s(:]/)?.[1]?.toLowerCase() || "other";
      prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
    }
    const commitTypes = Object.entries(prefixCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([type, count]) => ({ type, count, percentage: r(count / totalCommits * 100) }));

    return {
      ok: true,
      result: {
        totalCommits,
        dateRange: { from: sorted[0]?.date, to: sorted[sorted.length - 1]?.date },
        frequency: {
          commitsPerDay: r(commitsPerDay),
          commitsPerWeek: r(commitsPerDay * 7),
          dayOfWeek: Object.fromEntries(dowNames.map((name, i) => [name, dowCounts[i]])),
          peakDay: dowNames[dowCounts.indexOf(Math.max(...dowCounts))],
          peakHour: hourCounts.indexOf(Math.max(...hourCounts)),
        },
        sizeDistribution: {
          avg: Math.round(avgSize),
          median: medianSize,
          max: sortedSizes[sortedSizes.length - 1],
          largeCommits,
          largeCommitRatio: r(largeCommits / totalCommits),
        },
        authors,
        busFactor,
        busFactorRisk: busFactor <= 1 ? "critical" : busFactor <= 2 ? "high" : busFactor <= 3 ? "moderate" : "low",
        hotspots,
        commitTypes,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * dependencyAudit
   * Audit dependency tree — depth analysis, duplicate detection, vulnerability
   * surface area, and update freshness scoring.
   * artifact.data.dependencies = [{ name, version, latestVersion?, lastUpdated?, depth?, children?: [string], vulnerabilities?: number, license?, size?: number }]
   *
   * Live vulnerability check (Review 2 re-pass, checkpoint 3): the
   * arithmetic below counts vulnerabilities from the caller-supplied
   * per-dep `vulnerabilities` field — which the Analysis tab never
   * supplies, so the tab printed "0 VULNERABLE" while the Security
   * tab's OSV scan found real alerts on the same manifest (F6 in new
   * form: two surfaces disagreeing on one repo). When the caller
   * passes `liveVulnCheck: true` AND supplied no vulnerability data
   * of its own, the dispatcher below first enriches the deps from
   * the SAME osvScanDependencies helper the security scan uses —
   * agreement by construction — and the result says which source its
   * counts came from. If OSV is unreachable the counts come back
   * null (unknown), never a fabricated 0. Callers that supply their
   * own counts (the pinned contract tests) take the synchronous path
   * unchanged and never trigger a network call.
   */
  function rpAuditCompute(dependencies, params, vulnMeta) {
    const r = (v) => Math.round(v * 10000) / 10000;
    const now = params.referenceTime ? new Date(params.referenceTime).getTime() : Date.now();

    // --- Depth analysis ---
    const maxDepth = Math.max(...dependencies.map(d => parseInt(d.depth) || 0), 0);
    const depthDistribution = {};
    for (const dep of dependencies) {
      const depth = parseInt(dep.depth) || 0;
      depthDistribution[depth] = (depthDistribution[depth] || 0) + 1;
    }

    // --- Duplicate detection ---
    const nameVersionMap = {};
    const nameOnlyMap = {};
    for (const dep of dependencies) {
      const key = `${dep.name}@${dep.version}`;
      nameVersionMap[key] = (nameVersionMap[key] || 0) + 1;
      nameOnlyMap[dep.name] = nameOnlyMap[dep.name] || [];
      if (!nameOnlyMap[dep.name].includes(dep.version)) {
        nameOnlyMap[dep.name].push(dep.version);
      }
    }

    const duplicates = Object.entries(nameOnlyMap)
      .filter(([, versions]) => versions.length > 1)
      .map(([name, versions]) => ({ name, versions, versionCount: versions.length }))
      .sort((a, b) => b.versionCount - a.versionCount);

    const exactDuplicates = Object.entries(nameVersionMap)
      .filter(([, count]) => count > 1)
      .map(([nameVersion, count]) => ({ nameVersion, instances: count }));

    // --- Vulnerability surface area ---
    const vulnDeps = dependencies.filter(d => (parseInt(d.vulnerabilities) || 0) > 0);
    const totalVulnerabilities = vulnDeps.reduce((s, d) => s + (parseInt(d.vulnerabilities) || 0), 0);
    const vulnSurfaceArea = dependencies.length > 0 ? vulnDeps.length / dependencies.length : 0;

    // Risk score per vulnerable dep (vulns * depth weight)
    const vulnDetails = vulnDeps.map(d => ({
      name: d.name,
      version: d.version,
      vulnerabilities: parseInt(d.vulnerabilities),
      advisories: Array.isArray(d.advisories) ? d.advisories : [],
      depth: parseInt(d.depth) || 0,
      riskScore: (parseInt(d.vulnerabilities) || 0) * (1 / (1 + (parseInt(d.depth) || 0))),
    })).sort((a, b) => b.riskScore - a.riskScore);

    // --- Update freshness scoring ---
    function parseVersion(v) {
      const parts = (v || "0.0.0").replace(/^[^0-9]*/, "").split(".").map(p => parseInt(p) || 0);
      return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
    }

    const freshnessScores = dependencies.map(dep => {
      const current = parseVersion(dep.version);
      const latest = parseVersion(dep.latestVersion);
      let freshness = 1;

      if (dep.latestVersion) {
        const majorDiff = latest.major - current.major;
        const minorDiff = latest.minor - current.minor;
        if (majorDiff > 0) freshness = Math.max(0, 1 - majorDiff * 0.3);
        else if (minorDiff > 0) freshness = Math.max(0.3, 1 - minorDiff * 0.1);
        else if (latest.patch > current.patch) freshness = Math.max(0.7, 1 - (latest.patch - current.patch) * 0.05);
      }

      // Time-based freshness decay
      if (dep.lastUpdated) {
        const updateMs = new Date(dep.lastUpdated).getTime();
        if (!isNaN(updateMs)) {
          const ageDays = (now - updateMs) / 86400000;
          const timeFreshness = Math.exp(-ageDays / 365); // half-life ~1 year
          freshness = freshness * 0.6 + timeFreshness * 0.4;
        }
      }

      let updateUrgency;
      if (freshness < 0.3) updateUrgency = "critical";
      else if (freshness < 0.5) updateUrgency = "high";
      else if (freshness < 0.8) updateUrgency = "moderate";
      else updateUrgency = "current";

      return {
        name: dep.name,
        currentVersion: dep.version,
        latestVersion: dep.latestVersion || "unknown",
        freshness: r(freshness),
        updateUrgency,
      };
    }).sort((a, b) => a.freshness - b.freshness);

    const avgFreshness = freshnessScores.reduce((s, f) => s + f.freshness, 0) / freshnessScores.length;

    // --- License analysis ---
    const licenseCounts = {};
    for (const dep of dependencies) {
      const license = dep.license || "unknown";
      licenseCounts[license] = (licenseCounts[license] || 0) + 1;
    }
    const riskyLicenses = new Set(["GPL-2.0", "GPL-3.0", "AGPL-3.0", "SSPL-1.0", "EUPL-1.2"]);
    const licenseRisks = Object.entries(licenseCounts)
      .filter(([license]) => riskyLicenses.has(license))
      .map(([license, count]) => ({ license, count, risk: "copyleft" }));

    // --- Size analysis ---
    const sizes = dependencies.map(d => parseFloat(d.size) || 0).filter(s => s > 0);
    const totalSize = sizes.reduce((s, v) => s + v, 0);
    const largestDeps = dependencies
      .filter(d => d.size)
      .sort((a, b) => (parseFloat(b.size) || 0) - (parseFloat(a.size) || 0))
      .slice(0, 5)
      .map(d => ({ name: d.name, size: parseFloat(d.size) }));

    // --- Overall health score ---
    const healthPenalty = totalVulnerabilities * 5
      + duplicates.length * 2
      + (1 - avgFreshness) * 20
      + (maxDepth > 10 ? 10 : 0)
      + licenseRisks.length * 3;
    const healthScore = Math.max(0, 100 - healthPenalty);

    return {
      ok: true,
      result: {
        totalDependencies: dependencies.length,
        depth: {
          max: maxDepth,
          distribution: depthDistribution,
          avgDepth: r(dependencies.reduce((s, d) => s + (parseInt(d.depth) || 0), 0) / dependencies.length),
        },
        duplicates: {
          versionConflicts: duplicates.length,
          exactDuplicates: exactDuplicates.length,
          details: duplicates.slice(0, 10),
        },
        vulnerabilities: {
          // When the live OSV check was requested but unreachable,
          // the counts are UNKNOWN (null) — never a printed 0 the
          // Security tab would contradict.
          total: vulnMeta.unreachable ? null : totalVulnerabilities,
          affectedDeps: vulnMeta.unreachable ? null : vulnDeps.length,
          surfaceArea: r(vulnSurfaceArea),
          source: vulnMeta.source,
          checked: vulnMeta.checked,
          ...(vulnMeta.unreachable ? { unreachable: true } : {}),
          details: vulnDetails.slice(0, 10),
        },
        dependencyList: dependencies.map((d) => ({
          name: d.name,
          version: d.version,
          vulnerabilities: vulnMeta.unreachable ? null : (parseInt(d.vulnerabilities) || 0),
          advisories: Array.isArray(d.advisories) ? d.advisories : [],
        })),
        freshness: {
          avgScore: r(avgFreshness),
          criticalUpdates: freshnessScores.filter(f => f.updateUrgency === "critical").length,
          stalePackages: freshnessScores.filter(f => f.freshness < 0.5).length,
          details: freshnessScores.slice(0, 15),
        },
        licenses: {
          distribution: licenseCounts,
          risks: licenseRisks,
        },
        size: sizes.length > 0 ? { total: r(totalSize), largest: largestDeps } : null,
        healthScore: r(healthScore),
        healthGrade: healthScore >= 90 ? "A" : healthScore >= 75 ? "B" : healthScore >= 60 ? "C" : healthScore >= 40 ? "D" : "F",
      },
    };
  }

  registerLensAction("repos", "dependencyAudit", (ctx, artifact, params = {}) => {
    const dependencies = artifact.data?.dependencies || params.dependencies || params.input?.dependencies || [];
    if (dependencies.length === 0) {
      return { ok: true, result: { message: "No dependencies to audit." } };
    }
    const callerSuppliedVulns = dependencies.some((d) => d && d.vulnerabilities != null);
    if (params.liveVulnCheck === true && !callerSuppliedVulns) {
      // Async path ONLY for the explicit live check; every other
      // caller keeps the historical synchronous return.
      return (async () => {
        try {
          const depVersions = {};
          for (const d of dependencies) if (d?.name) depVersions[d.name] = String(d.version || "");
          const osv = await osvScanDependencies(depVersions);
          if (osv.unreachable) {
            return rpAuditCompute(dependencies, params, { source: "osv.dev", checked: false, unreachable: true });
          }
          const byPkg = new Map();
          for (const a of osv.dependabot) {
            const e = byPkg.get(a.package) || { count: 0, ids: [] };
            e.count++; e.ids.push(a.osvId);
            byPkg.set(a.package, e);
          }
          const enriched = dependencies.map((d) => {
            const e = byPkg.get(d?.name);
            return { ...d, vulnerabilities: e ? e.count : 0, advisories: e ? e.ids : [] };
          });
          return rpAuditCompute(enriched, params, { source: "osv.dev", checked: true });
        } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
      })();
    }
    try {
      return rpAuditCompute(dependencies, params, { source: "caller-supplied", checked: false });
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  function ghHeaders() {
    const token = process.env.GITHUB_TOKEN;
    return token
      ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
      : { Accept: "application/vnd.github+json" };
  }

  /**
   * github-topic-search — top repositories for a topic, served from the shared
   * feed-cache (one upstream request per topic per 6h for ALL visitors). The topic
   * must be one of the allowlisted literals the lens components offer; anything
   * else is rejected without a fetch. Sort is fixed to stars desc.
   *
   * params: { topic, perPage?: 1-25 }
   */
  registerLensAction("repos", "github-topic-search", async (_ctx, _artifact, params = {}) => {
    try {
      const r = await githubTopicSearch({ topic: params.topic, perPage: params.perPage });
      if (r.ok) {
        return { ok: true, result: { topic: String(params.topic).trim().toLowerCase(), items: r.items, count: r.items.length, stale: r.stale, fetchedAt: r.fetchedAt, source: "github-api" } };
      }
      if (r.status === "invalid_topic") return { ok: false, status: 400, error: "topic not allowed", reason: r.reason };
      return { ok: false, status: "unavailable", error: "github unavailable", reason: r.reason, lastOkAt: r.lastOkAt ?? null };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Shared reply shape for the feed-cache GitHub read actions (phase 8b).
  function ghReply(r, extra = {}) {
    if (r.ok) return { ok: true, result: { ...extra, items: r.items, count: r.items.length, stale: r.stale, fetchedAt: r.fetchedAt, source: "github-api" } };
    if (r.status === "invalid_params") return { ok: false, status: 400, error: "invalid parameters", reason: r.reason };
    return { ok: false, status: "unavailable", error: "github unavailable", reason: r.reason, lastOkAt: r.lastOkAt ?? null };
  }
  const ghAction = (name, fn) => registerLensAction("repos", name, async (_ctx, _artifact, params = {}) => {
    try { return await fn(params || {}); } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  });

  /** github-trending — repos created in the last sinceDays (1|7|30), optional allowlisted lang. */
  ghAction("github-trending", async (p) => ghReply(await githubTrending({ sinceDays: p.sinceDays, lang: p.lang }), { sinceDays: Number(p.sinceDays), lang: p.lang || "" }));
  /** github-repo-meta — releases | forks of one repo (owner/repo charset-validated). */
  ghAction("github-repo-meta", async (p) => ghReply(await githubRepoMeta({ owner: p.owner, repo: p.repo, kind: p.kind }), { owner: p.owner, repo: p.repo, kind: p.kind }));
  /** github-gists-public — newest public gists. */
  ghAction("github-gists-public", async () => ghReply(await githubGistsPublic()));
  /** github-advisories — global security advisories, optional allowlisted ecosystem/severity. */
  ghAction("github-advisories", async (p) => ghReply(await githubAdvisories({ ecosystem: p.ecosystem, severity: p.severity }), { ecosystem: p.ecosystem || "", severity: p.severity || "" }));

  /**
   * github-commits-recent — Real recent commits for a repo. Author,
   * commit message, SHA, date, additions/deletions.
   *
   * params: { owner, repo, since?: ISO datetime, until?: ISO, limit?: 1-100 }
   */
  registerLensAction("repos", "github-commits-recent", async (_ctx, _artifact, params = {}) => {
    const owner = String(params.owner || "").trim();
    const repo = String(params.repo || "").trim();
    if (!owner || !repo) return { ok: false, error: "owner + repo required" };
    const perPage = Math.max(1, Math.min(100, Number(params.limit) || 30));
    const qs = new URLSearchParams({ per_page: String(perPage) });
    if (params.since) qs.set("since", String(params.since));
    if (params.until) qs.set("until", String(params.until));
    try {
      const r = await fetch(`${GITHUB_API_REPOS}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?${qs.toString()}`, { headers: ghHeaders() });
      if (r.status === 404) return { ok: false, error: `repo not found: ${owner}/${repo}` };
      if (r.status === 403) return { ok: false, error: "github rate limit — set GITHUB_TOKEN env" };
      if (!r.ok) throw new Error(`github ${r.status}`);
      const data = await r.json();
      const commits = (Array.isArray(data) ? data : []).map((c) => ({
        sha: c.sha,
        message: c.commit?.message,
        author: c.commit?.author?.name,
        authorEmail: c.commit?.author?.email,
        date: c.commit?.author?.date,
        committer: c.commit?.committer?.name,
        url: c.html_url,
        loginAuthor: c.author?.login,
        loginCommitter: c.committer?.login,
      }));
      return {
        ok: true,
        result: {
          owner, repo, commits, count: commits.length,
          authenticated: !!process.env.GITHUB_TOKEN,
          source: "github-api",
        },
      };
    } catch (e) {
      return { ok: false, error: `github unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * github-issues — Real list of open/closed issues for a repo.
   * params: { owner, repo, state?: "open"|"closed"|"all", labels?: comma-string, limit?: 1-100 }
   */
  registerLensAction("repos", "github-issues", async (_ctx, _artifact, params = {}) => {
    const owner = String(params.owner || "").trim();
    const repo = String(params.repo || "").trim();
    if (!owner || !repo) return { ok: false, error: "owner + repo required" };
    const state = ["open", "closed", "all"].includes(params.state) ? params.state : "open";
    const perPage = Math.max(1, Math.min(100, Number(params.limit) || 30));
    const qs = new URLSearchParams({ state, per_page: String(perPage) });
    if (params.labels) qs.set("labels", String(params.labels));
    try {
      const r = await fetch(`${GITHUB_API_REPOS}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${qs.toString()}`, { headers: ghHeaders() });
      if (r.status === 404) return { ok: false, error: `repo not found: ${owner}/${repo}` };
      if (r.status === 403) return { ok: false, error: "github rate limit — set GITHUB_TOKEN env" };
      if (!r.ok) throw new Error(`github ${r.status}`);
      const data = await r.json();
      const issues = (Array.isArray(data) ? data : []).map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        author: i.user?.login,
        labels: (i.labels || []).map((l) => l.name),
        comments: i.comments,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        closedAt: i.closed_at,
        url: i.html_url,
        isPullRequest: !!i.pull_request,
      }));
      return {
        ok: true,
        result: {
          owner, repo, state,
          issues, count: issues.length,
          openIssues: issues.filter((i) => i.state === "open").length,
          source: "github-api",
        },
      };
    } catch (e) {
      return { ok: false, error: `github unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Concord-repo substrate — GitHub-shape experience over DTUs ─────
  // A per-user virtual code-host: repos with a file tree, branches/tags,
  // a commit history graph, full issue lifecycle, PR diff/review/merge,
  // CI workflow runs with logs, Dependabot-style security alerts, and
  // contributor/activity insights. Persisted in globalThis._concordSTATE.

  function rpState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.reposLens) STATE.reposLens = {};
    const s = STATE.reposLens;
    if (!(s.repos instanceof Map)) s.repos = new Map(); // userId -> [repo]
    return s;
  }
  function rpSave() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const rpId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const rpNow = () => new Date().toISOString();
  const rpUid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const rpClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const rpNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const rpList = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const rpSha = () => Math.random().toString(16).slice(2, 9);
  // A trailing newline is not an extra line. "a\n" is one line.
  function rpTextLines(text) {
    const parts = String(text ?? "").split("\n");
    if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    return parts.length;
  }
  // File size is UTF-8 bytes. String.length counts UTF-16 code units, so a
  // non-ASCII name or description would under-count the README.
  function rpByteSize(text) {
    return Buffer.byteLength(String(text ?? ""), "utf8");
  }

  function rpFindRepo(s, uid, repoId) {
    return (s.repos.get(uid) || []).find((r) => r.id === repoId) || null;
  }
  // Seed a fresh repo with a tiny but real file tree + main branch.
  // Line counts and sizes are measured from those file bytes.
  function rpSeedRepo(name, description, language) {
    const ts = rpNow();
    const title = name || "untitled-repo";
    const blurb = description || "A Concord repository.";
    const files = [
      { path: "README.md", type: "file", content: `# ${title}\n\n${blurb}\n` },
      { path: "package.json", type: "file", content: `{\n  "name": "${title}",\n  "version": "0.1.0"\n}\n` },
      { path: "src/index.ts", type: "file", content: "export function main(): void {\n  console.log('hello');\n}\n" },
      { path: "src/util.ts", type: "file", content: "export const noop = (): void => {};\n" },
    ].map((f) => ({ ...f, size: rpByteSize(f.content) }));
    const c0 = {
      sha: rpSha(), message: "Initial commit", author: "you", branch: "main", parents: [], date: ts,
      additions: files.reduce((n, f) => n + rpTextLines(f.content), 0), deletions: 0,
      files: files.map((f) => f.path),
      changes: Object.fromEntries(files.map((f) => [f.path, f.content])),
    };
    return {
      id: rpId("repo"),
      name: title,
      description: description || "",
      language: language || "TypeScript",
      isPrivate: false,
      stars: 0,
      defaultBranch: "main",
      createdAt: ts,
      updatedAt: ts,
      files,
      branches: [{ name: "main", head: c0.sha, protected: true, createdAt: ts }],
      tags: [],
      commits: [c0],
      issues: [],
      pulls: [],
      workflowRuns: [],
      securityAlerts: [],
    };
  }
  // Build a nested file tree from the flat path list.
  function rpBuildTree(files) {
    const root = {};
    for (const f of files) {
      const parts = f.path.split("/");
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLeaf = i === parts.length - 1;
        if (isLeaf && f.type === "file") {
          node[part] = { __file: true, path: f.path, size: f.size || 0 };
        } else {
          if (!node[part] || node[part].__file) node[part] = {};
          node = node[part];
        }
      }
    }
    function toNodes(obj, prefix) {
      return Object.entries(obj)
        .map(([name, val]) => {
          if (val.__file) return { name, type: "file", path: val.path, size: val.size };
          const childPath = prefix ? `${prefix}/${name}` : name;
          return { name, type: "dir", path: childPath, children: toNodes(val, childPath) };
        })
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    }
    return toNodes(root, "");
  }
  // Line diff between two text blobs — a real LCS alignment, so an
  // inserted line reads as one addition, not as every following line
  // changed (the old positional compare did that). Hunks carry 1-based
  // line numbers on both sides so the UI can anchor line comments.
  // Very large files fall back to the positional compare rather than
  // allocating an unbounded LCS table; counts stay truthful either way.
  function rpSplitLines(text) {
    const parts = String(text ?? "").split("\n");
    if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    return parts;
  }
  function rpDiff(oldText, newText) {
    const a = rpSplitLines(oldText);
    const b = rpSplitLines(newText);
    const out = [];
    let additions = 0, deletions = 0;
    const pushCtx = (i, j) => out.push({ type: "ctx", line: a[i], oldLine: i + 1, newLine: j + 1 });
    const pushDel = (i) => { out.push({ type: "del", line: a[i], oldLine: i + 1, newLine: null }); deletions++; };
    const pushAdd = (j) => { out.push({ type: "add", line: b[j], oldLine: null, newLine: j + 1 }); additions++; };
    if (a.length * b.length > 4_000_000) {
      const max = Math.max(a.length, b.length);
      for (let i = 0; i < max; i++) {
        if (i >= a.length) pushAdd(i);
        else if (i >= b.length) pushDel(i);
        else if (a[i] === b[i]) pushCtx(i, i);
        else { pushDel(i); pushAdd(i); }
      }
      return { hunks: out, additions, deletions };
    }
    // LCS lengths table.
    const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { pushCtx(i, j); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { pushDel(i); i++; }
      else { pushAdd(j); j++; }
    }
    while (i < a.length) { pushDel(i); i++; }
    while (j < b.length) { pushAdd(j); j++; }
    return { hunks: out, additions, deletions };
  }
  // ── Commit snapshots ───────────────────────────────────────────────
  // A commit's `changes` map ({ path: content | null }) is the delta it
  // applies to its first parent; folding the first-parent chain from
  // the root yields the full file tree at any commit. This is the
  // state-object substrate S1–S3 stand on: branches hold real trees
  // because their head commits fold to different snapshots. Commits
  // written before this field existed carry no `changes`; a fold that
  // reaches one returns null — "history predates recorded snapshots" —
  // and callers say so instead of inventing a tree.
  function rpCommitMap(repo) {
    const m = new Map();
    for (const c of repo.commits) m.set(c.sha, c);
    return m;
  }
  function rpAncestry(repo, sha) {
    const bySha = rpCommitMap(repo);
    const seen = new Set();
    const queue = sha ? [sha] : [];
    while (queue.length) {
      const cur = queue.shift();
      if (!cur || seen.has(cur)) continue;
      seen.add(cur);
      const c = bySha.get(cur);
      if (c) for (const p of c.parents || []) queue.push(p);
    }
    return seen;
  }
  function rpSnapshotAt(repo, sha) {
    if (!sha) return null;
    const bySha = rpCommitMap(repo);
    const chain = [];
    let cur = bySha.get(sha);
    if (!cur) return null;
    const guard = new Set();
    // A commit may carry a `baseline`: the full file tree AT that
    // commit, stamped by rpAnchorLegacyHead for a legacy default head
    // (see below). The fold starts from the baseline and applies only
    // the change-commits that came after it — the baseline is where
    // pre-snapshot history becomes knowable again.
    let baseline = null;
    while (cur) {
      if (guard.has(cur.sha)) return null; // corrupt cycle — refuse, don't loop
      guard.add(cur.sha);
      if (cur.baseline && typeof cur.baseline === "object") { baseline = cur.baseline; break; }
      if (!cur.changes || typeof cur.changes !== "object") return null;
      chain.push(cur);
      const parentSha = (cur.parents || [])[0];
      cur = parentSha ? bySha.get(parentSha) : null;
      if (parentSha && !cur) return null; // dangling parent — history incomplete
    }
    const snap = new Map(baseline ? Object.entries(baseline) : []);
    for (let k = chain.length - 1; k >= 0; k--) {
      for (const [path, content] of Object.entries(chain[k].changes)) {
        if (content === null) snap.delete(path); else snap.set(path, content);
      }
    }
    return snap;
  }
  // Legacy healing (Review 2 re-pass, checkpoint 1): a repo created
  // before commits recorded `changes` deltas can never fold — every
  // branch forked from its head inherits the un-foldable chain, so
  // file view and commits on ANY branch of such a repo refused with
  // history_unrecorded while main survived on the repo.files
  // fallback. But at the default branch's CURRENT head the tree is
  // knowable exactly: repo.files IS that head's tree, by the mirror
  // invariant. Stamp it onto the head commit as its `baseline`, once,
  // and every chain through that commit — branches forked before or
  // after the stamp, PRs based on it — folds from there. Returns true
  // when it stamped (callers persist). Commits deeper than the head
  // stay unrecorded: that history is genuinely unrecoverable, and the
  // surfaces keep saying so.
  function rpAnchorLegacyHead(repo) {
    const def = repo.branches.find((b) => b.name === repo.defaultBranch);
    if (!def || !def.head) return false;
    const head = rpCommitMap(repo).get(def.head);
    if (!head || head.changes || head.baseline) return false;
    head.baseline = Object.fromEntries((repo.files || []).map((f) => [f.path, f.content || ""]));
    return true;
  }
  function rpMergeBase(repo, shaA, shaB) {
    if (!shaA || !shaB) return null;
    const ancA = rpAncestry(repo, shaA);
    const bySha = rpCommitMap(repo);
    const seen = new Set();
    const queue = [shaB];
    while (queue.length) {
      const cur = queue.shift();
      if (!cur || seen.has(cur)) continue;
      seen.add(cur);
      if (ancA.has(cur)) return cur;
      const c = bySha.get(cur);
      if (c) for (const p of c.parents || []) queue.push(p);
    }
    return null;
  }
  // Three-way line merge of ONE file. Each side's edit is expressed
  // against the base text: for every base line, a side either keeps it
  // (SAME) or replaces it with zero or more lines; pure insertions
  // attach to the gap before a base line (gap n = after the last
  // line). A line or gap both sides changed differently is a
  // conflict; identical changes merge once; disjoint changes both
  // apply. A multi-line replacement block is charged to its first
  // base line (the rest are charged as deletions), which keeps the
  // accounting exact and the conflict test conservative.
  const RP_SAME = Symbol("rp-same");
  function rpSideEdits(baseLines, sideLines) {
    const diff = rpDiff(baseLines.join("\n"), sideLines.join("\n"));
    const lineEdits = new Map(); // baseIdx -> [replacement lines]
    const gapInserts = new Map(); // gapIdx -> [inserted lines]
    let baseIdx = 0;
    let k = 0;
    const hunks = diff.hunks;
    while (k < hunks.length) {
      if (hunks[k].type === "ctx") { baseIdx++; k++; continue; }
      // One edit block: a maximal run of del/add hunks.
      const start = baseIdx;
      const adds = [];
      let dels = 0;
      while (k < hunks.length && hunks[k].type !== "ctx") {
        if (hunks[k].type === "del") { dels++; baseIdx++; }
        else adds.push(hunks[k].line);
        k++;
      }
      if (dels === 0) {
        gapInserts.set(start, adds);
      } else {
        lineEdits.set(start, adds);
        for (let m = start + 1; m < start + dels; m++) lineEdits.set(m, []);
      }
    }
    return { lineEdits, gapInserts };
  }
  const rpLinesEqual = (x, y) => x.length === y.length && x.every((v, idx) => v === y[idx]);
  // Returns { merged } or { conflictLines: [1-based base line numbers] }.
  function rpMergeFile(baseText, baseSideText, headSideText) {
    const baseLines = rpSplitLines(baseText);
    const a = rpSideEdits(baseLines, rpSplitLines(baseSideText));
    const b = rpSideEdits(baseLines, rpSplitLines(headSideText));
    const conflictLines = [];
    const out = [];
    const n = baseLines.length;
    for (let g = 0; g <= n; g++) {
      const insA = a.gapInserts.get(g);
      const insB = b.gapInserts.get(g);
      if (insA && insB) {
        if (rpLinesEqual(insA, insB)) out.push(...insA);
        else conflictLines.push(Math.min(g + 1, Math.max(n, 1)));
      } else if (insA) out.push(...insA);
      else if (insB) out.push(...insB);
      if (g === n) break;
      const eA = a.lineEdits.has(g) ? a.lineEdits.get(g) : RP_SAME;
      const eB = b.lineEdits.has(g) ? b.lineEdits.get(g) : RP_SAME;
      if (eA === RP_SAME && eB === RP_SAME) out.push(baseLines[g]);
      else if (eA === RP_SAME) out.push(...eB);
      else if (eB === RP_SAME) out.push(...eA);
      else if (rpLinesEqual(eA, eB)) out.push(...eA);
      else conflictLines.push(g + 1);
    }
    if (conflictLines.length) return { conflictLines: [...new Set(conflictLines)].sort((x, y) => x - y) };
    return { merged: out.join("\n") + (out.length ? "\n" : "") };
  }
  // Three-way merge of whole trees (snapshots are Map path -> content).
  // Returns { merged: Map } or { conflicts: [{path, lines?|reason}] }.
  function rpMergeSnapshots(baseSnap, baseTipSnap, headTipSnap) {
    const paths = new Set([...baseSnap.keys(), ...baseTipSnap.keys(), ...headTipSnap.keys()]);
    const merged = new Map();
    const conflicts = [];
    for (const path of paths) {
      const inBase = baseSnap.has(path), inA = baseTipSnap.has(path), inH = headTipSnap.has(path);
      const vBase = baseSnap.get(path), vA = baseTipSnap.get(path), vH = headTipSnap.get(path);
      const changedA = inA !== inBase || (inA && inBase && vA !== vBase);
      const changedH = inH !== inBase || (inH && inBase && vH !== vBase);
      if (!changedA && !changedH) { if (inBase) merged.set(path, vBase); continue; }
      if (changedA && !changedH) { if (inA) merged.set(path, vA); continue; }
      if (!changedA && changedH) { if (inH) merged.set(path, vH); continue; }
      // Both sides changed this path.
      if (!inA && !inH) continue; // deleted on both sides
      if (inA && inH && vA === vH) { merged.set(path, vA); continue; }
      if (!inBase) { conflicts.push({ path, reason: "added on both branches with different content" }); continue; }
      if (!inA || !inH) { conflicts.push({ path, reason: `deleted on one branch, edited on the other` }); continue; }
      const r = rpMergeFile(vBase, vA, vH);
      if (r.conflictLines) conflicts.push({ path, lines: r.conflictLines });
      else merged.set(path, r.merged);
    }
    if (conflicts.length) return { conflicts };
    return { merged };
  }
  // The changes map that turns `fromSnap` into `toSnap` (commit delta).
  function rpChangesBetween(fromSnap, toSnap) {
    const changes = {};
    const paths = new Set([...fromSnap.keys(), ...toSnap.keys()]);
    for (const path of paths) {
      const inF = fromSnap.has(path), inT = toSnap.has(path);
      if (inT && (!inF || fromSnap.get(path) !== toSnap.get(path))) changes[path] = toSnap.get(path);
      else if (!inT && inF) changes[path] = null;
    }
    return changes;
  }
  // Materialise a snapshot Map into the repo.files array shape
  // (default-branch mirror + security/workflow/insights consumers).
  function rpFilesFromSnapshot(snap) {
    return [...snap.entries()].map(([path, content]) => ({
      path, type: "file", content, size: rpByteSize(content),
    }));
  }
  const LANG_EXT = { ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript", py: "Python", rs: "Rust", go: "Go", json: "JSON", md: "Markdown", css: "CSS", html: "HTML" };
  const rpLangOf = (path) => LANG_EXT[(path.split(".").pop() || "").toLowerCase()] || "Text";

  // The file tree a branch currently points at: the snapshot folded
  // from its head commit. Falls back to repo.files ONLY for the
  // default branch of a legacy repo whose commits predate snapshots
  // (repo.files IS that tree there); other legacy branches return
  // null and callers say their history predates recorded snapshots.
  function rpBranchTree(repo, branchName) {
    const branch = repo.branches.find((b) => b.name === branchName);
    if (!branch) return null;
    let snap = rpSnapshotAt(repo, branch.head);
    if (!snap && rpAnchorLegacyHead(repo)) {
      // The chain may have become foldable by anchoring the default
      // head (the branch's chain passes through it) — retry once
      // before declaring this branch's history unrecorded.
      rpSave();
      snap = rpSnapshotAt(repo, branch.head);
    }
    if (snap) return snap;
    if (branchName === repo.defaultBranch) {
      return new Map((repo.files || []).map((f) => [f.path, f.content || ""]));
    }
    return null;
  }

  // ── Repo lifecycle ─────────────────────────────────────────────────
  registerLensAction("repos", "repo-create", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const name = rpClean(params.name, 100);
      if (!name) return { ok: false, error: "name required" };
      // S6 guard: one account, one repo per name — a silent duplicate
      // pair is indistinguishable in the list (Review F5/C48).
      const mine = rpList(s.repos, rpUid(ctx));
      const dupe = mine.find((r) => r.name.toLowerCase() === name.toLowerCase());
      if (dupe) {
        return { ok: false, error: "duplicate_name", message: `You already have a repo named "${dupe.name}". Rename it or delete it first — two repos with one name can't be told apart.` };
      }
      const repo = rpSeedRepo(name, rpClean(params.description, 280), rpClean(params.language, 40));
      if (params.isPrivate) repo.isPrivate = true;
      rpList(s.repos, rpUid(ctx)).push(repo);
      rpSave();
      return { ok: true, result: { repo: { id: repo.id, name: repo.name, defaultBranch: repo.defaultBranch } } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "repo-list", (ctx, _a, _params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repos = (s.repos.get(rpUid(ctx)) || []).map((r) => ({
        id: r.id, name: r.name, description: r.description, language: r.language,
        isPrivate: r.isPrivate, stars: r.stars, defaultBranch: r.defaultBranch,
        fileCount: r.files.length, branchCount: r.branches.length,
        openIssues: r.issues.filter((i) => i.state === "open").length,
        openPulls: r.pulls.filter((p) => p.state === "open").length,
        updatedAt: r.updatedAt,
      })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { ok: true, result: { repos, count: repos.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ── [L] File tree + code viewer ────────────────────────────────────
  registerLensAction("repos", "file-tree", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const branchName = rpClean(params.branch, 80) || repo.defaultBranch;
      if (!repo.branches.some((b) => b.name === branchName)) return { ok: false, error: "branch not found" };
      const tree = rpBranchTree(repo, branchName);
      if (!tree) {
        return { ok: false, error: "history_unrecorded", message: `The branch "${branchName}" predates recorded file snapshots, so its tree can't be reconstructed.` };
      }
      const files = rpFilesFromSnapshot(tree);
      return {
        ok: true,
        result: {
          repoId: repo.id, branch: branchName,
          tree: rpBuildTree(files), fileCount: files.length,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "file-read", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const path = rpClean(params.path, 300);
      if (!path) return { ok: false, error: "path required" };
      // Read at a commit (params.sha), on a branch (params.branch), or
      // on the default branch — always from recorded snapshots.
      if (rpAnchorLegacyHead(repo)) rpSave();
      let content;
      let atCommit = null;
      if (params.sha) {
        const snap = rpSnapshotAt(repo, rpClean(params.sha, 60));
        if (!snap) return { ok: false, error: "history_unrecorded", message: "That commit predates recorded file snapshots, so its file contents can't be shown. Commits made now record their full tree." };
        if (!snap.has(path)) return { ok: false, error: "file not found at that commit" };
        content = snap.get(path);
        atCommit = rpClean(params.sha, 60);
      } else {
        const branchName = rpClean(params.branch, 80) || repo.defaultBranch;
        const tree = rpBranchTree(repo, branchName);
        if (!tree) return { ok: false, error: "history_unrecorded", message: `The branch "${branchName}" predates recorded file snapshots.` };
        if (!tree.has(path)) return { ok: false, error: "file not found" };
        content = tree.get(path);
      }
      return {
        ok: true,
        result: {
          path, content, language: rpLangOf(path),
          lineCount: rpTextLines(content), size: rpByteSize(content),
          ...(atCommit ? { atCommit } : {}),
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "file-save", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const path = rpClean(params.path, 300);
      if (!path) return { ok: false, error: "path required" };
      // S1: the commit lands on the NAMED branch, whose own tree is
      // what changes. There is no shared working copy to leak into
      // main any more (Review F1).
      const branchName = rpClean(params.branch, 80) || repo.defaultBranch;
      const branch = repo.branches.find((b) => b.name === branchName);
      if (!branch) return { ok: false, error: "branch not found" };
      // S6 guards — named, never silent (Review F5/C49/C50).
      if (params.message != null && !rpClean(params.message, 200)) {
        return { ok: false, error: "commit_message_required", message: "The commit message is empty. Write a message — a commit nobody can identify helps no one." };
      }
      const content = String(params.content == null ? "" : params.content).slice(0, 200000);
      if (content === "" && params.confirmEmpty !== true) {
        return { ok: false, error: "empty_content", message: `"${path}" would be committed empty. If that's really intended, confirm it and the commit records your choice.` };
      }
      const tree = rpBranchTree(repo, branchName);
      if (!tree) {
        return { ok: false, error: "history_unrecorded", message: `The branch "${branchName}" predates recorded file snapshots, so a new commit can't be based on it safely.` };
      }
      const existed = tree.has(path);
      const oldContent = existed ? tree.get(path) : "";
      if (existed && oldContent === content) {
        return { ok: false, error: "no_changes", message: `"${path}" is unchanged on ${branchName} — there is nothing to commit.` };
      }
      const diff = rpDiff(oldContent, content);
      const commit = {
        sha: rpSha(), message: rpClean(params.message, 200) || `Update ${path}`,
        author: "you", branch: branchName,
        parents: branch.head ? [branch.head] : [], date: rpNow(),
        additions: diff.additions, deletions: diff.deletions, files: [path],
        changes: { [path]: content },
      };
      repo.commits.push(commit);
      branch.head = commit.sha;
      // repo.files mirrors the DEFAULT branch's tree (security scan,
      // workflow checks and insights read the default branch).
      if (branchName === repo.defaultBranch) {
        tree.set(path, content);
        repo.files = rpFilesFromSnapshot(tree);
      }
      repo.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { saved: true, branch: branchName, created: !existed, commit: { sha: commit.sha, additions: diff.additions, deletions: diff.deletions } } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // S4: delete a file — a real commit on the named branch.
  registerLensAction("repos", "file-delete", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const path = rpClean(params.path, 300);
      if (!path) return { ok: false, error: "path required" };
      const branchName = rpClean(params.branch, 80) || repo.defaultBranch;
      const branch = repo.branches.find((b) => b.name === branchName);
      if (!branch) return { ok: false, error: "branch not found" };
      const tree = rpBranchTree(repo, branchName);
      if (!tree) return { ok: false, error: "history_unrecorded", message: `The branch "${branchName}" predates recorded file snapshots.` };
      if (!tree.has(path)) return { ok: false, error: "file not found" };
      const oldContent = tree.get(path);
      const diff = rpDiff(oldContent, "");
      const commit = {
        sha: rpSha(), message: rpClean(params.message, 200) || `Delete ${path}`,
        author: "you", branch: branchName,
        parents: branch.head ? [branch.head] : [], date: rpNow(),
        additions: 0, deletions: diff.deletions, files: [path],
        changes: { [path]: null },
      };
      repo.commits.push(commit);
      branch.head = commit.sha;
      if (branchName === repo.defaultBranch) {
        tree.delete(path);
        repo.files = rpFilesFromSnapshot(tree);
      }
      repo.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { deleted: true, branch: branchName, commit: { sha: commit.sha, deletions: diff.deletions } } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ── [S] Branch + tag management, commit history graph ──────────────
  registerLensAction("repos", "branch-list", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const defBranch = repo.branches.find((b) => b.name === repo.defaultBranch);
      const defAncestry = defBranch ? rpAncestry(repo, defBranch.head) : new Set();
      const branches = repo.branches.map((b) => {
        const anc = rpAncestry(repo, b.head);
        return {
          name: b.name, head: b.head, protected: !!b.protected,
          isDefault: b.name === repo.defaultBranch,
          // Truthful count (Review 2 re-pass, adjacent wrongness):
          // the default branch reports its total history; every other
          // branch reports its AHEAD count — commits reachable from
          // its head that the default branch does not have, i.e. the
          // branch's OWN commits. The first build reported raw
          // ancestry size, so a branch forked mid-history "had"
          // main's earlier commits (pass-1 branches read 3 and 5
          // against their own empty histories) — a number matching
          // nothing. (Pass 1's label count was the opposite error:
          // main's commits wearing a feature branch's name.)
          commits: b.name === repo.defaultBranch
            ? anc.size
            : [...anc].filter((sha) => !defAncestry.has(sha)).length,
          createdAt: b.createdAt,
        };
      });
      return { ok: true, result: { branches, tags: repo.tags, defaultBranch: repo.defaultBranch } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "branch-create", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const name = rpClean(params.name, 80);
      if (!name) return { ok: false, error: "branch name required" };
      if (repo.branches.some((b) => b.name === name)) return { ok: false, error: "branch already exists" };
      const from = repo.branches.find((b) => b.name === (rpClean(params.from, 80) || repo.defaultBranch));
      const branch = { name, head: from ? from.head : repo.commits[repo.commits.length - 1]?.sha, protected: false, createdAt: rpNow() };
      repo.branches.push(branch);
      repo.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { branch } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // S5: delete a branch — never the default, never one an open PR
  // still points at (its diff is computed from the branch's head).
  registerLensAction("repos", "branch-delete", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const name = rpClean(params.name, 80);
      if (!name) return { ok: false, error: "branch name required" };
      if (name === repo.defaultBranch) return { ok: false, error: "default_branch", message: `"${name}" is the default branch — it can't be deleted.` };
      const idx = repo.branches.findIndex((b) => b.name === name);
      if (idx < 0) return { ok: false, error: "branch not found" };
      const openPr = repo.pulls.find((p) => p.state === "open" && (p.head === name || p.base === name));
      if (openPr) return { ok: false, error: "branch_in_open_pr", message: `Pull request #${openPr.number} is still open against "${name}" — merge or close it first.` };
      repo.branches.splice(idx, 1);
      repo.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { deleted: true, branch: name } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "tag-create", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const name = rpClean(params.name, 60);
      if (!name) return { ok: false, error: "tag name required" };
      if (repo.tags.some((t) => t.name === name)) return { ok: false, error: "tag already exists" };
      const branch = repo.branches.find((b) => b.name === (rpClean(params.branch, 80) || repo.defaultBranch));
      const tag = { name, commit: branch ? branch.head : repo.commits[repo.commits.length - 1]?.sha, message: rpClean(params.message, 200), createdAt: rpNow() };
      repo.tags.push(tag);
      repo.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { tag } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // S5: delete a tag.
  registerLensAction("repos", "tag-delete", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const name = rpClean(params.name, 60);
      if (!name) return { ok: false, error: "tag name required" };
      const idx = repo.tags.findIndex((t) => t.name === name);
      if (idx < 0) return { ok: false, error: "tag not found" };
      repo.tags.splice(idx, 1);
      repo.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { deleted: true, tag: name } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // S5: rename / describe / change visibility — within the owner's
  // account. Cross-account visibility rides the platform ACL (#1789),
  // not a Repos-local invention (review §8 pointer).
  registerLensAction("repos", "repo-update", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = rpUid(ctx);
      const repo = rpFindRepo(s, uid, params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      if (params.name != null) {
        const name = rpClean(params.name, 100);
        if (!name) return { ok: false, error: "name required" };
        const dupe = (s.repos.get(uid) || []).find((r) => r.id !== repo.id && r.name.toLowerCase() === name.toLowerCase());
        if (dupe) return { ok: false, error: "duplicate_name", message: `You already have a repo named "${dupe.name}".` };
        repo.name = name;
      }
      if (params.description != null) repo.description = rpClean(params.description, 280);
      if (params.isPrivate != null) repo.isPrivate = !!params.isPrivate;
      repo.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { repo: { id: repo.id, name: repo.name, description: repo.description, isPrivate: repo.isPrivate } } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // S5: delete a repo. The server requires the caller to type the
  // repo's exact name back (params.confirmName) — the typed-confirm
  // is a real guard here, not just a UI ritual.
  registerLensAction("repos", "repo-delete", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const uid = rpUid(ctx);
      const repo = rpFindRepo(s, uid, params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      if (rpClean(params.confirmName, 100) !== repo.name) {
        return { ok: false, error: "confirm_mismatch", message: `Type the repo's name exactly ("${repo.name}") to delete it.` };
      }
      const list = s.repos.get(uid) || [];
      const idx = list.findIndex((r) => r.id === repo.id);
      if (idx >= 0) list.splice(idx, 1);
      rpSave();
      return { ok: true, result: { deleted: true, repoId: repo.id, name: repo.name } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "commit-graph", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const branchLanes = {};
      repo.branches.forEach((b, i) => { branchLanes[b.name] = i; });
      const nodes = repo.commits.map((c, i) => ({
        sha: c.sha, message: c.message, author: c.author, branch: c.branch,
        lane: branchLanes[c.branch] ?? 0, parents: c.parents || [], date: c.date,
        additions: c.additions || 0, deletions: c.deletions || 0, index: i,
        files: c.files || [],
      }));
      return {
        ok: true,
        result: {
          nodes, branchLanes, totalCommits: nodes.length,
          tags: repo.tags.map((t) => ({ name: t.name, commit: t.commit })),
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // S2: one commit in full — its diff against its first parent, so a
  // commit's version of every file it touched is reviewable (C10).
  registerLensAction("repos", "commit-detail", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      if (rpAnchorLegacyHead(repo)) rpSave();
      const sha = rpClean(params.sha, 60);
      const commit = repo.commits.find((c) => c.sha === sha);
      if (!commit) return { ok: false, error: "commit not found" };
      const snap = rpSnapshotAt(repo, sha);
      if (!snap) {
        return { ok: true, result: { commit: { sha: commit.sha, message: commit.message, author: commit.author, branch: commit.branch, date: commit.date, parents: commit.parents || [] }, diff: null, diffUnavailable: "This commit predates recorded file snapshots, so its per-file diff can't be reconstructed. Commits made now record their full tree." } };
      }
      const parentSha = (commit.parents || [])[0];
      const parentSnap = parentSha ? rpSnapshotAt(repo, parentSha) : new Map();
      const changes = rpChangesBetween(parentSnap || new Map(), snap);
      const files = Object.keys(changes).map((path) => {
        const before = parentSnap && parentSnap.has(path) ? parentSnap.get(path) : "";
        const after = snap.has(path) ? snap.get(path) : "";
        const d = rpDiff(before, after);
        return {
          path, language: rpLangOf(path),
          status: changes[path] === null ? "deleted" : (parentSnap && parentSnap.has(path) ? "modified" : "added"),
          additions: d.additions, deletions: d.deletions,
          hunks: d.hunks.slice(0, 200), hunksTruncated: d.hunks.length > 200,
        };
      });
      const additions = files.reduce((n, f) => n + f.additions, 0);
      const deletions = files.reduce((n, f) => n + f.deletions, 0);
      return {
        ok: true,
        result: {
          commit: { sha: commit.sha, message: commit.message, author: commit.author, branch: commit.branch, date: commit.date, parents: commit.parents || [], merge: !!commit.merge },
          diff: { files, additions, deletions, fileCount: files.length },
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ── [M] Issue lifecycle ────────────────────────────────────────────
  registerLensAction("repos", "issue-list", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const state = ["open", "closed", "all"].includes(params.state) ? params.state : "all";
      const issues = repo.issues
        .filter((i) => state === "all" || i.state === state)
        .map((i) => ({
          number: i.number, title: i.title, state: i.state, labels: i.labels,
          author: i.author, comments: i.comments.length, createdAt: i.createdAt,
        }))
        .sort((a, b) => b.number - a.number);
      return {
        ok: true,
        result: {
          issues, count: issues.length,
          open: repo.issues.filter((i) => i.state === "open").length,
          closed: repo.issues.filter((i) => i.state === "closed").length,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "issue-create", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const title = rpClean(params.title, 200);
      if (!title) return { ok: false, error: "title required" };
      const number = (repo.issues.reduce((m, i) => Math.max(m, i.number), 0)) +
        (repo.pulls.reduce((m, p) => Math.max(m, p.number), 0)) + 1;
      const labels = Array.isArray(params.labels) ? params.labels.map((l) => rpClean(l, 30)).filter(Boolean).slice(0, 8) : [];
      const issue = {
        id: rpId("iss"), number, title, body: rpClean(params.body, 4000),
        state: "open", author: "you", labels, comments: [], createdAt: rpNow(), updatedAt: rpNow(),
      };
      repo.issues.push(issue);
      repo.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { issue: { number: issue.number, title: issue.title, state: issue.state } } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "issue-detail", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const issue = repo.issues.find((i) => i.number === rpNum(params.number, -1));
      if (!issue) return { ok: false, error: "issue not found" };
      const linkedPulls = repo.pulls
        .filter((p) => (p.linkedIssues || []).includes(issue.number))
        .map((p) => ({ number: p.number, title: p.title, state: p.state }));
      return { ok: true, result: { issue: { ...issue, linkedPulls } } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "issue-comment", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const issue = repo.issues.find((i) => i.number === rpNum(params.number, -1));
      if (!issue) return { ok: false, error: "issue not found" };
      const body = rpClean(params.body, 4000);
      if (!body) return { ok: false, error: "comment body required" };
      const comment = { id: rpId("cmt"), author: "you", body, createdAt: rpNow() };
      issue.comments.push(comment);
      issue.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { comment, commentCount: issue.comments.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "issue-set-state", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const issue = repo.issues.find((i) => i.number === rpNum(params.number, -1));
      if (!issue) return { ok: false, error: "issue not found" };
      const state = params.state === "open" ? "open" : "closed";
      issue.state = state;
      issue.updatedAt = rpNow();
      repo.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { number: issue.number, state } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ── [M] Pull request detail — diff, review, merge ──────────────────
  registerLensAction("repos", "pull-list", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const state = ["open", "closed", "merged", "all"].includes(params.state) ? params.state : "all";
      const pulls = repo.pulls
        .filter((p) => state === "all" || p.state === state)
        .map((p) => ({
          number: p.number, title: p.title, state: p.state,
          base: p.base, head: p.head, author: p.author,
          reviews: p.reviews.length, comments: p.comments.length, createdAt: p.createdAt,
        }))
        .sort((a, b) => b.number - a.number);
      return {
        ok: true,
        result: {
          pulls, count: pulls.length,
          open: repo.pulls.filter((p) => p.state === "open").length,
          merged: repo.pulls.filter((p) => p.state === "merged").length,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "pull-create", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const title = rpClean(params.title, 200);
      if (!title) return { ok: false, error: "title required" };
      if (rpAnchorLegacyHead(repo)) rpSave();
      const head = rpClean(params.head, 80);
      const base = rpClean(params.base, 80) || repo.defaultBranch;
      if (!head) return { ok: false, error: "head branch required" };
      if (!repo.branches.some((b) => b.name === head)) return { ok: false, error: "head branch not found" };
      if (head === base) return { ok: false, error: "head and base must differ" };
      // S6: a PR with no changes says so at creation instead of
      // opening an empty ritual (Review F5). Only enforced when both
      // trees are snapshot-recorded; legacy history can't prove
      // emptiness and is not blocked on a guess.
      {
        const headBranch = repo.branches.find((b) => b.name === head);
        const baseBranch = repo.branches.find((b) => b.name === base);
        const mb = headBranch && baseBranch ? rpMergeBase(repo, baseBranch.head, headBranch.head) : null;
        const mbSnap = mb ? rpSnapshotAt(repo, mb) : null;
        const headSnap = headBranch ? rpSnapshotAt(repo, headBranch.head) : null;
        if (mbSnap && headSnap) {
          const probe = rpChangesBetween(mbSnap, headSnap);
          if (Object.keys(probe).length === 0) {
            return { ok: false, error: "no_changes", message: `"${head}" introduces no changes relative to "${base}" — there is nothing to review yet. Commit something on ${head} first.` };
          }
        }
      }
      const number = (repo.issues.reduce((m, i) => Math.max(m, i.number), 0)) +
        (repo.pulls.reduce((m, p) => Math.max(m, p.number), 0)) + 1;
      const headCommits = repo.commits.filter((c) => c.branch === head);
      const linkedIssues = Array.isArray(params.linkedIssues)
        ? [...new Set(params.linkedIssues.map((n) => rpNum(n, -1)).filter((n) => repo.issues.some((i) => i.number === n)))]
        : [];
      const pull = {
        id: rpId("pr"), number, title, body: rpClean(params.body, 4000),
        state: "open", base, head, author: "you",
        commits: headCommits.map((c) => c.sha),
        linkedIssues,
        reviews: [], comments: [], createdAt: rpNow(), updatedAt: rpNow(),
      };
      repo.pulls.push(pull);
      repo.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { pull: { number: pull.number, title: pull.title, head, base } } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "pull-detail", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const pull = repo.pulls.find((p) => p.number === rpNum(params.number, -1));
      if (!pull) return { ok: false, error: "pull not found" };
      if (rpAnchorLegacyHead(repo)) rpSave();
      // S2: the diff is what the head branch introduces relative to
      // the merge-base — computed from recorded snapshots, per file,
      // with real line counts. S3: the same three-way check the merge
      // will run is previewed here as `conflicts`.
      const baseBranch = repo.branches.find((b) => b.name === pull.base);
      const headBranch = repo.branches.find((b) => b.name === pull.head);
      let diff = null;
      let diffUnavailable = null;
      let conflicts = null;
      if (!baseBranch || !headBranch) {
        diffUnavailable = "A branch this pull request points at no longer exists, so its diff can't be computed.";
      } else {
        const mb = rpMergeBase(repo, baseBranch.head, headBranch.head);
        const mbSnap = mb ? rpSnapshotAt(repo, mb) : null;
        const headSnap = rpSnapshotAt(repo, headBranch.head);
        const baseSnap = rpSnapshotAt(repo, baseBranch.head);
        if (!mbSnap || !headSnap || !baseSnap) {
          diffUnavailable = "This pull request's history predates recorded file snapshots, so a truthful diff can't be computed. New branches and commits record snapshots.";
        } else {
          const changes = rpChangesBetween(mbSnap, headSnap);
          const fileDiffs = Object.keys(changes).sort().map((path) => {
            const before = mbSnap.has(path) ? mbSnap.get(path) : "";
            const after = headSnap.has(path) ? headSnap.get(path) : "";
            const d = rpDiff(before, after);
            return {
              path, language: rpLangOf(path),
              status: changes[path] === null ? "deleted" : (mbSnap.has(path) ? "modified" : "added"),
              additions: d.additions, deletions: d.deletions,
              hunks: d.hunks.slice(0, 200), hunksTruncated: d.hunks.length > 200,
            };
          });
          diff = {
            files: fileDiffs,
            additions: fileDiffs.reduce((n, f) => n + f.additions, 0),
            deletions: fileDiffs.reduce((n, f) => n + f.deletions, 0),
            fileCount: fileDiffs.length,
            mergeBase: mb,
          };
          const dry = rpMergeSnapshots(mbSnap, baseSnap, headSnap);
          conflicts = dry.conflicts || [];
        }
      }
      const approvals = pull.reviews.filter((rv) => rv.verdict === "approve").length;
      const changesRequested = pull.reviews.filter((rv) => rv.verdict === "request-changes").length;
      return {
        ok: true,
        result: {
          pull: {
            number: pull.number, title: pull.title, body: pull.body, state: pull.state,
            base: pull.base, head: pull.head, author: pull.author, createdAt: pull.createdAt,
            linkedIssues: pull.linkedIssues || [],
          },
          diff, ...(diffUnavailable ? { diffUnavailable } : {}),
          conflicts,
          reviews: pull.reviews, comments: pull.comments,
          mergeable: pull.state === "open" && changesRequested === 0 && Array.isArray(conflicts) && conflicts.length === 0,
          approvals, changesRequested,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "pull-review", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const pull = repo.pulls.find((p) => p.number === rpNum(params.number, -1));
      if (!pull) return { ok: false, error: "pull not found" };
      const verdict = ["approve", "request-changes", "comment"].includes(params.verdict) ? params.verdict : "comment";
      const review = { id: rpId("rev"), reviewer: "you", verdict, body: rpClean(params.body, 4000), createdAt: rpNow() };
      pull.reviews.push(review);
      pull.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { review, totalReviews: pull.reviews.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // S10: a comment on the pull request — general, or anchored to a
  // diff line (path + new-file line number from pull-detail's hunks).
  registerLensAction("repos", "pull-comment", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const pull = repo.pulls.find((p) => p.number === rpNum(params.number, -1));
      if (!pull) return { ok: false, error: "pull not found" };
      const body = rpClean(params.body, 4000);
      if (!body) return { ok: false, error: "comment body required" };
      const comment = { id: rpId("cmt"), author: "you", body, createdAt: rpNow() };
      if (params.path && Number(params.line) > 0) {
        comment.path = rpClean(params.path, 300);
        comment.line = Math.floor(Number(params.line));
      }
      pull.comments.push(comment);
      pull.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { comment, commentCount: pull.comments.length } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // S10: link/unlink an issue to a pull request (Review F13). The
  // link lives on the pull; issue-detail reports it back the other
  // way, so the cross-reference reads from both surfaces.
  registerLensAction("repos", "pull-link-issue", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const pull = repo.pulls.find((p) => p.number === rpNum(params.number, -1));
      if (!pull) return { ok: false, error: "pull not found" };
      const issueNumber = rpNum(params.issueNumber, -1);
      if (!repo.issues.some((i) => i.number === issueNumber)) return { ok: false, error: "issue not found" };
      if (!Array.isArray(pull.linkedIssues)) pull.linkedIssues = [];
      const linked = params.unlink === true
        ? (pull.linkedIssues = pull.linkedIssues.filter((n) => n !== issueNumber), false)
        : (pull.linkedIssues.includes(issueNumber) ? true : (pull.linkedIssues.push(issueNumber), true));
      pull.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { number: pull.number, issueNumber, linked, linkedIssues: pull.linkedIssues } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "pull-merge", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const pull = repo.pulls.find((p) => p.number === rpNum(params.number, -1));
      if (!pull) return { ok: false, error: "pull not found" };
      if (rpAnchorLegacyHead(repo)) rpSave();
      if (pull.state !== "open") return { ok: false, error: `pull is ${pull.state}` };
      if (pull.reviews.some((rv) => rv.verdict === "request-changes")) {
        return { ok: false, error: "changes requested — cannot merge" };
      }
      const baseBranch = repo.branches.find((b) => b.name === pull.base);
      const headBranch = repo.branches.find((b) => b.name === pull.head);
      if (!baseBranch || !headBranch) return { ok: false, error: "base or head branch no longer exists" };
      // S3: a real three-way check before anything moves. Same lines
      // diverged on both sides → the merge is BLOCKED, the conflicting
      // files/lines are named, and the pull stays open (Review F3).
      const mb = rpMergeBase(repo, baseBranch.head, headBranch.head);
      const mbSnap = mb ? rpSnapshotAt(repo, mb) : null;
      const baseSnap = rpSnapshotAt(repo, baseBranch.head);
      const headSnap = rpSnapshotAt(repo, headBranch.head);
      if (!mbSnap || !baseSnap || !headSnap) {
        return { ok: false, error: "history_unrecorded", message: "This pull request's history predates recorded file snapshots, so a safe merge can't be checked. Nothing was merged." };
      }
      const attempt = rpMergeSnapshots(mbSnap, baseSnap, headSnap);
      if (attempt.conflicts) {
        const named = attempt.conflicts.map((c) => c.lines
          ? `${c.path} (line${c.lines.length > 1 ? "s" : ""} ${c.lines.join(", ")})`
          : `${c.path} (${c.reason})`).join("; ");
        return {
          ok: false, error: "merge_conflict", conflicts: attempt.conflicts,
          message: `Merge blocked — both branches changed the same content: ${named}. Concord checked the lines each side changed since the branch point; where they overlap, a person has to decide. The pull request stays open and nothing was merged.`,
        };
      }
      const mergedSnap = attempt.merged;
      const mergeChanges = rpChangesBetween(baseSnap, mergedSnap);
      const stats = Object.keys(mergeChanges).reduce((acc, path) => {
        const d = rpDiff(baseSnap.get(path) || "", mergedSnap.get(path) || "");
        acc.additions += d.additions; acc.deletions += d.deletions;
        return acc;
      }, { additions: 0, deletions: 0 });
      const mergeSha = rpSha();
      repo.commits.push({
        sha: mergeSha, message: `Merge pull request #${pull.number}: ${pull.title}`,
        author: "you", branch: pull.base,
        parents: [baseBranch.head, headBranch.head],
        date: rpNow(), additions: stats.additions, deletions: stats.deletions,
        files: Object.keys(mergeChanges), merge: true,
        changes: mergeChanges,
      });
      baseBranch.head = mergeSha;
      if (pull.base === repo.defaultBranch) repo.files = rpFilesFromSnapshot(mergedSnap);
      pull.state = "merged";
      pull.mergedAt = rpNow();
      pull.mergeCommit = mergeSha;
      pull.updatedAt = rpNow();
      // S10: linked issues close when their pull request merges —
      // the cross-reference does the work it advertises (Review F13).
      const closedIssues = [];
      for (const n of pull.linkedIssues || []) {
        const issue = repo.issues.find((i) => i.number === n);
        if (issue && issue.state === "open") {
          issue.state = "closed";
          issue.updatedAt = rpNow();
          closedIssues.push(n);
        }
      }
      repo.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { merged: true, mergeCommit: mergeSha, number: pull.number, filesChanged: Object.keys(mergeChanges).length, additions: stats.additions, deletions: stats.deletions, closedIssues } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ── [M] Actions / CI run logs ──────────────────────────────────────
  // No build/test runner is attached to this server, so a run executes the
  // checks that CAN be done honestly on the stored files (JSON validity, JS
  // syntax, blocking static-scan rules) and reports build/test as skipped.
  // Nothing here is a canned pass: a step's conclusion comes from the files.
  const RP_ESM_RX = /^\s*(import\s|export\s)/m;
  const RP_CI_BLOCKING_RULES = new Set(["no-eval", "hardcoded-secret"]);
  const rpTimed = (fn) => { const t0 = performance.now(); const out = fn(); return { ...out, durationMs: Math.max(1, Math.round(performance.now() - t0)) }; };
  registerLensAction("repos", "workflow-run", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const branch = rpClean(params.branch, 80) || repo.defaultBranch;
      const branchObj = repo.branches.find((b) => b.name === branch);
      // The checks run against the NAMED branch's tree, not silently
      // against the default branch's (same class as F1).
      const branchTree = rpBranchTree(repo, branch);
      const files = branchTree ? rpFilesFromSnapshot(branchTree) : (Array.isArray(repo.files) ? repo.files : []);
      const steps = [];

      steps.push({ name: "Checkout", ...rpTimed(() => ({
        conclusion: "success",
        logs: [`${files.length} file(s) in ${repo.name || "repository"} @ ${branchObj ? String(branchObj.head).slice(0, 7) : "no commits"}`],
      })) });

      steps.push({ name: "Validate JSON", ...rpTimed(() => {
        const logs = []; let bad = 0; let n = 0;
        for (const f of files) {
          if (!/\.json$/i.test(f.path)) continue;
          n++;
          try { JSON.parse(f.content || ""); } catch (e) { bad++; logs.push(`ERROR ${f.path}: ${e.message}`); }
        }
        logs.unshift(n ? `${n} JSON file(s) checked, ${bad} invalid` : "No JSON files");
        return { conclusion: bad ? "failure" : "success", logs };
      }) });

      steps.push({ name: "Syntax check (JS)", ...rpTimed(() => {
        const logs = []; let bad = 0; let checked = 0; let esm = 0; let ts = 0;
        for (const f of files) {
          // TypeScript sources are counted and named as not parsed —
          // folding them into "0 script(s)" made this step contradict
          // the repo standing next to it (Review F8).
          if (/\.(ts|tsx|mts|cts)$/i.test(f.path)) { ts++; continue; }
          if (!/\.(c?js|mjs)$/i.test(f.path)) continue;
          if (RP_ESM_RX.test(f.content || "")) { esm++; continue; }
          checked++;
          try { new vm.Script(f.content || "", { filename: f.path }); } catch (e) { bad++; logs.push(`ERROR ${f.path}: ${e.message}`); }
        }
        logs.unshift(`${checked} script(s) parsed, ${bad} with syntax errors${esm ? `; ${esm} ES-module file(s) not parsed` : ""}${ts ? `; ${ts} TypeScript file(s) not parsed — no TypeScript checker is attached to this server` : ""}`);
        return { conclusion: bad ? "failure" : "success", logs };
      }) });

      steps.push({ name: "Static scan (blocking rules)", ...rpTimed(() => {
        const logs = []; let hits = 0;
        for (const f of files) {
          (f.content || "").split("\n").forEach((line, idx) => {
            for (const rule of RP_SCAN_RULES) {
              if (RP_CI_BLOCKING_RULES.has(rule.rule) && rule.rx.test(line)) { hits++; logs.push(`ERROR ${f.path}:${idx + 1} ${rule.rule} — ${rule.message}`); }
            }
          });
        }
        // Scope stated, so this count never reads as contradicting
        // the Security tab: this step counts blocking CODE rules
        // only; dependency alerts and advisory rules live there.
        logs.unshift(`${hits} blocking finding(s) — blocking code rules only; dependency alerts are counted in the Security tab`);
        return { conclusion: hits ? "failure" : "success", logs };
      }) });

      for (const name of ["Test", "Build"]) {
        steps.push({ name, conclusion: "skipped", durationMs: 0,
          logs: [`Not run — no ${name.toLowerCase()} runner is attached to this server.`] });
      }

      // A failed step does not cancel the report of later checks, but the run
      // conclusion is a failure if any executed step failed.
      const failed = steps.some((st) => st.conclusion === "failure");
      const run = {
        id: rpId("run"),
        number: repo.workflowRuns.length + 1,
        workflow: rpClean(params.workflow, 80) || "Static checks",
        branch, headSha: branchObj ? branchObj.head : null,
        status: "completed",
        conclusion: failed ? "failure" : "success",
        steps, durationMs: steps.reduce((n, st) => n + st.durationMs, 0),
        triggeredBy: "you", createdAt: rpNow(),
      };
      repo.workflowRuns.push(run);
      if (repo.workflowRuns.length > 50) repo.workflowRuns = repo.workflowRuns.slice(-50);
      repo.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { run: { id: run.id, number: run.number, conclusion: run.conclusion } } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "workflow-runs", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const runs = [...repo.workflowRuns].reverse().map((r) => ({
        id: r.id, number: r.number, workflow: r.workflow, branch: r.branch,
        conclusion: r.conclusion, durationMs: r.durationMs, createdAt: r.createdAt,
        steps: r.steps.length,
      }));
      return {
        ok: true,
        result: {
          runs, count: runs.length,
          passed: runs.filter((r) => r.conclusion === "success").length,
          failed: runs.filter((r) => r.conclusion === "failure").length,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "workflow-logs", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const run = repo.workflowRuns.find((r) => r.id === rpClean(params.runId, 60));
      if (!run) return { ok: false, error: "run not found" };
      return {
        ok: true,
        result: {
          runId: run.id, number: run.number, workflow: run.workflow,
          branch: run.branch, conclusion: run.conclusion, steps: run.steps,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ── [S] Security tab — Dependabot (real OSV.dev feed) + code scanning ──
  const RP_SCAN_RULES = [
    { rx: /eval\s*\(/, rule: "no-eval", severity: "high", message: "Use of eval() — code injection risk" },
    { rx: /password\s*=\s*['"][^'"]+['"]/i, rule: "hardcoded-secret", severity: "critical", message: "Hardcoded credential detected" },
    { rx: /innerHTML\s*=/, rule: "no-inner-html", severity: "moderate", message: "Direct innerHTML assignment — XSS risk" },
    { rx: /http:\/\//, rule: "insecure-transport", severity: "low", message: "Insecure http:// URL" },
    { rx: /TODO|FIXME/, rule: "tracked-debt", severity: "low", message: "Unresolved TODO/FIXME marker" },
  ];
  registerLensAction("repos", "security-scan", async (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      // Dependabot alerts — parse package.json deps and check them against
      // OSV.dev, a real free/keyless vulnerability feed (osv.dev/docs).
      const pkgFile = repo.files.find((f) => f.path === "package.json");
      let depVersions = {};
      if (pkgFile) {
        try {
          const parsed = JSON.parse(pkgFile.content || "{}");
          depVersions = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
        } catch (_e) { /* malformed package.json — no dependency alerts */ }
      }
      const osv = await osvScanDependencies(depVersions);
      const dependabot = osv.dependabot;
      // Code scanning — regex rules over every text file.
      const codeScanning = [];
      for (const f of repo.files) {
        const lines = (f.content || "").split("\n");
        lines.forEach((line, idx) => {
          for (const rule of RP_SCAN_RULES) {
            if (rule.rx.test(line)) {
              codeScanning.push({ kind: "code", path: f.path, line: idx + 1, rule: rule.rule, severity: rule.severity, message: rule.message });
            }
          }
        });
      }
      const all = [...dependabot, ...codeScanning];
      const sevRank = { critical: 4, high: 3, moderate: 2, low: 1 };
      const bySeverity = { critical: 0, high: 0, moderate: 0, low: 0 };
      for (const a of all) bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
      repo.securityAlerts = all;
      repo.updatedAt = rpNow();
      rpSave();
      return {
        ok: true,
        result: {
          dependabot, codeScanning,
          total: all.length, bySeverity,
          alerts: all.sort((a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0)),
          dependencySource: "osv.dev",
          dependencyScanUnreachable: osv.unreachable,
          ...(osv.unreachable ? { dependencyScanError: osv.error } : {}),
          ...(osv.truncated ? { dependencyScanTruncated: true } : {}),
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ── [S] Repo insights — contributors, traffic, activity ────────────
  registerLensAction("repos", "repo-insights", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      // Contributors.
      const byAuthor = {};
      for (const c of repo.commits) {
        const a = c.author || "unknown";
        if (!byAuthor[a]) byAuthor[a] = { author: a, commits: 0, additions: 0, deletions: 0 };
        byAuthor[a].commits++;
        byAuthor[a].additions += c.additions || 0;
        byAuthor[a].deletions += c.deletions || 0;
      }
      const contributors = Object.values(byAuthor).sort((a, b) => b.commits - a.commits);
      // Commit activity — last 12 weeks bucketed.
      const now = Date.now();
      const weeks = [];
      for (let w = 11; w >= 0; w--) {
        const end = now - w * 7 * 86400000;
        const start = end - 7 * 86400000;
        const inWeek = repo.commits.filter((c) => {
          const t = new Date(c.date).getTime();
          return t >= start && t < end;
        });
        weeks.push({
          week: `W-${w}`,
          commits: inWeek.length,
          additions: inWeek.reduce((n, c) => n + (c.additions || 0), 0),
          deletions: inWeek.reduce((n, c) => n + (c.deletions || 0), 0),
        });
      }
      // Language breakdown by file size.
      const langBytes = {};
      for (const f of repo.files) {
        const lang = rpLangOf(f.path);
        langBytes[lang] = (langBytes[lang] || 0) + (Number.isFinite(f.size) ? f.size : rpByteSize(f.content));
      }
      const totalBytes = Object.values(langBytes).reduce((n, v) => n + v, 0) || 1;
      const languages = Object.entries(langBytes)
        .map(([language, bytes]) => ({ language, bytes, percent: Math.round((bytes / totalBytes) * 1000) / 10 }))
        .sort((a, b) => b.bytes - a.bytes);
      return {
        ok: true,
        result: {
          contributors,
          commitActivity: weeks,
          languages,
          totals: {
            commits: repo.commits.length,
            additions: repo.commits.reduce((n, c) => n + (c.additions || 0), 0),
            deletions: repo.commits.reduce((n, c) => n + (c.deletions || 0), 0),
            issuesOpened: repo.issues.length,
            issuesClosed: repo.issues.filter((i) => i.state === "closed").length,
            pullsMerged: repo.pulls.filter((p) => p.state === "merged").length,
          },
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  /**
   * github-languages — Real language breakdown (bytes per language)
   * for a repo. Useful for the polyglot percentage analysis.
   */
  registerLensAction("repos", "github-languages", async (_ctx, _artifact, params = {}) => {
    const owner = String(params.owner || "").trim();
    const repo = String(params.repo || "").trim();
    if (!owner || !repo) return { ok: false, error: "owner + repo required" };
    try {
      const r = await fetch(`${GITHUB_API_REPOS}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`, { headers: ghHeaders() });
      if (r.status === 404) return { ok: false, error: `repo not found: ${owner}/${repo}` };
      if (r.status === 403) return { ok: false, error: "github rate limit — set GITHUB_TOKEN env" };
      if (!r.ok) throw new Error(`github ${r.status}`);
      const data = await r.json();
      const totalBytes = Object.values(data).reduce((s, v) => s + v, 0);
      const languages = Object.entries(data)
        .map(([lang, bytes]) => ({
          language: lang,
          bytes,
          percent: totalBytes > 0 ? Math.round((bytes / totalBytes) * 10000) / 100 : 0,
        }))
        .sort((a, b) => b.bytes - a.bytes);
      return {
        ok: true,
        result: { owner, repo, languages, totalBytes, primaryLanguage: languages[0]?.language, source: "github-api" },
      };
    } catch (e) {
      return { ok: false, error: `github unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
