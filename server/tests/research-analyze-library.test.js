import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/research.js";
import { clearExternalFetchCache } from "../lib/external-fetch.js";

// S5 (F3) — library analysis. Three claims under test:
//  (a) analyze-library is a background job over evaluate-source /
//      find-gaps / match-questions whose outputs NAME the items read;
//      an empty library is refused honestly (no template, no fake job).
//  (b) citationNetwork gains a library mode: the Search-desk rail used
//      to run it on the first platform-feed DTU through /run, which
//      404'd ("not found") — and the macro read artifact.data only, so
//      no call could ever feed it the library. Library mode computes
//      over the caller's references (related links = edges, tags =
//      keywords). Artifact mode must be byte-for-byte what it was.
//  The factored cores must keep the three macros' behaviour identical.

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`research.${name}`);
  if (!fn) throw new Error(`research.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  clearExternalFetchCache();
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

async function addRef(ctx, params) {
  const r = await call("reference-add", ctx, params);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.reference;
}

// The review's shape: three references, one related pair, mixed metadata
// (one missing abstract, a year gap, a singleton tag).
async function seedLibrary(ctx) {
  const go = await addRef(ctx, {
    title: "Mastering the game of Go with deep neural networks and tree search",
    authors: "David Silver", year: 2016, journal: "Nature",
    doi: "10.1038/nature16961", abstract: "Deep learning for Go.", tags: ["go", "rl"],
  });
  const attn = await addRef(ctx, {
    title: "Attention Is All You Need",
    authors: "Ashish Vaswani", year: 2017, journal: "NeurIPS",
    doi: "10.48550/arXiv.1706.03762", tags: ["attention"],
  });
  const survey = await addRef(ctx, {
    title: "A Survey of Old Methods", authors: "Jane Doe", year: 2010, tags: ["go"],
  });
  await call("reference-relate", ctx, { referenceId: go.id, relatedId: attn.id });
  return { go, attn, survey };
}

describe("research — analyze-library job (S5)", () => {
  it("refuses an empty library honestly — no job, no template", async () => {
    const r = await call("analyze-library", ctxA, { question: "what is known?" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_references");
    const list = await call("analysis-list", ctxA);
    assert.equal(list.result.count, 0);
  });

  it("files a running job, completes in the background, and names every item it read", async () => {
    const { go, attn, survey } = await seedLibrary(ctxA);
    const started = await call("analyze-library", ctxA, {
      question: "what is known about attention and go?",
    });
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(started.result.job.status, "running");
    assert.equal(started.result.job.itemCount, 3);

    await tick();
    const got = await call("analysis-get", ctxA, { id: started.result.job.id });
    assert.equal(got.ok, true);
    const job = got.result.job;
    assert.equal(job.status, "complete");
    assert.ok(job.completedAt);

    const res = job.result;
    assert.equal(res.source, "library");
    // itemsRead names all three references — the §7 S5 naming rule.
    assert.deepEqual(
      res.itemsRead.map((i) => i.title).sort(),
      [go.title, attn.title, survey.title].sort(),
    );
    // evaluate-source ran per reference, titles attached.
    assert.equal(res.evaluations.length, 3);
    const goEval = res.evaluations.find((e) => e.referenceId === go.id);
    assert.equal(goEval.title, go.title);
    assert.equal(goEval.credibility, "high"); // doi+venue+year+abstract+authors
    const surveyEval = res.evaluations.find((e) => e.referenceId === survey.id);
    assert.equal(surveyEval.credibility, "moderate"); // year+authors only
    // find-gaps ran over the library and its ids resolve to titles.
    assert.equal(res.gaps.referenceCount, 3);
    const missing = res.gaps.gaps.find((g) => g.kind === "missing_abstract");
    assert.ok(missing, "expected a missing_abstract gap");
    assert.deepEqual(
      missing.references.map((r) => r.title).sort(),
      [attn.title, survey.title].sort(),
    );
    assert.ok(res.gaps.gaps.some((g) => g.kind === "year_gap" && g.year === 2013));
    // match-questions ran with the question and names its matches.
    assert.ok(res.matches);
    assert.equal(res.matches.question, "what is known about attention and go?");
    const matchedTitles = res.matches.matches.map((m) => m.title);
    assert.ok(matchedTitles.includes(attn.title));
    assert.ok(matchedTitles.includes(go.title));
  });

  it("without a question, matches is null and the other two engines still run", async () => {
    await seedLibrary(ctxA);
    const started = await call("analyze-library", ctxA, {});
    await tick();
    const job = (await call("analysis-get", ctxA, { id: started.result.job.id })).result.job;
    assert.equal(job.status, "complete");
    assert.equal(job.result.matches, null);
    assert.equal(job.result.evaluations.length, 3);
    assert.equal(job.result.itemsRead.length, 3);
  });

  it("jobs are per-user and listed newest-first", async () => {
    await seedLibrary(ctxA);
    await call("analyze-library", ctxA, { question: "one" });
    await call("analyze-library", ctxA, { question: "two" });
    const listA = await call("analysis-list", ctxA);
    assert.equal(listA.result.count, 2);
    assert.equal(listA.result.analyses[0].question, "two");
    const listB = await call("analysis-list", ctxB);
    assert.equal(listB.result.count, 0);
    const cross = await call("analysis-get", ctxB, { id: listA.result.analyses[0].id });
    assert.equal(cross.ok, false);
  });
});

describe("research — citationNetwork library mode (S5 trio fix)", () => {
  it("computes over the caller's library: related links are edges, tags are keywords", async () => {
    const { go, attn } = await seedLibrary(ctxA);
    const r = await call("citationNetwork", ctxA, { fromLibrary: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.source, "library");
    assert.equal(r.result.totalPapers, 3);
    assert.equal(r.result.linkCount, 1);
    const ranked = Object.fromEntries(r.result.rankedPapers.map((p) => [p.id, p]));
    assert.equal(ranked[go.id].inDegree, 1);
    assert.equal(ranked[go.id].outDegree, 1);
    assert.equal(ranked[attn.id].inDegree, 1);
    assert.equal(r.result.message, undefined); // links exist → no empty-network note
  });

  it("an unlinked library says so plainly instead of erroring", async () => {
    await addRef(ctxA, { title: "Lonely Paper", year: 2020 });
    const r = await call("citationNetwork", ctxA, { fromLibrary: true });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalPapers, 1);
    assert.equal(r.result.linkCount, 0);
    assert.match(r.result.message, /No related-reference links/);
  });

  it("an empty library is an honest zero, and another user's library is not read", async () => {
    await seedLibrary(ctxA);
    const r = await call("citationNetwork", ctxB, { fromLibrary: true });
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "No papers.");
  });

  it("artifact mode is unchanged: papers still come from artifact.data", async () => {
    const artifact = {
      id: "dtu_x", meta: {},
      data: {
        papers: [
          { id: "p1", title: "One", year: 2001, references: ["p2"], keywords: ["a", "b"] },
          { id: "p2", title: "Two", year: 2002, references: [], keywords: ["a", "b"] },
        ],
      },
    };
    const r = await call("citationNetwork", ctxA, {}, artifact);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalPapers, 2);
    assert.equal(r.result.source, undefined); // no library annotation in artifact mode
    assert.equal(r.result.linkCount, undefined);
    const empty = await call("citationNetwork", ctxA, {});
    assert.deepEqual(empty.result, { message: "No papers." });
  });
});

describe("research — the factored analysis cores keep macro behaviour (S5)", () => {
  it("evaluate-source / find-gaps / match-questions answer as before", async () => {
    const { go, attn } = await seedLibrary(ctxA);
    const ev = await call("evaluate-source", ctxA, { referenceId: go.id });
    assert.equal(ev.ok, true);
    assert.equal(ev.result.title, go.title);
    assert.equal(ev.result.credibility, "high");
    assert.equal((await call("evaluate-source", ctxA, {})).ok, false);
    assert.equal((await call("evaluate-source", ctxA, { referenceId: "nope" })).ok, false);

    const gaps = await call("find-gaps", ctxA, {});
    assert.equal(gaps.ok, true);
    assert.equal(gaps.result.referenceCount, 3);
    assert.ok(gaps.result.gaps.some((g) => g.kind === "missing_abstract"));

    const mq = await call("match-questions", ctxA, { question: "attention mechanisms" });
    assert.equal(mq.ok, true);
    assert.deepEqual(mq.result.matches.map((m) => m.referenceId), [attn.id]);
    assert.equal((await call("match-questions", ctxA, {})).ok, false);

    // find-gaps' pre-existing empty-library contract, both branches:
    // no topic → "references or topic required"; topic but no library →
    // the reasoned no_references refusal.
    const emptyGaps = await call("find-gaps", ctxB, {});
    assert.equal(emptyGaps.ok, false);
    assert.equal(emptyGaps.error, "references or topic required");
    const emptyGapsTopic = await call("find-gaps", ctxB, { topic: "go" });
    assert.equal(emptyGapsTopic.ok, false);
    assert.equal(emptyGapsTopic.reason, "no_references");
  });
});
