// H1+ — netcode "chaos monkey". Drives the ReconciliationBuffer under jitter,
// packet loss, and out-of-order delivery and asserts the client converges to the
// server-authoritative position WITHOUT rubber-banding. Pure logic, offline.
//
// The simFn is deterministic (position += forward*delta*speed) so the server and
// client agree given the same inputs — the only variable is HOW the server acks
// arrive. A correct buffer must: prune acknowledged inputs, replay the rest, and
// IGNORE stale/out-of-order acks (else an old ack rubber-bands the player back).

import { describe, it, expect } from 'vitest';
import { ReconciliationBuffer, type CharState, type InputFrame, type ServerStateMsg } from '@/lib/concordia/netcode';

const SPEED = 10;
const sim = (s: CharState, i: InputFrame): CharState => ({
  ...s,
  position: { x: s.position.x + i.forward * i.delta * SPEED, y: s.position.y, z: s.position.z },
});

function blankState(seq = 0): CharState {
  return { seq, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, onGround: true, health: 100, stamina: 100 };
}
function input(seq: number): InputFrame {
  return { seq, delta: 0.1, forward: 1, strafe: 0, jump: false, sprint: false, yaw: 0 };
}

// The server runs the SAME deterministic sim from origin → authoritative state
// per processed seq. (Moving forward 1 unit/ack: x = seq * forward*delta*SPEED.)
function authoritativeAt(seq: number): ServerStateMsg {
  let s = blankState(0);
  for (let i = 1; i <= seq; i++) s = sim(s, input(i));
  s.seq = seq;
  return { seq, state: s, tick: seq };
}

const TOL = 1e-9;

describe('ReconciliationBuffer under network chaos', () => {
  function freshClient(n: number) {
    const buf = new ReconciliationBuffer(sim);
    let state = blankState(0);
    for (let i = 1; i <= n; i++) state = buf.predict(state, input(i)); // client predicts ahead
    return { buf, predictedFinalX: state.position.x };
  }

  it('clean in-order acks converge to the predicted position (no drift)', () => {
    const { buf, predictedFinalX } = freshClient(5);
    for (let seq = 1; seq <= 5; seq++) {
      const r = buf.reconcile(authoritativeAt(seq));
      // Reconciled = server@seq + replay of inputs (seq+1..5) = the true position.
      expect(r.position.x).toBeCloseTo(authoritativeAt(5).state.position.x, 9);
    }
    expect(predictedFinalX).toBeCloseTo(authoritativeAt(5).state.position.x, 9);
  });

  it('packet loss (dropped acks) — a later higher-seq ack still converges', () => {
    const { buf } = freshClient(6);
    // Server acks 1 and 2 are LOST; only ack 4 arrives, then 6.
    const r4 = buf.reconcile(authoritativeAt(4));
    expect(r4.position.x).toBeCloseTo(authoritativeAt(6).state.position.x, 9); // 4 + replay 5,6
    const r6 = buf.reconcile(authoritativeAt(6));
    expect(r6.position.x).toBeCloseTo(authoritativeAt(6).state.position.x, 9);
  });

  it('out-of-order: a STALE ack arriving after a newer one is ignored (no rubber-band)', () => {
    const { buf } = freshClient(5);
    const newer = buf.reconcile(authoritativeAt(4));      // ack 4 first
    const truth = authoritativeAt(5).state.position.x;
    expect(newer.position.x).toBeCloseTo(truth, 9);

    // Now a delayed ack 2 arrives. Naively this would re-sim from server@2 with
    // inputs 3,4 already pruned → lose them → snap backward. The guard drops it.
    const stale = buf.reconcile(authoritativeAt(2));
    expect(stale.position.x).toBeCloseTo(truth, 9); // unchanged — no rubber-band
  });

  it('a jittery shuffled stream still ends at the authoritative final position', () => {
    const { buf } = freshClient(8);
    // Deliver acks 1..8 badly out of order (and a couple duplicated).
    const order = [3, 1, 2, 5, 4, 4, 8, 6, 2, 7, 8];
    let last = blankState(0);
    for (const seq of order) last = buf.reconcile(authoritativeAt(seq));
    // The highest ack seen is 8 (all inputs acked) → reconciled == server@8 exactly.
    expect(last.position.x).toBeCloseTo(authoritativeAt(8).state.position.x, 9);
    expect(Math.abs(last.position.x - authoritativeAt(8).state.position.x)).toBeLessThan(TOL);
  });

  it('clearHistory resets the ack watermark (post-respawn snapshot is authoritative)', () => {
    const { buf } = freshClient(4);
    buf.reconcile(authoritativeAt(4));
    buf.clearHistory();
    // After respawn the server stream restarts at a low seq — it must be honored.
    const r = buf.reconcile(authoritativeAt(1));
    expect(r.position.x).toBeCloseTo(authoritativeAt(1).state.position.x, 9);
  });
});
