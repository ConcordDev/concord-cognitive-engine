// tests/depth/film-releases-behavior.test.js — Film Studios with real footage.
// Uploaded video becomes footage with its real duration; the cut tells a
// player exactly what to play and from where; versions review real video;
// watch parties are joinable by code with the host driving playback and the
// signed-in person as chat author; finished films release free or for sale
// through the marketplace, with the stream itself gating non-buyers.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load } from "./_harness.js";
import { setLedgerBalance } from "../lib/ledger-fund.js";
import { getBalance } from "../../economy/balances.js";
import { createMediaDTU, getMediaDTU, canAccessMediaDTU } from "../../lib/media-dtu.js";
import { viewerMayStreamFull, pricedCreateOrCommercial } from "../../lib/media-preview-window.js";

let STATE;
const run = (a, p, ctx) => lensRun("film-studios", a, { params: p }, ctx);
const wallet = (id) => getBalance(STATE.db, id).balance;
const media = (id) => getMediaDTU(STATE, id).mediaDTU;
const mayStream = (id, viewer) => canAccessMediaDTU(STATE, media(id), viewer).allowed;
function upload(authorId, title, { mediaType = "video", duration = 60.5 } = {}) {
  const r = createMediaDTU(STATE, { authorId, title, mediaType, mimeType: mediaType === "video" ? "video/mp4" : mediaType === "image" ? "image/png" : mediaType === "audio" ? "audio/wav" : "application/pdf", duration, privacy: "private" });
  assert.equal(r.ok, true, r.error);
  return r.mediaDTU.id;
}

describe("footage and the cut", () => {
  let ada, ben, project, seq;
  before(async () => {
    ({ STATE } = await load());
    ada = await depthCtx("film-ada"); ben = await depthCtx("film-ben");
    project = (await run("project-create", { title: "Harbour Lights" }, ada)).result.project;
    seq = (await run("sequence-create", { projectId: project.id, name: "Assembly", fps: "24" }, ada)).result.sequence;
  });

  it("registers an upload as footage with its real name and duration; others' uploads and documents are refused", async () => {
    const vid = upload("film-ada", "A001_C003 dock wide", { duration: 60.5 });
    const r = await run("media-register", { projectId: project.id, platformMediaId: vid }, ada);
    assert.equal(r.ok, true, r.error);
    const m = r.result.media;
    assert.deepEqual([m.name, m.kind, m.durationSec, m.durationFrames, m.streamUrl], ["A001_C003 dock wide", "video", 60.5, 1452, `/api/media/${vid}/stream`]);
    assert.match((await run("media-register", { projectId: project.id, platformMediaId: upload("film-ben", "not yours") }, ada)).result.error, /not found among your media/);
    assert.match((await run("media-register", { projectId: project.id, platformMediaId: upload("film-ada", "a pdf", { mediaType: "document" }) }, ada)).result.error, /only video, audio or image/);
    assert.match((await run("media-register", { projectId: project.id, platformMediaId: vid }, ben)).result.error, /project not found/);
  });

  it("the cut says what to play, from where in the source, for how long, and where it sits", async () => {
    const list = (await run("media-list", { projectId: project.id }, ada)).result.media;
    const footage = list[0];
    const a = (await run("clip-add", { sequenceId: seq.id, name: "Wide", durationSec: 4 }, ada)).result.clip;
    const b = (await run("clip-add", { sequenceId: seq.id, name: "Close", durationSec: 2.5 }, ada)).result.clip;
    await run("clip-set-media", { clipId: a.id, mediaId: footage.id }, ada);
    await run("clip-set-media", { clipId: b.id, mediaId: footage.id }, ada);
    await run("clip-update", { id: b.id, inFrame: 240, outFrame: 300 }, ada); // 10.0 s to 12.5 s of the source
    const cut = await run("cut-list", { sequenceId: seq.id }, ada);
    const [c1, c2] = cut.result.tracks.V1;
    assert.deepEqual([c1.streamUrl, c1.sourceInSec, c1.durationSec, c1.startSec], [footage.streamUrl, 0, 4, 0]);
    assert.deepEqual([c2.sourceInSec, c2.durationSec, c2.startSec, c2.startTimecode], [10, 2.5, 4, "00:00:04:00"]);
  });

  it("a version reviews real footage or a sequence; another production's are refused; notes keep sub-second time and their author", async () => {
    const footage = (await run("media-list", { projectId: project.id }, ada)).result.media[0];
    const v = await run("version-create", { projectId: project.id, label: "Rough cut 1", mediaId: footage.id }, ada);
    assert.equal(v.result.version.mediaId, footage.id);
    const listed = (await run("version-list", { projectId: project.id }, ada)).result.versions[0];
    assert.equal(listed.streamUrl, footage.streamUrl);
    const other = (await run("project-create", { title: "Other" }, ada)).result.project;
    assert.match((await run("version-create", { projectId: other.id, label: "x", mediaId: footage.id }, ada)).result.error, /media not found in this production/);
    assert.match((await run("version-create", { projectId: other.id, label: "x", sequenceId: seq.id }, ada)).result.error, /sequence not found in this production/);
    const n = await run("note-add", { versionId: v.result.version.id, timecodeSec: 12.46, body: "Hold the wide a beat longer" }, ada);
    assert.deepEqual([n.result.note.timecodeSec, n.result.note.authorId], [12.5, "film-ada"]);
  });
});

describe("watch parties", () => {
  let host, guest, stranger, project, party;
  before(async () => {
    ({ STATE } = await load());
    host = await depthCtx("film-host"); guest = await depthCtx("film-guest"); stranger = await depthCtx("film-stranger");
    project = (await run("project-create", { title: "Screening" }, host)).result.project;
    const vid = upload("film-host", "final.mp4");
    const footage = (await run("media-register", { projectId: project.id, platformMediaId: vid }, host)).result.media;
    const v = (await run("version-create", { projectId: project.id, label: "Picture lock", mediaId: footage.id }, host)).result.version;
    party = (await run("party-create", { projectId: project.id, title: "Cast screening", versionId: v.id }, host)).result.party;
  });

  it("a guest joins by code and sees the same film; strangers see nothing; bad codes are refused", async () => {
    assert.match((await run("party-state", { id: party.id }, guest)).result.error, /party not found/);
    for (const code of ["nope", "FILM-1234", ""]) assert.equal((await run("party-join", { code }, guest)).ok, false, code);
    const j = await run("party-join", { code: party.code.toLowerCase() }, guest);
    assert.equal(j.ok, true, j.error);
    const st = await run("party-state", { id: party.id }, guest);
    assert.equal(st.result.party.isHost, false);
    assert.match(st.result.party.streamUrl, /^\/api\/media\/.+\/stream$/);
    // the host's private cut: the guest may stream it, a stranger may not
    const cutId = st.result.party.streamUrl.split("/")[3];
    assert.equal(media(cutId).privacy, "private");
    assert.equal(mayStream(cutId, "film-guest"), true);
    assert.equal(mayStream(cutId, "film-stranger"), false);
    assert.equal(st.result.party.participantCount, 2);
    assert.match((await run("party-state", { id: party.id }, stranger)).result.error, /party not found/);
  });

  it("only the host drives playback; chat names the real poster", async () => {
    assert.match((await run("party-sync", { id: party.id, playing: true }, guest)).result.error, /only the host/);
    assert.equal((await run("party-sync", { id: party.id, positionSec: 42, playing: false }, host)).ok, true);
    assert.equal((await run("party-state", { id: party.id }, guest)).result.party.positionSec, 42);
    await run("party-chat-post", { id: party.id, text: "Great opening", author: "The Director" }, guest);
    const chat = (await run("party-chat-list", { id: party.id }, host)).result.messages;
    assert.equal(chat[0].authorId, "film-guest");
    assert.notEqual(chat[0].author, "The Director");
    assert.match((await run("party-chat-post", { id: party.id, text: "hi" }, stranger)).result.error, /party not found/);
  });

  it("ending the screening ends the guest's access to the private cut", async () => {
    const cutId = (await run("party-state", { id: party.id }, host)).result.party.streamUrl.split("/")[3];
    assert.match((await run("party-delete", { id: party.id }, guest)).result.error, /party not found/);
    assert.equal((await run("party-delete", { id: party.id }, host)).ok, true);
    assert.equal(mayStream(cutId, "film-guest"), false);
    assert.equal(mayStream(cutId, "film-host"), true);
  });
});

describe("releasing a film", () => {
  let maker, fan, other, project, footage, still;
  before(async () => {
    ({ STATE } = await load());
    maker = await depthCtx("film-maker"); fan = await depthCtx("film-fan"); other = await depthCtx("film-other");
    project = (await run("project-create", { title: "Low Tide" }, maker)).result.project;
    footage = (await run("media-register", { projectId: project.id, platformMediaId: upload("film-maker", "Low Tide final", { duration: 612 }) }, maker)).result.media;
    still = (await run("media-register", { projectId: project.id, platformMediaId: upload("film-maker", "poster.png", { mediaType: "image" }) }, maker)).result.media;
    await run("cast-add", { projectId: project.id, name: "Ida Brook", characterName: "Mara" }, maker);
  });

  it("refuses bad releases and writes nothing", async () => {
    for (const [p, re] of [
      [{ priceCC: 0.3 }, /priceCC/], [{ priceCC: 1001 }, /priceCC/], [{ priceCC: "3" }, /priceCC/], [{ priceCC: 2.345 }, /in cents/],
      [{ previewSec: 5 }, /previewSec/], [{ mediaId: still.id }, /must be a video/],
      [{ posterMediaId: upload("film-other", "their poster", { mediaType: "image" }) }, /poster must be an image you uploaded/],
      [{ posterMediaId: footage.platformMediaId }, /poster must be an image/],
    ]) {
      const r = await run("film-release-create", { projectId: project.id, mediaId: footage.id, logline: "x", ...p }, maker);
      assert.match(r.result.error, re, JSON.stringify(p));
    }
    assert.match((await run("film-release-create", { projectId: project.id, mediaId: footage.id }, other)).result.error, /project not found/);
    assert.equal((await run("film-release-list", { mine: true }, maker)).result.count, 0);
  });

  it("a priced film is listed, its stream gates non-buyers, and buying pays the maker and unlocks it", async () => {
    const r = await run("film-release-create", { projectId: project.id, mediaId: footage.id, logline: "Two sisters and a boat.", priceCC: 3, previewSec: 60, posterMediaId: still.platformMediaId }, maker);
    assert.equal(r.ok, true, r.error);
    const rel = r.result.release;
    assert.equal(rel.poster, `/api/media/${still.platformMediaId}/stream`);
    assert.equal(media(still.platformMediaId).privacy, "public");
    assert.deepEqual([rel.priceCC, rel.previewSec, rel.runtimeSec, rel.credits.cast[0]], [3, 60, 612, { name: "Ida Brook", role: "Mara" }]);
    const md = media(footage.platformMediaId);
    assert.equal(pricedCreateOrCommercial(md), true);
    assert.equal(md.privacy, "public"); // anyone can watch the preview
    assert.equal(viewerMayStreamFull(STATE, md, "film-fan"), false);
    assert.equal((await run("film-release-get", { id: rel.id }, fan)).result.release.canWatchFull, false);
    assert.match((await run("film-release-create", { projectId: project.id, mediaId: footage.id, priceCC: 3 }, maker)).result.error, /already released/);

    setLedgerBalance(STATE.db, "film-fan", 2);
    assert.match((await run("film-release-buy", { id: rel.id }, fan)).result.error, /this film is 3 CC and you have 2 CC/);
    setLedgerBalance(STATE.db, "film-fan", 10); setLedgerBalance(STATE.db, "film-maker", 0);
    const b = await run("film-release-buy", { id: rel.id }, fan);
    assert.equal(b.ok, true, b.error);
    assert.equal(wallet("film-fan"), 7);
    const gained = wallet("film-maker");
    assert.ok(gained > 2.5 && gained <= 3, `maker gained ${gained}`);
    assert.equal(viewerMayStreamFull(STATE, md, "film-fan"), true);
    assert.equal((await run("film-release-get", { id: rel.id }, fan)).result.release.canWatchFull, true);
    assert.match((await run("film-release-buy", { id: rel.id }, fan)).result.error, /already in your library/);
    assert.match((await run("film-release-buy", { id: rel.id }, maker)).result.error, /your own film/);
    assert.equal((await run("film-release-list", { owned: true }, fan)).result.releases[0].id, rel.id);

    // a screening of a paid film: only people who have it can join
    const party = (await run("film-release-party", { id: rel.id }, fan)).result.party;
    assert.match((await run("film-release-party", { id: rel.id }, other)).result.error, /get the film/);
    assert.match((await run("party-join", { code: party.code }, other)).result.error, /film you don't have/);
    assert.equal((await run("party-state", { id: party.id }, fan)).result.party.streamUrl, `/api/media/${footage.platformMediaId}/stream`);

    // withdrawn: no longer sold or listed, but the buyer keeps it
    await run("film-release-withdraw", { id: rel.id }, maker);
    assert.ok(!(await run("film-release-list", {}, other)).result.releases.some((x) => x.id === rel.id));
    assert.equal((await run("film-release-get", { id: rel.id }, fan)).result.release.canWatchFull, true);
    assert.match((await run("film-release-buy", { id: rel.id }, other)).result.error, /film not found/);
    // at the stream itself: private again, the buyer still gets bytes, others don't
    assert.equal(media(footage.platformMediaId).privacy, "private");
    assert.equal(mayStream(footage.platformMediaId, "film-fan"), true);
    assert.equal(mayStream(footage.platformMediaId, "film-other"), false);
  });

  it("a free film plays in full for everyone", async () => {
    const vid = (await run("media-register", { projectId: project.id, platformMediaId: upload("film-maker", "Low Tide (festival cut)") }, maker)).result.media;
    const r = await run("film-release-create", { projectId: project.id, mediaId: vid.id, logline: "Free to watch." }, maker);
    assert.equal(r.result.release.priceCC, 0);
    assert.equal(media(vid.platformMediaId).privacy, "public");
    assert.equal(pricedCreateOrCommercial(media(vid.platformMediaId)), false);
    assert.equal((await run("film-release-get", { id: r.result.release.id }, other)).result.release.canWatchFull, true);
    assert.match((await run("film-release-buy", { id: r.result.release.id }, other)).result.error, /free/);
    assert.match((await run("film-release-update", { id: r.result.release.id, priceCC: 4 }, maker)).result.error, /stays free/);
  });
});
