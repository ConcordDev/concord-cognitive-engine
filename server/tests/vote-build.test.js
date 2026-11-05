// server/tests/vote-build.test.js
//
// Vote full lens build (B2) — pins, against the REAL registry handlers in
// server/domains/vote.js:
//   S1/F1  a poll with zero ballots (or quorum unmet) resolves UNRESOLVED
//          with no winner — an empty tally manufactures no decision
//   S4/F4  an equal top tally is a declared TIE, never a first-option win
//   S2/F2  the Fairness Check's majority criterion is judged against the
//          plurality winner the same toolkit reports (the §5 flow-11/12
//          fixture: 4× Alpha>Beta>Gamma, 2× Beta>Gamma>Alpha,
//          1× Gamma>Beta>Alpha) and names the winner judged against
//   S6/F6  poll-create records the creator's display name from the actor
//   S7/F7  IRV tallies carry inspectable elimination rounds summing to the
//          declared winner
import test from "node:test";
import assert from "node:assert/strict";
import registerVoteActions from "../domains/vote.js";

function makeRegistry() {
  const actions = new Map();
  registerVoteActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));
  return actions;
}
const founder = { actor: { userId: "founder1", displayName: "Founder One" } };
const voter2 = { actor: { userId: "voter2" } };

test("S1: a zero-ballot poll resolves unresolved with no winner", async () => {
  globalThis._concordSTATE = {};
  const a = makeRegistry();
  const run = (name, ctx, params = {}) => a.get(`vote.${name}`)(ctx, undefined, params);
  const poll = (await run("poll-create", founder, { title: "Empty", method: "plurality", options: ["Yes", "No"] })).result.poll;
  await run("poll-close", founder, { pollId: poll.id });
  const res = (await run("poll-results", founder, { pollId: poll.id })).result;
  assert.equal(res.tally.winner, null);
  assert.deepEqual(res.tally.tied, []);
  assert.equal(res.resolution.outcome, "unresolved");
  assert.match(res.resolution.detail, /No ballots cast/);
});

test("S1: quorum unmet at close is unresolved, not failed or passed", async () => {
  globalThis._concordSTATE = {};
  const a = makeRegistry();
  const run = (name, ctx, params = {}) => a.get(`vote.${name}`)(ctx, undefined, params);
  const poll = (await run("poll-create", founder, { title: "Quorum", method: "plurality", options: ["A", "B"], quorum: 2 })).result.poll;
  await run("cast-ballot", voter2, { pollId: poll.id, choice: "A" });
  await run("poll-close", founder, { pollId: poll.id });
  const res = (await run("poll-results", founder, { pollId: poll.id })).result;
  assert.equal(res.resolution.outcome, "unresolved");
  assert.match(res.resolution.detail, /Quorum not met/);
});

test("S4: the flow-8 approval fixture is a tie, not a first-option win", async () => {
  globalThis._concordSTATE = {};
  const a = makeRegistry();
  const run = (name, ctx, params = {}) => a.get(`vote.${name}`)(ctx, undefined, params);
  const poll = (await run("poll-create", founder, { title: "Approval", method: "approval", options: ["Opt A", "Opt B"] })).result.poll;
  await run("cast-ballot", voter2, { pollId: poll.id, approved: ["Opt A", "Opt B"] });
  await run("poll-close", founder, { pollId: poll.id });
  const res = (await run("poll-results", founder, { pollId: poll.id })).result;
  assert.equal(res.tally.winner, null);
  assert.deepEqual([...res.tally.tied].sort(), ["Opt A", "Opt B"]);
  assert.equal(res.resolution.outcome, "tied");
});

test("S2: Fairness Check agrees with the tally on the flow-11/12 fixture", async () => {
  globalThis._concordSTATE = {};
  const a = makeRegistry();
  const ballots = [
    ...Array.from({ length: 4 }, () => ({ rankings: ["Alpha", "Beta", "Gamma"] })),
    ...Array.from({ length: 2 }, () => ({ rankings: ["Beta", "Gamma", "Alpha"] })),
    { rankings: ["Gamma", "Beta", "Alpha"] },
  ];
  const artifact = { data: { ballots, candidates: ["Alpha", "Beta", "Gamma"] } };
  const tally = await a.get("vote.tallyVotes")(founder, artifact, {});
  assert.equal(tally.result.plurality.winner, "Alpha");
  const fair = await a.get("vote.fairnessCheck")(founder, artifact, {});
  assert.equal(fair.result.majorityCriterion.majorityCandidate, "Alpha");
  assert.equal(fair.result.majorityCriterion.judgedAgainst, "Alpha");
  assert.equal(fair.result.majorityCriterion.met, true);
  assert.match(fair.result.majorityCriterion.detail, /criterion met/);
});

test("S6: poll-create records the creator's display name", async () => {
  globalThis._concordSTATE = {};
  const a = makeRegistry();
  const run = (name, ctx, params = {}) => a.get(`vote.${name}`)(ctx, undefined, params);
  const named = (await run("poll-create", founder, { title: "Named", method: "plurality", options: ["A", "B"] })).result.poll;
  assert.equal(named.ownerLabel, "Founder One");
  const anon = (await run("poll-create", { actor: { userId: "nobody" } }, { title: "Anon", method: "plurality", options: ["A", "B"] })).result.poll;
  assert.equal(anon.ownerLabel, "Anonymous");
});

test("S7: IRV rounds are inspectable and sum to the declared winner", async () => {
  globalThis._concordSTATE = {};
  const a = makeRegistry();
  const run = (name, ctx, params = {}) => a.get(`vote.${name}`)(ctx, undefined, params);
  const poll = (await run("poll-create", founder, { title: "Ranked", method: "ranked", options: ["A", "B", "C"] })).result.poll;
  const cast = (user, rankings) => run("cast-ballot", { actor: { userId: user } }, { pollId: poll.id, rankings });
  await cast("u1", ["A", "B", "C"]);
  await cast("u2", ["A", "B", "C"]);
  await cast("u3", ["B", "C", "A"]);
  await cast("u4", ["B", "C", "A"]);
  await cast("u5", ["C", "B", "A"]);
  await cast("u6", ["C", "B", "A"]);
  await cast("u7", ["C", "B", "A"]);
  const res = (await run("poll-results", founder, { pollId: poll.id })).result;
  assert.ok(Array.isArray(res.tally.rounds) && res.tally.rounds.length >= 2, "multiple elimination rounds");
  assert.equal(res.tally.winner, "C");
  const finalRound = res.tally.rounds[res.tally.rounds.length - 1];
  assert.equal(finalRound.tally[0].option, "C");
});
