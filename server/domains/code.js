// server/domains/code.js
// Domain actions for the code lens.
//
// Two layers:
//   1) Analytical macros (complexity, dependency audit, coverage, change-risk)
//      — pre-existing; deterministic; operate on artifact.data.
//   2) IDE-grade macros (snippets, exec, multi-file agent, search, snapshots)
//      — new in the parity sprint. Touch STATE.dtus + ctx.llm where appropriate.

import vm from "node:vm";

const SNIPPET_KIND = "code_snippet";
const SNAPSHOT_KIND = "code_snapshot_bundle";
const MULTI_FILE_PLAN_TIMEOUT_MS = 25_000;
const EXEC_TIMEOUT_MS = 4_000;
const EXEC_MEMORY_HINT_BYTES = 32 * 1024 * 1024;
const SEARCH_RESULT_CAP = 500;

export default function registerCodeActions(registerLensAction) {
  /**
   * complexityAnalysis — Cyclomatic, cognitive, maintainability index per
   * module. Reads `artifact.data.modules: [{ name, lines, functions, branches,
   * loops, nestingDepth, dependencies? }]`.
   */
  registerLensAction("code", "complexityAnalysis", (ctx, artifact, _params) => {
    const modules = artifact.data?.modules || [];
    if (modules.length === 0) {
      return { ok: true, result: { modules: [], message: "No modules to analyze." } };
    }

    const analyzed = modules.map(mod => {
      const lines = mod.lines || 0;
      const functions = mod.functions || 0;
      const branches = mod.branches || 0;
      const loops = mod.loops || 0;
      const depth = mod.nestingDepth || 0;

      const cyclomaticComplexity = 1 + branches + loops;
      const nestingPenalty = depth > 0 ? (depth * (depth + 1)) / 2 : 0;
      const cognitiveComplexity = branches + loops * 2 + nestingPenalty;

      const operatorEstimate = branches + loops + functions;
      const operandEstimate = Math.max(1, lines - operatorEstimate);
      const vocabulary = operatorEstimate + operandEstimate;
      const length = lines;
      const volume = vocabulary > 0 ? Math.round(length * Math.log2(Math.max(vocabulary, 2))) : 0;

      const mi = Math.max(0, Math.min(100, Math.round(
        171
        - 5.2 * Math.log(Math.max(volume, 1))
        - 0.23 * cyclomaticComplexity
        - 16.2 * Math.log(Math.max(lines, 1))
      )));

      const rating = mi >= 80 ? "A" : mi >= 60 ? "B" : mi >= 40 ? "C" : mi >= 20 ? "D" : "F";

      return {
        name: mod.name,
        lines, functions, branches, loops, nestingDepth: depth,
        cyclomaticComplexity, cognitiveComplexity,
        halsteadVolume: volume,
        maintainabilityIndex: mi,
        rating,
      };
    });

    const totalLines = analyzed.reduce((s, m) => s + m.lines, 0);
    const avgMI = Math.round(analyzed.reduce((s, m) => s + m.maintainabilityIndex, 0) / analyzed.length);
    const hotspots = analyzed.filter(m => m.cyclomaticComplexity > 10 || m.cognitiveComplexity > 15)
      .sort((a, b) => b.cognitiveComplexity - a.cognitiveComplexity);

    artifact.data.lastComplexityAnalysis = { timestamp: new Date().toISOString(), avgMI, hotspotCount: hotspots.length };

    return {
      ok: true, result: {
        modules: analyzed, totalModules: modules.length, totalLines,
        averageMaintainability: avgMI,
        overallRating: avgMI >= 80 ? "A" : avgMI >= 60 ? "B" : avgMI >= 40 ? "C" : avgMI >= 20 ? "D" : "F",
        hotspots: hotspots.slice(0, 10),
      },
    };
  });

  /**
   * dependencyAudit — License + version + circular dependency check.
   */
  registerLensAction("code", "dependencyAudit", (ctx, artifact, _params) => {
    const deps = artifact.data?.dependencies || [];
    if (deps.length === 0) {
      return { ok: true, result: { dependencies: [], message: "No dependencies to audit." } };
    }

    const riskyLicenses = new Set(["GPL-3.0", "AGPL-3.0", "SSPL-1.0", "EUPL-1.2"]);
    const permissiveLicenses = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense"]);

    const audited = deps.map(dep => {
      const issues = [];
      if (dep.version && dep.latest) {
        const [curMajor, curMinor] = dep.version.replace(/^[^0-9]*/, "").split(".").map(Number);
        const [latMajor, latMinor] = dep.latest.replace(/^[^0-9]*/, "").split(".").map(Number);
        if (latMajor > curMajor) {
          issues.push({ type: "major_version_behind", current: dep.version, latest: dep.latest, severity: "high" });
        } else if (latMinor > curMinor + 5) {
          issues.push({ type: "significantly_outdated", current: dep.version, latest: dep.latest, severity: "moderate" });
        }
      }

      const license = dep.license || "unknown";
      if (riskyLicenses.has(license)) {
        issues.push({ type: "copyleft_license", license, severity: "high" });
      } else if (!permissiveLicenses.has(license) && license !== "unknown") {
        issues.push({ type: "uncommon_license", license, severity: "low" });
      } else if (license === "unknown") {
        issues.push({ type: "unknown_license", severity: "moderate" });
      }

      return {
        name: dep.name, version: dep.version, latest: dep.latest,
        license, direct: dep.direct !== false,
        issues, riskLevel: issues.some(i => i.severity === "high") ? "high"
          : issues.some(i => i.severity === "moderate") ? "moderate" : "low",
      };
    });

    const depMap = {};
    for (const dep of deps) depMap[dep.name] = dep.dependencies || [];
    const circulars = [];
    for (const name of Object.keys(depMap)) {
      const stack = [name];
      const visited = new Set();
      const queue = [...(depMap[name] || [])];
      while (queue.length > 0) {
        const current = queue.shift();
        if (current === name) {
          circulars.push({ from: name, cycle: [...stack, current] });
          break;
        }
        if (visited.has(current)) continue;
        visited.add(current);
        stack.push(current);
        for (const child of (depMap[current] || [])) queue.push(child);
      }
    }

    const directCount = audited.filter(d => d.direct).length;
    const transitiveCount = audited.length - directCount;
    const highRisk = audited.filter(d => d.riskLevel === "high");

    return {
      ok: true, result: {
        dependencies: audited, totalDependencies: deps.length,
        directCount, transitiveCount,
        highRisk: highRisk.map(d => ({ name: d.name, issues: d.issues })),
        circularDependencies: circulars.slice(0, 5),
        licenseSummary: {
          permissive: audited.filter(d => permissiveLicenses.has(d.license)).length,
          copyleft: audited.filter(d => riskyLicenses.has(d.license)).length,
          unknown: audited.filter(d => d.license === "unknown").length,
        },
      },
    };
  });

  /**
   * coverageAnalysis — Statement/branch/function coverage from instrumented runs.
   */
  registerLensAction("code", "coverageAnalysis", (ctx, artifact, _params) => {
    const coverage = artifact.data?.coverage || [];
    if (coverage.length === 0) {
      return { ok: true, result: { files: [], message: "No coverage data available." } };
    }

    const analyzed = coverage.map(f => {
      const stmtCov = f.statements > 0 ? f.statementsHit / f.statements : 0;
      const branchCov = f.branches > 0 ? f.branchesHit / f.branches : 0;
      const fnCov = f.functions > 0 ? f.functionsHit / f.functions : 0;
      const combined = stmtCov * 0.5 + branchCov * 0.3 + fnCov * 0.2;

      return {
        file: f.file,
        statementCoverage: Math.round(stmtCov * 10000) / 100,
        branchCoverage: Math.round(branchCov * 10000) / 100,
        functionCoverage: Math.round(fnCov * 10000) / 100,
        combinedScore: Math.round(combined * 10000) / 100,
        uncoveredLines: f.uncoveredLines || [],
        risk: combined < 0.5 ? "high" : combined < 0.8 ? "moderate" : "low",
      };
    });

    const totalStatements = coverage.reduce((s, f) => s + (f.statements || 0), 0);
    const totalHit = coverage.reduce((s, f) => s + (f.statementsHit || 0), 0);
    const totalBranches = coverage.reduce((s, f) => s + (f.branches || 0), 0);
    const totalBranchesHit = coverage.reduce((s, f) => s + (f.branchesHit || 0), 0);
    const overallStatement = totalStatements > 0 ? Math.round((totalHit / totalStatements) * 10000) / 100 : 0;
    const overallBranch = totalBranches > 0 ? Math.round((totalBranchesHit / totalBranches) * 10000) / 100 : 0;

    const gaps = analyzed.filter(f => f.risk === "high").sort((a, b) => a.combinedScore - b.combinedScore);

    return {
      ok: true, result: {
        files: analyzed,
        overall: { statementCoverage: overallStatement, branchCoverage: overallBranch, totalFiles: coverage.length },
        gaps: gaps.slice(0, 10),
        meetsThreshold80: overallStatement >= 80,
      },
    };
  });

  /**
   * changeRiskAssessment — Heuristic risk score for a proposed changeset.
   */
  registerLensAction("code", "changeRiskAssessment", (ctx, artifact, _params) => {
    const changes = artifact.data?.changes || [];
    if (changes.length === 0) {
      return { ok: true, result: { files: [], overallRisk: "low", message: "No changes to assess." } };
    }

    const assessed = changes.map(ch => {
      let riskScore = 0;
      const factors = [];

      const churn = (ch.linesAdded || 0) + (ch.linesRemoved || 0);
      if (churn > 500) { riskScore += 3; factors.push("very_large_change"); }
      else if (churn > 200) { riskScore += 2; factors.push("large_change"); }
      else if (churn > 50) { riskScore += 1; factors.push("moderate_change"); }

      const bugCount = ch.recentBugCount || 0;
      if (bugCount > 5) { riskScore += 3; factors.push("high_bug_history"); }
      else if (bugCount > 2) { riskScore += 2; factors.push("some_bug_history"); }

      const authorCount = (ch.authors || []).length;
      if (authorCount > 5) { riskScore += 2; factors.push("many_authors"); }
      else if (authorCount > 3) { riskScore += 1; factors.push("shared_ownership"); }

      if (ch.hasCoverage === false) { riskScore += 2; factors.push("no_test_coverage"); }

      if (ch.lastModified) {
        const daysSince = (Date.now() - new Date(ch.lastModified).getTime()) / 86400000;
        if (daysSince < 7) { riskScore += 1; factors.push("recently_modified"); }
      }

      const level = riskScore >= 6 ? "critical" : riskScore >= 4 ? "high" : riskScore >= 2 ? "moderate" : "low";

      return { file: ch.file, churn, riskScore, riskLevel: level, factors };
    });

    assessed.sort((a, b) => b.riskScore - a.riskScore);
    const avgRisk = assessed.reduce((s, a) => s + a.riskScore, 0) / assessed.length;
    const overallRisk = avgRisk >= 5 ? "critical" : avgRisk >= 3 ? "high" : avgRisk >= 1.5 ? "moderate" : "low";

    return {
      ok: true, result: {
        files: assessed, totalFiles: changes.length,
        totalChurn: changes.reduce((s, c) => s + (c.linesAdded || 0) + (c.linesRemoved || 0), 0),
        overallRisk, averageRiskScore: Math.round(avgRisk * 100) / 100,
        criticalFiles: assessed.filter(a => a.riskLevel === "critical").map(a => a.file),
        recommendations: [
          ...assessed.filter(a => a.factors.includes("no_test_coverage")).length > 0 ? ["Add tests for uncovered files before merging"] : [],
          ...assessed.filter(a => a.factors.includes("high_bug_history")).length > 0 ? ["Extra review recommended for bug-prone files"] : [],
          ...assessed.some(a => a.churn > 500) ? ["Consider splitting large changes into smaller PRs"] : [],
        ],
      },
    };
  });

  // ─── IDE-grade macros (parity sprint) ──────────────────────────────────

  /**
   * snippets-list — List the caller's code snippets (DTUs of kind=code_snippet).
   * Falls back to global snippet corpus for anon users.
   */
  registerLensAction("code", "snippets-list", (ctx, _artifact, params = {}) => {
    const language = params.language;
    const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
    const userId = ctx?.userId || ctx?.actor?.userId || null;
    const snippets = collectSnippets(userId, language, limit);
    return { ok: true, result: { snippets, count: snippets.length } };
  });

  /**
   * snippets-save — Persist a code snippet as a kind=code_snippet DTU.
   */
  registerLensAction("code", "snippets-save", (ctx, _artifact, params = {}) => {
    const title = String(params.title || "").trim();
    const code = String(params.code || "");
    const language = String(params.language || "plaintext");
    if (!title || !code) {
      return { ok: false, error: "title and code are required" };
    }
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) {
      return { ok: false, error: "STATE unavailable" };
    }
    const id = `dtu_snip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const userId = ctx?.userId || ctx?.actor?.userId || null;
    const dtu = {
      id,
      title: `Snippet: ${title}`,
      tier: "regular",
      tags: ["code", "snippet", language].filter(Boolean),
      human: { summary: `Code snippet: ${title}`, bullets: [`Language: ${language}`, `${code.split("\n").length} lines`] },
      core: { definitions: [`Language: ${language}`], examples: [code.slice(0, 4000)] },
      machine: { kind: SNIPPET_KIND, code, language, title },
      creator_id: userId || undefined,
      source: "code-lens",
      createdAt: new Date().toISOString(),
    };
    STATE.dtus.set(id, dtu);
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
    return { ok: true, result: { id, snippet: toSnippetShape(dtu) } };
  });

  /**
   * snippets-delete — Remove a snippet DTU owned by the caller.
   */
  registerLensAction("code", "snippets-delete", (ctx, _artifact, params = {}) => {
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: false, error: "STATE unavailable" };
    const dtu = STATE.dtus.get(id);
    if (!dtu) return { ok: false, error: "snippet not found" };
    if (dtu.machine?.kind !== SNIPPET_KIND) {
      return { ok: false, error: "not a snippet" };
    }
    const userId = ctx?.userId || ctx?.actor?.userId || null;
    if (dtu.creator_id && userId && dtu.creator_id !== userId) {
      return { ok: false, error: "not owner" };
    }
    STATE.dtus.delete(id);
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
    return { ok: true, result: { id, deleted: true } };
  });

  /**
   * snapshots-list — List the caller's code snapshot bundles.
   */
  registerLensAction("code", "snapshots-list", (ctx, _artifact, params = {}) => {
    const limit = Math.min(Math.max(Number(params.limit) || 25, 1), 100);
    const userId = ctx?.userId || ctx?.actor?.userId || null;
    const snapshots = collectSnapshots(userId, limit);
    return { ok: true, result: { snapshots, count: snapshots.length } };
  });

  /**
   * commit-snapshot — Bundle a set of tabs into a DTU representing a
   * point-in-time commit. Each tab becomes a file in the bundle's machine.files
   * array; message is the commit message.
   */
  registerLensAction("code", "commit-snapshot", (ctx, _artifact, params = {}) => {
    const message = String(params.message || "").trim();
    const files = Array.isArray(params.files) ? params.files : [];
    if (!message) return { ok: false, error: "message required" };
    if (files.length === 0) return { ok: false, error: "no files in commit" };
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: false, error: "STATE unavailable" };

    const userId = ctx?.userId || ctx?.actor?.userId || null;
    const id = `dtu_snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const totalLines = files.reduce((sum, f) => sum + (typeof f.content === "string" ? f.content.split("\n").length : 0), 0);
    const dtu = {
      id,
      title: `Snapshot: ${message.slice(0, 60)}`,
      tier: "regular",
      tags: ["code", "snapshot", "commit"],
      human: { summary: message, bullets: [`${files.length} file${files.length === 1 ? "" : "s"}`, `${totalLines} lines total`] },
      core: { definitions: [`${files.length} files`, `Author: ${userId || "anon"}`] },
      machine: {
        kind: SNAPSHOT_KIND,
        message,
        files: files.map(f => ({
          name: String(f.name || "untitled"),
          language: String(f.language || "plaintext"),
          content: typeof f.content === "string" ? f.content : "",
          scriptId: f.scriptId || null,
        })),
        committedAt: new Date().toISOString(),
      },
      creator_id: userId || undefined,
      source: "code-lens",
      createdAt: new Date().toISOString(),
    };
    STATE.dtus.set(id, dtu);
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
    return { ok: true, result: { id, snapshot: toSnapshotShape(dtu) } };
  });

  /**
   * search-project — Project-wide ripgrep-style search across files passed in
   * params.files: [{ name, language?, content }]. Returns line hits with
   * preview, capped at SEARCH_RESULT_CAP. Supports plain + regex + case toggle.
   */
  registerLensAction("code", "search-project", (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "");
    if (query.length < 1) return { ok: true, result: { hits: [], totalFiles: 0, totalLines: 0 } };

    const files = Array.isArray(params.files) ? params.files : [];
    const caseSensitive = params.caseSensitive === true;
    const regex = params.regex === true;
    const wholeWord = params.wholeWord === true;
    const includeGlobs = Array.isArray(params.includeGlobs) ? params.includeGlobs : [];
    const excludeGlobs = Array.isArray(params.excludeGlobs) ? params.excludeGlobs : [];

    let matcher;
    try {
      let pat = query;
      if (!regex) pat = escapeRegex(query);
      if (wholeWord) pat = `\\b${pat}\\b`;
      matcher = new RegExp(pat, caseSensitive ? "g" : "gi");
    } catch (e) {
      return { ok: false, error: `invalid regex: ${e?.message || "unknown"}` };
    }

    const hits = [];
    let totalLines = 0;
    let stopped = false;

    for (const f of files) {
      const name = String(f.name || "");
      if (includeGlobs.length > 0 && !includeGlobs.some(g => globMatch(g, name))) continue;
      if (excludeGlobs.length > 0 && excludeGlobs.some(g => globMatch(g, name))) continue;
      const content = String(f.content || "");
      const lines = content.split("\n");
      totalLines += lines.length;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const matches = [...line.matchAll(matcher)];
        if (matches.length === 0) continue;
        for (const m of matches) {
          hits.push({
            file: name,
            scriptId: f.scriptId || null,
            language: f.language || null,
            line: i + 1,
            column: (m.index ?? 0) + 1,
            preview: line.length > 240 ? line.slice(0, 240) + "…" : line,
            matchText: m[0],
          });
          if (hits.length >= SEARCH_RESULT_CAP) { stopped = true; break; }
        }
        if (stopped) break;
      }
      if (stopped) break;
    }

    return {
      ok: true,
      result: {
        hits,
        totalFiles: files.length,
        totalLines,
        capped: stopped,
        cap: SEARCH_RESULT_CAP,
      },
    };
  });

  /**
   * exec — Sandbox-execute a piece of code. JavaScript routes through Node's
   * built-in `vm` with strict timeout + no I/O globals. Other languages
   * return `{ supported: false }` so the caller can fall back to the broader
   * runner pipeline.
   */
  registerLensAction("code", "exec", (_ctx, _artifact, params = {}) => {
    const code = String(params.code || "");
    const language = String(params.language || "javascript").toLowerCase();
    if (!code.trim()) return { ok: true, result: { stdout: "", stderr: "", exitCode: 0, supported: true } };

    if (language === "javascript" || language === "js" || language === "typescript" || language === "ts") {
      return execJavaScript(code, language);
    }

    return {
      ok: true,
      result: {
        supported: false,
        stdout: "",
        stderr: `Language "${language}" cannot run in the sandbox. Use the Run button for the broader runner pipeline.`,
        exitCode: -1,
      },
    };
  });

  /**
   * multi-file-plan — Ask the LLM to propose a coherent multi-file edit plan.
   * params: { prompt, files: [{ id, name, language, content }], maxEdits? }
   * Returns: { edits: [{ filename, scriptId, language, before, after, reason }] }
   *
   * Strict contract: the LLM is constrained to output a JSON object matching
   * the schema; we parse, validate, and round-trip before returning. On any
   * parse failure, returns ok:false with the raw output so the caller can
   * retry with a stricter prompt.
   */
  registerLensAction("code", "multi-file-plan", async (ctx, _artifact, params = {}) => {
    const prompt = String(params.prompt || "").trim();
    const files = Array.isArray(params.files) ? params.files : [];
    const maxEdits = Math.min(Math.max(Number(params.maxEdits) || 6, 1), 12);

    if (!prompt) return { ok: false, error: "prompt required" };
    if (files.length === 0) return { ok: false, error: "no files provided as context" };
    if (!ctx?.llm?.chat) return { ok: false, error: "llm unavailable" };

    const fileManifest = files.slice(0, 20).map((f, i) => ({
      idx: i,
      filename: String(f.name || `file_${i}`),
      scriptId: f.id || null,
      language: String(f.language || "plaintext"),
      content: String(f.content || "").slice(0, 8000),
    }));

    const sys = `You are a senior software engineer producing a multi-file edit plan.
RESPOND ONLY WITH A JSON OBJECT — no prose before or after.
Schema:
{
  "edits": [
    {
      "filename": "string (exact match to manifest)",
      "scriptId": "string or null",
      "language": "string",
      "before": "the full new file content WAS the file content as given",
      "after": "the full new file content with your changes applied",
      "reason": "one-sentence rationale"
    }
  ]
}
Rules:
- "before" MUST exactly match the file content from the manifest. Copy it verbatim.
- "after" is your new content. Preserve indentation. No partial edits.
- Touch at most ${maxEdits} files. Only include files you change.
- If a file does not need to change, omit it.
- Filenames MUST exactly match one of the manifest filenames; do not invent.`;

    const manifestPrompt = fileManifest.map(f =>
      `## ${f.filename} (${f.language}, idx=${f.idx})\n\`\`\`${f.language}\n${f.content}\n\`\`\``
    ).join("\n\n");

    const userMsg = `Files in the workspace:\n\n${manifestPrompt}\n\n---\n\nInstruction: ${prompt}\n\nReturn ONLY the JSON object.`;

    let raw = "";
    try {
      const llmRes = await withTimeout(ctx.llm.chat({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userMsg },
        ],
        temperature: 0.1,
        maxTokens: 4096,
        slot: "conscious",
      }), MULTI_FILE_PLAN_TIMEOUT_MS);
      raw = String(llmRes?.text || llmRes?.content || llmRes?.message?.content || "");
    } catch (e) {
      return { ok: false, error: `llm error: ${e?.message || "unknown"}` };
    }

    const parsed = extractJsonObject(raw);
    if (!parsed || !Array.isArray(parsed.edits)) {
      return { ok: false, error: "could not parse plan", raw: raw.slice(0, 500) };
    }

    const validatedEdits = [];
    for (const e of parsed.edits) {
      const filename = String(e?.filename || "").trim();
      if (!filename) continue;
      const manifestFile = fileManifest.find(m => m.filename === filename);
      if (!manifestFile) continue;
      const after = typeof e.after === "string" ? e.after : "";
      const before = typeof e.before === "string" ? e.before : manifestFile.content;
      if (!after.trim() || after === before) continue;
      validatedEdits.push({
        filename,
        scriptId: e.scriptId || manifestFile.scriptId || null,
        language: e.language || manifestFile.language,
        before: manifestFile.content,
        after,
        reason: typeof e.reason === "string" ? e.reason : null,
      });
      if (validatedEdits.length >= maxEdits) break;
    }

    return { ok: true, result: { edits: validatedEdits, prompt, totalFiles: files.length, planned: parsed.edits.length, accepted: validatedEdits.length } };
  });

  /**
   * multi-file-apply — Apply accepted plan edits to the underlying script DTUs.
   * params: { edits: [{ scriptId, filename, language, after }] }
   * Each edit becomes a new DTU revision (preserves history); the existing
   * script DTU's machine.code is replaced, and a `revisions` array is
   * appended with the prior content + timestamp.
   */
  registerLensAction("code", "multi-file-apply", (ctx, _artifact, params = {}) => {
    const edits = Array.isArray(params.edits) ? params.edits : [];
    if (edits.length === 0) return { ok: false, error: "no edits to apply" };

    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: false, error: "STATE unavailable" };

    const userId = ctx?.userId || ctx?.actor?.userId || null;
    const applied = [];
    const skipped = [];

    for (const e of edits) {
      const scriptId = e?.scriptId;
      if (!scriptId) {
        skipped.push({ filename: e?.filename, reason: "no scriptId" });
        continue;
      }
      const dtu = STATE.dtus.get(scriptId);
      if (!dtu) {
        skipped.push({ filename: e.filename, reason: "scriptId not found" });
        continue;
      }
      if (dtu.creator_id && userId && dtu.creator_id !== userId) {
        skipped.push({ filename: e.filename, reason: "not owner" });
        continue;
      }
      const prev = dtu.machine?.code || dtu.data?.content || "";
      const next = typeof e.after === "string" ? e.after : "";
      if (!next.trim()) {
        skipped.push({ filename: e.filename, reason: "empty after" });
        continue;
      }
      if (!dtu.machine) dtu.machine = {};
      dtu.machine.revisions = Array.isArray(dtu.machine.revisions) ? dtu.machine.revisions : [];
      dtu.machine.revisions.push({
        before: prev,
        at: new Date().toISOString(),
        actor: userId || "anon",
        reason: e.reason || null,
      });
      dtu.machine.code = next;
      if (dtu.data) dtu.data.content = next;
      dtu.updatedAt = new Date().toISOString();
      applied.push({ scriptId, filename: e.filename, bytes: next.length, revision: dtu.machine.revisions.length });
    }

    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
    return { ok: true, result: { applied, skipped } };
  });

  /**
   * tab-completion — Lightweight ghost-text continuation for the Monaco
   * InlineCompletionsProvider. Hot path; routes to utility brain.
   *
   * params: { prefix, suffix?, language, maxTokens? }
   */
  registerLensAction("code", "tab-completion", async (ctx, _artifact, params = {}) => {
    const prefix = String(params.prefix || "");
    const suffix = String(params.suffix || "");
    const language = String(params.language || "plaintext");
    const maxTokens = Math.min(Math.max(Number(params.maxTokens) || 64, 8), 256);

    if (!prefix.trim()) return { ok: true, result: { completion: "" } };
    if (!ctx?.llm?.chat) return { ok: true, result: { completion: "" } };

    const trimmedPrefix = prefix.length > 4000 ? "…" + prefix.slice(-4000) : prefix;
    const trimmedSuffix = suffix.length > 1500 ? suffix.slice(0, 1500) + "…" : suffix;
    const sys = `You are a code autocomplete engine. Continue the user's code from the cursor for up to ~${maxTokens} tokens. Output ONLY the continuation — no fences, no prose, no quotes. Honour indentation.`;
    const user = trimmedSuffix
      ? `Language: ${language}\n\nBefore cursor:\n${trimmedPrefix}\n\nAfter cursor:\n${trimmedSuffix}\n\nReturn the text to insert AT the cursor only.`
      : `Language: ${language}\n\nCode so far:\n${trimmedPrefix}\n\nContinue the code.`;

    try {
      const llmRes = await withTimeout(ctx.llm.chat({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        maxTokens,
        slot: "utility",
      }), 3500);
      const raw = String(llmRes?.text || llmRes?.content || llmRes?.message?.content || "").trim();
      const stripped = raw.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
      return { ok: true, result: { completion: stripped, model: "utility" } };
    } catch (_e) {
      return { ok: true, result: { completion: "" } };
    }
  });
}

// ─── helpers ────────────────────────────────────────────────────────────

function collectSnippets(userId, language, limit) {
  const STATE = globalThis._concordSTATE;
  if (!STATE?.dtus?.values) return [];
  const out = [];
  for (const dtu of STATE.dtus.values()) {
    if (dtu?.machine?.kind !== SNIPPET_KIND) continue;
    if (language && dtu.machine.language !== language) continue;
    if (userId && dtu.creator_id && dtu.creator_id !== userId) continue;
    out.push(toSnippetShape(dtu));
    if (out.length >= limit * 2) break;
  }
  out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return out.slice(0, limit);
}

function collectSnapshots(userId, limit) {
  const STATE = globalThis._concordSTATE;
  if (!STATE?.dtus?.values) return [];
  const out = [];
  for (const dtu of STATE.dtus.values()) {
    if (dtu?.machine?.kind !== SNAPSHOT_KIND) continue;
    if (userId && dtu.creator_id && dtu.creator_id !== userId) continue;
    out.push(toSnapshotShape(dtu));
    if (out.length >= limit * 2) break;
  }
  out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return out.slice(0, limit);
}

function toSnippetShape(dtu) {
  return {
    id: dtu.id,
    title: dtu.machine?.title || dtu.title?.replace(/^Snippet:\s*/, "") || "untitled",
    language: dtu.machine?.language || "plaintext",
    code: dtu.machine?.code || dtu.core?.examples?.[0] || "",
    tags: dtu.tags || [],
    createdAt: dtu.createdAt,
  };
}

function toSnapshotShape(dtu) {
  return {
    id: dtu.id,
    message: dtu.machine?.message || dtu.title?.replace(/^Snapshot:\s*/, "") || "",
    files: (dtu.machine?.files || []).map(f => ({ name: f.name, language: f.language, scriptId: f.scriptId })),
    fileCount: (dtu.machine?.files || []).length,
    committedAt: dtu.machine?.committedAt || dtu.createdAt,
    createdAt: dtu.createdAt,
  };
}

function execJavaScript(code, language) {
  // Strip ts type annotations and trailing imports for a best-effort TS->JS
  // run. Anything that needs full TS compilation goes through the broader
  // runner pipeline (already wired in lens page).
  let src = code;
  if (language === "typescript" || language === "ts") {
    src = src
      .replace(/^import\s.+?from\s.+?;\s*$/gm, "")
      .replace(/^export\s+(default\s+)?/gm, "")
      .replace(/:\s*[A-Za-z_$][\w$<>[\],\s|&?']*(?=\s*[,)={])/g, "")
      .replace(/<[A-Za-z_$][\w$<>,\s|&?']*>(?=\s*\()/g, "");
  }

  const stdoutLines = [];
  const stderrLines = [];
  const startedAt = performance.now();

  const sandboxConsole = {
    log: (...args) => stdoutLines.push(args.map(formatExecArg).join(" ")),
    info: (...args) => stdoutLines.push(args.map(formatExecArg).join(" ")),
    warn: (...args) => stderrLines.push(args.map(formatExecArg).join(" ")),
    error: (...args) => stderrLines.push(args.map(formatExecArg).join(" ")),
    debug: (...args) => stdoutLines.push(args.map(formatExecArg).join(" ")),
  };

  const sandbox = {
    console: sandboxConsole,
    Math, JSON, Date, Number, String, Boolean, Array, Object, Map, Set,
    Promise, RegExp, Error, TypeError, RangeError, Symbol,
    parseInt, parseFloat, isFinite, isNaN, encodeURIComponent, decodeURIComponent,
  };

  try {
    const ctx = vm.createContext(sandbox, { name: "code-lens-exec" });
    // Use the script in eval-mode (not function-wrapped) so the result of the
    // last expression is captured — `1 + 2 + 3` should yield `6`, mirroring
    // Node REPL / `vm.runInContext` semantics. Strict mode is opt-in by the
    // user source; we don't force it because that breaks legitimate patterns
    // (`with`, top-level `let` shadowing, etc.) and the sandbox is already
    // isolated.
    const ctxObj = ctx;
    const script = new vm.Script(src, { filename: "exec.js" });
    const value = script.runInContext(ctxObj, { timeout: EXEC_TIMEOUT_MS, displayErrors: true });
    if (value !== undefined && stdoutLines.length === 0) {
      stdoutLines.push(formatExecArg(value));
    }
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    stderrLines.push(msg);
    return {
      ok: true,
      result: {
        stdout: stdoutLines.join("\n"),
        stderr: stderrLines.join("\n"),
        exitCode: 1,
        durationMs: Math.round(performance.now() - startedAt),
        supported: true,
        memoryHintBytes: EXEC_MEMORY_HINT_BYTES,
      },
    };
  }

  return {
    ok: true,
    result: {
      stdout: stdoutLines.join("\n"),
      stderr: stderrLines.join("\n"),
      exitCode: 0,
      durationMs: Math.round(performance.now() - startedAt),
      supported: true,
      memoryHintBytes: EXEC_MEMORY_HINT_BYTES,
    },
  };
}

function formatExecArg(v) {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "function") return `[Function: ${v.name || "anonymous"}]`;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    Promise.resolve(promise).then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globMatch(pattern, name) {
  // Minimal glob support: `*` matches any chars except `/`; `**` matches
  // anything including `/`; `?` matches single char.
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") { regex += ".*"; i += 2; }
    else if (c === "*") { regex += "[^/]*"; i += 1; }
    else if (c === "?") { regex += "."; i += 1; }
    else if (".+^${}()|[]\\".includes(c)) { regex += "\\" + c; i += 1; }
    else { regex += c; i += 1; }
  }
  return new RegExp(`^${regex}$`).test(name);
}

function extractJsonObject(raw) {
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : raw;
  const firstBrace = body.indexOf("{");
  const lastBrace = body.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(body.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}
