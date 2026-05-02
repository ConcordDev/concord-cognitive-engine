/**
 * World Clock — server-authoritative day/night phase shared by all clients.
 *
 * Phase F's day/night cycle ran off the client's Date.now(); each client saw
 * roughly the same time-of-day but timezone drift and tab-throttling could
 * desync them. This module is the canonical clock: it computes a phase in
 * [0,1) at any moment and broadcasts it to clients via socket.io every 30s.
 *
 * One in-world day = WORLD_DAY_LENGTH_MS (24 real minutes by default).
 * The phase is t = ((Date.now() - WORLD_EPOCH) % WORLD_DAY_LENGTH_MS) / WORLD_DAY_LENGTH_MS.
 *
 * NPC schedule API plugs directly into this: getDayPhase() returns the
 * current named segment (dawn / morning / midday / dusk / night) so an
 * NPC's behavior tree can switch tracks based on time.
 */

const WORLD_DAY_LENGTH_MS = 24 * 60 * 1000;       // 24 real minutes
let _worldEpoch = Date.now();                      // can be reset for testing

export function setWorldEpoch(epochMs) { _worldEpoch = epochMs; }

/** Current phase in [0,1) where 0 = dawn, 0.25 = midday, 0.5 = dusk, 0.75 = midnight. */
export function getWorldPhase(now = Date.now()) {
  const elapsed = (now - _worldEpoch) % WORLD_DAY_LENGTH_MS;
  return elapsed / WORLD_DAY_LENGTH_MS;
}

const NAMED_SEGMENTS = [
  { from: 0.00, to: 0.10, name: "dawn" },
  { from: 0.10, to: 0.40, name: "morning" },
  { from: 0.40, to: 0.55, name: "midday" },
  { from: 0.55, to: 0.70, name: "afternoon" },
  { from: 0.70, to: 0.85, name: "dusk" },
  { from: 0.85, to: 1.00, name: "night" },
];

/** Named segment for the current phase (or any phase). */
export function getDayPhase(t = getWorldPhase()) {
  for (const s of NAMED_SEGMENTS) if (t >= s.from && t < s.to) return s.name;
  return "night";
}

/**
 * Start the broadcast loop. Calls REALTIME.io.emit('world:clock', {phase, segment, ts})
 * every intervalMs. Returns a stop() function.
 */
export function startWorldClockBroadcast(REALTIME, { intervalMs = 30_000 } = {}) {
  if (!REALTIME?.io) return () => {};
  const tick = () => {
    try {
      const phase = getWorldPhase();
      REALTIME.io.emit("world:clock", {
        phase,
        segment:  getDayPhase(phase),
        epochMs:  _worldEpoch,
        dayLengthMs: WORLD_DAY_LENGTH_MS,
        ts:       new Date().toISOString(),
      });
    } catch { /* socket.io may be disposed mid-shutdown */ }
  };
  tick(); // immediate emit so newcomers don't wait
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
}

export const WORLD_CLOCK_CONSTANTS = Object.freeze({
  dayLengthMs: WORLD_DAY_LENGTH_MS,
  segments: NAMED_SEGMENTS,
});
