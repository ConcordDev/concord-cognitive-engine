// server/lib/chat-v6-contract.js
//
// Guard for chat.respond: see tests/chat-v6-contract-guard.test.js.

// True when a brain reply is ONLY a V6 JSON contract object (intent/confidence/
// action/status/…) with no runnable tool — i.e. something that must never be
// shown to a user as prose. Accepts an optional ```json fence. Returns the
// parsed object, or null for anything else (prose, prose+JSON, tool calls).
export function v6ContractOnly(text) {
  let t = String(text || "").trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return null;
  let obj;
  try { obj = JSON.parse(t); } catch { return null; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const contractKeys = ["intent", "confidence", "evidence", "action", "status", "f0"].filter((k) => k in obj).length;
  if (contractKeys < 2) return null;
  const tool = String(obj.tool || obj.organ || "").trim().toLowerCase();
  if (tool && tool !== "none") return null;
  return obj;
}

/**
 * Broader guard: the reply is ONLY a JSON object (any shape, e.g. a bare
 * {"query":…,"answer":94444} guess). Never render that as prose. Returns the
 * parsed object or null.
 */
export function jsonOnlyReply(text) {
  let t = String(text || "").trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return null;
  try {
    const obj = JSON.parse(t);
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    // Malformed but unmistakably JSON-shaped (a model emitted a broken object,
    // e.g. {"toneLock":…,"anchor":{…}}\n"nextLoop":…}) — still never prose.
    return /"[A-Za-z_][\w-]*"\s*:/.test(t) ? {} : null;
  }
}
