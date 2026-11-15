/**
 * Repair hot-patch (BR-01 / GB-1541, founder-confirmed design CB-0719).
 *
 * The repair brain (gpt-oss:120b-cloud at deploy) may PROPOSE code patches
 * for errors the repair cortex observes. A proposal is not an application:
 * it enters the standing remediation queue (repair-remediation.js) as a
 * `proposed` entry and moves through the same propose → approve → apply
 * governance as every other remediation. Three independent gates stand
 * between a model suggestion and a changed file:
 *
 *   1. The entry must be APPROVED through the queue's approve step
 *      (approval alone runs nothing — it only authorizes).
 *   2. CONCORD_REPAIR_HOTPATCH=1 must be set. Default OFF; with the flag
 *      off this module refuses every apply and the platform keeps its
 *      propose-only shape entire.
 *   3. After writing, the test gate runs; any failure restores the file
 *      byte-identically from its pre-patch snapshot and the entry lands
 *      at apply_failed with the evidence attached.
 *
 * There is deliberately NO confidence field anywhere in this path — model
 * self-confidence is not an authorization signal (founder doctrine).
 * Git history is never written here; commits stay human.
 *
 * If the repair brain is unreachable, proposeHotpatch returns an error
 * and creates NO queue entry — repair pauses cleanly and the cortex's
 * deterministic propose/escalate behaviour is untouched.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { enqueueProposal, getEntry } from "./repair-remediation.js";

export const HOTPATCH_ACTION = "hotpatch_apply";
export const MAX_TARGET_BYTES = 512 * 1024;

export function hotpatchEnabled(env = process.env) {
  return env.CONCORD_REPAIR_HOTPATCH === "1";
}

/**
 * Path allowlist, by construction: only source files under server/ or
 * concord-frontend/ may ever be hot-patched. Data, environment, migration
 * and dependency paths are refused outright — a proposal naming one is
 * rejected at propose time, before any brain call is even made.
 */
export function isPathAllowed(relPath) {
  if (typeof relPath !== "string" || !relPath) return false;
  const p = relPath.replace(/\\/g, "/");
  if (p.startsWith("/") || p.split("/").includes("..")) return false;
  if (!/^(server|concord-frontend)\//.test(p)) return false;
  if (/(^|\/)data\//.test(p)) return false;
  if (/(^|\/)migrations?\//.test(p)) return false;
  if (/(^|\/)node_modules\//.test(p)) return false;
  if (/(^|\/)\.env/.test(p)) return false;
  if (/\.(db|sqlite|sqlite3)$/i.test(p)) return false;
  return true;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function defaultAudit(phase, action, details) {
  try {
    const { logRepairDTU } = await import("../emergent/repair-cortex.js");
    logRepairDTU(phase, action, details);
  } catch {
    /* audit substrate unavailable (tests, partial boots) — never block repair on it */
  }
}

async function defaultBrainCall({ error, context, filePath, fileContent }) {
  const { brainChat } = await import("./byo-router.js");
  const prompt = [
    "You are the repair brain for Concord. A deterministic repair cortex observed an error and escalated it.",
    "Propose ONE minimal unified-diff patch for the named file. Reply with ONLY a JSON object:",
    '{"file": "<repo-relative path>", "diff": "<unified diff>", "rationale": "<one paragraph>"}',
    "If no safe patch exists, reply {\"file\": null}.",
    "",
    `Error: ${String(error || "").slice(0, 2000)}`,
    `Context: ${String(context || "").slice(0, 500)}`,
    `File: ${filePath}`,
    "--- file content ---",
    String(fileContent || "").slice(0, 60000),
  ].join("\n");
  const r = await brainChat({
    db: null, userId: "repair-cortex", slot: "repair",
    messages: [{ role: "user", content: prompt }],
    opts: { temperature: 0.1 },
  });
  if (!r || r.error || !r.content) return { ok: false, error: r?.error || "repair_brain_unreachable" };
  try {
    const start = r.content.indexOf("{");
    const end = r.content.lastIndexOf("}");
    const parsed = JSON.parse(r.content.slice(start, end + 1));
    if (!parsed || !parsed.file || !parsed.diff) return { ok: false, error: "no_patch_proposed" };
    return { ok: true, proposal: parsed, model: r.model || null, provider: r.provider || null };
  } catch {
    return { ok: false, error: "unparseable_proposal" };
  }
}

/**
 * Strict unified-diff applier. Verifies every context/removal line against
 * the actual file before changing anything; any mismatch refuses the whole
 * patch (no partial application). Supports a single file's hunks.
 */
export function applyUnifiedDiff(original, diff) {
  const lines = String(original).split("\n");
  const diffLines = String(diff).split("\n");
  const hunks = [];
  let cur = null;
  for (const dl of diffLines) {
    const m = dl.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (m) {
      cur = { oldStart: Number(m[1]), body: [] };
      hunks.push(cur);
      continue;
    }
    if (cur && /^[ +-]/.test(dl)) cur.body.push(dl);
  }
  if (!hunks.length) return { ok: false, error: "no_hunks" };
  // Apply from the last hunk backwards so line numbers stay valid.
  const out = [...lines];
  for (let h = hunks.length - 1; h >= 0; h--) {
    const { oldStart, body } = hunks[h];
    let idx = oldStart - 1;
    const replacement = [];
    for (const bl of body) {
      const tag = bl[0];
      const text = bl.slice(1);
      if (tag === " " || tag === "-") {
        if (out[idx] !== text) return { ok: false, error: "context_mismatch", atLine: idx + 1 };
        idx++;
        if (tag === " ") replacement.push(text);
      } else if (tag === "+") {
        replacement.push(text);
      }
    }
    out.splice(oldStart - 1, body.filter((b) => b[0] !== "+").length, ...replacement);
  }
  return { ok: true, content: out.join("\n") };
}

/**
 * Generate a proposal from the repair brain and enqueue it as `proposed`.
 * The brain is injectable for tests; the default is the repair slot.
 */
export async function proposeHotpatch({ error, context = "", filePath, rootDir, brainCall = defaultBrainCall, audit = defaultAudit } = {}) {
  if (!isPathAllowed(filePath)) return { ok: false, error: "path_not_allowed", filePath };
  let fileContent;
  try {
    fileContent = await readFile(path.join(rootDir, filePath), "utf8");
  } catch (e) {
    return { ok: false, error: "target_unreadable", detail: String(e?.message || e) };
  }
  if (Buffer.byteLength(fileContent) > MAX_TARGET_BYTES) return { ok: false, error: "target_too_large" };
  const res = await brainCall({ error, context, filePath, fileContent });
  if (!res.ok) return { ok: false, error: res.error || "proposal_failed" }; // repair pauses cleanly — no entry
  const { proposal } = res;
  if (proposal.file !== filePath) return { ok: false, error: "proposal_file_mismatch" };
  if (!isPathAllowed(proposal.file)) return { ok: false, error: "path_not_allowed", filePath: proposal.file };
  const check = applyUnifiedDiff(fileContent, proposal.diff);
  if (!check.ok) return { ok: false, error: "diff_does_not_apply", detail: check.error };
  const diffHash = sha256(proposal.diff);
  const id = `repair-cortex:hotpatch:${diffHash.slice(0, 16)}`;
  const enq = enqueueProposal({
    id,
    action: HOTPATCH_ACTION,
    moduleId: "repair-cortex",
    detectorId: "repair-cortex",
    findingId: "hotpatch",
    severity: "high",
    message: String(error || "").slice(0, 500),
    filePath,
    diff: proposal.diff,
    diffHash,
    rationale: String(proposal.rationale || "").slice(0, 2000),
    model: res.model || null,
    provider: res.provider || null,
  });
  if (!enq.ok) return enq;
  await audit("hotpatch_proposed", HOTPATCH_ACTION, { id, filePath, diffHash, model: res.model || null });
  return { ok: true, entry: enq.entry };
}

/**
 * Convert a model-supplied search/replace pair into a queued PROPOSAL. Never
 * writes the target. The (single, exact, unique) match is expanded to whole
 * lines and expressed as a context-free unified-diff hunk, verified through
 * applyUnifiedDiff, and enqueued via proposeHotpatch — so it takes the same
 * approve → flag → test-gate → rollback path as every other hot-patch.
 * `filePath` may be repo-relative or an absolute path inside rootDir.
 */
export async function proposeSearchReplace({ error, context = "", filePath, search, replace, rootDir, audit = defaultAudit } = {}) {
  if (typeof filePath !== "string" || !filePath || typeof search !== "string" || !search || typeof replace !== "string") {
    return { ok: false, error: "invalid_patch_request" };
  }
  let rel = filePath;
  if (path.isAbsolute(rel)) {
    const r = path.relative(rootDir, rel);
    if (r.startsWith("..") || path.isAbsolute(r)) return { ok: false, error: "path_not_allowed", filePath };
    rel = r;
  }
  rel = rel.replace(/\\/g, "/");
  if (!isPathAllowed(rel)) return { ok: false, error: "path_not_allowed", filePath: rel };
  if (!/\.(js|cjs|mjs)$/.test(rel)) return { ok: false, error: "unsupported_file_type", filePath: rel };
  let content;
  try {
    content = await readFile(path.join(rootDir, rel), "utf8");
  } catch (e) {
    return { ok: false, error: "target_unreadable", detail: String(e?.message || e) };
  }
  const first = content.indexOf(search);
  if (first === -1) return { ok: false, error: "search_not_found" };
  if (content.indexOf(search, first + 1) !== -1) return { ok: false, error: "search_not_unique" };
  const lineStart = content.lastIndexOf("\n", first - 1) + 1;
  const endIdx = first + search.length;
  const nl = content.indexOf("\n", endIdx);
  const lineEnd = nl === -1 ? content.length : nl;
  const oldBlock = content.slice(lineStart, lineEnd);
  const newBlock = content.slice(lineStart, first) + replace + content.slice(endIdx, lineEnd);
  const oldLines = oldBlock.split("\n");
  const newLines = newBlock.split("\n");
  const startLine = content.slice(0, lineStart).split("\n").length;
  const diff = [
    `--- a/${rel}`,
    `+++ b/${rel}`,
    `@@ -${startLine},${oldLines.length} +${startLine},${newLines.length} @@`,
    ...oldLines.map((l) => `-${l}`),
    ...newLines.map((l) => `+${l}`),
  ].join("\n");
  const brainCall = async () => ({ ok: true, proposal: { file: rel, diff, rationale: "search/replace proposed by repair brain; awaiting human approval" } });
  const res = await proposeHotpatch({ error, context, filePath: rel, rootDir, brainCall, audit });
  if (!res.ok && res.error === "duplicate_id") return { ok: true, alreadyQueued: true, id: res.id };
  return res;
}

async function defaultTestGate({ rootDir, filePath }) {
  if (/\.m?js$/.test(filePath)) {
    const { execFile } = await import("node:child_process");
    return await new Promise((resolve) => {
      execFile(process.execPath, ["--check", path.join(rootDir, filePath)], { timeout: 30000 }, (err) => {
        resolve(err ? { ok: false, error: "syntax_check_failed" } : { ok: true, checks: ["node --check"] });
      });
    });
  }
  return { ok: true, checks: ["no automatic gate for this file type"] };
}

/**
 * Apply an APPROVED hot-patch entry. Refuses unless the flag is on, the
 * entry exists, is approved, and is a hot-patch action. Snapshots the
 * target's bytes first; a failing test gate restores them exactly and the
 * entry lands at apply_failed. The test gate is injectable for tests.
 */
export async function applyHotpatch(id, { rootDir, env = process.env, testGate = defaultTestGate, audit = defaultAudit } = {}) {
  if (!hotpatchEnabled(env)) return { ok: false, error: "hotpatch_disabled" };
  const entry = getEntry(id);
  if (!entry) return { ok: false, error: "not_found" };
  if (entry.action !== HOTPATCH_ACTION) return { ok: false, error: "unsupported_action", action: entry.action };
  if (entry.status !== "approved") return { ok: false, error: "wrong_state", status: entry.status };
  if (!isPathAllowed(entry.filePath)) return { ok: false, error: "path_not_allowed", filePath: entry.filePath };
  const abs = path.join(rootDir, entry.filePath);
  let snapshot;
  try {
    snapshot = await readFile(abs, "utf8");
  } catch (e) {
    return { ok: false, error: "target_unreadable", detail: String(e?.message || e) };
  }
  const applied = applyUnifiedDiff(snapshot, entry.diff);
  if (!applied.ok) {
    entry.status = "apply_failed";
    entry.appliedResult = { ok: false, error: applied.error };
    await audit("hotpatch_apply_failed", HOTPATCH_ACTION, { id, filePath: entry.filePath, error: applied.error });
    return { ok: false, error: applied.error, entry };
  }
  entry.snapshot = snapshot;
  entry.snapshotHash = sha256(snapshot);
  await writeFile(abs, applied.content, "utf8");
  await audit("hotpatch_applied", HOTPATCH_ACTION, { id, filePath: entry.filePath, diffHash: entry.diffHash, approvedBy: entry.approvedBy || null });
  const gate = await testGate({ rootDir, filePath: entry.filePath, entry });
  await audit("hotpatch_tested", HOTPATCH_ACTION, { id, filePath: entry.filePath, gateOk: !!gate?.ok });
  if (!gate?.ok) {
    await writeFile(abs, snapshot, "utf8"); // byte-identical rollback
    entry.status = "apply_failed";
    entry.appliedResult = { ok: false, error: "test_gate_failed", gate };
    entry.rolledBackAt = new Date().toISOString();
    await audit("hotpatch_rolled_back", HOTPATCH_ACTION, { id, filePath: entry.filePath, reason: "test_gate_failed" });
    return { ok: false, error: "test_gate_failed", gate, entry };
  }
  entry.status = "applied";
  entry.appliedAt = new Date().toISOString();
  entry.appliedResult = { ok: true, gate };
  return { ok: true, entry };
}

/** Manually roll back an applied hot-patch from its byte snapshot. */
export async function rollbackHotpatch(id, { rootDir, audit = defaultAudit } = {}) {
  const entry = getEntry(id);
  if (!entry) return { ok: false, error: "not_found" };
  if (entry.action !== HOTPATCH_ACTION) return { ok: false, error: "unsupported_action", action: entry.action };
  if (entry.status !== "applied" || typeof entry.snapshot !== "string") {
    return { ok: false, error: "wrong_state", status: entry.status };
  }
  await writeFile(path.join(rootDir, entry.filePath), entry.snapshot, "utf8");
  entry.status = "apply_failed";
  entry.appliedResult = { ok: false, error: "manual_rollback" };
  entry.rolledBackAt = new Date().toISOString();
  await audit("hotpatch_rolled_back", HOTPATCH_ACTION, { id, filePath: entry.filePath, reason: "manual" });
  return { ok: true, entry };
}

export default { hotpatchEnabled, isPathAllowed, applyUnifiedDiff, proposeHotpatch, proposeSearchReplace, applyHotpatch, rollbackHotpatch };
