// server/domains/fedmesh.js
//
// Federated brain / mesh (#38) — macros over lib/federation-mesh.js: a
// persistent peer registry, a consent-gated incoming-DTU inbox, and a consented
// consult of peers' brains (the "6th brain") over the real connectorFetch. No
// fabricated replies — with no reachable peer the consult reports unavailable.
//
// Registered from server.js: registerFedmeshMacros(register).

import {
  registerPeer, listPeers, revokePeer, receiveDtu, drainInbox, consultFederatedBrain,
} from "../lib/federation-mesh.js";

export default function registerFedmeshMacros(register) {
  register("fedmesh", "register_peer", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return registerPeer(db, { peerId: input.peerId, url: input.url, brainUrl: input.brainUrl, pubKey: input.pubKey, capabilities: input.capabilities });
  }, { note: "register/refresh a federation peer (#38)" });

  register("fedmesh", "peers", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, peers: listPeers(db, { includeRevoked: input.includeRevoked === true }) };
  }, { note: "list known federation peers (#38)" });

  register("fedmesh", "revoke_peer", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return revokePeer(db, input.peerId);
  }, { note: "revoke a peer — future inbound auto-rejected (#38)" });

  register("fedmesh", "receive", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return receiveDtu(db, { fromPeer: input.fromPeer, dtuId: input.dtuId, envelope: input.envelope });
  }, { note: "enqueue an incoming DTU envelope from a peer (#38)" });

  register("fedmesh", "drain", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, ...drainInbox(db, input.policy || {}) };
  }, { note: "evaluate the inbox against the consent policy; accept/reject (#38)" });

  register("fedmesh", "consult", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    return consultFederatedBrain(db, ctx?.actor?.userId || null, { slot: input.slot, messages: input.messages || [] });
  }, { note: "consult peers' brains (6th brain); honest unavailable when none reachable (#38)" });
}
