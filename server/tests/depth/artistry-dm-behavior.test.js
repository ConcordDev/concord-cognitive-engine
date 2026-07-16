// tests/depth/artistry-dm-behavior.test.js — REAL behavioral tests for the
// artistry domain's direct-message primitive (dm-send / dm-list / dm-inbox —
// registerLensAction family, invoked via lensRun).
//
// Closes docs/WAVE4_INVENTORY.md line 100 / artistry-capability-map.md item
// 11: "No direct-messaging system between creators." The macros are
// structurally cloned from server/domains/alliance.js's cross-org DM
// primitive (dmThreadKey / dm-send / dm-list / dm-inbox) — same sorted-pair
// `[a,b].sort().join("::")` threadKey, same Map<threadKey, Array<message>>
// state shape, same three-macro surface, same honest-fallback displayName
// resolution for dm-inbox.
//
// What genuinely diverges from the alliance template (see the long comment
// above the macros in server/domains/artistry.js):
//   - Message shape mirrors this lens's own plain `commentAdd` shape
//     ({ id, threadKey, fromId, toId, fromName, body, createdAt }) rather
//     than importing alliance's richer attachments/reactions shape, because
//     artistry has no existing attachment/reaction convention to mirror.
//   - Recipient validation: artistry has NO closed-membership concept (no
//     "alliance roster" to scan), so `artDmRecipientExists` instead checks
//     whether the target userId has left ANY real trace on this lens — a
//     saved profile (`profileUpdate`) OR at least one created project
//     (`projectCreate`). A wholly fabricated/never-seen userId has neither
//     and is rejected, mirroring alliance's own "reject a fabricated/unknown
//     userId" discipline adapted from closed-membership to open-participation.
//
// Coverage: send/list/inbox round-trip, sorted-pair threadKey symmetry,
// recipient-validation acceptance via EITHER a profile OR a project (proving
// the OR, not just one branch), fabricated-recipient rejection, validation
// rejections (toId/body/partnerId), inbox aggregation across several
// distinct threads with correct most-recent-first sort order, honest
// displayName resolution + honest raw-id fallback, and privacy scoping — a
// third party can never land on the real key of a thread between two other
// users, because the key is derived from the CALLER's own id.
//
// NB: lens.run UNWRAPS a handler's {ok,result} → r.result is the inner
// result; a handler {ok:false,error} (no result key) passes through so
// r.result.ok===false. (Same convention as tests/depth/alliance-dm-behavior.test.js.)
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

function rnd() { return Math.random().toString(36).slice(2, 8); }

describe("artistry — direct messages between creators", () => {
  let ctxA, ctxB, ctxC;

  before(async () => {
    ctxA = await depthCtx(`art-dm-user-a-${rnd()}`);
    ctxB = await depthCtx(`art-dm-user-b-${rnd()}`);
    ctxC = await depthCtx(`art-dm-user-c-${rnd()}`);

    // A leaves a trace via a profile.
    await lensRun("artistry", "profileUpdate", { params: { displayName: "Ada the Illustrator" } }, ctxA);
    // B leaves a trace via a project only (no profile) — proves the OR.
    await lensRun("artistry", "projectCreate", { params: { title: "Neon Study", description: "x", discipline: "concept-art" } }, ctxB);
    // C leaves a trace via a profile, with a display name for dm-inbox checks.
    await lensRun("artistry", "profileUpdate", { params: { displayName: "Cass the Sculptor" } }, ctxC);
  });

  it("dm-send: round-trips with this lens's own plain message shape", async () => {
    const r = await lensRun("artistry", "dm-send", { params: { toId: ctxB.actor.userId, body: "hello, love the neon study" } }, ctxA);
    assert.equal(r.result.message.fromId, ctxA.actor.userId);
    assert.equal(r.result.message.toId, ctxB.actor.userId);
    assert.equal(r.result.message.body, "hello, love the neon study");
    assert.ok(r.result.message.id.startsWith("dm_"));
    assert.equal(r.result.threadKey, [ctxA.actor.userId, ctxB.actor.userId].sort().join("::"));
  });

  it("dm-send: message object carries its own threadKey matching the returned threadKey", async () => {
    const r = await lensRun("artistry", "dm-send", { params: { toId: ctxB.actor.userId, body: "consistency check" } }, ctxA);
    assert.equal(r.result.message.threadKey, r.result.threadKey);
  });

  it("dm-send: recipient validation accepts a target with a saved PROFILE (no project needed)", async () => {
    const r = await lensRun("artistry", "dm-send", { params: { toId: ctxC.actor.userId, body: "hi Cass, profile-only recipient" } }, ctxA);
    assert.equal(r.result.message.body, "hi Cass, profile-only recipient");
    assert.equal(r.result.message.content, undefined, "field is named `body`, not `content` (mirrors commentAdd's shape)");
  });

  it("dm-send: recipient validation accepts a target with a PROJECT only (no profile) — proves the OR", async () => {
    const r = await lensRun("artistry", "dm-send", { params: { toId: ctxB.actor.userId, body: "hi B, project-only recipient" } }, ctxC);
    assert.equal(r.result.message.body, "hi B, project-only recipient");
  });

  it("sorted-pair threadKey symmetry: B's dm-list(partnerId=A) sees the message A sent", async () => {
    const sent = await lensRun("artistry", "dm-send", { params: { toId: ctxB.actor.userId, body: "symmetric thread" } }, ctxA);
    const listFromB = await lensRun("artistry", "dm-list", { params: { partnerId: ctxA.actor.userId } }, ctxB);
    assert.equal(listFromB.result.threadKey, sent.result.threadKey);
    assert.ok(listFromB.result.messages.some((m) => m.id === sent.result.message.id && m.body === "symmetric thread"));
    const listFromA = await lensRun("artistry", "dm-list", { params: { partnerId: ctxB.actor.userId } }, ctxA);
    assert.equal(listFromA.result.threadKey, listFromB.result.threadKey);
  });

  it("dm-send: rejects a fabricated/unknown recipient id that has never touched this lens", async () => {
    const r = await lensRun("artistry", "dm-send", { params: { toId: `totally-fake-artist-${rnd()}`, body: "hi" } }, ctxA);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /recipient_not_found/);
  });

  it("dm-send: rejects a missing toId", async () => {
    const r = await lensRun("artistry", "dm-send", { params: { body: "hi" } }, ctxA);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /toId_required/);
  });

  it("dm-send: rejects empty/whitespace-only body", async () => {
    const r = await lensRun("artistry", "dm-send", { params: { toId: ctxB.actor.userId, body: "   " } }, ctxA);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /body_required/);
  });

  it("dm-send: trims leading/trailing whitespace from body", async () => {
    const r = await lensRun("artistry", "dm-send", { params: { toId: ctxB.actor.userId, body: "   spaced out message   " } }, ctxA);
    assert.equal(r.result.message.body, "spaced out message");
  });

  it("dm-send: trims whitespace around toId before validating the recipient", async () => {
    const r = await lensRun("artistry", "dm-send", { params: { toId: `  ${ctxB.actor.userId}  `, body: "trimmed id" } }, ctxA);
    assert.equal(r.result.message.toId, ctxB.actor.userId);
  });

  it("dm-list: rejects a missing partnerId", async () => {
    const r = await lensRun("artistry", "dm-list", { params: {} }, ctxA);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /partnerId_required/);
  });

  it("dm-list: an untouched thread returns an empty, non-error result", async () => {
    const fresh = await depthCtx(`art-dm-fresh-${rnd()}`);
    const r = await lensRun("artistry", "dm-list", { params: { partnerId: ctxA.actor.userId } }, fresh);
    assert.equal(r.result.messages.length, 0);
    assert.equal(r.result.count, 0);
  });

  it("dm-list: returns messages in chronological send order", async () => {
    await lensRun("artistry", "dm-send", { params: { toId: ctxB.actor.userId, body: `order-first-${rnd()}` } }, ctxA);
    await lensRun("artistry", "dm-send", { params: { toId: ctxA.actor.userId, body: `order-second-${rnd()}` } }, ctxB);
    await lensRun("artistry", "dm-send", { params: { toId: ctxB.actor.userId, body: `order-third-${rnd()}` } }, ctxA);
    const r = await lensRun("artistry", "dm-list", { params: { partnerId: ctxB.actor.userId } }, ctxA);
    const bodies = r.result.messages.map((m) => m.body);
    const iFirst = bodies.findIndex((c) => c.startsWith("order-first-"));
    const iSecond = bodies.findIndex((c) => c.startsWith("order-second-"));
    const iThird = bodies.findIndex((c) => c.startsWith("order-third-"));
    assert.ok(iFirst >= 0 && iSecond >= 0 && iThird >= 0);
    assert.ok(iFirst < iSecond && iSecond < iThird, "messages preserve push (send) order");
  });

  it("privacy scoping: a third party can never land on the real key of a thread between two other users", async () => {
    // A private conversation between B and C.
    const sent = await lensRun("artistry", "dm-send", { params: { toId: ctxC.actor.userId, body: "just between us" } }, ctxB);
    const realKey = sent.result.threadKey;

    // An unrelated third party, D, requests dm-list(partnerId=C). D's own
    // thread key with C is derived from D's OWN id, never from B's — so D
    // can never see B and C's private exchange, even naming C explicitly.
    const ctxD = await depthCtx(`art-dm-outsider-${rnd()}`);
    await lensRun("artistry", "profileUpdate", { params: { displayName: "Outsider D" } }, ctxD);
    const dList = await lensRun("artistry", "dm-list", { params: { partnerId: ctxC.actor.userId } }, ctxD);

    assert.notEqual(dList.result.threadKey, realKey, "D's thread key with C must differ from B/C's real thread key");
    assert.equal(dList.result.messages.length, 0, "D sees no messages from the B/C conversation");
    assert.ok(!dList.result.messages.some((m) => m.body === "just between us"));
  });

  it("dm-inbox: aggregates multiple distinct threads for one user, most-recent-first", async () => {
    const solo = await depthCtx(`art-dm-inbox-user-${rnd()}`);
    await lensRun("artistry", "profileUpdate", { params: { displayName: "Solo Creator" } }, solo);
    await lensRun("artistry", "dm-send", { params: { toId: ctxA.actor.userId, body: "to A" } }, solo);
    await new Promise((res) => setTimeout(res, 5));
    await lensRun("artistry", "dm-send", { params: { toId: ctxC.actor.userId, body: "to C" } }, solo);
    await new Promise((res) => setTimeout(res, 5));
    await lensRun("artistry", "dm-send", { params: { toId: ctxB.actor.userId, body: "to B" } }, solo);

    const inbox = await lensRun("artistry", "dm-inbox", {}, solo);
    assert.equal(inbox.result.count, 3);
    const partnerIds = inbox.result.threads.map((t) => t.partnerId);
    assert.deepEqual(partnerIds, [ctxB.actor.userId, ctxC.actor.userId, ctxA.actor.userId]);
    assert.equal(inbox.result.threads[0].lastMessage, "to B");
    assert.equal(inbox.result.threads[0].lastFrom, solo.actor.userId);
  });

  it("dm-inbox: empty for a user with no DM threads", async () => {
    const lonely = await depthCtx(`art-dm-lonely-${rnd()}`);
    const r = await lensRun("artistry", "dm-inbox", {}, lonely);
    assert.equal(r.result.count, 0);
    assert.deepEqual(r.result.threads, []);
  });

  it("dm-inbox: a recipient who never replied still sees the thread (inbox isn't sender-only)", async () => {
    const passive = await depthCtx(`art-dm-passive-${rnd()}`);
    await lensRun("artistry", "profileUpdate", { params: { displayName: "Passive Creator" } }, passive);
    await lensRun("artistry", "dm-send", { params: { toId: passive.actor.userId, body: "only you were sent to" } }, ctxA);

    const inbox = await lensRun("artistry", "dm-inbox", {}, passive);
    const thread = inbox.result.threads.find((t) => t.partnerId === ctxA.actor.userId);
    assert.ok(thread, "the thread shows up even though passive never sent a message");
    assert.equal(thread.lastMessage, "only you were sent to");
    assert.equal(thread.lastFrom, ctxA.actor.userId);
  });

  it("dm-inbox: resolves the partner's real profile displayName, not a fabricated one", async () => {
    const ctxE = await depthCtx(`art-dm-user-e-${rnd()}`);
    await lensRun("artistry", "profileUpdate", { params: { displayName: "Eli the Engraver" } }, ctxE);
    await lensRun("artistry", "dm-send", { params: { toId: ctxE.actor.userId, body: "hi Eli" } }, ctxA);

    const inbox = await lensRun("artistry", "dm-inbox", {}, ctxA);
    const thread = inbox.result.threads.find((t) => t.partnerId === ctxE.actor.userId);
    assert.ok(thread);
    assert.equal(thread.partnerName, "Eli the Engraver");
  });

  it("dm-inbox: falls back honestly to the raw userId when a partner has no profile displayName (project-only trace)", async () => {
    const ctxF = await depthCtx(`art-dm-user-f-${rnd()}`);
    await lensRun("artistry", "projectCreate", { params: { title: "Untitled Work", description: "x", discipline: "illustration" } }, ctxF);
    await lensRun("artistry", "dm-send", { params: { toId: ctxF.actor.userId, body: "hi F" } }, ctxA);

    const inbox = await lensRun("artistry", "dm-inbox", {}, ctxA);
    const thread = inbox.result.threads.find((t) => t.partnerId === ctxF.actor.userId);
    assert.ok(thread, "thread exists even though the partner never set a profile displayName");
    assert.equal(thread.partnerName, ctxF.actor.userId, "falls back to the raw id, never a fabricated name");
  });

  it("dm-send: DMing yourself resolves to a degenerate self-thread without erroring (sender already has a profile)", async () => {
    const r = await lensRun("artistry", "dm-send", { params: { toId: ctxA.actor.userId, body: "note to self" } }, ctxA);
    assert.equal(r.result.message.body, "note to self");
    assert.equal(r.result.threadKey, `${ctxA.actor.userId}::${ctxA.actor.userId}`);
  });
});
