// server/routes/voice-agent.js
// Voice agent session management routes.
// Wraps the existing voice macros (voice.transcribe, voice.tts) in a stateful session layer.
// Mount at: app.use('/api/voice/session', createVoiceAgentRouter({ runMacro, infer, makeCtx }))
//
// Audio upload: POST /turn accepts Content-Type: application/octet-stream (raw bytes)
// or JSON body { audio: "<base64>", format: "webm|ogg|wav" }
//
// Three-gate note: /api/voice is already in all three gates in server.js (lines 4775, 7931, 7972)

import { Router } from "express";
import { asyncHandler } from "../lib/async-handler.js";
import {
  createSession,
  getSession,
  closeSession,
  handleBargeIn,
  processVoiceTurn,
  getSessionStats,
} from "../lib/voice/voice-pipeline.js";

export function createVoiceAgentRouter({ runMacro, infer, makeCtx }) {
  const router = Router();

  // POST /api/voice/session/create
  router.post("/create", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "unauthenticated" });

    const session = createSession(userId);
    res.json({ ok: true, sessionId: session.id });
  });

  // POST /api/voice/session/turn
  // Accepts raw audio bytes (Content-Type: application/octet-stream) or
  // JSON body { audio: "<base64>", format: "webm|ogg|wav", sessionId: "..." }
  router.post("/turn", asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "unauthenticated" });

    const sessionId = req.body?.sessionId || req.query?.sessionId;
    if (!sessionId) return res.status(400).json({ ok: false, error: "sessionId_required" });

    const session = getSession(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: "session_not_found" });
    if (session.userId !== userId) return res.status(403).json({ ok: false, error: "forbidden" });

    let audioBuffer;
    let audioFormat = "webm";

    const ct = req.headers["content-type"] || "";
    if (ct.includes("application/octet-stream")) {
      audioBuffer = req.body instanceof Buffer ? req.body : Buffer.from(req.body);
      audioFormat = req.query.format || "webm";
    } else if (req.body?.audio) {
      audioBuffer = Buffer.from(req.body.audio, "base64");
      audioFormat = req.body.format || "webm";
    } else {
      return res.status(400).json({ ok: false, error: "audio_required" });
    }

    const result = await processVoiceTurn({
      sessionId,
      audioData: audioBuffer,
      audioFormat,
      runMacro,
      infer,
      ctx: makeCtx ? makeCtx(req) : {},
    });

    res.json(result);
  }));

  // POST /api/voice/session/barge-in
  router.post("/barge-in", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "unauthenticated" });

    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ ok: false, error: "sessionId_required" });

    const session = getSession(sessionId);
    if (!session || session.userId !== userId) return res.status(403).json({ ok: false, error: "forbidden" });

    const interrupted = handleBargeIn(sessionId);
    res.json({ ok: true, interrupted });
  });

  // GET /api/voice/session/stats  (admin only) — must come before /:id
  router.get("/stats", (req, res) => {
    if (req.user?.role !== "sovereign" && req.user?.role !== "admin") {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }
    res.json({ ok: true, stats: getSessionStats() });
  });

  // GET /api/voice/session/:id
  router.get("/:id", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "unauthenticated" });

    const session = getSession(req.params.id);
    if (!session || session.userId !== userId) return res.status(404).json({ ok: false, error: "not_found" });

    res.json({
      ok: true,
      sessionId: session.id,
      state: session.state,
      turnCount: Math.floor(session.history.length / 2),
      lastActiveAt: session.lastActiveAt,
    });
  });

  // DELETE /api/voice/session/:id
  router.delete("/:id", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "unauthenticated" });

    const session = getSession(req.params.id);
    if (!session || session.userId !== userId) return res.status(404).json({ ok: false, error: "not_found" });

    closeSession(req.params.id);
    res.json({ ok: true });
  });

  return router;
}
