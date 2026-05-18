// server/domains/messaging-scheduler.js
//
// Sprint B #17 — scheduled-send + workflow tick.
// Two heartbeat-driven macros:
//   scheduler_tick — flushes due scheduled messages (server_ts updated
//     to "now", scheduled_for cleared, realtime fanout fires)
//   workflow_tick  — placeholder for the workflow runner (Sprint B #16
//     advanced subset; basic dispatch only — full Workflow Builder
//     lands as a follow-on Sprint).

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }

function _now() { return Math.floor(Date.now() / 1000); }

function _emitConvo(conversationId, event, payload) {
  try {
    globalThis._concordREALTIME?.io?.to(`conversation:${conversationId}`).emit(event, { conversationId, ...payload, ts: Date.now() });
  } catch { /* best effort */ }
}

export default function registerMessagingSchedulerMacros(register) {
  register("messaging", "scheduler_tick", async (ctx) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const due = db.prepare(`
      SELECT id, conversation_id, author_id, body, attachments_json, mentions_json
      FROM messages
      WHERE scheduled_for IS NOT NULL AND scheduled_for <= ?
        AND deleted_at IS NULL
      LIMIT 25
    `).all(_now());
    let flushed = 0;
    for (const row of due) {
      try {
        db.prepare(`UPDATE messages SET scheduled_for = NULL, server_ts = ? WHERE id = ?`).run(_now(), row.id);
        db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(_now(), row.conversation_id);
        let mentions = []; try { mentions = JSON.parse(row.mentions_json || "[]"); } catch { /* ok */ }
        _emitConvo(row.conversation_id, "msg:new", { message: {
          id: row.id, conversation_id: row.conversation_id, author_id: row.author_id,
          body: row.body, mentions, server_ts: _now(),
        }});
        flushed++;
      } catch { /* per-message best-effort */ }
    }
    return { ok: true, flushed, due: due.length };
  }, { destructive: true, note: "Flush scheduled messages whose scheduled_for has passed (heartbeat dispatcher)" });
}
