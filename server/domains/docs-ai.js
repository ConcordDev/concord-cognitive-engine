// server/domains/docs-ai.js
//
// Docs lens Sprint B — AI surface. 8 marquee features mirroring the
// 2026 docs market: compose, inline edit, continue writing, Q&A
// grounded on workspace, tone/format match, voice transcribe, image
// gen, and a thin runner for Custom AI Skills (skill CRUD is in
// docs-skills.js).
//
// All macros route through ctx.llm.chat with sensible slot defaults
// and always fall back deterministically when Ollama is unavailable
// so the surface stays usable.

import {
  withTimeout, stripFences, htmlToContext,
  recordAiRun, plainTextToHtml, getVoiceAnchors,
} from "../lib/docs/ai-compose.js";
import { hasRole, getDocument, searchUserDocs } from "../lib/docs/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

export default function registerDocsAiMacros(register) {

  // ─── 1. AI compose — generate full doc body from a prompt ───────
  register("docs", "ai_compose", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const prompt = String(input.prompt || "").trim();
    if (!prompt) return { ok: false, reason: "prompt_required" };
    const documentId = input.documentId ? String(input.documentId) : null;
    if (documentId && !hasRole(db, documentId, userId, "editor")) return { ok: false, reason: "forbidden" };
    const tone = String(input.tone || "neutral").slice(0, 40);
    const lengthHint = String(input.length || "medium").slice(0, 20); // short|medium|long
    const llm = ctx?.llm;
    const t0 = Date.now();

    const sys = `You are drafting a document. Output well-structured prose using markdown-style headings (# ## ###), short paragraphs, and bullet lists where useful. Do NOT explain what you did or wrap the answer in any preamble — return ONLY the document body.`;
    const userMsg = `Tone: ${tone}. Length: ${lengthHint}.

Draft a document for this prompt:
${prompt}`;

    if (!llm?.chat) {
      const fallback = `# ${prompt.slice(0, 80)}\n\nDraft pending — the writing brain is offline. Compose locally and try AI again when the model is available.`;
      recordAiRun(db, { documentId, userId, kind: "compose", prompt, response: fallback, source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: true, html: plainTextToHtml(fallback), text: fallback, source: "fallback" };
    }

    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.7,
        maxTokens: lengthHint === "long" ? 1600 : (lengthHint === "short" ? 400 : 900),
        slot: "subconscious",
      }));
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const text = stripFences(raw).trim();
      const html = plainTextToHtml(text);
      recordAiRun(db, { documentId, userId, kind: "compose", prompt, response: text, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, html, text, source: "llm" };
    } catch (e) {
      const fallback = `# ${prompt.slice(0, 80)}\n\n(AI compose failed — ${e?.message || "unknown error"}.)`;
      recordAiRun(db, { documentId, userId, kind: "compose", prompt, response: fallback, source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: true, html: plainTextToHtml(fallback), text: fallback, source: "fallback", error: e?.message };
    }
  }, { requiresLLM: true, note: "Generate a full document body from a prompt (Notion 'Help me create' parity)" });

  // ─── 2. AI inline edit — Notion Agents flagship ─────────────────
  register("docs", "ai_inline_edit", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const selection = String(input.selection || "").trim();
    const instruction = String(input.instruction || "").trim();
    if (!selection) return { ok: false, reason: "selection_required" };
    if (!instruction) return { ok: false, reason: "instruction_required" };
    const documentId = input.documentId ? String(input.documentId) : null;
    if (documentId && !hasRole(db, documentId, userId, "editor")) return { ok: false, reason: "forbidden" };
    const llm = ctx?.llm;
    const t0 = Date.now();

    const sys = `You rewrite a passage of text per the user's instruction. Output ONLY the rewritten passage. Same approximate length unless the instruction asks otherwise. Preserve markdown structure if present. No preamble, no explanation, no quoting the original.`;
    const userMsg = `Instruction: ${instruction}

Original passage:
${selection}`;

    if (!llm?.chat) {
      recordAiRun(db, { documentId, userId, kind: "inline_edit", prompt: instruction, selectionText: selection, response: selection, source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: true, edited: selection, source: "fallback", reason: "llm_offline" };
    }

    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.5, maxTokens: Math.max(800, selection.length),
        slot: "utility",
      }));
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const edited = stripFences(raw).trim();
      if (!edited) {
        recordAiRun(db, { documentId, userId, kind: "inline_edit", prompt: instruction, selectionText: selection, response: "", source: "fallback", latencyMs: Date.now() - t0 });
        return { ok: false, reason: "empty_response" };
      }
      recordAiRun(db, { documentId, userId, kind: "inline_edit", prompt: instruction, selectionText: selection, response: edited, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, edited, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Rewrite a selection in place per an instruction (Notion Agents-style)" });

  // ─── 3. AI continue writing — Lex ++ trigger ────────────────────
  register("docs", "ai_continue", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const context = String(input.context || "").trim();
    if (!context) return { ok: false, reason: "context_required" };
    const documentId = input.documentId ? String(input.documentId) : null;
    if (documentId && !hasRole(db, documentId, userId, "editor")) return { ok: false, reason: "forbidden" };
    const matchVoice = input.matchVoice !== false;
    const llm = ctx?.llm;
    const t0 = Date.now();

    const anchors = matchVoice ? getVoiceAnchors(db, userId, { limit: 15, maxChars: 400 }) : [];
    const styleBlock = anchors.length
      ? `\n\nStyle anchors (the user's previous writing — match this voice):\n${anchors.slice(0, 8).map((s, i) => `${i + 1}. ${s}`).join("\n\n")}`
      : "";

    const sys = `You continue a piece of writing where the user left off. Output 2-4 sentences (or one short paragraph). Pick up mid-thought; never restate what was already written. No preamble or meta commentary.${styleBlock}`;
    const userMsg = `Continue from here:\n\n${context.slice(-3000)}`;

    if (!llm?.chat) {
      return { ok: true, continuation: "", source: "fallback", reason: "llm_offline" };
    }

    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.65, maxTokens: 300, slot: "utility",
      }));
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const continuation = stripFences(raw).trim();
      recordAiRun(db, { documentId, userId, kind: "continue", prompt: context.slice(-200), response: continuation, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, continuation, source: "llm", anchorCount: anchors.length };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Continue writing where the cursor is, optionally in the user's voice" });

  // ─── 4. AI Q&A grounded on workspace ────────────────────────────
  register("docs", "ai_qa", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const question = String(input.question || "").trim();
    if (!question) return { ok: false, reason: "question_required" };
    const documentId = input.documentId ? String(input.documentId) : null;
    const llm = ctx?.llm;
    const t0 = Date.now();

    // Build grounding: current doc + top 5 workspace search hits.
    const ground = [];
    if (documentId) {
      if (!hasRole(db, documentId, userId, "viewer")) return { ok: false, reason: "forbidden" };
      const doc = getDocument(db, documentId);
      if (doc) ground.push({ id: doc.id, title: doc.title, snippet: htmlToContext(doc.content_html, 2000) });
    }
    // Pull keyword matches across user's workspace for breadth
    const keywords = question.toLowerCase().split(/\W+/).filter((w) => w.length > 3).slice(0, 4);
    const seen = new Set(ground.map((g) => g.id));
    for (const kw of keywords) {
      const hits = searchUserDocs(db, { ownerId: userId, query: kw, limit: 4 });
      for (const h of hits) {
        if (seen.has(h.id) || ground.length >= 6) continue;
        seen.add(h.id);
        ground.push({ id: h.id, title: h.title, snippet: String(h.preview || "").slice(0, 600) });
      }
    }

    const sources = ground.map((g, i) => `[${i + 1}] "${g.title}" (${g.id})\n${g.snippet}`).join("\n\n");

    const sys = `You answer questions using ONLY the provided workspace sources. Be concise (under 200 words). When you use a source, cite it inline as [1], [2], etc. If none of the sources contain the answer, say so honestly — do NOT invent facts.`;
    const userMsg = `Question: ${question}\n\nSources:\n${sources || "(no sources available)"}`;

    if (!llm?.chat || ground.length === 0) {
      const fallback = ground.length === 0
        ? "I don't have any workspace sources for that yet. Try creating or importing some related docs first."
        : "Q&A brain offline. Workspace sources found:\n" + ground.map((g, i) => `[${i + 1}] ${g.title}`).join("\n");
      recordAiRun(db, { documentId, userId, kind: "qa", prompt: question, response: fallback, source: "fallback", latencyMs: Date.now() - t0 });
      return { ok: true, answer: fallback, sources: ground, source: "fallback" };
    }

    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.3, maxTokens: 500, slot: "conscious",
      }));
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const answer = stripFences(raw).trim();
      recordAiRun(db, { documentId, userId, kind: "qa", prompt: question, response: answer, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, answer, sources: ground, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Answer a question grounded on workspace content with inline citations" });

  // ─── 5. AI Match Writing Style ──────────────────────────────────
  register("docs", "ai_match_style", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const sourceText = String(input.sourceText || "").trim();
    const targetDocId = String(input.targetDocId || "");
    if (!sourceText) return { ok: false, reason: "sourceText_required" };
    if (!targetDocId) return { ok: false, reason: "targetDocId_required" };
    if (!hasRole(db, targetDocId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const targetDoc = getDocument(db, targetDocId);
    if (!targetDoc) return { ok: false, reason: "target_not_found" };
    const llm = ctx?.llm;
    const t0 = Date.now();

    const targetSample = htmlToContext(targetDoc.content_html, 2500);

    const sys = `You rewrite the source passage to match the writing style of the target sample: same sentence rhythm, vocabulary register, formality level, and paragraph structure. Preserve the source's meaning exactly. Output ONLY the rewritten passage.`;
    const userMsg = `Target style sample:\n${targetSample}\n\nSource passage to rewrite:\n${sourceText}`;

    if (!llm?.chat) return { ok: true, rewritten: sourceText, source: "fallback", reason: "llm_offline" };

    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.55, maxTokens: Math.max(800, sourceText.length),
        slot: "subconscious",
      }));
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const rewritten = stripFences(raw).trim();
      recordAiRun(db, { documentId: input.documentId || null, userId, kind: "match_style", prompt: `→ style of ${targetDocId}`, selectionText: sourceText, response: rewritten, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, rewritten, source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Rewrite source text to match a target doc's voice (Google Docs Match Writing Style parity)" });

  // ─── 6. AI Match Format ─────────────────────────────────────────
  register("docs", "ai_match_format", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const sourceContent = String(input.sourceContent || "").trim();
    const templateDocId = String(input.templateDocId || "");
    if (!sourceContent) return { ok: false, reason: "sourceContent_required" };
    if (!templateDocId) return { ok: false, reason: "templateDocId_required" };
    if (!hasRole(db, templateDocId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const templateDoc = getDocument(db, templateDocId);
    if (!templateDoc) return { ok: false, reason: "template_not_found" };
    const llm = ctx?.llm;
    const t0 = Date.now();

    const templateMd = templateDoc.content_md || htmlToContext(templateDoc.content_html, 3000);

    const sys = `You re-cast source content into a target template's STRUCTURE: same headings, same section order, same lists / tables, same formatting affordances. Fill the template's slots with the source's facts. Output a complete document as markdown (# headings, lists, etc.). Do not invent facts the source doesn't contain — leave sections empty if no info is available.`;
    const userMsg = `Template structure to mirror:\n${templateMd}\n\nSource content to slot into the template:\n${sourceContent}`;

    if (!llm?.chat) return { ok: true, formatted: sourceContent, html: plainTextToHtml(sourceContent), source: "fallback", reason: "llm_offline" };

    try {
      const r = await withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        temperature: 0.4, maxTokens: 1800, slot: "conscious",
      }));
      const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
      const formatted = stripFences(raw).trim();
      recordAiRun(db, { documentId: input.documentId || null, userId, kind: "match_format", prompt: `→ format of ${templateDocId}`, selectionText: sourceContent.slice(0, 1000), response: formatted, source: "llm", latencyMs: Date.now() - t0 });
      return { ok: true, formatted, html: plainTextToHtml(formatted), source: "llm" };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Re-cast content into a template's structure (Google Docs Match Format parity)" });

  // ─── 7. Voice dictation persistence ─────────────────────────────
  register("docs", "voice_transcribe", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    // Frontend uses Web Speech API for transcription (free, on-device);
    // this macro just persists the transcript to the doc-ai-run ledger
    // so version history captures the dictation event and the editor
    // gets a clean "insert this" payload to splice into the document.
    const transcript = String(input.transcript || "").trim();
    if (!transcript) return { ok: false, reason: "transcript_required" };
    const documentId = input.documentId ? String(input.documentId) : null;
    if (documentId && !hasRole(db, documentId, userId, "editor")) return { ok: false, reason: "forbidden" };
    const punctuate = input.punctuate !== false;

    let text = transcript;
    let source = "passthrough";
    const llm = ctx?.llm;
    if (punctuate && llm?.chat && transcript.length > 40 && !/[.?!]/.test(transcript)) {
      try {
        const r = await withTimeout(llm.chat({
          messages: [
            { role: "system", content: "Add punctuation + capitalization to the dictation. Do NOT add or remove words. Output ONLY the punctuated text." },
            { role: "user", content: transcript },
          ],
          temperature: 0.1, maxTokens: Math.ceil(transcript.length * 1.5), slot: "utility",
        }), 6000);
        const raw = String(r?.text || r?.content || r?.message?.content || "").trim();
        const cleaned = stripFences(raw).trim();
        if (cleaned && cleaned.length >= transcript.length * 0.7) {
          text = cleaned;
          source = "llm_punctuated";
        }
      } catch { /* fall back to passthrough */ }
    }

    recordAiRun(db, { documentId, userId, kind: "voice", prompt: "voice_transcribe", response: text, source: source === "llm_punctuated" ? "llm" : "deterministic" });
    return { ok: true, text, html: `<p>${text.replace(/\n+/g, "</p><p>")}</p>`, source };
  }, { destructive: false, note: "Persist a Web-Speech-API dictation transcript with optional LLM punctuation" });

  // ─── 8. AI Image generation (returns an SVG placeholder when no image brain) ──
  register("docs", "ai_image", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const prompt = String(input.prompt || "").trim();
    if (!prompt) return { ok: false, reason: "prompt_required" };
    const documentId = input.documentId ? String(input.documentId) : null;
    if (documentId && !hasRole(db, documentId, userId, "editor")) return { ok: false, reason: "forbidden" };
    // Concord's deployed multimodal brain is LLaVA (vision UNDERSTANDING,
    // not image SYNTHESIS). Until a synthesis backend lands (SDXL /
    // FLUX / DALL-E), generate a deterministic SVG placeholder seeded
    // by the prompt so the editor still gets a valid <img src> to drop
    // in. The macro is shaped so swapping in a real generator later is
    // a one-line change.
    const seed = (() => {
      let h = 0; for (const c of prompt) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
      return Math.abs(h);
    })();
    const c1 = `hsl(${seed % 360}, 70%, 50%)`;
    const c2 = `hsl(${(seed * 7) % 360}, 70%, 35%)`;
    const c3 = `hsl(${(seed * 13) % 360}, 50%, 25%)`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/><stop offset="50%" stop-color="${c2}"/><stop offset="100%" stop-color="${c3}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="450" fill="url(#g)"/>
  <circle cx="${200 + (seed % 400)}" cy="${100 + (seed % 250)}" r="${40 + (seed % 80)}" fill="rgba(255,255,255,0.2)"/>
  <circle cx="${(seed * 3) % 800}" cy="${(seed * 5) % 450}" r="${30 + (seed % 50)}" fill="rgba(0,0,0,0.18)"/>
  <text x="400" y="430" font-family="system-ui,-apple-system,sans-serif" font-size="16" fill="rgba(255,255,255,0.6)" text-anchor="middle">
    ${prompt.slice(0, 80).replace(/[<>&]/g, "")}
  </text>
</svg>`;
    const dataUri = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
    recordAiRun(db, { documentId, userId, kind: "image", prompt, response: `svg-placeholder bytes=${svg.length}`, source: "deterministic" });
    return {
      ok: true,
      url: dataUri,
      svg,
      kind: "svg-placeholder",
      note: "Concord's deployed multimodal brain is LLaVA (vision-understanding only). Returning a deterministic SVG placeholder seeded by the prompt — swap in SDXL/FLUX/DALL-E when a synthesis backend is wired.",
    };
  }, { requiresLLM: false, note: "Generate a cover/illustration image (deterministic SVG placeholder until image-synthesis brain lands)" });
}
