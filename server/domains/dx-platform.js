// server/domains/dx-platform.js
//
// DX Platform feature-parity backlog (vs Sourcegraph Cody / GitHub Copilot
// platform). The onboarding/billing/severity loop already ships in
// server/domains/dx.js + server/routes/dx-oauth.js. This module adds the
// seven buildable backlog items from docs/lens-specs/dx-platform.md:
//
//   1. chat-with-codebase   — index user-supplied repo files, answer
//                             questions grounded ONLY in indexed content.
//   2. PR/diff review       — parse a unified diff, run the detector grid
//                             over the added lines, return findings.
//   3. Team dashboard       — aggregate findings + severity trends across
//                             a team's codebases.
//   4. Codebase-wide search — literal + token search over indexed files.
//   5. Detector config      — per-codebase enable/disable of detectors.
//   6. Usage analytics      — detector fire counts + fix-acceptance rate.
//   7. CI integration       — emit a GitHub Action workflow + a pre-merge
//                             gate verdict from a diff-review result.
//
// All state is per-user in globalThis._concordSTATE.dxPlatformLens. No
// seed/demo data — every value is real user input or computed from it.
// Detector definitions are static *rules* (regex patterns), not data.
//
// Fail-CLOSED numeric guard: every macro that READS or WRITES from a numeric
// input (windowDays / count) calls `badNumericField` BEFORE using it, rejecting
// NaN/Infinity/1e308/negative with `invalid_<field>` instead of silently
// clamping them to an accepted result (the macro-assassin's V2 vector probes
// exactly this). Copied from server/domains/literary.js. An absent/null field
// is fine (the macro uses its default).
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input == null || input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) return k;
  }
  return null;
}
//
// REGISTRATION (saved-class fix): this file used to register through the
// legacy `registerLensAction(domain, action, (ctx, artifact, params))`
// convention AND was NEVER imported by server.js — so every `dx-platform.*`
// macro was invisible to runMacro and to POST /api/lens/run → every call hit
// `unknown_macro`, leaving the DxWorkbench (chat/PR-review/search/team/detector
// config/usage analytics/CI) dead-wired. It is now wired through the canonical
// `register` (MACROS) registry — `registerDxPlatformActions(register)` in
// server.js — so the macros are reachable BOTH via POST /api/lens/run AND via
// runMacro (which the contract engine + macro-assassin + behavior-smoke harness
// drive).
//
// To keep the verified handler bodies byte-for-byte identical we adapt the
// canonical 2-arg `(ctx, input)` signature back to the legacy
// `(ctx, _artifact, params)` shape via the `registerLensAction` shim below —
// `params` is the input, identical to what `/api/lens/run` would have built.
// Handlers return a `{ ok, result }` envelope (the dispatcher's
// `_unwrapLensEnvelope` strips the `result` layer so the frontend reads
// `r.data.result.<field>`).

export default function registerDxPlatformActions(register) {
  // Legacy-convention shim: adapt canonical register(ctx, input) → the
  // verified (ctx, _artifact, params) handler bodies below, unchanged.
  const registerLensAction = (domain, action, handler) =>
    register(domain, action, (ctx, input = {}) => {
      const inp = input && typeof input === "object" ? input : {};
      return handler(ctx, { id: null, domain, type: "domain_action", data: inp, meta: {} }, inp);
    });

  // ── State plumbing ──────────────────────────────────────────────────
  function getState() {
    const STATE = (globalThis._concordSTATE = globalThis._concordSTATE || {});
    if (!STATE.dxPlatformLens) STATE.dxPlatformLens = {};
    const s = STATE.dxPlatformLens;
    if (!(s.codebases instanceof Map)) s.codebases = new Map();   // userId -> Map<codebaseId, codebase>
    if (!(s.teams instanceof Map)) s.teams = new Map();           // teamId  -> team
    if (!(s.analytics instanceof Map)) s.analytics = new Map();   // userId -> { fires:[], outcomes:[] }
    return s;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch { /* best effort */ }
    }
  }
  const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || null;
  const now = () => new Date().toISOString();
  const uid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  function userCodebases(s, userId) {
    if (!s.codebases.has(userId)) s.codebases.set(userId, new Map());
    return s.codebases.get(userId);
  }
  function userAnalytics(s, userId) {
    if (!s.analytics.has(userId)) s.analytics.set(userId, { fires: [], outcomes: [] });
    return s.analytics.get(userId);
  }

  // ── Detector grid (static rule definitions — NOT data) ──────────────
  // Each rule is a literal scanner. Findings come from real user input.
  const DETECTORS = [
    { id: "secret_leak", label: "Secret / credential leak", severity: 5, default: true,
      test: (line) => /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}/i.test(line)
        || /(?:AKIA|ghp_|sk-)[A-Za-z0-9]{12,}/.test(line) },
    { id: "console_debug", label: "Leftover debug statement", severity: 2, default: true,
      test: (line) => /\bconsole\.(?:log|debug|trace)\s*\(/.test(line) || /\bdebugger\b/.test(line) },
    { id: "todo_marker", label: "Unresolved TODO / FIXME / XXX", severity: 1, default: true,
      test: (line) => /\b(?:TODO|FIXME|XXX|HACK)\b/.test(line) },
    { id: "wide_catch", label: "Empty or swallowing catch", severity: 3, default: true,
      test: (line) => /catch\s*\([^)]*\)\s*\{\s*\}/.test(line) },
    { id: "eval_use", label: "Dynamic eval / Function constructor", severity: 4, default: true,
      test: (line) => /\beval\s*\(/.test(line) || /new\s+Function\s*\(/.test(line) },
    { id: "loose_equality", label: "Loose equality (== / !=)", severity: 1, default: true,
      test: (line) => /[^=!<>]==[^=]/.test(line) || /!=[^=]/.test(line) },
    { id: "long_line", label: "Excessively long line (>180 chars)", severity: 1, default: false,
      test: (line) => line.length > 180 },
    { id: "hardcoded_url", label: "Hardcoded HTTP URL", severity: 2, default: true,
      test: (line) => /https?:\/\/(?!localhost|127\.0\.0\.1)[^\s'"]+/.test(line) },
    { id: "tab_indent", label: "Mixed-tab indentation", severity: 1, default: false,
      test: (line) => /^\t* +\t/.test(line) },
    { id: "var_decl", label: "Legacy 'var' declaration", severity: 1, default: true,
      test: (line) => /^\s*var\s+[A-Za-z_$]/.test(line) },
  ];
  const DETECTOR_BY_ID = new Map(DETECTORS.map((d) => [d.id, d]));

  // Scan an array of {path, lines:[{n,text}]} against enabled detectors.
  function scanLines(units, enabledSet) {
    const findings = [];
    for (const unit of units) {
      for (const ln of unit.lines) {
        for (const det of DETECTORS) {
          if (enabledSet && !enabledSet.has(det.id)) continue;
          if (det.default === false && (!enabledSet || !enabledSet.has(det.id))) continue;
          let matched = false;
          try { matched = det.test(ln.text); } catch { matched = false; }
          if (matched) {
            findings.push({
              id: uid("find"),
              detectorId: det.id,
              detectorLabel: det.label,
              severity: det.severity,
              path: unit.path,
              line: ln.n,
              snippet: ln.text.trim().slice(0, 200),
            });
          }
        }
      }
    }
    return findings;
  }

  // Default enabled set = detectors with default:true.
  function defaultEnabled() {
    return new Set(DETECTORS.filter((d) => d.default).map((d) => d.id));
  }

  // ── 1. chat-with-codebase: index files ──────────────────────────────
  // params: { codebaseId, name?, files: [{path, content}] }
  registerLensAction("dx-platform", "indexCodebase", (ctx, _a, params = {}) => {
  try {
    const userId = actor(ctx);
    if (!userId) return { ok: false, error: "auth_required" };
    const files = Array.isArray(params.files) ? params.files : [];
    if (files.length === 0) return { ok: false, error: "no_files" };
    const s = getState();
    const mine = userCodebases(s, userId);
    const codebaseId = String(params.codebaseId || uid("cb"));
    const cleanFiles = files
      .filter((f) => f && typeof f.path === "string" && typeof f.content === "string")
      .slice(0, 400)
      .map((f) => ({
        path: f.path.slice(0, 300),
        content: f.content.slice(0, 100000),
        lineCount: f.content.split("\n").length,
        bytes: Buffer.byteLength(f.content, "utf8"),
      }));
    if (cleanFiles.length === 0) return { ok: false, error: "no_valid_files" };
    const existing = mine.get(codebaseId);
    const cb = {
      id: codebaseId,
      name: String(params.name || existing?.name || codebaseId).slice(0, 200),
      files: cleanFiles,
      detectorConfig: existing?.detectorConfig || [...defaultEnabled()],
      teamId: existing?.teamId || null,
      indexedAt: now(),
      createdAt: existing?.createdAt || now(),
    };
    mine.set(codebaseId, cb);
    save();
    return {
      ok: true,
      result: {
        codebaseId,
        name: cb.name,
        fileCount: cleanFiles.length,
        totalLines: cleanFiles.reduce((a, f) => a + f.lineCount, 0),
        totalBytes: cleanFiles.reduce((a, f) => a + f.bytes, 0),
        indexedAt: cb.indexedAt,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("dx-platform", "listCodebases", (ctx) => {
    const userId = actor(ctx);
    if (!userId) return { ok: false, error: "auth_required" };
    const s = getState();
    const mine = userCodebases(s, userId);
    const codebases = [...mine.values()]
      .sort((a, b) => (b.indexedAt || "").localeCompare(a.indexedAt || ""))
      .map((cb) => ({
        id: cb.id,
        name: cb.name,
        fileCount: cb.files.length,
        totalLines: cb.files.reduce((a, f) => a + f.lineCount, 0),
        teamId: cb.teamId,
        indexedAt: cb.indexedAt,
      }));
    return { ok: true, result: { codebases, count: codebases.length } };
  });

  // ── 1. chat-with-codebase: answer a question ────────────────────────
  // Deterministic, fully grounded retrieval — never invents content. It
  // ranks indexed files/lines by token overlap with the question and
  // returns the matching excerpts as the answer's evidence.
  registerLensAction("dx-platform", "chatWithCodebase", (ctx, _a, params = {}) => {
  try {
    const userId = actor(ctx);
    if (!userId) return { ok: false, error: "auth_required" };
    const question = String(params.question || "").trim();
    if (!question) return { ok: false, error: "no_question" };
    const s = getState();
    const mine = userCodebases(s, userId);
    const cb = mine.get(String(params.codebaseId || ""));
    if (!cb) return { ok: false, error: "codebase_not_found" };
    if (cb.files.length === 0) {
      return { ok: true, result: { answer: "No indexed files yet.", citations: [], grounded: false } };
    }
    const stop = new Set(["the", "a", "an", "is", "are", "of", "to", "in", "and", "or",
      "how", "what", "where", "why", "does", "do", "i", "this", "that", "for", "with", "on"]);
    const qTokens = question.toLowerCase().match(/[a-z0-9_$]{2,}/g) || [];
    const keyTokens = [...new Set(qTokens.filter((t) => !stop.has(t)))];
    if (keyTokens.length === 0) {
      return { ok: true, result: { answer: "Ask a more specific question about the codebase.", citations: [], grounded: false } };
    }
    const hits = [];
    for (const file of cb.files) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        let score = 0;
        for (const tok of keyTokens) if (lower.includes(tok)) score++;
        if (score > 0) {
          hits.push({ path: file.path, line: i + 1, text: lines[i].trim().slice(0, 240), score });
        }
      }
    }
    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const top = hits.slice(0, 12);
    const grounded = top.length > 0;
    const matchedFiles = [...new Set(top.map((h) => h.path))];
    const answer = grounded
      ? `Found ${hits.length} matching line(s) across ${matchedFiles.length} file(s) for: ${keyTokens.join(", ")}. The most relevant references are cited below.`
      : `No lines in the indexed codebase reference: ${keyTokens.join(", ")}.`;
    return {
      ok: true,
      result: {
        answer,
        grounded,
        keyTokens,
        totalMatches: hits.length,
        citations: top,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 2. PR / diff review ─────────────────────────────────────────────
  // params: { codebaseId?, diff } — diff is a unified-diff string.
  // Detectors run over the ADDED (+) lines only.
  registerLensAction("dx-platform", "reviewDiff", (ctx, _a, params = {}) => {
  try {
    const userId = actor(ctx);
    if (!userId) return { ok: false, error: "auth_required" };
    const diff = String(params.diff || "");
    if (!diff.trim()) return { ok: false, error: "no_diff" };
    const s = getState();
    let enabledSet = defaultEnabled();
    if (params.codebaseId) {
      const cb = userCodebases(s, userId).get(String(params.codebaseId));
      if (cb && Array.isArray(cb.detectorConfig)) enabledSet = new Set(cb.detectorConfig);
    }
    // Parse the unified diff into per-file added-line units.
    const units = [];
    let curPath = null;
    let curLines = [];
    let newLineNo = 0;
    const flush = () => {
      if (curPath && curLines.length) units.push({ path: curPath, lines: curLines });
      curLines = [];
    };
    let addedTotal = 0;
    let removedTotal = 0;
    let fileCount = 0;
    for (const raw of diff.split("\n")) {
      if (raw.startsWith("+++ ")) {
        flush();
        curPath = raw.replace(/^\+\+\+ /, "").replace(/^b\//, "").trim() || "(unknown)";
        fileCount++;
        continue;
      }
      if (raw.startsWith("--- ")) continue;
      const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) { newLineNo = parseInt(hunk[1], 10); continue; }
      if (raw.startsWith("+") && !raw.startsWith("+++")) {
        addedTotal++;
        curLines.push({ n: newLineNo, text: raw.slice(1) });
        newLineNo++;
      } else if (raw.startsWith("-") && !raw.startsWith("---")) {
        removedTotal++;
      } else if (!raw.startsWith("\\")) {
        newLineNo++;
      }
    }
    flush();
    const findings = scanLines(units, enabledSet);
    const bySeverity = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    const blocking = findings.filter((f) => f.severity >= 4).length;
    return {
      ok: true,
      result: {
        filesChanged: fileCount,
        linesAdded: addedTotal,
        linesRemoved: removedTotal,
        findings,
        findingCount: findings.length,
        bySeverity,
        blockingCount: blocking,
        verdict: blocking > 0 ? "changes_requested" : findings.length > 0 ? "advisory" : "clean",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 3. Team dashboard ───────────────────────────────────────────────
  registerLensAction("dx-platform", "createTeam", (ctx, _a, params = {}) => {
    const userId = actor(ctx);
    if (!userId) return { ok: false, error: "auth_required" };
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "no_name" };
    const s = getState();
    const teamId = uid("team");
    const team = {
      id: teamId,
      name: name.slice(0, 120),
      ownerId: userId,
      members: [userId],
      createdAt: now(),
    };
    s.teams.set(teamId, team);
    save();
    return { ok: true, result: { teamId, name: team.name, members: team.members } };
  });

  registerLensAction("dx-platform", "joinTeam", (ctx, _a, params = {}) => {
    const userId = actor(ctx);
    if (!userId) return { ok: false, error: "auth_required" };
    const s = getState();
    const team = s.teams.get(String(params.teamId || ""));
    if (!team) return { ok: false, error: "team_not_found" };
    if (!team.members.includes(userId)) team.members.push(userId);
    // Optionally attach a codebase to the team.
    if (params.codebaseId) {
      const cb = userCodebases(s, userId).get(String(params.codebaseId));
      if (cb) cb.teamId = team.id;
    }
    save();
    return { ok: true, result: { teamId: team.id, name: team.name, members: team.members } };
  });

  // Aggregate findings + severity trends across all codebases attached
  // to a team. Findings are computed live from each member's indexed
  // codebase content — no stored finding rows, no stale data.
  registerLensAction("dx-platform", "teamDashboard", (ctx, _a, params = {}) => {
    const userId = actor(ctx);
    if (!userId) return { ok: false, error: "auth_required" };
    const s = getState();
    const team = s.teams.get(String(params.teamId || ""));
    if (!team) return { ok: false, error: "team_not_found" };
    if (!team.members.includes(userId)) return { ok: false, error: "not_a_member" };
    const enabled = defaultEnabled();
    const perCodebase = [];
    const severityTotals = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    const detectorTotals = {};
    let totalFindings = 0;
    let totalFiles = 0;
    for (const memberId of team.members) {
      const mine = userCodebases(s, memberId);
      for (const cb of mine.values()) {
        if (cb.teamId !== team.id) continue;
        const cfg = Array.isArray(cb.detectorConfig) ? new Set(cb.detectorConfig) : enabled;
        const units = cb.files.map((f) => ({
          path: f.path,
          lines: f.content.split("\n").map((t, i) => ({ n: i + 1, text: t })),
        }));
        const findings = scanLines(units, cfg);
        totalFindings += findings.length;
        totalFiles += cb.files.length;
        const cbSeverity = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        for (const f of findings) {
          severityTotals[f.severity]++;
          cbSeverity[f.severity]++;
          detectorTotals[f.detectorId] = (detectorTotals[f.detectorId] || 0) + 1;
        }
        perCodebase.push({
          codebaseId: cb.id,
          name: cb.name,
          ownerId: memberId,
          fileCount: cb.files.length,
          findingCount: findings.length,
          bySeverity: cbSeverity,
          riskScore: findings.reduce((a, f) => a + f.severity, 0),
        });
      }
    }
    perCodebase.sort((a, b) => b.riskScore - a.riskScore);
    const topDetectors = Object.entries(detectorTotals)
      .map(([id, count]) => ({ detectorId: id, label: DETECTOR_BY_ID.get(id)?.label || id, count }))
      .sort((a, b) => b.count - a.count);
    return {
      ok: true,
      result: {
        teamId: team.id,
        teamName: team.name,
        memberCount: team.members.length,
        codebaseCount: perCodebase.length,
        totalFiles,
        totalFindings,
        severityTotals,
        topDetectors,
        perCodebase,
      },
    };
  });

  // ── 4. Codebase-wide search ─────────────────────────────────────────
  // params: { codebaseId, query, regex?, caseSensitive? }
  registerLensAction("dx-platform", "searchCodebase", (ctx, _a, params = {}) => {
    const userId = actor(ctx);
    if (!userId) return { ok: false, error: "auth_required" };
    const query = String(params.query || "");
    if (!query.trim()) return { ok: false, error: "no_query" };
    const s = getState();
    const cb = userCodebases(s, userId).get(String(params.codebaseId || ""));
    if (!cb) return { ok: false, error: "codebase_not_found" };
    let matcher;
    if (params.regex) {
      try { matcher = new RegExp(query, params.caseSensitive ? "" : "i"); }
      catch { return { ok: false, error: "invalid_regex" }; }
    }
    const cs = !!params.caseSensitive;
    const needle = cs ? query : query.toLowerCase();
    const results = [];
    let truncated = false;
    for (const file of cb.files) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let hit = false;
        if (matcher) hit = matcher.test(line);
        else hit = (cs ? line : line.toLowerCase()).includes(needle);
        if (hit) {
          results.push({ path: file.path, line: i + 1, text: line.trim().slice(0, 260) });
          if (results.length >= 200) { truncated = true; break; }
        }
      }
      if (truncated) break;
    }
    const fileCount = new Set(results.map((r) => r.path)).size;
    return {
      ok: true,
      result: { query, results, matchCount: results.length, fileCount, truncated },
    };
  });

  // ── 5. Detector configuration ───────────────────────────────────────
  registerLensAction("dx-platform", "getDetectorConfig", (ctx, _a, params = {}) => {
  try {
    const userId = actor(ctx);
    if (!userId) return { ok: false, error: "auth_required" };
    const s = getState();
    let enabled = defaultEnabled();
    let codebaseId = null;
    if (params.codebaseId) {
      const cb = userCodebases(s, userId).get(String(params.codebaseId));
      if (!cb) return { ok: false, error: "codebase_not_found" };
      codebaseId = cb.id;
      if (Array.isArray(cb.detectorConfig)) enabled = new Set(cb.detectorConfig);
    }
    const detectors = DETECTORS.map((d) => ({
      id: d.id,
      label: d.label,
      severity: d.severity,
      enabled: enabled.has(d.id),
      defaultOn: d.default,
    }));
    return {
      ok: true,
      result: { codebaseId, detectors, enabledCount: detectors.filter((d) => d.enabled).length, totalCount: detectors.length },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("dx-platform", "setDetectorConfig", (ctx, _a, params = {}) => {
    const userId = actor(ctx);
    if (!userId) return { ok: false, error: "auth_required" };
    const s = getState();
    const cb = userCodebases(s, userId).get(String(params.codebaseId || ""));
    if (!cb) return { ok: false, error: "codebase_not_found" };
    const enabledIds = Array.isArray(params.enabledIds) ? params.enabledIds : null;
    if (!enabledIds) return { ok: false, error: "no_enabled_ids" };
    const valid = enabledIds.filter((id) => DETECTOR_BY_ID.has(String(id))).map(String);
    cb.detectorConfig = [...new Set(valid)];
    save();
    return {
      ok: true,
      result: { codebaseId: cb.id, enabledIds: cb.detectorConfig, enabledCount: cb.detectorConfig.length },
    };
  });

  // ── 6. Usage analytics ──────────────────────────────────────────────
  // recordDetectorFire — log that a detector produced findings.
  registerLensAction("dx-platform", "recordDetectorFire", (ctx, _a, params = {}) => {
    const userId = actor(ctx);
    if (!userId) return { ok: false, error: "auth_required" };
    const detectorId = String(params.detectorId || "");
    if (!DETECTOR_BY_ID.has(detectorId)) return { ok: false, error: "unknown_detector" };
    const bad = badNumericField(params, ["count"]);
    if (bad) return { ok: false, error: `invalid_${bad}` };
    const s = getState();
    const a = userAnalytics(s, userId);
    a.fires.push({
      detectorId,
      count: Math.max(1, parseInt(params.count, 10) || 1),
      codebaseId: params.codebaseId ? String(params.codebaseId) : null,
      at: now(),
    });
    if (a.fires.length > 5000) a.fires = a.fires.slice(-5000);
    save();
    return { ok: true, result: { detectorId, totalFires: a.fires.length } };
  });

  // recordFixOutcome — log accept/reject/ignore of a repair proposal.
  registerLensAction("dx-platform", "recordFixOutcome", (ctx, _a, params = {}) => {
    const userId = actor(ctx);
    if (!userId) return { ok: false, error: "auth_required" };
    const detectorId = String(params.detectorId || "");
    if (!DETECTOR_BY_ID.has(detectorId)) return { ok: false, error: "unknown_detector" };
    const decision = String(params.decision || "");
    if (!["accepted", "rejected", "ignored"].includes(decision)) {
      return { ok: false, error: "invalid_decision" };
    }
    const s = getState();
    const a = userAnalytics(s, userId);
    a.outcomes.push({ detectorId, decision, codebaseId: params.codebaseId ? String(params.codebaseId) : null, at: now() });
    if (a.outcomes.length > 5000) a.outcomes = a.outcomes.slice(-5000);
    save();
    return { ok: true, result: { detectorId, decision, totalOutcomes: a.outcomes.length } };
  });

  // usageAnalytics — which detectors fire most + fix-acceptance rate.
  registerLensAction("dx-platform", "usageAnalytics", (ctx, _a, params = {}) => {
  try {
    const userId = actor(ctx);
    if (!userId) return { ok: false, error: "auth_required" };
    const bad = badNumericField(params, ["windowDays"]);
    if (bad) return { ok: false, error: `invalid_${bad}` };
    const s = getState();
    const a = userAnalytics(s, userId);
    const windowDays = Math.max(1, Math.min(parseInt(params.windowDays, 10) || 30, 365));
    const cutoff = Date.now() - windowDays * 86400000;
    const fires = a.fires.filter((f) => Date.parse(f.at) >= cutoff);
    const outcomes = a.outcomes.filter((o) => Date.parse(o.at) >= cutoff);

    const fireByDetector = {};
    for (const f of fires) fireByDetector[f.detectorId] = (fireByDetector[f.detectorId] || 0) + f.count;
    const topFiring = Object.entries(fireByDetector)
      .map(([id, count]) => ({ detectorId: id, label: DETECTOR_BY_ID.get(id)?.label || id, count }))
      .sort((x, y) => y.count - x.count);

    const accepted = outcomes.filter((o) => o.decision === "accepted").length;
    const rejected = outcomes.filter((o) => o.decision === "rejected").length;
    const ignored = outcomes.filter((o) => o.decision === "ignored").length;
    const decided = accepted + rejected + ignored;
    const acceptanceRate = decided > 0 ? Number((accepted / decided).toFixed(4)) : 0;

    // Per-day acceptance trend (for ChartKit / TimelineView).
    const byDay = new Map();
    for (const o of outcomes) {
      const day = o.at.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { day, accepted: 0, total: 0 });
      const d = byDay.get(day);
      d.total++;
      if (o.decision === "accepted") d.accepted++;
    }
    const acceptanceTrend = [...byDay.values()]
      .sort((x, y) => x.day.localeCompare(y.day))
      .map((d) => ({ day: d.day, accepted: d.accepted, total: d.total, rate: Number((d.accepted / d.total).toFixed(4)) }));

    return {
      ok: true,
      result: {
        windowDays,
        totalFires: fires.reduce((acc, f) => acc + f.count, 0),
        totalDecisions: decided,
        accepted, rejected, ignored,
        acceptanceRate,
        topFiring,
        acceptanceTrend,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 7. CI integration ───────────────────────────────────────────────
  // generateCiConfig — emit a GitHub Action workflow YAML that runs the
  // detector pass as a pre-merge gate.
  registerLensAction("dx-platform", "generateCiConfig", (ctx, _a, params = {}) => {
  try {
    const userId = actor(ctx);
    if (!userId) return { ok: false, error: "auth_required" };
    const codebaseId = String(params.codebaseId || "").trim();
    if (!codebaseId) return { ok: false, error: "no_codebase_id" };
    const s = getState();
    const cb = userCodebases(s, userId).get(codebaseId);
    if (!cb) return { ok: false, error: "codebase_not_found" };
    const failOn = ["error", "warning", "any"].includes(String(params.failOn))
      ? String(params.failOn) : "error";
    const minSeverity = failOn === "any" ? 1 : failOn === "warning" ? 3 : 4;
    const enabled = Array.isArray(cb.detectorConfig) && cb.detectorConfig.length
      ? cb.detectorConfig : [...defaultEnabled()];
    const yaml = [
      "name: Concord DX detector gate",
      "on:",
      "  pull_request:",
      "    branches: [main, master]",
      "jobs:",
      "  dx-detectors:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - name: Run Concord DX detector pass",
      "        uses: concord-os/dx-action@v1",
      "        with:",
      `          codebase-id: ${codebaseId}`,
      `          fail-on: ${failOn}`,
      `          detectors: ${enabled.join(",")}`,
    ].join("\n");
    return {
      ok: true,
      result: {
        codebaseId,
        path: ".github/workflows/concord-dx.yml",
        failOn,
        minSeverity,
        enabledDetectors: enabled,
        workflowYaml: yaml,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ciGateCheck — turn a reviewDiff-style result into a pre-merge verdict.
  // params: { findings: [{severity}], failOn? }
  registerLensAction("dx-platform", "ciGateCheck", (ctx, _a, params = {}) => {
    const userId = actor(ctx);
    if (!userId) return { ok: false, error: "auth_required" };
    const findings = Array.isArray(params.findings) ? params.findings : [];
    const failOn = ["error", "warning", "any"].includes(String(params.failOn))
      ? String(params.failOn) : "error";
    const minSeverity = failOn === "any" ? 1 : failOn === "warning" ? 3 : 4;
    const blocking = findings.filter((f) => Number(f?.severity) >= minSeverity);
    const passed = blocking.length === 0;
    return {
      ok: true,
      result: {
        passed,
        failOn,
        minSeverity,
        totalFindings: findings.length,
        blockingFindings: blocking.length,
        verdict: passed ? "pass" : "fail",
        summary: passed
          ? `Gate passed — ${findings.length} finding(s), none at or above severity ${minSeverity}.`
          : `Gate failed — ${blocking.length} finding(s) at or above severity ${minSeverity}.`,
      },
    };
  });
}
