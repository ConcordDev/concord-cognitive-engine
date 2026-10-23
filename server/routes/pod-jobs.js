// server/routes/pod-jobs.js
// Internal pull-based pod job API. Bound to loopback + bearer token only.
// Must be mounted BEFORE global auth/CSRF/rate-limit middleware.

import express from "express";
import crypto from "node:crypto";
import { podJobs } from "../lib/pod-jobs.js";

const PUBLIC_HEADERS = ["cf-ray", "cf-connecting-ip", "x-forwarded-for", "x-real-ip"];

function isLoopback(addr) {
  if (!addr) return false;
  if (addr === "127.0.0.1" || addr === "::1") return true;
  if (addr === "::ffff:127.0.0.1") return true;
  return false;
}

export function podJobsEnabled(env = process.env) {
  return env.CONCORD_POD_JOBS === "1" && String(env.CONCORD_POD_JOB_TOKEN || "").length >= 32;
}

export function createPodJobsRouter({ queue = podJobs, token = process.env.CONCORD_POD_JOB_TOKEN } = {}) {
  const router = express.Router();

  function auth(req, res, next) {
    // a) Reject any request carrying public/cloudflare headers.
    for (const h of PUBLIC_HEADERS) {
      if (req.headers[h] != null) {
        return res.sendStatus(404);
      }
    }

    // b) Loopback only.
    const remote = req.socket?.remoteAddress || req.connection?.remoteAddress;
    if (!isLoopback(remote)) {
      return res.sendStatus(404);
    }

    // c) Bearer token, constant-time compare.
    const authHeader = req.headers.authorization || "";
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    const provided = match ? match[1] : "";
    if (!token || !provided || token.length !== provided.length) {
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      const a = Buffer.from(token);
      const b = Buffer.from(provided);
      if (!crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ error: "unauthorized" });
      }
    } catch {
      return res.status(401).json({ error: "unauthorized" });
    }

    next();
  }

  router.use(auth);
  router.use(express.json({ limit: "512kb" }));

  // AUTH: router-auth — router.use(auth) above: loopback only, proxied requests refused, constant-time bearer token.
  router.post("/claim", (req, res) => {
    const { workerId, kinds, max } = req.body || {};
    const jobs = queue.claim(workerId, Array.isArray(kinds) ? kinds : [], Number(max) || 4);
    res.json({ jobs });
  });

  // AUTH: router-auth — router.use(auth) above: loopback only, proxied requests refused, constant-time bearer token.
  router.post("/complete", (req, res) => {
    const { id, workerId, ok, result, error } = req.body || {};
    const accepted = queue.complete(id, workerId, { ok, result, error });
    res.json({ accepted });
  });

  // AUTH: router-auth — router.use(auth) above: loopback only, proxied requests refused, constant-time bearer token.
  router.post("/heartbeat", (req, res) => {
    const { workerId, info } = req.body || {};
    queue.heartbeat(workerId, info || {});
    res.json({ ok: true });
  });

  router.get("/stats", (_req, res) => {
    res.json(queue.stats());
  });

  return router;
}
