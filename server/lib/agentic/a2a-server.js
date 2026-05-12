// server/lib/agentic/a2a-server.js
// A2A v1.0 protocol adapter — lets external agents converse with Concord emergents.
// Implements: /a2a/v1/agent-card, /a2a/v1/conversation, /a2a/v1/message,
//             /a2a/v1/conversation/:id/state
// Returns an Express router for mounting at /a2a.

import express from "express";
import crypto from "node:crypto";
import { infer } from "../inference/index.js";

// Active A2A conversations: conversationId → { emergentId, messages, createdAt }
const _conversations = new Map();
const CONVERSATION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Cleanup stale conversations (unref so this doesn't prevent process exit in tests)
// @resource-leak-ok: process-lifetime — A2A session reaper
setInterval(() => {
  const cutoff = Date.now() - CONVERSATION_TTL_MS;
  for (const [id, conv] of _conversations) {
    if (conv.createdAt < cutoff) _conversations.delete(id);
  }
}, 60000).unref();

/**
 * Build an A2A-compliant agent card describing available Concord agents.
 * @param {object} [emergentsIndex] - optional emergents registry
 */
function buildAgentCard(emergentsIndex = {}) {
  return {
    protocol: "a2a/v1.0",
    platform: "concord-cognitive-engine",
    agents: Object.entries(emergentsIndex).map(([id, emergent]) => ({
      id,
      name: emergent.name || id,
      description: emergent.description || "",
      acceptsExternalA2A: emergent.acceptsExternalA2A === true,
      capabilities: emergent.capabilities || ["conversation"],
    })),
    endpoints: {
      agentCard: "/a2a/v1/agent-card",
      conversation: "/a2a/v1/conversation",
      message: "/a2a/v1/message",
      state: "/a2a/v1/conversation/:id/state",
    },
  };
}

/**
 * Create the A2A Express router.
 *
 * @param {{ emergentsIndex?: object, db?: object, requireApiKey?: boolean }} opts
 * @returns {express.Router}
 */
export function createA2ARouter({ emergentsIndex = {}, db, requireApiKey = true } = {}) {
  const router = express.Router();

  // Optional API key guard
  if (requireApiKey) {
    router.use((req, res, next) => {
      const key = req.headers["x-api-key"] || req.headers["authorization"]?.replace("Bearer ", "");
      if (!key) return res.status(401).json({ error: "a2a_auth_required", message: "Provide x-api-key header" });
      // Basic validation — real implementation uses API key store
      if (key.length < 16) return res.status(401).json({ error: "invalid_api_key" });
      next();
    });
  }

  // GET /a2a/v1/agent-card
  router.get("/v1/agent-card", (req, res) => {
    res.json(buildAgentCard(emergentsIndex));
  });

  // POST /a2a/v1/conversation — initiate
  router.post("/v1/conversation", async (req, res) => {
    const { targetAgent, initialMessage, context } = req.body || {};

    const emergent = emergentsIndex[targetAgent];
    if (!emergent) {
      return res.status(404).json({ error: "agent_not_found", targetAgent });
    }
    if (!emergent.acceptsExternalA2A) {
      return res.status(403).json({ error: "agent_does_not_accept_external_a2a", targetAgent });
    }

    const conversationId = `a2a_${crypto.randomBytes(8).toString("hex")}`;
    const sourceAgent = req.headers["x-a2a-source-agent"] || "external";

    const conversation = {
      conversationId,
      emergentId: targetAgent,
      sourceAgent,
      messages: [{ role: "user", content: initialMessage || "" }],
      context: context || {},
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    _conversations.set(conversationId, conversation);

    // Run initial inference
    let responseText = "";
    try {
      const result = await infer({
        role: "subconscious", // A2A never uses the conscious chat brain
        intent: initialMessage || "",
        callerId: `a2a:${sourceAgent}:${conversationId}`,
        lensContext: { ...context, source: "a2a-external", targetAgent },
      }, db);
      responseText = result.finalText;
    } catch (err) {
      responseText = `[A2A inference error: ${err?.message}]`;
    }

    conversation.messages.push({ role: "assistant", content: responseText });
    conversation.lastActivityAt = Date.now();

    res.json({
      conversationId,
      response: responseText,
      targetAgent,
    });
  });

  // POST /a2a/v1/message — continue conversation
  router.post("/v1/message", async (req, res) => {
    const { conversationId, message } = req.body || {};
    const conversation = _conversations.get(conversationId);

    if (!conversation) {
      return res.status(404).json({ error: "conversation_not_found", conversationId });
    }

    conversation.messages.push({ role: "user", content: message || "" });

    let responseText = "";
    try {
      const result = await infer({
        role: "subconscious",
        intent: message || "",
        history: conversation.messages.slice(-6),
        callerId: `a2a:${conversation.sourceAgent}:${conversationId}`,
        lensContext: { ...conversation.context, source: "a2a-external" },
      }, db);
      responseText = result.finalText;
    } catch (err) {
      responseText = `[A2A inference error: ${err?.message}]`;
    }

    conversation.messages.push({ role: "assistant", content: responseText });
    conversation.lastActivityAt = Date.now();

    res.json({ conversationId, response: responseText });
  });

  // GET /a2a/v1/conversation/:id/state
  router.get("/v1/conversation/:id/state", (req, res) => {
    const conversation = _conversations.get(req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: "conversation_not_found" });
    }
    res.json({
      conversationId: conversation.conversationId,
      emergentId: conversation.emergentId,
      messageCount: conversation.messages.length,
      createdAt: conversation.createdAt,
      lastActivityAt: conversation.lastActivityAt,
      status: "active",
    });
  });

  return router;
}
