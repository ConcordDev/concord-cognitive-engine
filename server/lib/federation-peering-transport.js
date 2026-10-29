// server/lib/federation-peering-transport.js
//
// HTTP transport for the federation peering protocol
// (server/emergent/federation-peering.js). The protocol module defines
// the state machine — peer registry, heartbeats, HMAC-signed DTU sync
// packages, proposal routing — but deliberately made no network calls.
// This module is the wire:
//
//   POST {peer.endpoint}/heartbeat  { from, heartbeat }   → peer replies
//     with its own heartbeat, which is fed to receiveHeartbeat so one
//     exchange updates both sides' sync planning.
//   POST {peer.endpoint}/sync       { from, package }     → the signed
//     package from buildSyncPackage; the reply is the peer's
//     receiveSyncPackage result.
//   POST {peer.endpoint}/proposal   { from, proposal }    → gated by
//     routeProposalToPeer (trust) before anything leaves this pod.
//
// A peer's registered `endpoint` is its peering base URL — for a
// Concord pod that is https://<pod>/api/federation/v1 (the inbound
// router in server/routes/federation-peering.js mounts there).
//
// Egress goes through the shared SSRF guard (validateSafeFetchUrl +
// fetchWithPinnedIp, the same primitives connector-client and the MCP
// bridge use), so a registered endpoint cannot aim this pod at
// loopback/link-local/metadata addresses. Failures are honest result
// objects — never throws, never fabricates a peer reply.
//
// Test seam: opts.fetchImpl replaces the guarded fetch (the caller
// owns the transport, exactly the connectorFetch seam contract in
// connector-client.js). Production never sets it.

import { validateSafeFetchUrl, fetchWithPinnedIp } from "./ssrf-guard.js";
import {
  getRegisteredPeer,
  buildHeartbeat,
  receiveHeartbeat,
  buildSyncPackage,
  routeProposalToPeer,
  signProposal,
} from "../emergent/federation-peering.js";

const DEFAULT_TIMEOUT_MS = 8000;

function peerUrl(endpoint, path) {
  return `${String(endpoint).replace(/\/+$/, "")}${path}`;
}

/**
 * POST a JSON payload to a peer endpoint through the SSRF guard.
 * @returns {Promise<{ok:true, status:number, body:any} |
 *   {ok:false, error:string, status?:number, detail?:string}>}
 */
export async function postJsonToPeer(peer, path, payload, opts = {}) {
  const url = peerUrl(peer?.endpoint || "", path);
  const init = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS),
  };

  let res;
  if (typeof opts.fetchImpl === "function") {
    // Test seam — caller owns the transport (see header).
    try {
      res = await opts.fetchImpl(url, init);
    } catch (e) {
      return { ok: false, error: "peer_unreachable", detail: String(e?.message || e) };
    }
  } else {
    const check = await validateSafeFetchUrl(url);
    if (!check.ok) return { ok: false, error: "blocked_url", detail: check.error };
    try {
      res = await fetchWithPinnedIp(check, init);
    } catch (e) {
      return { ok: false, error: "peer_unreachable", detail: String(e?.message || e) };
    }
  }

  if (!res || typeof res.status !== "number") {
    return { ok: false, error: "peer_response_invalid" };
  }
  if (!res.ok) {
    return { ok: false, error: "peer_http_error", status: res.status };
  }
  const body = typeof res.json === "function" ? await res.json().catch(() => null) : null;
  if (body == null) return { ok: false, error: "peer_response_invalid", status: res.status };
  return { ok: true, status: res.status, body };
}

function requirePeer(STATE, peerId) {
  const peer = getRegisteredPeer(STATE, peerId);
  if (!peer) return { ok: false, error: "unknown_peer" };
  if (!peer.endpoint) return { ok: false, error: "peer_endpoint_missing" };
  return { ok: true, peer };
}

function requireSelf(selfPeerId) {
  if (!selfPeerId || typeof selfPeerId !== "string") {
    return { ok: false, error: "self_peer_id_required" };
  }
  return { ok: true };
}

/**
 * Exchange heartbeats with a registered peer: send ours, feed the
 * peer's reply into receiveHeartbeat.
 * @returns {Promise<{ok:true, syncNeeded:boolean} | {ok:false, error:string, ...}>}
 */
export async function sendHeartbeat(STATE, selfPeerId, peerId, opts = {}) {
  const self = requireSelf(selfPeerId);
  if (!self.ok) return self;
  const found = requirePeer(STATE, peerId);
  if (!found.ok) return found;

  const built = buildHeartbeat(STATE);
  if (!built.ok) return built;

  const res = await postJsonToPeer(found.peer, "/heartbeat", {
    from: selfPeerId,
    heartbeat: built.heartbeat,
  }, opts);
  if (!res.ok) return res;

  const reply = res.body?.heartbeat;
  if (!reply || typeof reply !== "object") {
    return { ok: false, error: "peer_response_invalid", status: res.status };
  }
  const received = receiveHeartbeat(STATE, peerId, reply);
  if (!received.ok) return received;
  return { ok: true, syncNeeded: !!received.syncNeeded };
}

/**
 * Build the (HMAC-signed, when a shared secret is configured) sync
 * package for a peer and deliver it. Returns the peer's import result.
 */
export async function sendSync(STATE, selfPeerId, peerId, opts = {}) {
  const self = requireSelf(selfPeerId);
  if (!self.ok) return self;
  const found = requirePeer(STATE, peerId);
  if (!found.ok) return found;

  const built = buildSyncPackage(STATE, peerId, { dtuIds: opts.dtuIds, limit: opts.limit });
  if (!built.ok) return built;

  const res = await postJsonToPeer(found.peer, "/sync", {
    from: selfPeerId,
    package: built.package,
  }, opts);
  if (!res.ok) return res;

  const r = res.body || {};
  return {
    ok: true,
    received: Number(r.received) || 0,
    shadowed: Number(r.shadowed) || 0,
    rejected: Number(r.rejected) || 0,
  };
}

/**
 * Route a governance proposal to a peer. The protocol's trust gate
 * (routeProposalToPeer) runs first — an under-trusted peer gets the
 * refusal locally and nothing is sent. The envelope is HMAC-signed
 * with the peer's shared secret (signProposal): receivers verify it
 * mandatorily, so an unsigned proposal only ever reaches pods running
 * older code.
 */
export async function sendProposal(STATE, selfPeerId, peerId, proposal, opts = {}) {
  const self = requireSelf(selfPeerId);
  if (!self.ok) return self;
  const found = requirePeer(STATE, peerId);
  if (!found.ok) return found;

  const routed = routeProposalToPeer(STATE, peerId, proposal);
  if (!routed.ok) return routed;

  const signature = found.peer.sharedSecret
    ? signProposal(found.peer.sharedSecret, selfPeerId, proposal)
    : null;

  const res = await postJsonToPeer(found.peer, "/proposal", {
    from: selfPeerId,
    proposal,
    signature,
  }, opts);
  if (!res.ok) return res;

  return { ok: true, proposalId: routed.proposalId, delivered: true };
}

export default { postJsonToPeer, sendHeartbeat, sendSync, sendProposal };
