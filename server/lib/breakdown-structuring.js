// server/lib/breakdown-structuring.js
//
// Sprint 60+ — Breakdown Structuring Engine
//
// The architectural cheat code: turn big monolithic tasks ("write me a book",
// "build me a 50-file enterprise app") into a deterministic assembly line:
//
//   USER REQUEST
//        ↓
//   [1] DECOMPOSE — intent split into N ordered subtasks
//        ↓
//   [2] DISPATCH  — each subtask fires its own LLM call (bounded 2-4k tokens)
//        ↓
//   [3] MINT      — every output mints an ordered DTU in the substrate
//        ↓
//   [4] STITCH    — deterministic script pulls DTUs, stitches them
//        ↓
//   [5] PACKAGE   — final artifact (.pdf/.zip/.docx/.tar) is a real file
//
// The LLM never tries to write 100,000 tokens in one go. Each turn stays
// short, focused, cheap. But the final delivered artifact can be INFINITELY
// LARGE — bounded only by storage, not by turn output limits.
//
// This module is honest-by-construction: every claim traces back to a real
// DTU row or a real artifact file. No "I generated a book" — only "I built
// book from DTU rows 1-20 + artifact_id abc123".

import { createDTU } from "../economy/dtu-pipeline.js";
import { dtuToPdfSections } from "./dtu-document-export.js";
import { renderPDF } from "./renderers/pdf-renderer.js";
import { renderZip } from "./renderers/zip-renderer.js";
import { slugify } from "./render-engine.js";
import { brainChat, provenanceFrom } from "./byo-router.js";

// Tunables
const MAX_PARALLEL = 8;            // workers per dispatch batch
const PER_TURN_TOKEN_BUDGET = 3000; // hard cap per subtask turn
const SUBTASK_SYSTEM_PROMPT_HEAD = `You are one focused worker in a parallel build factory.
Your job is to produce ONLY the requested subtask. Stay tight, dense, on-target.
Never reference other subtasks. Never ask clarifying questions.
Output raw text — no metadata, no preamble. Match the requested format exactly.`;

/**
 * STEP 1: Decompose a big request into ordered subtasks.
 *
 * @param {Object} opts
 * @param {string} opts.request - the user's big request
 * @param {string} [opts.unit] - "chapter" | "module" | "file" | "section" (default: chapter)
 * @param {number} [opts.count] - target subtask count (3-20)
 * @param {Object} STATE
 * @returns {Promise<{ok, subtasks: [{index, title, instructions, dependencies:[], dtu_id?}], ...}>}
 */
export async function decomposeIntoSubtasks({ request, unit = "chapter", count = 10, db, userId }) {
  if (!request) return { ok: false, error: "missing_request" };
  if (!db) return { ok: false, error: "no_db" };
  if (!userId) return { ok: false, error: "no_user" };
  const n = Math.max(3, Math.min(20, count));

  const sysPrompt = `You are an intent-decomposition planner. Given a big creative request, split it into ${n} focused, sequential ${unit}s. Each ${unit} should be independently completable in 2-4k tokens. Output ONLY a JSON array (no prose) of objects with fields:
- "index" (1..${n})
- "title" (short)
- "instructions" (1-2 sentences: what this ${unit} must accomplish)
- "dependencies" (array of prior indices this depends on, usually [index-1])

Constraints:
- ${unit} 1 should establish context/foundation; final ${unit} should resolve/close.
- Each ${unit} must be self-contained enough to be written without seeing others.
- Do not duplicate content across ${unit}s.
- Total ${unit} count must equal ${n}.`;

  const userPrompt = `Big request: ${request}\n\nReturn JSON array of ${n} ${unit}s.`;

  const messages = [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];

  const r = await brainChat({
    db,
    userId,
    slot: "conscious",
    messages,
    opts: { maxTokens: 2000, temperature: 0.4 },
  });

  if (!r?.ok) {
    return {
      ok: false,
      error: "brain_failed",
      detail: r?.error || "unknown",
      provider: r?.provider,
      model: r?.model,
    };
  }

  // Parse JSON from response
  const text = r.text || "";
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return { ok: false, error: "no_json", raw: text.slice(0, 500) };

  let subtasks;
  try { subtasks = JSON.parse(m[0]); }
  catch (e) { return { ok: false, error: "bad_json", raw: m[0].slice(0, 500) }; }

  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    return { ok: false, error: "empty_subtasks" };
  }

  return {
    ok: true,
    unit,
    subtasks: subtasks.slice(0, n).map((s, i) => ({
      index: s.index || (i + 1),
      title: s.title || `${unit} ${i + 1}`,
      instructions: s.instructions || "",
      dependencies: Array.isArray(s.dependencies) ? s.dependencies : [],
    })),
    provenance: provenanceFrom(r),
  };
}

/**
 * STEP 2: Dispatch N subtasks in parallel — bounded turns, mint each as DTU.
 *
 * Returns ordered DTU ids ready for stitching.
 *
 * @param {Object} opts
 * @param {Array} opts.subtasks - from decomposeIntoSubtasks
 * @param {string} opts.request - original request (for context)
 * @param {Object} opts.db - sqlite handle
 * @param {string} opts.userId - creator
 * @param {Object} STATE
 */
export async function dispatchSubtasksInParallel(opts, STATE) {
  const { subtasks, request, db, userId, projectId = null } = opts;
  if (!subtasks?.length) return { ok: false, error: "no_subtasks" };
  if (!db) return { ok: false, error: "no_db" };
  if (!userId) return { ok: false, error: "no_user" };

  // Cap concurrency to MAX_PARALLEL
  const groups = [];
  for (let i = 0; i < subtasks.length; i += MAX_PARALLEL) {
    groups.push(subtasks.slice(i, i + MAX_PARALLEL));
  }

  const results = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const batch = groups[gi];
    const promises = batch.map(async (sub) => {
      const userPrompt = `Original request: ${request}

${sub.title}
${sub.instructions}

Write this ${opts.unit || "section"} now. Tight, focused, 2-4k tokens.`;

      const messages = [
        { role: "system", content: SUBTASK_SYSTEM_PROMPT_HEAD },
        { role: "user", content: userPrompt },
      ];
      // Longer timeout for dispatch — we're running multiple parallel calls
      // and initial model load can take 20-30s, leaving little time for inference
      const r = await brainChat({
        db: opts.db,
        userId: opts.userId,
        slot: "conscious",
        messages,
        opts: { maxTokens: PER_TURN_TOKEN_BUDGET, temperature: 0.7, timeoutMs: 120000 },
      });

      let dtuId = null;
      let mintError = null;
      if (r?.ok && r.text) {
        try {
          const mint = createDTU(db, {
            creatorId: userId,
            title: `${sub.title}`,
            content: r.text,
            contentType: "text",
            lensId: "build",
            citationMode: "original",
            tags: ["build", "subtask", opts.unit || "section", `idx-${sub.index}`],
            metadata: {
              kind: "build_subtask",
              index: sub.index,
              originalRequest: request,
              projectId,
              provenance: provenanceFrom(r),
              bytes: r.text.length,
              tokensEstimate: Math.ceil(r.text.length / 4),
            },
          });
          if (mint?.ok && mint.dtu?.id) dtuId = mint.dtu.id;
          else mintError = mint?.error || "mint_failed";
        } catch (e) {
          mintError = String(e?.message || e);
        }
      }

      return {
        index: sub.index,
        title: sub.title,
        ok: !!dtuId,
        dtuId,
        mintError,
        contentLength: r?.text?.length || 0,
        error: r?.ok ? mintError : (r?.error || "brain_failed"),
      };
    });

    const settled = await Promise.allSettled(promises);
    for (const s of settled) {
      if (s.status === "fulfilled") results.push(s.value);
      else results.push({ ok: false, error: String(s.reason?.message || s.reason) });
    }
  }

  // Sort by index for ordered output
  results.sort((a, b) => (a.index || 0) - (b.index || 0));

  return {
    ok: true,
    totalSubtasks: subtasks.length,
    dispatched: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    dtus: results,
  };
}

/**
 * STEP 3: Stitch ordered DTUs into a single text body (deterministic, no LLM).
 *
 * @param {Object} opts
 * @param {Object} opts.db - sqlite handle
 * @param {Array} opts.dtuIds - ordered list of DTU ids
 * @param {string} [opts.title] - master title
 * @param {string} [opts.separator] - text between DTUs
 */
export async function stitchDtusToBody(opts) {
  const { db, dtuIds, title = "Compiled Document", separator = "\n\n---\n\n" } = opts;
  if (!db) return { ok: false, error: "no_db" };
  if (!dtuIds?.length) return { ok: false, error: "no_dtu_ids" };

  // N+1 fix: single query for all ids (preserves order of dtuIds)
  const sections = [];
  const rows = [];
  try {
    const placeholders = dtuIds.map(() => "?").join(",");
    const allRows = db
      .prepare(`SELECT id, title, content FROM dtus WHERE id IN (${placeholders})`)
      .all(...dtuIds);
    const byId = new Map(allRows.map((r) => [r.id, r]));
    for (const id of dtuIds) {
      const row = byId.get(id);
      if (!row) continue;
      rows.push(row);
      sections.push(row.content || "");
    }
  } catch { /* skip missing */ }

  if (!sections.length) return { ok: false, error: "no_content_found" };

  const body = `# ${title}\n\n` + sections.join(separator);

  return {
    ok: true,
    title,
    body,
    sectionCount: sections.length,
    charCount: body.length,
    tokenEstimate: Math.ceil(body.length / 4),
    sourceDtuIds: rows.map(r => r.id),
  };
}

/**
 * STEP 4: Render the stitched body to a real file artifact.
 *
 * @param {Object} opts
 * @param {string} opts.body - stitched content
 * @param {string} opts.title - artifact title
 * @param {string} [opts.format] - "md" | "pdf" | "zip" | "json" | "txt"
 * @param {string} [opts.userId]
 * @returns {Promise<{ok, filename, mimeType, sizeBytes, downloadUrl}>}
 */
export async function renderStitchedArtifact(opts) {
  const { body, title, format = "md" } = opts;

  const filename = `${slugify(title)}.${format}`;

  if (format === "pdf") {
    const sections = [
      { type: "title", text: title },
      { type: "text", text: body },
    ];
    const buffer = await renderPDF(sections, { size: "A4", margin: 60 });
    return {
      ok: true,
      filename,
      mimeType: "application/pdf",
      sizeBytes: buffer.length,
      // caller is responsible for storeArtifact to get downloadUrl
      buffer,
    };
  }

  if (format === "zip") {
    // Treat body as a manifest: lines "filename.md\n---content---"
    const files = [{ name: "compiled.md", content: body }];
    const buffer = await renderZip(files);
    return {
      ok: true,
      filename,
      mimeType: "application/zip",
      sizeBytes: buffer.length,
      buffer,
    };
  }

  // Default: markdown / text
  const mimeType = format === "json" ? "application/json"
                 : format === "csv" ? "text/csv"
                 : format === "txt" ? "text/plain"
                 : "text/markdown";
  const buffer = Buffer.from(body, "utf8");
  return {
    ok: true,
    filename,
    mimeType,
    sizeBytes: buffer.length,
    buffer,
  };
}

/**
 * ONE-SHOT: full pipeline. Decompose → Dispatch → Mint → Stitch → Package.
 *
 * @param {Object} opts
 * @param {string} opts.request - user's big request
 * @param {string} [opts.unit] - "chapter" | "module" | "file" | "section"
 * @param {number} [opts.count] - target subtask count (3-20)
 * @param {string} [opts.format] - output format
 * @param {string} opts.userId
 * @param {Object} opts.db
 * @param {Object} STATE
 */
export async function buildMassArtifact({ request, unit = "chapter", count = 10, format = "md", userId, db, title, STATE = null }) {
  if (!db) return { ok: false, error: "no_db" };
  if (!userId) return { ok: false, error: "no_user" };

  // 1. Decompose
  const decomp = await decomposeIntoSubtasks({ request, unit, count, db, userId });
  if (!decomp.ok) return { ok: false, stage: "decompose", error: decomp.error, detail: decomp.detail };

  // 2. Dispatch (parallel)
  const dispatch = await dispatchSubtasksInParallel({
    subtasks: decomp.subtasks,
    request,
    db,
    userId,
    unit,
  }, STATE);
  if (!dispatch.ok) return { ok: false, stage: "dispatch", error: dispatch.error };

  // 3. Stitch
  const orderedDtuIds = dispatch.dtus.filter(d => d.dtuId).map(d => d.dtuId);
  const stitch = await stitchDtusToBody({
    db,
    dtuIds: orderedDtuIds,
    title: title || request.slice(0, 80),
  });
  if (!stitch.ok) return { ok: false, stage: "stitch", error: stitch.error };

  // 4. Render
  const render = await renderStitchedArtifact({
    body: stitch.body,
    title: stitch.title,
    format,
  });
  if (!render.ok) return { ok: false, stage: "render", error: render.error };

  return {
    ok: true,
    title: stitch.title,
    filename: render.filename,
    mimeType: render.mimeType,
    sizeBytes: render.sizeBytes,
    charCount: stitch.charCount,
    tokenEstimate: stitch.tokenEstimate,
    sectionCount: stitch.sectionCount,
    sourceDtuIds: stitch.sourceDtuIds,
    provenance: decomp.provenance,
    buffer: render.buffer, // caller passes to storeArtifact
  };
}
