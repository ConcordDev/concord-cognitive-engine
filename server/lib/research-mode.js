// server/lib/research-mode.js
//
// Research long tasks (lib/long-task.js, mode "research"): every web source
// the job reads becomes a private citation DTU, and the finished job is
// rendered as a real downloadable report (document.create) whose Sources
// section lists those citations. Best-effort throughout: a failed save never
// stops the job, and nothing here invents a source that a tool didn't return.

const MAX_CITATIONS_PER_JOB = Number(process.env.CONCORD_RESEARCH_MAX_CITATIONS) || 30;
const MAX_SEARCH_HITS_PER_CALL = 3;

function normUrl(u) {
  try {
    const x = new URL(String(u));
    if (!/^https?:$/.test(x.protocol)) return null;
    x.hash = "";
    for (const k of [...x.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(k)) x.searchParams.delete(k);
    return x.toString();
  } catch { return null; }
}

/** Readable excerpt from fetched page text: drop nav-sized lines, collapse whitespace. */
export function cleanExcerpt(text, n = 900) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length >= 40);
  return lines.join(" ").slice(0, n);
}

function parseMaybe(v) {
  if (v && typeof v === "object") return v;
  try { return JSON.parse(String(v || "")); } catch { return null; }
}

/** Sources in one tick's tool calls: pages read (browse_url) and the top search hits. */
export function citationsFromToolCalls(toolCalls = []) {
  const out = [];
  for (const c of Array.isArray(toolCalls) ? toolCalls : []) {
    if (!c || c.ok === false) continue;
    if (c.tool === "browse_url") {
      const url = normUrl(c.url || c.params?.url);
      const excerpt = cleanExcerpt(c.text || c.content || c.result?.text || "");
      if (url && excerpt.length >= 120) out.push({ url, title: String(c.title || url).slice(0, 200), excerpt, kind: "page" });
    } else if (c.tool === "web_search") {
      const r = parseMaybe(c.result) || c;
      const hits = Array.isArray(r?.results) ? r.results : [];
      for (const h of hits.slice(0, MAX_SEARCH_HITS_PER_CALL)) {
        const url = normUrl(h?.url);
        const snippet = String(h?.snippet || "").replace(/\s+/g, " ").trim();
        if (url && snippet.length >= 40) out.push({ url, title: String(h.title || url).slice(0, 200), excerpt: snippet.slice(0, 500), kind: "search", ...(h.outlet ? { outlet: String(h.outlet) } : {}), ...(h.published ? { published: String(h.published) } : {}) });
      }
    }
  }
  return out;
}

function readMeta(db, id) {
  try { return JSON.parse(db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id = ?`).get(id)?.meta_json || "{}") || {}; } catch { return {}; }
}
function writeMetaPatch(db, id, patchFn) {
  try {
    const fresh = readMeta(db, id);
    db.prepare(`UPDATE agent_marathon_sessions SET meta_json = ? WHERE id = ?`).run(JSON.stringify(patchFn(fresh)), id);
  } catch { /* best-effort */ }
}

function macroCtx(db, session) {
  return { db, actor: { userId: session.user_id, role: "member", sessionId: session.id }, userId: session.user_id, reqMeta: { sessionId: session.id }, log: () => {} };
}

/**
 * Save new sources from this tick as citation DTUs. A page read upgrades a
 * search-hit citation of the same URL only by being saved first; duplicates
 * by URL are skipped. Returns the new DTU ids.
 */
export async function saveCitationDtus(db, session, toolCalls, runMacro) {
  if (!db || !session || typeof runMacro !== "function") return [];
  const found = citationsFromToolCalls(toolCalls);
  if (!found.length) return [];
  const meta = readMeta(db, session.id);
  const have = new Set(Array.isArray(meta.citationUrls) ? meta.citationUrls : []);
  let room = MAX_CITATIONS_PER_JOB - (Array.isArray(meta.citationDtuIds) ? meta.citationDtuIds.length : 0);
  // Pages first: a page actually read is the better citation.
  found.sort((a, b) => (a.kind === "page" ? 0 : 1) - (b.kind === "page" ? 0 : 1));
  const saved = [];
  for (const c of found) {
    if (room <= 0) break;
    if (have.has(c.url)) continue;
    have.add(c.url);
    const host = (() => { try { return new URL(c.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    const body = `${c.title}\n${c.url}\n\n${c.excerpt}`;
    try {
      const r = await runMacro("dtu", "create", {
        title: `Source: ${c.title}`.slice(0, 200),
        human: { summary: c.excerpt.slice(0, 600), bullets: [c.url] },
        content: body,
        creti: body,
        tags: ["citation", "web-source", "research", ...(host ? [host] : [])],
        tier: "regular",
        source: "agent_tool",
        visibility: "private",
        meta: { kind: "citation", url: c.url, sourceKind: c.kind, retrievedAt: new Date().toISOString(), marathonSessionId: session.id, ...(c.outlet ? { outlet: c.outlet } : {}), ...(c.published ? { published: c.published } : {}) },
      }, macroCtx(db, session));
      const id = r?.id || r?.dtu?.id;
      if (r?.ok && id) { saved.push({ id, url: c.url, title: c.title }); room--; }
    } catch { /* skip this source */ }
  }
  if (saved.length) {
    writeMetaPatch(db, session.id, (m) => ({
      ...m,
      citationDtuIds: [...(Array.isArray(m.citationDtuIds) ? m.citationDtuIds : []), ...saved.map((s) => s.id)],
      citationUrls: [...new Set([...(Array.isArray(m.citationUrls) ? m.citationUrls : []), ...saved.map((s) => s.url)])],
      citations: [...(Array.isArray(m.citations) ? m.citations : []), ...saved].slice(-MAX_CITATIONS_PER_JOB),
    }));
  }
  return saved.map((s) => s.id);
}

/** The deliverable part of a final answer: drop loop markers and a leading progress-notes block. */
export function reportBody(answer) {
  let t = String(answer || "")
    .replace(/\[TASK_COMPLETE\]/gi, "")
    .replace(/\[TASK_BLOCKED:[^\]]*\]/gi, "")
    .replace(/\[SUBGOAL_COMPLETE:[^\]]*\]/gi, "")
    .replace(/\[TOOL_CALL:[\s\S]*?\]\s*$/gm, "")
    .trim();
  const parts = t.split(/\n\s*-{3,}\s*\n/);
  const tail = parts[parts.length - 1].trim();
  if (parts.length > 1 && tail.length >= 400) t = tail;
  return t;
}

/**
 * Render the finished research job as a markdown report via document.create.
 * Stores meta.report = { dtuId, filename, downloadUrl, sizeBytes }. Idempotent.
 */
export async function createResearchReport(db, sessionId, runMacro) {
  if (!db || !sessionId || typeof runMacro !== "function") return null;
  const session = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id = ?`).get(sessionId);
  if (!session) return null;
  const meta = readMeta(db, sessionId);
  if (!meta.longTask || meta.mode !== "research" || meta.report) return meta.report || null;
  const last = db.prepare(`SELECT content FROM agent_marathon_turns WHERE session_id = ? AND role = 'assistant' AND TRIM(content) != '' ORDER BY turn_index DESC LIMIT 1`).get(sessionId);
  const body = reportBody(last?.content || "");
  const cites = Array.isArray(meta.citations) ? meta.citations : [];
  if (body.length < 200 && !cites.length) return null;
  const title = `Research report: ${String(session.title || session.goal || "").replace(/^research\s+/i, "").slice(0, 90)}`;
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "America/New_York" });
  const status = session.status === "completed" ? "" : ` (the job ${session.status === "paused" ? "stopped early" : "hit its limit"}; this is what it had)`;
  const sources = cites.length
    ? `\n\n## Sources\n\n${cites.map((c, i) => `${i + 1}. [${String(c.title).replace(/[[\]]/g, "")}](${c.url}) (citation DTU ${c.id})`).join("\n")}`
    : "";
  const md = `${body}${sources}\n\n---\nBackground job ${sessionId}, ${date}${status}.`;
  let r;
  try {
    r = await runMacro("document", "create", {
      title, format: "md", body: md, summary: md.slice(0, 2000),
      tags: ["research-report", "document"],
    }, macroCtx(db, session));
  } catch { return null; }
  if (!r?.ok) return null;
  const report = { dtuId: r.dtuId, filename: r.filename, downloadUrl: r.downloadUrl, sizeBytes: r.sizeBytes };
  writeMetaPatch(db, sessionId, (m) => ({ ...m, report }));
  return report;
}

export default { citationsFromToolCalls, saveCitationDtus, createResearchReport, reportBody, cleanExcerpt };
