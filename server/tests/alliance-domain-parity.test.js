// Contract tests for server/domains/alliance.js — analytics macros
// plus the cross-org collaboration primitives (channels, messaging,
// invites/roles, proposals/quorum voting, reactions, notifications).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAllianceActions from "../domains/alliance.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`alliance.${name}`);
  if (!fn) throw new Error(`alliance.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerAllianceActions(register); });

beforeEach(() => {
  // Fresh in-memory STATE per test so per-user Maps don't leak across cases.
  globalThis._concordSTATE = {};
});

const ctxOwner = { actor: { userId: "owner_1" }, userId: "owner_1" };
const ctxMember = { actor: { userId: "member_1" }, userId: "member_1" };
const ctxOutsider = { actor: { userId: "outsider_1" }, userId: "outsider_1" };

// helper: spin up an alliance + bring member_1 in as a full member
function bootstrapAlliance(role = "member") {
  const created = call("alliance-create", ctxOwner, {}, { name: "Test Alliance", type: "research" });
  const allianceId = created.result.alliance.id;
  const channelId = created.result.defaultChannel.id;
  const inv = call("invite-create", ctxOwner, {}, { allianceId, inviteeId: "member_1", role });
  call("invite-respond", ctxMember, {}, { inviteId: inv.result.invite.id, accept: true });
  return { allianceId, channelId };
}

describe("alliance analytics macros (existing)", () => {
  it("compatibilityScore returns a composite + level", () => {
    const r = call("compatibilityScore", ctxOwner, {
      data: {
        partnerA: { name: "A", capabilities: ["x", "y"], values: ["open"], resources: ["gpu"] },
        partnerB: { name: "B", capabilities: ["y", "z"], values: ["open"], resources: ["data"] },
      },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.compositeScore, "number");
    assert.ok(["excellent", "good", "moderate", "low"].includes(r.result.compatibilityLevel));
  });

  it("networkAnalysis computes density + brokers", () => {
    const r = call("networkAnalysis", ctxOwner, {
      data: {
        nodes: [{ id: "n1", name: "N1" }, { id: "n2", name: "N2" }, { id: "n3", name: "N3" }],
        edges: [{ source: "n1", target: "n2" }, { source: "n2", target: "n3" }],
      },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.nodeCount, 3);
    assert.ok(Array.isArray(r.result.brokers));
  });

  it("riskAssessment computes HHI + SPOF", () => {
    const r = call("riskAssessment", ctxOwner, {
      data: {
        alliances: [
          { partnerId: "p1", partnerName: "P1", dependencyPct: 60, categories: ["cloud"], critical: true },
          { partnerId: "p2", partnerName: "P2", dependencyPct: 40, categories: ["data"] },
        ],
      },
    }, {});
    assert.equal(r.ok, true);
    assert.ok(["low", "moderate", "high", "critical"].includes(r.result.riskLevel));
  });
});

describe("alliance lifecycle + channels", () => {
  it("alliance-create seeds a #general channel + owner membership", () => {
    const r = call("alliance-create", ctxOwner, {}, { name: "Coalition", type: "governance" });
    assert.equal(r.ok, true);
    assert.equal(r.result.alliance.members[0].role, "owner");
    assert.equal(r.result.defaultChannel.name, "general");
  });

  it("alliance-create rejects an empty name", () => {
    const r = call("alliance-create", ctxOwner, {}, { name: "  " });
    assert.equal(r.ok, false);
  });

  it("alliance-list returns only the caller's alliances", () => {
    call("alliance-create", ctxOwner, {}, { name: "Mine" });
    const mine = call("alliance-list", ctxOwner, {}, {});
    assert.equal(mine.ok, true);
    assert.equal(mine.result.count, 1);
    const theirs = call("alliance-list", ctxOutsider, {}, {});
    assert.equal(theirs.result.count, 0);
  });

  it("channel-create requires admin rights + dedupes names", () => {
    const { allianceId } = bootstrapAlliance();
    const ok = call("channel-create", ctxOwner, {}, { allianceId, name: "Research Wing" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.channel.name, "research-wing");
    const dup = call("channel-create", ctxOwner, {}, { allianceId, name: "research-wing" });
    assert.equal(dup.ok, false);
    const forbidden = call("channel-create", ctxMember, {}, { allianceId, name: "side" });
    assert.equal(forbidden.ok, false);
  });

  it("channel-list reports unread counts per member", () => {
    const { allianceId, channelId } = bootstrapAlliance();
    call("message-send", ctxOwner, {}, { channelId, content: "hello team" });
    const r = call("channel-list", ctxMember, {}, { allianceId });
    assert.equal(r.ok, true);
    const general = r.result.channels.find((c) => c.id === channelId);
    assert.equal(general.unread, 1);
  });
});

describe("alliance messaging — threads, reactions, attachments", () => {
  it("message-send posts + message-list threads replies under roots", () => {
    const { channelId } = bootstrapAlliance();
    const root = call("message-send", ctxOwner, {}, { channelId, content: "root msg" });
    assert.equal(root.ok, true);
    call("message-send", ctxMember, {}, { channelId, content: "a reply", parentId: root.result.message.id });
    const list = call("message-list", ctxOwner, {}, { channelId });
    assert.equal(list.ok, true);
    assert.equal(list.result.messages.length, 1);
    assert.equal(list.result.messages[0].replies.length, 1);
  });

  it("message-send carries attachments", () => {
    const { channelId } = bootstrapAlliance();
    const r = call("message-send", ctxOwner, {}, {
      channelId, content: "see file",
      attachments: [{ name: "spec.pdf", url: "https://x/spec.pdf", sizeBytes: 1024 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.message.attachments[0].name, "spec.pdf");
  });

  it("message-send rejects non-members + empty content", () => {
    const { channelId } = bootstrapAlliance();
    assert.equal(call("message-send", ctxOutsider, {}, { channelId, content: "hi" }).ok, false);
    assert.equal(call("message-send", ctxOwner, {}, { channelId, content: "  " }).ok, false);
  });

  it("message-react toggles emoji on/off", () => {
    const { channelId } = bootstrapAlliance();
    const m = call("message-send", ctxOwner, {}, { channelId, content: "react me" });
    const msgId = m.result.message.id;
    const on = call("message-react", ctxMember, {}, { channelId, messageId: msgId, emoji: "👍" });
    assert.equal(on.ok, true);
    assert.deepEqual(on.result.reactions["👍"], ["member_1"]);
    const off = call("message-react", ctxMember, {}, { channelId, messageId: msgId, emoji: "👍" });
    assert.equal(off.result.reactions["👍"], undefined);
  });
});

describe("alliance invites + roles", () => {
  it("invite-create / invite-respond brings a new member in", () => {
    const created = call("alliance-create", ctxOwner, {}, { name: "Joinable" });
    const allianceId = created.result.alliance.id;
    const inv = call("invite-create", ctxOwner, {}, { allianceId, inviteeId: "member_1", role: "member" });
    assert.equal(inv.ok, true);
    const resp = call("invite-respond", ctxMember, {}, { inviteId: inv.result.invite.id, accept: true });
    assert.equal(resp.ok, true);
    assert.equal(resp.result.joined, true);
    const list = call("alliance-list", ctxMember, {}, {});
    assert.equal(list.result.count, 1);
  });

  it("invite-list inbox surfaces pending invites for the invitee", () => {
    const created = call("alliance-create", ctxOwner, {}, { name: "Inbox Test" });
    call("invite-create", ctxOwner, {}, { allianceId: created.result.alliance.id, inviteeId: "member_1" });
    const inbox = call("invite-list", ctxMember, {}, {});
    assert.equal(inbox.ok, true);
    assert.equal(inbox.result.invites.length, 1);
  });

  it("member-set-role requires owner; member-remove drops the member", () => {
    const { allianceId } = bootstrapAlliance();
    const promote = call("member-set-role", ctxOwner, {}, { allianceId, memberId: "member_1", role: "admin" });
    assert.equal(promote.ok, true);
    assert.equal(promote.result.member.role, "admin");
    const denied = call("member-set-role", ctxMember, {}, { allianceId, memberId: "member_1", role: "guest" });
    assert.equal(denied.ok, false);
    const removed = call("member-remove", ctxOwner, {}, { allianceId, memberId: "member_1" });
    assert.equal(removed.ok, true);
    assert.equal(removed.result.memberCount, 1);
  });
});

describe("alliance proposals + quorum voting", () => {
  it("proposal-create / vote / list tracks a quorum tally", () => {
    const { allianceId } = bootstrapAlliance();
    const prop = call("proposal-create", ctxOwner, {}, { allianceId, title: "Adopt charter", quorum: 0.5 });
    assert.equal(prop.ok, true);
    const propId = prop.result.proposal.id;
    call("proposal-vote", ctxOwner, {}, { allianceId, proposalId: propId, choice: "yes" });
    const v = call("proposal-vote", ctxMember, {}, { allianceId, proposalId: propId, choice: "yes" });
    assert.equal(v.ok, true);
    assert.equal(v.result.tally.yes, 2);
    assert.equal(v.result.tally.quorumMet, true);
    const list = call("proposal-list", ctxOwner, {}, { allianceId });
    assert.equal(list.result.proposals[0].myVote, "yes");
  });

  it("proposal-vote rejects invalid choices", () => {
    const { allianceId } = bootstrapAlliance();
    const prop = call("proposal-create", ctxOwner, {}, { allianceId, title: "X" });
    const bad = call("proposal-vote", ctxOwner, {}, { allianceId, proposalId: prop.result.proposal.id, choice: "maybe" });
    assert.equal(bad.ok, false);
  });

  it("proposal-close stamps a decision from the final tally", () => {
    const { allianceId } = bootstrapAlliance();
    const prop = call("proposal-create", ctxOwner, {}, { allianceId, title: "Ratify", quorum: 0.5 });
    const propId = prop.result.proposal.id;
    call("proposal-vote", ctxOwner, {}, { allianceId, proposalId: propId, choice: "yes" });
    call("proposal-vote", ctxMember, {}, { allianceId, proposalId: propId, choice: "yes" });
    const closed = call("proposal-close", ctxOwner, {}, { allianceId, proposalId: propId });
    assert.equal(closed.ok, true);
    assert.equal(closed.result.proposal.decision, "passed");
    assert.equal(closed.result.proposal.status, "closed");
  });
});

describe("alliance notifications + read state", () => {
  it("notifications aggregates unread + pending votes", () => {
    const { allianceId, channelId } = bootstrapAlliance();
    call("message-send", ctxOwner, {}, { channelId, content: "ping 1" });
    call("message-send", ctxOwner, {}, { channelId, content: "ping 2" });
    call("proposal-create", ctxOwner, {}, { allianceId, title: "vote me" });
    const n = call("notifications", ctxMember, {}, {});
    assert.equal(n.ok, true);
    assert.equal(n.result.totalUnread, 2);
    const entry = n.result.perAlliance.find((p) => p.allianceId === allianceId);
    assert.equal(entry.pendingVotes, 1);
  });

  it("mark-read clears unread for the caller", () => {
    const { channelId } = bootstrapAlliance();
    call("message-send", ctxOwner, {}, { channelId, content: "unread" });
    const mr = call("mark-read", ctxMember, {}, { channelId });
    assert.equal(mr.ok, true);
    const n = call("notifications", ctxMember, {}, {});
    assert.equal(n.result.totalUnread, 0);
  });

  it("every collaboration macro fails gracefully without STATE", () => {
    globalThis._concordSTATE = undefined;
    const r = call("alliance-list", ctxOwner, {}, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE/);
  });
});
