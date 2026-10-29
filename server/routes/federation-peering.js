// server/routes/federation-peering.js
//
// Inbound HTTP endpoints for the federation peering protocol
// (server/emergent/federation-peering.js), mounted by
// routes/federation.js under /api/federation/v1 — BEFORE that router's
// user-auth middleware on purpose: pod-to-pod calls carry no user
// session. Authentication is the protocol's own, and it is mandatory:
// the sender must be a registered peer, and sync packages AND
// proposals must carry a valid HMAC under that peer's shared secret
// (verified inside receiveSyncPackage / receiveProposal; a peer with
// no configured secret is refused, fail-closed). Heartbeats carry no
// content — only lattice summaries for sync planning — and stay
// registration-gated.
//
// Wire envelopes (the outbound side is
// server/lib/federation-peering-transport.js):
//   POST /heartbeat  { from, heartbeat, signature } → 200 { ok, syncNeeded, heartbeat }
//     The response carries OUR heartbeat so one exchange updates both
//     pods' sync planning.
//   POST /sync       { from, package }   → the receiveSyncPackage result
//   POST /proposal   { from, proposal, signature } → the receiveProposal result

import express from "express";
import {
  buildHeartbeat,
  receiveSignedHeartbeat,
  receiveSyncPackage,
  receiveProposal,
} from "../emergent/federation-peering.js";

const STATUS_BY_ERROR = {
  unknown_peer: 404,
  signature_required: 401,
  signature_invalid: 401,
  insufficient_trust: 403,
  insufficient_trust_for_proposals: 403,
  package_too_large: 413,
  proposal_id_required: 400,
};

function sendResult(res, result) {
  if (result?.ok) return res.json(result);
  const status = STATUS_BY_ERROR[result?.error] || 400;
  return res.status(status).json(result || { ok: false, error: "bad_request" });
}

export default function createFederationPeeringRouter() {
  const router = express.Router();

  const state = () => globalThis._concordSTATE;
  const fromPeer = (req) => (typeof req.body?.from === "string" ? req.body.from : "");

  router.post("/heartbeat", (req, res) => {
    const STATE = state();
    if (!STATE) return res.status(503).json({ ok: false, error: "state_unavailable" });
    const signature = typeof req.body?.signature === "string" ? req.body.signature : null;
    const received = receiveSignedHeartbeat(STATE, fromPeer(req), req.body?.heartbeat || {}, signature);
    if (!received.ok) return sendResult(res, received);
    const ours = buildHeartbeat(STATE);
    return res.json({ ok: true, syncNeeded: !!received.syncNeeded, heartbeat: ours.heartbeat });
  });

  router.post("/sync", (req, res) => {
    const STATE = state();
    if (!STATE) return res.status(503).json({ ok: false, error: "state_unavailable" });
    return sendResult(res, receiveSyncPackage(STATE, fromPeer(req), req.body?.package || {}));
  });

  router.post("/proposal", (req, res) => {
    const STATE = state();
    if (!STATE) return res.status(503).json({ ok: false, error: "state_unavailable" });
    return sendResult(res, receiveProposal(STATE, fromPeer(req), req.body?.proposal || {}, typeof req.body?.signature === "string" ? req.body.signature : null));
  });

  return router;
}
