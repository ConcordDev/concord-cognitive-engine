/**
 * Bus, send, and plugin-delay routing. Pure: the graph applies the plan.
 *
 * A cycle in outputTarget falls back to master. Sends default to post-fader.
 * Delay samples are the amount to add so every path arrives together.
 * `effectLatency` is the track's own insert delay after any clip advance
 * that already cancels it (Pitch Correct live advance).
 */

export interface RouteTrack {
  id: string;
  type: string;
  mute?: boolean;
  solo?: boolean;
  vca?: boolean;
  outputTarget?: string;
  sendLevels?: Record<string, number>;
  sendPre?: Record<string, boolean>;
  /** Insert delay that is still audible, in samples. */
  effectLatency?: number;
}

export interface DirectRoute {
  destId: string;
  delaySamples: number;
}

export interface SendRoute {
  busId: string;
  levelDb: number;
  pre: boolean;
  delaySamples: number;
}

export interface RoutePlan {
  direct: Record<string, DirectRoute>;
  sends: Record<string, SendRoute[]>;
  /** Extra delay on a post-insert tap so a sidechain key matches the master. */
  keyDelay: Record<string, number>;
  /** Output was a cycle or a missing bus, so the track goes to master. */
  fellBack: string[];
}

function latencyOf(t: RouteTrack): number {
  const n = t.effectLatency || 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function outputDest(track: RouteTrack, byId: Map<string, RouteTrack>): { destId: string; fellBack: boolean } {
  const raw = track.outputTarget || 'master';
  if (!raw || raw === 'master' || raw === track.id) return { destId: 'master', fellBack: raw !== 'master' && raw !== undefined && raw !== '' && raw !== 'master' };
  const bus = byId.get(raw);
  if (!bus || bus.type !== 'bus' || bus.vca) return { destId: 'master', fellBack: true };
  const seen = new Set<string>([track.id]);
  let cursor = raw;
  for (let i = 0; i < 16; i++) {
    if (seen.has(cursor)) return { destId: 'master', fellBack: true };
    seen.add(cursor);
    const next = byId.get(cursor);
    const parent = next?.outputTarget || 'master';
    if (!parent || parent === 'master') return { destId: raw, fellBack: false };
    if (!byId.get(parent) || byId.get(parent)?.type !== 'bus') return { destId: raw, fellBack: false };
    cursor = parent;
  }
  return { destId: 'master', fellBack: true };
}

function chainAfter(destId: string, byId: Map<string, RouteTrack>, guard = new Set<string>()): number {
  if (destId === 'master') return 0;
  if (guard.has(destId)) return 0;
  const bus = byId.get(destId);
  if (!bus) return 0;
  guard.add(destId);
  const parent = outputDest(bus, byId).destId;
  return latencyOf(bus) + chainAfter(parent, byId, guard);
}

export function buildRoutePlan(tracks: RouteTrack[]): RoutePlan {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const direct: Record<string, DirectRoute> = {};
  const sends: Record<string, SendRoute[]> = {};
  const fellBack: string[] = [];
  const arrivals: number[] = [];
  const draft: Array<{ id: string; destId: string; own: number; arrival: number; sends: Array<{ busId: string; levelDb: number; pre: boolean; arrival: number }> }> = [];
  for (const t of tracks) {
    if (t.type === 'master' || t.vca) continue;
    const dest = outputDest(t, byId);
    if (dest.fellBack) fellBack.push(t.id);
    const own = latencyOf(t);
    const arrival = own + chainAfter(dest.destId, byId);
    const sendList: Array<{ busId: string; levelDb: number; pre: boolean; arrival: number }> = [];
    for (const [busId, level] of Object.entries(t.sendLevels || {})) {
      const bus = byId.get(busId);
      if (!bus || bus.type !== 'bus' || bus.vca || !Number.isFinite(level)) continue;
      const sendArrival = own + chainAfter(busId, byId);
      sendList.push({ busId, levelDb: level, pre: t.sendPre?.[busId] === true, arrival: sendArrival });
      arrivals.push(sendArrival);
    }
    arrivals.push(arrival);
    draft.push({ id: t.id, destId: dest.destId, own, arrival, sends: sendList });
  }
  const max = arrivals.length ? Math.max(...arrivals) : 0;
  const keyDelay: Record<string, number> = {};
  for (const row of draft) {
    direct[row.id] = { destId: row.destId, delaySamples: Math.max(0, Math.round(max - row.arrival)) };
    sends[row.id] = row.sends.map((s) => ({
      busId: s.busId,
      levelDb: s.levelDb,
      pre: s.pre,
      delaySamples: Math.max(0, Math.round(max - s.arrival)),
    }));
    keyDelay[row.id] = Math.max(0, Math.round(max - row.own));
  }
  return { direct, sends, keyDelay, fellBack };
}

/** Tracks that should pass audio. A solo leaves the buses that solo tracks feed open. */
export function audibleIds(tracks: RouteTrack[]): Set<string> {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const sources = tracks.filter((t) => t.type !== 'master' && t.type !== 'bus' && !t.vca);
  const anySolo = sources.some((t) => t.solo);
  const keepBus = new Set<string>();
  if (anySolo) {
    for (const t of sources) {
      if (!t.solo || t.mute) continue;
      let cursor = outputDest(t, byId).destId;
      for (let i = 0; i < 16 && cursor !== 'master'; i++) {
        keepBus.add(cursor);
        const bus = byId.get(cursor);
        if (!bus) break;
        cursor = outputDest(bus, byId).destId;
      }
    }
  }
  const out = new Set<string>();
  for (const t of tracks) {
    if (t.type === 'master' || t.mute) continue;
    if (t.vca) continue;
    if (!anySolo || t.solo || (t.type === 'bus' && keepBus.has(t.id))) out.add(t.id);
  }
  return out;
}
