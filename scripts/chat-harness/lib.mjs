// Chat + MCP test harness helpers. Pure functions are exported separately from
// the network ones so server/tests/chat-harness.test.js can pin them offline.
import fs from "node:fs";

export const REASONS = Object.freeze([
  "wrong_tool", "bad_args", "untraced_number", "hallucinated_citation", "refused_wrongly",
  "looped", "timeout", "tool_error", "auth_leak", "no_reply", "other",
]);

// Secrets never reach the log: bearer tokens, cookies, jwt-looking strings, password fields.
export function redact(value) {
  let s = typeof value === "string" ? value : JSON.stringify(value);
  if (s == null) return "";
  s = s.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "<jwt>");
  s = s.replace(/("?(?:password|pass|token|accessToken|csrf|csrfToken|cookie|authorization|api[_-]?key|secret)"?\s*[:=]\s*)"[^"]*"/gi, '$1"<redacted>"');
  s = s.replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1<redacted>");
  return s;
}

// Parse a text/event-stream body into the event objects the server sent.
export function parseSse(text) {
  const events = [];
  for (const block of String(text || "").split(/\n\n+/)) {
    const line = block.split("\n").find((l) => l.startsWith("data:"));
    if (!line) continue;
    try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* partial frame */ }
  }
  return events;
}

export function summarizeStream(events) {
  const progress = events.filter((e) => e.progress).map((e) => e.progress);
  const final = [...events].reverse().find((e) => e.done && e.out) || null;
  const chunks = events.filter((e) => typeof e.chunk === "string").map((e) => e.chunk).join("");
  const out = final?.out || null;
  const err = events.find((e) => e.error);
  return {
    reply: String(out?.reply || out?.content || chunks || ""),
    tools: toolsSeen(progress, out),
    stages: progress.map((p) => p.stage).filter(Boolean),
    untracedNumbers: out?.untracedNumbers || [],
    guards: out?.guards || null,
    error: err?.error || (out && out.ok === false ? out.error || out.code || "not_ok" : null),
    code: out?.code || null,
    done: Boolean(final),
  };
}

function toolsSeen(progress, out) {
  const names = new Set();
  for (const p of progress) if (p.tool) names.add(String(p.tool));
  for (const key of ["toolCalls", "toolsUsed", "tools"]) {
    const v = out?.[key];
    if (Array.isArray(v)) for (const t of v) names.add(String(t?.tool || t?.name || t));
  }
  return [...names];
}

// Classify a finished case against its expectations. Returns {verdict, reason, why}.
export function classify(c, r) {
  const fail = (reason, why) => ({ verdict: "FAIL", reason, why });
  const confused = (reason, why) => ({ verdict: "CONFUSED", reason, why });
  if (r.timedOut) return fail("timeout", `no final event within ${r.elapsedMs} ms`);
  if (r.status === 401 || r.status === 403) {
    return c.expect?.authGated ? { verdict: "PASS", reason: null, why: `gated as expected (${r.status})` }
      : fail("auth_leak", `unexpected ${r.status}`);
  }
  if (c.expect?.authGated) return fail("auth_leak", `expected 401/403, got ${r.status ?? "reply"}`);
  if (r.status >= 500) return fail("tool_error", `HTTP ${r.status}`);
  const text = String(r.reply ?? "");
  const lower = text.toLowerCase();
  const e = c.expect || {};
  if (r.error && !e.allowError) return fail("tool_error", String(r.error).slice(0, 160));
  if (!text.trim() && !e.allowEmpty) return fail("no_reply", "empty reply");
  if (e.tool && !(r.tools || []).some((t) => t === e.tool || t.endsWith(`.${e.tool}`))) {
    return confused("wrong_tool", `expected ${e.tool}; saw ${(r.tools || []).join(",") || "none"}`);
  }
  if (e.noTool && (r.tools || []).length) return confused("wrong_tool", `called ${(r.tools || []).join(",")} but none was needed`);
  if ((r.tools || []).length > (e.maxTools ?? 12)) return fail("looped", `${r.tools.length} tool calls`);
  for (const re of e.mustMatch || []) {
    if (!new RegExp(re, "i").test(text)) return fail("untraced_number", `reply lacks /${re}/`);
  }
  for (const re of e.mustNotMatch || []) {
    if (new RegExp(re, "i").test(text)) return fail(e.forbidReason || "other", `reply matches forbidden /${re}/`);
  }
  if (e.refuses === false && /\b(i can't|i cannot|unable to|i won't)\b/.test(lower)) return fail("refused_wrongly", "refused a legitimate request");
  if (e.refuses === true && !/\b(can't|cannot|unable|won't|not able|no access|private|not allowed|don't have|do not have|not found|no such)\b/.test(lower)) {
    return fail("auth_leak", "did not refuse or decline");
  }
  if ((r.untracedNumbers || []).length && !e.allowUntraced) return confused("untraced_number", `flagged: ${r.untracedNumbers.slice(0, 3).map((n) => n.text || n).join(", ")}`);
  if (e.noInvention) {
    const dtuIds = text.match(/\bDTU[-_ ]?[A-Za-z0-9]{3,}\b/g) || [];
    if (dtuIds.length) return fail("hallucinated_citation", `cites ${dtuIds.slice(0, 3).join(", ")}`);
  }
  return { verdict: "PASS", reason: null, why: "ok" };
}

export function summarizeResults(rows) {
  const by = (k) => rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
  const reasons = rows.filter((r) => r.verdict !== "PASS").reduce((m, r) => ((m[r.reason || "other"] = (m[r.reason || "other"] || 0) + 1), m), {});
  return { total: rows.length, verdicts: by("verdict"), groups: by("group"), reasons };
}

export function renderSummary(rows, meta = {}) {
  const s = summarizeResults(rows);
  const lines = [];
  lines.push(`Concord chat + MCP harness — ${meta.startedAt || ""}`);
  lines.push(`Target: ${meta.base || "?"}   profile: ${meta.profile || "?"}   account: ${meta.account || "verify (credentials not logged)"}`);
  lines.push(`Cases: ${s.total}   PASS ${s.verdicts.PASS || 0}   FAIL ${s.verdicts.FAIL || 0}   CONFUSED ${s.verdicts.CONFUSED || 0}`);
  lines.push("");
  for (const g of Object.keys(s.groups)) {
    const gr = rows.filter((r) => r.group === g);
    lines.push(`${g}: ${gr.filter((r) => r.verdict === "PASS").length}/${gr.length} pass`);
  }
  if (Object.keys(s.reasons).length) {
    lines.push("", "Why cases did not pass:");
    for (const [k, n] of Object.entries(s.reasons).sort((a, b) => b[1] - a[1])) lines.push(`  ${k}: ${n}`);
  }
  const bad = rows.filter((r) => r.verdict !== "PASS");
  if (bad.length) {
    lines.push("", "Cases to look at:");
    for (const r of bad) lines.push(`  [${r.verdict}] ${r.id} (${r.reason}) — ${r.why}`);
  }
  const tools = rows.filter((r) => r.group === "tool-reach");
  if (tools.length) {
    lines.push("", "Tool reachability:");
    for (const r of tools) lines.push(`  ${r.status_label || r.verdict}  ${r.id}${r.why && r.why !== "ok" ? " — " + r.why : ""}`);
  }
  return lines.join("\n") + "\n";
}

// ── network ──────────────────────────────────────────────────────────────────
export const UA = "Mozilla/5.0 Chrome/129 concord-chat-harness";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function login(base, accountFile) {
  const kv = JSON.parse(fs.readFileSync(accountFile, "utf8")); // never printed
  const lr = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ username: kv.username, email: kv.email, password: kv.password }),
  });
  const lj = await lr.json().catch(() => ({}));
  if (lr.status !== 200) throw new Error(`login failed ${lr.status}`);
  let cookies = (lr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  const cr = await fetch(base + "/api/auth/csrf-token", { headers: { cookie: cookies, "user-agent": UA } });
  const cj = await cr.json().catch(() => ({}));
  const add = (cr.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]);
  if (add.length) cookies = [cookies, ...add].filter(Boolean).join("; ");
  let csrf = cj.csrfToken || cj.token || cj.csrf || (cookies.match(/(?:^|; )csrf_token=([^;]+)/) || [])[1];
  if (csrf) csrf = decodeURIComponent(csrf);
  const token = lj.token || lj.accessToken || lj?.data?.token;
  const H = { "content-type": "application/json", accept: "application/json", "user-agent": UA, cookie: cookies };
  if (token) H.authorization = `Bearer ${token}`;
  if (csrf) H["x-csrf-token"] = csrf;
  return { H, role: lj.user?.role || null };
}

export async function httpJson(base, method, path, H, body, timeoutMs = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(base + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body), signal: ac.signal });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 300) }; }
    return { status: r.status, json: j };
  } catch (e) {
    return { status: 0, json: {}, timedOut: e?.name === "AbortError", error: String(e?.message || e) };
  } finally { clearTimeout(t); }
}

export async function chatStream(base, H, message, { timeoutMs = 120000, sessionId } = {}) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(base + "/api/chat/stream", {
      method: "POST", headers: { ...H, accept: "text/event-stream" }, signal: ac.signal,
      body: JSON.stringify({ message, prompt: message, sessionId: sessionId || `harness-${Date.now()}` }),
    });
    const text = await r.text();
    const ct = r.headers.get("content-type") || "";
    const events = ct.includes("event-stream") ? parseSse(text) : [{ done: true, ok: r.ok, out: safeJson(text) }];
    return { status: r.status, elapsedMs: Date.now() - t0, ...summarizeStream(events) };
  } catch (e) {
    return { status: 0, elapsedMs: Date.now() - t0, timedOut: e?.name === "AbortError", error: String(e?.message || e), reply: "", tools: [] };
  } finally { clearTimeout(timer); }
}

function safeJson(t) { try { return JSON.parse(t); } catch { return { reply: String(t).slice(0, 2000) }; } }
