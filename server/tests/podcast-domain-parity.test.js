// Contract tests for the podcast Spotify / Apple Podcasts 2026-parity
// macros (shows, episodes, playback, queue, downloads, playlists,
// reviews, stats). iTunes + compute macros covered elsewhere.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPodcastActions from "../domains/podcast.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`podcast.${name}`);
  assert.ok(fn, `podcast.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPodcastActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newShow(ctx = ctxA, over = {}) {
  return call("show-add", ctx, { title: "The Daily", author: "NYT", category: "news", ...over }).result.show;
}
function newEpisode(showId, over = {}) {
  return call("episode-add", ctxA, { showId, title: "Episode 1", durationSec: 1800, publishDate: "2026-05-10", ...over }).result.episode;
}

describe("podcast.show-* directory", () => {
  it("add requires a title; directory is shared", () => {
    assert.equal(call("show-add", ctxA, {}).ok, false);
    newShow();
    assert.equal(call("show-list", ctxB, {}).result.count, 1);
  });

  it("subscribe toggles per user", () => {
    const show = newShow();
    assert.equal(call("show-subscribe", ctxA, { id: show.id }).result.subscribed, true);
    assert.equal(call("show-list", ctxA, { subscribed: true }).result.count, 1);
    assert.equal(call("show-list", ctxB, { subscribed: true }).result.count, 0);
    assert.equal(call("show-subscribe", ctxA, { id: show.id }).result.subscribed, false);
  });

  it("only the contributor can delete a show", () => {
    const show = newShow(ctxA);
    assert.equal(call("show-delete", ctxB, { id: show.id }).ok, false);
    assert.equal(call("show-delete", ctxA, { id: show.id }).ok, true);
  });
});

describe("podcast.episode + playback", () => {
  it("episode list sorts newest first", () => {
    const show = newShow();
    newEpisode(show.id, { title: "Old", publishDate: "2026-04-01" });
    newEpisode(show.id, { title: "New", publishDate: "2026-05-20" });
    const list = call("episode-list", ctxA, { showId: show.id });
    assert.equal(list.result.episodes[0].title, "New");
  });

  it("playback-update marks played near the end", () => {
    const show = newShow();
    const ep = newEpisode(show.id, { durationSec: 1000 });
    const mid = call("playback-update", ctxA, { episodeId: ep.id, positionSec: 400 });
    assert.equal(mid.result.played, false);
    const end = call("playback-update", ctxA, { episodeId: ep.id, positionSec: 990 });
    assert.equal(end.result.played, true);
  });

  it("continue-listening surfaces in-progress episodes", () => {
    const show = newShow();
    const ep = newEpisode(show.id, { durationSec: 1000 });
    call("playback-update", ctxA, { episodeId: ep.id, positionSec: 300 });
    const cl = call("continue-listening", ctxA, {});
    assert.equal(cl.result.count, 1);
    assert.equal(cl.result.episodes[0].progressPct, 30);
  });

  it("playback speed snaps and clamps", () => {
    assert.equal(call("playback-speed-set", ctxA, { speed: 1.53 }).result.playbackSpeed, 1.55);
    assert.equal(call("playback-speed-set", ctxA, { speed: 9 }).result.playbackSpeed, 3.5);
  });
});

describe("podcast.queue + downloads", () => {
  it("queue add, reorder and remove", () => {
    const show = newShow();
    const e1 = newEpisode(show.id, { title: "A" });
    const e2 = newEpisode(show.id, { title: "B" });
    call("queue-add", ctxA, { episodeId: e1.id });
    call("queue-add", ctxA, { episodeId: e2.id });
    assert.equal(call("queue-list", ctxA, {}).result.count, 2);
    call("queue-reorder", ctxA, { episodeId: e2.id, direction: "up" });
    assert.equal(call("queue-list", ctxA, {}).result.episodes[0].id, e2.id);
    call("queue-remove", ctxA, { episodeId: e1.id });
    assert.equal(call("queue-list", ctxA, {}).result.count, 1);
  });

  it("downloads add + list + remove", () => {
    const show = newShow();
    const ep = newEpisode(show.id, { durationSec: 600 });
    call("download-episode", ctxA, { episodeId: ep.id });
    const dl = call("download-list", ctxA, {});
    assert.equal(dl.result.count, 1);
    assert.equal(dl.result.totalSec, 600);
    call("download-remove", ctxA, { episodeId: ep.id });
    assert.equal(call("download-list", ctxA, {}).result.count, 0);
  });
});

describe("podcast.playlist-*", () => {
  it("create, add episodes, detail", () => {
    const show = newShow();
    const e1 = newEpisode(show.id);
    const pl = call("playlist-create", ctxA, { name: "Commute" }).result.playlist;
    call("playlist-add-episode", ctxA, { playlistId: pl.id, episodeId: e1.id });
    assert.equal(call("playlist-detail", ctxA, { id: pl.id }).result.episodes.length, 1);
    assert.equal(call("playlist-list", ctxB, {}).result.count, 0);
  });
});

describe("podcast.reviews + stats", () => {
  it("rate updates a single review per user; average computed", () => {
    const show = newShow();
    call("show-rate", ctxA, { showId: show.id, rating: 5, text: "Great" });
    call("show-rate", ctxB, { showId: show.id, rating: 3 });
    assert.equal(call("show-reviews", ctxA, { showId: show.id }).result.averageRating, 4);
    call("show-rate", ctxA, { showId: show.id, rating: 1 });
    assert.equal(call("show-reviews", ctxA, { showId: show.id }).result.averageRating, 2);
    assert.equal(call("show-rate", ctxA, { showId: show.id, rating: 9 }).ok, false);
  });

  it("new-episodes only lists unplayed from subscriptions", () => {
    const show = newShow();
    call("show-subscribe", ctxA, { id: show.id });
    const e1 = newEpisode(show.id, { title: "Fresh" });
    const e2 = newEpisode(show.id, { title: "Heard" });
    call("episode-mark-played", ctxA, { episodeId: e2.id });
    const ne = call("new-episodes", ctxA, {});
    assert.equal(ne.result.count, 1);
    assert.equal(ne.result.episodes[0].id, e1.id);
  });

  it("listening-stats and dashboard aggregate", () => {
    const show = newShow();
    call("show-subscribe", ctxA, { id: show.id });
    const ep = newEpisode(show.id, { durationSec: 3600 });
    call("playback-update", ctxA, { episodeId: ep.id, positionSec: 1800 });
    const stats = call("listening-stats", ctxA, {});
    assert.equal(stats.result.listenedSec, 1800);
    assert.equal(stats.result.episodesStarted, 1);
    const d = call("podcast-dashboard", ctxA, {});
    assert.equal(d.result.subscriptions, 1);
    assert.equal(d.result.inProgress, 1);
  });
});
