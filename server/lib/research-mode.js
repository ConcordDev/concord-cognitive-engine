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

// Words that say nothing about the topic: a source sharing only these with
// the goal is not relevant.
const GENERIC = new Set(("the and for with that this from into about what which best good top small large new more most how why when where who your you our "
  + "research report write find compare comparison review reviews list guide make build create plan week weeks day days month "
  + "me my please need want give tell show using use used get one two three latest").split(" "));

function stem(w) { return w.length > 4 ? w.replace(/(ies)$/, "y").replace(/(es|s)$/, "") : w; }

/** Topic terms of a goal: lowercased, stemmed, minus generic words. */
export function keyTerms(text) {
  const out = new Set();
  for (const raw of String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9+-]{1,}/g) || []) {
    const w = stem(raw);
    if (w.length >= 3 && !GENERIC.has(raw) && !GENERIC.has(w) && !/^\d+$/.test(w)) out.add(w);
  }
  return out;
}

/** How many of the goal's key terms a source mentions (title, url, text). */
export function relevanceHits(terms, c) {
  if (!terms || !terms.size) return 1;
  const have = keyTerms(`${c.title || ""} ${c.url || ""} ${c.excerpt || ""} ${c.text || ""}`);
  let n = 0;
  for (const t of terms) if (have.has(t)) n++;
  return n;
}

function isGoogleNewsRedirect(u) {
  try { return /(^|\.)news\.google\.com$/i.test(new URL(String(u)).hostname); } catch { return false; }
}

/**
 * Sources in one tick's tool calls: pages actually read (browse_url, kind
 * "page") and the top search hits (kind "search", leads only). With a goal,
 * sources that share no key terms with it are dropped. Google News redirect links are dropped
 * unless the fetch resolved them to the publisher's URL.
 */
export function citationsFromToolCalls(toolCalls = [], goal = "") {
  const terms = keyTerms(goal);
  const out = [];
  for (const c of Array.isArray(toolCalls) ? toolCalls : []) {
    if (!c || c.ok === false) continue;
    if (c.tool === "browse_url") {
      // A search-listing fallback means the page was NOT fetched.
      if (c.fallback === "search-listing") continue;
      const url = normUrl(c.finalUrl || c.resolvedUrl || c.url || c.params?.url);
      if (!url || isGoogleNewsRedirect(url)) continue;
      const raw = String(c.text || c.content || c.result?.text || "");
      const excerpt = cleanExcerpt(raw);
      const text = cleanExcerpt(raw, 4000);
      const cand = { url, title: String(c.title || url).slice(0, 200), excerpt, text, kind: "page" };
      if (excerpt.length >= 120 && relevanceHits(terms, cand) >= 1) out.push(cand);
    } else if (c.tool === "web_search") {
      const r = parseMaybe(c.result) || c;
      const hits = Array.isArray(r?.results) ? r.results : [];
      for (const h of hits.slice(0, MAX_SEARCH_HITS_PER_CALL)) {
        const url = normUrl(h?.url);
        if (!url || isGoogleNewsRedirect(url)) continue;
        if (relevanceHits(terms, { title: h.title, url, excerpt: h.snippet }) < 1) continue;
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
  const found = citationsFromToolCalls(toolCalls, session.goal || session.title || "");
  if (!found.length) return [];
  const meta = readMeta(db, session.id);
  // URLs already saved as a fetched page. A URL saved only as a search hit
  // is saved again when the page is actually read (the upgrade).
  const prior = Array.isArray(meta.citations) ? meta.citations : [];
  const pageUrls = new Set(prior.filter((c) => c.kind === "page").map((c) => c.url));
  const have = new Set(Array.isArray(meta.citationUrls) ? meta.citationUrls : []);
  let room = MAX_CITATIONS_PER_JOB - (Array.isArray(meta.citationDtuIds) ? meta.citationDtuIds.length : 0);
  // Pages first: a page actually read is the better citation.
  found.sort((a, b) => (a.kind === "page" ? 0 : 1) - (b.kind === "page" ? 0 : 1));
  const saved = [];
  for (const c of found) {
    if (room <= 0) break;
    if (pageUrls.has(c.url)) continue;
    if (c.kind !== "page" && have.has(c.url)) continue;
    have.add(c.url);
    if (c.kind === "page") pageUrls.add(c.url);
    const host = (() => { try { return new URL(c.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    const body = `${c.title}\n${c.url}\n\n${c.kind === "page" ? (c.text || c.excerpt) : c.excerpt}`;
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
      if (r?.ok && id) { saved.push({ id, url: c.url, title: c.title, kind: c.kind, ...(c.kind === "page" ? { text: String(c.text || c.excerpt).slice(0, 4000) } : {}) }); room--; }
    } catch { /* skip this source */ }
  }
  if (saved.length) {
    writeMetaPatch(db, session.id, (m) => ({
      ...m,
      citationDtuIds: [...(Array.isArray(m.citationDtuIds) ? m.citationDtuIds : []), ...saved.map((s) => s.id)],
      citationUrls: [...new Set([...(Array.isArray(m.citationUrls) ? m.citationUrls : []), ...saved.map((s) => s.url)])],
      // A page read replaces the search-hit entry for the same URL.
      citations: [...(Array.isArray(m.citations) ? m.citations : []).filter((c) => !saved.some((s) => s.kind === "page" && s.url === c.url)), ...saved].slice(-MAX_CITATIONS_PER_JOB),
    }));
  }
  return saved.map((s) => s.id);
}

// A "Progress notes:" label at the start of a line (optionally bold), or a
// "## Progress notes" heading line. The long-task prompt asks every reply to
// end with one. Prose that merely starts with the words does not match.
const PROGRESS_NOTES_RE = /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*|__)?[ \t]*progress notes[ \t]*(?::|(?:\*\*|__)[ \t]*:|(?:\*\*|__)?[ \t]*$)/im;

/** Cut a trailing "Progress notes:" section off one block of text. */
function withoutProgressNotes(block) {
  const m = PROGRESS_NOTES_RE.exec(block);
  if (!m) return block;
  return block.slice(0, m.index).trim();
}

/**
 * The deliverable part of a final answer: drop loop markers and progress
 * notes, keep every section of the report.
 *
 * INC-140: this used to split on markdown "---" rules and keep only the last
 * part when it was 400+ chars. Reports that put "---" between sections lost
 * everything but the final one (the saved report was "Sources" plus progress
 * notes, no summary or findings). Now every "---" part is kept except parts
 * that are progress notes, and a trailing notes section inside a part is cut.
 * When nothing but notes is left (a job that stopped early), the notes are
 * what it had, so they are kept.
 */
export function reportBody(answer) {
  const t = String(answer || "")
    .replace(/\[TASK_COMPLETE\]/gi, "")
    .replace(/\[TASK_BLOCKED:[^\]]*\]/gi, "")
    .replace(/\[SUBGOAL_COMPLETE:[^\]]*\]/gi, "")
    .replace(/\[TOOL_CALL:[\s\S]*?\]\s*$/gm, "")
    .trim();
  const parts = t.split(/\n[ \t]*-{3,}[ \t]*\n/);
  const kept = [];
  for (const raw of parts) {
    const part = withoutProgressNotes(raw.trim());
    if (part) kept.push(part);
  }
  const body = kept.join("\n\n---\n\n").trim();
  return body || t;
}

// Numeric specs: a number with a unit (servo torque, voltage, speed, weight,
// size, price). Plain counts, years and list numbers are not specs.
const UNIT = String.raw`(?:kg[\s·.-]?cm|kgf[\s·.-]?cm|oz[\s·.-]?in|N[\s·.-]?m|mN[\s·.-]?m|kg|g|grams?|oz|lbs?|mm|cm|in(?:ch(?:es)?)?|V|volts?|mA|A|amps?|W|rpm|RPM|ms|µs|us|sec(?:onds?)?|s|Hz|kHz|°|deg(?:rees)?)`;
const SPEC_RE = new RegExp(String.raw`(\$\s?\d+(?:[.,]\d+)?|\d+(?:\.\d+)?(?:\s?(?:-|–|to|~)\s?\d+(?:\.\d+)?)?\s?${UNIT})(?![A-Za-z])`, "g");

function numbersIn(text) {
  const out = new Set();
  for (const m of String(text || "").replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) || []) out.add(String(parseFloat(m)));
  return out;
}

/**
 * Compare every numeric spec in the report with the text of the pages the job
 * actually fetched. A spec is supported when every number in it appears in
 * that text. Unsupported specs are flagged inline with "(unverified)" and
 * listed at the end. Returns { text, checked, supported, unsupported[] }.
 */
export function claimCheck(body, evidenceTexts = []) {
  const have = numbersIn(evidenceTexts.join("\n"));
  const unsupported = [];
  let checked = 0;
  const text = String(body || "").split("\n").map((line) => {
    // Links and the sources list are not claims.
    if (/^\s*\d+\.\s*\[.*\]\(https?:/.test(line)) return line;
    return line.replace(SPEC_RE, (spec, _g, offset, whole) => {
      const before = whole.slice(Math.max(0, offset - 40), offset);
      // "sec/60°" is a speed unit, not a second claim; links aren't claims.
      if (/\/\s*$/.test(before) || /https?:\/\/\S*$/.test(before) || /\]\($/.test(before)) return spec;
      checked++;
      const nums = (spec.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) || []).map((n) => String(parseFloat(n)));
      if (nums.length && nums.every((n) => have.has(n))) return spec;
      unsupported.push(spec.trim());
      return `${spec} (unverified)`;
    });
  }).join("\n");
  return { text, checked, supported: checked - unsupported.length, unsupported };
}

/**
 * Render a finished research or plan job as a markdown document via
 * document.create and store meta.report = { dtuId, filename, downloadUrl,
 * sizeBytes, kind }. Research reports cite only pages the job actually
 * fetched and carry a claim check; plan documents lead with the dated
 * milestones. Idempotent.
 */
export async function createResearchReport(db, sessionId, runMacro, { planSummary = null, formatPlan = null } = {}) {
  if (!db || !sessionId || typeof runMacro !== "function") return null;
  const session = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id = ?`).get(sessionId);
  if (!session) return null;
  const meta = readMeta(db, sessionId);
  if (!meta.longTask || !["research", "plan"].includes(meta.mode) || meta.report) return meta.report || null;
  const last = db.prepare(`SELECT content FROM agent_marathon_turns WHERE session_id = ? AND role = 'assistant' AND TRIM(content) != '' ORDER BY turn_index DESC LIMIT 1`).get(sessionId);
  let body = reportBody(last?.content || "");
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "America/New_York" });
  const status = session.status === "completed" ? "" : ` (the job ${session.status === "paused" ? "stopped early" : "hit its limit"}; this is what it had)`;
  let title, md, tags, check = null;
  if (meta.mode === "plan") {
    if (body.length < 200) return null;
    let ms = "";
    try {
      const ps = planSummary ? planSummary(db, meta) : null;
      if (ps && formatPlan) ms = `## Dated milestones\n\n${formatPlan(ps, { full: true })}\n\n`;
    } catch { ms = ""; }
    title = `Plan: ${String(session.title || session.goal || "").replace(/^plan\s+/i, "").slice(0, 100)}`;
    md = `# ${title}\n\nWritten ${date}.\n\n${ms}${body}\n\n---\nBackground job ${sessionId}, ${date}${status}.`;
    tags = ["plan-document", "document"];
  } else {
    // Only pages the job actually read are cited; search hits were leads.
    const cites = (Array.isArray(meta.citations) ? meta.citations : []).filter((c) => c.kind === "page");
    if (body.length < 200 && !cites.length) return null;
    check = claimCheck(body, cites.map((c) => `${c.title || ""}\n${c.text || ""}`));
    body = check.text;
    const sources = cites.length
      ? `\n\n## Sources (pages read)\n\n${cites.map((c, i) => `${i + 1}. [${String(c.title).replace(/[[\]]/g, "")}](${c.url}) (citation DTU ${c.id})`).join("\n")}`
      : "\n\n## Sources\n\nNo web pages were successfully read for this job, so nothing here is source-checked.";
    const checkNote = check.checked
      ? `\n\n## Claim check\n\n${check.supported} of ${check.checked} numeric specs match text in the pages read.${check.unsupported.length ? ` Not found in any source, marked (unverified): ${[...new Set(check.unsupported)].slice(0, 20).join("; ")}.` : ""}`
      : "";
    title = `Research report: ${String(session.title || session.goal || "").replace(/^research\s+/i, "").slice(0, 90)}`;
    md = `${body}${sources}${checkNote}\n\n---\nBackground job ${sessionId}, ${date}${status}.`;
    tags = ["research-report", "document"];
  }
  let r;
  try {
    r = await runMacro("document", "create", { title, format: "md", body: md, summary: md.slice(0, 2000), tags }, macroCtx(db, session));
  } catch { return null; }
  if (!r?.ok) return null;
  const report = { dtuId: r.dtuId, filename: r.filename, downloadUrl: r.downloadUrl, sizeBytes: r.sizeBytes, kind: meta.mode === "plan" ? "plan" : "research", ...(check ? { claimCheck: { checked: check.checked, supported: check.supported, unsupported: check.unsupported.slice(0, 20) } } : {}) };
  writeMetaPatch(db, sessionId, (m) => ({ ...m, report }));
  return report;
}

export default { claimCheck, keyTerms, relevanceHits, citationsFromToolCalls, saveCitationDtus, createResearchReport, reportBody, cleanExcerpt };
