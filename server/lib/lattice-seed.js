// server/lib/lattice-seed.js
//
// Recovered Auto-DTU + ingest-scheduler loop from an older ConcordOS
// backend. Does NOT rebuild:
//   • ingest-engine.js (planetary URL ingest + council mint)
//   • the hypothesis *statistics* lens or hypothesis-engine
//   • the in-memory research-jobs pipeline
//   • chat / ask-Concord (already a first-class path)
//   • OpenAI embeddings (existing embedding tables cover that)
//
// Unique loop: labeled source → queued page → quota-gated SSRF-guarded
// fetch → hypotheses → experimental auto-DTU → human trust promotion.
//
// Quota is derived from the authenticated actor's role, NEVER from a
// request-body `mode`/`tier` field (see ingest-tier-role-derivation).
// Fetch goes through lib/public-fetch.js#fetchPublicUrl (same SSRF
// chokepoint as ingest-engine). LLM prompts live in prompt-registry
// TASK_PROMPTS; missing brains fall back to deterministic seed shaping
// rather than fabricating a success.

import { fetchPublicUrl } from "./public-fetch.js";
import { TASK_PROMPTS } from "./prompt-registry.js";

export const TRUST_LEVELS = Object.freeze(["experimental", "trusted"]);
export const LAYERS = Object.freeze(["domain", "HLM", "HLR", "meta"]);

export const MEMBER_PAGES_PER_DAY = 10;
export const ADMIN_PAGES_PER_DAY = 100;
export const ADMIN_FAMILY_ROLES = Object.freeze(["owner", "admin", "founder", "sovereign"]);

export const FETCH_CHAR_CAP = 20_000;
export const EXCERPT_CHAR_CAP = 2_000;
export const SUMMARY_CHAR_CAP = 400;
export const KEY_MAX_LEN = 60;
export const LIST_LIMIT = 50;

function tableExists(db, name) {
  try {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  } catch {
    return false;
  }
}

function requireDb(db) {
  if (!db || typeof db.prepare !== "function") return { ok: false, reason: "no_db" };
  if (!tableExists(db, "lattice_seed_sources")) return { ok: false, reason: "no_table" };
  return null;
}

export function pagesPerDayForRole(role) {
  const r = String(role || "").toLowerCase();
  return ADMIN_FAMILY_ROLES.includes(r) ? ADMIN_PAGES_PER_DAY : MEMBER_PAGES_PER_DAY;
}

export function todayStartIso(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function slugify(str) {
  return (String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, KEY_MAX_LEN)) || "dtu";
}

export function excerptFromHtml(raw, cap = EXCERPT_CHAR_CAP) {
  const text = String(raw || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, cap);
}

function parseTags(raw) {
  if (Array.isArray(raw)) return raw.map((t) => String(t).toLowerCase()).filter(Boolean).slice(0, 12);
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.map((t) => String(t).toLowerCase()).filter(Boolean).slice(0, 12) : [];
  } catch {
    return [];
  }
}

function parseJsonFence(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : s;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }
}

async function maybeChat(llm, system, user) {
  if (!llm || typeof llm.chat !== "function") return null;
  try {
    const r = await llm.chat({
      system,
      messages: [{ role: "user", content: user }],
      temperature: 0.4,
      slot: "utility",
      maxTokens: 800,
    });
    if (!r || r.ok === false) return null;
    const content = typeof r === "string" ? r : (r.content || r.text || "");
    const trimmed = String(content || "").trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function addMemory(db, { userId, scope, dtuKey = null, text, source = null, layer = null, nowIso }) {
  db.prepare(`
    INSERT INTO lattice_seed_memory (user_id, scope, dtu_key, text, source, layer, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, scope, dtuKey, String(text || "").slice(0, 8000), source, layer, nowIso);
}

// ── Sources / pages ─────────────────────────────────────────────────────

export function createSource(db, userId, { rootUrl = null, label, notes = null } = {}, now = new Date()) {
  const blocked = requireDb(db);
  if (blocked) return blocked;
  const trimmed = String(label || "").trim();
  if (!trimmed) return { ok: false, reason: "label_required" };
  const createdAt = now.toISOString();
  const info = db.prepare(`
    INSERT INTO lattice_seed_sources (user_id, root_url, label, notes, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, rootUrl ? String(rootUrl).trim() : null, trimmed.slice(0, 200), notes ? String(notes).slice(0, 2000) : null, createdAt);
  return { ok: true, id: Number(info.lastInsertRowid) };
}

export function listSources(db, userId) {
  const blocked = requireDb(db);
  if (blocked) return blocked;
  const sources = db.prepare(`
    SELECT id, root_url AS rootUrl, label, notes, created_at AS createdAt
    FROM lattice_seed_sources
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);
  return { ok: true, sources };
}

export function queuePage(db, userId, { sourceId, url } = {}) {
  const blocked = requireDb(db);
  if (blocked) return blocked;
  const sid = Number(sourceId);
  const u = String(url || "").trim();
  if (!sid || !u) return { ok: false, reason: "source_and_url_required" };
  if (!/^https?:\/\//i.test(u)) return { ok: false, reason: "url_must_be_http" };
  const source = db.prepare("SELECT id FROM lattice_seed_sources WHERE id = ? AND user_id = ?").get(sid, userId);
  if (!source) return { ok: false, reason: "source_not_found" };
  const info = db.prepare(`
    INSERT INTO lattice_seed_pages (user_id, source_id, url, status)
    VALUES (?, ?, ?, 'queued')
  `).run(userId, sid, u.slice(0, 2000));
  return { ok: true, id: Number(info.lastInsertRowid) };
}

export function listPages(db, userId, { sourceId, status } = {}) {
  const blocked = requireDb(db);
  if (blocked) return blocked;
  const clauses = ["user_id = ?"];
  const params = [userId];
  if (sourceId) { clauses.push("source_id = ?"); params.push(Number(sourceId)); }
  if (status) { clauses.push("status = ?"); params.push(String(status)); }
  const pages = db.prepare(`
    SELECT id, source_id AS sourceId, url, status, content_excerpt AS contentExcerpt,
           last_processed_at AS lastProcessedAt, error_message AS errorMessage
    FROM lattice_seed_pages
    WHERE ${clauses.join(" AND ")}
    ORDER BY id DESC
    LIMIT 100
  `).all(...params);
  return { ok: true, pages };
}

export function quotaUsedToday(db, userId, now = new Date()) {
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM lattice_seed_ingest_log
    WHERE user_id = ? AND processed_at >= ?
  `).get(userId, todayStartIso(now));
  return Number(row?.cnt || 0);
}

export async function executeNext(db, userId, {
  role = "guest",
  llm = null,
  fetchImpl = null,
  now = new Date(),
} = {}) {
  const blocked = requireDb(db);
  if (blocked) return blocked;

  const quota = pagesPerDayForRole(role);
  const used = quotaUsedToday(db, userId, now);
  if (used >= quota) {
    return { ok: false, reason: "quota_reached", quotaUsed: used, quotaLimit: quota };
  }

  const page = db.prepare(`
    SELECT id, source_id AS sourceId, url, status
    FROM lattice_seed_pages
    WHERE user_id = ? AND status = 'queued'
    ORDER BY id ASC
    LIMIT 1
  `).get(userId);
  if (!page) return { ok: false, reason: "no_queued_pages" };

  let raw = "";
  try {
    const res = await fetchPublicUrl(page.url, {
      headers: { "User-Agent": "Concord/1.0 (Lattice Seed; +https://concord-os.org)" },
    }, fetchImpl ? { fetchImpl } : {});
    if (!res || res.ok === false) {
      const status = res?.status != null ? `HTTP ${res.status}` : "fetch_failed";
      db.prepare(`
        UPDATE lattice_seed_pages
        SET status = 'error', error_message = ?, last_processed_at = ?
        WHERE id = ? AND user_id = ?
      `).run(status, now.toISOString(), page.id, userId);
      return { ok: false, reason: "fetch_failed", pageId: page.id, error: status };
    }
    raw = String(await res.text()).slice(0, FETCH_CHAR_CAP);
  } catch (err) {
    const code = err?.code === "SSRF_BLOCKED" ? "ssrf_blocked" : "fetch_failed";
    db.prepare(`
      UPDATE lattice_seed_pages
      SET status = 'error', error_message = ?, last_processed_at = ?
      WHERE id = ? AND user_id = ?
    `).run(String(err?.message || code).slice(0, 500), now.toISOString(), page.id, userId);
    return { ok: false, reason: code, pageId: page.id, error: String(err?.message || code) };
  }

  const excerpt = excerptFromHtml(raw);
  if (!excerpt) {
    db.prepare(`
      UPDATE lattice_seed_pages
      SET status = 'error', error_message = 'empty_page', last_processed_at = ?
      WHERE id = ? AND user_id = ?
    `).run(now.toISOString(), page.id, userId);
    return { ok: false, reason: "empty_page", pageId: page.id };
  }

  const hyp = await proposeHypotheses(db, userId, {
    text: excerpt,
    sourceLabel: `ingest-page:${page.id}`,
    llm,
    now,
  });
  const hypothesesText = hyp.ok ? hyp.hypotheses : excerpt.slice(0, 400);

  const nowIso = now.toISOString();
  db.prepare(`
    UPDATE lattice_seed_pages
    SET status = 'processed', content_excerpt = ?, last_processed_at = ?, error_message = NULL
    WHERE id = ? AND user_id = ?
  `).run(excerpt, nowIso, page.id, userId);
  db.prepare(`
    INSERT INTO lattice_seed_ingest_log (user_id, page_id, processed_at, bytes_ingested)
    VALUES (?, ?, ?, ?)
  `).run(userId, page.id, nowIso, raw.length);
  addMemory(db, {
    userId,
    scope: "ingest",
    text: `URL: ${page.url}\nExcerpt:\n${excerpt}\n\nHypotheses:\n${hypothesesText}`,
    source: `ingest-page:${page.id}`,
    layer: "HLM",
    nowIso,
  });

  return {
    ok: true,
    pageId: page.id,
    excerpt,
    hypotheses: hypothesesText,
    hypothesisId: hyp.ok ? hyp.id : null,
    quotaUsed: used + 1,
    quotaLimit: quota,
    composer: hyp.ok ? hyp.composer : "none",
  };
}

// ── Hypotheses ──────────────────────────────────────────────────────────

function deterministicHypotheses(text) {
  const excerpt = String(text || "").replace(/\s+/g, " ").trim().slice(0, 280);
  if (!excerpt) return "";
  return [
    `1. The source claims: "${excerpt.slice(0, 140)}". What independent measurement would confirm or falsify that claim?`,
    `2. Which existing DTU layer (domain / HLM / HLR) should own this material, and what would a contradictory source look like?`,
    `3. What is the smallest follow-up ingest that would raise or lower trust in this excerpt?`,
  ].join("\n");
}

export async function proposeHypotheses(db, userId, { text, sourceLabel = null, llm = null, now = new Date() } = {}) {
  const blocked = requireDb(db);
  if (blocked) return blocked;
  const seed = String(text || "").trim();
  if (!seed) return { ok: false, reason: "text_required" };

  let composer = "deterministic";
  let hypothesesText = deterministicHypotheses(seed);
  const llmText = await maybeChat(llm, TASK_PROMPTS.latticeSeedHypotheses(), seed.slice(0, 4000));
  if (llmText) {
    hypothesesText = llmText;
    composer = "llm";
  }

  const createdAt = now.toISOString();
  const info = db.prepare(`
    INSERT INTO lattice_seed_hypotheses (user_id, text, source_label, created_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, hypothesesText.slice(0, 8000), sourceLabel ? String(sourceLabel).slice(0, 200) : null, createdAt);
  addMemory(db, {
    userId,
    scope: "hypothesis",
    text: hypothesesText,
    source: sourceLabel || "manual-hypothesis",
    layer: "HLR",
    nowIso: createdAt,
  });
  return { ok: true, id: Number(info.lastInsertRowid), hypotheses: hypothesesText, composer };
}

export function listHypotheses(db, userId, { sourceLabel } = {}) {
  const blocked = requireDb(db);
  if (blocked) return blocked;
  const rows = sourceLabel
    ? db.prepare(`
        SELECT id, text, source_label AS sourceLabel, created_at AS createdAt
        FROM lattice_seed_hypotheses
        WHERE user_id = ? AND source_label = ?
        ORDER BY created_at DESC LIMIT ?
      `).all(userId, sourceLabel, LIST_LIMIT)
    : db.prepare(`
        SELECT id, text, source_label AS sourceLabel, created_at AS createdAt
        FROM lattice_seed_hypotheses
        WHERE user_id = ?
        ORDER BY created_at DESC LIMIT ?
      `).all(userId, LIST_LIMIT);
  return { ok: true, hypotheses: rows };
}

// ── Research jobs ───────────────────────────────────────────────────────

function deterministicResearchSummary(topic, selected) {
  const lines = selected.slice(0, 40).map(
    (d) => `- [${d.layer || "domain"}] ${d.title} (${d.key}): ${String(d.summary || "").slice(0, 160)}`,
  );
  return [
    `Topic: ${topic}`,
    `DTUs consulted: ${selected.length}`,
    lines.length ? "Relevant DTUs:\n" + lines.join("\n") : "No matching DTUs were supplied — synthesis is scoped to the topic string only.",
    "Uncertainties: language model unavailable; this is a deterministic consult list, not a generated finding.",
    "Suggested next: mint an experimental auto-DTU from this job once a brain can synthesize, or after a human edits the summary.",
  ].join("\n");
}

export function createResearchJob(db, userId, { topic, dtuKeys = [], layer = null } = {}, now = new Date()) {
  const blocked = requireDb(db);
  if (blocked) return blocked;
  const t = String(topic || "").trim();
  if (!t) return { ok: false, reason: "topic_required" };
  const createdAt = now.toISOString();
  const info = db.prepare(`
    INSERT INTO lattice_seed_research_jobs
      (user_id, topic, dtu_keys, layer, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(userId, t.slice(0, 2000), JSON.stringify(Array.isArray(dtuKeys) ? dtuKeys.slice(0, 50) : []), layer || null, createdAt, createdAt);
  return { ok: true, id: Number(info.lastInsertRowid), status: "pending" };
}

export async function processResearchJob(db, userId, jobId, { llm = null, listDtus = null, now = new Date() } = {}) {
  const blocked = requireDb(db);
  if (blocked) return blocked;
  const job = db.prepare(`
    SELECT id, topic, dtu_keys AS dtuKeys, layer, status
    FROM lattice_seed_research_jobs
    WHERE id = ? AND user_id = ?
  `).get(Number(jobId), userId);
  if (!job) return { ok: false, reason: "job_not_found" };
  if (job.status !== "pending") return { ok: false, reason: "job_not_pending", status: job.status };

  let selected = [];
  if (typeof listDtus === "function") {
    try { selected = (await listDtus()) || []; } catch { selected = []; }
  }
  let keys = [];
  try { keys = JSON.parse(job.dtuKeys || "[]"); } catch { keys = []; }
  if (Array.isArray(keys) && keys.length) {
    selected = selected.filter((d) => keys.includes(d.key));
  }
  if (job.layer) {
    selected = selected.filter((d) => d.layer === job.layer);
  }

  let composer = "deterministic";
  let summary = deterministicResearchSummary(job.topic, selected);
  const llmText = await maybeChat(
    llm,
    TASK_PROMPTS.latticeSeedResearch({ topic: job.topic }),
    selected.slice(0, 40).map((d) => `- [${d.layer || "domain"}] ${d.title} (${d.key}): ${d.summary}`).join("\n")
      || `(no DTUs selected)\nResearch the topic: ${job.topic}`,
  );
  if (llmText) {
    summary = llmText;
    composer = "llm";
  }

  const updatedAt = now.toISOString();
  db.prepare(`
    UPDATE lattice_seed_research_jobs
    SET status = 'done', result_summary = ?, updated_at = ?, error_message = NULL
    WHERE id = ? AND user_id = ?
  `).run(summary.slice(0, 16000), updatedAt, job.id, userId);
  addMemory(db, {
    userId,
    scope: "research",
    text: `Topic: ${job.topic}\nSummary:\n${summary}`,
    source: `research-job:${job.id}`,
    layer: job.layer || "HLR",
    nowIso: updatedAt,
  });
  return { ok: true, id: job.id, status: "done", resultSummary: summary, composer };
}

export function listResearchJobs(db, userId, { status } = {}) {
  const blocked = requireDb(db);
  if (blocked) return blocked;
  const rows = status
    ? db.prepare(`
        SELECT id, topic, dtu_keys AS dtuKeys, layer, status, result_summary AS resultSummary,
               error_message AS errorMessage, created_at AS createdAt, updated_at AS updatedAt
        FROM lattice_seed_research_jobs
        WHERE user_id = ? AND status = ?
        ORDER BY created_at DESC LIMIT ?
      `).all(userId, String(status), LIST_LIMIT)
    : db.prepare(`
        SELECT id, topic, dtu_keys AS dtuKeys, layer, status, result_summary AS resultSummary,
               error_message AS errorMessage, created_at AS createdAt, updated_at AS updatedAt
        FROM lattice_seed_research_jobs
        WHERE user_id = ?
        ORDER BY created_at DESC LIMIT ?
      `).all(userId, LIST_LIMIT);
  return { ok: true, jobs: rows };
}

// ── Auto-DTUs ───────────────────────────────────────────────────────────

export async function generateUniqueDtuKey(db, userId, baseKey) {
  const all = new Set(
    db.prepare("SELECT dtu_key FROM lattice_seed_auto_dtus WHERE user_id = ?").all(userId).map((r) => r.dtu_key),
  );
  const base = slugify(baseKey);
  if (!all.has(base)) return base;
  let i = 2;
  while (all.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function deterministicDtu(seedText, { layerHint, kind } = {}) {
  const seed = String(seedText || "").replace(/\s+/g, " ").trim();
  const firstLine = seed.split(/[.!?\n]/)[0].trim().slice(0, 80);
  return {
    key: slugify(firstLine || "auto-dtu"),
    title: firstLine || "Auto-generated DTU",
    summary: seed.slice(0, SUMMARY_CHAR_CAP) || "No seed text.",
    tags: ["auto", "generated"],
    layer: LAYERS.includes(layerHint) ? layerHint : "domain",
    kind: kind || "auto",
  };
}

export async function generateDtuFromSeed(db, userId, seedText, { layerHint, kind, llm = null } = {}) {
  const fallback = deterministicDtu(seedText, { layerHint, kind });
  let parsed = null;
  const llmText = await maybeChat(
    llm,
    TASK_PROMPTS.latticeSeedDtu({ layerHint: layerHint || "none" }),
    String(seedText || "").slice(0, 4000),
  );
  if (llmText) parsed = parseJsonFence(llmText);
  const draft = {
    key: slugify(parsed?.key || parsed?.title || fallback.key),
    title: String(parsed?.title || fallback.title).slice(0, 200),
    summary: String(parsed?.summary || fallback.summary).slice(0, 2000),
    tags: parseTags(parsed?.tags?.length ? parsed.tags : fallback.tags),
    layer: LAYERS.includes(parsed?.layer) ? parsed.layer : fallback.layer,
    kind: kind || "auto",
  };
  const uniqueKey = await generateUniqueDtuKey(db, userId, draft.key);
  return { ...draft, dtu_key: uniqueKey, composer: parsed ? "llm" : "deterministic" };
}

function persistAutoDtu(db, userId, dtu, { sourceKind, sourceId, nowIso }) {
  db.prepare(`
    INSERT INTO lattice_seed_auto_dtus
      (user_id, dtu_key, title, summary, tags, layer, kind, trust_level, minted_dtu_id, source_kind, source_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'experimental', NULL, ?, ?, ?)
  `).run(
    userId,
    dtu.dtu_key,
    dtu.title,
    dtu.summary,
    JSON.stringify(dtu.tags),
    dtu.layer,
    dtu.kind,
    sourceKind,
    sourceId,
    nowIso,
  );
  addMemory(db, {
    userId,
    scope: "dtu",
    dtuKey: dtu.dtu_key,
    text: `Auto-DTU created from ${sourceKind} ${sourceId}:\nTitle: ${dtu.title}\nSummary: ${dtu.summary}`,
    source: `auto-dtu-from-${sourceKind}:${sourceId}`,
    layer: dtu.layer,
    nowIso,
  });
}

async function maybeMintIntoSubstrate(dtu, mintDtu) {
  if (typeof mintDtu !== "function") return null;
  try {
    const minted = await mintDtu({
      title: dtu.title,
      tags: dtu.tags,
      source: `lattice-seed:${dtu.kind}`,
      meta: {
        latticeSeedKey: dtu.dtu_key,
        trustLevel: "experimental",
        layer: dtu.layer,
        kind: dtu.kind,
        summary: dtu.summary,
      },
    });
    const id = minted?.dtu?.id || minted?.id || null;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

export async function mintFromHypothesis(db, userId, { hypothesisId, layerHint = "HLM", kind = "auto-hypothesis", llm = null, mintDtu = null } = {}, now = new Date()) {
  const blocked = requireDb(db);
  if (blocked) return blocked;
  const row = db.prepare(`
    SELECT id, text, source_label AS sourceLabel
    FROM lattice_seed_hypotheses
    WHERE id = ? AND user_id = ?
  `).get(Number(hypothesisId), userId);
  if (!row) return { ok: false, reason: "hypothesis_not_found" };

  const seedText = `Hypothesis (id: ${row.id}, source: ${row.sourceLabel || "unknown"}):\n${row.text}`;
  const dtu = await generateDtuFromSeed(db, userId, seedText, { layerHint, kind, llm });
  const nowIso = now.toISOString();
  persistAutoDtu(db, userId, dtu, { sourceKind: "hypothesis", sourceId: row.id, nowIso });
  const mintedId = await maybeMintIntoSubstrate(dtu, mintDtu);
  if (mintedId) {
    db.prepare(`
      UPDATE lattice_seed_auto_dtus SET minted_dtu_id = ? WHERE user_id = ? AND dtu_key = ?
    `).run(mintedId, userId, dtu.dtu_key);
  }
  return {
    ok: true,
    dtu: {
      key: dtu.dtu_key,
      title: dtu.title,
      summary: dtu.summary,
      tags: dtu.tags,
      layer: dtu.layer,
      kind: dtu.kind,
      trustLevel: "experimental",
      mintedDtuId: mintedId,
      composer: dtu.composer,
    },
  };
}

export async function mintFromResearchJob(db, userId, { jobId, layerHint = "HLR", kind = "auto-research", llm = null, mintDtu = null } = {}, now = new Date()) {
  const blocked = requireDb(db);
  if (blocked) return blocked;
  const row = db.prepare(`
    SELECT id, topic, result_summary AS resultSummary, status
    FROM lattice_seed_research_jobs
    WHERE id = ? AND user_id = ?
  `).get(Number(jobId), userId);
  if (!row) return { ok: false, reason: "job_not_found" };
  if (row.status !== "done") return { ok: false, reason: "job_not_completed", status: row.status };

  const seedText = `Research job (id: ${row.id}) on topic "${row.topic}". Summary:\n${row.resultSummary}`;
  const dtu = await generateDtuFromSeed(db, userId, seedText, { layerHint, kind, llm });
  const nowIso = now.toISOString();
  persistAutoDtu(db, userId, dtu, { sourceKind: "research", sourceId: row.id, nowIso });
  const mintedId = await maybeMintIntoSubstrate(dtu, mintDtu);
  if (mintedId) {
    db.prepare(`
      UPDATE lattice_seed_auto_dtus SET minted_dtu_id = ? WHERE user_id = ? AND dtu_key = ?
    `).run(mintedId, userId, dtu.dtu_key);
  }
  return {
    ok: true,
    dtu: {
      key: dtu.dtu_key,
      title: dtu.title,
      summary: dtu.summary,
      tags: dtu.tags,
      layer: dtu.layer,
      kind: dtu.kind,
      trustLevel: "experimental",
      mintedDtuId: mintedId,
      composer: dtu.composer,
    },
  };
}

export function setTrust(db, userId, { key, trustLevel } = {}) {
  const blocked = requireDb(db);
  if (blocked) return blocked;
  const k = String(key || "").trim();
  const level = String(trustLevel || "").trim();
  if (!k || !level) return { ok: false, reason: "key_and_trust_level_required" };
  if (!TRUST_LEVELS.includes(level)) return { ok: false, reason: "invalid_trust_level" };
  const row = db.prepare(`
    SELECT dtu_key FROM lattice_seed_auto_dtus WHERE user_id = ? AND dtu_key = ?
  `).get(userId, k);
  if (!row) return { ok: false, reason: "auto_dtu_not_found" };
  db.prepare(`
    UPDATE lattice_seed_auto_dtus SET trust_level = ? WHERE user_id = ? AND dtu_key = ?
  `).run(level, userId, k);
  return { ok: true, key: k, trustLevel: level };
}

export function listAutoDtus(db, userId, { includeExperimental = true } = {}) {
  const blocked = requireDb(db);
  if (blocked) return blocked;
  const rows = db.prepare(`
    SELECT dtu_key AS key, title, summary, tags, layer, kind, trust_level AS trustLevel,
           minted_dtu_id AS mintedDtuId, source_kind AS sourceKind, source_id AS sourceId,
           created_at AS createdAt
    FROM lattice_seed_auto_dtus
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);
  const dtus = rows
    .map((r) => ({ ...r, tags: parseTags(r.tags), source: "auto" }))
    .filter((d) => includeExperimental || d.trustLevel === "trusted");
  return { ok: true, dtus };
}

export function status(db, userId, { role = "guest", now = new Date() } = {}) {
  const blocked = requireDb(db);
  if (blocked) return blocked;
  const mem = db.prepare("SELECT COUNT(*) AS cnt FROM lattice_seed_memory WHERE user_id = ?").get(userId);
  const dtus = db.prepare("SELECT COUNT(*) AS cnt FROM lattice_seed_auto_dtus WHERE user_id = ?").get(userId);
  const queued = db.prepare("SELECT COUNT(*) AS cnt FROM lattice_seed_pages WHERE user_id = ? AND status = 'queued'").get(userId);
  const quota = pagesPerDayForRole(role);
  const used = quotaUsedToday(db, userId, now);
  return {
    ok: true,
    memoryCount: Number(mem?.cnt || 0),
    autoDtuCount: Number(dtus?.cnt || 0),
    queuedPages: Number(queued?.cnt || 0),
    quotaUsed: used,
    quotaLimit: quota,
  };
}

export function listMemory(db, userId, { scope } = {}) {
  const blocked = requireDb(db);
  if (blocked) return blocked;
  const rows = scope
    ? db.prepare(`
        SELECT id, scope, dtu_key AS dtuKey, text, source, layer, created_at AS createdAt
        FROM lattice_seed_memory WHERE user_id = ? AND scope = ?
        ORDER BY created_at DESC LIMIT ?
      `).all(userId, String(scope), LIST_LIMIT)
    : db.prepare(`
        SELECT id, scope, dtu_key AS dtuKey, text, source, layer, created_at AS createdAt
        FROM lattice_seed_memory WHERE user_id = ?
        ORDER BY created_at DESC LIMIT ?
      `).all(userId, LIST_LIMIT);
  return { ok: true, entries: rows };
}
