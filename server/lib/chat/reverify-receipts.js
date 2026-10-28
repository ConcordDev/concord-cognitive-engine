// server/lib/chat/reverify-receipts.js
//
// One-click re-verify for a stored chat reply (Product Chat review
// 2026-10-28, F2/A6 + §9 rule-2b closure note: "no backend" for a verify
// action on a verified-compute platform is not a disposition — build it
// or name the external blocker; there was none, so here it is).
//
// Works entirely from the STORED record (chat_messages.meta_json carries
// toolCalls / computed / dtuRefs / sources — see _serialiseMeta in
// chat-session-store.js) plus the stored user question in front of it:
//
//   solver leg  — re-runs the deterministic compute router
//                 (lib/chat/compute-router.js, the same function
//                 chat.respond ran) on the stored question and compares
//                 against the stored router result / answer text.
//   sources leg — re-resolves every stored source URL (bounded fetch).
//   dtu leg     — re-checks every cited DTU id against the live store
//                 (incl. archive) via dtu-archive.js.
//
// Every leg reports what it actually did. Where a claim cannot be
// reproduced from stored data, the leg SAYS SO as its result
// ('unreproduced') — that is a finding about the answer, not a refusal
// to build the check. Ownership discipline mirrors chat-messages-read.js:
// unknown session = honest not-found, someone else's = forbidden.

import { routeComputeQuestion } from "./compute-router.js";
import { getDtuIncludingArchive } from "../dtu-archive.js";

const TS_TOLERANCE_MS = 5000;
const MAX_SOURCES = 8;
const MAX_DTU_REFS = 20;
const FETCH_TIMEOUT_MS = 3500;

function toMs(v) {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  const p = Date.parse(String(v));
  return Number.isFinite(p) ? p : null;
}

async function resolveUrl(fetchImpl, url) {
  const attempt = async (method) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, { method, redirect: "follow", signal: ctl.signal });
      return { status: res?.status ?? null };
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let r = await attempt("HEAD");
    if (r.status === 405 || r.status === 501) r = await attempt("GET");
    return { url, resolves: r.status != null && r.status < 400, httpStatus: r.status };
  } catch (err) {
    return { url, resolves: false, httpStatus: null, error: err?.name === "AbortError" ? "timeout" : "unreachable" };
  }
}

export async function reverifyReceipts(db, { userId, sessionId, messageTs, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (!userId) return { status: 401, body: { ok: false, error: "auth_required" } };
  const sid = String(sessionId || "").trim();
  if (!sid) return { status: 400, body: { ok: false, error: "missing_sessionId" } };
  const targetTs = toMs(messageTs);
  if (targetTs == null) return { status: 400, body: { ok: false, error: "missing_messageTs" } };
  if (!db) return { status: 503, body: { ok: false, error: "db_unavailable" } };

  let ownerRow;
  try {
    ownerRow = db.prepare(`SELECT owner_id FROM chat_sessions WHERE session_id = ?`).get(sid);
  } catch {
    return { status: 503, body: { ok: false, error: "db_query_failed" } };
  }
  if (!ownerRow) {
    return { status: 200, body: { ok: true, found: false, reason: "session_not_stored", legs: [], summary: "This conversation is not in the stored record, so there are no receipts to re-verify." } };
  }
  if (!ownerRow.owner_id || ownerRow.owner_id !== userId) {
    return { status: 403, body: { ok: false, error: "session_forbidden" } };
  }

  let row;
  try {
    row = db.prepare(`
      SELECT id, content, ts, meta_json FROM chat_messages
      WHERE session_id = ? AND role = 'assistant' AND ABS(ts - ?) <= ?
      ORDER BY ABS(ts - ?) ASC LIMIT 1
    `).get(sid, targetTs, TS_TOLERANCE_MS, targetTs);
  } catch {
    return { status: 503, body: { ok: false, error: "db_query_failed" } };
  }
  if (!row) {
    return { status: 200, body: { ok: true, found: false, reason: "message_not_stored", legs: [], summary: "This reply is not in the stored record yet — reload the conversation and try again." } };
  }

  let meta = null;
  try { meta = row.meta_json ? JSON.parse(row.meta_json) : null; } catch { meta = null; }
  meta = meta || {};

  let userContent = null;
  try {
    const u = db.prepare(`
      SELECT content FROM chat_messages
      WHERE session_id = ? AND id < ? AND role = 'user'
      ORDER BY id DESC LIMIT 1
    `).get(sid, row.id);
    userContent = u?.content ?? null;
  } catch { userContent = null; }

  const legs = [];

  // ── solver leg ────────────────────────────────────────────────────────
  const storedRouter = Array.isArray(meta.toolCalls)
    ? meta.toolCalls.find((t) => t && t.tool === "compute_router")
    : null;
  const claimedComputed = Boolean(storedRouter) ||
    (Array.isArray(meta.computed?.capabilities) && meta.computed.capabilities.length > 0);
  if (claimedComputed) {
    const rerun = userContent != null ? routeComputeQuestion(userContent) : null;
    if (storedRouter && rerun) {
      const same = JSON.stringify(storedRouter.result) === JSON.stringify(rerun.value);
      legs.push({
        leg: "solver",
        status: same ? "reproduced" : "diverged",
        engine: rerun.engine,
        detail: same
          ? `Re-ran ${rerun.engine} on the stored question — same result (${JSON.stringify(rerun.value)}).`
          : `Re-ran ${rerun.engine} on the stored question — result differs: stored ${JSON.stringify(storedRouter.result)}, re-run ${JSON.stringify(rerun.value)}.`,
      });
    } else if (storedRouter && !rerun) {
      legs.push({
        leg: "solver",
        status: "unreproduced",
        detail: "The deterministic router no longer routes the stored question, so the original solver result cannot be reproduced from the stored record.",
      });
    } else if (!storedRouter && rerun) {
      const contained = String(row.content || "").includes(String(rerun.value));
      legs.push({
        leg: "solver",
        status: contained ? "consistent" : "mismatch",
        engine: rerun.engine,
        detail: contained
          ? `Re-ran ${rerun.engine} on the stored question — its result (${JSON.stringify(rerun.value)}) matches the value in the answer.`
          : `Re-ran ${rerun.engine} on the stored question — its result (${JSON.stringify(rerun.value)}) does not appear in the stored answer.`,
      });
    } else {
      legs.push({
        leg: "solver",
        status: "unreproduced",
        detail: "This answer claimed a solver check, but the deterministic router does not route the stored question — the original check used a path whose inputs are not in the stored record, so it cannot be reproduced here.",
      });
    }
  }

  // ── sources leg ───────────────────────────────────────────────────────
  const sources = Array.isArray(meta.sources) ? meta.sources.filter((s) => s && s.url) : [];
  if (sources.length > 0) {
    const checked = await Promise.all(sources.slice(0, MAX_SOURCES).map((s) => resolveUrl(fetchImpl, String(s.url))));
    const okCount = checked.filter((c) => c.resolves).length;
    legs.push({
      leg: "sources",
      status: okCount === checked.length ? "all-resolve" : okCount === 0 ? "none-resolve" : "some-failed",
      detail: `${okCount}/${checked.length} cited source${checked.length !== 1 ? "s" : ""} still resolve.`,
      sources: checked,
    });
  }

  // ── cited-DTU leg ─────────────────────────────────────────────────────
  const dtuRefs = Array.isArray(meta.dtuRefs) ? meta.dtuRefs.filter((d) => d && d.id) : [];
  if (dtuRefs.length > 0) {
    const refs = [];
    let storeFailed = false;
    for (const d of dtuRefs.slice(0, MAX_DTU_REFS)) {
      try {
        refs.push({ id: d.id, found: Boolean(getDtuIncludingArchive(db, d.id)) });
      } catch {
        storeFailed = true;
        refs.push({ id: d.id, found: false });
      }
    }
    const foundCount = refs.filter((r) => r.found).length;
    legs.push({
      leg: "dtus",
      status: storeFailed ? "error" : foundCount === refs.length ? "all-found" : foundCount === 0 ? "none-found" : "some-missing",
      detail: storeFailed
        ? "The DTU store could not be queried for this check."
        : `${foundCount}/${refs.length} cited DTU${refs.length !== 1 ? "s" : ""} still in the lattice.`,
      refs,
    });
  }

  const summary = legs.length === 0
    ? "Nothing to re-verify: this answer claimed no solver check and cited no sources or DTUs."
    : legs.map((l) => l.detail).join(" ");

  return {
    status: 200,
    body: {
      ok: true,
      found: true,
      verifiedAt: new Date(now()).toISOString(),
      messageTs: new Date(row.ts).toISOString(),
      legs,
      summary,
    },
  };
}
