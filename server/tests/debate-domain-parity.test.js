// Contract tests for the debate lens — Kialo-shape argument-tree
// substrate in server/domains/debate.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDebateActions from "../domains/debate.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`debate.${name}`);
  assert.ok(fn, `debate.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerDebateActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newDebate(ctx = ctxA) {
  return call("debate-create", ctx, { thesis: "Remote work improves productivity." }).result.debate;
}

describe("debate.debate CRUD", () => {
  it("creates a debate scoped per user", () => {
    newDebate();
    assert.equal(call("debate-list", ctxA, {}).result.count, 1);
    assert.equal(call("debate-list", ctxB, {}).result.count, 0);
  });
  it("rejects a too-short thesis", () => {
    assert.equal(call("debate-create", ctxA, { thesis: "short" }).ok, false);
  });
  it("deletes a debate", () => {
    const d = newDebate();
    call("debate-delete", ctxA, { id: d.id });
    assert.equal(call("debate-list", ctxA, {}).result.count, 0);
  });
});

describe("debate.claim tree", () => {
  it("adds pro/con claims and nests sub-claims", () => {
    const d = newDebate();
    const pro = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "Fewer commute hours." });
    assert.equal(pro.ok, true);
    call("claim-add", ctxA, { debateId: d.id, stance: "con", text: "Harder to collaborate." });
    const sub = call("claim-add", ctxA, { debateId: d.id, parentId: pro.result.claim.id, stance: "con", text: "But more distractions at home." });
    assert.equal(sub.ok, true);
    assert.equal(call("debate-detail", ctxA, { id: d.id }).result.debate.claims.length, 3);
  });
  it("rejects a claim under an unknown parent", () => {
    const d = newDebate();
    assert.equal(call("claim-add", ctxA, { debateId: d.id, parentId: "nope", text: "orphan claim" }).ok, false);
  });
  it("claim-delete cascades to sub-claims", () => {
    const d = newDebate();
    const pro = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "Parent claim here." }).result.claim;
    call("claim-add", ctxA, { debateId: d.id, parentId: pro.id, stance: "pro", text: "Child claim here." });
    const del = call("claim-delete", ctxA, { debateId: d.id, claimId: pro.id });
    assert.equal(del.result.deleted.length, 2);
    assert.equal(call("debate-detail", ctxA, { id: d.id }).result.debate.claims.length, 0);
  });
  it("claim-edit changes text and stance", () => {
    const d = newDebate();
    const c = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "Original claim." }).result.claim;
    call("claim-edit", ctxA, { debateId: d.id, claimId: c.id, text: "Edited claim text.", stance: "con" });
    const claim = call("debate-detail", ctxA, { id: d.id }).result.debate.claims[0];
    assert.equal(claim.text, "Edited claim text.");
    assert.equal(claim.stance, "con");
  });
});

describe("debate.scoring", () => {
  it("pro claims push support up, con claims pull it down", () => {
    const d = newDebate();
    call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "Strong pro point." });
    const afterPro = call("debate-detail", ctxA, { id: d.id }).result.score;
    assert.ok(afterPro.supportPct > 50);
    call("claim-add", ctxA, { debateId: d.id, stance: "con", text: "Strong con point." });
    const balanced = call("debate-detail", ctxA, { id: d.id }).result.score;
    assert.equal(balanced.supportPct, 50); // equal weight pro + con
  });
  it("votes shift a claim's weight and the thesis score", () => {
    const d = newDebate();
    const pro = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "A pro claim." }).result.claim;
    const con = call("claim-add", ctxA, { debateId: d.id, stance: "con", text: "A con claim." }).result.claim;
    call("claim-vote", ctxA, { debateId: d.id, claimId: pro.id, weight: 5 });
    call("claim-vote", ctxA, { debateId: d.id, claimId: con.id, weight: 1 });
    const score = call("debate-detail", ctxA, { id: d.id }).result.score;
    assert.ok(score.supportPct > 50);
  });
  it("debate-dashboard aggregates debates + claims", () => {
    const d = newDebate();
    call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "A claim here." });
    const dash = call("debate-dashboard", ctxA, {});
    assert.equal(dash.result.debates, 1);
    assert.equal(dash.result.totalClaims, 1);
  });
});

describe("debate — analysis macros still intact", () => {
  it("fallacyCheck handles input", () => {
    const r = call("fallacyCheck", ctxA, {});
    assert.equal(r.ok, true);
  });
});

/* ── Kialo parity backlog ───────────────────────────────────────── */

describe("debate — per-claim impact propagation", () => {
  it("claim-impact rates a claim and reports the ancestor chain", () => {
    const d = newDebate();
    const root = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "Saves commute time" }).result.claim;
    const child = call("claim-add", ctxA, { debateId: d.id, parentId: root.id, stance: "pro", text: "Two hours daily reclaimed" }).result.claim;
    const r = call("claim-impact", ctxA, { debateId: d.id, claimId: child.id, impact: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.impact, 5);
    assert.ok(r.result.propagatesTo.some((p) => p.id === root.id));
  });

  it("higher impact on a pro sub-claim raises the parent effective strength", () => {
    const d = newDebate();
    const root = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "Productivity rises" }).result.claim;
    const child = call("claim-add", ctxA, { debateId: d.id, parentId: root.id, stance: "pro", text: "Fewer office distractions" }).result.claim;
    call("claim-impact", ctxA, { debateId: d.id, claimId: child.id, impact: 1 });
    const lowEff = call("debate-detail", ctxA, { id: d.id }).result.debate.claims.find((c) => c.id === root.id).effective;
    call("claim-impact", ctxA, { debateId: d.id, claimId: child.id, impact: 5 });
    const highEff = call("debate-detail", ctxA, { id: d.id }).result.debate.claims.find((c) => c.id === root.id).effective;
    assert.ok(highEff > lowEff);
  });

  it("claim-impact clamps to 1-5", () => {
    const d = newDebate();
    const c = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "An argument" }).result.claim;
    assert.equal(call("claim-impact", ctxA, { debateId: d.id, claimId: c.id, impact: 99 }).result.impact, 5);
    assert.equal(call("claim-impact", ctxA, { debateId: d.id, claimId: c.id, impact: -3 }).result.impact, 1);
  });

  it("claim-impact rejects an unknown claim", () => {
    const d = newDebate();
    assert.equal(call("claim-impact", ctxA, { debateId: d.id, claimId: "nope", impact: 3 }).ok, false);
  });
});

describe("debate — claim sourcing", () => {
  it("source-add attaches a citation with a valid url", () => {
    const d = newDebate();
    const c = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "Backed by data" }).result.claim;
    const r = call("source-add", ctxA, { debateId: d.id, claimId: c.id, title: "2025 Remote Work Study", url: "https://example.org/study", kind: "study" });
    assert.equal(r.ok, true);
    assert.equal(r.result.sourceCount, 1);
    assert.equal(r.result.source.kind, "study");
  });

  it("source-add rejects a malformed url", () => {
    const d = newDebate();
    const c = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "A claim" }).result.claim;
    const r = call("source-add", ctxA, { debateId: d.id, claimId: c.id, title: "Bad link", url: "ftp://x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /http/);
  });

  it("source-add allows a note-only source (empty url)", () => {
    const d = newDebate();
    const c = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "A claim" }).result.claim;
    assert.equal(call("source-add", ctxA, { debateId: d.id, claimId: c.id, title: "Field interviews", note: "Observed firsthand" }).ok, true);
  });

  it("source-delete removes a source", () => {
    const d = newDebate();
    const c = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "A claim" }).result.claim;
    const src = call("source-add", ctxA, { debateId: d.id, claimId: c.id, title: "Source one", url: "https://example.org" }).result.source;
    assert.equal(call("source-delete", ctxA, { debateId: d.id, claimId: c.id, sourceId: src.id }).ok, true);
    const detail = call("debate-detail", ctxA, { id: d.id }).result.debate.claims.find((x) => x.id === c.id);
    assert.equal(detail.sources.length, 0);
  });
});

describe("debate — multi-thesis positions", () => {
  it("position-add registers a named position", () => {
    const d = newDebate();
    const r = call("position-add", ctxA, { debateId: d.id, label: "Rail-first", summary: "Invest in heavy rail" });
    assert.equal(r.ok, true);
    assert.equal(r.result.positions.length, 1);
  });

  it("position-add rejects a duplicate label", () => {
    const d = newDebate();
    call("position-add", ctxA, { debateId: d.id, label: "Rail-first" });
    const r = call("position-add", ctxA, { debateId: d.id, label: "rail-first" });
    assert.equal(r.ok, false);
    assert.match(r.error, /already exists/);
  });

  it("position-scores ranks positions by attached claim strength", () => {
    const d = newDebate();
    const p1 = call("position-add", ctxA, { debateId: d.id, label: "Rail-first" }).result.position;
    const p2 = call("position-add", ctxA, { debateId: d.id, label: "Bus-first" }).result.position;
    call("claim-add", ctxA, { debateId: d.id, positionId: p1.id, stance: "pro", text: "Rail moves more people" });
    call("claim-add", ctxA, { debateId: d.id, positionId: p1.id, stance: "pro", text: "Lower emissions per trip" });
    call("claim-add", ctxA, { debateId: d.id, positionId: p2.id, stance: "pro", text: "Buses are cheaper" });
    const r = call("position-scores", ctxA, { debateId: d.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.leader, "Rail-first");
  });

  it("position-delete detaches claims that referenced it", () => {
    const d = newDebate();
    const p1 = call("position-add", ctxA, { debateId: d.id, label: "Rail-first" }).result.position;
    const c = call("claim-add", ctxA, { debateId: d.id, positionId: p1.id, stance: "pro", text: "A claim" }).result.claim;
    call("position-delete", ctxA, { debateId: d.id, positionId: p1.id });
    const detail = call("debate-detail", ctxA, { id: d.id }).result.debate.claims.find((x) => x.id === c.id);
    assert.equal(detail.positionId, null);
  });

  it("claim-add rejects an unknown position", () => {
    const d = newDebate();
    assert.equal(call("claim-add", ctxA, { debateId: d.id, positionId: "nope", stance: "pro", text: "A claim" }).ok, false);
  });
});

describe("debate — sharing / public read-only links", () => {
  it("debate-share mints a token; shared-view returns a read-only tree", () => {
    const d = newDebate();
    call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "A supporting claim" });
    const share = call("debate-share", ctxA, { debateId: d.id });
    assert.equal(share.ok, true);
    assert.equal(share.result.shared, true);
    const view = call("shared-view", ctxB, { shareToken: share.result.shareToken });
    assert.equal(view.ok, true);
    assert.equal(view.result.readOnly, true);
    assert.equal(view.result.debate.claims.length, 1);
  });

  it("debate-share revoke invalidates the token", () => {
    const d = newDebate();
    const share = call("debate-share", ctxA, { debateId: d.id });
    call("debate-share", ctxA, { debateId: d.id, revoke: true });
    assert.equal(call("shared-view", ctxB, { shareToken: share.result.shareToken }).ok, false);
  });

  it("shared-view rejects an unknown token", () => {
    assert.equal(call("shared-view", ctxB, { shareToken: "shr_bogus" }).ok, false);
  });
});

describe("debate — recursive tree shape for the argument map UI", () => {
  it("debate-detail returns claims with parentId, effective strength and stance for collapse/expand rendering", () => {
    const d = newDebate();
    const root = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "Root claim" }).result.claim;
    call("claim-add", ctxA, { debateId: d.id, parentId: root.id, stance: "con", text: "Nested counter" });
    const claims = call("debate-detail", ctxA, { id: d.id }).result.debate.claims;
    const rootRow = claims.find((c) => c.id === root.id);
    assert.equal(rootRow.parentId, null);
    assert.equal(typeof rootRow.effective, "number");
    assert.ok(claims.some((c) => c.parentId === root.id && c.stance === "con"));
  });

  it("recursive nesting works to arbitrary depth", () => {
    const d = newDebate();
    let parent = call("claim-add", ctxA, { debateId: d.id, stance: "pro", text: "Depth-0 claim" }).result.claim;
    for (let i = 1; i <= 4; i++) {
      parent = call("claim-add", ctxA, {
        debateId: d.id, parentId: parent.id,
        stance: i % 2 ? "con" : "pro", text: `Depth-${i} claim`,
      }).result.claim;
    }
    assert.equal(call("debate-detail", ctxA, { id: d.id }).result.debate.claims.length, 5);
  });
});

describe("debate — dashboard reflects new substrate", () => {
  it("dashboard counts positions, sources and shared debates", () => {
    const d = newDebate();
    const p = call("position-add", ctxA, { debateId: d.id, label: "Position One" }).result.position;
    const c = call("claim-add", ctxA, { debateId: d.id, positionId: p.id, stance: "pro", text: "A claim" }).result.claim;
    call("source-add", ctxA, { debateId: d.id, claimId: c.id, title: "A source", url: "https://example.org" });
    call("debate-share", ctxA, { debateId: d.id });
    const r = call("debate-dashboard", ctxA, {});
    assert.equal(r.result.totalPositions, 1);
    assert.equal(r.result.totalSources, 1);
    assert.equal(r.result.sharedDebates, 1);
  });
});
