/**
 * P2P DTU signalling — multi-peer rooms (Sprint 42).
 *
 * Two real fixes made along the way while extending this from 1:1 to N-peer,
 * both found by reading the pre-existing file rather than assumed:
 *
 * 1. ARCHITECTURE BUG: the previous version had the SERVER construct a
 *    `wrtc` RTCPeerConnection + DataChannel and immediately push data over
 *    it (`require('wrtc')`, uninstalled — this file could never actually
 *    load). A signalling server's job is to relay opaque SDP/ICE blobs
 *    between two REAL client-side peers; it should never itself be one of
 *    the WebRTC endpoints. This version relays plain data and never touches
 *    RTCPeerConnection at all — matching how the mock fixtures
 *    (server/tests/fixtures/p2p-webrtc-mock.js) model it: two peer objects
 *    the CALLERS create and connect, with this module only passing SDP
 *    strings between them.
 * 2. CRASH BUG: the old `pollOffer`'s interval didn't `return` after
 *    resolving `null` for a missing offer, so on the very next check inside
 *    the same tick it read `.answer` off `undefined` and threw. Also: every
 *    `createOffer()` call spawned its own perpetual, never-cleared
 *    `setInterval` — an interval leak, one per offer, forever. Fixed by a
 *    single shared cleanup interval owned by the hub instance.
 *
 * Multi-peer design: DTUs are content-addressed (id = hash of content —
 * see dtu-protocol.js#generateId), so there's no "which version wins"
 * conflict to resolve for DTU content itself once 3+ peers are exchanging
 * them. The real multi-peer conflict is ROOM MEMBERSHIP — who's in the
 * room — which genuinely is concurrently mutable (two peers can each
 * observe a different join/leave history before syncing). That's resolved
 * via server/lib/p2p-vector-clock.js's add-wins OR-Set (`resolveMembership`),
 * not by this file re-deriving conflict logic.
 *
 * Signalling itself stays pairwise even in a room — WebRTC mesh topology
 * means peer A and peer B still do their own 1:1 offer/answer/ICE exchange;
 * a room of N peers is N*(N-1)/2 such pairwise exchanges. This module adds
 * `roomId` + explicit `fromPeerId`/`toPeerId` addressing on top of the
 * original offer/answer/poll primitives so a newly-joined peer can discover
 * (via `pendingOffersFor`) the offers addressed to it by every existing
 * room member, instead of the old design's single anonymous global offerId.
 *
 * STILL NOT WIRED: this router is not mounted in server.js. Exposing a new
 * unauthenticated signalling relay endpoint is a real decision (who can
 * create/join rooms, rate limits, auth) that's out of scope for "design the
 * multi-peer primitive" — left for an explicit follow-up, not silently
 * assumed. Import + mount this module's `router` export when that decision
 * is made.
 */

import express from "express";
import { randomUUID } from "node:crypto";
import { createClock, tick, resolveMembership } from "./p2p-vector-clock.js";

const OFFER_TTL_MS = 60_000;

export class P2PSignallingHub {
  constructor({ offerTtlMs = OFFER_TTL_MS } = {}) {
    this.rooms = new Map(); // roomId -> { membershipEvents: MembershipEvent[], clocks: Map<peerId, clock> }
    this.offers = new Map(); // offerId -> { roomId, fromPeerId, toPeerId, sdp, answer, createdAt }
    this.offerTtlMs = offerTtlMs;
    this._cleanupTimer = null;
  }

  _ensureRoom(roomId) {
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, { membershipEvents: [], clocks: new Map() });
    return this.rooms.get(roomId);
  }

  _peerClock(room, peerId) {
    if (!room.clocks.has(peerId)) room.clocks.set(peerId, createClock(peerId));
    return room.clocks.get(peerId);
  }

  /**
   * @param {string} roomId
   * @param {string} peerId
   * @returns {{ members: string[], clock: object }} existing members (not
   *   including the caller) + the caller's new causal clock, so it can be
   *   attached to subsequent offers it creates in this room.
   */
  joinRoom(roomId, peerId) {
    const room = this._ensureRoom(roomId);
    const clock = tick(this._peerClock(room, peerId), peerId);
    room.clocks.set(peerId, clock);
    room.membershipEvents.push({ peerId, clock, op: "join" });
    const members = [...resolveMembership(room.membershipEvents)].filter((id) => id !== peerId);
    return { members, clock };
  }

  /**
   * @param {string} roomId
   * @param {string} peerId
   * @returns {{ ok: boolean, clock?: object, reason?: string }}
   */
  leaveRoom(roomId, peerId) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, reason: "no_room" };
    const clock = tick(this._peerClock(room, peerId), peerId);
    room.clocks.set(peerId, clock);
    room.membershipEvents.push({ peerId, clock, op: "leave" });
    return { ok: true, clock };
  }

  /** @returns {string[]} current room members, converged via resolveMembership */
  roomMembers(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return [...resolveMembership(room.membershipEvents)];
  }

  /**
   * Register an SDP offer from one peer to another within a room. Pairwise
   * by design — a mesh room needs one of these per ordered peer pair.
   * @returns {string} offerId
   */
  createOffer(roomId, fromPeerId, toPeerId, sdp) {
    const offerId = randomUUID();
    this.offers.set(offerId, { roomId, fromPeerId, toPeerId, sdp, answer: null, createdAt: Date.now() });
    this._ensureCleanup();
    return offerId;
  }

  /** @returns {boolean} whether the offer existed and was answered */
  answerOffer(offerId, answerSdp) {
    const offer = this.offers.get(offerId);
    if (!offer) return false;
    offer.answer = answerSdp;
    return true;
  }

  /** @returns {*} the answer SDP, or null if not yet answered / doesn't exist */
  pollOffer(offerId) {
    const offer = this.offers.get(offerId);
    if (!offer) return null;
    return offer.answer;
  }

  /**
   * Offers addressed to `toPeerId` in `roomId` that haven't been answered
   * yet — how a peer discovers offers other room members sent it, without
   * needing to already know every offerId (there was never a "list all
   * offers for me" primitive in the 1:1 design; a room needs one).
   */
  pendingOffersFor(roomId, toPeerId) {
    const out = [];
    for (const [offerId, offer] of this.offers.entries()) {
      if (offer.roomId === roomId && offer.toPeerId === toPeerId && !offer.answer) {
        out.push({ offerId, fromPeerId: offer.fromPeerId, sdp: offer.sdp });
      }
    }
    return out;
  }

  _ensureCleanup() {
    if (this._cleanupTimer) return; // one shared timer for the hub's lifetime, not one per offer
    this._cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, offer] of this.offers.entries()) {
        if (now - offer.createdAt > this.offerTtlMs) this.offers.delete(id);
      }
    }, this.offerTtlMs);
    this._cleanupTimer.unref?.(); // never keep the process alive for this alone
  }

  /** Test/shutdown hygiene — stops the shared cleanup interval. */
  stopCleanup() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }
}

const hub = new P2PSignallingHub();

const router = express.Router();

router.post("/api/p2p/room/:roomId/join", (req, res) => {
  const { peerId } = req.body || {};
  if (!peerId) return res.status(400).json({ error: "peerId required" });
  res.json(hub.joinRoom(req.params.roomId, peerId));
});

router.post("/api/p2p/room/:roomId/leave", (req, res) => {
  const { peerId } = req.body || {};
  if (!peerId) return res.status(400).json({ error: "peerId required" });
  res.json(hub.leaveRoom(req.params.roomId, peerId));
});

router.get("/api/p2p/room/:roomId/members", (req, res) => {
  res.json({ members: hub.roomMembers(req.params.roomId) });
});

router.post("/api/p2p/room/:roomId/offer", (req, res) => {
  const { fromPeerId, toPeerId, sdp } = req.body || {};
  if (!fromPeerId || !toPeerId || !sdp) return res.status(400).json({ error: "fromPeerId, toPeerId, sdp required" });
  const offerId = hub.createOffer(req.params.roomId, fromPeerId, toPeerId, sdp);
  res.json({ offerId });
});

router.post("/api/p2p/offer/:offerId/answer", (req, res) => {
  const success = hub.answerOffer(req.params.offerId, (req.body || {}).sdp);
  res.json({ success });
});

router.get("/api/p2p/offer/:offerId/poll", (req, res) => {
  const answer = hub.pollOffer(req.params.offerId);
  res.json(answer ? { answer } : { answer: null });
});

router.get("/api/p2p/room/:roomId/pending/:peerId", (req, res) => {
  res.json({ offers: hub.pendingOffersFor(req.params.roomId, req.params.peerId) });
});

export { hub, router };
export default router;
