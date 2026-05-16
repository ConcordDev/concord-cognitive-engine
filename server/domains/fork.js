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
  });

  /**
   * mergeComplexity
   * Count conflicting regions, dependency overlap, and estimate merge effort score.
   * artifact.data.changes = [{ file, regions: [{ startLine, endLine, author }], dependencies?: [string] }]
   */
  registerLensAction("fork", "mergeComplexity", (ctx, artifact, params) => {
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
  });

  /**
   * forkHealth
   * Score fork health based on sync freshness, divergence rate, and activity metrics.
   * artifact.data.fork = { name, createdAt, lastSyncAt?, lastCommitAt?, commitCount?,
   *   contributorCount?, openIssues?, upstream: { lastCommitAt?, commitCount? } }
   */
  registerLensAction("fork", "forkHealth", (ctx, artifact, params) => {
    const fork = artifact.data?.fork || {};
    const upstream = fork.upstream || {};
    const now = Date.now();

    const created = new Date(fork.createdAt || now).getTime();
    const lastSync = fork.lastSyncAt ? new Date(fork.lastSyncAt).getTime() : created;
    const lastCommit = fork.lastCommitAt ? new Date(fork.lastCommitAt).getTime() : created;
    const upstreamLastCommit = upstream.lastCommitAt
      ? new Date(upstream.lastCommitAt).getTime() : now;

    // Sync freshness: lose 2 points per day out of sync
    const daysSinceSync = (now - lastSync) / 86400000;
    const syncFreshness = Math.max(0, 100 - daysSinceSync * 2);

    // Activity: lose 1.5 points per day without commits
    const daysSinceCommit = (now - lastCommit) / 86400000;
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
}
