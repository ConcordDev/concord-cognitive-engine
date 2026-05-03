// server/domains/federation.js
// Federation lens. Lists peers, trust edges, and federated activity.
// Reads server/lib/federation.js + state.settings.federationPeers.

import { listPeers } from "../lib/federation.js";

export default function registerFederationActions(registerLensAction) {
  /**
   * peers — return the current federation peer list with trust scores.
   */
  registerLensAction("federation", "peers", (ctx) => {
    const STATE = globalThis._concordSTATE;
    const peers = STATE?.settings?.federationPeers ?? [];
    let trustGraph = [];
    try {
      trustGraph = listPeers(ctx?.db, {});
    } catch { /* DB-dependent helper — empty list on minimal builds */ }
    return {
      ok: true,
      result: {
        configured: peers.map((p) => ({ id: p.id ?? p.url, url: p.url, hasToken: !!p.token })),
        trustGraph: trustGraph.slice(0, 50),
        federationEnabled: STATE?.settings?.federationEnabled !== false,
      },
    };
  });

  /**
   * activity — recent federation events from the social-npc-bridge import
   * pass. Reads STATE.shadowDtus tagged 'federated_signal'.
   */
  registerLensAction("federation", "activity", () => {
    const STATE = globalThis._concordSTATE;
    if (!STATE?.shadowDtus) return { ok: true, result: { items: [] } };
    const items = [];
    for (const s of STATE.shadowDtus.values()) {
      if (!Array.isArray(s.tags) || !s.tags.includes("federated_signal")) continue;
      items.push({
        id: s.id,
        summary: s.core?.summary ?? "",
        sourcePeer: s.sourcePeer,
        createdAt: s.createdAt,
      });
      if (items.length >= 50) break;
    }
    items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return { ok: true, result: { items } };
  });
}
