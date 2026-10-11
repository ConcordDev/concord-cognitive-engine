// INC-54 — alliance identity, invites, and deletion.
//
// Two real accounts. Names shown to the other account come from the users
// table (display name, then handle). A client displayName is ignored, including
// one already stored on a member row. Invites resolve a real user and reject
// unknown handles. Owner delete, member leave, channel/message/proposal
// delete, and invite revoke remove the record for every member and from the
// lens snapshot a restart would hydrate.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load } from "./_harness.js";
import { serializeLensState, hydrateLensState } from "../../lib/lens-state-persistence.js";

const OWNER = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const MEMBER = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const SPOOF = "Totally The Owner";

const NAME_KEYS = new Set([
  "displayName", "fromName", "partnerName", "inviteeName", "invitedByName", "handle",
]);

function collectNames(value, out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) collectNames(item, out);
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    if (NAME_KEYS.has(key)) out.push(child);
    else if (child && typeof child === "object") collectNames(child, out);
  }
  return out;
}

function assertNoLeakedNames(payload, rawIds) {
  const blob = JSON.stringify(payload);
  assert.equal(blob.includes(SPOOF), false, "client-supplied displayName must not be returned");
  for (const name of collectNames(payload)) {
    if (name == null) continue;
    for (const id of rawIds) {
      assert.notEqual(name, id, `public name leaked raw id ${id}`);
    }
    assert.notEqual(name, SPOOF);
  }
}

async function seedUser(userId, username, displayName) {
  const { STATE } = await load();
  const db = STATE.db;
  let cols = new Set(db.prepare("PRAGMA table_info(users)").all().map((c) => c.name));
  if (!cols.has("display_name")) {
    try { db.exec("ALTER TABLE users ADD COLUMN display_name TEXT"); } catch { /* already added */ }
    cols = new Set(db.prepare("PRAGMA table_info(users)").all().map((c) => c.name));
  }
  if (!db.prepare("SELECT id FROM users WHERE id = ?").get(userId)) {
    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, 'x', datetime('now'))`
    ).run(userId, username, `${username}@alliance.test`);
  }
  if (cols.has("display_name")) {
    db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName, userId);
  }
  return cols.has("display_name") ? displayName : username;
}

async function hydratedLens() {
  const { STATE } = await load();
  const snap = JSON.parse(JSON.stringify(serializeLensState(STATE)));
  const revived = {};
  hydrateLensState(revived, snap);
  return revived.allianceLens;
}

describe("alliance INC-54 — identity, invites, delete/leave", () => {
  let owner;
  let member;
  let ownerLabel;
  let memberLabel;

  before(async () => {
    owner = await depthCtx(OWNER);
    member = await depthCtx(MEMBER);
    ownerLabel = await seedUser(OWNER, "ada-inc54", "Ada Lovelace");
    memberLabel = await seedUser(MEMBER, "bea-inc54", "Bea Knower");
  });

  it("names shown to the other member are server identities; spoofed displayName and raw ids are not", async () => {
    const created = await lensRun("alliance", "alliance-create", {
      params: { name: "INC54 Pact", type: "research", displayName: SPOOF },
    }, owner);
    assert.equal(created.ok, true);
    const allianceId = created.result.alliance.id;
    const channelId = created.result.defaultChannel.id;
    assert.equal(created.result.alliance.members[0].displayName, ownerLabel);
    assert.equal(created.result.alliance.members[0].isMe, true);
    assert.notEqual(created.result.alliance.members[0].displayName, OWNER);
    assertNoLeakedNames(created.result, [OWNER, MEMBER]);

    const unknown = await lensRun("alliance", "invite-create", {
      params: { allianceId, inviteeId: "no_such_user_r95" },
    }, owner);
    assert.equal(unknown.result.ok, false);
    assert.equal(unknown.result.error, "unknown user");

    const invited = await lensRun("alliance", "invite-create", {
      params: { allianceId, handle: "@Bea-INC54", role: "member" },
    }, owner);
    assert.equal(invited.ok, true);
    assert.equal(invited.result.invite.inviteeId, MEMBER);
    assert.equal(invited.result.invite.inviteeName, memberLabel);

    const joined = await lensRun("alliance", "invite-respond", {
      params: { inviteId: invited.result.invite.id, accept: true, displayName: SPOOF },
    }, member);
    assert.equal(joined.ok, true);
    assert.equal(joined.result.joined, true);

    // A name written onto the stored member row (older alliances, or a
    // spoof that landed before this fix) is not what readers see.
    const { STATE } = await load();
    const stored = STATE.allianceLens.alliances.get(allianceId);
    const storedMember = stored.members.find((m) => m.userId === MEMBER);
    storedMember.displayName = SPOOF;

    const seen = await lensRun("alliance", "alliance-list", {}, member);
    const row = seen.result.alliances.find((a) => a.id === allianceId);
    assert.ok(row);
    const ownerRow = row.members.find((m) => m.userId === OWNER);
    const self = row.members.find((m) => m.userId === MEMBER);
    assert.equal(ownerRow.displayName, ownerLabel);
    assert.equal(ownerRow.isMe, false);
    assert.equal(self.displayName, memberLabel);
    assert.equal(self.isMe, true);
    assertNoLeakedNames(seen.result, [OWNER, MEMBER]);

    const sent = await lensRun("alliance", "message-send", {
      params: { channelId, content: "hello from the owner" },
    }, owner);
    assert.equal(sent.result.message.displayName, ownerLabel);
    assert.equal(sent.result.message.isMine, true);
    const thread = await lensRun("alliance", "message-list", { params: { channelId } }, member);
    assert.equal(thread.result.messages[0].displayName, ownerLabel);
    assert.equal(thread.result.messages[0].isMine, false);
    assertNoLeakedNames(thread.result, [OWNER, MEMBER]);

    await lensRun("alliance", "dm-send", { params: { toId: MEMBER, content: "dm hello" } }, owner);
    const inbox = await lensRun("alliance", "dm-inbox", {}, member);
    const dm = inbox.result.threads.find((t) => t.partnerId === OWNER);
    assert.ok(dm);
    assert.equal(dm.partnerName, ownerLabel);
    assert.notEqual(dm.partnerName, OWNER);
    assertNoLeakedNames(inbox.result, [OWNER, MEMBER]);
  });

  it("invite-revoke drops a pending invite for the invitee; a member cannot revoke; an accepted invite cannot", async () => {
    const created = await lensRun("alliance", "alliance-create", { params: { name: "INC54 Invites" } }, owner);
    const allianceId = created.result.alliance.id;
    const thirdId = `ccccccc3-3333-4333-8333-${Math.random().toString(16).slice(2, 14)}`;
    const third = await depthCtx(thirdId);
    const thirdLabel = await seedUser(thirdId, `cy${thirdId.slice(-6)}`, "Cy Invitee");

    const invited = await lensRun("alliance", "invite-create", {
      params: { allianceId, handle: thirdId.slice(-6) ? `cy${thirdId.slice(-6)}` : thirdLabel, role: "member" },
    }, owner);
    // handle was derived the same way as the username above
    assert.equal(invited.ok, true, JSON.stringify(invited.result));
    const inviteId = invited.result.invite.id;

    // Bring the member in so a non-inviter can try to revoke.
    const memberInv = await lensRun("alliance", "invite-create", {
      params: { allianceId, handle: "bea-inc54", role: "member" },
    }, owner);
    await lensRun("alliance", "invite-respond", { params: { inviteId: memberInv.result.invite.id, accept: true } }, member);

    const denied = await lensRun("alliance", "invite-revoke", { params: { inviteId } }, member);
    assert.equal(denied.result.ok, false);
    assert.match(denied.result.error, /forbidden/);

    const inboxBefore = await lensRun("alliance", "invite-list", {}, third);
    assert.ok(inboxBefore.result.invites.some((i) => i.id === inviteId));

    const revoked = await lensRun("alliance", "invite-revoke", { params: { inviteId } }, owner);
    assert.equal(revoked.ok, true);
    const inboxAfter = await lensRun("alliance", "invite-list", {}, third);
    assert.equal(inboxAfter.result.invites.some((i) => i.id === inviteId), false);
    const lens = await hydratedLens();
    const pending = [...(lens.invites?.get(allianceId) || [])].filter((i) => i.id === inviteId);
    assert.equal(pending.length, 0);

    const again = await lensRun("alliance", "invite-create", {
      params: { allianceId, username: `cy${thirdId.slice(-6)}` },
    }, owner);
    await lensRun("alliance", "invite-respond", { params: { inviteId: again.result.invite.id, accept: true } }, third);
    const late = await lensRun("alliance", "invite-revoke", { params: { inviteId: again.result.invite.id } }, owner);
    assert.equal(late.result.ok, false);
    assert.match(late.result.error, /not pending/);
  });

  it("owner can delete the alliance; a member cannot; it stays gone after snapshot hydrate", async () => {
    const created = await lensRun("alliance", "alliance-create", { params: { name: "INC54 Delete Me" } }, owner);
    const allianceId = created.result.alliance.id;
    const inv = await lensRun("alliance", "invite-create", { params: { allianceId, handle: "bea-inc54" } }, owner);
    await lensRun("alliance", "invite-respond", { params: { inviteId: inv.result.invite.id, accept: true } }, member);

    const denied = await lensRun("alliance", "alliance-delete", { params: { allianceId } }, member);
    assert.equal(denied.result.ok, false);
    assert.match(denied.result.error, /owner/);

    const removed = await lensRun("alliance", "alliance-delete", { params: { allianceId } }, owner);
    assert.equal(removed.ok, true);
    const ownerList = await lensRun("alliance", "alliance-list", {}, owner);
    const memberList = await lensRun("alliance", "alliance-list", {}, member);
    assert.equal(ownerList.result.alliances.some((a) => a.id === allianceId), false);
    assert.equal(memberList.result.alliances.some((a) => a.id === allianceId), false);
    const lens = await hydratedLens();
    assert.equal(lens.alliances.has(allianceId), false);
  });

  it("a member can leave; the owner cannot until they transfer, then the former owner can leave", async () => {
    const created = await lensRun("alliance", "alliance-create", { params: { name: "INC54 Leave" } }, owner);
    const allianceId = created.result.alliance.id;
    const inv = await lensRun("alliance", "invite-create", { params: { allianceId, handle: "@bea-inc54" } }, owner);
    await lensRun("alliance", "invite-respond", { params: { inviteId: inv.result.invite.id, accept: true } }, member);

    const ownerLeave = await lensRun("alliance", "alliance-leave", { params: { allianceId } }, owner);
    assert.equal(ownerLeave.result.ok, false);
    assert.match(ownerLeave.result.error, /owner cannot leave/);

    const left = await lensRun("alliance", "alliance-leave", { params: { allianceId } }, member);
    assert.equal(left.ok, true);
    const after = await lensRun("alliance", "alliance-list", {}, owner);
    const still = after.result.alliances.find((a) => a.id === allianceId);
    assert.ok(still);
    assert.equal(still.members.some((m) => m.userId === MEMBER), false);
    const memberGone = await lensRun("alliance", "alliance-list", {}, member);
    assert.equal(memberGone.result.alliances.some((a) => a.id === allianceId), false);

    // Re-join so the owner has someone to transfer to, then the former owner leaves.
    const inv2 = await lensRun("alliance", "invite-create", { params: { allianceId, handle: "bea-inc54" } }, owner);
    await lensRun("alliance", "invite-respond", { params: { inviteId: inv2.result.invite.id, accept: true } }, member);
    const xferDenied = await lensRun("alliance", "alliance-transfer", { params: { allianceId, memberId: OWNER } }, member);
    assert.equal(xferDenied.result.ok, false);
    const xfer = await lensRun("alliance", "alliance-transfer", { params: { allianceId, memberId: MEMBER } }, owner);
    assert.equal(xfer.ok, true);
    const former = await lensRun("alliance", "alliance-leave", { params: { allianceId } }, owner);
    assert.equal(former.ok, true);
    const ownerAfter = await lensRun("alliance", "alliance-list", {}, owner);
    assert.equal(ownerAfter.result.alliances.some((a) => a.id === allianceId), false);
    const kept = await lensRun("alliance", "alliance-list", {}, member);
    const keptRow = kept.result.alliances.find((a) => a.id === allianceId);
    assert.equal(keptRow.myRole, "owner");
    const lens = await hydratedLens();
    const stored = lens.alliances.get(allianceId);
    assert.ok(stored);
    assert.equal(stored.members.some((m) => m.userId === OWNER), false);
    assert.equal(stored.members.some((m) => m.userId === MEMBER && m.role === "owner"), true);
  });

  it("admin can delete a channel other than #general; a member cannot; #general cannot; it stays gone", async () => {
    const created = await lensRun("alliance", "alliance-create", { params: { name: "INC54 Channels" } }, owner);
    const allianceId = created.result.alliance.id;
    const generalId = created.result.defaultChannel.id;
    const inv = await lensRun("alliance", "invite-create", { params: { allianceId, handle: "bea-inc54" } }, owner);
    await lensRun("alliance", "invite-respond", { params: { inviteId: inv.result.invite.id, accept: true } }, member);
    const side = await lensRun("alliance", "channel-create", { params: { allianceId, name: "ops" } }, owner);
    const channelId = side.result.channel.id;

    const memberDenied = await lensRun("alliance", "channel-delete", { params: { channelId } }, member);
    assert.equal(memberDenied.result.ok, false);
    assert.match(memberDenied.result.error, /admin/);
    const generalDenied = await lensRun("alliance", "channel-delete", { params: { channelId: generalId } }, owner);
    assert.equal(generalDenied.result.ok, false);
    assert.match(generalDenied.result.error, /#general/);

    const removed = await lensRun("alliance", "channel-delete", { params: { channelId } }, owner);
    assert.equal(removed.ok, true);
    const list = await lensRun("alliance", "channel-list", { params: { allianceId } }, member);
    assert.equal(list.result.channels.some((c) => c.id === channelId), false);
    assert.ok(list.result.channels.some((c) => c.id === generalId));
    const lens = await hydratedLens();
    const channels = lens.channels.get(allianceId) || [];
    assert.equal(channels.some((c) => c.id === channelId), false);
  });

  it("author or admin can delete a message; another member cannot; it stays gone for everyone", async () => {
    const created = await lensRun("alliance", "alliance-create", { params: { name: "INC54 Messages" } }, owner);
    const allianceId = created.result.alliance.id;
    const channelId = created.result.defaultChannel.id;
    const inv = await lensRun("alliance", "invite-create", { params: { allianceId, handle: "bea-inc54" } }, owner);
    await lensRun("alliance", "invite-respond", { params: { inviteId: inv.result.invite.id, accept: true } }, member);

    const mine = await lensRun("alliance", "message-send", { params: { channelId, content: "member note" } }, member);
    const messageId = mine.result.message.id;
    const owners = await lensRun("alliance", "message-send", { params: { channelId, content: "owner note" } }, owner);
    const ownerMessageId = owners.result.message.id;

    const denied = await lensRun("alliance", "message-delete", { params: { channelId, messageId: ownerMessageId } }, member);
    assert.equal(denied.result.ok, false);
    assert.match(denied.result.error, /author or admin/);

    const author = await lensRun("alliance", "message-delete", { params: { channelId, messageId } }, member);
    assert.equal(author.ok, true);
    const admin = await lensRun("alliance", "message-delete", { params: { channelId, messageId: ownerMessageId } }, owner);
    assert.equal(admin.ok, true);

    const listed = await lensRun("alliance", "message-list", { params: { channelId } }, member);
    const contents = JSON.stringify(listed.result);
    assert.equal(contents.includes("member note"), false);
    assert.equal(contents.includes("owner note"), false);
    const lens = await hydratedLens();
    const msgs = lens.messages.get(channelId) || [];
    assert.equal(msgs.some((m) => m.id === messageId || m.id === ownerMessageId), false);
  });

  it("author or admin can delete a proposal; another member cannot; it stays gone", async () => {
    const created = await lensRun("alliance", "alliance-create", { params: { name: "INC54 Proposals" } }, owner);
    const allianceId = created.result.alliance.id;
    const inv = await lensRun("alliance", "invite-create", { params: { allianceId, handle: "bea-inc54" } }, owner);
    await lensRun("alliance", "invite-respond", { params: { inviteId: inv.result.invite.id, accept: true } }, member);

    const byMember = await lensRun("alliance", "proposal-create", { params: { allianceId, title: "Member draft" } }, member);
    const memberProposal = byMember.result.proposal.id;
    const byOwner = await lensRun("alliance", "proposal-create", { params: { allianceId, title: "Owner draft" } }, owner);
    const ownerProposal = byOwner.result.proposal.id;

    const denied = await lensRun("alliance", "proposal-delete", { params: { allianceId, proposalId: ownerProposal } }, member);
    assert.equal(denied.result.ok, false);
    assert.match(denied.result.error, /author or admin/);

    const withdrawn = await lensRun("alliance", "proposal-delete", { params: { allianceId, proposalId: memberProposal } }, member);
    assert.equal(withdrawn.ok, true);
    const admin = await lensRun("alliance", "proposal-delete", { params: { allianceId, proposalId: ownerProposal } }, owner);
    assert.equal(admin.ok, true);

    const listed = await lensRun("alliance", "proposal-list", { params: { allianceId } }, member);
    assert.equal(listed.result.proposals.some((p) => p.id === memberProposal || p.id === ownerProposal), false);
    const lens = await hydratedLens();
    const props = lens.proposals.get(allianceId) || [];
    assert.equal(props.some((p) => p.id === memberProposal || p.id === ownerProposal), false);
  });
});
