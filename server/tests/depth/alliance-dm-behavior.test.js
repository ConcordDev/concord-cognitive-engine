// tests/depth/alliance-dm-behavior.test.js — REAL behavioral tests for the
// alliance domain's cross-org direct-message primitives (dm-send / dm-list /
// dm-inbox — registerLensAction family, invoked via lensRun).
//
// This closes alliance's last open ENGINEERING gap (capability-map item #7):
// Slack Connect supports 1:1 DMs across orgs by default; the alliance domain
// previously had no DM primitive, only channel messages gated to a single
// alliance's membership. The new macros reuse mentorship.js's sorted-pair
// `threadKey` DM pattern (structural template) but keep this domain's own
// richer message shape (attachments/reactions/parentId threading) and a
// DELIBERATELY DIFFERENT recipient-validation rule: a DM's whole point is
// reaching someone who does NOT share an alliance with the caller, so it
// can't reuse message-send's "same alliance" gate. See the long comment
// above the macros in server/domains/alliance.js for the exact rule.
//
// Coverage: send/list/inbox round-trip, sorted-pair threadKey symmetry
// (same thread regardless of who's "from"/"to"), the explicit cross-org
// proof (two users who share no alliance can still DM), fabricated-recipient
// rejection, validation rejections (toId/content/partnerId), attachment
// filter/map parity with message-send, parentId threaded-reply validation
// (valid + two rejection shapes), inbox aggregation across several distinct
// threads with correct sort order, honest displayName resolution + honest
// fallback when a partner becomes unresolvable, and a direct side-by-side
// contrast against message-send proving the DM path has no shared-alliance
// membership requirement.
//
// NB: lens.run UNWRAPS a handler's {ok,result} → r.result is the inner
// result; a handler {ok:false,error} (no result key) passes through so
// r.result.ok===false. (Same convention as tests/depth/alliance-behavior.test.js.)
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

function rnd() { return Math.random().toString(36).slice(2, 8); }

describe("alliance — direct messages between external members (cross-org DM)", () => {
  let ctxA, ctxB, ctxC;
  let allianceOneChannelId;

  before(async () => {
    ctxA = await depthCtx(`dm-user-a-${rnd()}`);
    ctxB = await depthCtx(`dm-user-b-${rnd()}`);
    ctxC = await depthCtx(`dm-user-c-${rnd()}`);

    // Alliance One: A is sole member/owner.
    const a1 = await lensRun("alliance", "alliance-create", { params: { name: `DM Org One ${rnd()}` } }, ctxA);
    allianceOneChannelId = a1.result.defaultChannel.id;

    // Alliance Two: C owns it, invites B in. B is a real member of a
    // COMPLETELY DIFFERENT alliance than A — A and B share no alliance.
    const a2 = await lensRun("alliance", "alliance-create", { params: { name: `DM Org Two ${rnd()}` } }, ctxC);
    const allianceTwoId = a2.result.alliance.id;
    const inv = await lensRun("alliance", "invite-create", { params: { allianceId: allianceTwoId, inviteeId: ctxB.actor.userId, role: "member" } }, ctxC);
    await lensRun("alliance", "invite-respond", { params: { inviteId: inv.result.invite.id, accept: true } }, ctxB);
  });

  it("dm-send: round-trips with the richer alliance message shape (attachments/reactions/threadKey)", async () => {
    const r = await lensRun("alliance", "dm-send", { params: { toId: ctxB.actor.userId, content: "hello across orgs" } }, ctxA);
    assert.equal(r.result.message.fromId, ctxA.actor.userId);
    assert.equal(r.result.message.toId, ctxB.actor.userId);
    assert.equal(r.result.message.content, "hello across orgs");
    assert.deepEqual(r.result.message.reactions, {});
    assert.deepEqual(r.result.message.attachments, []);
    assert.equal(r.result.message.parentId, null);
    assert.ok(r.result.message.id.startsWith("dm_"));
    assert.equal(r.result.threadKey, [ctxA.actor.userId, ctxB.actor.userId].sort().join("::"));
  });

  it("dm-send: message object carries its own threadKey matching the returned threadKey", async () => {
    const r = await lensRun("alliance", "dm-send", { params: { toId: ctxB.actor.userId, content: "consistency check" } }, ctxA);
    assert.equal(r.result.message.threadKey, r.result.threadKey);
  });

  it("sorted-pair threadKey symmetry: B's dm-list(partnerId=A) sees the message A sent", async () => {
    const sent = await lensRun("alliance", "dm-send", { params: { toId: ctxB.actor.userId, content: "symmetric thread" } }, ctxA);
    const listFromB = await lensRun("alliance", "dm-list", { params: { partnerId: ctxA.actor.userId } }, ctxB);
    assert.equal(listFromB.result.threadKey, sent.result.threadKey);
    assert.ok(listFromB.result.messages.some((m) => m.id === sent.result.message.id && m.content === "symmetric thread"));
    const listFromA = await lensRun("alliance", "dm-list", { params: { partnerId: ctxB.actor.userId } }, ctxA);
    assert.equal(listFromA.result.threadKey, listFromB.result.threadKey);
  });

  it("cross-org proof: A and B share no common alliance, yet can still DM each other", async () => {
    const aList = await lensRun("alliance", "alliance-list", {}, ctxA);
    const bList = await lensRun("alliance", "alliance-list", {}, ctxB);
    const aIds = new Set(aList.result.alliances.map((x) => x.id));
    const bIds = new Set(bList.result.alliances.map((x) => x.id));
    const overlap = [...aIds].filter((id) => bIds.has(id));
    assert.equal(overlap.length, 0, "precondition: A and B share no alliance");

    const r = await lensRun("alliance", "dm-send", { params: { toId: ctxB.actor.userId, content: "cross-org contact" } }, ctxA);
    assert.equal(r.result.message.content, "cross-org contact");
  });

  it("dm-send succeeds where message-send would reject: no shared-alliance membership requirement on the DM path", async () => {
    const outsider = await depthCtx(`dm-contrast-outsider-${rnd()}`);
    // message-send DOES require alliance membership: an outsider is rejected
    // even though the channel genuinely exists.
    const chanBlock = await lensRun("alliance", "message-send", { params: { channelId: allianceOneChannelId, content: "hi" } }, outsider);
    assert.equal(chanBlock.result.ok, false);
    assert.match(chanBlock.result.error, /not a member/);

    // dm-send has no such requirement for the SENDER — only the recipient
    // (toId) is validated as a real, known person.
    const dmOk = await lensRun("alliance", "dm-send", { params: { toId: ctxB.actor.userId, content: "cross-restriction proof" } }, outsider);
    assert.equal(dmOk.result.message.content, "cross-restriction proof");
  });

  it("dm-send: the sender is not required to already be an alliance member — only the recipient is validated", async () => {
    const unaffiliated = await depthCtx(`dm-unaffiliated-${rnd()}`);
    const r = await lensRun("alliance", "dm-send", { params: { toId: ctxB.actor.userId, content: "reaching out cold" } }, unaffiliated);
    assert.equal(r.result.message.fromId, unaffiliated.actor.userId);
    assert.equal(r.result.message.content, "reaching out cold");
  });

  it("dm-send: rejects a fabricated/unknown recipient id", async () => {
    const r = await lensRun("alliance", "dm-send", { params: { toId: `totally-fake-user-${rnd()}`, content: "hi" } }, ctxA);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /recipient not found/);
  });

  it("dm-send: rejects a missing toId", async () => {
    const r = await lensRun("alliance", "dm-send", { params: { content: "hi" } }, ctxA);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /toId required/);
  });

  it("dm-send: rejects empty/whitespace-only content", async () => {
    const r = await lensRun("alliance", "dm-send", { params: { toId: ctxB.actor.userId, content: "   " } }, ctxA);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /message content required/);
  });

  it("dm-send: trims leading/trailing whitespace from content", async () => {
    const r = await lensRun("alliance", "dm-send", { params: { toId: ctxB.actor.userId, content: "   spaced out message   " } }, ctxA);
    assert.equal(r.result.message.content, "spaced out message");
  });

  it("dm-send: trims whitespace around toId before validating the recipient", async () => {
    const r = await lensRun("alliance", "dm-send", { params: { toId: `  ${ctxB.actor.userId}  `, content: "trimmed id" } }, ctxA);
    assert.equal(r.result.message.toId, ctxB.actor.userId);
  });

  it("dm-send: filters malformed attachments and keeps only the valid one, normalized", async () => {
    const r = await lensRun("alliance", "dm-send", {
      params: {
        toId: ctxB.actor.userId,
        content: "sharing a file",
        attachments: [
          { name: "spec.pdf", url: "https://x/spec.pdf", mime: "application/pdf", sizeBytes: 4096 },
          { url: "no-name.txt" },
          null,
          { name: "" },
        ],
      },
    }, ctxA);
    assert.equal(r.result.message.attachments.length, 1);
    assert.deepEqual(r.result.message.attachments[0], { name: "spec.pdf", url: "https://x/spec.pdf", mime: "application/pdf", sizeBytes: 4096 });
  });

  it("dm-send: attachment defaults mime/sizeBytes/url when omitted", async () => {
    const r = await lensRun("alliance", "dm-send", { params: { toId: ctxB.actor.userId, content: "bare attachment", attachments: [{ name: "notes.txt" }] } }, ctxA);
    assert.equal(r.result.message.attachments[0].mime, "application/octet-stream");
    assert.equal(r.result.message.attachments[0].sizeBytes, 0);
    assert.equal(r.result.message.attachments[0].url, "");
  });

  it("dm-send: a valid parentId threads a reply within the same DM thread (works in reverse direction too)", async () => {
    const root = await lensRun("alliance", "dm-send", { params: { toId: ctxB.actor.userId, content: "root message" } }, ctxA);
    const reply = await lensRun("alliance", "dm-send", { params: { toId: ctxA.actor.userId, content: "replying", parentId: root.result.message.id } }, ctxB);
    assert.equal(reply.result.message.parentId, root.result.message.id);
    assert.equal(reply.result.threadKey, root.result.threadKey);
  });

  it("dm-send: rejects a parentId that belongs to a different thread", async () => {
    const otherThreadMsg = await lensRun("alliance", "dm-send", { params: { toId: ctxC.actor.userId, content: "unrelated thread" } }, ctxA);
    const r = await lensRun("alliance", "dm-send", { params: { toId: ctxB.actor.userId, content: "cross-thread reply", parentId: otherThreadMsg.result.message.id } }, ctxA);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /parent message not found/);
  });

  it("dm-send: rejects a parentId that doesn't exist at all", async () => {
    const r = await lensRun("alliance", "dm-send", { params: { toId: ctxB.actor.userId, content: "orphan reply", parentId: "dm_nonexistent" } }, ctxA);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /parent message not found/);
  });

  it("dm-send: DMing yourself resolves to a degenerate self-thread without erroring", async () => {
    const r = await lensRun("alliance", "dm-send", { params: { toId: ctxA.actor.userId, content: "note to self" } }, ctxA);
    assert.equal(r.result.message.content, "note to self");
    assert.equal(r.result.threadKey, `${ctxA.actor.userId}::${ctxA.actor.userId}`);
  });

  it("dm-list: rejects a missing partnerId", async () => {
    const r = await lensRun("alliance", "dm-list", { params: {} }, ctxA);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /partnerId required/);
  });

  it("dm-list: an untouched thread returns an empty, non-error result", async () => {
    const fresh = await depthCtx(`dm-user-fresh-${rnd()}`);
    const r = await lensRun("alliance", "dm-list", { params: { partnerId: ctxA.actor.userId } }, fresh);
    assert.equal(r.result.messages.length, 0);
    assert.equal(r.result.count, 0);
  });

  it("dm-list: returns messages in chronological send order", async () => {
    await lensRun("alliance", "dm-send", { params: { toId: ctxB.actor.userId, content: `order-first-${rnd()}` } }, ctxA);
    await lensRun("alliance", "dm-send", { params: { toId: ctxA.actor.userId, content: `order-second-${rnd()}` } }, ctxB);
    await lensRun("alliance", "dm-send", { params: { toId: ctxB.actor.userId, content: `order-third-${rnd()}` } }, ctxA);
    const r = await lensRun("alliance", "dm-list", { params: { partnerId: ctxB.actor.userId } }, ctxA);
    const contents = r.result.messages.map((m) => m.content);
    const iFirst = contents.findIndex((c) => c.startsWith("order-first-"));
    const iSecond = contents.findIndex((c) => c.startsWith("order-second-"));
    const iThird = contents.findIndex((c) => c.startsWith("order-third-"));
    assert.ok(iFirst >= 0 && iSecond >= 0 && iThird >= 0);
    assert.ok(iFirst < iSecond && iSecond < iThird, "messages preserve push (send) order");
  });

  it("dm-inbox: aggregates multiple distinct threads for one user, most-recent-first", async () => {
    const solo = await depthCtx(`dm-inbox-user-${rnd()}`);
    await lensRun("alliance", "dm-send", { params: { toId: ctxA.actor.userId, content: "to A" } }, solo);
    await new Promise((res) => setTimeout(res, 5));
    await lensRun("alliance", "dm-send", { params: { toId: ctxC.actor.userId, content: "to C" } }, solo);
    await new Promise((res) => setTimeout(res, 5));
    await lensRun("alliance", "dm-send", { params: { toId: ctxB.actor.userId, content: "to B" } }, solo);

    const inbox = await lensRun("alliance", "dm-inbox", {}, solo);
    assert.equal(inbox.result.count, 3);
    const partnerIds = inbox.result.threads.map((t) => t.partnerId);
    assert.deepEqual(partnerIds, [ctxB.actor.userId, ctxC.actor.userId, ctxA.actor.userId]);
    assert.equal(inbox.result.threads[0].lastMessage, "to B");
    assert.equal(inbox.result.threads[0].lastFrom, solo.actor.userId);
  });

  it("dm-inbox: empty for a user with no DM threads", async () => {
    const lonely = await depthCtx(`dm-lonely-${rnd()}`);
    const r = await lensRun("alliance", "dm-inbox", {}, lonely);
    assert.equal(r.result.count, 0);
    assert.deepEqual(r.result.threads, []);
  });

  it("dm-inbox: a recipient who never replied still sees the thread (inbox isn't sender-only)", async () => {
    const passive = await depthCtx(`dm-passive-${rnd()}`);
    // passive must be a real alliance member somewhere to be a valid DM recipient.
    await lensRun("alliance", "alliance-create", { params: { name: `DM Passive Org ${rnd()}` } }, passive);
    await lensRun("alliance", "dm-send", { params: { toId: passive.actor.userId, content: "only you were sent to" } }, ctxA);

    const inbox = await lensRun("alliance", "dm-inbox", {}, passive);
    const thread = inbox.result.threads.find((t) => t.partnerId === ctxA.actor.userId);
    assert.ok(thread, "the thread shows up even though passive never sent a message");
    assert.equal(thread.lastMessage, "only you were sent to");
    assert.equal(thread.lastFrom, ctxA.actor.userId);
  });

  it("dm-inbox: resolves the partner's real alliance-membership displayName, not a fabricated one", async () => {
    const ctxD = await depthCtx(`dm-user-d-${rnd()}`);
    await lensRun("alliance", "alliance-create", { params: { name: `DM Org Three ${rnd()}`, displayName: "Dana the Diplomat" } }, ctxD);
    await lensRun("alliance", "dm-send", { params: { toId: ctxD.actor.userId, content: "hi Dana" } }, ctxA);

    const inbox = await lensRun("alliance", "dm-inbox", {}, ctxA);
    const thread = inbox.result.threads.find((t) => t.partnerId === ctxD.actor.userId);
    assert.ok(thread);
    assert.equal(thread.partnerName, "Dana the Diplomat");
  });

  it("dm-inbox: falls back honestly to the raw userId once a partner is no longer resolvable to any alliance membership", async () => {
    const ctxE = await depthCtx(`dm-user-e-${rnd()}`);
    const allianceForE = await lensRun("alliance", "alliance-create", { params: { name: `DM Org Four ${rnd()}` } }, ctxA);
    const invE = await lensRun("alliance", "invite-create", { params: { allianceId: allianceForE.result.alliance.id, inviteeId: ctxE.actor.userId, role: "member" } }, ctxA);
    await lensRun("alliance", "invite-respond", { params: { inviteId: invE.result.invite.id, accept: true } }, ctxE);

    await lensRun("alliance", "dm-send", { params: { toId: ctxE.actor.userId, content: "hi E" } }, ctxA);
    // E's only alliance membership is now revoked — E no longer resolves to
    // any known alliance member anywhere.
    await lensRun("alliance", "member-remove", { params: { allianceId: allianceForE.result.alliance.id, memberId: ctxE.actor.userId } }, ctxA);

    const inbox = await lensRun("alliance", "dm-inbox", {}, ctxA);
    const thread = inbox.result.threads.find((t) => t.partnerId === ctxE.actor.userId);
    assert.ok(thread, "thread still exists even though the partner is no longer resolvable");
    assert.equal(thread.partnerName, ctxE.actor.userId, "falls back to the raw id, never a fabricated name");
  });
});
