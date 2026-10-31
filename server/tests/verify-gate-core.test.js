// Brief F: the verification gate core — claim extraction, per-kind checks, outcomes, budgeted queue.
import test from "node:test";
import assert from "node:assert/strict";
import { extractClaims } from "../lib/verify-gate/claims.js";
import { checkClaim } from "../lib/verify-gate/checkers.js";
import { verifyCandidate, decideOutcome } from "../lib/verify-gate/gate.js";
import { createVerifyQueue } from "../lib/verify-gate/queue.js";

const kinds = (text) => extractClaims(text).map((c) => c.kind);

test("claims are classified: math, arithmetic, citation, numeric, speculative, narrative", () => {
  assert.deepEqual(kinds("For all natural numbers n, n + 0 = n."), ["math"]);
  assert.deepEqual(kinds("The sum 12 + 30 = 42 holds here."), ["arithmetic"]);
  assert.deepEqual(kinds("This is supported by dtu_abc12345 in the lattice."), ["citation"]);
  assert.deepEqual(kinds("The beam deflects 10.7 mm under load."), ["numeric"]);
  assert.deepEqual(kinds("Perhaps the lattice could self-organise into rings."), ["speculative"]);
  assert.deepEqual(kinds("The council met and discussed the harvest."), ["narrative"]);
  assert.deepEqual(kinds("It might be true that 2 + 2 = 4 somewhere."), ["speculative"], "a hedge wins over arithmetic");
});

test("arithmetic is recomputed: right is verified, wrong is refuted", async () => {
  const [ok] = extractClaims("We find 12 * 7 = 84 in this case.");
  const [bad] = extractClaims("We find 12 * 7 = 80 in this case.");
  assert.equal((await checkClaim(ok)).result, "verified");
  const r = await checkClaim(bad);
  assert.equal(r.result, "refuted");
  assert.match(r.detail, /84/);
});

test("citations must resolve: an invented DTU id is refuted", async () => {
  const [c] = extractClaims("As shown in dtu_real0001 and dtu_fake0002 the pattern repeats.");
  const dtuExists = async (id) => id === "dtu_real0001";
  const r = await checkClaim(c, { dtuExists });
  assert.equal(r.result, "refuted");
  assert.match(r.detail, /dtu_fake0002/);
  assert.equal((await checkClaim(c, { dtuExists: async () => true })).result, "verified");
  assert.equal((await checkClaim(c, {})).result, "pending");
});

test("numeric figures are verified only when they appear in the sources; otherwise unchecked, never refuted", async () => {
  const [c] = extractClaims("The stress is 25 MPa at the support.");
  assert.equal((await checkClaim(c, { sourceNumbers: [25e6, 4] })).result, "verified");
  assert.equal((await checkClaim(c, { sourceNumbers: [111] })).result, "unchecked");
  assert.equal((await checkClaim(c, {})).result, "unchecked");
});

test("math: propositional tautology and contradiction are exact; no model means pending; Lean verifies or fails", async () => {
  const taut = { id: "c1", kind: "math", text: "(p -> q) & p -> q" };
  const contra = { id: "c2", kind: "math", text: "p & !p" };
  assert.equal((await checkClaim(taut)).result, "verified");
  assert.equal((await checkClaim(contra)).result, "refuted");

  const claim = { id: "c3", kind: "math", text: "For all natural numbers n, n + 0 = n." };
  assert.equal((await checkClaim(claim, {})).result, "pending");
  const brainFn = async () => "```lean\ntheorem t (n : Nat) : n + 0 = n := by simp\n```";
  const verified = await checkClaim(claim, { brainFn, checkLean: async () => ({ status: "verified", elapsedMs: 40 }) });
  assert.equal(verified.result, "verified");
  assert.match(verified.leanSource, /theorem t/);
  assert.equal(verified.leanElapsedMs, 40);
  assert.equal((await checkClaim(claim, { brainFn, checkLean: async () => ({ status: "failed", errors: ["error: unsolved goals"] }) })).result, "failed");
  assert.equal((await checkClaim(claim, { brainFn, checkLean: async () => ({ status: "pending", reason: "lean service unreachable" }) })).result, "pending");
  assert.equal((await checkClaim(claim, { brainFn: async () => "```lean\n-- UNPROVABLE\n```" })).result, "failed");
});

test("a Lean proof that smuggles in sorry is NOT verified, even if the service were to say ok", async () => {
  const claim = { id: "c1", kind: "math", text: "For all n, n + 0 = n." };
  const brainFn = async () => "```lean\ntheorem t (n : Nat) : n + 0 = n := by sorry\n```";
  // the real client applies the shared policy before any request, so the default path rejects it
  const r = await checkClaim(claim, { brainFn, checkLean: (await import("../lib/verify-gate/lean-client.js")).checkLean });
  assert.equal(r.result, "failed");
  assert.match(r.detail, /not acceptable.*sorry/);
});

test("outcome rules", () => {
  const R = (...rs) => rs.map((result, i) => ({ claimId: `c${i}`, result }));
  assert.equal(decideOutcome(R("verified", "verified")), "VERIFIED");
  assert.equal(decideOutcome(R("verified", "n/a", "verified")), "VERIFIED");
  assert.equal(decideOutcome(R("verified", "failed")), "PARTIAL");
  assert.equal(decideOutcome(R("verified", "unchecked")), "PARTIAL");
  assert.equal(decideOutcome(R("verified", "refuted")), "REFUTED");
  assert.equal(decideOutcome(R("pending", "verified")), "PENDING");
  assert.equal(decideOutcome(R("refuted", "pending")), "REFUTED");
  assert.equal(decideOutcome(R("n/a", "n/a")), "UNTESTABLE");
  assert.equal(decideOutcome([]), "UNTESTABLE");
  assert.equal(decideOutcome(R("unchecked", "unchecked")), "UNTESTABLE");
  assert.equal(decideOutcome(R("failed")), "PARTIAL");
});

test("verifyCandidate builds a receipt with every claim, its checker and result, and lists what is unverified", async () => {
  const body = "We find 6 * 7 = 42. As shown in dtu_real0001 this holds. Perhaps it extends further. The council discussed it. The span is 4 m.";
  const { outcome, receipt } = await verifyCandidate({ id: "cand1", title: "Pattern", body }, { dtuExists: async () => true, sourceNumbers: [4] });
  assert.equal(outcome, "VERIFIED");
  assert.deepEqual(receipt.claims.map((c) => c.kind), ["arithmetic", "citation", "speculative", "narrative", "numeric"]);
  assert.ok(receipt.claims.every((c) => c.checker && c.result && c.text));
  assert.equal(receipt.candidateId, "cand1");
  assert.equal(receipt.unverified.length, 0);
  assert.match(receipt.bodyHash, /^[0-9a-f]{64}$/);

  const bad = await verifyCandidate({ id: "cand2", body: "We find 6 * 7 = 43 here. See dtu_real0001 for that." }, { dtuExists: async () => true });
  assert.equal(bad.outcome, "REFUTED");
  assert.equal(bad.receipt.unverified[0].result, "refuted");

  const vague = await verifyCandidate({ id: "cand3", body: "The lattice may reorganise itself over time. The council met and talked." }, {});
  assert.equal(vague.outcome, "UNTESTABLE");
});

test("verification yields to the event loop between claims", async () => {
  let yields = 0;
  await verifyCandidate({ id: "y", body: "We find 1 + 1 = 2 here. We find 2 + 2 = 4 here. We find 3 + 3 = 6 here." }, { yieldNow: async () => { yields++; } });
  assert.equal(yields, 3);
});

// ---- queue -----------------------------------------------------------------------------------------------
test("queue: dedupes, caps per cycle, counts outcomes, keeps a small expiring rejected log", async () => {
  let t = 1_000_000;
  const q = createVerifyQueue({ perCycle: 2, budgetMs: 10_000, rejectedTtlMs: 1000, now: () => t });
  for (const id of ["a", "b", "c", "d"]) assert.equal(q.submit({ id, title: id }).queued, true);
  assert.deepEqual(q.submit({ id: "a" }), { queued: false, reason: "duplicate" });
  const outcomes = { a: "VERIFIED", b: "REFUTED", c: "PARTIAL", d: "UNTESTABLE" };
  const verifyFn = async (c) => ({ outcome: outcomes[c.id], receipt: { claims: c.id === "b" ? [{ result: "refuted", detail: "12*7 != 80" }] : [{ leanElapsedMs: 100 }] } });
  const applied = [];
  const r1 = await q.drain(verifyFn, { onOutcome: async (c, res) => { applied.push([c.id, res.outcome]); } });
  assert.equal(r1.processed, 2);
  assert.equal(q.metrics().queueDepth, 2);
  await q.drain(verifyFn, { onOutcome: async (c, res) => { applied.push([c.id, res.outcome]); } });
  assert.deepEqual(applied, [["a", "VERIFIED"], ["b", "REFUTED"], ["c", "PARTIAL"], ["d", "UNTESTABLE"]]);
  const m = q.metrics();
  assert.deepEqual(m.outcomes, { VERIFIED: 1, PARTIAL: 1, REFUTED: 1, UNTESTABLE: 1, PENDING: 0 });
  assert.equal(m.candidatesLastHour, 4);
  assert.ok(m.leanLatencyMs.samples >= 2);
  assert.equal(q.rejected().length, 1);
  assert.deepEqual(q.rejected()[0].why, ["12*7 != 80"]);
  t += 5000;
  assert.equal(q.rejected().length, 0, "the rejected log expires");
});

test("queue: PENDING is retried with back-off, then stays pending; a full queue drops and counts; a throwing verifier is pending", async () => {
  let t = 0;
  const q = createVerifyQueue({ maxRetries: 2, retryBackoffMs: 100, maxQueue: 2, now: () => t });
  q.submit({ id: "p" }); q.submit({ id: "q" });
  assert.deepEqual(q.submit({ id: "r" }), { queued: false, reason: "queue full" });
  assert.equal(q.metrics().dropped, 1);
  const pending = async () => ({ outcome: "PENDING", receipt: { claims: [] } });
  await q.drain(pending);
  assert.equal(q.size(), 2, "pending items are kept");
  const idle = await q.drain(pending);
  assert.equal(idle.processed, 0, "backed off: not retried yet");
  t += 1000;
  await q.drain(pending);
  assert.equal(q.metrics().outcomes.PENDING, 2, "after max retries it is recorded as pending and leaves the queue");
  q.submit({ id: "boom" });
  await q.drain(async () => { throw new Error("pod down"); });
  assert.equal(q.size(), 1);
});

test("queue: a drain respects its time budget and yields (never one long synchronous loop)", async () => {
  let t = 0;
  const q = createVerifyQueue({ perCycle: 100, budgetMs: 50, now: () => t });
  for (let i = 0; i < 10; i++) q.submit({ id: `i${i}` });
  const r = await q.drain(async () => { t += 20; return { outcome: "VERIFIED", receipt: { claims: [] } }; });
  assert.ok(r.processed <= 3, `processed ${r.processed} within a 50 ms budget at 20 ms each`);
  assert.ok(r.remaining >= 7);
});
