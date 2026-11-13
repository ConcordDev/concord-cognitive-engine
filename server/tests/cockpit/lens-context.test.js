import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { lensContextEvidence, pickContextAction, lensDisplayName } from "../../lib/cockpit/lens-context.js";
import { buildContextPacket } from "../../lib/cockpit/context-packet.js";
import { fakeExec } from "./_helpers.js";

const manifest = { lensId: "analytics", description: "Funnels, retention and event counts for your own product.", category: "data", domainTags: [] };
const getManifest = (id) => (id === "analytics" ? manifest : null);
const actions = (...names) => new Map(names.map((n) => [`analytics.${n}`, () => ({})]));
const allRead = () => "read";

afterEach(() => { delete process.env.CONCORD_COCKPIT_ASK_CONTEXT; });

test("a lens with a read overview gives its description and its current state", async () => {
  const exec = fakeExec({ "lens:analytics.overview": [{ ok: true, result: { worstStep: "checkout", dropOff: 42 } }] });
  const r = await lensContextEvidence({ lensId: "analytics", exec, lensActions: actions("overview"), deps: { getManifest, resolveRisk: allRead } });
  assert.equal(r.ok, true);
  assert.equal(r.evidence.length, 2);
  assert.equal(r.evidence[0].source, "lens");
  assert.match(r.evidence[0].snippet, /Funnels/);
  assert.match(r.evidence[1].snippet, /checkout/);
  assert.equal(exec.calls.length, 1);
  assert.equal(exec.calls[0].params.domain, "analytics");
});

test("a context action whose risk is write is never run", async () => {
  const exec = fakeExec({});
  const r = await lensContextEvidence({ lensId: "analytics", exec, lensActions: actions("overview"), deps: { getManifest, resolveRisk: () => "write" } });
  assert.equal(r.evidence.length, 1);
  assert.equal(exec.calls.length, 0);
});

test("an unknown lens is a plain failure", async () => {
  const r = await lensContextEvidence({ lensId: "nope", exec: fakeExec({}), lensActions: new Map(), deps: { getManifest } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unknown_lens");
  assert.deepEqual(r.evidence, []);
});

test("a context action that throws still returns the first item", async () => {
  const exec = async () => { throw new Error("boom"); };
  const r = await lensContextEvidence({ lensId: "analytics", exec, lensActions: actions("overview"), deps: { getManifest, resolveRisk: allRead } });
  assert.equal(r.evidence.length, 1);
  assert.equal(r.reason, "handler_threw");
});

test("a context action that never answers is cut at the limit", async () => {
  const exec = () => new Promise(() => {});
  const r = await lensContextEvidence({ lensId: "analytics", exec, lensActions: actions("overview"), deps: { getManifest, resolveRisk: allRead, timeoutMs: 20 } });
  assert.equal(r.evidence.length, 1);
  assert.equal(r.reason, "timeout");
});

test("pickContextAction follows the name order", () => {
  assert.equal(pickContextAction("analytics", actions("status", "overview"), { resolveRisk: allRead }), "overview");
  assert.equal(pickContextAction("analytics", actions("export"), { resolveRisk: allRead }), null);
  assert.equal(lensDisplayName("reasoning-traces"), "Reasoning traces");
});

const run = { id: "run_1", userId: "u1", goal: "what is my worst funnel step", chatSessionId: "s1", lensContext: "analytics" };
const step = { id: "stp_1", seq: 1, goal: "answer", status: "ready", expects: [], dependsOn: [] };
const lensContext = async () => ({ ok: true, evidence: [{ id: "lens:analytics", title: "Analytics", snippet: "Funnels", source: "lens" }] });

test("with the flag on the packet leads with lens evidence and names the page", async () => {
  process.env.CONCORD_COCKPIT_ASK_CONTEXT = "1";
  const p = await buildContextPacket({ run, step, priorSteps: [], menu: [], profile: "local-2b", userId: "u1", deps: { recall: async () => ({ dtus: [{ id: "d1", title: "Note", snippet: "x" }] }), lensContext } });
  assert.equal(p.evidence[0].source, "lens");
  assert.ok(p.evidence.length <= 8);
  assert.ok(p.constraints[0].includes("Analytics page"));
});

test("negative control: with the flag off there is no lens item", async () => {
  const p = await buildContextPacket({ run, step, priorSteps: [], menu: [], profile: "local-2b", userId: "u1", deps: { recall: async () => ({ dtus: [] }), lensContext } });
  assert.ok(!p.evidence.some((e) => e.source === "lens"));
  assert.ok(!p.constraints.some((c) => c.includes("page")));
});
