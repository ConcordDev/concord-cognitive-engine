// INC-SWEEP research F7 — generate-bibliography / find-gaps / evaluate-source /
// match-questions must use the research library or refuse. Never ok:true
// utility-brain prose citing fabricated dtu ids.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

describe("research library-backed brain action overrides (F7)", () => {
  let LENS_ACTIONS, makeInternalCtx;

  before(async () => {
    const t = await load();
    makeInternalCtx = t.makeInternalCtx;
    LENS_ACTIONS = t.LENS_ACTIONS || globalThis.__concordLensActions;
    assert.ok(LENS_ACTIONS);
  });

  function ctxFor(userId) {
    const ctx = makeInternalCtx(userId);
    ctx.actor = { userId, role: "member", scope: "local", scopes: ["*"] };
    ctx.internal = false;
    return ctx;
  }

  async function call(name, ctx, params = {}) {
    const fn = LENS_ACTIONS.get(`research.${name}`);
    assert.ok(typeof fn === "function", `research.${name} missing`);
    return fn(ctx, { id: null, domain: "research", data: params, meta: {} }, params);
  }

  it("empty library: generate-bibliography / find-gaps / match-questions refuse", async () => {
    const ctx = ctxFor("u-f7-empty-" + Date.now().toString(36));
    for (const [name, params] of [
      ["generate-bibliography", {}],
      ["find-gaps", {}],
      ["match-questions", { question: "what is attention?" }],
    ]) {
      const r = await call(name, ctx, params);
      assert.equal(r.ok, false, name);
      assert.ok(!r.source || !String(r.source).includes("brain"), `${name} must not be brain-backed`);
      assert.equal(shapeLensRunHttp(r).status, 422);
    }
    const evalEmpty = await call("evaluate-source", ctx, {});
    assert.equal(evalEmpty.ok, false);
    assert.match(evalEmpty.error, /reference id required/i);
  });

  it("with real references: bibliography and evaluate use library ids", async () => {
    const userId = "u-f7-lib-" + Date.now().toString(36);
    const ctx = ctxFor(userId);
    const add = await call("reference-add", ctx, {
      title: "Attention Is All You Need F7",
      authors: "Vaswani et al.",
      year: 2017,
      type: "article",
      doi: "10.48550/arXiv.1706.03762",
      tags: ["rsch-f7"],
    });
    assert.equal(add.ok, true, JSON.stringify(add));
    const refId = add.result.reference.id;

    const bib = await call("generate-bibliography", ctx, { style: "apa" });
    assert.equal(bib.ok, true, JSON.stringify(bib));
    assert.equal(bib.result.source, "library");
    assert.equal(bib.result.count, 1);
    assert.match(bib.result.bibliography, /Attention Is All You Need F7/);
    assert.ok(!/dtu-3820|dhtp-kitchen-hold/i.test(JSON.stringify(bib)));

    const ev = await call("evaluate-source", ctx, { id: refId });
    assert.equal(ev.ok, true, JSON.stringify(ev));
    assert.equal(ev.result.referenceId, refId);
    assert.equal(ev.result.source, "library");

    const gaps = await call("find-gaps", ctx, {});
    assert.equal(gaps.ok, true);
    assert.equal(gaps.result.source, "library");
    assert.equal(gaps.result.referenceCount, 1);

    const mq = await call("match-questions", ctx, { question: "attention transformer" });
    assert.equal(mq.ok, true);
    assert.equal(mq.result.source, "library");
    assert.ok(mq.result.matches.some((m) => m.referenceId === refId));
  });
});
