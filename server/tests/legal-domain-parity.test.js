import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLegalActions from "../domains/legal.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`legal.${name}`);
  assert.ok(fn, `legal.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerLegalActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("legal.contract-analyze", () => {
  it("rejects short contract", async () => {
    const r = await call("contract-analyze", { llm: { chat: async () => ({}) } }, { contract: "tiny" });
    assert.equal(r.ok, false);
  });
  it("rejects when LLM unavailable", async () => {
    const r = await call("contract-analyze", ctxA, { contract: "a".repeat(500) });
    assert.equal(r.ok, false);
  });
  it("parses LLM JSON to ContractAnalysis", async () => {
    const ctx = {
      llm: { chat: async () => ({ text: '{"documentType":"NDA","partyCount":2,"riskFlags":[{"severity":"high","category":"IP","clause":"5","excerpt":"all work product","whatItMeans":"transfers all IP","recommendation":"narrow scope"}],"obligationsForYou":["keep info secret"],"obligationsForCounterparty":["pay"],"terminationConditions":["30 days notice"],"governing":{"law":"DE"},"summary":"NDA"}' }) },
    };
    const r = await call("contract-analyze", ctx, { contract: "a".repeat(500), perspective: "sign" });
    assert.equal(r.ok, true);
    assert.equal(r.result.documentType, "NDA");
    assert.equal(r.result.riskFlags[0].severity, "high");
  });
});

describe("legal.case-list / -add", () => {
  it("scoped per user, reject missing fields", () => {
    const r = call("case-add", ctxA, { caption: "Smith v. Jones", caseNumber: "23-CV-1234", court: "SDNY", matterType: "civil" });
    assert.equal(r.ok, true);
    assert.equal(call("case-list", ctxA, {}).result.cases.length, 1);
    assert.equal(call("case-list", ctxB, {}).result.cases.length, 0);
    assert.equal(call("case-add", ctxA, { caption: "X" }).ok, false);
  });
});

describe("legal.legal-question", () => {
  it("rejects empty question", async () => {
    assert.equal((await call("legal-question", ctxA, { question: "" })).ok, false);
  });

  it("graceful no-LLM fallback", async () => {
    const r = await call("legal-question", ctxA, { question: "Can my landlord evict me?" });
    assert.equal(r.ok, true);
    assert.match(r.result.answer, /unavailable|attorney/i);
  });

  it("INVARIANT: always includes not-legal-advice caveat", async () => {
    const ctx = {
      llm: { chat: async () => ({ text: '{"answer":"Yes, but you have rights.","citations":[],"caveats":[]}' }) },
    };
    const r = await call("legal-question", ctx, { question: "Q?", jurisdiction: "US-CA" });
    assert.equal(r.ok, true);
    assert.ok(r.result.caveats.some(c => /not legal advice|consult.*attorney/i.test(c)),
      "MUST include not-legal-advice caveat");
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("at least one registered", () => assert.ok(ACTIONS.size >= 6));
});
