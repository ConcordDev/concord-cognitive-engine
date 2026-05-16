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
