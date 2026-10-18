// server/emergent/communication.js
// Inter-emergent messaging. Communications are async by default — recipients
// receive tasks in their queue; responses are never awaited by senders.

import crypto from "node:crypto";
import { infer } from "../lib/inference/index.js";
import { emitFeedEvent } from "./feed.js";
import { admitCreation, noteCreated } from "../lib/background-governor.js";

/** Normalised dedupe key: same sender, recipient and (case/space-folded) message. */
export function communicationDedupeKey(fromId, toId, intent) {
  const norm = String(intent || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160);
  return `comm|${fromId}|${toId}|${norm}`;
}

/**
 * Summarize an intent string to ≤120 chars for feed display.
 */
function summarizeIntent(intent) {
  if (!intent) return "";
  const s = intent.replace(/\s+/g, " ").trim();
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
}

/**
 * Summarize an exchange (intent + response) for feed display.
 */
function summarizeExchange(intent, response) {
  const both = `${intent} — ${response}`.replace(/\s+/g, " ").trim();
  return both.length > 200 ? both.slice(0, 197) + "…" : both;
}

/**
 * Queue an inter-emergent message. The recipient processes it asynchronously
 * in their next minor-agent tick. Never blocks the sender.
 *
 * @param {{id: string, given_name?: string}} from - sender identity
 * @param {{id: string, given_name?: string}} to - recipient identity
 * @param {string} intent
 * @param {object} [context]
 * @param {object} db
 * @param {Function} [realtimeEmit]
 * @returns {object} exchange record
 */
export function initiateCommunication({ from, to, intent, context = {}, db, realtimeEmit }) {
  const messageId = `comm_${crypto.randomBytes(8).toString("hex")}`;
  const now = Date.now();

  const exchange = {
    id: messageId,
    from_emergent_id: from.id,
    to_emergent_id: to.id,
    intent,
    context: JSON.stringify(context),
    initiated_at: now,
    status: "pending",
  };

  // Backpressure at the source: the background governor may refuse the
  // task (queue full, recipient backlog, creator rate, duplicate). A refused
  // message is never inserted and never announced on the feed.
  const govReq = { kind: "communication", fromId: from.id, toId: to.id, dedupeKey: communicationDedupeKey(from.id, to.id, intent) };
  const decision = admitCreation(govReq);
  if (!decision.allow) {
    return { ...exchange, status: "refused", refused_reason: decision.reason };
  }

  if (db) {
    try {
      db.prepare(`
        INSERT INTO emergent_communications
          (id, from_emergent_id, to_emergent_id, intent, context, initiated_at, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).run(messageId, from.id, to.id, intent, exchange.context, now);

      // Queue a communication task for the recipient
      const taskId = `task_${crypto.randomBytes(6).toString("hex")}`;
      db.prepare(`
        INSERT INTO emergent_tasks
          (id, emergent_id, task_type, task_data, status, priority, created_at)
        VALUES (?, ?, 'communication', ?, 'pending', 70, ?)
      `).run(
        taskId,
        to.id,
        JSON.stringify({ from_id: from.id, from_name: from.given_name || from.id, message: intent, message_id: messageId, context }),
        now
      );
      noteCreated(govReq, decision);
    } catch (e) {
      console.error("[communication] initiate failed:", e?.message);
    }
  }

  emitFeedEvent({
    type: "communication",
    emergentId: from.id,
    emergent: from,
    data: { from: from.given_name || from.id, to: to.given_name || to.id, summary: summarizeIntent(intent) },
  }, db, realtimeEmit);

  return exchange;
}

/**
 * Process a received communication task — called by the recipient's minor agent.
 * Responds via subconscious brain and records the response.
 *
 * @param {object} task - from emergent_tasks table
 * @param {object} recipientIdentity - { id, given_name }
 * @param {object} db
 * @param {Function} [realtimeEmit]
 * @returns {Promise<string>} response text
 */
export async function processCommunicationTask(task, recipientIdentity, db, realtimeEmit) {
  const msg = task.task_data;
  let responseText = "";

  try {
    const result = await infer({
      role: "subconscious",
      intent: `Message from ${msg.from_name}: ${msg.message}\n\nYou are ${recipientIdentity.given_name || recipientIdentity.id}. Respond briefly and thoughtfully. Keep response under 300 characters.`,
      callerId: `emergent:${recipientIdentity.id}:communication`,
      maxSteps: 3,
    }, db);
    responseText = result?.finalText || "[no response generated]";
  } catch (e) {
    responseText = `[communication error: ${e?.message}]`;
  }

  const now = Date.now();
  if (db && msg.message_id) {
    try {
      db.prepare(`
        UPDATE emergent_communications
        SET response = ?, completed_at = ?, status = 'completed'
        WHERE id = ?
      `).run(responseText, now, msg.message_id);
    } catch (e) {
      console.error("[communication] update failed:", e?.message);
    }
  }

  emitFeedEvent({
    type: "communication",
    emergentId: recipientIdentity.id,
    emergent: recipientIdentity,
    data: {
      from: msg.from_name,
      to: recipientIdentity.given_name || recipientIdentity.id,
      summary: summarizeExchange(msg.message, responseText),
      message_id: msg.message_id,
    },
  }, db, realtimeEmit);

  return responseText;
}

/**
 * List communications for an emergent (as sender or recipient).
 */
export function listCommunications(emergentId, db, limit = 50) {
  if (!emergentId || !db) return [];
  try {
    return db.prepare(`
      SELECT c.*,
        fi.given_name AS from_name,
        ti.given_name AS to_name
      FROM emergent_communications c
      LEFT JOIN emergent_identity fi ON fi.emergent_id = c.from_emergent_id
      LEFT JOIN emergent_identity ti ON ti.emergent_id = c.to_emergent_id
      WHERE c.from_emergent_id = ? OR c.to_emergent_id = ?
      ORDER BY c.initiated_at DESC LIMIT ?
    `).all(emergentId, emergentId, limit);
  } catch { return []; }
}
