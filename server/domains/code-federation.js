// server/domains/code-federation.js
//
// Code Sprint D — cross-instance background agent federation.
//
// Delegate a coding task to a peer Concord instance. Real HTTP POST
// to the peer's /api/lens/run with Bearer auth; peer runs the
// agent_loop on its own workspace; we periodically poll and pull
// the result back. No mocks; real HTTP all the way.
//
// Peer authentication: peerToken passed per-call (or sourced from
// CONCORD_FEDERATION_TOKEN env when calling our peer).
//
// Schema reuse: we record delegation as a row in
// agent_marathon_sessions with meta_json.kind='code_bg_delegated'
// + meta_json.peerUrl + meta_json.peerSessionId. The existing
// heartbeat tick (code-bg-agent-tick) skips these (filtered by
// kind=='code_bg' only). A separate poll loop drives delegation.

import { randomUUID } from "node:crypto";

const POLL_INTERVAL_S = 30;

async function _peerCall(peerUrl, peerToken, domain, name, input) {
  const url = `${String(peerUrl).replace(/\/$/, "")}/api/lens/run`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(peerToken ? { Authorization: `Bearer ${peerToken}` } : {}),
      },
      body: JSON.stringify({ domain, action: name, input }),
    });
    if (!res.ok) return { ok: false, reason: "peer_http_error", status: res.status };
    const json = await res.json();
    return { ok: true, body: json };
  } catch (err) {
    return { ok: false, reason: "peer_unreachable", error: err?.message };
  }
}

export default function registerCodeFederationMacros(register) {
  register("code", "bg_delegate", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const peerUrl = String(input.peerUrl || "").trim();
    const peerToken = String(input.peerToken || process.env.CONCORD_FEDERATION_TOKEN || "");
    const task = String(input.task || "").trim();
    if (!peerUrl) return { ok: false, reason: "peer_url_required" };
    if (!task) return { ok: false, reason: "task_required" };
    // Tell the peer to start a background agent.
    const start = await _peerCall(peerUrl, peerToken, "code", "bg_start", {
      task,
      projectPath: input.peerProjectPath || ".",
      files: input.files || [],
      runner: input.runner || "npm",
      maxSteps: Math.min(20, Number(input.maxSteps) || 5),
    });
    if (!start.ok) return start;
    const peerSessionId = start.body?.result?.sessionId || start.body?.sessionId;
    if (!peerSessionId) return { ok: false, reason: "no_peer_session_id", body: start.body };
    // Record the delegation locally so heartbeat polls it.
    const localId = `code_bg_delegated:${randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO agent_marathon_sessions (id, user_id, title, goal, status, max_turns, meta_json, next_tick_at)
        VALUES (?, ?, ?, ?, 'running', ?, ?, unixepoch() + ?)
      `).run(
        localId, userId,
        `Delegated to ${peerUrl}`.slice(0, 200),
        task, Math.min(20, Number(input.maxSteps) || 5),
        JSON.stringify({
          kind: "code_bg_delegated",
          peerUrl, peerSessionId,
          peerProjectPath: input.peerProjectPath || ".",
          lastPollAt: Math.floor(Date.now() / 1000),
        }),
        POLL_INTERVAL_S,
      );
      return { ok: true, localSessionId: localId, peerUrl, peerSessionId };
    } catch (err) {
      return { ok: false, reason: "local_insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Delegate a background coding task to a peer Concord instance" });

  register("code", "bg_delegate_poll_tick", async (ctx) => {
    const db = ctx?.db || ctx?.STATE?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const due = db.prepare(`
      SELECT id, meta_json FROM agent_marathon_sessions
      WHERE status = 'running'
        AND next_tick_at <= unixepoch()
        AND meta_json LIKE '%"kind":"code_bg_delegated"%'
      LIMIT 5
    `).all();
    const results = [];
    for (const row of due) {
      let meta;
      try { meta = JSON.parse(row.meta_json || "{}"); } catch { meta = null; }
      if (!meta?.peerUrl || !meta?.peerSessionId) {
        db.prepare(`UPDATE agent_marathon_sessions SET status = 'failed' WHERE id = ?`).run(row.id);
        continue;
      }
      const stat = await _peerCall(meta.peerUrl, meta.peerToken || process.env.CONCORD_FEDERATION_TOKEN, "code", "bg_status", { sessionId: meta.peerSessionId });
      const peerSession = stat.body?.result?.session || stat.body?.session;
      const peerStatus = peerSession?.status;
      const peerTurns = peerSession?.total_turns;
      meta.lastPollAt = Math.floor(Date.now() / 1000);
      meta.peerStatus = peerStatus;
      meta.peerTurns = peerTurns;
      const isTerminal = ["completed", "failed", "abandoned"].includes(peerStatus);
      db.prepare(`
        UPDATE agent_marathon_sessions
        SET status = ?, total_turns = ?, updated_at = unixepoch(),
            completed_at = CASE WHEN ? IS NOT NULL THEN unixepoch() ELSE completed_at END,
            next_tick_at = unixepoch() + ?,
            meta_json = ?
        WHERE id = ?
      `).run(
        peerStatus || row.status, peerTurns || 0,
        isTerminal ? 1 : null, isTerminal ? 999_999_999 : POLL_INTERVAL_S,
        JSON.stringify(meta), row.id,
      );
      results.push({ localId: row.id, peerSessionId: meta.peerSessionId, peerStatus, peerTurns });
    }
    return { ok: true, polled: results.length, results };
  }, { destructive: true, note: "Heartbeat tick for delegated bg agents (polls peer status)" });

  register("code", "bg_delegate_status", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const id = String(input.localSessionId || input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    let meta = {};
    try { meta = JSON.parse(row.meta_json || "{}"); } catch { /* ok */ }
    return { ok: true, session: { ...row, meta } };
  }, { note: "Local status of a delegated bg session (includes peer status from last poll)" });
}
