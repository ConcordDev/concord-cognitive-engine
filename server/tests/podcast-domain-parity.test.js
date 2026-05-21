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

// ── Feature-parity backlog macros ──────────────────────────────────────

describe("podcast.rss-refresh", () => {
  it("rejects a show with no valid feedUrl", async () => {
    const show = newShow(ctxA, { feedUrl: null });
    const r = await call("rss-refresh", ctxA, { showId: show.id });
    assert.equal(r.ok, false);
  });

  it("ingests episodes from a real RSS XML payload", async () => {
    const show = newShow(ctxA, { feedUrl: "https://feeds.example.com/show.xml" });
    const xml = `<?xml version="1.0"?><rss><channel>
      <title>Demo</title><description>A feed</description>
      <item><title>Pilot</title><guid>g1</guid>
        <enclosure url="https://cdn.example.com/1.mp3" type="audio/mpeg"/>
        <itunes:duration>00:25:00</itunes:duration>
        <pubDate>Mon, 05 May 2026 09:00:00 GMT</pubDate>
        <psc:chapter start="00:00:00" title="Intro"/>
        <psc:chapter start="00:05:00" title="Main"/>
      </item>
      <item><title>Second</title><guid>g2</guid>
        <enclosure url="https://cdn.example.com/2.mp3" type="audio/mpeg"/>
        <itunes:duration>1800</itunes:duration>
        <pubDate>Tue, 12 May 2026 09:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => xml });
    try {
      const r = await call("rss-refresh", ctxA, { showId: show.id });
      assert.equal(r.ok, true);
      assert.equal(r.result.ingested, 2);
      const eps = call("episode-list", ctxA, { showId: show.id }).result.episodes;
      const pilot = eps.find((e) => e.title === "Pilot");
      assert.equal(pilot.durationSec, 1500);
      assert.equal(pilot.audioUrl, "https://cdn.example.com/1.mp3");
      assert.equal(pilot.chapters.length, 2);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("podcast.episode-stream", () => {
  it("requires an audio enclosure", () => {
    const show = newShow();
    const ep = newEpisode(show.id);
    assert.equal(call("episode-stream", ctxA, { episodeId: ep.id }).ok, false);
  });

  it("returns a stream descriptor with resume position and chapters", async () => {
    const show = newShow(ctxA, { feedUrl: "https://feeds.example.com/x.xml" });
    const xml = `<rss><channel><title>X</title>
      <item><title>Ep</title><guid>z1</guid>
        <enclosure url="https://cdn.example.com/z.mp3"/>
        <itunes:duration>600</itunes:duration>
        <psc:chapter start="0" title="Start"/>
      </item></channel></rss>`;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => xml });
    try {
      await call("rss-refresh", ctxA, { showId: show.id });
    } finally {
      globalThis.fetch = realFetch;
    }
    const ep = call("episode-list", ctxA, { showId: show.id }).result.episodes[0];
    call("playback-update", ctxA, { episodeId: ep.id, positionSec: 120 });
    const s = call("episode-stream", ctxA, { episodeId: ep.id });
    assert.equal(s.ok, true);
    assert.equal(s.result.audioUrl, "https://cdn.example.com/z.mp3");
    assert.equal(s.result.resumeSec, 120);
    assert.equal(s.result.chapters.length, 1);
  });
});

describe("podcast.playback-prefs", () => {
  it("sets and reads smart playback prefs with clamping", () => {
    const set = call("playback-prefs-set", ctxA, { trimSilence: true, skipIntroSec: 999, sleepTimerMin: 30 });
    assert.equal(set.result.trimSilence, true);
    assert.equal(set.result.skipIntroSec, 300);
    assert.equal(set.result.sleepTimerMin, 30);
    const got = call("playback-prefs-get", ctxA, {});
    assert.equal(got.result.skipIntroSec, 300);
    assert.ok(got.result.sleepTimerRemainingSec > 0);
  });
});

describe("podcast.transcript-*", () => {
  it("stores plain text as timestamped segments and searches them", () => {
    const show = newShow();
    const ep = newEpisode(show.id, { durationSec: 600 });
    assert.equal(call("transcript-get", ctxA, { episodeId: ep.id }).result.hasTranscript, false);
    const set = call("transcript-set", ctxA, {
      episodeId: ep.id,
      text: "Welcome to the show. Today we discuss space travel. Thanks for listening.",
    });
    assert.equal(set.ok, true);
    assert.equal(set.result.segmentCount, 3);
    const got = call("transcript-get", ctxA, { episodeId: ep.id });
    assert.equal(got.result.hasTranscript, true);
    assert.ok(got.result.segments[0].startSec >= 0);
    const search = call("transcript-search", ctxA, { episodeId: ep.id, query: "space" });
    assert.equal(search.result.count, 1);
    assert.match(search.result.matches[0].text, /space/);
  });
});

describe("podcast.recommendations", () => {
  it("scores unsubscribed shows by category affinity from history", () => {
    const news = newShow(ctxA, { title: "News A", category: "news" });
    const news2 = newShow(ctxA, { title: "News B", category: "news" });
    newShow(ctxA, { title: "Comedy", category: "comedy" });
    call("show-subscribe", ctxA, { id: news.id });
    const ep = newEpisode(news.id, { durationSec: 1000 });
    call("episode-mark-played", ctxA, { episodeId: ep.id });
    const r = call("recommendations", ctxA, {});
    assert.equal(r.ok, true);
    // News B should rank first — same category as the listening history.
    assert.equal(r.result.recommendations[0].id, news2.id);
    assert.match(r.result.recommendations[0].reason, /news/);
  });
});

describe("podcast.sync-*", () => {
  it("sync-push merges newer positions and sync-state resumes", () => {
    const show = newShow();
    const ep = newEpisode(show.id, { durationSec: 1000 });
    const push = call("sync-push", ctxA, {
      episodeId: ep.id, positionSec: 240, device: "phone", reportedAt: "2026-05-20T10:00:00.000Z",
    });
    assert.equal(push.result.merged, true);
    // An older report must not overwrite.
    const stale = call("sync-push", ctxA, {
      episodeId: ep.id, positionSec: 10, device: "tablet", reportedAt: "2026-05-19T10:00:00.000Z",
    });
    assert.equal(stale.result.merged, false);
    const state = call("sync-state", ctxA, {});
    assert.equal(state.result.nowResuming.episodeId, ep.id);
    assert.equal(state.result.nowResuming.positionSec, 240);
  });
});

describe("podcast.download-rule-*", () => {
  it("sets a rule then auto-downloads the newest episodes within the cap", () => {
    const show = newShow();
    newEpisode(show.id, { title: "E1", publishDate: "2026-05-01" });
    newEpisode(show.id, { title: "E2", publishDate: "2026-05-08" });
    newEpisode(show.id, { title: "E3", publishDate: "2026-05-15" });
    const ruleSet = call("download-rule-set", ctxA, { showId: show.id, autoDownload: true, keepRecent: 2 });
    assert.equal(ruleSet.result.rule.keepRecent, 2);
    assert.equal(call("download-rule-list", ctxA, {}).result.count, 1);
    const run = call("download-rule-run", ctxA, {});
    assert.equal(run.result.added, 2);
    assert.equal(call("download-list", ctxA, {}).result.count, 2);
  });
});
