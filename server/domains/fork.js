// server/domains/fork.js
// Domain actions for forking/branching: divergence analysis with
// Levenshtein edit distance, merge complexity estimation, fork health
// scoring, plus real GitHub API lookups (forks of a repo, repo
// metadata). GitHub public-API endpoints are free without
// authentication at 60 req/hr; set GITHUB_TOKEN env to raise to
// 5000/hr.

const GITHUB_API = "https://api.github.com";

export default function registerForkActions(registerLensAction) {
  /**
   * divergenceAnalysis
   * Compute Levenshtein edit distance between forked text versions, identify
   * conflicting change regions, and measure divergence.
   * artifact.data.base = { files: { [path]: content } }
   * artifact.data.forkA = { files: { [path]: content }, lastSyncTimestamp? }
   * artifact.data.forkB = { files: { [path]: content }, lastSyncTimestamp? }
   */
  registerLensAction("fork", "divergenceAnalysis", (ctx, artifact, params) => {
  try {
    const base = artifact.data?.base || {};
    const forkA = artifact.data?.forkA || {};
    const forkB = artifact.data?.forkB || {};
    const baseFiles = base.files || {};
    const filesA = forkA.files || {};
    const filesB = forkB.files || {};

    const allPaths = new Set([
      ...Object.keys(baseFiles),
      ...Object.keys(filesA),
      ...Object.keys(filesB),
    ]);

    // Levenshtein edit distance (bounded to avoid O(n^2) blow-up on large content)
    function levenshtein(a, b) {
      if (a === b) return 0;
      if (!a) return (b || "").length;
      if (!b) return (a || "").length;
      const maxLen = 500;
      const sa = a.length > maxLen ? a.substring(0, maxLen) : a;
      const sb = b.length > maxLen ? b.substring(0, maxLen) : b;
      const m = sa.length;
      const n = sb.length;
      let prev = Array.from({ length: n + 1 }, (_, i) => i);
      for (let i = 1; i <= m; i++) {
        const curr = [i];
        for (let j = 1; j <= n; j++) {
          curr[j] = sa[i - 1] === sb[j - 1]
            ? prev[j - 1]
            : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
        }
        prev = curr;
      }
      return prev[n];
    }

    // Identify conflicting change regions by comparing line-level changes
    function findConflictRegions(baseText, textA, textB) {
      const baseLines = (baseText || "").split("\n");
      const linesA = (textA || "").split("\n");
      const linesB = (textB || "").split("\n");
      const maxLine = Math.max(baseLines.length, linesA.length, linesB.length);
      const regions = [];
      let regionStart = null;

      for (let i = 0; i < maxLine; i++) {
        const bLine = baseLines[i] || "";
        const aLine = linesA[i] || "";
        const bLine2 = linesB[i] || "";
        const aChanged = aLine !== bLine;
        const bChanged = bLine2 !== bLine;
        const isConflict = aChanged && bChanged && aLine !== bLine2;

        if (isConflict) {
          if (regionStart === null) regionStart = i;
        } else {
          if (regionStart !== null) {
            regions.push({ startLine: regionStart, endLine: i - 1, lines: i - regionStart });
            regionStart = null;
          }
        }
      }
      if (regionStart !== null) {
        regions.push({ startLine: regionStart, endLine: maxLine - 1, lines: maxLine - regionStart });
      }
      return regions;
    }

    const fileAnalysis = [];
    let totalConflicts = 0;

    for (const path of allPaths) {
      const inBase = path in baseFiles;
      const inA = path in filesA;
      const inB = path in filesB;
      const baseContent = baseFiles[path] || "";
      const contentA = filesA[path] || "";
      const contentB = filesB[path] || "";

      let status;
      let conflict = false;

      if (inA && inB && !inBase) {
        conflict = contentA !== contentB;
        status = conflict ? "both_added_conflict" : "both_added_same";
      } else if (!inA && !inB && inBase) {
        status = "both_deleted";
      } else if (inA && !inB && inBase) {
        conflict = contentA !== baseContent;
        status = "deleted_in_b";
      } else if (!inA && inB && inBase) {
        conflict = contentB !== baseContent;
        status = "deleted_in_a";
      } else if (inA && inB && inBase) {
        const aChanged = contentA !== baseContent;
        const bChanged = contentB !== baseContent;
        if (aChanged && bChanged) {
          conflict = contentA !== contentB;
          status = conflict ? "both_modified_conflict" : "both_modified_same";
        } else if (aChanged) {
          status = "modified_in_a";
        } else if (bChanged) {
          status = "modified_in_b";
        } else {
          status = "unchanged";
        }
      } else if (inA && !inB && !inBase) {
        status = "added_in_a";
      } else if (!inA && inB && !inBase) {
        status = "added_in_b";
      } else {
        status = "unchanged";
      }

      if (conflict) totalConflicts++;

      const editDistanceAB = contentA !== contentB ? levenshtein(contentA, contentB) : 0;
      const editDistFromBaseA = inBase && inA ? levenshtein(baseContent, contentA) : 0;
      const editDistFromBaseB = inBase && inB ? levenshtein(baseContent, contentB) : 0;

      const conflictRegions = conflict && inBase
        ? findConflictRegions(baseContent, contentA, contentB)
        : [];

      fileAnalysis.push({
        path,
        status,
        conflict,
        editDistanceAB,
        editDistFromBaseA,
        editDistFromBaseB,
        conflictRegions,
        sizeA: contentA.length,
        sizeB: contentB.length,
        sizeBase: baseContent.length,
      });
    }

    fileAnalysis.sort((a, b) => b.editDistanceAB - a.editDistanceAB);

    // Overall divergence score (0-100)
    const totalEditDist = fileAnalysis.reduce((s, f) => s + f.editDistanceAB, 0);
    const totalBaseSize = Object.values(baseFiles).reduce((s, c) => s + c.length, 0) || 1;
    const divergenceRatio = Math.min(1, totalEditDist / totalBaseSize);
    const divergenceScore = Math.round(divergenceRatio * 100);

    // Divergence rate per day if timestamps available
    let divergenceRatePerDay = null;
    const syncA = forkA.lastSyncTimestamp ? new Date(forkA.lastSyncTimestamp).getTime() : null;
    const syncB = forkB.lastSyncTimestamp ? new Date(forkB.lastSyncTimestamp).getTime() : null;
    if (syncA && syncB) {
      const daysSinceSync = Math.max(
        (Date.now() - syncA) / 86400000,
        (Date.now() - syncB) / 86400000
      );
      if (daysSinceSync > 0) {
        divergenceRatePerDay = Math.round((totalEditDist / daysSinceSync) * 100) / 100;
      }
    }

    return {
      ok: true,
      result: {
        files: fileAnalysis.slice(0, 50),
        summary: {
          totalFiles: allPaths.size,
          conflictingFiles: totalConflicts,
          modifiedInA: fileAnalysis.filter((f) => f.status.includes("modified_in_a") || f.status.includes("both_modified")).length,
          modifiedInB: fileAnalysis.filter((f) => f.status.includes("modified_in_b") || f.status.includes("both_modified")).length,
          addedInA: fileAnalysis.filter((f) => f.status === "added_in_a" || f.status.includes("both_added")).length,
          addedInB: fileAnalysis.filter((f) => f.status === "added_in_b" || f.status.includes("both_added")).length,
          unchanged: fileAnalysis.filter((f) => f.status === "unchanged").length,
        },
        divergence: {
          score: divergenceScore,
          level: divergenceScore > 70 ? "severe" : divergenceScore > 40 ? "moderate" : divergenceScore > 10 ? "mild" : "minimal",
          totalEditDistance: totalEditDist,
          divergenceRatePerDay,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * mergeComplexity
   * Count conflicting regions, dependency overlap, and estimate merge effort score.
   * artifact.data.changes = [{ file, regions: [{ startLine, endLine, author }], dependencies?: [string] }]
   */
  registerLensAction("fork", "mergeComplexity", (ctx, artifact, params) => {
  try {
    const changes = artifact.data?.changes || [];
    if (changes.length === 0) {
      return { ok: true, result: { message: "No changes to analyze." } };
    }

    let totalConflicts = 0;
    let totalRegions = 0;
    let totalOverlapLines = 0;

    const fileAnalysis = changes.map((change) => {
      const regions = change.regions || [];
      totalRegions += regions.length;

      // Detect overlapping regions from different authors
      const conflicts = [];
      for (let i = 0; i < regions.length; i++) {
        for (let j = i + 1; j < regions.length; j++) {
          const a = regions[i];
          const b = regions[j];
          if (a.author === b.author) continue;

          const overlapStart = Math.max(a.startLine, b.startLine);
          const overlapEnd = Math.min(a.endLine, b.endLine);
          if (overlapStart <= overlapEnd) {
            const overlapLines = overlapEnd - overlapStart + 1;
            totalOverlapLines += overlapLines;
            totalConflicts++;
            conflicts.push({
              regionA: { startLine: a.startLine, endLine: a.endLine, author: a.author },
              regionB: { startLine: b.startLine, endLine: b.endLine, author: b.author },
              overlapLines,
              overlapRange: [overlapStart, overlapEnd],
            });
          }
        }
      }

      // Proximity conflicts: regions within 3 lines (semantic risk)
      const proximityConflicts = [];
      for (let i = 0; i < regions.length; i++) {
        for (let j = i + 1; j < regions.length; j++) {
          const a = regions[i];
          const b = regions[j];
          if (a.author === b.author) continue;
          const gap = Math.min(
            Math.abs(a.endLine - b.startLine),
            Math.abs(b.endLine - a.startLine)
          );
          if (gap > 0 && gap <= 3) {
            proximityConflicts.push({
              regionA: { startLine: a.startLine, endLine: a.endLine, author: a.author },
              regionB: { startLine: b.startLine, endLine: b.endLine, author: b.author },
              gapLines: gap,
            });
          }
        }
      }

      const fileScore = conflicts.length * 10 + proximityConflicts.length * 3;

      return {
        file: change.file,
        regionCount: regions.length,
        directConflicts: conflicts.length,
        proximityConflicts: proximityConflicts.length,
        conflictDetails: conflicts,
        proximityDetails: proximityConflicts,
        dependencies: change.dependencies || [],
        conflictScore: fileScore,
      };
    });

    // Dependency overlap: shared dependencies across files
    const depMap = {};
    for (const change of changes) {
      for (const dep of change.dependencies || []) {
        if (!depMap[dep]) depMap[dep] = [];
        depMap[dep].push(change.file);
      }
    }
    const sharedDeps = Object.entries(depMap)
      .filter(([, files]) => files.length > 1)
      .map(([dep, files]) => ({
        dependency: dep,
        sharedBy: files,
        risk: files.length > 2 ? "high" : "moderate",
      }));

    // Merge effort score (0-100)
    const conflictWeight = Math.min(40, totalConflicts * 10);
    const overlapWeight = Math.min(20, totalOverlapLines * 2);
    const depWeight = Math.min(20, sharedDeps.length * 5);
    const volumeWeight = Math.min(20, totalRegions * 0.5);
    const complexityScore = Math.min(100, Math.round(conflictWeight + overlapWeight + depWeight + volumeWeight));

    const complexityLevel = complexityScore >= 70 ? "very_hard"
      : complexityScore >= 45 ? "hard"
      : complexityScore >= 20 ? "moderate"
      : "easy";

    const estimatedHours = Math.round(complexityScore * 0.15 * 10) / 10;

    fileAnalysis.sort((a, b) => b.conflictScore - a.conflictScore);

    return {
      ok: true,
      result: {
        files: fileAnalysis,
        dependencyOverlap: sharedDeps,
        complexity: {
          score: complexityScore,
          level: complexityLevel,
          estimatedMergeHours: estimatedHours,
          breakdown: {
            directConflicts: conflictWeight,
            overlapVolume: overlapWeight,
            dependencyRisk: depWeight,
            changeVolume: volumeWeight,
          },
        },
        summary: {
          totalFiles: changes.length,
          totalRegions,
          totalDirectConflicts: totalConflicts,
          totalOverlapLines,
          sharedDependencies: sharedDeps.length,
          autoMergeCandidate: totalConflicts === 0 && sharedDeps.length === 0,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * forkHealth
   * Score fork health based on sync freshness, divergence rate, and activity metrics.
   * artifact.data.fork = { name, createdAt, lastSyncAt?, lastCommitAt?, commitCount?,
   *   contributorCount?, openIssues?, upstream: { lastCommitAt?, commitCount? } }
   */
  registerLensAction("fork", "forkHealth", (ctx, artifact, params) => {
  try {
    const fork = artifact.data?.fork || {};
    const upstream = fork.upstream || {};
    const now = Date.now();

    const created = new Date(fork.createdAt || now).getTime();
    const lastSync = fork.lastSyncAt ? new Date(fork.lastSyncAt).getTime() : created;
    const lastCommit = fork.lastCommitAt ? new Date(fork.lastCommitAt).getTime() : created;
    const upstreamLastCommit = upstream.lastCommitAt
      ? new Date(upstream.lastCommitAt).getTime() : now;

    // Sync freshness: lose 2 points per day out of sync. Clamp elapsed days at
    // 0 so a fork synced "now" scores a full 100. The caller stamps the
    // timestamp a sub-ms (and, under load, a few-ms) before this handler reads
    // Date.now(), so (now - lastSync) is a tiny POSITIVE value — a bare
    // Math.max(0, …) clamp only neutralises the negative (future) case, leaving
    // syncFreshness at 99.999… and the score on the wrong side of the 86.5→87
    // rounding boundary. A 1-second grace window makes "synced now" deterministic.
    const FRESH_GRACE_MS = 1000;
    const daysSinceSync = Math.max(0, (now - lastSync - FRESH_GRACE_MS) / 86400000);
    const syncFreshness = Math.max(0, 100 - daysSinceSync * 2);

    // Activity: lose 1.5 points per day without commits (same now-grace clamp).
    const daysSinceCommit = Math.max(0, (now - lastCommit - FRESH_GRACE_MS) / 86400000);
    const activityScore = Math.max(0, 100 - daysSinceCommit * 1.5);

    // Divergence from upstream by commit count
    const forkCommits = fork.commitCount || 0;
    const upstreamCommits = upstream.commitCount || 0;
    const commitDivergence = upstreamCommits > 0
      ? Math.abs(forkCommits - upstreamCommits) / upstreamCommits : 0;
    const divergenceScore = Math.max(0, 100 - commitDivergence * 100);

    // Days behind upstream
    const daysBehindUpstream = upstreamLastCommit > lastSync
      ? (upstreamLastCommit - lastSync) / 86400000 : 0;

    // Community health
    const contributors = fork.contributorCount || 1;
    const communityScore = Math.min(100, contributors * 10);

    // Issue management
    const openIssues = fork.openIssues || 0;
    const issueScore = Math.max(0, 100 - openIssues * 5);

    // Weighted composite health score
    const healthScore = Math.round(
      syncFreshness * 0.3 +
      activityScore * 0.25 +
      divergenceScore * 0.2 +
      communityScore * 0.15 +
      issueScore * 0.1
    );

    const healthLevel = healthScore >= 80 ? "healthy"
      : healthScore >= 60 ? "moderate"
      : healthScore >= 40 ? "stale"
      : "abandoned";

    // Actionable recommendations
    const recommendations = [];
    if (daysSinceSync > 30) {
      recommendations.push(`Fork is ${Math.round(daysSinceSync)} days behind upstream — sync needed`);
    }
    if (daysSinceCommit > 60) {
      recommendations.push(`No commits in ${Math.round(daysSinceCommit)} days — fork may be abandoned`);
    }
    if (contributors <= 1) {
      recommendations.push("Single contributor — bus factor risk");
    }
    if (openIssues > 10) {
      recommendations.push(`${openIssues} open issues need attention`);
    }
    if (daysBehindUpstream > 7) {
      recommendations.push(`${Math.round(daysBehindUpstream)} days of upstream commits not synced`);
    }

    const ageInDays = (now - created) / 86400000;
    const commitVelocity = ageInDays > 0
      ? Math.round((forkCommits / ageInDays) * 100) / 100 : 0;

    return {
      ok: true,
      result: {
        name: fork.name || "unnamed",
        healthScore,
        healthLevel,
        factors: {
          syncFreshness: { score: Math.round(syncFreshness), daysSinceSync: Math.round(daysSinceSync * 10) / 10 },
          activity: { score: Math.round(activityScore), daysSinceCommit: Math.round(daysSinceCommit * 10) / 10 },
          divergence: { score: Math.round(divergenceScore), commitDivergenceRatio: Math.round(commitDivergence * 10000) / 100 },
          community: { score: Math.round(communityScore), contributors },
          issues: { score: Math.round(issueScore), openIssues },
        },
        upstreamTracking: {
          daysBehind: Math.round(daysBehindUpstream * 10) / 10,
          upstreamCommits,
          forkCommits,
        },
        velocity: {
          commitsPerDay: commitVelocity,
          ageInDays: Math.round(ageInDays),
        },
        recommendations,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * github-forks — List forks of a GitHub repo (real, live data).
   * Free, no token (60 req/hr); GITHUB_TOKEN env raises to 5000/hr.
   *
   * params: { owner: string, repo: string, sort?: "newest"|"oldest"|"stargazers", limit?: 1-100 }
   */
  registerLensAction("fork", "github-forks", async (_ctx, _artifact, params = {}) => {
    const owner = String(params.owner || "").trim();
    const repo = String(params.repo || "").trim();
    if (!owner || !repo) return { ok: false, error: "owner + repo required" };
    const sort = ["newest", "oldest", "stargazers"].includes(params.sort) ? params.sort : "newest";
    const perPage = Math.max(1, Math.min(100, Number(params.limit) || 30));
    const token = process.env.GITHUB_TOKEN;
    const headers = token ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } : { Accept: "application/vnd.github+json" };
    try {
      const r = await fetch(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/forks?sort=${sort}&per_page=${perPage}`, { headers });
      if (r.status === 404) return { ok: false, error: `repo not found: ${owner}/${repo}` };
      if (r.status === 403) return { ok: false, error: "github rate limit exceeded — set GITHUB_TOKEN env" };
      if (!r.ok) throw new Error(`github ${r.status}`);
      const data = await r.json();
      const forks = (Array.isArray(data) ? data : []).map((f) => ({
        id: f.id,
        fullName: f.full_name,
        owner: f.owner?.login,
        ownerType: f.owner?.type,
        htmlUrl: f.html_url,
        description: f.description,
        stargazers: f.stargazers_count,
        watchers: f.watchers_count,
        forks: f.forks_count,
        openIssues: f.open_issues_count,
        defaultBranch: f.default_branch,
        language: f.language,
        license: f.license?.spdx_id,
        archived: f.archived,
        disabled: f.disabled,
        pushedAt: f.pushed_at,
        createdAt: f.created_at,
        updatedAt: f.updated_at,
      }));
      return {
        ok: true,
        result: {
          owner, repo, sort,
          forks, count: forks.length,
          authenticated: !!token,
          source: "github-api",
        },
      };
    } catch (e) {
      return { ok: false, error: `github unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * github-repo — Full metadata for a GitHub repo (stars, forks,
   * issues, language, default branch, license, push freshness).
   */
  registerLensAction("fork", "github-repo", async (_ctx, _artifact, params = {}) => {
    const owner = String(params.owner || "").trim();
    const repo = String(params.repo || "").trim();
    if (!owner || !repo) return { ok: false, error: "owner + repo required" };
    const token = process.env.GITHUB_TOKEN;
    const headers = token ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } : { Accept: "application/vnd.github+json" };
    try {
      const r = await fetch(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers });
      if (r.status === 404) return { ok: false, error: `repo not found: ${owner}/${repo}` };
      if (r.status === 403) return { ok: false, error: "github rate limit exceeded — set GITHUB_TOKEN env" };
      if (!r.ok) throw new Error(`github ${r.status}`);
      const r2 = await r.json();
      return {
        ok: true,
        result: {
          fullName: r2.full_name,
          owner: r2.owner?.login,
          description: r2.description,
          htmlUrl: r2.html_url,
          stargazers: r2.stargazers_count,
          watchers: r2.watchers_count,
          forks: r2.forks_count,
          openIssues: r2.open_issues_count,
          size: r2.size,
          defaultBranch: r2.default_branch,
          language: r2.language,
          topics: r2.topics,
          license: r2.license?.spdx_id,
          licenseUrl: r2.license?.url,
          archived: r2.archived,
          disabled: r2.disabled,
          isFork: r2.fork,
          parent: r2.parent ? r2.parent.full_name : null,
          pushedAt: r2.pushed_at,
          createdAt: r2.created_at,
          updatedAt: r2.updated_at,
          source: "github-api",
        },
      };
    } catch (e) {
      return { ok: false, error: `github unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Repo-watchlist substrate (per-user, STATE-backed) ──────────────
  function getForkState() {
    const STATE = globalThis._concordSTATE; if (!STATE) return null;
    if (!STATE.forkLens) STATE.forkLens = {};
    if (!(STATE.forkLens.repos instanceof Map)) STATE.forkLens.repos = new Map();
    if (!(STATE.forkLens.feedSeen instanceof Set)) STATE.forkLens.feedSeen = new Set();
    return STATE.forkLens;
  }
  function saveFork() { if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* */ } } }
  const fkId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const fkActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const fkClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const fkRepos = (s, u) => { if (!s.repos.has(u)) s.repos.set(u, []); return s.repos.get(u); };

  registerLensAction("fork", "watch-add", (ctx, _a, params = {}) => {
  try {
    const s = getForkState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const fullName = fkClean(params.fullName, 160).replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return { ok: false, error: "fullName must be owner/repo" };
    const arr = fkRepos(s, fkActor(ctx));
    if (arr.some((r) => r.fullName.toLowerCase() === fullName.toLowerCase())) return { ok: false, error: "already watching" };
    const repo = { id: fkId("rw"), fullName, note: fkClean(params.note, 300) || "",
      reason: ["upstream", "fork", "competitor", "reference", "dependency"].includes(params.reason) ? params.reason : "reference",
      lastStars: null, lastPushedAt: null, createdAt: new Date().toISOString() };
    arr.push(repo); saveFork();
    return { ok: true, result: { repo } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("fork", "watch-list", (ctx, _a, _p = {}) => {
    const s = getForkState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const repos = fkRepos(s, fkActor(ctx));
    return { ok: true, result: { repos, count: repos.length } };
  });
  registerLensAction("fork", "watch-delete", (ctx, _a, params = {}) => {
    const s = getForkState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = fkRepos(s, fkActor(ctx));
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "repo not found" };
    arr.splice(i, 1); saveFork();
    return { ok: true, result: { deleted: params.id } };
  });
  registerLensAction("fork", "watch-refresh", async (ctx, _a, params = {}) => {
    const s = getForkState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const repo = fkRepos(s, fkActor(ctx)).find((r) => r.id === params.id);
    if (!repo) return { ok: false, error: "repo not found" };
    try {
      const r = await fetch(`${GITHUB_API}/repos/${repo.fullName}`, { headers: { "User-Agent": "concord-fork-lens", Accept: "application/vnd.github+json" } });
      if (!r.ok) return { ok: false, error: `github ${r.status}` };
      const d = await r.json();
      repo.lastStars = d.stargazers_count ?? null;
      repo.lastPushedAt = d.pushed_at ?? null;
      repo.openIssues = d.open_issues_count ?? null;
      repo.forks = d.forks_count ?? null;
      saveFork();
      return { ok: true, result: { repo } };
    } catch (e) { return { ok: false, error: `github unreachable: ${e instanceof Error ? e.message : String(e)}` }; }
  });
  registerLensAction("fork", "watch-dashboard", (ctx, _a, _p = {}) => {
    const s = getForkState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const repos = fkRepos(s, fkActor(ctx));
    const byReason = {};
    for (const r of repos) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
    return { ok: true, result: { repos: repos.length, totalStars: repos.reduce((n, r) => n + (r.lastStars || 0), 0),
      refreshed: repos.filter((r) => r.lastPushedAt).length, byReason } };
  });

  // ─── GitHub helpers shared by the parity backlog macros ─────────────
  function ghHeaders() {
    const token = process.env.GITHUB_TOKEN;
    return token
      ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "concord-fork-lens" }
      : { Accept: "application/vnd.github+json", "User-Agent": "concord-fork-lens" };
  }
  function normRepo(v) {
    return fkClean(v, 160).replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/$/, "");
  }
  async function ghFetch(path) {
    const r = await fetch(`${GITHUB_API}${path}`, { headers: ghHeaders() });
    if (r.status === 404) return { err: "not found" };
    if (r.status === 403) return { err: "github rate limit exceeded — set GITHUB_TOKEN env" };
    if (r.status === 422) return { err: "github could not process the comparison" };
    if (!r.ok) return { err: `github ${r.status}` };
    return { data: await r.json() };
  }

  /**
   * commitCompare — commit-level ahead/behind comparison between a fork
   * and its parent (or any two refs). Uses GitHub's compare API:
   * GET /repos/{base}/compare/{base-owner}:{base-branch}...{head-owner}:{head-branch}
   * params: { baseRepo, headRepo, baseRef?, headRef? }
   */
  registerLensAction("fork", "commitCompare", async (_ctx, _a, params = {}) => {
    const baseRepo = normRepo(params.baseRepo);
    const headRepo = normRepo(params.headRepo);
    if (!/^[\w.-]+\/[\w.-]+$/.test(baseRepo)) return { ok: false, error: "baseRepo must be owner/repo" };
    if (!/^[\w.-]+\/[\w.-]+$/.test(headRepo)) return { ok: false, error: "headRepo must be owner/repo" };
    const baseOwner = baseRepo.split("/")[0];
    const headOwner = headRepo.split("/")[0];
    const baseRef = fkClean(params.baseRef, 120) || "";
    const headRef = fkClean(params.headRef, 120) || "";
    try {
      // Resolve default branches when refs are not supplied.
      let bRef = baseRef, hRef = headRef;
      if (!bRef || !hRef) {
        const meta = await ghFetch(`/repos/${baseRepo}`);
        if (meta.err) return { ok: false, error: meta.err };
        if (!bRef) bRef = meta.data.default_branch || "main";
        if (!hRef) {
          const hMeta = headRepo === baseRepo ? meta : await ghFetch(`/repos/${headRepo}`);
          if (hMeta.err) return { ok: false, error: hMeta.err };
          hRef = hMeta.data.default_branch || "main";
        }
      }
      const cmp = await ghFetch(`/repos/${baseRepo}/compare/${baseOwner}:${encodeURIComponent(bRef)}...${headOwner}:${encodeURIComponent(hRef)}`);
      if (cmp.err) return { ok: false, error: cmp.err };
      const d = cmp.data || {};
      const files = (Array.isArray(d.files) ? d.files : []).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions || 0,
        deletions: f.deletions || 0,
        changes: f.changes || 0,
      }));
      const commits = (Array.isArray(d.commits) ? d.commits : []).map((c) => ({
        sha: (c.sha || "").slice(0, 10),
        message: String(c.commit?.message || "").split("\n")[0].slice(0, 140),
        author: c.commit?.author?.name || c.author?.login || "unknown",
        date: c.commit?.author?.date || null,
      }));
      const totalAdds = files.reduce((s, f) => s + f.additions, 0);
      const totalDels = files.reduce((s, f) => s + f.deletions, 0);
      return {
        ok: true,
        result: {
          baseRepo, headRepo, baseRef: bRef, headRef: hRef,
          status: d.status || "unknown",
          aheadBy: d.ahead_by || 0,
          behindBy: d.behind_by || 0,
          totalCommits: d.total_commits || 0,
          filesChanged: files.length,
          additions: totalAdds,
          deletions: totalDels,
          netLines: totalAdds - totalDels,
          files: files.slice(0, 100),
          commits: commits.slice(0, 50),
          source: "github-api",
        },
      };
    } catch (e) {
      return { ok: false, error: `github unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * pullRequests — open/closed/merged PR status for a repo, suitable for
   * overlaying PR state onto the fork network.
   * params: { fullName, state?: open|closed|all, limit?: 1-100 }
   */
  registerLensAction("fork", "pullRequests", async (_ctx, _a, params = {}) => {
    const fullName = normRepo(params.fullName);
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return { ok: false, error: "fullName must be owner/repo" };
    const state = ["open", "closed", "all"].includes(params.state) ? params.state : "open";
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 30));
    try {
      const r = await ghFetch(`/repos/${fullName}/pulls?state=${state}&per_page=${limit}&sort=updated&direction=desc`);
      if (r.err) return { ok: false, error: r.err };
      const list = Array.isArray(r.data) ? r.data : [];
      const prs = list.map((p) => ({
        number: p.number,
        title: String(p.title || "").slice(0, 200),
        author: p.user?.login || "unknown",
        state: p.merged_at ? "merged" : p.state,
        draft: !!p.draft,
        headRepo: p.head?.repo?.full_name || null,
        headRef: p.head?.ref || null,
        baseRef: p.base?.ref || null,
        htmlUrl: p.html_url,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        mergedAt: p.merged_at || null,
        comments: p.comments || 0,
      }));
      const counts = { open: 0, closed: 0, merged: 0 };
      for (const p of prs) counts[p.state] = (counts[p.state] || 0) + 1;
      // PR-by-fork index: which fork repos have outstanding PRs into this repo.
      const byFork = {};
      for (const p of prs) {
        if (!p.headRepo || p.headRepo === fullName) continue;
        if (!byFork[p.headRepo]) byFork[p.headRepo] = { open: 0, merged: 0, closed: 0, total: 0 };
        byFork[p.headRepo][p.state] = (byFork[p.headRepo][p.state] || 0) + 1;
        byFork[p.headRepo].total++;
      }
      return {
        ok: true,
        result: {
          fullName, state, count: prs.length, counts,
          forkContributions: Object.entries(byFork).map(([repo, c]) => ({ repo, ...c })),
          pullRequests: prs,
          source: "github-api",
        },
      };
    } catch (e) {
      return { ok: false, error: `github unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * networkGraph — commits-over-time across the parent + its top forks,
   * shaped for a GitHub-style network graph (per-fork commit timeline,
   * weekly buckets). Uses the per-repo participation/commit-activity API.
   * params: { owner, repo, limitForks?: 1-15 }
   */
  registerLensAction("fork", "networkGraph", async (_ctx, _a, params = {}) => {
    const owner = String(params.owner || "").trim();
    const repo = String(params.repo || "").trim();
    if (!owner || !repo) return { ok: false, error: "owner + repo required" };
    const fullName = `${owner}/${repo}`;
    const limitForks = Math.max(1, Math.min(15, Number(params.limitForks) || 8));
    try {
      const forksRes = await ghFetch(`/repos/${fullName}/forks?sort=stargazers&per_page=${limitForks}`);
      if (forksRes.err) return { ok: false, error: forksRes.err };
      const forkList = (Array.isArray(forksRes.data) ? forksRes.data : []).map((f) => f.full_name);
      const repos = [fullName, ...forkList];

      async function weeklyCommits(name) {
        // /stats/commit_activity → 52 weeks of { week, total }
        const r = await ghFetch(`/repos/${name}/stats/commit_activity`);
        if (r.err || !Array.isArray(r.data)) return null;
        return r.data.map((w) => ({ week: w.week, total: w.total || 0 }));
      }

      const series = [];
      for (const name of repos) {
        const weeks = await weeklyCommits(name);
        if (!weeks) { series.push({ repo: name, isParent: name === fullName, weeks: [], total: 0, available: false }); continue; }
        const total = weeks.reduce((s, w) => s + w.total, 0);
        series.push({ repo: name, isParent: name === fullName, weeks, total, available: true });
      }
      // Aggregate weekly buckets across all repos for the combined graph.
      const weekTotals = {};
      for (const s of series) {
        for (const w of s.weeks) weekTotals[w.week] = (weekTotals[w.week] || 0) + w.total;
      }
      const combined = Object.entries(weekTotals)
        .map(([week, total]) => ({ week: Number(week), total }))
        .sort((a, b) => a.week - b.week);
      const grandTotal = series.reduce((s, r) => s + r.total, 0);
      return {
        ok: true,
        result: {
          parent: fullName,
          forkCount: forkList.length,
          repos: series.sort((a, b) => b.total - a.total),
          combined,
          grandTotalCommits: grandTotal,
          source: "github-api",
        },
      };
    } catch (e) {
      return { ok: false, error: `github unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * staleForkScan — contributor activity / stale-fork detection across a
   * repo's fork network. Flags forks with no push in N days and forks
   * that have diverged but gone quiet.
   * params: { owner, repo, staleDays?: default 180, limit?: 1-100 }
   */
  registerLensAction("fork", "staleForkScan", async (_ctx, _a, params = {}) => {
    const owner = String(params.owner || "").trim();
    const repo = String(params.repo || "").trim();
    if (!owner || !repo) return { ok: false, error: "owner + repo required" };
    const staleDays = Math.max(1, Math.min(3650, Number(params.staleDays) || 180));
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 50));
    try {
      const r = await ghFetch(`/repos/${owner}/${repo}/forks?sort=newest&per_page=${limit}`);
      if (r.err) return { ok: false, error: r.err };
      const list = Array.isArray(r.data) ? r.data : [];
      const now = Date.now();
      const forks = list.map((f) => {
        const pushed = f.pushed_at ? new Date(f.pushed_at).getTime() : null;
        const daysSincePush = pushed != null ? Math.floor((now - pushed) / 86400000) : null;
        let band;
        if (f.archived || f.disabled) band = "archived";
        else if (daysSincePush == null) band = "unknown";
        else if (daysSincePush <= 30) band = "active";
        else if (daysSincePush <= staleDays) band = "slowing";
        else band = "stale";
        return {
          fullName: f.full_name,
          owner: f.owner?.login,
          htmlUrl: f.html_url,
          stargazers: f.stargazers_count || 0,
          openIssues: f.open_issues_count || 0,
          pushedAt: f.pushed_at || null,
          createdAt: f.created_at || null,
          daysSincePush,
          archived: !!f.archived,
          band,
        };
      });
      const counts = { active: 0, slowing: 0, stale: 0, archived: 0, unknown: 0 };
      for (const f of forks) counts[f.band]++;
      const alerts = forks
        .filter((f) => f.band === "stale" || f.band === "archived")
        .map((f) => ({
          fullName: f.fullName,
          severity: f.band === "archived" ? "info" : (f.daysSincePush || 0) > staleDays * 2 ? "high" : "warning",
          message: f.band === "archived"
            ? `${f.fullName} is archived — read-only fork`
            : `${f.fullName} has no push in ${f.daysSincePush} days`,
        }));
      const total = forks.length || 1;
      const healthPct = Math.round((counts.active / total) * 100);
      return {
        ok: true,
        result: {
          repo: `${owner}/${repo}`,
          staleDays,
          totalForks: forks.length,
          counts,
          networkHealthPct: healthPct,
          alerts,
          forks: forks.sort((a, b) => (b.daysSincePush ?? 1e9) - (a.daysSincePush ?? 1e9)),
          source: "github-api",
        },
      };
    } catch (e) {
      return { ok: false, error: `github unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * releases — release / tag tracking for a watched repo. Returns recent
   * releases (with assets) and lightweight tags.
   * params: { fullName, limit?: 1-50 }
   */
  registerLensAction("fork", "releases", async (_ctx, _a, params = {}) => {
    const fullName = normRepo(params.fullName);
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return { ok: false, error: "fullName must be owner/repo" };
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 15));
    try {
      const [relRes, tagRes] = await Promise.all([
        ghFetch(`/repos/${fullName}/releases?per_page=${limit}`),
        ghFetch(`/repos/${fullName}/tags?per_page=${limit}`),
      ]);
      if (relRes.err && tagRes.err) return { ok: false, error: relRes.err };
      const releases = (Array.isArray(relRes.data) ? relRes.data : []).map((r) => ({
        name: r.name || r.tag_name,
        tagName: r.tag_name,
        draft: !!r.draft,
        prerelease: !!r.prerelease,
        author: r.author?.login || null,
        publishedAt: r.published_at || null,
        createdAt: r.created_at || null,
        htmlUrl: r.html_url,
        bodyExcerpt: String(r.body || "").slice(0, 280),
        assets: (Array.isArray(r.assets) ? r.assets : []).map((a) => ({
          name: a.name, downloadCount: a.download_count || 0, size: a.size || 0,
        })),
      }));
      const tags = (Array.isArray(tagRes.data) ? tagRes.data : []).map((t) => ({
        name: t.name,
        sha: (t.commit?.sha || "").slice(0, 10),
      }));
      const latest = releases.find((r) => !r.draft && !r.prerelease) || releases[0] || null;
      const totalDownloads = releases.reduce(
        (s, r) => s + r.assets.reduce((a, x) => a + x.downloadCount, 0), 0);
      return {
        ok: true,
        result: {
          fullName,
          latest,
          releaseCount: releases.length,
          tagCount: tags.length,
          totalAssetDownloads: totalDownloads,
          releases,
          tags,
          source: "github-api",
        },
      };
    } catch (e) {
      return { ok: false, error: `github unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * fileDiff — cross-fork file-level diff browser. Fetches a single
   * file's content from two repos/refs and produces a line-level unified
   * diff (LCS-based) so a base fork and a head fork can be compared file
   * by file.
   * params: { baseRepo, headRepo, path, baseRef?, headRef? }
   */
  registerLensAction("fork", "fileDiff", async (_ctx, _a, params = {}) => {
    const baseRepo = normRepo(params.baseRepo);
    const headRepo = normRepo(params.headRepo);
    const path = fkClean(params.path, 400);
    if (!/^[\w.-]+\/[\w.-]+$/.test(baseRepo)) return { ok: false, error: "baseRepo must be owner/repo" };
    if (!/^[\w.-]+\/[\w.-]+$/.test(headRepo)) return { ok: false, error: "headRepo must be owner/repo" };
    if (!path) return { ok: false, error: "path required" };
    const baseRef = fkClean(params.baseRef, 120) || "";
    const headRef = fkClean(params.headRef, 120) || "";

    async function fetchFile(repo, ref) {
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      const r = await ghFetch(`/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}${q}`);
      if (r.err) return { err: r.err };
      const d = r.data;
      if (Array.isArray(d)) return { err: "path is a directory, not a file" };
      if (d.encoding === "base64" && typeof d.content === "string") {
        return { content: Buffer.from(d.content, "base64").toString("utf8"), size: d.size || 0 };
      }
      return { err: "file content unavailable" };
    }

    // Myers-style LCS line diff (bounded).
    function lineDiff(aText, bText) {
      const MAX = 2000;
      const a = aText.split("\n").slice(0, MAX);
      const b = bText.split("\n").slice(0, MAX);
      const m = a.length, n = b.length;
      const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
      for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
          dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
      const rows = [];
      let i = 0, j = 0;
      while (i < m && j < n) {
        if (a[i] === b[j]) { rows.push({ type: "context", text: a[i], aLine: i + 1, bLine: j + 1 }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: "del", text: a[i], aLine: i + 1, bLine: null }); i++; }
        else { rows.push({ type: "add", text: b[j], aLine: null, bLine: j + 1 }); j++; }
      }
      while (i < m) { rows.push({ type: "del", text: a[i], aLine: i + 1, bLine: null }); i++; }
      while (j < n) { rows.push({ type: "add", text: b[j], aLine: null, bLine: j + 1 }); j++; }
      return rows;
    }

    try {
      const [bf, hf] = await Promise.all([fetchFile(baseRepo, baseRef), fetchFile(headRepo, headRef)]);
      if (bf.err && hf.err) return { ok: false, error: bf.err };
      const baseContent = bf.err ? "" : bf.content;
      const headContent = hf.err ? "" : hf.content;
      const rows = lineDiff(baseContent, headContent);
      const additions = rows.filter((r) => r.type === "add").length;
      const deletions = rows.filter((r) => r.type === "del").length;
      const identical = additions === 0 && deletions === 0;
      return {
        ok: true,
        result: {
          baseRepo, headRepo, path,
          baseRef: baseRef || "default", headRef: headRef || "default",
          baseExists: !bf.err, headExists: !hf.err,
          additions, deletions,
          identical,
          rows: rows.slice(0, 1500),
          truncated: rows.length > 1500,
          source: "github-api",
        },
      };
    } catch (e) {
      return { ok: false, error: `github unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Live feed: a watched repo's recent public events → DTUs ────────
  registerLensAction("fork", "feed", async (ctx, _a, params = {}) => {
    const s = getForkState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const seen = s.feedSeen;
    const fullName = fkClean(params.fullName, 160).replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "") || "nodejs/node";
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return { ok: false, error: "fullName must be owner/repo" };
    try {
      const r = await fetch(`${GITHUB_API}/repos/${fullName}/events?per_page=20`, { headers: { "User-Agent": "concord-fork-lens", Accept: "application/vnd.github+json" } });
      if (!r.ok) return { ok: false, error: `github ${r.status}` };
      const events = await r.json();
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const ev of (Array.isArray(events) ? events : []).slice(0, 15)) {
        const id = ev.id;
        if (!id || seen.has(id)) { skipped++; continue; }
        const actor = ev.actor?.login || "someone";
        const kind = String(ev.type || "Event").replace(/Event$/, "");
        let detail = "";
        if (ev.payload?.commits) detail = ev.payload.commits.map((c) => `· ${String(c.message || "").split("\n")[0].slice(0, 100)}`).join("\n");
        else if (ev.payload?.action && ev.payload?.pull_request) detail = `PR #${ev.payload.pull_request.number} ${ev.payload.action}: ${ev.payload.pull_request.title || ""}`;
        else if (ev.payload?.action && ev.payload?.issue) detail = `Issue #${ev.payload.issue.number} ${ev.payload.action}: ${ev.payload.issue.title || ""}`;
        else if (ev.payload?.ref) detail = `${ev.payload.ref_type || "ref"} ${ev.payload.ref}`;
        const res = await ctx.macro.run("dtu", "create", {
          title: `${kind} on ${fullName} by ${actor}`,
          creti: `Repository: ${fullName}\nEvent: ${ev.type}\nActor: ${actor}\nWhen: ${ev.created_at || ""}\n\n${detail || "(no further detail)"}`,
          tags: ["fork", "feed", "github", kind.toLowerCase()],
          source: "github-events-feed",
          meta: { eventId: id, repo: fullName, type: ev.type, actor, createdAt: ev.created_at },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); seen.add(id); }
      }
      saveFork();
      return { ok: true, result: { ingested, skipped, source: `github-events (${fullName})`, dtuIds } };
    } catch (e) { return { ok: false, error: `github unreachable: ${e instanceof Error ? e.message : String(e)}` }; }
  });
}
