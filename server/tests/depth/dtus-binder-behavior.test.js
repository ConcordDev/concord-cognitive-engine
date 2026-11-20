// tests/depth/dtus-binder-behavior.test.js — the Binder (DTUs lens).
// Every DTU sits on the right shelf; the default view shows only valuable work
// and hides personal context and machine rows unless filtered in; owners design
// their cards; connections come with reasons; fusing and remixing credit their
// sources and refuse private or personal cards; knowledge is checked by the real
// verification gate before it can be published, by any publish path.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load, macroRuntime } from "./_harness.js";
import { shelfOf, DEFAULT_SHELVES, needsPublishCheck } from "../../lib/dtu-shelf.js";
import { publishGateDenial } from "../../lib/dtu-publish-gate.js";

let STATE, runMacro;
const run = (action, params, ctx) => lensRun("dtus", action, { params }, ctx);
async function make(ctx, fields) {
  const r = await runMacro("dtu", "create", fields, ctx);
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  const d = STATE.dtus.get(r.dtu.id);
  return d;
}

describe("shelves", () => {
  const cases = [
    [{ title: "Paper Moons", meta: { type: "music_release" } }, "works"],
    [{ title: "Harbour at dusk", meta: { type: "artwork", lens: "art" } }, "works"],
    [{ title: "Cover — Paper Moons", meta: { type: "artwork" } }, "parts"],
    [{ title: "night-bus", type: "media", mediaType: "audio", mimeType: "audio/wav" }, "parts"],
    [{ title: "Spec sheet", type: "media", mediaType: "document", mimeType: "application/pdf" }, "documents"],
    [{ title: "client_error: uncaught", kind: "client_error", tags: ["client_error"] }, "system"],
    [{ title: "MEGA — mesh beacon", tier: "mega", visibility: "internal" }, "system"],
    [{ title: "What we said", source: "conversation-memory", human: { summary: "The user prefers short answers and lives in Leeds." } }, "records"],
    [{ title: "Till close", source: "retail-till-close", tags: ["till", "ledger"] }, "records"],
    [{ title: "BTC price", source: "feed:coingecko", meta: { feedName: "coingecko" } }, "data"],
    [{ title: "Glulam beam sizing", domain: "engineering", human: { summary: "Sizing glulam beams for residential spans." } }, "specs"],
    [{ title: "Report", source: "file-import", human: { summary: "x" } }, "documents"],
    [{ title: "Todo Tracker", type: "forge_app", meta: { skill_kind: "forge_app" }, human: { summary: "A single-file todo tracker app, built in the forge." } }, "specs"],
    [{ title: "Why arches stand", human: { summary: "An arch carries load in compression, pushing outward at its feet, so the abutments must resist the thrust." } }, "knowledge"],
  ];
  for (const [d, shelf] of cases) {
    it(`${d.title} → ${shelf}`, () => assert.equal(shelfOf(d).shelf, shelf, shelfOf(d).reason));
  }
  it("a word like “proof” in an app's summary doesn't make it knowledge that needs a claim check", () => {
    assert.equal(needsPublishCheck({ title: "Todo", type: "forge_app", meta: { skill_kind: "forge_app" }, human: { summary: "A todo tracker, minted for the e2e purchase proof." } }), false);
    assert.equal(needsPublishCheck({ title: "Why arches stand", human: { summary: "An arch carries load in compression, pushing outward at its feet, so the abutments resist thrust." } }), true);
  });
  it("shows only valuable shelves by default", () => assert.deepEqual([...DEFAULT_SHELVES], ["works", "specs", "documents", "knowledge"]));
});

describe("the binder", () => {
  let ada, ben, arch, spec, memo, err;
  before(async () => {
    ({ STATE } = await load());
    ({ runMacro } = await macroRuntime("binder"));
    ada = await depthCtx("binder-ada");
    ben = await depthCtx("binder-ben");
    arch = await make(ada, { title: "Why arches stand", human: { summary: "An arch carries its load in compression and pushes outward at both feet, so the abutments must resist that horizontal thrust." }, tags: ["arch", "structures"] });
    spec = await make(ada, { title: "Masonry arch spec", domain: "engineering", human: { summary: "Span 4 m, rise 1 m, abutments sized for the horizontal thrust of the arch; voussoirs in compression." }, tags: ["spec"] });
    memo = await make(ada, { title: "Chat memory — ada", source: "conversation-memory", human: { summary: "Ada asked about arches twice this week; prefers diagrams." } });
    err = await make(ada, { title: "client_error: uncaught_throw @ code", tags: ["client_error"] });
  });

  it("browses valuable shelves by default and keeps personal and system rows out until asked", async () => {
    const r = await run("shelf-browse", { scope: "mine" }, ada);
    const ids = r.result.cards.map((c) => c.id);
    assert.ok(ids.includes(arch.id) && ids.includes(spec.id));
    assert.ok(!ids.includes(memo.id) && !ids.includes(err.id));
    const withRecords = await run("shelf-browse", { scope: "mine", shelves: ["records"] }, ada);
    assert.deepEqual(withRecords.result.cards.map((c) => c.id).filter((id) => [memo.id, err.id].includes(id)), [memo.id]);
    const facets = await run("shelf-facets", { scope: "mine" }, ada);
    assert.ok(facets.result.counts.records >= 1 && facets.result.counts.system >= 1);
    assert.equal(facets.result.hiddenTotal, facets.result.counts.data + facets.result.counts.records + facets.result.counts.parts + facets.result.counts.system);
    // someone else's private cards never appear
    const other = await run("shelf-browse", { scope: "library" }, ben);
    assert.ok(!other.result.cards.some((c) => c.id === arch.id));
  });

  it("only the owner designs a card, with validated choices", async () => {
    const ok = await run("card-design", { id: arch.id, design: { frame: "gilt", palette: "midnight", accent: "#ff5a1f", layout: "text", typeface: "mono", subtitle: "Compression, explained" } }, ada);
    assert.equal(ok.ok, true);
    assert.deepEqual([ok.result.design.frame, ok.result.design.palette, ok.result.design.accent, ok.result.design.subtitle], ["gilt", "midnight", "#ff5a1f", "Compression, explained"]);
    for (const [k, v, re] of [["frame", "holo", /frame must be/], ["accent", "orange", /accent must be/], ["layout", "wide", /layout/], ["coverDtuId", spec.id, /must be an image/]]) {
      assert.match((await run("card-design", { id: arch.id, design: { [k]: v } }, ada)).result.error, re, k);
    }
    assert.match((await run("card-design", { id: arch.id, design: { frame: "ink" } }, ben)).result.error, /only the card's owner/);
    const back = await run("card-get", { id: arch.id }, ada);
    assert.equal(back.result.card.design.frame, "gilt");
  });

  it("connections come with reasons; a spec and the knowledge behind it pair up", async () => {
    const r = await run("card-connections", { id: arch.id }, ada);
    const hit = r.result.connections.find((c) => c.card.id === spec.id);
    assert.ok(hit, "spec should connect");
    assert.equal(hit.relation, "complement");
    assert.ok(hit.sharedTerms.includes("thrust") || hit.sharedTerms.includes("abutments"));
    assert.ok(!r.result.connections.some((c) => c.card.id === memo.id || c.card.id === err.id));
  });

  it("fusing two cards makes a new card that credits both; private and personal cards are refused", async () => {
    const f = await run("card-fuse", { aId: arch.id, bId: spec.id, title: "Arch, from theory to drawing" }, ada);
    assert.equal(f.ok, true, f.error);
    const made = STATE.dtus.get(f.result.card.id);
    assert.deepEqual([...made.lineage.parents].sort(), [arch.id, spec.id].sort());
    const back = await run("card-get", { id: arch.id }, ada);
    assert.ok(back.result.back.children.some((c) => c.id === made.id));
    assert.match((await run("card-fuse", { aId: arch.id, bId: memo.id, title: "x" }, ada)).result.error, /personal context|can't be built on/);
    assert.match((await run("card-fuse", { aId: arch.id, bId: arch.id, title: "x" }, ada)).result.error, /two different/);
    // Ben can't read Ada's private cards at all, so he can't fuse them
    assert.match((await run("card-fuse", { aId: arch.id, bId: spec.id, title: "steal" }, ben)).result.error, /card not found/);
    assert.match((await run("card-remix", { id: arch.id, title: " " }, ada)).result.error, /title/);
  });
});

describe("check before publishing", () => {
  let ada, ben, sum, lab, note, art;
  before(async () => {
    ({ STATE } = await load());
    ({ runMacro } = await macroRuntime("binder-pub"));
    ada = await depthCtx("binder-pub-ada");
    ben = await depthCtx("binder-pub-ben");
    sum = await make(ada, { title: "A small sum", human: { summary: "Counting plainly, the total of the two bundles: 2 + 2 = 5, which settles the stock count." } });
    lab = await make(ada, { title: "Steel yield measured", tags: ["empirical"], human: { summary: "Measured yield of the sample was 250 MPa at 20 °C over 12 mm coupons." } });
    note = await make(ada, { title: "Chat memory", source: "conversation-memory", human: { summary: "Ada mentioned the stock count twice." } });
    art = await make(ada, { title: "Harbour", meta: { type: "artwork", lens: "art" }, human: { summary: "Oil on canvas." } });
  });

  it("knowledge can't be published unchecked, refuted, or after its text changed", async () => {
    assert.equal((await run("card-publish", { id: sum.id }, ada)).result.error, "check_required");
    const c1 = await run("card-check", { id: sum.id }, ada);
    assert.equal(c1.result.outcome, "REFUTED");
    assert.ok(c1.result.claims.some((c) => c.result === "refuted"));
    assert.equal((await run("card-publish", { id: sum.id }, ada)).result.error, "refuted");
    // fix the sum; the old receipt no longer applies
    const upd = await runMacro("dtu", "update", { id: sum.id, summary: "Counting plainly, the total of the two bundles: 2 + 2 = 4, which settles the stock count." }, ada);
    assert.equal(upd.ok, true);
    assert.equal(publishGateDenial(STATE.dtus.get(sum.id))?.error, "check_required");
    const c2 = await run("card-check", { id: sum.id }, ada);
    assert.equal(c2.result.outcome, "VERIFIED");
    const p = await run("card-publish", { id: sum.id }, ada);
    assert.equal(p.ok, true, p.error);
    assert.equal(p.result.foil, true);
    const seen = await run("card-get", { id: sum.id }, ben);
    assert.equal(seen.result.card.published, true);
    // and it is in the library for others, though dtu.create left it on the "local" federation tier
    const lib = await run("shelf-browse", { scope: "library", q: "stock count" }, ben);
    assert.ok(lib.result.cards.some((c) => c.id === sum.id));
    assert.ok(!lib.result.cards.some((c) => c.id === lab.id), "unpublished stays private");
  });

  it("an empirical claim needs an outside source", async () => {
    await run("card-check", { id: lab.id }, ada);
    assert.equal((await run("card-publish", { id: lab.id }, ada)).result.error, "no_outside_source");
    // a link in the prose is not a declared source; the card's sources are
    for (const bad of [["javascript:alert(1)"], ["not a url"], "https://x.example"]) {
      assert.equal((await run("card-sources", { id: lab.id, sources: bad }, ada)).ok, false, String(bad));
    }
    assert.match((await run("card-sources", { id: lab.id, sources: [{ url: "https://example.org/lab-report-17" }] }, ben)).result.error, /only the card's owner/);
    const src = await run("card-sources", { id: lab.id, sources: [{ url: "https://example.org/lab-report-17", title: "Lab report 17" }] }, ada);
    assert.equal(src.ok, true);
    const p = await run("card-publish", { id: lab.id }, ada);
    assert.notEqual(p.result?.error, "no_outside_source");
  });

  it("personal context is never published; works publish without a check; only the owner publishes", async () => {
    assert.equal((await run("card-publish", { id: note.id }, ada)).result.error, "private_shelf");
    assert.equal((await run("card-publish", { id: art.id }, ada)).ok, true);
    assert.match((await run("card-publish", { id: lab.id }, ben)).result.error, /only the card's owner/);
    assert.match((await run("card-check", { id: lab.id }, ben)).result.error, /only the card's owner/);
  });

  it("the same gate holds on the other publish paths", async () => {
    const k = await make(ada, { title: "Unchecked theory", human: { summary: "A theory of why the harbour silts: the tide carries fine sediment in and the river cannot flush it out again." } });
    const list = await runMacro("marketplace", "list", { dtuId: k.id, price: 5, currency: "CC", title: "Theory" }, ada);
    assert.equal(list.ok, false);
    assert.equal(list.error, "check_required");
  });
});
