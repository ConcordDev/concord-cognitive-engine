// server/domains/whiteboard-ai.js
//
// Whiteboard Sprint A — Items #2 + #4:
//   brainstorm — real subconscious brain call, returns N sticky-ready ideas
//   summarize  — real utility brain call over current scene; returns summary + action items + decisions
//
// (Item #3 semantic clustering is implemented inline in whiteboard.js,
//  using the same real-Ollama embedText helper.)
//
// All calls return real LLM output or, on brain unavailable, a
// deterministic fallback that is honest about being deterministic
// (so the UI can label "AI offline — heuristic ideas only").

const TIMEOUT_MS = 18_000;
const BRAINSTORM_MAX = 50;

function _withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout_${ms}ms`)), ms))]);
}

function _stripCodeFences(s) {
  const m = String(s || "").match(/```(?:\w+)?\n([\s\S]*?)```/);
  return m ? m[1] : s;
}

function _extractJsonArray(raw) {
  const stripped = _stripCodeFences(raw).trim();
  // Try exact parse first
  try { const v = JSON.parse(stripped); if (Array.isArray(v)) return v; } catch { /* try regex */ }
  const m = stripped.match(/\[[\s\S]*\]/);
  if (m) { try { const v = JSON.parse(m[0]); if (Array.isArray(v)) return v; } catch { /* fall through */ } }
  return null;
}

function _extractJsonObject(raw) {
  const stripped = _stripCodeFences(raw).trim();
  try { const v = JSON.parse(stripped); if (v && typeof v === "object") return v; } catch { /* try regex */ }
  const m = stripped.match(/\{[\s\S]*\}/);
  if (m) { try { const v = JSON.parse(m[0]); if (v && typeof v === "object") return v; } catch { /* nope */ } }
  return null;
}

function _deterministicBrainstorm(prompt, count) {
  // Honest: this is heuristic, not creative. UI surfaces this when
  // the brain is unreachable. Returns count short noun-phrases derived
  // from the prompt's words.
  const seedWords = String(prompt || "ideas").split(/\W+/).filter(Boolean);
  const angles = ["why", "what if", "who else", "compare", "smaller", "bigger", "faster", "simpler", "remove", "combine", "invert", "automate"];
  const out = [];
  for (let i = 0; i < count; i++) {
    const angle = angles[i % angles.length];
    const seed = seedWords[i % seedWords.length] || "it";
    out.push(`${angle.charAt(0).toUpperCase()}${angle.slice(1)} ${seed}?`);
  }
  return out;
}

export default function registerWhiteboardAiMacros(register) {
  register("whiteboard", "brainstorm", async (ctx, input = {}) => {
    const prompt = String(input.prompt || "").trim();
    const count = Math.min(BRAINSTORM_MAX, Math.max(1, Number(input.count) || 12));
    if (!prompt) return { ok: false, reason: "prompt_required" };
    const llm = ctx?.llm;
    if (!llm?.chat) {
      return { ok: true, ideas: _deterministicBrainstorm(prompt, count), source: "deterministic_fallback" };
    }
    const sys = `You are a brainstorming partner generating ${count} terse, distinct ideas.
Respond with ONLY a JSON array of strings. No prose around the array. Each idea ≤ 80 chars.`;
    const user = `Topic: ${prompt}\n\nGenerate ${count} ideas.`;
    try {
      const r = await _withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        temperature: 0.85, maxTokens: 1024, slot: "subconscious",
      }), TIMEOUT_MS);
      const raw = String(r?.text || r?.content || r?.message?.content || "");
      const arr = _extractJsonArray(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        return { ok: true, ideas: arr.slice(0, count).map((x) => String(x).slice(0, 200)), source: "llm" };
      }
      return { ok: true, ideas: _deterministicBrainstorm(prompt, count), source: "deterministic_fallback_parse_failed", raw: raw.slice(0, 300) };
    } catch (e) {
      return { ok: true, ideas: _deterministicBrainstorm(prompt, count), source: "deterministic_fallback_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Generate N brainstorm ideas; falls back to deterministic angles when LLM unreachable" });

  register("whiteboard", "summarize", async (ctx, input = {}) => {
    const elements = Array.isArray(input.elements) ? input.elements : [];
    if (elements.length === 0) return { ok: false, reason: "no_elements" };
    // Gather all sticky/text content (cap at 200 items, 200 chars each).
    const items = elements
      .map((el) => String(el.text || el.label || "").trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((s) => s.slice(0, 200));
    if (items.length === 0) return { ok: false, reason: "no_text_content" };
    const llm = ctx?.llm;
    if (!llm?.chat) {
      return {
        ok: true,
        summary: `${items.length} ideas captured; LLM offline — heuristic-only synthesis.`,
        action_items: items.slice(0, 5).map((s) => `Discuss: ${s}`),
        decisions: [],
        source: "deterministic_fallback",
      };
    }
    const sys = `You are summarising a whiteboard session. Respond with ONLY a JSON object:
{
  "summary": "1-3 sentence prose summary of what the team explored",
  "action_items": ["short imperative action", ...up to 10],
  "decisions": ["decision the team reached", ...up to 10],
  "themes": ["theme", ...up to 5]
}
No prose around the JSON.`;
    const user = `Session contents (${items.length} items):\n${items.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
    try {
      const r = await _withTimeout(llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        temperature: 0.3, maxTokens: 1200, slot: "utility",
      }), TIMEOUT_MS);
      const raw = String(r?.text || r?.content || r?.message?.content || "");
      const obj = _extractJsonObject(raw);
      if (obj && typeof obj === "object") {
        return {
          ok: true,
          summary: String(obj.summary || "").slice(0, 1000),
          action_items: Array.isArray(obj.action_items) ? obj.action_items.slice(0, 10).map((s) => String(s).slice(0, 200)) : [],
          decisions: Array.isArray(obj.decisions) ? obj.decisions.slice(0, 10).map((s) => String(s).slice(0, 200)) : [],
          themes: Array.isArray(obj.themes) ? obj.themes.slice(0, 5).map((s) => String(s).slice(0, 100)) : [],
          source: "llm",
        };
      }
      return { ok: false, reason: "parse_failed", raw: raw.slice(0, 300) };
    } catch (e) {
      return { ok: false, reason: "llm_error", error: e?.message };
    }
  }, { requiresLLM: true, note: "Summarise the board into summary + action items + decisions + themes" });
}
