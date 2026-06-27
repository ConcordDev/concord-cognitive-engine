// server/domains/code-quality.js
//
// Code Quality lens — parity layer vs SonarQube / CodeClimate. The
// detector suite (server/domains/detectors.js) covers the platform's
// internal architectural-drift detectors; this domain is the
// user-facing static-analysis surface: a real per-language analyzer
// that runs over *submitted* source code and produces per-line issue
// annotations, a technical-debt estimate, duplication / hotspot
// reports, a configurable quality gate, an issue-workflow store, and
// pull-request diff decoration.
//
// Everything is real computation — the analyzer tokenizes and walks
// the submitted source; there is no synthesized / seeded data. Per-user
// persistence lives in globalThis._concordSTATE Maps keyed by userId.
//
// All handlers are try/catch-wrapped and return { ok, result?, error? }
// envelopes — they never throw.

// ---------------------------------------------------------------------------
// Persistent per-user state
// ---------------------------------------------------------------------------

function stateRoot() {
  const S = (globalThis._concordSTATE = globalThis._concordSTATE || {});
  if (!S.codeQuality) {
    S.codeQuality = {
      scans: new Map(), // userId -> [scan, ...] (most-recent last)
      issues: new Map(), // userId -> Map(issueId -> issueRecord)
      gates: new Map(), // userId -> gateConfig
    };
  }
  return S.codeQuality;
}

function userId(ctx) {
  return String(ctx?.actor?.userId || ctx?.userId || "anon");
}

function userScans(ctx) {
  const root = stateRoot();
  const uid = userId(ctx);
  if (!root.scans.has(uid)) root.scans.set(uid, []);
  return root.scans.get(uid);
}

function userIssues(ctx) {
  const root = stateRoot();
  const uid = userId(ctx);
  if (!root.issues.has(uid)) root.issues.set(uid, new Map());
  return root.issues.get(uid);
}

const DEFAULT_GATE = {
  maxCritical: 0,
  maxHigh: 0,
  maxBlockerDebtHours: 8,
  minMaintainability: 70, // 0..100 maintainability index floor
  maxDuplicationPct: 5,
  blockOnNewCritical: true,
};

function userGate(ctx) {
  const root = stateRoot();
  const uid = userId(ctx);
  if (!root.gates.has(uid)) root.gates.set(uid, { ...DEFAULT_GATE });
  return root.gates.get(uid);
}

// ---------------------------------------------------------------------------
// Source utilities
// ---------------------------------------------------------------------------

function rid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Fail-CLOSED numeric guard (copied from server/domains/literary.js). Any
// listed field that is *present* must be a finite, non-negative number within
// a sane bound — an absent field is fine (the macro uses its default). Returns
// null when clean, or the offending key. Used so a poisoned NaN/Infinity/-1/
// 1e308/"abc" fails with invalid_<field> instead of silently clamping to a
// success (the macro-assassin V2 vector). Pass a custom { min } per field when
// a non-negative floor doesn't apply.
function badNumericField(input, keys, opts = {}) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    const min = opts.min != null ? opts.min : 0;
    const max = opts.max != null ? opts.max : 1e6;
    if (!Number.isFinite(n) || n < min || n > max) return k;
  }
  return null;
}

const LANG_BY_EXT = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python", rb: "ruby", go: "go", java: "java",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", cs: "csharp",
  rs: "rust", php: "php", swift: "swift", kt: "kotlin",
};

function detectLanguage(file, explicit) {
  if (explicit) return String(explicit).toLowerCase();
  const ext = String(file || "").split(".").pop().toLowerCase();
  return LANG_BY_EXT[ext] || "generic";
}

// Strip string literals + comments so token heuristics don't false-fire
// inside them. Returns a same-length string with literals blanked.
function maskLine(line, lang) {
  let out = "";
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    const c2 = line.slice(i, i + 2);
    if (c2 === "//" && lang !== "python") { out += " ".repeat(n - i); break; }
    if (c === "#" && (lang === "python" || lang === "ruby")) { out += " ".repeat(n - i); break; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += " ";
      i++;
      while (i < n && line[i] !== q) {
        if (line[i] === "\\") { out += "  "; i += 2; continue; }
        out += " ";
        i++;
      }
      if (i < n) { out += " "; i++; }
      continue;
    }
    out += c;
    i++;
  }
  return out.padEnd(line.length, " ").slice(0, line.length);
}

// Normalize a line for duplication hashing — collapse whitespace,
// drop trailing punctuation noise.
function normalizeForDup(line) {
  return line.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// The analyzer — produces per-line findings + metrics for one file
// ---------------------------------------------------------------------------

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

// Per-rule remediation-effort estimate, in minutes. Drives the
// technical-debt total. Values are deliberately conservative.
const RULE_EFFORT_MIN = {
  "long-function": 45,
  "deep-nesting": 30,
  "high-complexity": 60,
  "long-line": 5,
  "magic-number": 10,
  "todo-marker": 15,
  "debug-statement": 5,
  "empty-catch": 20,
  "loose-equality": 5,
  "var-declaration": 8,
  "duplicate-block": 40,
  "trailing-whitespace": 2,
  "many-params": 25,
  "commented-code": 8,
};

function analyzeFile({ file, source, language }) {
  const lang = detectLanguage(file, language);
  const rawLines = String(source || "").split(/\r?\n/);
  const findings = [];
  let codeLines = 0;
  let commentLines = 0;
  let blankLines = 0;

  // --- per-line pass ---------------------------------------------------
  const masked = [];
  let blockComment = false;
  for (let idx = 0; idx < rawLines.length; idx++) {
    const lineNo = idx + 1;
    const raw = rawLines[idx];
    const trimmed = raw.trim();

    // block-comment tracking (C-family + similar)
    let isComment = blockComment;
    if (blockComment) {
      if (trimmed.includes("*/")) blockComment = false;
    } else if (trimmed.startsWith("/*")) {
      isComment = true;
      if (!trimmed.includes("*/")) blockComment = true;
    } else if (
      trimmed.startsWith("//") ||
      (trimmed.startsWith("#") && (lang === "python" || lang === "ruby")) ||
      trimmed.startsWith("*")
    ) {
      isComment = true;
    }

    if (trimmed === "") blankLines++;
    else if (isComment) commentLines++;
    else codeLines++;

    const m = maskLine(raw, lang);
    masked.push(isComment ? "" : m);

    if (trimmed === "") continue;

    // long line
    if (raw.length > 120) {
      findings.push(mkFinding("long-line", "low", lineNo, raw,
        `Line is ${raw.length} chars (>120).`,
        "Wrap or refactor to keep lines under 120 columns."));
    }
    // trailing whitespace
    if (/[ \t]+$/.test(raw)) {
      findings.push(mkFinding("trailing-whitespace", "info", lineNo, raw,
        "Trailing whitespace.",
        "Strip trailing whitespace (most editors do this on save)."));
    }
    if (isComment) {
      // commented-out code heuristic
      const body = trimmed.replace(/^[/*#\s]+/, "");
      if (/[;{}]\s*$/.test(body) && /[=(]/.test(body) && body.length > 12) {
        findings.push(mkFinding("commented-code", "low", lineNo, raw,
          "Looks like commented-out code.",
          "Delete dead commented code — version control already keeps history."));
      }
      if (/\b(TODO|FIXME|HACK|XXX)\b/.test(trimmed)) {
        findings.push(mkFinding("todo-marker", "info", lineNo, raw,
          `Unresolved ${(trimmed.match(/\b(TODO|FIXME|HACK|XXX)\b/) || [])[0]} marker.`,
          "Convert to a tracked issue or resolve it."));
      }
      continue;
    }

    const code = masked[idx];

    // debug statements
    if (/\bconsole\.(log|debug|trace)\s*\(/.test(code) ||
        /\bprint\s*\(/.test(code) && lang === "python" ||
        /\bdebugger\b/.test(code)) {
      findings.push(mkFinding("debug-statement", "medium", lineNo, raw,
        "Debug / print statement left in source.",
        "Remove debug output or route it through a logger."));
    }
    // loose equality (JS/TS)
    if ((lang === "javascript" || lang === "typescript") &&
        /[^=!<>]==[^=]/.test(` ${code} `) && !/===/.test(code)) {
      findings.push(mkFinding("loose-equality", "medium", lineNo, raw,
        "Loose equality (== / !=) — use strict equality.",
        "Replace == with === and != with !==."));
    }
    // var declaration (JS/TS)
    if ((lang === "javascript" || lang === "typescript") &&
        /(^|\s)var\s+[A-Za-z_$]/.test(code)) {
      findings.push(mkFinding("var-declaration", "low", lineNo, raw,
        "`var` declaration — prefer `let` / `const`.",
        "Replace `var` with `const` (or `let` if reassigned)."));
    }
    // magic numbers (skip 0,1,2,-1, common HTTP codes are still flagged low)
    const magic = code.match(/(?<![\w.])-?\d{2,}(?!\w)/g);
    if (magic) {
      const real = magic.filter((x) => !["100", "1000"].includes(x.replace("-", "")));
      if (real.length) {
        findings.push(mkFinding("magic-number", "low", lineNo, raw,
          `Magic number(s): ${[...new Set(real)].slice(0, 4).join(", ")}.`,
          "Extract to a named constant."));
      }
    }
    // empty catch
    if (/\bcatch\b[^{]*\{\s*\}/.test(code) ||
        /\bcatch\b[^{]*\{\s*$/.test(code) && (masked[idx + 1] || "").trim() === "}") {
      findings.push(mkFinding("empty-catch", "high", lineNo, raw,
        "Empty catch block silently swallows errors.",
        "Log the error, rethrow, or document why it is safely ignored."));
    }
  }

  // --- function-level pass --------------------------------------------
  const fns = extractFunctions(masked, rawLines, lang);
  for (const fn of fns) {
    if (fn.lineCount > 60) {
      findings.push(mkFinding("long-function", "high", fn.startLine,
        rawLines[fn.startLine - 1] || "",
        `Function spans ${fn.lineCount} lines (>60).`,
        "Decompose into smaller single-purpose functions."));
    } else if (fn.lineCount > 40) {
      findings.push(mkFinding("long-function", "medium", fn.startLine,
        rawLines[fn.startLine - 1] || "",
        `Function spans ${fn.lineCount} lines (>40).`,
        "Consider extracting helpers."));
    }
    if (fn.maxNesting >= 5) {
      findings.push(mkFinding("deep-nesting", "high", fn.startLine,
        rawLines[fn.startLine - 1] || "",
        `Nesting depth ${fn.maxNesting} (>=5).`,
        "Flatten with early returns or guard clauses."));
    } else if (fn.maxNesting === 4) {
      findings.push(mkFinding("deep-nesting", "medium", fn.startLine,
        rawLines[fn.startLine - 1] || "",
        `Nesting depth ${fn.maxNesting}.`,
        "Reduce nesting with early returns."));
    }
    if (fn.complexity >= 15) {
      findings.push(mkFinding("high-complexity", "critical", fn.startLine,
        rawLines[fn.startLine - 1] || "",
        `Cyclomatic complexity ${fn.complexity} (>=15) — very hard to test.`,
        "Split decision logic into separate functions / polymorphism."));
    } else if (fn.complexity >= 10) {
      findings.push(mkFinding("high-complexity", "high", fn.startLine,
        rawLines[fn.startLine - 1] || "",
        `Cyclomatic complexity ${fn.complexity} (>=10).`,
        "Reduce branches; extract helpers."));
    }
    if (fn.paramCount > 5) {
      findings.push(mkFinding("many-params", "medium", fn.startLine,
        rawLines[fn.startLine - 1] || "",
        `Function takes ${fn.paramCount} parameters (>5).`,
        "Group related parameters into an options object."));
    }
  }

  // --- duplication pass (within-file, 4+ identical consecutive lines) --
  const dupBlocks = findDuplicateBlocks(masked, rawLines);
  for (const blk of dupBlocks) {
    findings.push(mkFinding("duplicate-block", "medium", blk.firstStart,
      rawLines[blk.firstStart - 1] || "",
      `${blk.length}-line block duplicated ${blk.occurrences}× (also at line ${blk.secondStart}).`,
      "Extract the repeated block into a shared function."));
  }

  // --- metrics ---------------------------------------------------------
  const totalLines = rawLines.length;
  const fileComplexity = fns.reduce((s, f) => s + f.complexity, 1);
  const avgComplexity = fns.length ? fileComplexity / fns.length : 1;
  const dupLines = dupBlocks.reduce((s, b) => s + b.length * b.occurrences, 0);
  const duplicationPct = codeLines ? Math.round((dupLines / codeLines) * 1000) / 10 : 0;
  const commentDensity = codeLines ? Math.round((commentLines / (codeLines + commentLines)) * 100) : 0;
  const maintainability = maintainabilityIndex({
    codeLines, avgComplexity, duplicationPct, findingCount: findings.length,
  });
  const debtMinutes = findings.reduce(
    (s, f) => s + (RULE_EFFORT_MIN[f.rule] || 10), 0);

  return {
    file: file || "untitled",
    language: lang,
    findings: findings.sort((a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.line - b.line),
    metrics: {
      totalLines,
      codeLines,
      commentLines,
      blankLines,
      functionCount: fns.length,
      avgComplexity: Math.round(avgComplexity * 10) / 10,
      maxComplexity: fns.reduce((m, f) => Math.max(m, f.complexity), 0),
      duplicationPct,
      duplicateBlocks: dupBlocks.length,
      commentDensity,
      maintainability,
      debtMinutes,
      debtHours: Math.round((debtMinutes / 60) * 10) / 10,
    },
    functions: fns.map((f) => ({
      name: f.name,
      startLine: f.startLine,
      endLine: f.endLine,
      lineCount: f.lineCount,
      complexity: f.complexity,
      maxNesting: f.maxNesting,
      paramCount: f.paramCount,
    })),
  };
}

function mkFinding(rule, severity, line, raw, message, fixHint) {
  return {
    rule,
    severity,
    line,
    column: Math.max(1, (raw || "").length - (raw || "").trimStart().length + 1),
    source: (raw || "").slice(0, 240),
    message,
    fixHint,
    effortMin: RULE_EFFORT_MIN[rule] || 10,
  };
}

// Cyclomatic-ish complexity: count decision keywords + boolean operators.
const BRANCH_RE = /\b(if|else if|for|while|case|catch|&&|\|\||\?)\b|\?/g;

function extractFunctions(masked, rawLines, lang) {
  const fns = [];
  const fnHeadRe =
    lang === "python"
      ? /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/
      : /(?:function\s+([A-Za-z_$][\w$]*)|(?:^|\s)([A-Za-z_$][\w$]*)\s*(?:=|:)\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>)|([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{)/;

  for (let i = 0; i < masked.length; i++) {
    const line = masked[i];
    if (!line.trim()) continue;
    const m = line.match(fnHeadRe);
    if (!m) continue;
    const name = m[1] || m[2] || m[3] || "(anonymous)";
    const paramSrc = (line.match(/\(([^)]*)\)/) || [])[1] || "";
    const paramCount = paramSrc.trim()
      ? paramSrc.split(",").filter((p) => p.trim()).length
      : 0;

    let endLine;
    let bodyLines;
    if (lang === "python") {
      const indent = line.length - line.trimStart().length;
      let j = i + 1;
      while (j < masked.length) {
        const ln = masked[j];
        if (ln.trim() && ln.length - ln.trimStart().length <= indent) break;
        j++;
      }
      endLine = j;
      bodyLines = masked.slice(i, j);
    } else {
      // brace matching from first '{' on/after the header line
      let depth = 0;
      let started = false;
      let j = i;
      for (; j < masked.length; j++) {
        for (const ch of masked[j]) {
          if (ch === "{") { depth++; started = true; }
          else if (ch === "}") depth--;
        }
        if (started && depth <= 0) break;
      }
      endLine = Math.min(j + 1, masked.length);
      bodyLines = masked.slice(i, endLine);
    }

    // complexity + nesting over the body
    let complexity = 1;
    let nesting = 0;
    let maxNesting = 0;
    for (const ln of bodyLines) {
      const matches = ln.match(BRANCH_RE);
      if (matches) complexity += matches.length;
      for (const ch of ln) {
        if (ch === "{") { nesting++; maxNesting = Math.max(maxNesting, nesting); }
        else if (ch === "}") nesting = Math.max(0, nesting - 1);
      }
    }
    if (lang === "python") {
      // approximate nesting by indentation steps
      const base = line.length - line.trimStart().length;
      let mx = 0;
      for (const ln of bodyLines) {
        if (!ln.trim()) continue;
        mx = Math.max(mx, Math.floor(((ln.length - ln.trimStart().length) - base) / 4));
      }
      maxNesting = mx;
    }

    fns.push({
      name,
      startLine: i + 1,
      endLine,
      lineCount: endLine - i,
      complexity,
      maxNesting,
      paramCount,
    });
    if (lang !== "python") i = endLine - 1; // skip to end for brace-langs
  }
  return fns;
}

// Find consecutive duplicate blocks (>=4 normalized lines) within a file.
function findDuplicateBlocks(masked, rawLines) {
  const MIN = 4;
  const norm = rawLines.map((l) => normalizeForDup(l));
  const blocks = [];
  const seen = new Map(); // hash -> firstStart line(1-based)
  for (let i = 0; i + MIN <= norm.length; i++) {
    const slice = norm.slice(i, i + MIN);
    if (slice.some((l) => l.length < 3)) continue; // skip trivial/blank runs
    const key = slice.join("");
    if (seen.has(key)) {
      const firstStart = seen.get(key);
      if (i + 1 - firstStart >= MIN) {
        blocks.push({
          firstStart,
          secondStart: i + 1,
          length: MIN,
          occurrences: 2,
        });
        i += MIN - 1;
      }
    } else {
      seen.set(key, i + 1);
    }
  }
  return blocks;
}

// Maintainability index, 0..100. Loosely modeled on the classic MI
// formula but bounded + simplified for submitted snippets.
function maintainabilityIndex({ codeLines, avgComplexity, duplicationPct, findingCount }) {
  if (codeLines === 0) return 100;
  const volume = Math.log2(codeLines + 1) * 8;
  const cx = avgComplexity * 2.4;
  const dup = duplicationPct * 0.8;
  const density = (findingCount / codeLines) * 60;
  const raw = 100 - volume * 0.35 - cx - dup - density;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function blankTotals() {
  return { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function tallySeverity(findings) {
  const t = blankTotals();
  for (const f of findings) {
    t.total++;
    if (t[f.severity] !== undefined) t[f.severity]++;
  }
  return t;
}

function gradeLetter(maintainability) {
  if (maintainability >= 85) return "A";
  if (maintainability >= 70) return "B";
  if (maintainability >= 55) return "C";
  if (maintainability >= 40) return "D";
  return "F";
}

// ---------------------------------------------------------------------------
// Quality gate evaluation
// ---------------------------------------------------------------------------

function evaluateGate(gate, { totals, metrics, newCriticalCount }) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });

  add("critical-issues", totals.critical <= gate.maxCritical,
    `${totals.critical} critical (limit ${gate.maxCritical})`);
  add("high-issues", totals.high <= gate.maxHigh,
    `${totals.high} high (limit ${gate.maxHigh})`);
  add("technical-debt", metrics.debtHours <= gate.maxBlockerDebtHours,
    `${metrics.debtHours}h debt (limit ${gate.maxBlockerDebtHours}h)`);
  add("maintainability", metrics.maintainability >= gate.minMaintainability,
    `MI ${metrics.maintainability} (floor ${gate.minMaintainability})`);
  add("duplication", metrics.duplicationPct <= gate.maxDuplicationPct,
    `${metrics.duplicationPct}% duplicated (limit ${gate.maxDuplicationPct}%)`);
  if (gate.blockOnNewCritical && newCriticalCount != null) {
    add("no-new-critical", newCriticalCount === 0,
      `${newCriticalCount} new critical issue(s) vs baseline`);
  }

  const failed = checks.filter((c) => !c.pass);
  return {
    passed: failed.length === 0,
    status: failed.length === 0 ? "PASS" : "FAIL",
    checks,
    failedCount: failed.length,
  };
}

// ---------------------------------------------------------------------------
// Domain registration
// ---------------------------------------------------------------------------

export default function registerCodeQualityActions(registerLensAction) {
  // NOTE: code-quality.* is registered into the canonical MACROS registry by
  // server/domains/detectors.js (the `codeQualityAdapter` there bridges the
  // legacy 3-arg (ctx, artifact, params) handlers onto register(ctx, input)).
  // So this module is NOT imported directly in server.js and keeps the legacy
  // registrar signature detectors.js passes — do NOT add an internal shim here
  // or the handler params get double-wrapped. The flawless-loop pass added the
  // fail-closed numeric guards + manifest/UX fixes; the wiring was already real.

  // -- analyze: run the analyzer over one or more submitted files ----------
  // params: { files: [{ path, content, language? }] }  OR  { source, file?, language? }
  registerLensAction("code-quality", "analyze", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      let files = Array.isArray(p.files) ? p.files : null;
      if (!files && typeof p.source === "string") {
        files = [{ path: p.file || "snippet", content: p.source, language: p.language }];
      }
      if (!files || !files.length) {
        return { ok: false, error: "no_source_provided" };
      }
      const fileReports = [];
      for (const f of files) {
        const content = String(f.content ?? f.source ?? "");
        if (!content) continue;
        fileReports.push(analyzeFile({
          file: f.path || f.file || "untitled",
          source: content,
          language: f.language,
        }));
      }
      if (!fileReports.length) return { ok: false, error: "all_files_empty" };

      const allFindings = fileReports.flatMap((r) =>
        r.findings.map((x) => ({ ...x, file: r.file })));
      const totals = tallySeverity(allFindings);
      const metrics = aggregateMetrics(fileReports);
      const scanId = rid("scan");
      const scan = {
        scanId,
        createdAt: new Date().toISOString(),
        fileCount: fileReports.length,
        totals,
        metrics,
        grade: gradeLetter(metrics.maintainability),
        files: fileReports,
      };
      const scans = userScans(ctx);
      scans.push({
        scanId: scan.scanId,
        createdAt: scan.createdAt,
        fileCount: scan.fileCount,
        totals: scan.totals,
        metrics: scan.metrics,
        grade: scan.grade,
        // store full file reports for later annotation lookups
        files: fileReports,
      });
      if (scans.length > 100) scans.splice(0, scans.length - 100);

      return { ok: true, result: scan };
    } catch (e) {
      return { ok: false, error: `analyze_failed: ${e.message}` };
    }
  }, { note: "static-analyze submitted source — issues + metrics + grade" });

  // -- annotate: per-file / per-line findings with source context ---------
  // params: { scanId?, file? }   (defaults to most-recent scan)
  registerLensAction("code-quality", "annotate", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const scans = userScans(ctx);
      if (!scans.length) return { ok: false, error: "no_scans_yet" };
      const scan = p.scanId
        ? scans.find((s) => s.scanId === p.scanId)
        : scans[scans.length - 1];
      if (!scan) return { ok: false, error: "scan_not_found" };

      const files = p.file
        ? scan.files.filter((f) => f.file === p.file)
        : scan.files;
      if (!files.length) return { ok: false, error: "file_not_found" };

      // Build per-line annotation map.
      const annotated = files.map((fr) => {
        const byLine = new Map();
        for (const f of fr.findings) {
          if (!byLine.has(f.line)) byLine.set(f.line, []);
          byLine.get(f.line).push(f);
        }
        const annotations = [...byLine.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([line, issues]) => ({
            line,
            issues: issues.map((i) => ({
              rule: i.rule, severity: i.severity, message: i.message,
              fixHint: i.fixHint, column: i.column,
            })),
            context: issues[0].source,
            worstSeverity: issues
              .map((i) => i.severity)
              .sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0],
          }));
        return {
          file: fr.file,
          language: fr.language,
          totalLines: fr.metrics.totalLines,
          annotationCount: annotations.length,
          annotations,
        };
      });
      void files;
      return {
        ok: true,
        result: {
          scanId: scan.scanId,
          files: annotated,
        },
      };
    } catch (e) {
      return { ok: false, error: `annotate_failed: ${e.message}` };
    }
  }, { note: "per-line issue annotations with source context" });

  // -- trend: issue counts over time across the user's scan history -------
  registerLensAction("code-quality", "trend", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const badNum = badNumericField(p, ["limit"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const limit = Math.min(Math.max(Number(p.limit) || 30, 1), 100);
      const scans = userScans(ctx);
      const recent = scans.slice(-limit);
      const points = recent.map((s) => ({
        scanId: s.scanId,
        at: s.createdAt,
        total: s.totals.total,
        critical: s.totals.critical,
        high: s.totals.high,
        medium: s.totals.medium,
        low: s.totals.low,
        info: s.totals.info,
        debtHours: s.metrics.debtHours,
        maintainability: s.metrics.maintainability,
        duplicationPct: s.metrics.duplicationPct,
        grade: s.grade,
      }));
      let delta = null;
      if (points.length >= 2) {
        const a = points[points.length - 2];
        const b = points[points.length - 1];
        delta = {
          total: b.total - a.total,
          critical: b.critical - a.critical,
          debtHours: Math.round((b.debtHours - a.debtHours) * 10) / 10,
          maintainability: b.maintainability - a.maintainability,
        };
      }
      return {
        ok: true,
        result: { points, scanCount: scans.length, delta },
      };
    } catch (e) {
      return { ok: false, error: `trend_failed: ${e.message}` };
    }
  }, { note: "issue-count trend over scan history" });

  // -- debt: technical-debt estimate breakdown ----------------------------
  registerLensAction("code-quality", "debt", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const scans = userScans(ctx);
      if (!scans.length) return { ok: false, error: "no_scans_yet" };
      const scan = p.scanId
        ? scans.find((s) => s.scanId === p.scanId)
        : scans[scans.length - 1];
      if (!scan) return { ok: false, error: "scan_not_found" };

      const byRule = new Map();
      const bySeverity = new Map();
      let totalMin = 0;
      for (const fr of scan.files) {
        for (const f of fr.findings) {
          const eff = RULE_EFFORT_MIN[f.rule] || 10;
          totalMin += eff;
          byRule.set(f.rule, (byRule.get(f.rule) || 0) + eff);
          bySeverity.set(f.severity, (bySeverity.get(f.severity) || 0) + eff);
        }
      }
      const ruleRows = [...byRule.entries()]
        .map(([rule, min]) => ({
          rule, minutes: min, hours: Math.round((min / 60) * 10) / 10,
          count: countRule(scan, rule),
        }))
        .sort((a, b) => b.minutes - a.minutes);
      const severityRows = [...bySeverity.entries()]
        .map(([severity, min]) => ({
          severity, minutes: min, hours: Math.round((min / 60) * 10) / 10,
        }))
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

      const hours = totalMin / 60;
      // SQALE-style debt ratio: debt vs estimated dev cost (30 min/codeline).
      const devCostMin = scan.metrics.codeLines * 30;
      const debtRatio = devCostMin
        ? Math.round((totalMin / devCostMin) * 1000) / 10
        : 0;

      return {
        ok: true,
        result: {
          scanId: scan.scanId,
          totalMinutes: totalMin,
          totalHours: Math.round(hours * 10) / 10,
          workdays: Math.round((hours / 8) * 100) / 100,
          debtRatioPct: debtRatio,
          rating: debtRatio <= 5 ? "A" : debtRatio <= 10 ? "B"
            : debtRatio <= 20 ? "C" : debtRatio <= 50 ? "D" : "E",
          byRule: ruleRows,
          bySeverity: severityRows,
        },
      };
    } catch (e) {
      return { ok: false, error: `debt_failed: ${e.message}` };
    }
  }, { note: "technical-debt estimate (remediation hours)" });

  // -- duplication: duplication + complexity hotspot report ---------------
  registerLensAction("code-quality", "hotspots", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const scans = userScans(ctx);
      if (!scans.length) return { ok: false, error: "no_scans_yet" };
      const scan = p.scanId
        ? scans.find((s) => s.scanId === p.scanId)
        : scans[scans.length - 1];
      if (!scan) return { ok: false, error: "scan_not_found" };

      // duplicate blocks across all files
      const duplicates = [];
      for (const fr of scan.files) {
        for (const f of fr.findings.filter((x) => x.rule === "duplicate-block")) {
          duplicates.push({
            file: fr.file, line: f.line, message: f.message,
            severity: f.severity,
          });
        }
      }
      // complexity / size hotspots — rank functions by a risk score
      const fnHotspots = [];
      for (const fr of scan.files) {
        for (const fn of fr.functions) {
          const risk =
            fn.complexity * 3 + fn.maxNesting * 4 +
            Math.max(0, fn.lineCount - 40) * 0.5;
          if (risk > 18) {
            fnHotspots.push({
              file: fr.file, function: fn.name,
              startLine: fn.startLine, lineCount: fn.lineCount,
              complexity: fn.complexity, maxNesting: fn.maxNesting,
              riskScore: Math.round(risk),
            });
          }
        }
      }
      fnHotspots.sort((a, b) => b.riskScore - a.riskScore);

      // file-level hotspot ranking
      const fileHotspots = scan.files
        .map((fr) => ({
          file: fr.file,
          findings: fr.findings.length,
          duplicationPct: fr.metrics.duplicationPct,
          maxComplexity: fr.metrics.maxComplexity,
          maintainability: fr.metrics.maintainability,
          score: Math.round(
            fr.findings.length * 2 +
            fr.metrics.duplicationPct * 1.5 +
            fr.metrics.maxComplexity +
            (100 - fr.metrics.maintainability) * 0.5),
        }))
        .sort((a, b) => b.score - a.score);

      return {
        ok: true,
        result: {
          scanId: scan.scanId,
          duplicateBlocks: duplicates,
          duplicationPct: scan.metrics.duplicationPct,
          functionHotspots: fnHotspots.slice(0, 25),
          fileHotspots,
        },
      };
    } catch (e) {
      return { ok: false, error: `hotspots_failed: ${e.message}` };
    }
  }, { note: "duplication + complexity hotspot report" });

  // -- gate config: get / set the quality-gate thresholds -----------------
  registerLensAction("code-quality", "getGate", (ctx) => {
    try {
      return { ok: true, result: { gate: userGate(ctx), defaults: DEFAULT_GATE } };
    } catch (e) {
      return { ok: false, error: `getGate_failed: ${e.message}` };
    }
  }, { note: "read quality-gate config" });

  registerLensAction("code-quality", "setGate", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const numKeys = ["maxCritical", "maxHigh", "maxBlockerDebtHours",
        "minMaintainability", "maxDuplicationPct"];
      // Fail-CLOSED: a present numeric threshold must be a finite, non-negative
      // value — reject a poisoned NaN/Infinity/-1/1e308 instead of silently
      // skipping it (the prior `Number.isFinite` guard quietly ignored a bad
      // value, leaving the gate at its old setting and reporting ok:true).
      const badNum = badNumericField(p, numKeys);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const gate = userGate(ctx);
      for (const k of numKeys) {
        if (p[k] != null) {
          gate[k] = Math.max(0, Number(p[k]));
        }
      }
      if (p.blockOnNewCritical != null) {
        gate.blockOnNewCritical = !!p.blockOnNewCritical;
      }
      return { ok: true, result: { gate } };
    } catch (e) {
      return { ok: false, error: `setGate_failed: ${e.message}` };
    }
  }, { note: "update quality-gate thresholds" });

  // -- gate evaluation: pass/fail against the configured gate -------------
  registerLensAction("code-quality", "evaluateGate", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const scans = userScans(ctx);
      if (!scans.length) return { ok: false, error: "no_scans_yet" };
      const scan = p.scanId
        ? scans.find((s) => s.scanId === p.scanId)
        : scans[scans.length - 1];
      if (!scan) return { ok: false, error: "scan_not_found" };
      const gate = userGate(ctx);

      // compare new criticals vs the prior scan (baseline regression check)
      let newCriticalCount = null;
      const idx = scans.indexOf(scan);
      if (idx > 0) {
        newCriticalCount = Math.max(0,
          scan.totals.critical - scans[idx - 1].totals.critical);
      }
      const verdict = evaluateGate(gate, {
        totals: scan.totals,
        metrics: scan.metrics,
        newCriticalCount,
      });
      return {
        ok: true,
        result: {
          scanId: scan.scanId,
          gate,
          ...verdict,
          newCriticalCount,
        },
      };
    } catch (e) {
      return { ok: false, error: `evaluateGate_failed: ${e.message}` };
    }
  }, { note: "evaluate scan against the quality gate" });

  // -- PR decoration: new issues introduced in a diff ---------------------
  // params: { base: [{path,content}], head: [{path,content}] }
  registerLensAction("code-quality", "decoratePR", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const base = Array.isArray(p.base) ? p.base : [];
      const head = Array.isArray(p.head) ? p.head : [];
      if (!head.length) return { ok: false, error: "head_files_required" };

      const baseByPath = new Map(
        base.map((f) => [f.path || f.file, String(f.content ?? f.source ?? "")]));

      const fileResults = [];
      let newCount = 0;
      let fixedCount = 0;
      let unchangedCount = 0;
      for (const hf of head) {
        const pathKey = hf.path || hf.file || "untitled";
        const headContent = String(hf.content ?? hf.source ?? "");
        const baseContent = baseByPath.get(pathKey) || "";
        const headReport = analyzeFile({ file: pathKey, source: headContent, language: hf.language });
        const baseReport = baseContent
          ? analyzeFile({ file: pathKey, source: baseContent, language: hf.language })
          : { findings: [] };

        // fingerprint a finding by rule + normalized source (line-shift tolerant)
        const fp = (f) => `${f.rule}::${normalizeForDup(f.source)}`;
        const baseFp = new Set(baseReport.findings.map(fp));
        const headFp = new Set(headReport.findings.map(fp));

        const newIssues = headReport.findings.filter((f) => !baseFp.has(fp(f)));
        const fixedIssues = baseReport.findings.filter((f) => !headFp.has(fp(f)));
        const unchanged = headReport.findings.filter((f) => baseFp.has(fp(f)));

        newCount += newIssues.length;
        fixedCount += fixedIssues.length;
        unchangedCount += unchanged.length;

        fileResults.push({
          file: pathKey,
          isNew: !baseByPath.has(pathKey),
          newIssues: newIssues.map((f) => ({
            rule: f.rule, severity: f.severity, line: f.line,
            message: f.message, fixHint: f.fixHint, source: f.source,
          })),
          fixedIssues: fixedIssues.length,
          unchangedIssues: unchanged.length,
          maintainabilityDelta:
            (headReport.metrics?.maintainability || 0) -
            (baseReport.metrics?.maintainability || 100),
        });
      }

      const gate = userGate(ctx);
      const newBySeverity = blankTotals();
      for (const fr of fileResults) {
        for (const ni of fr.newIssues) {
          newBySeverity.total++;
          if (newBySeverity[ni.severity] !== undefined) newBySeverity[ni.severity]++;
        }
      }
      const verdict =
        newBySeverity.critical > gate.maxCritical ? "BLOCK"
          : newBySeverity.high > 0 ? "WARN"
            : newCount > 0 ? "COMMENT"
              : "APPROVE";

      return {
        ok: true,
        result: {
          summary: {
            newIssues: newCount,
            fixedIssues: fixedCount,
            unchangedIssues: unchangedCount,
            netChange: newCount - fixedCount,
            newBySeverity,
          },
          verdict,
          verdictReason:
            verdict === "BLOCK" ? "introduces critical issues over gate limit"
              : verdict === "WARN" ? "introduces new high-severity issues"
                : verdict === "COMMENT" ? "introduces minor new issues"
                  : "no new issues — clean diff",
          files: fileResults,
        },
      };
    } catch (e) {
      return { ok: false, error: `decoratePR_failed: ${e.message}` };
    }
  }, { note: "PR decoration — new issues introduced in a diff" });

  // -- issue workflow: assign / resolve / won't-fix -----------------------
  // Promote a scan finding into a tracked issue.
  registerLensAction("code-quality", "trackIssue", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      if (!p.rule || !p.message) return { ok: false, error: "rule_and_message_required" };
      const badNum = badNumericField(p, ["line"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const issues = userIssues(ctx);
      const id = rid("iss");
      const rec = {
        id,
        rule: String(p.rule),
        severity: ["critical", "high", "medium", "low", "info"].includes(p.severity)
          ? p.severity : "medium",
        message: String(p.message),
        file: p.file ? String(p.file) : null,
        line: Number.isFinite(Number(p.line)) ? Number(p.line) : null,
        scanId: p.scanId ? String(p.scanId) : null,
        status: "open",
        assignee: p.assignee ? String(p.assignee) : null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [{ at: new Date().toISOString(), action: "created" }],
      };
      issues.set(id, rec);
      return { ok: true, result: { issue: rec } };
    } catch (e) {
      return { ok: false, error: `trackIssue_failed: ${e.message}` };
    }
  }, { note: "promote a finding to a tracked issue" });

  registerLensAction("code-quality", "updateIssue", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      if (!p.id) return { ok: false, error: "id_required" };
      const issues = userIssues(ctx);
      const rec = issues.get(String(p.id));
      if (!rec) return { ok: false, error: "issue_not_found" };

      const VALID_STATUS = ["open", "in-progress", "resolved", "wont-fix", "false-positive"];
      const changes = [];
      if (p.status && VALID_STATUS.includes(p.status) && p.status !== rec.status) {
        changes.push(`status ${rec.status} → ${p.status}`);
        rec.status = p.status;
      } else if (p.status && !VALID_STATUS.includes(p.status)) {
        return { ok: false, error: `invalid_status: ${p.status}` };
      }
      if ("assignee" in p && p.assignee !== rec.assignee) {
        const next = p.assignee ? String(p.assignee) : null;
        changes.push(next ? `assigned to ${next}` : "unassigned");
        rec.assignee = next;
      }
      if (p.note) changes.push(`note: ${String(p.note).slice(0, 200)}`);
      if (!changes.length) return { ok: false, error: "no_changes" };
      rec.updatedAt = new Date().toISOString();
      rec.history.push({ at: rec.updatedAt, action: changes.join("; ") });
      return { ok: true, result: { issue: rec } };
    } catch (e) {
      return { ok: false, error: `updateIssue_failed: ${e.message}` };
    }
  }, { note: "assign / resolve / won't-fix an issue" });

  registerLensAction("code-quality", "listIssues", (ctx, artifact, params) => {
    try {
      const p = { ...(artifact?.data || {}), ...(params || {}) };
      const issues = [...userIssues(ctx).values()];
      let filtered = issues;
      if (p.status) filtered = filtered.filter((i) => i.status === p.status);
      if (p.assignee) filtered = filtered.filter((i) => i.assignee === p.assignee);
      if (p.severity) filtered = filtered.filter((i) => i.severity === p.severity);
      filtered.sort((a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        b.createdAt.localeCompare(a.createdAt));

      const byStatus = {};
      for (const i of issues) byStatus[i.status] = (byStatus[i.status] || 0) + 1;
      return {
        ok: true,
        result: {
          issues: filtered,
          total: issues.length,
          shown: filtered.length,
          byStatus,
        },
      };
    } catch (e) {
      return { ok: false, error: `listIssues_failed: ${e.message}` };
    }
  }, { note: "list tracked issues with status/assignee filters" });
}

// ---------------------------------------------------------------------------
// helpers used by macros
// ---------------------------------------------------------------------------

function aggregateMetrics(fileReports) {
  let totalLines = 0, codeLines = 0, commentLines = 0, blankLines = 0;
  let functionCount = 0, debtMinutes = 0, dupBlocks = 0;
  let cxSum = 0, maxComplexity = 0, dupLines = 0;
  for (const r of fileReports) {
    const m = r.metrics;
    totalLines += m.totalLines;
    codeLines += m.codeLines;
    commentLines += m.commentLines;
    blankLines += m.blankLines;
    functionCount += m.functionCount;
    debtMinutes += m.debtMinutes;
    dupBlocks += m.duplicateBlocks;
    cxSum += m.avgComplexity * Math.max(1, m.functionCount);
    maxComplexity = Math.max(maxComplexity, m.maxComplexity);
    dupLines += (m.duplicationPct / 100) * m.codeLines;
  }
  const avgComplexity = functionCount ? cxSum / functionCount : 1;
  const duplicationPct = codeLines
    ? Math.round((dupLines / codeLines) * 1000) / 10 : 0;
  const findingCount = fileReports.reduce((s, r) => s + r.findings.length, 0);
  const maintainability = maintainabilityIndex({
    codeLines, avgComplexity, duplicationPct, findingCount,
  });
  return {
    totalLines, codeLines, commentLines, blankLines, functionCount,
    avgComplexity: Math.round(avgComplexity * 10) / 10,
    maxComplexity,
    duplicationPct,
    duplicateBlocks: dupBlocks,
    findingCount,
    commentDensity: codeLines
      ? Math.round((commentLines / (codeLines + commentLines)) * 100) : 0,
    maintainability,
    debtMinutes,
    debtHours: Math.round((debtMinutes / 60) * 10) / 10,
  };
}

function countRule(scan, rule) {
  let n = 0;
  for (const fr of scan.files) {
    for (const f of fr.findings) if (f.rule === rule) n++;
  }
  return n;
}
