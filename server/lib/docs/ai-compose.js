// server/lib/docs/ai-compose.js
//
// Docs Sprint B — AI compose primitives.
//
// Shared helpers used by domains/docs-ai.js: timeouts, JSON
// extractors, deterministic fallback fragments, run-ledger writer.
// Each macro routes through ctx.llm.chat with a sensible default
// slot and falls back deterministically when the brain is offline
// so the surface keeps working without Ollama.

const TIMEOUT_MS_DEFAULT = 18_000;

export function withTimeout(p, ms = TIMEOUT_MS_DEFAULT) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms))]);
}

export function stripFences(s) {
  const m = String(s || "").match(/```(?:\w+)?\n([\s\S]*?)```/);
  return m ? m[1] : s;
}

export function extractJsonObject(raw) {
  const stripped = stripFences(raw).trim();
  try { const v = JSON.parse(stripped); if (v && typeof v === "object") return v; } catch { /* try */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

/**
 * Trim a doc's HTML to a token-budget-friendly plain-text snapshot for
 * LLM context windows. Strips tags + dedupes whitespace + caps length.
 */
export function htmlToContext(html, maxChars = 6000) {
  const txt = String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return txt.length > maxChars ? txt.slice(0, maxChars) + "…" : txt;
}

/**
 * Append a row to doc_ai_runs. Best-effort; never throws.
 */
export function recordAiRun(db, {
  documentId = null, userId, kind, skillId = null, prompt = null,
  selectionText = null, response, source = "llm",
  latencyMs = null, tokensIn = null, tokensOut = null,
}) {
  if (!db || !userId || !kind) return null;
  try {
    const r = db.prepare(`
      INSERT INTO doc_ai_runs
        (document_id, user_id, kind, skill_id, prompt, selection_text,
         response, source, latency_ms, tokens_in, tokens_out, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(documentId, userId, kind, skillId,
      prompt ? String(prompt).slice(0, 2000) : null,
      selectionText ? String(selectionText).slice(0, 2000) : null,
      String(response || "").slice(0, 12000),
      source, latencyMs, tokensIn, tokensOut);
    return r.lastInsertRowid;
  } catch { return null; }
}

/**
 * Convert plain text → minimal HTML the editor can render. Headings
 * (lines starting with #) become <h*>; blank-line-separated chunks
 * become <p>; * / - bullets become <ul><li>; numbered lists become
 * <ol><li>; ``` fences become <pre><code>.
 */
export function plainTextToHtml(text) {
  if (!text) return "";
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { body.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code>${body.map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")).join("\n")}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      out.push(`<h${h[1].length}>${h[2].trim()}</h${h[1].length}>`);
      i++; continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^[-*]\s+(.*)$/);
        if (!m) break;
        items.push(`<li><p>${m[1]}</p></li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    const ord = line.match(/^\d+\.\s+(.*)$/);
    if (ord) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\d+\.\s+(.*)$/);
        if (!m) break;
        items.push(`<li><p>${m[1]}</p></li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (line.trim() === "") { i++; continue; }
    // collect consecutive non-empty lines into a paragraph
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== ""
      && !/^[#`\-*\d]/.test(lines[i].trim()[0] || "")) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${para.join("<br />")}</p>`);
  }
  return out.join("");
}

/**
 * Pull the user's most recent doc bodies as "voice anchors" for
 * style-matching. Limited to N items, each truncated to 600 chars.
 */
export function getVoiceAnchors(db, userId, { limit = 25, maxChars = 600 } = {}) {
  if (!db || !userId) return [];
  try {
    const rows = db.prepare(`
      SELECT content_md FROM documents
      WHERE owner_id = ? AND deleted_at IS NULL AND content_md IS NOT NULL
      ORDER BY updated_at DESC LIMIT ?
    `).all(userId, limit);
    return rows.map((r) => String(r.content_md || "").slice(0, maxChars)).filter(Boolean);
  } catch { return []; }
}
