// server/lib/user-memory.js
//
// Per-user persistent memory, phase 1: opt-in, explicit statements only ("remember ...", "I prefer ...").
// This module is the ONLY code allowed to touch the user_memory_* tables (migration 495); a test greps the
// tree to keep it that way. Isolation rules:
//   - every exported function takes userId first and refuses a falsy one;
//   - every statement binds user_id = ?; there is no unscoped helper;
//   - facts are never DTUs and never enter the global DTU embedding index;
//   - nothing runs unless the user turned memory on (user_memory_settings.enabled = 1) AND the env flag allows it.
//
// Honest limits (phase 1): extraction is pattern-based on the user's own words, no LLM. Contradiction detection
// is by a deterministic (subject, predicate) key, not semantic similarity; semantic contradiction is phase 2.

import crypto from "node:crypto";

export const MAX_FACTS_PER_USER = 500;
export const MAX_VALUE_CHARS = 300;
export const MAX_SOURCE_CHARS = 300;
const RECENCY_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000;

const KINDS = new Set(["preference", "goal", "entity", "fact"]);

function need(userId) {
  if (!userId || typeof userId !== "string") throw new Error("user_memory: userId required");
}

const newId = () => `umf_${crypto.randomBytes(9).toString("hex")}`;

// ── flags ─────────────────────────────────────────────────────────────────────

/** Env master switch. Default OFF. CONCORD_USER_MEMORY_EXTRACT / _RETRIEVE are off if the master is off. */
export function memoryFlags(env = process.env) {
  const on = (v) => v === "1" || v === "true";
  const master = on(env.CONCORD_USER_MEMORY);
  const sub = (v) => master && (v === undefined || on(v));
  return {
    master,
    extract: sub(env.CONCORD_USER_MEMORY_EXTRACT),
    retrieve: sub(env.CONCORD_USER_MEMORY_RETRIEVE),
  };
}

export function isEnabled(db, userId) {
  need(userId);
  const row = db.prepare("SELECT enabled FROM user_memory_settings WHERE user_id = ?").get(userId);
  return row?.enabled === 1;
}

export function setEnabled(db, userId, enabled, now = Date.now()) {
  need(userId);
  db.prepare(`
    INSERT INTO user_memory_settings (user_id, enabled, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
  `).run(userId, enabled ? 1 : 0, now);
  return { ok: true, enabled: !!enabled };
}

export function setProjectOff(db, userId, projectId, off, now = Date.now()) {
  need(userId);
  if (!projectId) return { ok: false, error: "missing_project" };
  if (off) {
    db.prepare("INSERT OR IGNORE INTO user_memory_projects_off (user_id, project_id, created_at) VALUES (?, ?, ?)")
      .run(userId, String(projectId), now);
  } else {
    db.prepare("DELETE FROM user_memory_projects_off WHERE user_id = ? AND project_id = ?").run(userId, String(projectId));
  }
  return { ok: true, projectId: String(projectId), off: !!off };
}

function projectIsOff(db, userId, projectId) {
  if (!projectId) return false;
  return !!db.prepare("SELECT 1 FROM user_memory_projects_off WHERE user_id = ? AND project_id = ?").get(userId, String(projectId));
}

// ── sensitivity filter ────────────────────────────────────────────────────────

function luhnOk(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/,            // provider-style keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,                       // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/,                                 // AWS access key id
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,                     // Slack tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/, // JWT
  /\b[A-Fa-f0-9]{32,}\b/,                                 // long hex blobs
  /\b[A-Za-z0-9+/_-]{40,}={0,2}(?=\s|$)/,                 // long base64-ish blobs
  /\b(?:password|passwd|passphrase|pwd|api[\s_-]?key|secret[\s_-]?key|private[\s_-]?key|access[\s_-]?token|auth[\s_-]?token|bearer|seed[\s_-]?phrase|mnemonic|2fa|otp|pin)\b\s*(?:is|=|:)/i,
];

const SOFT_PATTERNS = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "email"],
  [/(?:\+?\d[\s().-]?){10,}/, "phone"],
  [/\b(?:diagnos|prescri|medication|therapy|depress|anxiety|cancer|hiv|pregnan|disorder)\w*/i, "health"],
  [/\b(?:salary|income|net worth|debt|bank account|routing number|iban|tax return)\b/i, "finance"],
];

/**
 * @returns {{ok:true}|{ok:false, reason:string}}
 * Hard secrets are ALWAYS rejected. Personal data (email/phone/health/finance) is rejected unless the user said
 * "remember" explicitly (explicit=true): user-directed, visible and deletable.
 */
export function screenText(text, { explicit = false } = {}) {
  const t = String(text || "");
  for (const re of SECRET_PATTERNS) if (re.test(t)) return { ok: false, reason: "secret" };
  for (const m of t.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnOk(digits)) return { ok: false, reason: "card_number" };
  }
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(t)) return { ok: false, reason: "ssn" };
  if (!explicit) {
    for (const [re, reason] of SOFT_PATTERNS) if (re.test(t)) return { ok: false, reason };
  }
  return { ok: true };
}

/** Values are later quoted into a prompt: flatten whitespace, drop control chars and role markers, cap length. */
export function sanitizeValue(v, max = MAX_VALUE_CHARS) {
  return String(v ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\b(?:system|assistant|user|developer)\s*:/gi, "$1 -")
    .replace(/[<>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const normKey = (s) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).replace(/ /g, "_");

// ── explicit extraction (no LLM) ──────────────────────────────────────────────

const TOPICS = [
  [/\b(?:short|brief|concise|terse|long|detailed|verbose|thorough)\s+(?:answers?|repl(?:y|ies)|responses?|explanations?)\b/i, "response_length"],
  [/\b(?:tabs?|spaces)\b.*\b(?:indent|indentation)\b|\b(?:indent|indentation)\b.*\b(?:tabs?|spaces)\b/i, "indentation"],
  [/\b(?:formal|casual|friendly|professional|blunt)\s+(?:tone|style|voice)\b|\b(?:tone|style|voice)\b/i, "tone"],
  [/\b(?:dark|light)\s+(?:mode|theme)\b/i, "theme"],
  [/\b(?:metric|imperial)\b/i, "units"],
];

const SENT_SPLIT = /(?<=[.!?])\s+|\n+/;

/**
 * Pull explicit memory statements out of one user message.
 * @returns {Array<{kind, subject, predicate, value, explicit, sourceText}>}
 */
export function extractExplicit(message) {
  const out = [];
  for (const raw of String(message || "").split(SENT_SPLIT)) {
    const s = raw.trim().replace(/[.!?]+$/, "");
    if (s.length < 4 || s.length > 400) continue;
    let m;

    if ((m = s.match(/^(?:please\s+)?(?:call me|you can call me)\s+(.{1,60})$/i))) {
      out.push({ kind: "entity", subject: "user", predicate: "name", value: m[1], explicit: true, sourceText: s });
      continue;
    }
    if ((m = s.match(/^(?:please\s+)?remember(?:\s+that)?[,:]?\s+(.{3,})$/i))) {
      const body = m[1];
      const proj = body.match(/^(?:that\s+)?my (?:current\s+)?project (?:is|=)\s+(.{1,100})$/i);
      if (proj) {
        out.push({ kind: "goal", subject: "current_project", predicate: "name", value: proj[1], explicit: true, sourceText: s });
        continue;
      }
      const pref = body.match(/^(?:that\s+)?i (?:prefer|like|want|always|never)\s+(.{2,})$/i);
      if (pref) {
        const c = classifyPreference(body.replace(/^that\s+/i, ""), true);
        out.push({ ...c, explicit: true, sourceText: s });
        continue;
      }
      out.push({ kind: "fact", subject: "note", predicate: normKey(body).slice(0, 40) || "note", value: body, explicit: true, sourceText: s });
      continue;
    }
    if ((m = s.match(/^my (?:current\s+)?project (?:is|=)\s+(.{1,100})$/i))) {
      out.push({ kind: "goal", subject: "current_project", predicate: "name", value: m[1], explicit: false, sourceText: s });
      continue;
    }
    if (/^i (?:prefer|always|never)\s+\S/i.test(s) || /^i (?:like|want) you to\s+\S/i.test(s)) {
      out.push({ ...classifyPreference(s, false), explicit: false, sourceText: s });
    }
  }
  return out;
}

function classifyPreference(statement, explicit) {
  for (const [re, topic] of TOPICS) {
    if (re.test(statement)) return { kind: "preference", subject: topic, predicate: "preference", value: statement };
  }
  // "I prefer X for/when/in/with T": the topic T is the subject, so a later "I prefer Y for T" supersedes.
  const t = statement.match(/\b(?:for|when|in|with|while)\s+([a-z0-9 ]{2,40})$/i);
  if (t) return { kind: "preference", subject: normKey(t[1]), predicate: "preference", value: statement };
  // No stable topic: key on the statement itself so unrelated preferences never supersede each other.
  void explicit;
  return { kind: "preference", subject: "statement", predicate: normKey(statement).slice(0, 50), value: statement };
}

// ── embeddings (optional) ─────────────────────────────────────────────────────

function toBlob(embedding) {
  if (!embedding) return null;
  if (Buffer.isBuffer(embedding)) return embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) return null;
  const buf = Buffer.allocUnsafe(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) buf.writeFloatLE(Number(embedding[i]) || 0, i * 4);
  return buf;
}

function fromBlob(buf) {
  if (!buf || !buf.length) return null;
  const n = Math.floor(buf.length / 4);
  const a = new Array(n);
  for (let i = 0; i < n; i++) a[i] = buf.readFloatLE(i * 4);
  return a;
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

// ── write path ────────────────────────────────────────────────────────────────

/**
 * Store one candidate. Supersedes an existing ACTIVE fact with the same (project, subject, predicate); a fact the
 * user edited is never auto-superseded (the new value is held as `pending` for the user to resolve).
 * @returns {{ok:true,id,superseded?:string,pending?:boolean,duplicate?:boolean}|{ok:false,error:string}}
 */
export function remember(db, userId, cand, opts = {}) {
  need(userId);
  const now = opts.now ?? Date.now();
  if (!isEnabled(db, userId)) return { ok: false, error: "memory_off" };
  if (!cand || !KINDS.has(cand.kind)) return { ok: false, error: "bad_kind" };
  const projectId = opts.projectId ? String(opts.projectId) : null;
  if (projectIsOff(db, userId, projectId)) return { ok: false, error: "project_off" };

  const value = sanitizeValue(cand.value);
  const subject = sanitizeValue(cand.subject, 60);
  const predicate = sanitizeValue(cand.predicate, 60);
  if (!value || !subject || !predicate) return { ok: false, error: "empty" };

  const source = sanitizeValue(cand.sourceText ?? cand.value, MAX_SOURCE_CHARS);
  const screen = screenText(`${value} ${source}`, { explicit: !!cand.explicit });
  if (!screen.ok) return { ok: false, error: "rejected", reason: screen.reason };

  const tx = db.transaction(() => {
    const active = db.prepare(`
      SELECT id, value, user_edited FROM user_memory_facts
      WHERE user_id = ? AND COALESCE(project_id, '') = ? AND subject = ? AND predicate = ? AND status = 'active'
    `).get(userId, projectId ?? "", subject, predicate);

    if (active && active.value === value) return { ok: true, id: active.id, duplicate: true };

    const count = db.prepare("SELECT COUNT(*) AS c FROM user_memory_facts WHERE user_id = ? AND status != 'superseded'").get(userId).c;
    if (count >= MAX_FACTS_PER_USER) return { ok: false, error: "memory_full" };

    const id = newId();
    let status = "active";
    let supersedes = null;
    if (active) {
      if (active.user_edited === 1) {
        status = "pending";            // the user's own edit wins; the contradiction waits for them
      } else {
        db.prepare("UPDATE user_memory_facts SET status = 'superseded', valid_to = ?, updated_at = ? WHERE id = ? AND user_id = ?")
          .run(now, now, active.id, userId);
        supersedes = active.id;
      }
    }
    db.prepare(`
      INSERT INTO user_memory_facts
        (id, user_id, project_id, kind, subject, predicate, value, embedding, salience, status, supersedes_id,
         valid_from, created_at, updated_at, source_session_id, source_msg_id, source_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId, projectId, cand.kind, subject, predicate, value, toBlob(opts.embedding),
      cand.explicit ? 1.0 : 0.8, status, supersedes, now, now, now,
      opts.sessionId ?? null, opts.msgId ?? null, source,
    );
    addLinks(db, userId, id, { projectId, lens: opts.lens, dtuIds: opts.dtuIds }, now);
    return { ok: true, id, ...(supersedes ? { superseded: supersedes } : {}), ...(status === "pending" ? { pending: true } : {}) };
  });
  return tx();
}

function addLinks(db, userId, factId, { projectId, lens, dtuIds }, now) {
  const ins = db.prepare("INSERT OR IGNORE INTO user_memory_links (user_id, fact_id, target_kind, target_id, created_at) VALUES (?, ?, ?, ?, ?)");
  if (projectId) ins.run(userId, factId, "project", String(projectId), now);
  if (lens) ins.run(userId, factId, "lens", String(lens), now);
  for (const d of Array.isArray(dtuIds) ? dtuIds.slice(0, 10) : []) ins.run(userId, factId, "dtu", String(d), now);
}

/**
 * Post-turn entry point: extract explicit statements from the user's message and store them.
 * Never throws (the chat path must not break); returns a summary.
 */
export function captureFromMessage(db, userId, message, ctx = {}) {
  try {
    need(userId);
    if (!memoryFlags(ctx.env).extract) return { ok: true, skipped: "flag_off", stored: 0, rejected: 0 };
    if (!isEnabled(db, userId)) return { ok: true, skipped: "user_off", stored: 0, rejected: 0 };
    let stored = 0, rejected = 0;
    for (const cand of extractExplicit(message)) {
      const r = remember(db, userId, cand, ctx);
      if (r.ok && !r.duplicate) stored++;
      else if (!r.ok) rejected++;
    }
    return { ok: true, stored, rejected };
  } catch (err) {
    return { ok: false, error: "capture_failed", detail: err.message, stored: 0, rejected: 0 };
  }
}

// ── read path ─────────────────────────────────────────────────────────────────

const tokenize = (s) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));

function keywordSim(queryTokens, row) {
  if (!queryTokens.size) return 0;
  const t = tokenize(`${row.subject} ${row.value}`);
  let hit = 0;
  for (const w of queryTokens) if (t.has(w)) hit++;
  return hit / Math.sqrt(queryTokens.size * Math.max(t.size, 1));
}

/**
 * Retrieve the facts relevant to the current turn, scoped to the user and, when given, the current project.
 * Visible: this project's facts + global (project_id NULL) facts. Preferences always have a baseline relevance
 * (they apply everywhere); other kinds need a query match. Score = sim x salience x recency.
 * @returns {Array<{id,kind,subject,predicate,value,score,project_id}>}  (does NOT record usage; see recordUse)
 */
export function recall(db, userId, { projectId = null, queryText = "", queryEmbedding = null, limit = 12, now = Date.now() } = {}) {
  need(userId);
  if (!isEnabled(db, userId)) return [];
  if (projectIsOff(db, userId, projectId)) return [];
  const rows = db.prepare(`
    SELECT id, kind, subject, predicate, value, embedding, salience, project_id, created_at, updated_at
    FROM user_memory_facts
    WHERE user_id = ? AND status = 'active' AND (project_id IS NULL OR project_id = ?)
    ORDER BY updated_at DESC LIMIT ?
  `).all(userId, projectId ? String(projectId) : "", MAX_FACTS_PER_USER);

  const qTokens = tokenize(queryText);
  const scored = [];
  for (const r of rows) {
    let sim = 0;
    const emb = queryEmbedding && r.embedding ? fromBlob(r.embedding) : null;
    if (emb) sim = Math.max(0, cosine(queryEmbedding, emb));
    if (!sim) sim = keywordSim(qTokens, r);
    if (!sim && r.kind === "preference") sim = 0.3;
    if (!sim && projectId && r.project_id === String(projectId)) sim = 0.2;
    if (!sim) continue;
    const age = Math.max(0, now - r.updated_at);
    const recency = 0.5 + 0.5 * Math.pow(0.5, age / RECENCY_HALF_LIFE_MS);
    scored.push({
      id: r.id, kind: r.kind, subject: r.subject, predicate: r.predicate, value: r.value,
      project_id: r.project_id, score: sim * r.salience * recency,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, limit));
}

/** Record that a reply used these facts (transparent-use log). */
export function recordUse(db, userId, factIds, { sessionId = null, msgId = null, now = Date.now() } = {}) {
  need(userId);
  const ins = db.prepare("INSERT INTO user_memory_uses (user_id, fact_id, session_id, msg_id, used_at) VALUES (?, ?, ?, ?, ?)");
  const bump = db.prepare("UPDATE user_memory_facts SET last_used_at = ?, use_count = use_count + 1 WHERE id = ? AND user_id = ?");
  let n = 0;
  db.transaction(() => {
    for (const id of factIds || []) {
      if (bump.run(now, id, userId).changes) { ins.run(userId, id, sessionId, msgId, now); n++; }
    }
  })();
  return { ok: true, recorded: n };
}

/** Facts a given reply used (for "used in this reply"). */
export function usedInReply(db, userId, sessionId, msgId) {
  need(userId);
  return db.prepare(`
    SELECT f.id, f.kind, f.subject, f.value, f.status
    FROM user_memory_uses u JOIN user_memory_facts f ON f.id = u.fact_id AND f.user_id = u.user_id
    WHERE u.user_id = ? AND u.session_id = ? AND u.msg_id = ?
  `).all(userId, sessionId, msgId);
}

// ── user control ──────────────────────────────────────────────────────────────

export function listFacts(db, userId, { projectId, status, search, limit = 200 } = {}) {
  need(userId);
  const where = ["user_id = ?"];
  const args = [userId];
  if (projectId) { where.push("project_id = ?"); args.push(String(projectId)); }
  if (status) { where.push("status = ?"); args.push(status); } else { where.push("status IN ('active','pending')"); }
  if (search) { where.push("(value LIKE ? OR subject LIKE ?)"); args.push(`%${search}%`, `%${search}%`); }
  args.push(Math.min(Math.max(1, limit), 500));
  return db.prepare(`
    SELECT id, project_id, kind, subject, predicate, value, status, supersedes_id, valid_from, valid_to,
           created_at, updated_at, last_used_at, use_count, user_edited
    FROM user_memory_facts WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT ?
  `).all(...args);
}

/** The supersede chain for one fact, newest first (history stays visible to the user). */
export function history(db, userId, factId) {
  need(userId);
  const out = [];
  let cur = db.prepare("SELECT * FROM user_memory_facts WHERE id = ? AND user_id = ?").get(factId, userId);
  const seen = new Set();
  while (cur && !seen.has(cur.id) && out.length < 50) {
    seen.add(cur.id);
    out.push({ id: cur.id, value: cur.value, status: cur.status, valid_from: cur.valid_from, valid_to: cur.valid_to, user_edited: cur.user_edited });
    cur = cur.supersedes_id ? db.prepare("SELECT * FROM user_memory_facts WHERE id = ? AND user_id = ?").get(cur.supersedes_id, userId) : null;
  }
  return out;
}

/** "Why did you remember this?": the user's own words, when, where, and what it is linked to. */
export function why(db, userId, factId) {
  need(userId);
  const f = db.prepare(`
    SELECT id, kind, subject, value, source_text, source_session_id, source_msg_id, created_at, user_edited
    FROM user_memory_facts WHERE id = ? AND user_id = ?
  `).get(factId, userId);
  if (!f) return null;
  const links = db.prepare("SELECT target_kind, target_id FROM user_memory_links WHERE fact_id = ? AND user_id = ?").all(factId, userId);
  return {
    id: f.id, kind: f.kind, subject: f.subject, value: f.value,
    said: f.source_text, saidAt: f.created_at, sessionId: f.source_session_id, msgId: f.source_msg_id,
    userEdited: f.user_edited === 1, links,
  };
}

/** User edit: sets user_edited so the system never auto-supersedes it. */
export function editFact(db, userId, factId, newValue, now = Date.now()) {
  need(userId);
  const value = sanitizeValue(newValue);
  if (!value) return { ok: false, error: "empty" };
  const screen = screenText(value, { explicit: true });
  if (!screen.ok) return { ok: false, error: "rejected", reason: screen.reason };
  const r = db.prepare(`
    UPDATE user_memory_facts SET value = ?, user_edited = 1, embedding = NULL, updated_at = ?
    WHERE id = ? AND user_id = ? AND status IN ('active','pending')
  `).run(value, now, factId, userId);
  return r.changes ? { ok: true } : { ok: false, error: "not_found" };
}

/** Promote a pending fact (resolving a contradiction in favour of the new value): the old active one is retired. */
export function resolvePending(db, userId, pendingId, now = Date.now()) {
  need(userId);
  return db.transaction(() => {
    const p = db.prepare("SELECT * FROM user_memory_facts WHERE id = ? AND user_id = ? AND status = 'pending'").get(pendingId, userId);
    if (!p) return { ok: false, error: "not_found" };
    const act = db.prepare(`
      SELECT id FROM user_memory_facts
      WHERE user_id = ? AND COALESCE(project_id,'') = ? AND subject = ? AND predicate = ? AND status = 'active'
    `).get(userId, p.project_id ?? "", p.subject, p.predicate);
    if (act) db.prepare("UPDATE user_memory_facts SET status = 'superseded', valid_to = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(now, now, act.id, userId);
    db.prepare("UPDATE user_memory_facts SET status = 'active', supersedes_id = ?, valid_from = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(act?.id ?? null, now, now, pendingId, userId);
    return { ok: true };
  })();
}

function purgeFactIds(db, userId, ids) {
  if (!ids.length) return 0;
  const ph = ids.map(() => "?").join(",");
  db.prepare(`DELETE FROM user_memory_links WHERE user_id = ? AND fact_id IN (${ph})`).run(userId, ...ids);
  db.prepare(`DELETE FROM user_memory_uses WHERE user_id = ? AND fact_id IN (${ph})`).run(userId, ...ids);
  return db.prepare(`DELETE FROM user_memory_facts WHERE user_id = ? AND id IN (${ph})`).run(userId, ...ids).changes;
}

/** Hard delete one fact AND its supersede history (the embedding is in-row, so it goes with it). */
export function forgetFact(db, userId, factId) {
  need(userId);
  return db.transaction(() => {
    const ids = [];
    let cur = db.prepare("SELECT id, supersedes_id FROM user_memory_facts WHERE id = ? AND user_id = ?").get(factId, userId);
    if (!cur) return { ok: false, error: "not_found" };
    // Older versions this fact replaced, plus anything that replaced it.
    while (cur && !ids.includes(cur.id) && ids.length < 100) {
      ids.push(cur.id);
      cur = cur.supersedes_id ? db.prepare("SELECT id, supersedes_id FROM user_memory_facts WHERE id = ? AND user_id = ?").get(cur.supersedes_id, userId) : null;
    }
    let child = db.prepare("SELECT id FROM user_memory_facts WHERE supersedes_id = ? AND user_id = ?").get(factId, userId);
    while (child && !ids.includes(child.id) && ids.length < 200) {
      ids.push(child.id);
      child = db.prepare("SELECT id FROM user_memory_facts WHERE supersedes_id = ? AND user_id = ?").get(child.id, userId);
    }
    return { ok: true, deleted: purgeFactIds(db, userId, ids) };
  })();
}

/** Per-project "forget this": hard delete everything remembered under that project. */
export function forgetProject(db, userId, projectId) {
  need(userId);
  if (!projectId) return { ok: false, error: "missing_project" };
  return db.transaction(() => {
    const ids = db.prepare("SELECT id FROM user_memory_facts WHERE user_id = ? AND project_id = ?").all(userId, String(projectId)).map((r) => r.id);
    return { ok: true, deleted: purgeFactIds(db, userId, ids) };
  })();
}

/** Delete all: facts, links, usage log, and per-project switches. Settings (the opt-in) stay as the user left them. */
export function forgetAll(db, userId) {
  need(userId);
  return db.transaction(() => {
    db.prepare("DELETE FROM user_memory_links WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_memory_uses WHERE user_id = ?").run(userId);
    const deleted = db.prepare("DELETE FROM user_memory_facts WHERE user_id = ?").run(userId).changes;
    db.prepare("DELETE FROM user_memory_projects_off WHERE user_id = ?").run(userId);
    return { ok: true, deleted };
  })();
}

/** Account deletion: everything, including the settings row. */
export function purgeUser(db, userId) {
  need(userId);
  return db.transaction(() => {
    const r = forgetAll(db, userId);
    db.prepare("DELETE FROM user_memory_settings WHERE user_id = ?").run(userId);
    return r;
  })();
}

/** Data export (no embeddings): facts with their full history, links, and usage log. */
export function exportMemory(db, userId) {
  need(userId);
  return {
    settings: db.prepare("SELECT enabled, updated_at FROM user_memory_settings WHERE user_id = ?").get(userId) || { enabled: 0 },
    projectsOff: db.prepare("SELECT project_id FROM user_memory_projects_off WHERE user_id = ?").all(userId).map((r) => r.project_id),
    facts: db.prepare(`
      SELECT id, project_id, kind, subject, predicate, value, status, supersedes_id, valid_from, valid_to,
             created_at, updated_at, last_used_at, use_count, source_session_id, source_msg_id, source_text, user_edited
      FROM user_memory_facts WHERE user_id = ? ORDER BY created_at DESC
    `).all(userId),
    links: db.prepare("SELECT fact_id, target_kind, target_id FROM user_memory_links WHERE user_id = ?").all(userId),
    uses: db.prepare("SELECT fact_id, session_id, msg_id, used_at FROM user_memory_uses WHERE user_id = ? ORDER BY used_at DESC LIMIT 2000").all(userId),
  };
}
