// tests/depth/animation-lighttable-behavior.test.js — The Light Table's backend.
// A soundtrack is the animator's own uploaded audio and plays everywhere the
// animation does; a share link is unguessable, always playable, and carries
// exactly its soundtrack (and stops when revoked or deleted); the X-sheet
// lays drawings out over real film frames by exposure; and a rendered
// animation releases free or priced in CC through the shared release shop,
// with a preview that can never give the piece away.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load } from "./_harness.js";
import { setLedgerBalance } from "../lib/ledger-fund.js";
import { getBalance } from "../../economy/balances.js";
import { createMediaDTU, getMediaDTU, getMediaDTUForViewer, canAccessMediaDTU, mediaShareTokenOk } from "../../lib/media-dtu.js";
import { viewerMayStreamFull, pricedCreateOrCommercial } from "../../lib/media-preview-window.js";

let STATE;
const run = (a, p, ctx) => lensRun("animation", a, { params: p }, ctx);
const media = (id) => getMediaDTU(STATE, id).mediaDTU;
const wallet = (id) => getBalance(STATE.db, id).balance;
function upload(authorId, title, { mediaType = "audio", duration = 8 } = {}) {
  const mime = { audio: "audio/wav", video: "video/webm", image: "image/png" }[mediaType];
  const r = createMediaDTU(STATE, { authorId, title, mediaType, mimeType: mime, duration, privacy: "private" });
  assert.equal(r.ok, true, r.error);
  return r.mediaDTU.id;
}

describe("soundtrack and share", () => {
  let ana, bo, anim, track, token;
  before(async () => {
    ({ STATE } = await load());
    ana = await depthCtx("lt-ana"); bo = await depthCtx("lt-bo");
    anim = (await run("anim-create", { title: "Bounce", fps: 12 }, ana)).result.animation;
  });

  it("a soundtrack is your own uploaded audio, named from the upload, with its real length", async () => {
    const id = upload("lt-ana", "Boing take 3", { duration: 2.5 });
    const r = await run("audio-track-add", { animId: anim.id, mediaId: id, startSec: 0.5 }, ana);
    assert.equal(r.ok, true, r.error);
    track = r.result.track;
    assert.deepEqual([track.name, track.mediaId, track.durationSec, track.startSec, track.src], ["Boing take 3", id, 2.5, 0.5, `/api/media/${id}/stream`]);
    for (const [p, re] of [
      [{ mediaId: upload("lt-bo", "not hers") }, /not one of your uploads/],
      [{ mediaId: upload("lt-ana", "a clip", { mediaType: "video" }) }, /must be an audio file/],
      [{ name: "Silent" }, /upload the audio file/],
      [{ name: "Bad", url: "javascript:alert(1)" }, /upload the audio file/],
    ]) assert.match((await run("audio-track-add", { animId: anim.id, ...p }, ana)).result.error, re, JSON.stringify(p));
    assert.match((await run("audio-track-add", { animId: anim.id, mediaId: id }, bo)).result.error, /animation not found/);
    const list = (await run("audio-track-list", { animId: anim.id }, ana)).result.tracks;
    assert.equal(list.length, 1);
    assert.equal(list[0].src, `/api/media/${id}/stream`);
  });

  it("a share link is unguessable and carries its soundtrack, which strangers otherwise can't stream", async () => {
    const sh = (await run("share-create", { animId: anim.id, allowDownload: false }, ana)).result.share;
    token = sh.token;
    assert.match(token, /^shr_[0-9a-f]{32}$/);
    const got = (await run("share-get", { token }, bo)).result;
    assert.equal(got.share.allowDownload, false);
    assert.ok(got.animation.frames.length >= 1, "a no-download share still plays");
    assert.equal(got.animation.audio[0].src, `/api/media/${track.mediaId}/stream?share=${token}`);
    // at the media gate: the token opens exactly this file, for a signed-out viewer too
    assert.equal(canAccessMediaDTU(STATE, media(track.mediaId), null).allowed, false);
    assert.equal(getMediaDTUForViewer(STATE, track.mediaId, null, { shareToken: token }).ok, true);
    assert.equal(getMediaDTUForViewer(STATE, track.mediaId, null, { shareToken: "shr_" + "0".repeat(32) }).ok, false);
    const other = upload("lt-ana", "unrelated");
    assert.equal(getMediaDTUForViewer(STATE, other, null, { shareToken: token }).ok, false);
    // the same link reused: same token, still one grant
    assert.equal((await run("share-create", { animId: anim.id }, ana)).result.share.token, token);
    assert.deepEqual(media(track.mediaId).shareTokens, [token]);
  });

  it("removing the track, revoking the link, or deleting the shot takes the access away", async () => {
    // a track added after sharing joins the link
    const later = upload("lt-ana", "Whoosh");
    await run("audio-track-add", { animId: anim.id, mediaId: later }, ana);
    assert.equal(mediaShareTokenOk(media(later), token), true);
    const tid = (await run("audio-track-list", { animId: anim.id }, ana)).result.tracks.find((t) => t.mediaId === later).id;
    await run("audio-track-remove", { animId: anim.id, id: tid }, ana);
    assert.equal(mediaShareTokenOk(media(later), token), false);
    // revoke: bo can't revoke someone else's link
    assert.match((await run("share-revoke", { token }, bo)).result.error, /not found/);
    await run("share-revoke", { token }, ana);
    assert.equal(mediaShareTokenOk(media(track.mediaId), token), false);
    assert.match((await run("share-get", { token }, bo)).result.error, /not found/);
    // a fresh link, then the shot is deleted
    const t2 = (await run("share-create", { animId: anim.id }, ana)).result.share.token;
    assert.notEqual(t2, token);
    await run("anim-delete", { id: anim.id }, ana);
    assert.equal(mediaShareTokenOk(media(track.mediaId), t2), false);
    assert.match((await run("share-get", { token: t2 }, bo)).result.error, /not found/);
  });
});

describe("the X-sheet", () => {
  let ana, anim;
  before(async () => {
    ({ STATE } = await load());
    ana = await depthCtx("lt-xs");
    anim = (await run("anim-create", { title: "Walk", fps: 12 }, ana)).result.animation;
    await run("frame-add", { animId: anim.id }, ana);
    await run("frame-add", { animId: anim.id }, ana);
    anim = (await run("anim-get", { id: anim.id }, ana)).result.animation;
    await run("frame-set-exposure", { animId: anim.id, frameId: anim.frames[0].id, exposure: 2 }, ana);
    await run("frame-set-exposure", { animId: anim.id, frameId: anim.frames[1].id, exposure: 3 }, ana);
  });

  it("lays drawings over film frames by exposure, in seconds at the shot's frame rate", async () => {
    const r = (await run("xsheet-get", { animId: anim.id }, ana)).result;
    assert.equal(r.totalFrames, 6);
    assert.equal(r.durationSec, 0.5);
    assert.deepEqual(r.drawings.map((d) => [d.drawing, d.startFrame, d.endFrame, d.startSec]), [[1, 1, 2, 0], [2, 3, 5, 0.167], [3, 6, 6, 0.417]]);
  });

  it("writes action, dialogue and camera against a drawing; refuses non-text and nothing-to-write; empty clears", async () => {
    const f = anim.frames[1].id;
    const w = await run("xsheet-set", { animId: anim.id, frameId: f, action: "  contact\u0007 pose ", dialogue: "OO", camera: "truck in" }, ana);
    assert.equal(w.ok, true, w.error);
    assert.deepEqual(w.result.sheet, { action: "contact  pose", dialogue: "OO", camera: "truck in" });
    assert.match((await run("xsheet-set", { animId: anim.id, frameId: f, action: { x: 1 } }, ana)).result.error, /must be text/);
    assert.match((await run("xsheet-set", { animId: anim.id, frameId: f }, ana)).result.error, /nothing to write/);
    assert.match((await run("xsheet-set", { animId: anim.id, frameId: "nope", action: "x" }, ana)).result.error, /frame not found/);
    assert.equal((await run("xsheet-set", { animId: anim.id, frameId: f, action: "x".repeat(500) }, ana)).result.sheet.action.length, 120);
    await run("xsheet-set", { animId: anim.id, frameId: f, camera: "" }, ana);
    const row = (await run("xsheet-get", { animId: anim.id }, ana)).result.drawings[1];
    assert.equal(row.camera, "");
    assert.equal(row.dialogue, "OO");
    const stranger = await depthCtx("lt-xs-other");
    assert.match((await run("xsheet-set", { animId: anim.id, frameId: f, action: "mine now" }, stranger)).result.error, /animation not found/);
  });
});

describe("releases", () => {
  let maker, fan, other, anim, video, poster;
  before(async () => {
    ({ STATE } = await load());
    maker = await depthCtx("lt-maker"); fan = await depthCtx("lt-fan"); other = await depthCtx("lt-other");
    anim = (await run("anim-create", { title: "Paper Boat", fps: 12 }, maker)).result.animation;
    video = upload("lt-maker", "Paper Boat render", { mediaType: "video", duration: 24 });
    poster = upload("lt-maker", "boat poster", { mediaType: "image", duration: 0 });
  });

  it("refuses bad releases and writes nothing", async () => {
    for (const [p, re] of [
      [{ platformMediaId: undefined }, /render the animation/],
      [{ animId: "nope" }, /animation not found/],
      [{ platformMediaId: upload("lt-other", "theirs", { mediaType: "video" }) }, /must be a video you uploaded/],
      [{ platformMediaId: upload("lt-maker", "song") }, /must be a video you uploaded/],
      [{ priceCC: 2, previewSec: 24 }, /preview must be shorter than the animation \(24 s\)/],
      [{ priceCC: 2, previewSec: 2 }, /previewSec must be from 3 to 90/],
      [{ priceCC: "2" }, /priceCC/],
      [{ priceCC: 0.2 }, /priceCC/],
      [{ posterMediaId: video }, /poster must be an image/],
    ]) {
      const r = await run("anim-release-create", { animId: anim.id, platformMediaId: video, ...p }, maker);
      assert.match(r.result.error, re, JSON.stringify(p));
    }
    assert.match((await run("anim-release-create", { animId: anim.id, platformMediaId: video }, other)).result.error, /animation not found/);
    assert.equal((await run("anim-release-list", { mine: true }, maker)).result.count, 0);
  });

  it("a priced animation previews, sells through the marketplace, and the buyer keeps it after a withdraw", async () => {
    const r = await run("anim-release-create", { animId: anim.id, platformMediaId: video, logline: "A boat folds itself.", priceCC: 2, previewSec: 5, posterMediaId: poster }, maker);
    assert.equal(r.ok, true, r.error);
    const rel = r.result.release;
    assert.deepEqual([rel.title, rel.priceCC, rel.previewSec, rel.runtimeSec, rel.fps, rel.animator.isMe], ["Paper Boat", 2, 5, 24, 12, true]);
    assert.equal(rel.poster, `/api/media/${poster}/stream`);
    assert.equal(media(video).privacy, "public");
    assert.equal(viewerMayStreamFull(STATE, media(video), "lt-fan"), false);
    // the public gallery
    const pub = (await run("anim-release-list", {}, fan)).result.releases.find((x) => x.id === rel.id);
    assert.equal(pub.canWatchFull, false);
    assert.equal(pub.animator.isMe, false);

    setLedgerBalance(STATE.db, "lt-fan", 1);
    assert.match((await run("anim-release-buy", { id: rel.id }, fan)).result.error, /this animation is 2 CC and you have 1 CC/);
    setLedgerBalance(STATE.db, "lt-fan", 5); setLedgerBalance(STATE.db, "lt-maker", 0);
    const b = await run("anim-release-buy", { id: rel.id }, fan);
    assert.equal(b.ok, true, b.error);
    assert.equal(wallet("lt-fan"), 3);
    assert.equal(wallet("lt-maker"), 1.9); // 95% of 2 CC
    assert.equal(viewerMayStreamFull(STATE, media(video), "lt-fan"), true);
    assert.match((await run("anim-release-buy", { id: rel.id }, fan)).result.error, /already in your library/);
    assert.match((await run("anim-release-buy", { id: rel.id }, maker)).result.error, /your own animation/);

    await run("anim-release-withdraw", { id: rel.id }, maker);
    assert.equal(media(video).privacy, "private");
    assert.equal(canAccessMediaDTU(STATE, media(video), "lt-fan").allowed, true);
    assert.equal(canAccessMediaDTU(STATE, media(video), "lt-other").allowed, false);
    assert.ok(!(await run("anim-release-list", {}, other)).result.releases.some((x) => x.id === rel.id));
    assert.equal((await run("anim-release-list", { owned: true }, fan)).result.releases[0].id, rel.id);
  });

  it("a free animation plays in full for everyone, and stays free", async () => {
    const v2 = upload("lt-maker", "Paper Boat (short)", { mediaType: "video", duration: 6 });
    const r = await run("anim-release-create", { animId: anim.id, platformMediaId: v2 }, maker);
    assert.equal(r.result.release.priceCC, 0);
    assert.equal(r.result.release.canWatchFull, true);
    // unpriced and public: the stream serves it whole (no licence needed)
    assert.equal(pricedCreateOrCommercial(media(v2)), false);
    assert.equal(media(v2).privacy, "public");
    assert.equal((await run("anim-release-get", { id: r.result.release.id }, other)).result.release.canWatchFull, true);
    assert.match((await run("anim-release-update", { id: r.result.release.id, priceCC: 3 }, maker)).result.error, /a free animation stays free/);
    assert.match((await run("anim-release-buy", { id: r.result.release.id }, fan)).result.error, /free: just watch it/);
  });
});
