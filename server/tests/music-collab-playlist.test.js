/**
 * D8 — collaborative playlists are now actually collaborative. A playlist
 * created with { collaborative: true } can be edited by another user (the flag
 * was stored but never honored — playlist-add-track only searched the caller's
 * own list). A contributor's tracks resolve in detail, and the shared playlist
 * surfaces in the contributor's playlist-list.
 *
 * Run: node --test tests/music-collab-playlist.test.js
 */

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMusicActions from "../domains/music.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`music.${name}`);
  assert.ok(fn, `music.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => registerMusicActions(register));
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

function addTrack(ctx, title) {
  return call("track-add", ctx, { title, artist: "Artist", genre: "pop", durationSec: 180 }).result.track;
}

describe("D8 — collaborative playlist editing", () => {
  it("a non-owner CANNOT edit a non-collaborative playlist", () => {
    const pl = call("playlist-create", ctxA, { name: "Private", collaborative: false }).result.playlist;
    const t = addTrack(ctxB, "B Song");
    const r = call("playlist-add-track", ctxB, { playlistId: pl.id, trackId: t.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "playlist not found");
  });

  it("a non-owner CAN add their track to a collaborative playlist", () => {
    const pl = call("playlist-create", ctxA, { name: "Shared", collaborative: true }).result.playlist;
    const tB = addTrack(ctxB, "B Song");
    const r = call("playlist-add-track", ctxB, { playlistId: pl.id, trackId: tB.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.collaborative, true);
    assert.equal(r.result.ownerId, "user_a");
    assert.equal(r.result.trackCount, 1);
  });

  it("the contributor must hold the track in their own library", () => {
    const pl = call("playlist-create", ctxA, { name: "Shared", collaborative: true }).result.playlist;
    const r = call("playlist-add-track", ctxB, { playlistId: pl.id, trackId: "ghost" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "track not found");
  });

  it("the owner sees the collaborator's track resolved in detail", () => {
    const pl = call("playlist-create", ctxA, { name: "Shared", collaborative: true }).result.playlist;
    const tB = addTrack(ctxB, "B Exclusive");
    call("playlist-add-track", ctxB, { playlistId: pl.id, trackId: tB.id });
    // owner opens detail — B's track (not in A's library) still resolves
    const d = call("playlist-detail", ctxA, { id: pl.id });
    assert.equal(d.ok, true);
    assert.equal(d.result.tracks.length, 1);
    assert.equal(d.result.tracks[0].title, "B Exclusive");
  });

  it("the shared playlist surfaces in the contributor's playlist-list", () => {
    const pl = call("playlist-create", ctxA, { name: "Shared", collaborative: true }).result.playlist;
    const tB = addTrack(ctxB, "B Song");
    call("playlist-add-track", ctxB, { playlistId: pl.id, trackId: tB.id });
    const listB = call("playlist-list", ctxB, {}).result.playlists;
    const shared = listB.find((p) => p.id === pl.id);
    assert.ok(shared, "contributor sees the shared playlist");
    assert.equal(shared.sharedBy, "user_a");
  });

  it("a collaborator can open detail on a shared playlist they don't own", () => {
    const pl = call("playlist-create", ctxA, { name: "Shared", collaborative: true }).result.playlist;
    const d = call("playlist-detail", ctxB, { id: pl.id });
    assert.equal(d.ok, true); // collaborative → viewable by others
  });
});
