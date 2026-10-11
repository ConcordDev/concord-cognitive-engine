/**
 * Explicit "save/create a DTU titled … with content …" is formal intent.
 *
 * CSL used to classify the tool-params JSON (not the user's sentence) and
 * reject create_dtu as not_formal_intent. The sentence itself is the intent.
 */

const _NEGATED = /\b(?:don'?t|do not|never|stop)\s+(?:save|create|make)\b/i;

const _LOOSE = /\b(?:save|create)\s+(?:a\s+|an\s+)?dtus?\b/i;

const _TITLED = /\b(?:save|create)\s+(?:a\s+|an\s+)?dtus?\s+titled\s+(.+?)\s+with\s+content\s+([\s\S]+)/i;

function _unquote(s) {
  return String(s || "").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
}

/** Title + body from an explicit save/create sentence, or null. */
export function parseExplicitDtuSave(text) {
  const raw = String(text || "").trim();
  if (!raw || _NEGATED.test(raw)) return null;
  const m = raw.match(_TITLED);
  if (!m) return null;
  const title = _unquote(m[1]).replace(/[.\s]+$/g, "");
  let content = m[2].trim();
  content = content.replace(/\s*,?\s*then\b[\s\S]*$/i, "").trim();
  content = _unquote(content).replace(/[.\s]+$/g, "");
  if (!title || !content) return null;
  return { title, content };
}

/**
 * True when the user explicitly asked to save or create a DTU.
 * A negated request ("don't create a DTU") is not formal intent.
 */
export function isExplicitDtuSaveIntent(text) {
  const raw = String(text || "").trim();
  if (!raw || _NEGATED.test(raw)) return false;
  if (parseExplicitDtuSave(raw)) return true;
  return _LOOSE.test(raw);
}

/** Macro input for a private DTU owned by the authenticated actor. */
export function explicitDtuCreateInput({ title, content }, sessionId) {
  const body = String(content || "");
  return {
    title: String(title || "Untitled"),
    human: { summary: body, bullets: [] },
    content: body,
    creti: body,
    tags: ["chat"],
    tier: "regular",
    source: "chat_tool",
    visibility: "private",
    domain: "chat",
    lens: "chat",
    consent: {
      allowCitations: false,
      shareToFeed: false,
      publishToMarketplace: false,
      allowAiTraining: false,
    },
    sessionId,
    core: {
      claims: body ? [body] : [],
      definitions: [],
      invariants: [],
      examples: [],
      nextActions: [],
    },
  };
}

export function savedDtuReply({ id, title }) {
  return `Saved a private DTU titled "${title || "Untitled"}" (id: ${id}).`;
}

export const PDF_CAPABILITY_MESSAGE = "I can't create PDFs yet; use Export/Print.";

/** A request to produce a PDF file, not a question about the format. */
export function isPdfCreateRequest(text) {
  const raw = String(text || "");
  if (parseExplicitDtuSave(raw)) return false;
  return /\b(?:make|create|generate|export|print|download)\b[\s\S]{0,48}\bpdfs?\b/i.test(raw)
    || /\bpdfs?\b[\s\S]{0,48}\b(?:make|create|generate|export|print|download)\b/i.test(raw);
}
