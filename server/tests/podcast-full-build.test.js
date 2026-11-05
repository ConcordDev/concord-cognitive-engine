// Full-build tests for the podcast lens (B3, queue takeover CB-0217).
// Slices under test, each priced by the Lead compilation (2026-11-03)
// on R4's full pass:
//   S3/D3 — show episode counts read the store the detail pages read:
//           a count may not claim an episode the viewer cannot open.
//   S4/D4 — show-add dedupe: re-adding a feed already in the caller's
//           library returns the existing show (one library store).
//   S5/D5 — episode-update: the lifecycle's edit verb, creator-only.
//   S2/D1 — the playback ledger the FE bridge writes: sync-push lands
//           positions + played in the one store every surface reads.

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
function listedShow(ctx, showId) {
  return call("show-list", ctx, {}).result.shows.find((s) => s.id === showId);
}

describe("S3 · show episode counts agree with the detail page", () => {
  it("another user's draft is not counted for a viewer who cannot open it", () => {
    const show = newShow();
    newEpisode(show.id, { status: "draft" });
    // The detail (episode-list) shows B nothing…
    assert.equal(call("episode-list", ctxB, { showId: show.id }).result.episodes.length, 0);
    // …so the catalogue count must not claim the episode either.
    assert.equal(listedShow(ctxB, show.id).episodeCount, 0);
    // The creator still counts (and sees) their own draft.
    assert.equal(listedShow(ctxA, show.id).episodeCount, 1);
    assert.equal(call("episode-list", ctxA, { showId: show.id }).result.episodes.length, 1);
  });

  it("a published episode counts for everyone", () => {
    const show = newShow();
    newEpisode(show.id, { status: "published" });
    assert.equal(listedShow(ctxB, show.id).episodeCount, 1);
    assert.equal(listedShow(ctxA, show.id).episodeCount, 1);
  });
});

describe("S4 · show-add returns the existing show for a feed already in the caller's library", () => {
  it("same user + same feedUrl dedupes; a different user gets their own copy", () => {
    const first = call("show-add", ctxA, { title: "99% Invisible", feedUrl: "https://feeds.example.com/99pi.xml" });
    assert.equal(first.result.created, true);
    const again = call("show-add", ctxA, { title: "99% Invisible (again)", feedUrl: "https://feeds.example.com/99pi.xml" });
    assert.equal(again.result.created, false);
    assert.equal(again.result.show.id, first.result.show.id);
    const mine = call("show-list", ctxA, {}).result.shows.filter((s) => s.feedUrl === "https://feeds.example.com/99pi.xml");
    assert.equal(mine.length, 1);

    const other = call("show-add", ctxB, { title: "99% Invisible", feedUrl: "https://feeds.example.com/99pi.xml" });
    assert.equal(other.result.created, true);
    assert.notEqual(other.result.show.id, first.result.show.id);
  });

  it("shows without a feedUrl never dedupe", () => {
    newShow(ctxA, { title: "Manual One" });
    newShow(ctxA, { title: "Manual One" });
    const titles = call("show-list", ctxA, {}).result.shows.filter((s) => s.title === "Manual One");
    assert.equal(titles.length, 2);
  });
});

describe("S5 · episode-update edits the text fields, creator-only", () => {
  it("the creator corrects title, description and numbers", () => {
    const show = newShow();
    const ep = newEpisode(show.id, { title: "Episde 1 (typo)", description: "draft notes" });
    const r = call("episode-update", ctxA, {
      episodeId: ep.id, title: "Episode 1", description: "Fixed description", seasonNumber: 2, episodeNumber: 7,
    });
    assert.equal(r.ok, true);
    const listed = call("episode-list", ctxA, { showId: show.id }).result.episodes[0];
    assert.equal(listed.title, "Episode 1");
    assert.equal(listed.description, "Fixed description");
    assert.equal(listed.seasonNumber, 2);
    assert.equal(listed.episodeNumber, 7);
  });

  it("a non-creator cannot edit, and an empty title is refused", () => {
    const show = newShow();
    const ep = newEpisode(show.id, {});
    assert.equal(call("episode-update", ctxB, { episodeId: ep.id, title: "Hijacked" }).ok, false);
    assert.equal(call("episode-update", ctxA, { episodeId: ep.id, title: "   " }).ok, false);
    assert.equal(call("episode-list", ctxA, { showId: show.id }).result.episodes[0].title, "Episode 1");
  });

  it("update never touches status, and a taken episode number resolves to the next free one", () => {
    const show = newShow();
    const ep1 = newEpisode(show.id, { title: "One", status: "draft" });
    const ep2 = newEpisode(show.id, { title: "Two", status: "draft" });
    assert.equal(ep1.episodeNumber, 1);
    assert.equal(ep2.episodeNumber, 2);
    const r = call("episode-update", ctxA, { episodeId: ep2.id, episodeNumber: 1, status: "published" });
    assert.equal(r.ok, true);
    assert.equal(r.result.episode.episodeNumber, 2);
    assert.equal(r.result.episode.status, "draft");
  });
});

describe("S2 · the playback ledger: sync-push writes what every surface reads", () => {
  it("a pushed position lands in continue-listening and the episode view", () => {
    const show = newShow();
    const ep = newEpisode(show.id, { status: "published", durationSec: 1000 });
    const push = call("sync-push", ctxA, {
      episodeId: ep.id, positionSec: 400, device: "desktop-test", reportedAt: "2026-11-05T10:00:00.000Z",
    });
    assert.equal(push.ok, true);
    const cont = call("continue-listening", ctxA, {}).result.episodes;
    assert.equal(cont.length, 1);
    assert.equal(cont[0].id, ep.id);
    assert.equal(cont[0].positionSec, 400);
  });

  it("playing to the end marks played and moves the derived play count, per distinct user", () => {
    const show = newShow();
    const ep = newEpisode(show.id, { status: "published", durationSec: 1000 });
    call("sync-push", ctxA, { episodeId: ep.id, positionSec: 990, device: "d", reportedAt: "2026-11-05T10:00:00.000Z" });
    let view = call("episode-list", ctxB, { showId: show.id }).result.episodes[0];
    assert.equal(view.playCount, 1);
    // The same user re-playing does not double count.
    call("sync-push", ctxA, { episodeId: ep.id, positionSec: 995, device: "d", reportedAt: "2026-11-05T11:00:00.000Z" });
    view = call("episode-list", ctxB, { showId: show.id }).result.episodes[0];
    assert.equal(view.playCount, 1);
    // A second distinct listener does.
    call("sync-push", ctxB, { episodeId: ep.id, positionSec: 1000, device: "d", reportedAt: "2026-11-05T12:00:00.000Z" });
    view = call("episode-list", ctxA, { showId: show.id }).result.episodes[0];
    assert.equal(view.playCount, 2);
    // listening-stats reads the same ledger.
    const stats = call("listening-stats", ctxA, {}).result;
    assert.equal(stats.episodesCompleted, 1);
  });
});
