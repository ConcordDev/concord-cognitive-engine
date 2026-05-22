// server/domains/repos.js
// Domain actions for repository/code management: code complexity
// analysis, commit pattern analysis, dependency tree auditing, plus
// real GitHub API lookups (commits, issues, language breakdown).
// Free at 60 req/hr; GITHUB_TOKEN env raises to 5000/hr.

const GITHUB_API_REPOS = "https://api.github.com";

export default function registerReposActions(registerLensAction) {
  /**
   * codeComplexity
   * Compute code complexity metrics — cyclomatic complexity, cognitive complexity,
   * dependency depth, and coupling/cohesion ratios.
   * artifact.data.modules = [{ name, functions: [{ name, branches, nesting, lines, loops, conditions, dependencies?: [string] }], imports?: [string], exports?: [string] }]
   */
  registerLensAction("repos", "codeComplexity", (ctx, artifact, params) => {
    const modules = artifact.data?.modules || [];
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
  });

  /**
   * commitAnalysis
   * Analyze commit patterns — frequency, size distribution, bus factor,
   * and hotspot detection.
   * artifact.data.commits = [{ hash, author, date, files: [string], additions?, deletions?, message? }]
   */
  registerLensAction("repos", "commitAnalysis", (ctx, artifact, params) => {
    const commits = artifact.data?.commits || [];
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
  });

  /**
   * dependencyAudit
   * Audit dependency tree — depth analysis, duplicate detection, vulnerability
   * surface area, and update freshness scoring.
   * artifact.data.dependencies = [{ name, version, latestVersion?, lastUpdated?, depth?, children?: [string], vulnerabilities?: number, license?, size?: number }]
   */
  registerLensAction("repos", "dependencyAudit", (ctx, artifact, params) => {
    const dependencies = artifact.data?.dependencies || [];
    if (dependencies.length === 0) {
      return { ok: true, result: { message: "No dependencies to audit." } };
    }

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
          total: totalVulnerabilities,
          affectedDeps: vulnDeps.length,
          surfaceArea: r(vulnSurfaceArea),
          details: vulnDetails.slice(0, 10),
        },
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
  });

  function ghHeaders() {
    const token = process.env.GITHUB_TOKEN;
    return token
      ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
      : { Accept: "application/vnd.github+json" };
  }

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

  function rpFindRepo(s, uid, repoId) {
    return (s.repos.get(uid) || []).find((r) => r.id === repoId) || null;
  }
  // Seed a fresh repo with a tiny but real file tree + main branch.
  function rpSeedRepo(name, description, language) {
    const ts = rpNow();
    const c0 = { sha: rpSha(), message: "Initial commit", author: "you", branch: "main", parents: [], date: ts, additions: 12, deletions: 0 };
    return {
      id: rpId("repo"),
      name: name || "untitled-repo",
      description: description || "",
      language: language || "TypeScript",
      isPrivate: false,
      stars: 0,
      defaultBranch: "main",
      createdAt: ts,
      updatedAt: ts,
      files: [
        { path: "README.md", type: "file", content: `# ${name || "untitled-repo"}\n\n${description || "A Concord repository."}\n`, size: 64 },
        { path: "package.json", type: "file", content: `{\n  "name": "${name || "untitled-repo"}",\n  "version": "0.1.0"\n}\n`, size: 48 },
        { path: "src/index.ts", type: "file", content: "export function main(): void {\n  console.log('hello');\n}\n", size: 58 },
        { path: "src/util.ts", type: "file", content: "export const noop = (): void => {};\n", size: 36 },
      ],
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
  // Naive line diff between two text blobs.
  function rpDiff(oldText, newText) {
    const a = (oldText || "").split("\n");
    const b = (newText || "").split("\n");
    const out = [];
    const max = Math.max(a.length, b.length);
    let additions = 0, deletions = 0;
    for (let i = 0; i < max; i++) {
      if (i >= a.length) { out.push({ type: "add", line: b[i] }); additions++; }
      else if (i >= b.length) { out.push({ type: "del", line: a[i] }); deletions++; }
      else if (a[i] === b[i]) { out.push({ type: "ctx", line: a[i] }); }
      else { out.push({ type: "del", line: a[i] }); out.push({ type: "add", line: b[i] }); deletions++; additions++; }
    }
    return { hunks: out, additions, deletions };
  }
  const LANG_EXT = { ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript", py: "Python", rs: "Rust", go: "Go", json: "JSON", md: "Markdown", css: "CSS", html: "HTML" };
  const rpLangOf = (path) => LANG_EXT[(path.split(".").pop() || "").toLowerCase()] || "Text";

  // ── Repo lifecycle ─────────────────────────────────────────────────
  registerLensAction("repos", "repo-create", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const name = rpClean(params.name, 100);
      if (!name) return { ok: false, error: "name required" };
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
      return {
        ok: true,
        result: {
          repoId: repo.id, branch: rpClean(params.branch, 80) || repo.defaultBranch,
          tree: rpBuildTree(repo.files), fileCount: repo.files.length,
        },
      };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  registerLensAction("repos", "file-read", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const file = repo.files.find((f) => f.path === rpClean(params.path, 300));
      if (!file) return { ok: false, error: "file not found" };
      const content = file.content || "";
      return {
        ok: true,
        result: {
          path: file.path, content, language: rpLangOf(file.path),
          lineCount: content.split("\n").length, size: file.size || content.length,
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
      const content = String(params.content == null ? "" : params.content).slice(0, 200000);
      let file = repo.files.find((f) => f.path === path);
      const oldContent = file ? file.content || "" : "";
      if (file) { file.content = content; file.size = content.length; }
      else { file = { path, type: "file", content, size: content.length }; repo.files.push(file); }
      const diff = rpDiff(oldContent, content);
      const branch = repo.branches.find((b) => b.name === (rpClean(params.branch, 80) || repo.defaultBranch));
      const commit = {
        sha: rpSha(), message: rpClean(params.message, 200) || `Update ${path}`,
        author: "you", branch: branch ? branch.name : repo.defaultBranch,
        parents: branch ? [branch.head] : [], date: rpNow(),
        additions: diff.additions, deletions: diff.deletions, files: [path],
      };
      repo.commits.push(commit);
      if (branch) branch.head = commit.sha;
      repo.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { saved: true, commit: { sha: commit.sha, additions: diff.additions, deletions: diff.deletions } } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ── [S] Branch + tag management, commit history graph ──────────────
  registerLensAction("repos", "branch-list", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const branches = repo.branches.map((b) => ({
        name: b.name, head: b.head, protected: !!b.protected,
        isDefault: b.name === repo.defaultBranch,
        commits: repo.commits.filter((c) => c.branch === b.name).length,
        createdAt: b.createdAt,
      }));
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
      return { ok: true, result: { issue } };
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
      const head = rpClean(params.head, 80);
      const base = rpClean(params.base, 80) || repo.defaultBranch;
      if (!head) return { ok: false, error: "head branch required" };
      if (!repo.branches.some((b) => b.name === head)) return { ok: false, error: "head branch not found" };
      if (head === base) return { ok: false, error: "head and base must differ" };
      const number = (repo.issues.reduce((m, i) => Math.max(m, i.number), 0)) +
        (repo.pulls.reduce((m, p) => Math.max(m, p.number), 0)) + 1;
      const headCommits = repo.commits.filter((c) => c.branch === head);
      const pull = {
        id: rpId("pr"), number, title, body: rpClean(params.body, 4000),
        state: "open", base, head, author: "you",
        commits: headCommits.map((c) => c.sha),
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
      // Diff = files touched by head-branch commits.
      const touched = new Set();
      for (const c of repo.commits) {
        if (pull.commits.includes(c.sha)) for (const f of (c.files || [])) touched.add(f);
      }
      const fileDiffs = [...touched].map((path) => {
        const file = repo.files.find((f) => f.path === path);
        const diff = rpDiff("", file ? file.content || "" : "");
        return { path, language: rpLangOf(path), additions: diff.additions, deletions: 0, hunks: diff.hunks.slice(0, 200) };
      });
      const additions = fileDiffs.reduce((s2, d) => s2 + d.additions, 0);
      const approvals = pull.reviews.filter((rv) => rv.verdict === "approve").length;
      const changesRequested = pull.reviews.filter((rv) => rv.verdict === "request-changes").length;
      return {
        ok: true,
        result: {
          pull: {
            number: pull.number, title: pull.title, body: pull.body, state: pull.state,
            base: pull.base, head: pull.head, author: pull.author, createdAt: pull.createdAt,
          },
          diff: { files: fileDiffs, additions, deletions: 0, fileCount: fileDiffs.length },
          reviews: pull.reviews, comments: pull.comments,
          mergeable: pull.state === "open" && changesRequested === 0,
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

  registerLensAction("repos", "pull-merge", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const pull = repo.pulls.find((p) => p.number === rpNum(params.number, -1));
      if (!pull) return { ok: false, error: "pull not found" };
      if (pull.state !== "open") return { ok: false, error: `pull is ${pull.state}` };
      if (pull.reviews.some((rv) => rv.verdict === "request-changes")) {
        return { ok: false, error: "changes requested — cannot merge" };
      }
      const baseBranch = repo.branches.find((b) => b.name === pull.base);
      const headBranch = repo.branches.find((b) => b.name === pull.head);
      const mergeSha = rpSha();
      repo.commits.push({
        sha: mergeSha, message: `Merge pull request #${pull.number}: ${pull.title}`,
        author: "you", branch: pull.base,
        parents: [baseBranch?.head, headBranch?.head].filter(Boolean),
        date: rpNow(), additions: 0, deletions: 0, files: [], merge: true,
      });
      if (baseBranch) baseBranch.head = mergeSha;
      pull.state = "merged";
      pull.mergedAt = rpNow();
      pull.mergeCommit = mergeSha;
      pull.updatedAt = rpNow();
      repo.updatedAt = rpNow();
      rpSave();
      return { ok: true, result: { merged: true, mergeCommit: mergeSha, number: pull.number } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  // ── [M] Actions / CI run logs ──────────────────────────────────────
  const RP_CI_STEPS = [
    { name: "Checkout", logs: ["Fetching repository…", "Checked out HEAD"] },
    { name: "Setup", logs: ["Installing toolchain…", "Cache restored"] },
    { name: "Install dependencies", logs: ["Resolving packages…", "Installed in 4.2s"] },
    { name: "Lint", logs: ["Running eslint…", "0 errors, 0 warnings"] },
    { name: "Test", logs: ["Running test suite…", "All tests passed"] },
    { name: "Build", logs: ["Compiling…", "Build artifact produced"] },
  ];
  registerLensAction("repos", "workflow-run", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      const branch = rpClean(params.branch, 80) || repo.defaultBranch;
      const branchObj = repo.branches.find((b) => b.name === branch);
      // Deterministic-ish outcome: fail if last commit deleted lines heavily.
      const lastCommit = repo.commits.filter((c) => c.branch === branch).slice(-1)[0];
      const failStep = (lastCommit && lastCommit.deletions > 40) ? 4 : -1;
      const steps = RP_CI_STEPS.map((st, i) => {
        let conclusion = "success";
        if (failStep >= 0 && i === failStep) conclusion = "failure";
        else if (failStep >= 0 && i > failStep) conclusion = "skipped";
        const logs = conclusion === "failure"
          ? [...st.logs.slice(0, 1), "ERROR: step failed (exit 1)"]
          : conclusion === "skipped" ? ["Skipped"] : st.logs;
        return { name: st.name, conclusion, durationMs: 800 + i * 350, logs };
      });
      const run = {
        id: rpId("run"),
        number: repo.workflowRuns.length + 1,
        workflow: rpClean(params.workflow, 80) || "CI",
        branch, headSha: branchObj ? branchObj.head : null,
        status: "completed",
        conclusion: failStep >= 0 ? "failure" : "success",
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

  // ── [S] Security tab — Dependabot + code scanning ──────────────────
  const RP_VULN_DB = [
    { pkg: "lodash", version: "4.17.11", severity: "high", advisory: "Prototype pollution (CVE-2019-10744)", fixed: "4.17.12" },
    { pkg: "minimist", version: "1.2.0", severity: "moderate", advisory: "Prototype pollution (CVE-2020-7598)", fixed: "1.2.3" },
    { pkg: "node-fetch", version: "2.6.0", severity: "high", advisory: "Information exposure (CVE-2022-0235)", fixed: "2.6.7" },
    { pkg: "ws", version: "7.0.0", severity: "critical", advisory: "ReDoS (CVE-2024-37890)", fixed: "7.5.10" },
    { pkg: "axios", version: "0.21.0", severity: "moderate", advisory: "SSRF (CVE-2021-3749)", fixed: "0.21.4" },
  ];
  const RP_SCAN_RULES = [
    { rx: /eval\s*\(/, rule: "no-eval", severity: "high", message: "Use of eval() — code injection risk" },
    { rx: /password\s*=\s*['"][^'"]+['"]/i, rule: "hardcoded-secret", severity: "critical", message: "Hardcoded credential detected" },
    { rx: /innerHTML\s*=/, rule: "no-inner-html", severity: "moderate", message: "Direct innerHTML assignment — XSS risk" },
    { rx: /http:\/\//, rule: "insecure-transport", severity: "low", message: "Insecure http:// URL" },
    { rx: /TODO|FIXME/, rule: "tracked-debt", severity: "low", message: "Unresolved TODO/FIXME marker" },
  ];
  registerLensAction("repos", "security-scan", (ctx, _a, params = {}) => {
    try {
      const s = rpState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const repo = rpFindRepo(s, rpUid(ctx), params.repoId);
      if (!repo) return { ok: false, error: "repo not found" };
      // Dependabot alerts — parse package.json deps and match the vuln DB.
      const pkgFile = repo.files.find((f) => f.path === "package.json");
      let depVersions = {};
      if (pkgFile) {
        try {
          const parsed = JSON.parse(pkgFile.content || "{}");
          depVersions = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
        } catch (_e) { /* malformed package.json — no dependency alerts */ }
      }
      const dependabot = [];
      for (const [name, ver] of Object.entries(depVersions)) {
        const clean = String(ver).replace(/^[^0-9]*/, "");
        const hit = RP_VULN_DB.find((v) => v.pkg === name && v.version === clean);
        if (hit) dependabot.push({ kind: "dependency", package: name, version: clean, severity: hit.severity, summary: hit.advisory, fixedIn: hit.fixed });
      }
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
        langBytes[lang] = (langBytes[lang] || 0) + (f.size || (f.content || "").length);
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
