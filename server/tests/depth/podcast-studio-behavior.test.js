// tests/depth/podcast-studio-behavior.test.js — the Transcript Page backend.
// A creator fills in the show, uploads audio, publishes; the public RSS feed
// carries exactly the published, for-everyone, Concord-hosted episodes. A
// listener tips in CC and buys a supporter pass through the marketplace path,
// which unlocks supporters-only episodes at the media layer. Transcripts keep
// real times from caption files and never invent them. Adversarial: other
// people's shows, outside feeds, private addresses, garbage money, doubles.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load } from "./_harness.js";
import { setLedgerBalance } from "../lib/ledger-fund.js";
import { getBalance } from "../../economy/balances.js";
import { createMediaDTU, getMediaDTU } from "../../lib/media-dtu.js";
import { viewerMayStreamFull, pricedCreateOrCommercial } from "../../lib/media-preview-window.js";
import { __setPublicFetchTestTransport } from "../../lib/public-fetch.js";
import {
  buildShowFeed, feedReadiness, mountPodcastPublicRoutes, PREVIEW_SEC,
} from "../../domains/podcast-studio.js";
import { parseVtt, parseSrt, parsePodcastJson, parsePlain, parseTimestamp, toVtt } from "../../lib/podcast-transcript.js";

let STATE;
const run = (action, params, ctx) => lensRun("podcast", action, { params }, ctx);
const wallet = (id) => getBalance(STATE.db, id).balance;
const fund = (id, n) => setLedgerBalance(STATE.db, id, n);
const media = (id) => getMediaDTU(STATE, id).mediaDTU;
function upload(authorId, title, { mediaType = "audio", mimeType, duration = 600, fileSize = 4_800_000 } = {}) {
  const r = createMediaDTU(STATE, {
    authorId, title, mediaType, mimeType: mimeType || (mediaType === "audio" ? "audio/mpeg" : "image/png"),
    duration, fileSize, privacy: "private",
  });
  assert.equal(r.ok, true, r.error);
  return r.mediaDTU.id;
}
// Call the mounted public routes without a socket.
function publicRoutes() {
  const routes = new Map();
  mountPodcastPublicRoutes({ get: (path, fn) => routes.set(path, fn) });
  const call = (path, params) => {
    const out = { status: 200, headers: {}, type: null, body: null };
    const res = {
      status(n) { out.status = n; return res; },
      set(k, v) { out.headers[k] = v; return res; },
      type(t) { out.type = t; return res; },
      send(b) { out.body = b; return res; },
    };
    routes.get(path)({ params, protocol: "https", get: () => "concord.example" }, res);
    return out;
  };
  return call;
}

describe("transcript parsing keeps real times and invents none", () => {
  it("reads timestamps in every caption shape", () => {
    assert.equal(parseTimestamp("01:02:03.450"), 3723.45);
    assert.equal(parseTimestamp("02:03,5"), 123.5);
    assert.equal(parseTimestamp("63.25"), 63.25);
    assert.equal(parseTimestamp("00:61:00.000"), null);
    assert.equal(parseTimestamp("soon"), null);
  });

  it("parses WebVTT cues with speakers, tags stripped, sorted", () => {
    const r = parseVtt("WEBVTT\n\nNOTE made in Descript\n\n2\n00:00:04.500 --> 00:00:09.000\n<v Ada>Second <i>line</i> &amp; more\n\n1\n00:00:00.000 --> 00:00:04.500\n<v Ada>Hello there.\n");
    assert.equal(r.ok, true);
    assert.deepEqual(r.segments, [
      { startSec: 0, endSec: 4.5, text: "Hello there.", speaker: "Ada" },
      { startSec: 4.5, endSec: 9, text: "Second line & more", speaker: "Ada" },
    ]);
    assert.match(parseVtt("1\n00:00:01,000 --> 00:00:02,000\nhi").error, /must start with WEBVTT/);
    assert.match(parseVtt("WEBVTT\n\njust words").error, /no timed cues/);
  });

  it("parses SRT, and joins Podcasting 2.0 word-by-word JSON into sentences", () => {
    const srt = parseSrt("1\r\n00:00:01,200 --> 00:00:03,000\r\nFirst.\r\n\r\n2\r\n00:00:03,000 --> 00:00:05,000\r\nSecond.\r\n");
    assert.deepEqual(srt.segments.map((x) => [x.startSec, x.endSec, x.text]), [[1.2, 3, "First."], [3, 5, "Second."]]);
    const json = parsePodcastJson({ segments: [
      { startTime: 0, endTime: 0.4, body: "We", speaker: "Bo" },
      { startTime: 0.4, endTime: 0.9, body: "start." , speaker: "Bo" },
      { startTime: 1, endTime: 1.5, body: "Next", speaker: "Bo" },
    ] });
    assert.deepEqual(json.segments.map((x) => [x.startSec, x.endSec, x.text]), [[0, 0.9, "We start."], [1, 1.5, "Next"]]);
  });

  it("plain text stays untimed, and VTT out round-trips", () => {
    const p = parsePlain("One thing. Another thing!\n\nA new paragraph");
    assert.deepEqual(p.segments.map((x) => [x.startSec, x.text]), [[null, "One thing."], [null, "Another thing!"], [null, "A new paragraph"]]);
    const back = parseVtt(toVtt([{ startSec: 1.25, endSec: 3, text: "a --> b", speaker: "Cy" }, { startSec: 3, endSec: null, text: "end" }]));
    assert.deepEqual(back.segments, [{ startSec: 1.25, endSec: 3, text: "a → b", speaker: "Cy" }, { startSec: 3, endSec: 8, text: "end" }]);
  });
});

describe("podcast security", () => {
  let owner, other;
  before(async () => {
    ({ STATE } = await load());
    owner = await depthCtx("pc-sec-owner");
    other = await depthCtx("pc-sec-other");
  });

  it("only the show's owner adds episodes, sets transcripts, edits or deletes", async () => {
    const show = (await run("my-show-ensure", { title: "Owned" }, owner)).result.show;
    assert.match((await run("episode-add", { showId: show.id, title: "Sneaky" }, other)).result.error, /only the show's owner/);
    const ep = (await run("episode-add", { showId: show.id, title: "Real", durationSec: 60 }, owner)).result.episode;
    for (const [a, p] of [["transcript-set", { text: "vandal" }], ["episode-update", { title: "x" }], ["episode-delete", {}], ["episode-set-status", { status: "published" }]]) {
      const r = await run(a, { episodeId: ep.id, ...p }, other);
      assert.equal(r.result.ok, false, a);
    }
    const list = (await run("episode-list", { showId: show.id }, owner)).result.episodes;
    assert.deepEqual(list.map((e) => [e.title, e.status]), [["Real", "draft"]]);
  });

  it("an RSS episode (no maker) belongs to whoever added the show", async () => {
    const xml = `<rss><channel><title>F</title><item><title>Ep</title><guid>g</guid><enclosure url="https://cdn.example.com/e.mp3"/>
      <podcast:transcript url="https://cdn.example.com/e.txt" type="text/plain"/>
      <podcast:transcript url="https://cdn.example.com/e.vtt" type="text/vtt"/></item></channel></rss>`;
    __setPublicFetchTestTransport(async () => ({ ok: true, status: 200, text: async () => xml }));
    try {
      const show = (await run("show-add", { title: "Feed show", feedUrl: "https://feeds.example.com/f.xml" }, owner)).result.show;
      assert.equal((await run("rss-refresh", { showId: show.id }, owner)).ok, true);
      const ep = (await run("episode-list", { showId: show.id }, owner)).result.episodes[0];
      assert.equal(ep.feedTranscript, true);
      assert.equal(ep.transcriptSource, undefined);
      assert.match((await run("episode-delete", { episodeId: ep.id }, other)).result.error, /only the creator/);
      // Anyone may refresh from the stored feed; only the adder may repoint it.
      assert.equal((await run("rss-refresh", { showId: show.id }, other)).ok, true);
      assert.match((await run("rss-refresh", { showId: show.id, feedUrl: "https://evil.example.com/x.xml" }, other)).result.error, /only the person who added/);
    } finally { __setPublicFetchTestTransport(null); }
  });

  it("rss-refresh refuses private addresses and never refreshes a Concord-made show", async () => {
    for (const url of ["http://127.0.0.1:5050/api/admin", "http://169.254.169.254/latest/meta-data", "http://10.0.0.7/feed.xml"]) {
      const show = (await run("show-add", { title: `Inner ${url}`, feedUrl: url }, owner)).result.show;
      const r = await run("rss-refresh", { showId: show.id }, owner);
      assert.match(r.result.error, /not a public web address/, url);
    }
    const mine = (await run("my-show-ensure", {}, owner)).result.show;
    assert.match((await run("rss-refresh", { showId: mine.id, feedUrl: "https://feeds.example.com/x.xml" }, owner)).result.error, /published from Concord/);
  });
});

describe("transcripts on an episode", () => {
  let owner, listener, ep;
  before(async () => {
    ({ STATE } = await load());
    owner = await depthCtx("pc-tr-owner");
    listener = await depthCtx("pc-tr-listener");
    const show = (await run("my-show-ensure", { title: "Talk" }, owner)).result.show;
    ep = (await run("episode-add", { showId: show.id, title: "One", durationSec: 600, status: "published" }, owner)).result.episode;
  });

  it("a VTT file stores real times; plain text stores none", async () => {
    const vtt = await run("transcript-set", { episodeId: ep.id, vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nHi.\n\n00:00:03.000 --> 00:00:07.250\nWelcome." }, owner);
    assert.deepEqual([vtt.result.segmentCount, vtt.result.timing], [2, "timed"]);
    const got = (await run("transcript-get", { episodeId: ep.id }, listener)).result;
    assert.deepEqual(got.segments.map((x) => [x.startSec, x.endSec, x.text]), [[0, 3, "Hi."], [3, 7.25, "Welcome."]]);
    const plain = await run("transcript-set", { episodeId: ep.id, text: "First. Second." }, owner);
    assert.equal(plain.result.timing, "none");
    const after = (await run("transcript-get", { episodeId: ep.id }, listener)).result;
    assert.deepEqual(after.segments.map((x) => x.startSec), [null, null]);
    assert.equal(after.timing, "none");
  });

  it("refuses broken files and timed segments without times, keeping the old transcript", async () => {
    await run("transcript-set", { episodeId: ep.id, vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nKeep me." }, owner);
    assert.match((await run("transcript-set", { episodeId: ep.id, vtt: "not captions" }, owner)).result.error, /WEBVTT/);
    assert.match((await run("transcript-set", { episodeId: ep.id, srt: "nothing timed" }, owner)).result.error, /no timed cues/);
    assert.match((await run("transcript-set", { episodeId: ep.id, segments: [{ text: "no time" }] }, owner)).result.error, /startSec/);
    assert.match((await run("transcript-set", { episodeId: ep.id, text: "x", format: "docx" }, owner)).result.error, /format must be/);
    const got = (await run("transcript-get", { episodeId: ep.id }, owner)).result;
    assert.deepEqual(got.segments.map((x) => x.text), ["Keep me."]);
  });

  it("imports a feed's own timed transcript through the guarded fetch", async () => {
    const xml = `<rss><channel><title>F</title><item><title>Ep</title><guid>t</guid><enclosure url="https://cdn.example.com/t.mp3"/>
      <podcast:transcript url="https://cdn.example.com/t.srt" type="application/srt"/></item></channel></rss>`;
    const seen = [];
    __setPublicFetchTestTransport(async (url) => {
      seen.push(url);
      return url.endsWith(".srt")
        ? { ok: true, status: 200, text: async () => "1\n00:00:02,000 --> 00:00:04,500\nFrom the feed.\n" }
        : { ok: true, status: 200, text: async () => xml };
    });
    try {
      const show = (await run("show-add", { title: "Feed T", feedUrl: "https://feeds.example.com/t.xml" }, listener)).result.show;
      await run("rss-refresh", { showId: show.id }, listener);
      const fe = (await run("episode-list", { showId: show.id }, listener)).result.episodes[0];
      const r = await run("transcript-import", { episodeId: fe.id }, listener);
      assert.deepEqual([r.result.segmentCount, r.result.timing, r.result.source], [1, "timed", "feed"]);
      assert.deepEqual(seen.at(-1), "https://cdn.example.com/t.srt");
      const t = (await run("transcript-get", { episodeId: fe.id }, owner)).result;
      assert.deepEqual(t.segments.map((x) => [x.startSec, x.endSec, x.text]), [[2, 4.5, "From the feed."]]);
      assert.match((await run("transcript-import", { episodeId: ep.id }, listener)).result.error, /publishes no transcript/);
    } finally { __setPublicFetchTestTransport(null); }
  });
});

describe("the public feed", () => {
  let owner, show;
  before(async () => {
    ({ STATE } = await load());
    owner = await depthCtx("pc-feed-owner");
    show = (await run("my-show-ensure", { title: "Night & Day" }, owner)).result.show;
  });

  it("says what is missing, then validates the profile fields", async () => {
    const info = (await run("show-feed-info", { showId: show.id }, owner)).result;
    assert.equal(info.ready, false);
    assert.deepEqual(info.readiness.filter((x) => !x.ok).map((x) => x.id), ["author", "description", "category", "cover", "episode"]);
    for (const [k, v, re] of [["appleCategory", "Gaming", /appleCategory/], ["language", "english", /language/], ["explicit", "no", /explicit/], ["coverMediaId", upload("pc-feed-owner", "track"), /must be an image/], ["coverMediaId", upload("someone-else", "img", { mediaType: "image" }), /not found among your uploads/], ["title", "  ", /title required/]]) {
      const r = await run("show-update", { showId: show.id, [k]: v }, owner);
      assert.match(r.result.error, re, k);
    }
    const other = await depthCtx("pc-feed-stranger");
    assert.match((await run("show-update", { showId: show.id, title: "Mine now" }, other)).result.error, /only the show's creator/);
  });

  it("carries only published, for-everyone, Concord-hosted episodes, escaped, newest first", async () => {
    const cover = upload("pc-feed-owner", "cover", { mediaType: "image", mimeType: "image/jpeg" });
    const upd = await run("show-update", { showId: show.id, author: "Ada <Host>", description: "A show about night & day, told slowly.", appleCategory: "Science", language: "en-GB", explicit: false, coverMediaId: cover }, owner);
    assert.equal(upd.ok, true);
    const a1 = upload("pc-feed-owner", "ep1", { duration: 3725, fileSize: 1234567 });
    const a2 = upload("pc-feed-owner", "ep2");
    const pub = (await run("episode-add", { showId: show.id, title: "Dawn \"1\"", mediaId: a1, publishDate: "2026-03-01", status: "published", description: "Light <b>&</b> heat" }, owner)).result.episode;
    const pub2 = (await run("episode-add", { showId: show.id, title: "Dusk", mediaId: a2, publishDate: "2026-04-01", status: "published" }, owner)).result.episode;
    await run("episode-add", { showId: show.id, title: "Draft", mediaId: upload("pc-feed-owner", "d"), status: "draft" }, owner);
    await run("episode-add", { showId: show.id, title: "Outside audio", audioUrl: "https://cdn.example.com/o.mp3", status: "published" }, owner);
    await run("transcript-set", { episodeId: pub.id, vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nDawn." }, owner);
    const s = STATE.podcastLens;
    const xml = buildShowFeed(s, s.shows.get(show.id), "https://concord.example");
    const titles = [...xml.matchAll(/<item>\s*<title>([^<]*)<\/title>/g)].map((m) => m[1]);
    assert.deepEqual(titles, ["Dusk", "Dawn &quot;1&quot;"]);
    assert.ok(xml.includes(`<enclosure url="https://concord.example/api/media/${a1}/stream" length="1234567" type="audio/mpeg"/>`));
    assert.ok(xml.includes("<itunes:duration>01:02:05</itunes:duration>"));
    assert.ok(xml.includes("<itunes:author>Ada &lt;Host&gt;</itunes:author>"));
    assert.ok(xml.includes(`<itunes:image href="https://concord.example/api/media/${cover}/stream"/>`));
    assert.ok(xml.includes('<itunes:category text="Science"/>') && xml.includes("<language>en-GB</language>"));
    assert.ok(xml.includes("<description>Light &lt;b&gt;&amp;&lt;/b&gt; heat</description>"));
    assert.ok(xml.includes(`<podcast:transcript url="https://concord.example/api/podcast/episodes/${pub.id}/transcript.vtt" type="text/vtt"/>`));
    assert.ok(!xml.includes(`episodes/${pub2.id}/transcript.vtt`));
    assert.equal(feedReadiness(s, s.shows.get(show.id)).every((x) => x.ok), true);
  });

  it("serves the feed and VTT publicly, and 404s what the feed does not carry", async () => {
    const call = publicRoutes();
    const feed = call("/api/podcast/shows/:id/feed.xml", { id: show.id });
    assert.equal(feed.status, 200);
    assert.match(feed.type, /application\/rss\+xml/);
    assert.match(feed.body, /<atom:link href="https:\/\/concord\.example\/api\/podcast\/shows\/[^"]+\/feed\.xml" rel="self"/);
    const listed = (await run("episode-list", { showId: show.id }, owner)).result.episodes;
    const dawn = listed.find((e) => e.title.startsWith("Dawn"));
    const vtt = call("/api/podcast/episodes/:id/transcript.vtt", { id: dawn.id });
    assert.equal(vtt.status, 200);
    assert.equal(vtt.body, "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nDawn.\n");
    const draft = listed.find((e) => e.title === "Draft");
    await run("transcript-set", { episodeId: draft.id, vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nSecret." }, owner);
    assert.equal(call("/api/podcast/episodes/:id/transcript.vtt", { id: draft.id }).status, 404);
    const rssShow = (await run("show-add", { title: "Listener-added" }, owner)).result.show;
    assert.equal(call("/api/podcast/shows/:id/feed.xml", { id: rssShow.id }).status, 404);
    assert.equal(call("/api/podcast/shows/:id/feed.xml", { id: "../../etc" }).status, 404);
  });
});

describe("tips and the supporter pass", () => {
  let creator, fan, other, show, open, locked;
  before(async () => {
    ({ STATE } = await load());
    creator = await depthCtx("pc-pay-creator");
    fan = await depthCtx("pc-pay-fan");
    other = await depthCtx("pc-pay-other");
    show = (await run("my-show-ensure", { title: "Paid Show" }, creator)).result.show;
    open = (await run("episode-add", { showId: show.id, title: "Open", mediaId: upload("pc-pay-creator", "open"), status: "published" }, creator)).result.episode;
    locked = (await run("episode-add", { showId: show.id, title: "Bonus", mediaId: upload("pc-pay-creator", "bonus"), status: "published" }, creator)).result.episode;
  });

  it("a tip moves exactly the tip from fan to creator and is recorded", async () => {
    fund("pc-pay-fan", 20); fund("pc-pay-creator", 0);
    const r = await run("show-tip", { showId: show.id, episodeId: open.id, amount: 2.5 }, fan);
    assert.equal(r.ok, true, r.error);
    // A tip is a ledger TRANSFER: the 1.46% transfer fee comes out of it.
    // 2.5 × (1 − 0.0146) = 2.4635 → 2.46 on the balance.
    assert.equal(wallet("pc-pay-fan"), 17.5);
    assert.equal(wallet("pc-pay-creator"), 2.46);
    assert.deepEqual([r.result.creatorGets, r.result.feeRate], [2.46, 0.0146]);
    const earn = (await run("show-earnings", { showId: show.id }, creator)).result;
    assert.deepEqual([earn.tips.count, earn.tips.total, earn.tips.recent[0].contentId], [1, 2.5, open.id]);
    assert.match((await run("show-earnings", { showId: show.id }, fan)).result.error, /only the show's creator/);
  });

  it("refuses bad tips and moves nothing", async () => {
    fund("pc-pay-fan", 3);
    const before = [wallet("pc-pay-fan"), wallet("pc-pay-creator")];
    const rssShow = (await run("show-add", { title: "Someone's feed" }, other)).result.show;
    for (const [p, ctx, re] of [
      [{ showId: show.id, amount: 0.3 }, fan, /0\.5 to 1000/],
      [{ showId: show.id, amount: 1001 }, fan, /0\.5 to 1000/],
      [{ showId: show.id, amount: true }, fan, /0\.5 to 1000/],
      [{ showId: show.id, amount: 1.234 }, fan, /in cents/],
      [{ showId: show.id, amount: 5 }, fan, /not enough Concord Coin/],
      [{ showId: show.id, amount: 1 }, creator, /your own show/],
      [{ showId: rssShow.id, amount: 1 }, fan, /outside feed/],
      [{ showId: show.id, episodeId: "ep_nope", amount: 1 }, fan, /episode not found/],
    ]) {
      const r = await run("show-tip", p, ctx);
      assert.match(r.result.error, re, JSON.stringify(p));
    }
    assert.deepEqual([wallet("pc-pay-fan"), wallet("pc-pay-creator")], before);
  });

  it("supporters-only needs a pass and Concord-hosted audio; only the creator sets it", async () => {
    assert.match((await run("episode-set-access", { episodeId: locked.id, access: "supporters" }, creator)).result.error, /supporter pass for the show first/);
    for (const [p, re] of [[{ priceCC: 0 }, /priceCC/], [{ priceCC: 501 }, /priceCC/], [{ priceCC: "4" }, /priceCC/], [{ priceCC: 2.345 }, /cents/]]) {
      assert.match((await run("supporter-pass-set", { showId: show.id, ...p }, creator)).result.error, re);
    }
    assert.match((await run("supporter-pass-set", { showId: show.id, priceCC: 4 }, fan)).result.error, /only the show's creator/);
    const set = await run("supporter-pass-set", { showId: show.id, priceCC: 4, perks: "Bonus episodes, early." }, creator);
    assert.deepEqual([set.result.hasPass, set.result.priceCC, set.result.supporterCount], [true, 4, 0]);
    const outside = (await run("episode-add", { showId: show.id, title: "External", audioUrl: "https://cdn.example.com/x.mp3", status: "published" }, creator)).result.episode;
    assert.match((await run("episode-set-access", { episodeId: outside.id, access: "supporters" }, creator)).result.error, /uploaded to Concord/);
    assert.match((await run("episode-set-access", { episodeId: locked.id, access: "supporters" }, fan)).result.error, /only the show's creator/);
    assert.match((await run("episode-set-access", { episodeId: locked.id, access: "vip" }, creator)).result.error, /everyone or supporters/);
    assert.equal((await run("episode-set-access", { episodeId: locked.id, access: "supporters" }, creator)).result.access, "supporters");
    // The audio itself is gated at the media layer, not just in the listing.
    assert.equal(pricedCreateOrCommercial(media(locked.mediaId)), true);
    assert.equal(viewerMayStreamFull(STATE, media(locked.mediaId), "pc-pay-fan"), false);
    assert.equal(viewerMayStreamFull(STATE, media(locked.mediaId), "pc-pay-creator"), true);
    const view = (await run("episode-list", { showId: show.id }, fan)).result.episodes.find((e) => e.id === locked.id);
    assert.deepEqual([view.access, view.locked, view.previewSec], ["supporters", true, PREVIEW_SEC]);
    // Nor is it in the public feed.
    assert.ok(!buildShowFeed(STATE.podcastLens, STATE.podcastLens.shows.get(show.id), "https://x.example").includes("Bonus"));
  });

  it("a locked listener reads only the preview of the transcript", async () => {
    await run("transcript-set", { episodeId: locked.id, vtt: "WEBVTT\n\n00:00:10.000 --> 00:00:20.000\nIn the preview.\n\n00:01:29.000 --> 00:01:40.000\nStill in.\n\n00:01:31.000 --> 00:01:50.000\nSupporters only." }, creator);
    const t = (await run("transcript-get", { episodeId: locked.id }, fan)).result;
    assert.deepEqual([t.locked, t.totalSegments, t.segments.map((x) => x.text)], [true, 3, ["In the preview.", "Still in."]]);
    assert.equal((await run("transcript-search", { episodeId: locked.id, query: "supporters" }, fan)).result.count, 0);
  });

  it("buying the pass pays through the marketplace and unlocks every supporters-only episode", async () => {
    fund("pc-pay-fan", 3);
    const poor = await run("supporter-pass-buy", { showId: show.id }, fan);
    assert.match(poor.result.error, /not enough Concord Coin: the pass is 4 CC and you have 3 CC/);
    assert.equal(wallet("pc-pay-fan"), 3);
    fund("pc-pay-fan", 10); fund("pc-pay-creator", 0);
    const r = await run("supporter-pass-buy", { showId: show.id }, fan);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.supporter, true);
    assert.equal(wallet("pc-pay-fan"), 6);
    // The creator's share is the marketplace split, with nothing above the price minted.
    const gained = wallet("pc-pay-creator");
    assert.ok(gained > 3.5 && gained <= 4, `creator gained ${gained}`);
    assert.equal(viewerMayStreamFull(STATE, media(locked.mediaId), "pc-pay-fan"), true);
    const t = (await run("transcript-get", { episodeId: locked.id }, fan)).result;
    assert.deepEqual([t.locked, t.segments.length], [false, 3]);
    assert.match((await run("supporter-pass-buy", { showId: show.id }, fan)).result.error, /already support/);
    assert.match((await run("supporter-pass-buy", { showId: show.id }, creator)).result.error, /your own show/);
    assert.equal((await run("supporter-status", { showId: show.id }, creator)).result.supporterCount, 1);
    assert.equal((await run("supporter-status", { showId: show.id }, other)).result.supporterCount, null);
  });

  it("an episode made supporters-only later is open to existing supporters at once", async () => {
    const later = (await run("episode-add", { showId: show.id, title: "Later bonus", mediaId: upload("pc-pay-creator", "later"), status: "published" }, creator)).result.episode;
    await run("episode-set-access", { episodeId: later.id, access: "supporters" }, creator);
    assert.equal(viewerMayStreamFull(STATE, media(later.mediaId), "pc-pay-fan"), true);
    assert.equal(viewerMayStreamFull(STATE, media(later.mediaId), "pc-pay-other"), false);
    // Back to everyone: the price tier is gone.
    await run("episode-set-access", { episodeId: later.id, access: "everyone" }, creator);
    assert.equal(pricedCreateOrCommercial(media(later.mediaId)), false);
  });
});

after(() => __setPublicFetchTestTransport(null));
