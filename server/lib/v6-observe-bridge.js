// server/lib/v6-observe-bridge.js
//
// Keeper-v6 JSON contract → Concord observe organs.
// The 2B may emit {tool, args, f0} (bench contract) instead of [TOOL_CALL:].
// This module parses that, enforces F0 DENY in CODE, and dispatches ALLOW
// observe-tier organs. Destructive / trading / secrets paths never execute.

const F0_DENY_NEEDLES = [
  "coinbase", "place_order", "placeorder", "launchctl", "unload",
  "second trader", "second_trader", "print secret", "print_secret",
  "api_key", "apikey", "csk_", "pm2 start",
];

const DENY_TOOLS = new Set([
  "coinbase", "place_order", "placeorder", "vault_write", "dila_dispatch",
  "launchctl", "secrets", "secret",
]);

// Observe-tier organs the 2B is allowed to actually run.
const OBSERVE_TOOLS = new Set([
  "dtu_search", "dtu_get", "dtu_list", "dila_status", "dila_workers",
  "dhtp_detect", "dhtp_stats", "brain_status", "brain_route",
  "sentinel_health_snapshot", "incident_active", "vault_stats", "vault_read",
  "lens_list", "lens_manifest", "atlas_search", "schema_status", "pod_status",
  "web_search", "concord.web_search", "concord.dtu.search", "concord.lens.list",
  "concord.verify", "concord.math", "concord.expert_mode.answer",
  "math.symbolicCompute", "expert_mode", "expert_mode.answer",
  "codebase.inspect", "run_compute", "run_lens_action",
]);

const MACRO_ALIASES = {
  "concord.verify": ["reason", "verify"],
  "concord.math": ["math", "symbolicCompute"],
  "math.symbolicCompute": ["math", "symbolicCompute"],
  "concord.expert_mode.answer": ["expert_mode", "answer"],
  "expert_mode": ["expert_mode", "answer"],
  "expert_mode.answer": ["expert_mode", "answer"],
  "concord.web_search": ["tools", "web_search"],
  "concord.dtu.search": ["discovery", "search"],
  "concord.lens.list": ["lens", "list"],
  "codebase.inspect": ["code", "inspect"],
};

export function isChallengePrompt(text) {
  const t = String(text || "");
  return /\b(i don'?t buy that|check it|verify that|look it up|prove it|source\?|citation)\b/i.test(t);
}

function f0Denied(call) {
  const f0 = String(call?.f0 || "").toUpperCase();
  if (f0 === "DENY") return { deny: true, reason: "f0_deny" };
  const blob = `${call?.tool || ""} ${JSON.stringify(call?.params || call?.args || {})}`.toLowerCase();
  for (const n of F0_DENY_NEEDLES) {
    if (blob.includes(n)) return { deny: true, reason: `f0_deny_needle:${n}` };
  }
  const tool = String(call?.tool || "").toLowerCase();
  if (DENY_TOOLS.has(tool) || tool.startsWith("coinbase")) {
    return { deny: true, reason: `deny_tool:${tool}` };
  }
  return { deny: false };
}

function extractJsonObjects(text) {
  const s = String(text || "");
  const out = [];
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf("{", i);
    if (start < 0) break;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = start; j < s.length; j++) {
      const c = s[j];
      if (inStr) {
        if (esc) { esc = false; }
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end < 0) break;
    const slice = s.slice(start, end + 1);
    try {
      const obj = JSON.parse(slice);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) out.push(obj);
    } catch { /* not json */ }
    i = end + 1;
  }
  return out;
}

/**
 * Parse [TOOL_CALL:] markers, v6 JSON {tool,args,f0}, and Ollama native tool_calls.
 * @returns {{tool:string, params:object, f0?:string, raw:string}[]}
 */
export function parseObserveCalls(text, ollamaMessage) {
  const calls = [];
  const seen = new Set();
  const push = (tool, params, f0, raw) => {
    const t = String(tool || "").trim();
    if (!t || t.toLowerCase() === "none") return;
    const key = `${t}:${JSON.stringify(params || {})}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({ tool: t, params: params && typeof params === "object" ? params : {}, f0, raw: raw || t });
  };

  const re = /\[TOOL_CALL:\s*(\{[\s\S]*?\})\s*\]/g;
  let m;
  const s = String(text || "");
  while ((m = re.exec(s)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed?.tool) push(parsed.tool, parsed.params || parsed.args || {}, parsed.f0, m[0]);
    } catch { /* skip */ }
  }

  for (const obj of extractJsonObjects(s)) {
    if (obj.tool || obj.organ) {
      push(obj.tool || obj.organ, obj.args || obj.params || obj.input || {}, obj.f0, "v6-json");
    }
  }

  const native = ollamaMessage?.tool_calls;
  if (Array.isArray(native)) {
    for (const tc of native) {
      const fn = tc?.function || tc;
      const name = fn?.name || tc?.name;
      let args = fn?.arguments || tc?.arguments || tc?.params || {};
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { args = { query: args }; }
      }
      if (name) push(name, args, "ALLOW", "ollama-native");
    }
  }
  return calls;
}

export function challengeFallbackCall(prompt, priorAssistant) {
  const claim = String(priorAssistant || "").slice(0, 800);
  const q = String(prompt || "").slice(0, 400);
  const blob = `${q} ${claim}`.toLowerCase();
  // Prefer verify for factual/math claims; status organs for self/system;
  // web_search only when the claim needs external lookup.
  if (/\b(\d+\s*[+\-*/x×]\s*\d+|sqrt|integral|derivative|compute|calculate|math)\b/i.test(blob)) {
    return {
      tool: "concord.math",
      params: { expression: (claim || q).slice(0, 400) },
      f0: "ALLOW",
      raw: "challenge-fallback-math",
    };
  }
  // Do NOT match bare "status" — v6 JSON replies include "status":"verified"
  // and were wrongly routing every challenge to dila_status.
  if (/\b(dila|orchestrat|workers?|pod_status|brain_status|ollama)\b/i.test(blob)
      || /\b(system|server|orchestrator)\s+status\b/i.test(blob)
      || /\bhealth\s*(check|snapshot)?\b/i.test(blob)) {
    const tool = /\b(brain|ollama|brain_status)\b/i.test(blob) ? "brain_status" : "dila_status";
    return { tool, params: {}, f0: "ALLOW", raw: "challenge-fallback-status" };
  }
  // Concord-domain claims → verify organ; general "check it" → web_search.
  if (/\b(concord|dtu|lattice|council|macro)\b/i.test(blob)) {
    return {
      tool: "concord.verify",
      params: { claim: (claim || q).slice(0, 500) },
      f0: "ALLOW",
      raw: "challenge-fallback-verify",
    };
  }
  return {
    tool: "web_search",
    params: { query: (claim ? `${claim} ${q}` : q).slice(0, 500) },
    f0: "ALLOW",
    raw: "challenge-fallback-web",
  };
}

function isObserveTool(tool) {
  const t = String(tool || "");
  if (OBSERVE_TOOLS.has(t) || OBSERVE_TOOLS.has(t.toLowerCase())) return true;
  // dotted observe macros (math.*, lens.list, reason.verify, …)
  if (/^(math|lens|reason|expert_mode|discovery|tools|code|physics|research)\./i.test(t)) return true;
  return false;
}

/**
 * Execute one observe-tier call. DENY is enforced here, not hoped from the model.
 */
export async function executeObserveOrgan(call, deps = {}) {
  const { runMacro, callMCPTool, runMcpTool, ctx, db, STATE } = deps;
  const gate = f0Denied(call);
  if (gate.deny) {
    return { tool: call.tool, ok: false, error: gate.reason, f0: "DENY" };
  }
  const tool = String(call.tool || "");
  if (!isObserveTool(tool)) {
    return { tool, ok: false, error: "not_observe_organ", f0: call.f0 || "n/a" };
  }

  const params = call.params || {};
  const MAX = 12_000;

  try {
    if (tool === "web_search" || tool === "concord.web_search") {
      if (typeof runMacro !== "function") return { tool, ok: false, error: "no_runMacro" };
      let q = String(params.query || params.claim || params.q || "").trim();
      if (!q) q = String(deps.fallbackQuery || call.raw || "").trim();
      if (!q) return { tool, ok: false, error: "query required" };
      const r = await runMacro("tools", "web_search", { query: q.slice(0, 500) }, ctx);
      if (!r?.ok) return { tool, ok: false, error: r?.error || "web_search failed", query: q.slice(0, 120) };
      return { tool, ok: true, result: String(r.summary || r.text || JSON.stringify(r)).slice(0, MAX), query: q.slice(0, 120) };
    }

    const alias = MACRO_ALIASES[tool];
    if (alias && typeof (runMcpTool || runMacro) === "function") {
      const fn = runMcpTool || runMacro;
      const r = await fn(alias[0], alias[1], params, ctx);
      return { tool, ok: r?.ok !== false, result: r, error: r?.ok === false ? (r?.error || "macro_failed") : undefined };
    }

    if (typeof callMCPTool === "function" && db) {
      try {
        const r = await callMCPTool(db, tool, params, STATE || null);
        if (r && r.ok !== false && r.error !== "unknown_tool") {
          return { tool, ok: true, result: typeof r === "string" ? r.slice(0, MAX) : r };
        }
      } catch (err) {
        const msg = String(err?.message || err);
        if (!/unknown tool/i.test(msg)) {
          return { tool, ok: false, error: msg };
        }
      }
    }

    if (tool.includes(".") && typeof (runMcpTool || runMacro) === "function") {
      const [domain, ...rest] = tool.replace(/^concord\./, "").split(".");
      const action = rest.join(".");
      if (domain && action) {
        const fn = runMcpTool || runMacro;
        const r = await fn(domain, action, params, ctx);
        return { tool, ok: r?.ok !== false, result: r, error: r?.ok === false ? (r?.error || "macro_failed") : undefined };
      }
    }

    return { tool, ok: false, error: `unmapped_observe_tool:${tool}` };
  } catch (err) {
    return { tool, ok: false, error: String(err?.message || err) };
  }
}

export const V6_TOOL_HINT = `
If you need an organ, you may also emit a single JSON object (v6 contract) instead of [TOOL_CALL:]:
{"intent":"...","confidence":0.8,"evidence":[],"action":"propose","status":"unverified","f0":"ALLOW","tool":"web_search","args":{"query":"..."}}
Observe-only tools: web_search, concord.verify, concord.math, math.symbolicCompute, brain_status, dila_status, lens_list, expert_mode.answer, dtu_search.
f0=DENY for Coinbase, place_order, secrets, launchctl unload, second trader — the executor will refuse those even if you emit them.
When the user challenges a claim ("I don't buy that", "check it"), you MUST call an observe organ before answering.`;

export default { parseObserveCalls, executeObserveOrgan, isChallengePrompt, challengeFallbackCall, V6_TOOL_HINT };
