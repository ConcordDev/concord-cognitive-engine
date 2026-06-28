// Behavioral macro tests for the collab lens — the PHASE-2 LENS-DRIVEN GAP layer.
// These pin the EXACT field contract the live frontend surface drives, so a green
// test can never coexist with a dead-in-production calculator (the failure mode
// where a handler-ideal-shape test passes while the rendered component reads
// undefined fields — the class that had silently killed sibling calculator
// surfaces in welding/hvac/retail/audit/voice before the 2026-06-28 alignment work).
//
// One real channel:
//   • CollabActionPanel.tsx → callMacro(action, { artifact: { data } }) →
//     apiHelpers.lens.runDomain('collab', action, { input: { artifact: { data } } })
//     → dispatch peels the redundant artifact wrapper → handler reads
//     artifact.data.* (== the peeled input here). Drives the 4 pure facilitation
//     calculators: sessionAnalytics, contributionScore, detectConsensus,
//     balanceWorkload.
//   (The CRDT co-editing / presence / comments / permissions / notifications
//    substrate — docCreate/docOp/docSync/cursorUpdate/addComment/etc — is the
//    stateful real-time surface, pinned elsewhere; it is NOT a calculator the
//    component's result cards read, so it is not duplicated here.)
//
// Asserted, with the EXACT input each calculator sends (cross-checked field-for-
// field against components/collab/CollabActionPanel.tsx) and the EXACT fields its
// result card renders:
//   - sessionAnalytics: input { durationMinutes, participants:string[], messages:
//     {author,content}[] } → renders totalMessages / balanceRating /
//     participationBalance / messagesPerMinute / participantStats[].{name,
//     sharePercent}. (handler also reads m.sender/m.text aliases.)
//   - contributionScore: input { contributions:{name,type,quality,count}[] } →
//     renders topContributor / totalContributions / rankings[].{name,totalScore,
//     contributions}.
//   - detectConsensus: input { votes:{voter,position}[] } → renders status /
//     totalVotes / consensusPercent / leadingPosition / hasConsensus /
//     hasSupermajority / dissenting[].{position,count,percent}.
//   - balanceWorkload: input { members:{name,capacityHours}[], tasks:{assignee?,
//     hours}[] } → renders avgUtilization / overloadedMembers / unassignedTasks /
//     members[].{name,status,utilization,totalHours,capacity,assignedTasks} /
//     suggestions[].
//   - VALIDATION-REJECTION: empty contributions / empty votes / empty members
//     return the empty-shape message, never a crash.
//   - DEGRADE-GRACEFUL: the 4 calculators are stateless pure compute — they
//     compute even with globalThis._concordSTATE gone (never throw).
//   - FAIL-CLOSED on poisoned numerics (NaN / Infinity / "abc" / "12abc"):
//     coercion is Number()+Number.isFinite (NOT parseFloat) so no NaN/Infinity
//     leaks into any rendered number, no crash, and a "12abc" prefix is REJECTED
//     to the default rather than silently accepted as 12.
//
// Hermetic: a local register harness mirrors the /api/lens/run dispatch
// (handler(ctx, virtualArtifact, input); virtualArtifact.data === input). No
// server boot, no network, no LLM, no DB.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCollabActions from "../domains/collab.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "collab", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror POST /api/lens/run: rest = peel(body.input); virtualArtifact.data ===
// rest AND the 3rd `params` arg === rest. So the calculators (read art.data) see
// the peeled input exactly as production does.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`collab.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const virtualArtifact = { id: null, domain: "collab", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

// EXACTLY the wrapper CollabActionPanel.callMacro builds before dispatch:
//   runDomain('collab', action, { input: { artifact: { data } } })
// → body.input === { artifact: { data } } → peel → data. Proves the double-wrap
// the component sends is correctly unwrapped end-to-end.
function callViaComponent(name, ctx, data = {}) {
  return call(name, ctx, { artifact: { data } });
}

before(() => {
  registerCollabActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxC = { actor: { userId: "collab_a", id: "collab_a" }, userId: "collab_a" };

// Helper: every numeric the component renders must be a real finite number
// (no NaN/Infinity leak). Strings are exempt; we scan only number-typed leaves.
function assertNoNonFiniteNumbers(obj, path = "result") {
  if (obj == null) return;
  if (typeof obj === "number") {
    assert.ok(Number.isFinite(obj), `${path} leaked a non-finite number: ${obj}`);
    return;
  }
  if (Array.isArray(obj)) { obj.forEach((v, i) => assertNoNonFiniteNumbers(v, `${path}[${i}]`)); return; }
  if (typeof obj === "object") { for (const [k, v] of Object.entries(obj)) assertNoNonFiniteNumbers(v, `${path}.${k}`); }
}

/* ───────── registration: every macro the lens channel drives ───────── */

describe("collab lens — registration of the driven calculators", () => {
  it("registers every macro CollabActionPanel drives", () => {
    for (const m of ["sessionAnalytics", "contributionScore", "detectConsensus", "balanceWorkload"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing collab.${m}`);
    }
  });
});

/* ───── component { artifact: { data } } wrapper is peeled end-to-end ───── */

describe("collab lens — component double-wrap is peeled at dispatch", () => {
  it("a sessionAnalytics call sent the way CollabActionPanel sends it reaches the handler's reader", () => {
    // If the redundant wrapper were NOT peeled, the handler would read undefined
    // participants/messages and return totalMessages 0 — the silent-dead class.
    // Drive the exact double-wrap and assert the REAL counts (3 msgs / 2 ppl) land.
    const r = callViaComponent("sessionAnalytics", ctxC, {
      durationMinutes: 30,
      participants: ["alice", "bob"],
      messages: [
        { author: "alice", content: "hello team" },
        { author: "alice", content: "let us start" },
        { author: "bob", content: "ready" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalMessages, 3, "the 3 real messages must reach the handler (not the empty 0 shape)");
    assert.equal(r.result.totalParticipants, 2);
  });
});

/* ───────────────────── sessionAnalytics ───────────────────── */

describe("collab.sessionAnalytics — EXACT fields the Session card renders", () => {
  it("renders totalMessages / balanceRating / participationBalance / messagesPerMinute / participantStats[].{name,sharePercent} with real computed values", () => {
    const r = callViaComponent("sessionAnalytics", ctxC, {
      durationMinutes: 20,
      participants: ["alice", "bob"],
      messages: [
        { author: "alice", content: "one two three" },   // 3 words
        { author: "alice", content: "four five" },        // 2 words
        { author: "alice", content: "six" },              // 1 word
        { author: "bob", content: "seven eight nine ten" }, // 4 words
      ],
    });
    assert.equal(r.ok, true);
    const x = r.result;
    // EXACT rendered fields (card reads x.totalMessages, x.balanceRating,
    // x.participationBalance, x.messagesPerMinute, x.participantStats[].name/.sharePercent):
    assert.equal(typeof x.totalMessages, "number");
    assert.equal(typeof x.balanceRating, "string");
    assert.equal(typeof x.participationBalance, "number");
    assert.equal(typeof x.messagesPerMinute, "number");
    assert.ok(Array.isArray(x.participantStats), "participantStats is the array the card maps");
    // real math:
    //   totalMessages = 4; alice 3 msgs, bob 1 msg.
    assert.equal(x.totalMessages, 4);
    assert.equal(x.totalParticipants, 2);
    assert.equal(x.durationMinutes, 20);
    //   messagesPerMinute = round(4/20 * 10)/10 = 0.2.
    assert.equal(x.messagesPerMinute, 0.2);
    const alice = x.participantStats.find((p) => p.name === "alice");
    const bob = x.participantStats.find((p) => p.name === "bob");
    assert.equal(alice.messages, 3);
    assert.equal(alice.wordCount, 6);              // 3+2+1
    assert.equal(alice.avgWordsPerMessage, 2);     // round(6/3)
    assert.equal(alice.sharePercent, 75);          // round(3/4*100)
    assert.equal(bob.messages, 1);
    assert.equal(bob.wordCount, 4);
    assert.equal(bob.sharePercent, 25);
    // gini over sorted shares [1,3], mean 2:
    //   i=0: (2*1-2-1)*1 = -1 ; i=1: (2*2-2-1)*3 = 3 ; sum = 2
    //   gini = round(2/(2^2 * 2) * 100)/100 = round(0.25 * 100)/100 = 0.25
    assert.equal(x.participationBalance, 0.25);
    assert.equal(x.balanceRating, "slightly-uneven"); // 0.2 ≤ gini 0.25 < 0.4
    assertNoNonFiniteNumbers(x);
  });

  it("a perfectly even split reads gini 0 / 'well-balanced'", () => {
    const r = callViaComponent("sessionAnalytics", ctxC, {
      durationMinutes: 10,
      participants: ["a", "b"],
      messages: [
        { author: "a", content: "x" },
        { author: "b", content: "y" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.participationBalance, 0);
    assert.equal(r.result.balanceRating, "well-balanced");
    assert.equal(r.result.totalMessages, 2);
    assertNoNonFiniteNumbers(r.result);
  });

  it("reads the m.sender / m.text aliases too (not only author/content)", () => {
    const r = callViaComponent("sessionAnalytics", ctxC, {
      durationMinutes: 5,
      participants: ["carol"],
      messages: [{ sender: "carol", text: "alpha beta" }],
    });
    assert.equal(r.ok, true);
    const carol = r.result.participantStats.find((p) => p.name === "carol");
    assert.equal(carol.messages, 1);
    assert.equal(carol.wordCount, 2);
  });

  it("EMPTY: no messages → totalMessages 0 / messagesPerMinute 0, finite shape, never a crash", () => {
    const r = callViaComponent("sessionAnalytics", ctxC, { durationMinutes: 45, participants: [], messages: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalMessages, 0);
    assert.equal(r.result.totalParticipants, 0);
    assert.equal(r.result.messagesPerMinute, 0);
    assert.equal(r.result.participationBalance, 0);
    assert.deepEqual(r.result.participantStats, []);
    assertNoNonFiniteNumbers(r.result);
  });
});

/* ───────────────────── contributionScore ───────────────────── */

describe("collab.contributionScore — EXACT fields the Contribution card renders", () => {
  it("renders topContributor / totalContributions / rankings[].{name,totalScore,contributions} with real computed values", () => {
    const r = callViaComponent("contributionScore", ctxC, {
      contributions: [
        { name: "alice", type: "code", quality: 1.0, count: 2 },   // weight 3 → score 300 ea
        { name: "bob", type: "review", quality: 0.8, count: 1 },   // weight 1.5 → score round(1.5*0.8*100)=120
      ],
    });
    assert.equal(r.ok, true);
    const x = r.result;
    assert.equal(typeof x.topContributor, "string");
    assert.equal(typeof x.totalContributions, "number");
    assert.ok(Array.isArray(x.rankings), "rankings is the array the card maps");
    for (const rk of x.rankings) {
      assert.equal(typeof rk.name, "string");
      assert.equal(typeof rk.totalScore, "number");
      assert.equal(typeof rk.contributions, "number");
    }
    // real math:
    //   alice: code score = round(3*1.0*100)=300, count 2 → total 600
    //   bob:   review score = round(1.5*0.8*100)=120, count 1 → total 120
    //   topContributor = alice; totalContributions = 2+1 = 3.
    const alice = x.rankings.find((rk) => rk.name === "alice");
    const bob = x.rankings.find((rk) => rk.name === "bob");
    assert.equal(alice.totalScore, 600);
    assert.equal(alice.contributions, 2);
    assert.equal(bob.totalScore, 120);
    assert.equal(x.topContributor, "alice");
    assert.equal(x.totalContributions, 3);
    // rankings are sorted descending by totalScore.
    assert.equal(x.rankings[0].name, "alice");
    assertNoNonFiniteNumbers(x);
  });

  it("reads the c.author alias when c.name is absent", () => {
    const r = callViaComponent("contributionScore", ctxC, {
      contributions: [{ author: "dana", type: "design", quality: 0.6, count: 1 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.topContributor, "dana");
    // design weight 2.5 → round(2.5*0.6*100)=150.
    assert.equal(r.result.rankings[0].totalScore, 150);
  });

  it("VALIDATION: no contributions → empty-shape message, never a crash", () => {
    const r = callViaComponent("contributionScore", ctxC, { contributions: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "Track contributions to calculate scores.");
  });
});

/* ───────────────────── detectConsensus ───────────────────── */

describe("collab.detectConsensus — EXACT fields the Vote card renders", () => {
  it("renders status / totalVotes / consensusPercent / leadingPosition / dissenting with real computed values", () => {
    const r = callViaComponent("detectConsensus", ctxC, {
      votes: [
        { voter: "a", position: "ship" },
        { voter: "b", position: "ship" },
        { voter: "c", position: "ship" },
        { voter: "d", position: "wait" },
      ],
    });
    assert.equal(r.ok, true);
    const x = r.result;
    assert.equal(typeof x.status, "string");
    assert.equal(typeof x.totalVotes, "number");
    assert.equal(typeof x.consensusPercent, "number");
    assert.equal(typeof x.leadingPosition, "string");
    assert.equal(typeof x.hasConsensus, "boolean");
    assert.equal(typeof x.hasSupermajority, "boolean");
    assert.ok(Array.isArray(x.dissenting), "dissenting is the array the card maps");
    // real math: 3 ship / 1 wait of 4 → 75% leading "ship".
    assert.equal(x.totalVotes, 4);
    assert.equal(x.leadingPosition, "ship");
    assert.equal(x.consensusPercent, 75);
    assert.equal(x.hasConsensus, true);       // ≥67
    assert.equal(x.hasSupermajority, true);   // ≥75
    assert.equal(x.status, "strong-consensus");
    assert.deepEqual(x.tally, { ship: 3, wait: 1 });
    assert.equal(x.dissenting.length, 1);
    assert.equal(x.dissenting[0].position, "wait");
    assert.equal(x.dissenting[0].count, 1);
    assert.equal(x.dissenting[0].percent, 25);
    assertNoNonFiniteNumbers(x);
  });

  it("a split vote reads 'no-consensus' below 50%", () => {
    const r = callViaComponent("detectConsensus", ctxC, {
      votes: [
        { voter: "a", position: "red" },
        { voter: "b", position: "blue" },
        { voter: "c", position: "green" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.consensusPercent, 33);
    assert.equal(r.result.hasConsensus, false);
    assert.equal(r.result.status, "no-consensus");
    assertNoNonFiniteNumbers(r.result);
  });

  it("reads the v.vote alias when v.position is absent", () => {
    const r = callViaComponent("detectConsensus", ctxC, {
      votes: [{ voter: "a", vote: "yes" }, { voter: "b", vote: "yes" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.leadingPosition, "yes");
    assert.equal(r.result.consensusPercent, 100);
  });

  it("VALIDATION: no votes → empty-shape message, never a crash", () => {
    const r = callViaComponent("detectConsensus", ctxC, { votes: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "Add votes or positions to detect consensus.");
  });
});

/* ───────────────────── balanceWorkload ───────────────────── */

describe("collab.balanceWorkload — EXACT fields the Workload card renders", () => {
  it("renders avgUtilization / overloadedMembers / unassignedTasks / members[].{name,status,utilization,totalHours,capacity,assignedTasks} / suggestions with real computed values", () => {
    const r = callViaComponent("balanceWorkload", ctxC, {
      members: [
        { name: "alice", capacityHours: 40 },
        { name: "bob", capacityHours: 40 },
      ],
      tasks: [
        { assignee: "alice", hours: 50 },  // overloaded
        { assignee: "bob", hours: 10 },    // available
        { hours: 8 },                       // unassigned
      ],
    });
    assert.equal(r.ok, true);
    const x = r.result;
    assert.equal(typeof x.avgUtilization, "number");
    assert.equal(typeof x.overloadedMembers, "number");
    assert.equal(typeof x.unassignedTasks, "number");
    assert.ok(Array.isArray(x.members), "members is the array the card maps");
    assert.ok(Array.isArray(x.suggestions), "suggestions is the array the card maps");
    for (const m of x.members) {
      assert.equal(typeof m.name, "string");
      assert.equal(typeof m.status, "string");
      assert.equal(typeof m.utilization, "number");
      assert.equal(typeof m.totalHours, "number");
      assert.equal(typeof m.capacity, "number");
      assert.equal(typeof m.assignedTasks, "number");
    }
    // real math:
    //   alice: 50h / 40 cap → util 125% → overloaded.
    //   bob:   10h / 40 cap → util 25%  → available.
    //   avg = round((125+25)/2) = 75.
    const alice = x.members.find((m) => m.name === "alice");
    const bob = x.members.find((m) => m.name === "bob");
    assert.equal(alice.totalHours, 50);
    assert.equal(alice.capacity, 40);
    assert.equal(alice.utilization, 125);
    assert.equal(alice.status, "overloaded");
    assert.equal(alice.assignedTasks, 1);
    assert.equal(bob.utilization, 25);
    assert.equal(bob.status, "available");
    assert.equal(x.overloadedMembers, 1);
    assert.equal(x.unassignedTasks, 1);
    assert.equal(x.avgUtilization, 75);
    // a real "move from alice → bob" suggestion is produced.
    assert.equal(x.suggestions.length, 1);
    assert.ok(/alice/.test(x.suggestions[0]) && /bob/.test(x.suggestions[0]));
    assertNoNonFiniteNumbers(x);
  });

  it("reads the t.estimatedHours alias and defaults missing hours to 2", () => {
    const r = callViaComponent("balanceWorkload", ctxC, {
      members: [{ name: "carol", capacityHours: 40 }],
      tasks: [
        { assignee: "carol", estimatedHours: 6 },
        { assignee: "carol" }, // missing hours → default 2
      ],
    });
    assert.equal(r.ok, true);
    const carol = r.result.members.find((m) => m.name === "carol");
    assert.equal(carol.totalHours, 8); // 6 + default 2
    assertNoNonFiniteNumbers(r.result);
  });

  it("VALIDATION: no members → empty-shape message, never a crash", () => {
    const r = callViaComponent("balanceWorkload", ctxC, { members: [], tasks: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "Add team members and tasks to balance workload.");
  });
});

/* ───────── DEGRADE-GRACEFUL: pure compute survives STATE loss ───────── */

describe("collab lens — degrade-graceful (stateless calculators never throw)", () => {
  it("sessionAnalytics / contributionScore / detectConsensus / balanceWorkload compute with STATE gone", () => {
    globalThis._concordSTATE = undefined;
    globalThis._concordSaveStateDebounced = undefined;
    const cases = [
      ["sessionAnalytics", { durationMinutes: 10, participants: ["a"], messages: [{ author: "a", content: "hi" }] }],
      ["contributionScore", { contributions: [{ name: "a", type: "code", quality: 0.9, count: 1 }] }],
      ["detectConsensus", { votes: [{ voter: "a", position: "yes" }] }],
      ["balanceWorkload", { members: [{ name: "a", capacityHours: 40 }], tasks: [{ assignee: "a", hours: 8 }] }],
    ];
    for (const [name, data] of cases) {
      const r = callViaComponent(name, ctxC, data);
      assert.equal(r.ok, true, `${name} must degrade-graceful with no STATE`);
      assertNoNonFiniteNumbers(r.result);
    }
  });
});

/* ───────── FAIL-CLOSED: poisoned numerics never leak NaN/Infinity ───────── */

describe("collab lens — fail-CLOSED on poisoned numerics (Number.isFinite, not parseFloat)", () => {
  it("sessionAnalytics: 'Infinity' / 'NaN' / '12abc' durationMinutes never leak a non-finite messagesPerMinute or durationMinutes", () => {
    // parseFloat("Infinity") === Infinity (messages/Infinity = 0 but the field
    // itself echoes Infinity) and parseFloat("12abc") === 12 (silent accept).
    // Number()+isFinite rejects both → duration falls to 0 → messagesPerMinute 0.
    for (const bad of ["Infinity", "NaN", "12abc", "abc"]) {
      const r = callViaComponent("sessionAnalytics", ctxC, {
        durationMinutes: bad,
        participants: ["a"],
        messages: [{ author: "a", content: "x y z" }],
      });
      assert.equal(r.ok, true, `duration='${bad}' must not crash`);
      assert.ok(Number.isFinite(r.result.durationMinutes), `durationMinutes stays finite for '${bad}'`);
      assert.ok(Number.isFinite(r.result.messagesPerMinute), `messagesPerMinute stays finite for '${bad}'`);
      assertNoNonFiniteNumbers(r.result);
    }
    // "12abc" must NOT be coerced to 12 → rejected to 0 → messagesPerMinute 0.
    const r2 = callViaComponent("sessionAnalytics", ctxC, {
      durationMinutes: "12abc", participants: ["a"], messages: [{ author: "a", content: "x" }],
    });
    assert.equal(r2.result.durationMinutes, 0, "'12abc' rejected to 0, not accepted as 12");
    assert.equal(r2.result.messagesPerMinute, 0);
  });

  it("contributionScore: poisoned quality/count never produce NaN/Infinity scores", () => {
    const r = callViaComponent("contributionScore", ctxC, {
      contributions: [
        { name: "a", type: "code", quality: "Infinity", count: "NaN" },
        { name: "b", type: "review", quality: "abc", count: "12xyz" },
      ],
    });
    assert.equal(r.ok, true);
    for (const rk of r.result.rankings) {
      assert.ok(Number.isFinite(rk.totalScore), `${rk.name} totalScore stays finite`);
      assert.ok(Number.isFinite(rk.contributions), `${rk.name} contributions stays finite`);
      assert.ok(rk.contributions >= 1, "count floors to ≥1, never NaN");
    }
    assertNoNonFiniteNumbers(r.result);
    // a "12abc" quality must NOT become 12 (parseFloat hazard) → falls to 0.7 default → clamp.
    const r2 = callViaComponent("contributionScore", ctxC, {
      contributions: [{ name: "a", type: "discussion", quality: "12abc", count: 1 }],
    });
    // discussion weight 1, quality default 0.7 → round(1*0.7*100)=70.
    assert.equal(r2.result.rankings[0].totalScore, 70, "'12abc' quality rejected to 0.7 default, not accepted as 12");
    assertNoNonFiniteNumbers(r2.result);
  });

  it("balanceWorkload: poisoned hours/capacity never produce NaN/Infinity utilization", () => {
    const r = callViaComponent("balanceWorkload", ctxC, {
      members: [
        { name: "a", capacityHours: "Infinity" }, // poisoned cap → default 40
        { name: "b", capacityHours: "12abc" },    // '12abc' rejected → default 40, NOT 12
      ],
      tasks: [
        { assignee: "a", hours: "NaN" },   // poisoned → default 2
        { assignee: "b", hours: "abc" },   // poisoned → default 2
      ],
    });
    assert.equal(r.ok, true);
    for (const m of r.result.members) {
      assert.ok(Number.isFinite(m.utilization), `${m.name} utilization stays finite`);
      assert.ok(Number.isFinite(m.totalHours), `${m.name} totalHours stays finite`);
      assert.ok(Number.isFinite(m.capacity), `${m.name} capacity stays finite`);
    }
    assert.ok(Number.isFinite(r.result.avgUtilization));
    // b's capacity '12abc' must fall to 40 (not 12) → util = round(2/40*100) = 5.
    const b = r.result.members.find((m) => m.name === "b");
    assert.equal(b.capacity, 40, "'12abc' capacity rejected to 40 default, not accepted as 12");
    assert.equal(b.totalHours, 2);  // poisoned hours → default 2
    assert.equal(b.utilization, 5);
    assertNoNonFiniteNumbers(r.result);
  });

  it("detectConsensus: a numeric-looking position is tallied as a label, never coerced into a NaN bucket", () => {
    const r = callViaComponent("detectConsensus", ctxC, {
      votes: [{ voter: "a", position: "42" }, { voter: "b", position: "42" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.leadingPosition, "42");
    assert.equal(r.result.consensusPercent, 100);
    assertNoNonFiniteNumbers(r.result);
  });
});
