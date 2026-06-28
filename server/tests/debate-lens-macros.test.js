// Phase-2 gate (component↔handler field-alignment) tests for server/domains/debate.js
// — the LENS_ACTIONS (registerLensAction) macros driven by the /lenses/debate page
// + concord-frontend/components/debate/{DebateActionPanel,KialoArgumentMap,
// SharedDebateView} through /api/lens/run and /api/lens/:domain/:id/run.
//
// DISPATCH SHAPE (mirrored exactly here):
//   • Kialo + SharedDebateView call lensRun(domain, action, input) → POST
//     /api/lens/run → the route builds virtualArtifact = {data: peel(input)} and
//     invokes handler(ctx, virtualArtifact, peel(input)). So data === 3rd-param.
//     `call()` mirrors both the wrapper-peel and the dual binding.
//   • The "AI Analysis Actions" (page.tsx) + DebateActionPanel call
//     useRunArtifact → POST /api/lens/:domain/:id/run → runMacro("lens","run",
//     {id,action,params}) → handler(ctx, REAL_artifact, params). The real artifact's
//     .data is the live debate created via useLensData (shape: {topic,
//     proArguments[], conArguments[], proVotes, conVotes, format, ...}). page.tsx
//     sends NO params (handler derives from the debate); DebateActionPanel sends
//     {text}/{side,arguments}/{} params. `callArtifact()` mirrors that path.
//
// SCOPE: this is the ONLY field-alignment / validation gate for the debate lens
// (no debate-domain-parity test exists). It pins:
//   (1) COMPONENT-EXACT field alignment — drive the EXACT input each surface sends
//       and assert the EXACT field names it renders from r.result, BOTH directions.
//       (This catches the dead-surface class: DebateActionPanel previously rendered
//       result.fallacies/.strengthened/.proScore that the handler never returned, and
//       the AI actions previously dead-ended on the "message" branch because they
//       read artifact.data.{claim,position,sides,text} which the live debate lacks.)
//   (2) VALIDATION-REJECTION — too-short thesis/claim/label/url → {ok:false,error:string}.
//   (3) DEGRADE-GRACEFUL — empty/absent input → stable {ok:true,result.message} (never throw).
//   (4) FAIL-CLOSED POISON — NaN/Infinity/non-string/non-array inputs never throw; numeric
//       poison on the impact/vote/weight clamps; STATE-unavailable degrades to {ok:false}.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDebateActions from "../domains/debate.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "debate", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// /api/lens/run path: peel one redundant artifact wrapper, bind data === 3rd-param.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`debate.${name} not registered`);
  const data = peelRedundantArtifactWrapper(input || {});
  const virtualArtifact = { id: null, domain: "debate", type: "domain_action", data, meta: {} };
  return fn(ctx, virtualArtifact, data);
}

// /api/lens/:domain/:id/run path: a REAL artifact (its .data is the stored debate)
// + a separate params object (page.tsx sends {}, DebateActionPanel sends {text}/{side}…).
function callArtifact(name, ctx, artifactData = {}, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`debate.${name} not registered`);
  const virtualArtifact = { id: "art_1", domain: "debate", type: "snapshot", data: artifactData, meta: {} };
  return fn(ctx, virtualArtifact, params);
}

before(() => {
  registerDebateActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { debateLens: { debates: new Map() } };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "debate_user_a" }, userId: "debate_user_a" };
const ctxB = { actor: { userId: "debate_user_b" }, userId: "debate_user_b" };

// A live debate exactly as useLensData stores it (the artifact.data the AI actions see).
const liveDebate = {
  topic: "Should the city ban single-use plastics?",
  description: "Environmental policy debate",
  status: "open",
  format: "structured",
  proArguments: [
    { author: "Ana", text: "Banning plastics reduces ocean pollution, since studies show 8 million tonnes enter the sea yearly.", votes: 3 },
    { author: "Bo", text: "Reusable alternatives are now cheap and widely available everywhere.", votes: 1 },
  ],
  conArguments: [
    { author: "Cy", text: "A ban will inevitably lead to job losses in the packaging industry, a domino effect.", votes: 2 },
  ],
  proVotes: 4,
  conVotes: 2,
};

// ───────────────────────────────────────────────────────────────────────────
// 1. evaluateArgument — page.tsx "Evaluate Argument" panel.
//    Renders r.result.{overallScore, evidenceScore, reasoningScore, strength,
//    fallaciesDetected[], addressesCounterpoints}.
// ───────────────────────────────────────────────────────────────────────────
describe("debate.evaluateArgument — page.tsx Evaluate Argument panel", () => {
  it("COMPONENT-EXACT: derives from the live debate artifact (no params) and returns every rendered field", () => {
    const r = callArtifact("evaluateArgument", ctxA, liveDebate, {});
    assert.equal(r.ok, true);
    const res = r.result;
    assert.ok(Number.isFinite(res.overallScore), "overallScore numeric");
    assert.ok(Number.isFinite(res.evidenceScore));
    assert.ok(Number.isFinite(res.reasoningScore));
    assert.ok(["strong", "moderate", "weak"].includes(res.strength));
    assert.ok(Array.isArray(res.fallaciesDetected));
    assert.equal(typeof res.addressesCounterpoints, "boolean");
    assert.equal(typeof res.claim, "string");
    assert.ok(res.claim.length > 0, "claim derived from real debate, not blank");
  });

  it("REAL-COMPUTE: 'inevitably'/'domino' reasoning surfaces a slippery-slope-class fallacy flag", () => {
    const r = callArtifact("evaluateArgument", ctxA, {
      topic: "Test", proArguments: [], conArguments: [{ text: "This always leads to ruin and everyone knows it." }],
    }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.fallaciesDetected.length >= 1, "expected a fallacy from 'always'/'everyone knows'");
  });

  it("DEGRADE-GRACEFUL: an empty debate (no topic, no args) → {ok:true, result.message}", () => {
    const r = callArtifact("evaluateArgument", ctxA, { proArguments: [], conArguments: [] }, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
    assert.ok(!("overallScore" in r.result));
  });

  it("FAIL-CLOSED POISON: non-string topic / non-array args never throw", () => {
    for (const bad of [{ topic: 9999, proArguments: 42, conArguments: { x: 1 } }, { topic: { a: 1 } }, { proArguments: "str" }]) {
      const r = callArtifact("evaluateArgument", ctxA, bad, {});
      assert.equal(r.ok !== undefined, true);
      assert.notEqual(r.ok, undefined);
      assert.ok(r.ok === true || r.ok === false, "never throws");
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. fallacyCheck — DebateActionPanel "Fallacy check" + page.tsx Fallacy Check.
//    page.tsx renders r.result.{count, textLength, logicalSoundness,
//    fallaciesDetected[].{fallacy,description}}. DebateActionPanel sends {text}
//    params and renders the SAME field names.
// ───────────────────────────────────────────────────────────────────────────
describe("debate.fallacyCheck — DebateActionPanel + page.tsx", () => {
  it("COMPONENT-EXACT: DebateActionPanel {text} params → fallaciesDetected[].{fallacy,description} + count + logicalSoundness", () => {
    const r = callArtifact("fallacyCheck", ctxA, liveDebate, { text: "A ban will inevitably lead to job losses, a domino effect, and either we ban or society collapses." });
    assert.equal(r.ok, true);
    const res = r.result;
    assert.ok(Number.isFinite(res.count) && res.count >= 1, "expected fallacies from 'inevitably'/'either…or'");
    assert.ok(Number.isFinite(res.textLength) && res.textLength > 0);
    assert.ok(["appears-sound", "minor-issues", "significant-issues"].includes(res.logicalSoundness));
    assert.ok(Array.isArray(res.fallaciesDetected) && res.fallaciesDetected.length >= 1);
    assert.equal(typeof res.fallaciesDetected[0].fallacy, "string");
    assert.equal(typeof res.fallaciesDetected[0].description, "string");
  });

  it("COMPONENT-EXACT: page.tsx (no params) derives the blob from the live debate's pro/con args", () => {
    const r = callArtifact("fallacyCheck", ctxA, liveDebate, {});
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(res(r).textLength) && res(r).textLength > 0, "text derived from debate args");
    assert.ok(Number.isFinite(res(r).count));
  });

  it("DEGRADE-GRACEFUL: empty debate + no params → {ok:true, result.message}", () => {
    const r = callArtifact("fallacyCheck", ctxA, { proArguments: [], conArguments: [] }, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
  });

  it("FAIL-CLOSED POISON: non-string text param / poisoned args never throw on .test()/.trim()", () => {
    for (const bad of [9999, { x: 1 }, [1, 2], true, Infinity, NaN]) {
      const r = callArtifact("fallacyCheck", ctxA, { proArguments: [null, { text: 123 }] }, { text: bad });
      assert.equal(r.ok, true, `poison ${JSON.stringify(bad)} should degrade, not throw`);
      assert.ok("message" in r.result || Number.isFinite(r.result.count));
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. steelmanPosition — DebateActionPanel "Steelman" + page.tsx Steelman.
//    Both render r.result.{steelmanSteps[], framework{premise,evidence,conclusion},
//    originalLength}. page.tsx also reads originalPosition for the word count.
// ───────────────────────────────────────────────────────────────────────────
describe("debate.steelmanPosition — DebateActionPanel + page.tsx", () => {
  it("COMPONENT-EXACT: {side,arguments} params → steelmanSteps[] + framework + originalLength + side", () => {
    const r = callArtifact("steelmanPosition", ctxA, liveDebate, { side: "con", arguments: liveDebate.conArguments.map(a => a.text) });
    assert.equal(r.ok, true);
    const out = r.result;
    assert.equal(out.side, "con");
    assert.ok(Array.isArray(out.steelmanSteps) && out.steelmanSteps.length >= 3);
    assert.equal(typeof out.steelmanSteps[0], "string");
    assert.ok(out.framework && typeof out.framework.premise === "string" && typeof out.framework.evidence === "string" && typeof out.framework.conclusion === "string");
    assert.ok(Number.isFinite(out.originalLength) && out.originalLength > 0);
    assert.equal(typeof out.originalPosition, "string");
  });

  it("COMPONENT-EXACT: page.tsx (no params) derives the position from the debate's pro side", () => {
    const r = callArtifact("steelmanPosition", ctxA, liveDebate, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.originalLength > 0, "derived from real pro args, not blank");
    assert.ok(Array.isArray(r.result.steelmanSteps));
  });

  it("DEGRADE-GRACEFUL: empty debate + no params → {ok:true, result.message}", () => {
    const r = callArtifact("steelmanPosition", ctxA, { proArguments: [], conArguments: [] }, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
  });

  it("FAIL-CLOSED POISON: non-array arguments / non-string position never throw on .split()", () => {
    for (const bad of [{ position: 9999 }, { arguments: "str" }, { arguments: [null, 42] }, { position: { a: 1 } }]) {
      const r = callArtifact("steelmanPosition", ctxA, { proArguments: [], conArguments: [] }, bad);
      assert.equal(r.ok, true, `poison ${JSON.stringify(bad)} should degrade, not throw`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. scoreDebate — DebateActionPanel "Score debate" + page.tsx Score Debate.
//    Both render r.result.{sides[].{side,arguments,evidencePoints,rebuttals,score},
//    winner, margin, close}.
// ───────────────────────────────────────────────────────────────────────────
describe("debate.scoreDebate — DebateActionPanel + page.tsx", () => {
  it("COMPONENT-EXACT: derives two sides from the live debate's pro/con args + votes", () => {
    const r = callArtifact("scoreDebate", ctxA, liveDebate, {});
    assert.equal(r.ok, true);
    const out = r.result;
    assert.ok(Array.isArray(out.sides) && out.sides.length === 2);
    const s0 = out.sides[0];
    assert.equal(typeof s0.side, "string");
    assert.ok(Number.isFinite(s0.arguments) && Number.isFinite(s0.evidencePoints) && Number.isFinite(s0.rebuttals) && Number.isFinite(s0.score));
    assert.ok(Array.isArray(s0.highlights));
    assert.ok(["Pro", "Con"].includes(out.winner));
    assert.ok(Number.isFinite(out.margin));
    assert.equal(typeof out.close, "boolean");
  });

  it("REAL-COMPUTE: more pro args + votes → Pro wins with a positive margin", () => {
    const r = callArtifact("scoreDebate", ctxA, liveDebate, {});
    assert.equal(r.result.winner, "Pro");
    assert.ok(r.result.margin >= 0);
  });

  it("COMPONENT-EXACT: explicit {sides} params override the derivation", () => {
    const r = callArtifact("scoreDebate", ctxA, liveDebate, {
      sides: [
        { name: "Alpha", arguments: [{ claim: "x", evidence: [1, 2], rebuttal: true }] },
        { name: "Beta", arguments: [{ claim: "y" }] },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.winner, "Alpha");
    assert.equal(r.result.sides[0].evidencePoints, 2);
  });

  it("DEGRADE-GRACEFUL: a debate with no args → {ok:true, result.message}", () => {
    const r = callArtifact("scoreDebate", ctxA, { proArguments: [], conArguments: [] }, {});
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.message, "string");
  });

  it("FAIL-CLOSED POISON: poisoned proArguments/sides never throw", () => {
    for (const bad of [{ proArguments: 42, conArguments: "x" }, { sides: "notarray" }, { sides: [null, { arguments: 5 }] }]) {
      const r = callArtifact("scoreDebate", ctxA, bad, {});
      assert.ok(r.ok === true || r.ok === false, "never throws");
    }
  });
});

// helper: scoreDebate/fallacyCheck result peek without re-binding
function res(r) { return r.result; }

// ───────────────────────────────────────────────────────────────────────────
// 5. Kialo argument-tree macros (KialoArgumentMap.tsx) — /api/lens/run path.
//    Field alignment for the recursive impact-weighted claim tree.
// ───────────────────────────────────────────────────────────────────────────
describe("debate.debate-create / list / detail — KialoArgumentMap CRUD", () => {
  it("COMPONENT-EXACT: create → list returns DebateMeta{id,thesis,claimCount,positionCount,shared,shareToken,score,updatedAt}", () => {
    const c = call("debate-create", ctxA, { thesis: "AI should be open-sourced" });
    assert.equal(c.ok, true);
    assert.equal(typeof c.result.debate.id, "string");
    const l = call("debate-list", ctxA, {});
    assert.equal(l.ok, true);
    assert.ok(Array.isArray(l.result.debates) && l.result.debates.length === 1);
    const m = l.result.debates[0];
    assert.equal(typeof m.id, "string");
    assert.equal(typeof m.thesis, "string");
    assert.ok(Number.isFinite(m.claimCount) && Number.isFinite(m.positionCount));
    assert.equal(typeof m.shared, "boolean");
    assert.ok(m.score && Number.isFinite(m.score.supportPct) && typeof m.score.verdict === "string");
    assert.equal(typeof m.updatedAt, "string");
  });

  it("COMPONENT-EXACT: debate-detail returns debate.claims[].{positionId,impact,sources,weight,effective,voteCount} + score", () => {
    const c = call("debate-create", ctxA, { thesis: "Remote work is a net positive" });
    const id = c.result.debate.id;
    call("claim-add", ctxA, { debateId: id, stance: "pro", text: "It reduces commute emissions substantially." });
    const d = call("debate-detail", ctxA, { id });
    assert.equal(d.ok, true);
    assert.equal(typeof d.result.debate.thesis, "string");
    assert.ok(Array.isArray(d.result.debate.positions));
    const claim = d.result.debate.claims[0];
    assert.ok("positionId" in claim);
    assert.ok("impact" in claim);
    assert.ok(Array.isArray(claim.sources));
    assert.ok(Number.isFinite(claim.weight) && Number.isFinite(claim.effective) && Number.isFinite(claim.voteCount));
    assert.ok(d.result.score && Number.isFinite(d.result.score.supportPct));
  });

  it("VALIDATION-REJECTION: thesis < 8 chars → {ok:false, error:string}", () => {
    const r = call("debate-create", ctxA, { thesis: "short" });
    assert.equal(r.ok, false);
    assert.match(r.error, /8 characters/);
  });

  it("FAIL-CLOSED: STATE unavailable → {ok:false} (never throw)", () => {
    globalThis._concordSTATE = null;
    const r = call("debate-list", ctxA, {});
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  });

  it("FAIL-CLOSED POISON: debate-detail with poisoned id never throws", () => {
    const r = call("debate-detail", ctxA, { id: { nested: [1] } });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  });
});

describe("debate.claim-add / vote / impact / position — KialoArgumentMap tree ops", () => {
  function freshDebate(ctx = ctxA) {
    const c = call("debate-create", ctx, { thesis: "Universal basic income works" });
    return c.result.debate.id;
  }

  it("COMPONENT-EXACT: claim-add returns claim + score; the score is the same shape the tree reads", () => {
    const id = freshDebate();
    const r = call("claim-add", ctxA, { debateId: id, stance: "pro", text: "It eliminates extreme poverty.", positionId: null });
    assert.equal(r.ok, true);
    assert.equal(r.result.claim.stance, "pro");
    assert.equal(typeof r.result.claim.id, "string");
    assert.ok(Number.isFinite(r.result.score.supportPct));
  });

  it("VALIDATION-REJECTION: claim text < 4 chars / unknown parent → {ok:false}", () => {
    const id = freshDebate();
    assert.equal(call("claim-add", ctxA, { debateId: id, stance: "pro", text: "no" }).ok, false);
    assert.equal(call("claim-add", ctxA, { debateId: id, stance: "pro", text: "valid text", parentId: "nope" }).ok, false);
  });

  it("FAIL-CLOSED POISON: claim-vote / claim-impact clamp non-numeric weight/impact to [1,5], never throw", () => {
    const id = freshDebate();
    const ca = call("claim-add", ctxA, { debateId: id, stance: "pro", text: "Reduces inequality." });
    const claimId = ca.result.claim.id;
    for (const bad of [NaN, Infinity, "abc", -99, 99, { x: 1 }]) {
      const v = call("claim-vote", ctxA, { debateId: id, claimId, weight: bad });
      assert.equal(v.ok, true, `vote weight ${JSON.stringify(bad)} should clamp, not throw`);
      assert.ok(v.result.weight >= 1 && v.result.weight <= 5);
      const im = call("claim-impact", ctxA, { debateId: id, claimId, impact: bad });
      assert.equal(im.ok, true);
      assert.ok(im.result.impact >= 1 && im.result.impact <= 5);
    }
  });

  it("COMPONENT-EXACT: position-add → position-scores returns PositionScore{id,label,summary,claimCount,support,sharePct}", () => {
    const id = freshDebate();
    const pa = call("position-add", ctxA, { debateId: id, label: "Welfare reform", summary: "Replace patchwork programs" });
    assert.equal(pa.ok, true);
    const posId = pa.result.position.id;
    call("claim-add", ctxA, { debateId: id, stance: "pro", text: "Simplifies the system.", positionId: posId });
    const ps = call("position-scores", ctxA, { debateId: id });
    assert.equal(ps.ok, true);
    assert.ok(Array.isArray(ps.result.positions) && ps.result.positions.length === 1);
    const p = ps.result.positions[0];
    assert.equal(typeof p.id, "string");
    assert.equal(typeof p.label, "string");
    assert.ok(Number.isFinite(p.claimCount) && Number.isFinite(p.support) && Number.isFinite(p.sharePct));
  });

  it("VALIDATION-REJECTION: position label < 3 chars / duplicate → {ok:false}", () => {
    const id = freshDebate();
    assert.equal(call("position-add", ctxA, { debateId: id, label: "x" }).ok, false);
    assert.equal(call("position-add", ctxA, { debateId: id, label: "Reform" }).ok, true);
    assert.equal(call("position-add", ctxA, { debateId: id, label: "reform" }).ok, false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. source-add + share/shared-view — KialoArgumentMap sourcing + SharedDebateView.
// ───────────────────────────────────────────────────────────────────────────
describe("debate.source-add — KialoArgumentMap SourceForm", () => {
  it("COMPONENT-EXACT: returns {claimId, source{id,title,url,kind}, sourceCount}", () => {
    const id = call("debate-create", ctxA, { thesis: "Nuclear power is safe enough" }).result.debate.id;
    const claimId = call("claim-add", ctxA, { debateId: id, stance: "pro", text: "Low deaths per TWh." }).result.claim.id;
    const r = call("source-add", ctxA, { debateId: id, claimId, title: "Our World in Data", url: "https://ourworldindata.org/x", kind: "data", note: "deaths per TWh" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source.kind, "data");
    assert.equal(r.result.source.title, "Our World in Data");
    assert.ok(Number.isFinite(r.result.sourceCount) && r.result.sourceCount === 1);
  });

  it("VALIDATION-REJECTION: title < 3 chars / non-http url → {ok:false}", () => {
    const id = call("debate-create", ctxA, { thesis: "Coffee improves focus" }).result.debate.id;
    const claimId = call("claim-add", ctxA, { debateId: id, stance: "pro", text: "Caffeine boosts alertness." }).result.claim.id;
    assert.equal(call("source-add", ctxA, { debateId: id, claimId, title: "ab" }).ok, false);
    assert.equal(call("source-add", ctxA, { debateId: id, claimId, title: "Valid Title", url: "ftp://bad" }).ok, false);
  });
});

describe("debate.debate-share / shared-view — SharedDebateView read-only path", () => {
  it("COMPONENT-EXACT: share → shared-view returns {readOnly, debate{id,thesis,positions,claims[].{weight,voteCount,impact,sources}}, score}", () => {
    const id = call("debate-create", ctxA, { thesis: "Open borders are net positive" }).result.debate.id;
    call("claim-add", ctxA, { debateId: id, stance: "pro", text: "Free movement boosts GDP." });
    const sh = call("debate-share", ctxA, { debateId: id });
    assert.equal(sh.ok, true);
    assert.equal(sh.result.shared, true);
    const token = sh.result.shareToken;
    // SharedDebateView is reached by a DIFFERENT user (or anon) — no owner scoping.
    const sv = call("shared-view", ctxB, { shareToken: token });
    assert.equal(sv.ok, true);
    assert.equal(sv.result.readOnly, true);
    assert.equal(sv.result.debate.id, id);
    assert.ok(Array.isArray(sv.result.debate.positions));
    const c = sv.result.debate.claims[0];
    assert.ok(Number.isFinite(c.weight) && Number.isFinite(c.voteCount) && Array.isArray(c.sources));
    assert.ok(sv.result.score && Number.isFinite(sv.result.score.supportPct) && typeof sv.result.score.verdict === "string");
  });

  it("VALIDATION-REJECTION: unknown / revoked token → {ok:false, error:string}", () => {
    const r1 = call("shared-view", ctxB, { shareToken: "nope" });
    assert.equal(r1.ok, false);
    assert.equal(typeof r1.error, "string");
    const id = call("debate-create", ctxA, { thesis: "Daylight saving should end" }).result.debate.id;
    const tok = call("debate-share", ctxA, { debateId: id }).result.shareToken;
    call("debate-share", ctxA, { debateId: id, revoke: true });
    const r2 = call("shared-view", ctxB, { shareToken: tok });
    assert.equal(r2.ok, false);
  });

  it("FAIL-CLOSED POISON: shared-view with poisoned token never throws", () => {
    const r = call("shared-view", ctxB, { shareToken: { nested: 1 } });
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, "string");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 7. debate-dashboard — never throws, stable numeric shape.
// ───────────────────────────────────────────────────────────────────────────
describe("debate.debate-dashboard — stat tiles", () => {
  it("COMPONENT-EXACT: returns all-numeric {debates,totalClaims,totalPositions,totalSources,sharedDebates,wellSupported}", () => {
    call("debate-create", ctxA, { thesis: "Space exploration is worth funding" });
    const r = call("debate-dashboard", ctxA, {});
    assert.equal(r.ok, true);
    for (const k of ["debates", "totalClaims", "totalPositions", "totalSources", "sharedDebates", "wellSupported"]) {
      assert.ok(Number.isFinite(r.result[k]), `${k} numeric`);
    }
  });

  it("FAIL-CLOSED: STATE unavailable → {ok:false}", () => {
    globalThis._concordSTATE = null;
    const r = call("debate-dashboard", ctxA, {});
    assert.equal(r.ok, false);
  });
});
