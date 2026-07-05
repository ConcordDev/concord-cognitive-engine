// server/lib/detectors/workflow-gate-integrity-detector.js
//
// Catches CI/CD gate-integrity holes in `.github/workflows/*.yml` — the exact
// class this session found in `deploy.yml`: the gate job (including the
// ENTIRE depth-test suite) ran ONLY on push-to-main, never on a
// pull_request, so a real regression (a missing `NODE_ENV=test` that
// disabled the no-egress test guard — see `git log --oneline -- .github/
// workflows/deploy.yml server/scripts/ci-test-tolerant.mjs`, commit
// `142fd633` "route the deploy-gate depth-test step through the
// isolate-and-retry tolerance" and `06105142` before it) reached `main`
// invisibly — nobody saw it fail on a PR because the gate never ran there.
//
// This is a YAML-ADJACENT scanner, not a full YAML parser (matching the
// style of the other detectors in this directory — see command-injection-
// detector.js's comment-stripping lexer). It builds a lightweight
// indentation tree good enough to recover GitHub Actions' fixed shape
// (workflow -> on/env/jobs -> job -> env/steps -> step -> run/env/
// continue-on-error), then runs four independent checks against it:
//
//   (a) `continue-on-error: true` with no checked-in exemption — medium.
//   (b) `push` trigger without `pull_request`, on a workflow that runs
//       test commands — high (the deploy.yml class of bug).
//   (c) a test-running step with no `NODE_ENV=test` reachable at step/job/
//       workflow env level (or inline in the run script) — medium.
//   (d) a `VAR=$(curl …)` capture never referenced in a later conditional
//       in the same step — low.
//
// Precision notes (read before tuning thresholds):
//   - (a) treats a MISSING `audit/detectors/gate-monitors.json` as "zero
//     exemptions" — everything currently flags on a fresh repo. A human
//     populates the manifest with `{ workflow, job_or_step, reason,
//     owner_ack_date }` entries for intentional continue-on-error uses
//     (e.g. a genuinely best-effort notification step); once an entry
//     exists, that exact `{workflow, job_or_step}` pair stops being
//     flagged. `job_or_step` is `job:<jobId>` for a job-level
//     continue-on-error, or `<jobId>:<stepLabel>` for a step-level one
//     (stepLabel is the step's `name:` — or `id:`/`uses:` when unnamed —
//     or `step@line<N>` as a last resort). See `continueOnErrorLabel`.
//   - (c) also accepts an inline `NODE_ENV=test` in the run script text
//     itself (this repo's actual fix for the seeding bug set it that way,
//     inside a package.json script — `NODE_ENV=test DB_PATH=… node --test
//     …` — not via a YAML `env:` block). A step that only reaches
//     NODE_ENV=test through an npm script this detector can't see (i.e.
//     package.json, not the workflow file) will still flag — that's a
//     known, honest blind spot: the finding says "may not engage", not
//     "does not engage", precisely because the detector cannot see past
//     `npm run <script>` into package.json.
//   - (d) only flags absence of a *conditional* re-use (`if`/`elif`/
//     `while`/`test`/`grep`/`[[`/`[ `) of the captured variable later in
//     the SAME step. A capture that's only echoed (never gates anything)
//     is exactly the dead-check shape found in deploy.yml's `deploy-
//     staging` job (`READY=$(curl …)` is captured, echoed, and never
//     read again — only `HEALTH` gates the rollback).

import path from "node:path";
import { walk, readSafe, makeReport, makeError, relPath, snippet } from "./_framework.js";

const TEST_CMD_RE = /\bnpm\s+(?:run\s+)?test(?::[\w-]+)?\b|\bnode\s+--test\b/;
const CURL_ASSIGN_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?\$\(\s*curl\b/;
const CONDITIONAL_HINT_RE = /\b(?:if|elif|while|test|grep)\b|\[\[|(?:^|\s)\[(?:\s|$)/;
const INLINE_NODE_ENV_TEST_RE = /\bNODE_ENV\s*=\s*['"]?test['"]?/;

// ── Minimal indentation-aware tree builder ──────────────────────────────
//
// GitHub Actions workflow YAML has a fixed, well-known shape. Rather than
// pull in a full YAML parser, we build a generic parent/child tree keyed by
// indentation, with one trick: a block-sequence marker (`- `) is folded
// into the indent of its first key so that sibling keys of the same list
// item (e.g. `name:` then `run:` inside one step) land as siblings in the
// tree rather than nested under the first key. `isListItemStart` marks
// which sibling began a new list entry, which is how step boundaries (and
// job trigger boundaries) are recovered from an otherwise-flat sibling run.

function stripYamlComment(raw) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(raw[i - 1])) return raw.slice(0, i);
    }
  }
  return raw;
}

function normalizeLine(raw) {
  const lead = /^(\s*)/.exec(raw)[1].length;
  const rest = raw.slice(lead);
  if (rest.startsWith("- ")) return { indent: lead + 2, text: rest.slice(2).trimEnd(), isListItemStart: true };
  if (rest === "-") return { indent: lead + 2, text: "", isListItemStart: true };
  return { indent: lead, text: rest.trimEnd(), isListItemStart: false };
}

const KEY_VALUE_RE = /^([A-Za-z0-9_.-]+|"[^"]*"|'[^']*'):(\s+(.*))?$/;

export function buildYamlishTree(content) {
  const lines = content.split("\n");
  const root = { key: null, value: "", text: "", indent: -1, lineNo: 0, children: [], parent: null, isListItemStart: false };
  const stack = [root];
  for (let i = 0; i < lines.length; i++) {
    const stripped = stripYamlComment(lines[i]);
    if (!stripped.trim()) continue;
    const norm = normalizeLine(stripped);
    if (!norm.text && !norm.isListItemStart) continue;
    while (stack.length > 1 && norm.indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1];
    let key = null;
    let value = norm.text;
    const km = KEY_VALUE_RE.exec(norm.text);
    if (km) { key = km[1].replace(/^['"]|['"]$/g, ""); value = (km[3] || "").trim(); }
    const node = {
      key, value, text: norm.text, indent: norm.indent, lineNo: i + 1,
      children: [], parent, isListItemStart: norm.isListItemStart,
    };
    parent.children.push(node);
    stack.push(node);
  }
  return root;
}

function child(node, key) {
  return node?.children.find((c) => c.key === key) || null;
}

/** Trigger names from the top-level `on:` block — scalar, flow-array, or block-mapping form. */
export function extractTriggers(root) {
  const onNode = child(root, "on");
  const triggers = new Set();
  if (!onNode) return triggers;
  if (onNode.children.length) {
    for (const c of onNode.children) if (c.key) triggers.add(c.key);
    return triggers;
  }
  const v = (onNode.value || "").trim();
  if (!v) return triggers;
  if (v.startsWith("[")) {
    for (const t of v.replace(/[[\]]/g, "").split(",")) { const s = t.trim(); if (s) triggers.add(s); }
  } else {
    triggers.add(v);
  }
  return triggers;
}

/** `env:` key/value map at any node (workflow root, job, or step-group `env` node). */
export function extractEnvMap(node) {
  const map = new Map();
  const envNode = child(node, "env");
  if (!envNode) return map;
  for (const c of envNode.children) if (c.key) map.set(c.key, c.value);
  return map;
}

/**
 * Reconstruct each job's `steps:` list as an array of step-groups. Each
 * group is the run of tree-children from one `isListItemStart` (inclusive)
 * to the next (exclusive) — i.e. every top-level key belonging to one
 * step (`name`, `run`, `env`, `continue-on-error`, `uses`, `with`, …).
 */
export function getStepGroups(jobNode) {
  const stepsNode = child(jobNode, "steps");
  if (!stepsNode) return [];
  const groups = [];
  let current = null;
  for (const c of stepsNode.children) {
    if (c.isListItemStart || !current) { current = []; groups.push(current); }
    current.push(c);
  }
  return groups.map((keys) => ({
    startLine: keys[0]?.lineNo,
    keys,
    get(k) { return keys.find((x) => x.key === k) || null; },
  }));
}

function stepLabel(group) {
  const n = group.get("name") || group.get("id") || group.get("uses");
  if (n) return (n.value || n.key || "").trim() || `step@line${group.startLine}`;
  return `step@line${group.startLine}`;
}

/** Ordered `{text, lineNo}` lines making up a step's `run:` content (inline or block-scalar). */
export function getRunLines(group) {
  const runNode = group.get("run");
  if (!runNode) return [];
  const out = [];
  const topVal = (runNode.value || "").trim();
  if (topVal && !/^[|>][+-]?\d*$/.test(topVal)) out.push({ text: topVal, lineNo: runNode.lineNo });
  const walk = (n) => { for (const c of n.children) { out.push({ text: c.text, lineNo: c.lineNo }); walk(c); } };
  walk(runNode);
  return out;
}

function joinedRunText(group) {
  return getRunLines(group).map((l) => l.text).join("\n");
}

function normalizeEnvValue(v) {
  return (v || "").trim().replace(/^['"]|['"]$/g, "");
}

function nodeEnvIsTest(envMap) {
  return envMap.has("NODE_ENV") && normalizeEnvValue(envMap.get("NODE_ENV")) === "test";
}

// ── Gate-monitors exemption manifest ────────────────────────────────────

async function loadManifest(root) {
  const p = path.join(root, "audit", "detectors", "gate-monitors.json");
  const raw = await readSafe(p);
  if (!raw) return { entries: [], malformed: false, present: false };
  try {
    const parsed = JSON.parse(raw);
    return { entries: Array.isArray(parsed) ? parsed : [], malformed: !Array.isArray(parsed), present: true };
  } catch {
    return { entries: [], malformed: true, present: true };
  }
}

function continueOnErrorLabel(workflowFile, jobId, scope, stepLbl) {
  return scope === "job" ? `job:${jobId}` : `${jobId}:${stepLbl}`;
}

function isExempt(manifestEntries, workflowFile, label) {
  return manifestEntries.some((e) => e && e.workflow === workflowFile && e.job_or_step === label);
}

// ── The four checks ──────────────────────────────────────────────────────

/** (a) continue-on-error without a checked-in exemption. */
function checkContinueOnError(root, workflowFile, manifestEntries, findings) {
  const jobsNode = child(root, "jobs");
  if (!jobsNode) return;
  for (const jobNode of jobsNode.children) {
    if (!jobNode.key) continue;
    // Job-level continue-on-error (direct child of the job, not inside steps).
    const jobLevel = jobNode.children.find((c) => c.key === "continue-on-error");
    if (jobLevel && !/^false$/i.test((jobLevel.value || "").trim())) {
      const label = continueOnErrorLabel(workflowFile, jobNode.key, "job");
      if (!isExempt(manifestEntries, workflowFile, label)) {
        findings.push({
          id: "workflow_continue_on_error_unexempted",
          severity: "medium",
          kind: "static",
          category: "ci-cd",
          subject: { kind: "file", path: workflowFile },
          message: `Job "${jobNode.key}" sets continue-on-error: true with no exemption in audit/detectors/gate-monitors.json — a failing job here is silently green.`,
          location: `${workflowFile}:${jobLevel.lineNo}`,
          evidence: { workflow: workflowFile, jobId: jobNode.key, scope: "job", label },
          fixHint: "add_gate_monitors_exemption_or_remove_continue_on_error",
        });
      }
    }
    for (const group of getStepGroups(jobNode)) {
      const coe = group.get("continue-on-error");
      if (!coe || /^false$/i.test((coe.value || "").trim())) continue;
      const lbl = stepLabel(group);
      const label = continueOnErrorLabel(workflowFile, jobNode.key, "step", lbl);
      if (isExempt(manifestEntries, workflowFile, label)) continue;
      findings.push({
        id: "workflow_continue_on_error_unexempted",
        severity: "medium",
        kind: "static",
        category: "ci-cd",
        subject: { kind: "file", path: workflowFile },
        message: `Step "${lbl}" in job "${jobNode.key}" sets continue-on-error: true with no exemption in audit/detectors/gate-monitors.json — a failing step here is silently green.`,
        location: `${workflowFile}:${coe.lineNo}`,
        evidence: { workflow: workflowFile, jobId: jobNode.key, step: lbl, scope: "step", label },
        fixHint: "add_gate_monitors_exemption_or_remove_continue_on_error",
      });
    }
  }
}

/** (b) push trigger without pull_request, on a workflow that runs tests. */
function checkGateVisibleOnPR(root, workflowFile, findings) {
  const triggers = extractTriggers(root);
  if (!triggers.has("push") || triggers.has("pull_request")) return;
  const jobsNode = child(root, "jobs");
  if (!jobsNode) return;
  const hits = [];
  for (const jobNode of jobsNode.children) {
    if (!jobNode.key) continue;
    for (const group of getStepGroups(jobNode)) {
      const text = joinedRunText(group);
      if (TEST_CMD_RE.test(text)) hits.push({ jobId: jobNode.key, step: stepLabel(group), lineNo: group.startLine });
    }
  }
  if (!hits.length) return;
  const onNode = child(root, "on");
  findings.push({
    id: "workflow_gate_not_visible_on_pr",
    severity: "high",
    kind: "static",
    category: "ci-cd",
    subject: { kind: "file", path: workflowFile },
    message: `Workflow triggers on push (${[...triggers].join(", ")}) but has no pull_request trigger, yet runs test commands — a regression here reaches the trigger branch without ever failing a PR check (the deploy.yml class of bug).`,
    location: `${workflowFile}:${onNode?.lineNo ?? 1}`,
    evidence: { workflow: workflowFile, triggers: [...triggers], testSteps: hits.slice(0, 10) },
    fixHint: "add_pull_request_trigger_or_mirror_gate_in_a_pr_workflow",
  });
}

/** (c) test step without a reachable NODE_ENV=test. */
function checkNodeEnvOnTestSteps(root, workflowFile, findings) {
  const workflowEnv = extractEnvMap(root);
  const jobsNode = child(root, "jobs");
  if (!jobsNode) return;
  for (const jobNode of jobsNode.children) {
    if (!jobNode.key) continue;
    const jobEnv = extractEnvMap(jobNode);
    for (const group of getStepGroups(jobNode)) {
      const runLines = getRunLines(group);
      if (!runLines.length) continue;
      const text = runLines.map((l) => l.text).join("\n");
      if (!TEST_CMD_RE.test(text)) continue;
      const stepEnv = extractEnvMap({ children: group.keys }); // treat the step's own key list as a pseudo-node
      const satisfied =
        nodeEnvIsTest(stepEnv) || nodeEnvIsTest(jobEnv) || nodeEnvIsTest(workflowEnv) || INLINE_NODE_ENV_TEST_RE.test(text);
      if (satisfied) continue;
      const lbl = stepLabel(group);
      findings.push({
        id: "workflow_test_step_missing_node_env",
        severity: "medium",
        kind: "static",
        category: "ci-cd",
        subject: { kind: "file", path: workflowFile },
        message: `Step "${lbl}" in job "${jobNode.key}" runs a test command but NODE_ENV=test is not set at the step, job, or workflow env level (nor inline in the script) — a no-egress/test-only guard gated on NODE_ENV may not engage.`,
        location: `${workflowFile}:${group.get("run")?.lineNo ?? group.startLine}`,
        evidence: { workflow: workflowFile, jobId: jobNode.key, step: lbl, runSnippet: snippet(text, 160) },
        fixHint: "set_node_env_test_at_step_job_or_workflow_level",
      });
    }
  }
}

/** (d) `VAR=$(curl …)` capture never re-used in a conditional in the same step. */
function checkUnassertedCurlCaptures(root, workflowFile, findings) {
  const jobsNode = child(root, "jobs");
  if (!jobsNode) return;
  for (const jobNode of jobsNode.children) {
    if (!jobNode.key) continue;
    for (const group of getStepGroups(jobNode)) {
      const runLines = getRunLines(group);
      if (!runLines.length) continue;
      for (let i = 0; i < runLines.length; i++) {
        const m = CURL_ASSIGN_RE.exec(runLines[i].text);
        if (!m) continue;
        const varName = m[1];
        const usageRe = new RegExp(`\\$\\{?${varName}\\}?\\b`);
        let asserted = false;
        for (let j = i + 1; j < runLines.length; j++) {
          if (usageRe.test(runLines[j].text) && CONDITIONAL_HINT_RE.test(runLines[j].text)) { asserted = true; break; }
        }
        if (asserted) continue;
        const lbl = stepLabel(group);
        findings.push({
          id: "workflow_curl_captured_not_asserted",
          severity: "low",
          kind: "static",
          category: "ci-cd",
          subject: { kind: "file", path: workflowFile },
          message: `Step "${lbl}" in job "${jobNode.key}" captures curl output into $${varName} but never uses it in a later conditional/assertion in the same step — the check may be decorative (echoed but never gates anything).`,
          location: `${workflowFile}:${runLines[i].lineNo}`,
          evidence: { workflow: workflowFile, jobId: jobNode.key, step: lbl, varName, snippet: snippet(runLines[i].text, 160) },
          fixHint: "assert_or_branch_on_captured_curl_output",
        });
      }
    }
  }
}

export async function runWorkflowGateIntegrityDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("workflow-gate-integrity", "no_root", null, t0);
  try {
    const workflowsDir = path.join(root, ".github", "workflows");
    const files = (await walk(workflowsDir, [".yml", ".yaml"])).sort();
    const manifest = await loadManifest(root);
    const findings = [];

    for (const f of files) {
      const rel = relPath(root, f).split(path.sep).join("/");
      const raw = await readSafe(f);
      if (!raw) continue;
      let tree;
      try { tree = buildYamlishTree(raw); } catch { continue; } // malformed file: skip, never crash the suite
      checkContinueOnError(tree, rel, manifest.entries, findings);
      checkGateVisibleOnPR(tree, rel, findings);
      checkNodeEnvOnTestSteps(tree, rel, findings);
      checkUnassertedCurlCaptures(tree, rel, findings);
    }

    if (manifest.malformed) {
      findings.push({
        id: "workflow_gate_monitors_manifest_malformed",
        severity: "low",
        kind: "static",
        category: "ci-cd",
        message: "audit/detectors/gate-monitors.json exists but is not a JSON array — treated as zero exemptions (every continue-on-error currently flags).",
        location: "audit/detectors/gate-monitors.json",
        fixHint: "fix_gate_monitors_manifest_json",
      });
    }

    findings.unshift({
      id: "workflow_gate_integrity_summary",
      severity: "info",
      kind: "static",
      category: "ci-cd",
      message: `Scanned ${files.length} workflow file(s); flagged ${findings.length} finding(s) ` +
        `(manifest ${manifest.present ? (manifest.malformed ? "present-but-malformed" : `present, ${manifest.entries.length} exemption(s)`) : "absent — no exemptions"}).`,
      evidence: { workflowFiles: files.length },
    });

    return makeReport("workflow-gate-integrity", findings, t0);
  } catch (err) {
    return makeError("workflow-gate-integrity", "exception", err, t0);
  }
}
