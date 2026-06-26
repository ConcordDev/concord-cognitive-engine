/**
 * netcode.ts
 *
 * Client-side netcode: server reconciliation + delta compression.
 *
 * Problems:
 *   1. No rollback: When the server sends an authoritative position that
 *      differs from the client's predicted position, the character snaps
 *      visibly. The fix: maintain a history of (input, state) pairs, and
 *      re-simulate from the last confirmed server state using all unconfirmed
 *      inputs — "client-side prediction + server reconciliation."
 *
 *   2. Full JSON payloads: Every position update sends the full state object
 *      (~200 bytes). Delta compression sends only changed fields with compact
 *      binary encoding, reducing bandwidth by ~80% for idle players.
 *
 * References:
 *   Gabriel Gambetta (2018) "Fast-Paced Multiplayer" — client-side prediction
 *   Valve Networking (Source Engine) — sequence-numbered inputs + reconciliation
 *   Glenn Fiedler — "Snapshot Interpolation" and "Delta Compression"
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }

/** One frame of player input, tagged with the sequence number sent to the server. */
export interface InputFrame {
  seq:     number;
  delta:   number;    // frame time in seconds
  forward: number;    // -1…1
  strafe:  number;    // -1…1
  jump:    boolean;
  sprint:  boolean;
  yaw:     number;    // camera yaw in radians
}

/** Full character physics state at a point in time. */
export interface CharState {
  seq:      number;   // last applied input sequence
  position: Vec3;
  velocity: Vec3;
  onGround: boolean;
  health:   number;
  stamina:  number;
}

/** Server authoritative state update (received from WebSocket). */
export interface ServerStateMsg {
  seq:      number;   // last input sequence processed by server
  state:    CharState;
  tick:     number;   // server tick number
}

// ── Delta-compressed position update ─────────────────────────────────────────

/** Bit flags indicating which fields changed. */
export const DELTA_FLAGS = {
  POS_X:    0x0001,
  POS_Y:    0x0002,
  POS_Z:    0x0004,
  VEL_X:   0x0008,
  VEL_Y:   0x0010,
  VEL_Z:   0x0020,
  YAW:     0x0040,
  HEALTH:  0x0080,
  STAMINA: 0x0100,
  FLAGS:   0x0200,   // jump/sprint/onGround packed bits
} as const;

/**
 * Encode a state delta as a compact binary DataView.
 * Only fields that changed from `prev` to `next` are included.
 * Fixed-point encoding: positions in mm (int32), velocities in mm/s (int16),
 * angles in 1/100 degree (int16), health/stamina in 1/100 percent (int16).
 *
 * Max message size: 2 (flags) + 9 fields × 4 bytes = 38 bytes vs ~200 byte JSON.
 */
export function encodeDelta(prev: CharState, next: CharState): ArrayBuffer {
  let flags = 0;
  const changed = {
    posX:    Math.abs(next.position.x - prev.position.x) > 0.001,
    posY:    Math.abs(next.position.y - prev.position.y) > 0.001,
    posZ:    Math.abs(next.position.z - prev.position.z) > 0.001,
    velX:    Math.abs(next.velocity.x - prev.velocity.x) > 0.01,
    velY:    Math.abs(next.velocity.y - prev.velocity.y) > 0.01,
    velZ:    Math.abs(next.velocity.z - prev.velocity.z) > 0.01,
    health:  Math.abs(next.health  - prev.health)  > 0.01,
    stamina: Math.abs(next.stamina - prev.stamina) > 0.01,
    flags:   next.onGround !== prev.onGround,
  };

  if (changed.posX)    flags |= DELTA_FLAGS.POS_X;
  if (changed.posY)    flags |= DELTA_FLAGS.POS_Y;
  if (changed.posZ)    flags |= DELTA_FLAGS.POS_Z;
  if (changed.velX)    flags |= DELTA_FLAGS.VEL_X;
  if (changed.velY)    flags |= DELTA_FLAGS.VEL_Y;
  if (changed.velZ)    flags |= DELTA_FLAGS.VEL_Z;
  if (changed.health)  flags |= DELTA_FLAGS.HEALTH;
  if (changed.stamina) flags |= DELTA_FLAGS.STAMINA;
  if (changed.flags)   flags |= DELTA_FLAGS.FLAGS;

  // Count set bits to determine payload size
  const fieldCount = Object.values(changed).filter(Boolean).length;
  const buf  = new ArrayBuffer(2 + fieldCount * 4);
  const view = new DataView(buf);
  let offset = 0;

  view.setUint16(offset, flags, true); offset += 2;

  if (changed.posX)    { view.setInt32(offset,  Math.round(next.position.x * 1000), true); offset += 4; }
  if (changed.posY)    { view.setInt32(offset,  Math.round(next.position.y * 1000), true); offset += 4; }
  if (changed.posZ)    { view.setInt32(offset,  Math.round(next.position.z * 1000), true); offset += 4; }
  if (changed.velX)    { view.setInt16(offset,  Math.round(next.velocity.x * 100),  true); offset += 2; }
  if (changed.velY)    { view.setInt16(offset,  Math.round(next.velocity.y * 100),  true); offset += 2; }
  if (changed.velZ)    { view.setInt16(offset,  Math.round(next.velocity.z * 100),  true); offset += 2; }
  if (changed.health)  { view.setUint16(offset, Math.round(next.health  * 100),     true); offset += 2; }
  if (changed.stamina) { view.setUint16(offset, Math.round(next.stamina * 100),     true); offset += 2; }
  if (changed.flags)   { view.setUint8(offset,  next.onGround ? 1 : 0);                    offset += 1; }

  return buf;
}

/**
 * Decode a delta message back into a CharState by patching prev.
 */
export function decodeDelta(prev: CharState, buf: ArrayBuffer, seq: number): CharState {
  const view   = new DataView(buf);
  const flags  = view.getUint16(0, true);
  let   offset = 2;

  const next: CharState = {
    seq,
    position: { ...prev.position },
    velocity: { ...prev.velocity },
    onGround: prev.onGround,
    health:   prev.health,
    stamina:  prev.stamina,
  };

  if (flags & DELTA_FLAGS.POS_X)    { next.position.x = view.getInt32(offset,  true) / 1000; offset += 4; }
  if (flags & DELTA_FLAGS.POS_Y)    { next.position.y = view.getInt32(offset,  true) / 1000; offset += 4; }
  if (flags & DELTA_FLAGS.POS_Z)    { next.position.z = view.getInt32(offset,  true) / 1000; offset += 4; }
  if (flags & DELTA_FLAGS.VEL_X)    { next.velocity.x = view.getInt16(offset,  true) / 100;  offset += 2; }
  if (flags & DELTA_FLAGS.VEL_Y)    { next.velocity.y = view.getInt16(offset,  true) / 100;  offset += 2; }
  if (flags & DELTA_FLAGS.VEL_Z)    { next.velocity.z = view.getInt16(offset,  true) / 100;  offset += 2; }
  if (flags & DELTA_FLAGS.HEALTH)   { next.health      = view.getUint16(offset, true) / 100;  offset += 2; }
  if (flags & DELTA_FLAGS.STAMINA)  { next.stamina     = view.getUint16(offset, true) / 100;  offset += 2; }
  if (flags & DELTA_FLAGS.FLAGS)    { next.onGround    = view.getUint8(offset) === 1;           offset += 1; }

  return next;
}

// ── Client-side prediction + server reconciliation ────────────────────────────

/**
 * Physics simulation step for reconciliation.
 * Must exactly match server-side physics so that re-simulations converge.
 * Replace the body of this function with the actual Rapier KCC logic.
 */
export type PhysicsSimFn = (state: CharState, input: InputFrame) => CharState;

/**
 * ReconciliationBuffer: maintains a ring buffer of (input, predicted state)
 * pairs. When the server acknowledges a sequence number, all older inputs are
 * pruned and the client re-simulates from the server state using any
 * unacknowledged inputs.
 *
 * Usage:
 * ```ts
 * const recon = new ReconciliationBuffer(simulateFn);
 * // Each frame:
 * const newState = recon.predict(currentState, inputThisFrame);
 * // When server message arrives:
 * const corrected = recon.reconcile(serverMsg);
 * ```
 */
export class ReconciliationBuffer {
  private history: Array<{ input: InputFrame; state: CharState }> = [];
  private maxHistory = 128; // ~2 seconds at 60 fps
  private simFn: PhysicsSimFn;
  // H1+ — highest server sequence we've reconciled against, + the last
  // reconciled state. Used to DROP stale / out-of-order server snapshots: under
  // jitter a packet #4 can arrive before #3, and re-applying the older
  // authoritative state after inputs were already pruned would rubber-band the
  // player backward (into a wall). Server snapshots only ever move forward.
  private lastServerSeq = -1;
  private lastReconciled: CharState | null = null;

  constructor(simFn: PhysicsSimFn) {
    this.simFn = simFn;
  }

  /**
   * Apply the input locally (client prediction) and store in history.
   * Returns the predicted new state.
   */
  predict(currentState: CharState, input: InputFrame): CharState {
    const predicted = this.simFn(currentState, input);
    predicted.seq   = input.seq;

    this.history.push({ input, state: predicted });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    return predicted;
  }

  /**
   * Process a server authoritative state.
   * Discards acknowledged inputs, re-simulates from server state
   * using all remaining unacknowledged inputs.
   *
   * Returns the re-simulated state (use this as the new authoritative client state).
   */
  reconcile(serverMsg: ServerStateMsg): CharState {
    // Drop stale / duplicate server snapshots (out-of-order arrival under
    // jitter). Acks only move forward; an older one re-applied after newer
    // inputs were pruned would rubber-band the player. Keep our latest state.
    if (serverMsg.seq <= this.lastServerSeq) {
      return this.lastReconciled ?? { ...serverMsg.state };
    }
    this.lastServerSeq = serverMsg.seq;

    // Prune inputs already acknowledged by the server
    this.history = this.history.filter((h) => h.input.seq > serverMsg.seq);

    // Re-simulate from the server state
    let state = { ...serverMsg.state };
    for (const { input } of this.history) {
      state = this.simFn(state, input);
      state.seq = input.seq;
    }

    this.lastReconciled = state;
    return state;
  }

  /**
   * Smoothly blend between the client prediction and reconciled state
   * to avoid visible teleportation. Call only when the position error
   * exceeds a threshold.
   *
   * @param clientPos    Current client-predicted position.
   * @param serverPos    Reconciled server position.
   * @param blendFrames  Frames over which to blend (typically 3–5).
   */
  static blendPositions(clientPos: Vec3, serverPos: Vec3, t: number): Vec3 {
    return {
      x: clientPos.x + (serverPos.x - clientPos.x) * t,
      y: clientPos.y + (serverPos.y - clientPos.y) * t,
      z: clientPos.z + (serverPos.z - clientPos.z) * t,
    };
  }

  /** Maximum position error before reconciliation snaps rather than blends. */
  static SNAP_THRESHOLD = 5.0; // 5 world units

  clearHistory(): void {
    this.history = [];
    // Reset the ack watermark too — after a respawn/teleport the next server
    // snapshot is authoritative even if its seq is lower than the old stream.
    this.lastServerSeq = -1;
    this.lastReconciled = null;
  }
}

// ── NPC interpolation ─────────────────────────────────────────────────────────

/**
 * Snapshot interpolation for remote entities (NPCs, other players).
 * Stores the two most recent snapshots and interpolates between them
 * at a render time slightly behind the receive time to absorb jitter.
 *
 * Reference: Valve's Source Engine networking model.
 */
export interface Snapshot {
  serverTime: number;
  position:   Vec3;
  rotation:   number; // yaw only
  health:     number;
}

export class SnapshotInterpolator {
  private snapshots: Snapshot[] = [];
  private interpolationDelay: number; // seconds behind real server time

  constructor(interpolationDelay = 0.1) {
    this.interpolationDelay = interpolationDelay;
  }

  addSnapshot(snap: Snapshot): void {
    this.snapshots.push(snap);
    // Keep last 16 snapshots (covers ~1.6s at 10 Hz server tick)
    if (this.snapshots.length > 16) this.snapshots.shift();
  }

  /**
   * Interpolate entity state at render time.
   *
   * @param serverTime  Current estimated server time.
   * Returns the interpolated position/rotation, or null if not enough data.
   */
  interpolate(serverTime: number): { position: Vec3; rotation: number; health: number } | null {
    const renderTime = serverTime - this.interpolationDelay;

    // Find the two snapshots that bracket renderTime
    let older: Snapshot | null = null;
    let newer: Snapshot | null = null;

    for (let i = 0; i < this.snapshots.length - 1; i++) {
      if (this.snapshots[i].serverTime <= renderTime &&
          this.snapshots[i + 1].serverTime >= renderTime) {
        older = this.snapshots[i];
        newer = this.snapshots[i + 1];
        break;
      }
    }

    if (!older || !newer) {
      // No bracket found — use most recent
      const last = this.snapshots[this.snapshots.length - 1];
      return last ? { position: last.position, rotation: last.rotation, health: last.health } : null;
    }

    const t = (renderTime - older.serverTime) / (newer.serverTime - older.serverTime);
    return {
      position: {
        x: older.position.x + (newer.position.x - older.position.x) * t,
        y: older.position.y + (newer.position.y - older.position.y) * t,
        z: older.position.z + (newer.position.z - older.position.z) * t,
      },
      // Lerp yaw (handle wrap-around)
      rotation: _lerpAngle(older.rotation, newer.rotation, t),
      health: older.health + (newer.health - older.health) * t,
    };
  }
}

function _lerpAngle(a: number, b: number, t: number): number {
  const diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + diff * t;
}

// ── Input sequence counter ────────────────────────────────────────────────────

/** Monotonically increasing input sequence generator. */
export class InputSequencer {
  private seq = 0;
  next(): number { return ++this.seq; }
  current(): number { return this.seq; }
}
