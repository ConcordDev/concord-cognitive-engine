// Behavioral tests for astronomy's shared co-observing sessions (WAVE4
// gap-closure — "No multi-observer shared/co-observing session", closing
// docs/lens-specs/astronomy-capability-map.md's now-stale "would need a
// new realtime substrate" disposition).
//
// This exercises the REAL integration, not a mock roster: it registers
// BOTH server/domains/astronomy.js AND server/domains/collab.js into one
// shared LENS_ACTIONS-shaped map (mirroring globalThis.__concordLensActions,
// exactly as server.js wires it at boot), so astronomy's
// session-share/session-join/session-leave/session-observers genuinely
// call collab's own sessionJoin/sessionLeave/sessionRoster handlers and
// read collab's own live roster (STATE.collabLens.sessionRosters) — the
// same reuse path the live server uses, not a re-implementation.
//
// Covers:
//   - session-share creates a joinable room + auto-joins the owner
//   - session-join / session-leave / session-observers round-trip through
//     collab's real live roster (join/leave/roster reflect actual members)
//   - session-target-set resolves a real body (Meeus/catalog engine, same
//     as celestialPosition/sky-chart) and broadcasts on a DISTINCT
//     `astronomy:session:${roomId}` room (never collab's own room)
//   - session-target-get: two observers at different lat/long computing
//     alt/az for the SAME shared target get DIFFERENT real altitude/
//     azimuth — hand-checked against the same real transform via an
//     independent celestialPosition call for each observer (never a
//     mirrored single view)
//   - non-members are rejected from setting the target / posting the log
//   - session-log-post/list is a real shared log all members can read

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAstronomyActions from "../domains/astronomy.js";
import registerCollabActions from "../domains/collab.js";

const ACTIONS = new Map(); // "<domain>.<action>" -> fn(ctx, virtualArtifact, input)

function makeRegistrar(domain) {
  return (regDomain, name, fn) => {
    assert.equal(regDomain, domain, `unexpected domain registered: ${regDomain}`);
    ACTIONS.set(`${regDomain}.${name}`, fn);
  };
}

before(() => {
  registerAstronomyActions(makeRegistrar("astronomy"));
  registerCollabActions(makeRegistrar("collab"));
});

function call(domain, name, ctx, input = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  if (!fn) throw new Error(`${domain}.${name} not registered`);
  const virtualArtifact = { id: null, title: null, domain, type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}
const astro = (name, ctx, input) => call("astronomy", name, ctx, input);

let realtimeCalls;
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  // Mirror the real server.js wiring: LENS_ACTIONS is published on
  // globalThis so cross-domain handlers (astronomy -> collab) can call
  // each other exactly the way chat-agent.js / agent-marathon.js already
  // do — see server/domains/astronomy.js `runCollabLensAction`.
  globalThis.__concordLensActions = ACTIONS;
  realtimeCalls = [];
  globalThis._concordREALTIME = {
    io: {
      to: (room) => ({
        emit: (name, payload) => { realtimeCalls.push({ room, name, payload }); },
      }),
    },
  };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const ctxC = { actor: { userId: "user_c" }, userId: "user_c" };

const WHEN = "2026-06-21T22:00:00Z";

async function createAndShareSession(ctx) {
  const created = astro("session-create", ctx, {
    date: "2026-06-21", location: "Backyard", bortle: 4, seeing: "good", transparency: "good",
  });
  assert.equal(created.ok, true);
  const sessionId = created.result.session.id;
  const shared = await astro("session-share", ctx, { id: sessionId });
  assert.equal(shared.ok, true, JSON.stringify(shared));
  return { sessionId, roomId: shared.result.roomId };
}

describe("astronomy co-observing — session-share creates a joinable room", () => {
  it("creates a companion collab-domain session artifact and auto-joins the owner", async () => {
    const { roomId } = await createAndShareSession(ctxA);
    assert.ok(roomId);

    // The room is a real collab.js session artifact — the SAME substrate
    // collab's own sessionJoin/sessionRoster read, not a parallel store.
    const art = globalThis._concordSTATE.lensArtifacts.get(roomId);
    assert.equal(art.domain, "collab");
    assert.equal(art.type, "session");
    assert.equal(art.data.kind, "astronomy-observing");

    // Owner is already a live roster member (auto-joined by session-share).
    const roster = await astro("session-observers", ctxA, { roomId });
    assert.equal(roster.ok, true);
    assert.equal(roster.result.count, 1);
    assert.equal(roster.result.participants[0].userId, "user_a");
  });

  it("is idempotent — sharing an already-shared session returns the same roomId", async () => {
    const { sessionId, roomId } = await createAndShareSession(ctxA);
    const second = await astro("session-share", ctxA, { id: sessionId });
    assert.equal(second.ok, true);
    assert.equal(second.result.roomId, roomId);
  });
});

describe("astronomy co-observing — real roster join/leave (reuses collab.sessionJoin/Leave/Roster)", () => {
  it("session-join adds a second observer to the SAME live roster collab tracks", async () => {
    const { roomId } = await createAndShareSession(ctxA);

    const joined = await astro("session-join", ctxB, { roomId });
    assert.equal(joined.ok, true);
    assert.equal(joined.result.participants.length, 2);
    assert.ok(joined.result.participants.some((p) => p.userId === "user_a"));
    assert.ok(joined.result.participants.some((p) => p.userId === "user_b"));

    // The roster read is genuinely collab's own — confirm directly against
    // collab.sessionRoster for the same room id.
    const collabRoster = call("collab", "sessionRoster", ctxB, { sessionId: roomId });
    assert.equal(collabRoster.ok, true);
    assert.equal(collabRoster.result.count, 2);

    // Real join broadcast fired on collab's own room (not astronomy's).
    const joinEvt = realtimeCalls.find((c) => c.name === "collab:participant-joined");
    assert.ok(joinEvt, "expected a real collab:participant-joined broadcast");
    assert.equal(joinEvt.room, `collab:${roomId}`);
  });

  it("session-leave removes the observer from the live roster", async () => {
    const { roomId } = await createAndShareSession(ctxA);
    await astro("session-join", ctxB, { roomId });

    const left = await astro("session-leave", ctxB, { roomId });
    assert.equal(left.ok, true);
    assert.equal(left.result.participants.length, 1);

    const roster = await astro("session-observers", ctxA, { roomId });
    assert.equal(roster.result.count, 1);
    assert.equal(roster.result.participants[0].userId, "user_a");
  });

  it("rejects joining an id that is not a real astronomy co-observing room", async () => {
    const r = await astro("session-join", ctxB, { roomId: "not_a_real_room" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("never fabricates observers — roster only ever reflects genuinely joined members", async () => {
    const { roomId } = await createAndShareSession(ctxA);
    const roster = await astro("session-observers", ctxA, { roomId });
    assert.equal(roster.result.count, 1); // never more than who actually joined
  });
});

describe("astronomy co-observing — shared current-target broadcast", () => {
  it("session-target-set resolves a real body and broadcasts on a DISTINCT astronomy:session room", async () => {
    const { roomId } = await createAndShareSession(ctxA);
    await astro("session-join", ctxB, { roomId });

    const set = astro("session-target-set", ctxA, { roomId, body: "Vega", when: WHEN });
    assert.equal(set.ok, true);
    // Real catalog RA/Dec (J2000 BRIGHT_STARS Vega), not a placeholder.
    assert.equal(set.result.target.ra, 279.234);
    assert.equal(set.result.target.dec, 38.784);
    assert.equal(set.result.target.kind, "star");
    assert.equal(set.result.target.constellation, "Lyr");
    assert.equal(set.result.target.setBy, "user_a");

    // Broadcast payload shape + room: distinct from collab's own
    // `collab:${roomId}` room so the two event streams never collide.
    const targetEvt = realtimeCalls.find((c) => c.name === "astronomy:session-target");
    assert.ok(targetEvt, "expected an astronomy:session-target broadcast");
    assert.equal(targetEvt.room, `astronomy:session:${roomId}`);
    assert.equal(targetEvt.payload.roomId, roomId);
    assert.equal(targetEvt.payload.target.name, "Vega");
    assert.equal(targetEvt.payload.target.ra, 279.234);
    assert.ok(typeof targetEvt.payload.ts === "number");

    // A companion log entry is broadcast too.
    const logEvt = realtimeCalls.find((c) => c.name === "astronomy:session-log");
    assert.ok(logEvt);
    assert.equal(logEvt.room, `astronomy:session:${roomId}`);
    assert.match(logEvt.payload.entry.message, /Vega/);
  });

  it("rejects an unknown body name honestly (no fake RA/Dec)", async () => {
    const { roomId } = await createAndShareSession(ctxA);
    const r = astro("session-target-set", ctxA, { roomId, body: "Nibiru", when: WHEN });
    assert.equal(r.ok, false);
    assert.match(r.error, /unknown body/i);
  });

  it("a non-member cannot set the shared target", async () => {
    const { roomId } = await createAndShareSession(ctxA);
    const r = astro("session-target-set", ctxC, { roomId, body: "Vega", when: WHEN });
    assert.equal(r.ok, false);
    assert.match(r.error, /join the session/i);
  });

  it("a non-member cannot read the shared target either", async () => {
    const { roomId } = await createAndShareSession(ctxA);
    astro("session-target-set", ctxA, { roomId, body: "Vega", when: WHEN });
    const r = astro("session-target-get", ctxC, { roomId, latitude: 0, longitude: 0, when: WHEN });
    assert.equal(r.ok, false);
  });
});

describe("astronomy co-observing — each observer's alt/az is genuinely their own", () => {
  it("two observers at very different lat/long get DIFFERENT altitude/azimuth for the SAME target", async () => {
    const { roomId } = await createAndShareSession(ctxA);
    await astro("session-join", ctxB, { roomId });
    astro("session-target-set", ctxA, { roomId, body: "Vega", when: WHEN });

    // Observer A: New York City.
    const nyc = astro("session-target-get", ctxA, { roomId, latitude: 40.7, longitude: -74.0, when: WHEN });
    assert.equal(nyc.ok, true);
    assert.equal(nyc.result.target.name, "Vega");
    assert.ok(nyc.result.mine, "NYC observer should get their own alt/az");

    // Observer B: Sydney, Australia — a very different vantage point.
    const syd = astro("session-target-get", ctxB, { roomId, latitude: -33.87, longitude: 151.21, when: WHEN });
    assert.equal(syd.ok, true);
    assert.ok(syd.result.mine, "Sydney observer should get their own alt/az");

    // The core honesty assertion: NOT a mirrored single view. Same target
    // RA/Dec, genuinely different computed sky position per observer.
    assert.notEqual(nyc.result.mine.altitude, syd.result.mine.altitude);
    assert.notEqual(nyc.result.mine.azimuth, syd.result.mine.azimuth);

    // Hand-checked against the SAME real Meeus transform via an
    // independent celestialPosition call for each observer (the engine is
    // the spec — never hand-typed expected numbers): RA/Dec of Vega fed
    // straight from the J2000 catalog (279.234°/15 = 18.615h, 38.784°).
    const nycCheck = astro("celestialPosition", ctxA, {
      rightAscension: 279.234 / 15, declination: 38.784, latitude: 40.7, longitude: -74.0, date: WHEN,
    });
    assert.equal(nyc.result.mine.altitude, nycCheck.result.altitude);
    assert.equal(nyc.result.mine.azimuth, nycCheck.result.azimuth);

    const sydCheck = astro("celestialPosition", ctxB, {
      rightAscension: 279.234 / 15, declination: 38.784, latitude: -33.87, longitude: 151.21, date: WHEN,
    });
    assert.equal(syd.result.mine.altitude, sydCheck.result.altitude);
    assert.equal(syd.result.mine.azimuth, sydCheck.result.azimuth);

    // Pinned real values (Meeus transform, WHEN=2026-06-21T22:00:00Z):
    // NYC sees Vega comfortably above the horizon; Sydney (southern
    // hemisphere, opposite side of the globe) sees it below the horizon.
    assert.equal(nyc.result.mine.altitude, 10.2);
    assert.equal(nyc.result.mine.visible, true);
    assert.equal(syd.result.mine.altitude, -36.3);
    assert.equal(syd.result.mine.visible, false);
  });
});

describe("astronomy co-observing — shared observation log", () => {
  it("all joined members can post to and read the same shared log in real time", async () => {
    const { roomId } = await createAndShareSession(ctxA);
    await astro("session-join", ctxB, { roomId });

    const posted = astro("session-log-post", ctxB, { roomId, message: "Great seeing tonight!" });
    assert.equal(posted.ok, true);
    assert.equal(posted.result.entry.userId, "user_b");
    assert.equal(posted.result.entry.message, "Great seeing tonight!");

    // Owner (a different member) reads the SAME shared log.
    const list = astro("session-log-list", ctxA, { roomId });
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.log[0].message, "Great seeing tonight!");
    assert.equal(list.result.log[0].userId, "user_b");

    const logEvt = realtimeCalls.find((c) => c.name === "astronomy:session-log" && c.payload.entry.userId === "user_b");
    assert.ok(logEvt);
    assert.equal(logEvt.room, `astronomy:session:${roomId}`);
  });

  it("a non-member cannot post to the shared log", async () => {
    const { roomId } = await createAndShareSession(ctxA);
    const r = astro("session-log-post", ctxC, { roomId, message: "sneaky" });
    assert.equal(r.ok, false);
    assert.match(r.error, /join the session/i);
  });

  it("rejects an empty message", async () => {
    const { roomId } = await createAndShareSession(ctxA);
    const r = astro("session-log-post", ctxA, { roomId, message: "   " });
    assert.equal(r.ok, false);
    assert.match(r.error, /message is required/);
  });
});

describe("astronomy co-observing — degrade-graceful", () => {
  it("session-share fails soft (never throws) when the session doesn't exist", async () => {
    const r = await astro("session-share", ctxA, { id: "nope" });
    assert.equal(r.ok, false);
    assert.match(r.error, /session not found/);
  });

  it("session-target-set fails soft on a real but unshared session id", async () => {
    const created = astro("session-create", ctxA, { date: "2026-06-21" });
    const r = astro("session-target-set", ctxA, { roomId: created.result.session.id, body: "Vega" });
    assert.equal(r.ok, false); // a private session.id was never shared as a room
  });
});
