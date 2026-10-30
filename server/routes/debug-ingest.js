/**
 * Debug Ingest Routes — the public Sentry-compatible envelope endpoint
 * (Debug lens Q1 slice, §8 ruling).
 *
 * Mounts under /api/debug via app.use("/api/debug", ...) in server.js.
 *
 *   POST /ingest/:projectId/envelope/ — accept a Sentry envelope,
 *        authenticated by the project's cdi_ ingest key in the
 *        X-Sentry-Auth header (never a URL, never logged).
 *
 * This module owns only the HTTP plumbing: the raw body, the size cap,
 * and the status line. All request logic lives in
 * server/lib/debug-ingest-handler.js (express-free, behaviour-tested)
 * and all debug-state knowledge stays in server/domains/debug.js,
 * reached through its exported debugIngest hooks.
 */

import express, { Router } from "express";
import { debugIngest } from "../domains/debug.js";
import { createIngestHandler } from "../lib/debug-ingest-handler.js";

export default function createDebugIngestRouter() {
  const router = Router();
  const handler = createIngestHandler({ ingest: debugIngest });

  router.post(
    "/ingest/:projectId/envelope",
    express.raw({ type: () => true, limit: "1mb" }),
    (req, res) => {
      let out;
      try {
        out = handler.handle({
          projectId: req.params.projectId,
          authHeader: req.get("x-sentry-auth"),
          body: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          // express.raw already inflated a Content-Encoding: gzip body (and its 1 MB limit applies to the
          // inflated size, which also stops gzip bombs). Passing the header on would gunzip plain bytes a
          // second time and 400 every real Sentry SDK.
          contentEncoding: undefined,
        });
      } catch {
        out = { status: 500, json: { error: "ingest failed" } };
      }
      if (out.headers) {
        for (const [name, value] of Object.entries(out.headers)) res.set(name, value);
      }
      return res.status(out.status).json(out.json);
    },
  );

  // express.raw rejects an oversized body by error, not by response —
  // translate that one case into the taxonomy's 413; anything else
  // falls through to the app's error handling.
  router.use((err, _req, res, next) => {
    if (err && err.type === "entity.too.large") {
      return res.status(413).json({ error: "envelope too large" });
    }
    return next(err);
  });

  return router;
}
