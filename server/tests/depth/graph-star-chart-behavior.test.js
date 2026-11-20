// tests/depth/graph-star-chart-behavior.test.js — the Graph lens's star chart,
// through the real server: the sky charts what the viewer may see (never
// someone's private DTU, never personal context or system rows), brightness
// comes from real links, a star's catalogue card carries its lineage and
// your charts, your maps draw your own constellations over the sky, and
// routes never pass through what you can't see.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, macroRuntime } from "./_harness.js";

let runMacro, STATE, ada, ben;
// The lattice index rebuilds at most every 5 s after the store changes.
const settle = () => new Promise((r) => setTimeout(r, 5300));
const graph = (name, input, ctx) => runMacro("graph", name, input, ctx);
const lens = (action, params, ctx) => lensRun("graph", action, { params }, ctx);
async function make(ctx, fields) {
  const r = await runMacro("dtu", "create", { human: { summary: `${fields.title} explains how load moves through a structure into the ground.` }, ...fields }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  return STATE.dtus.get(r.dtu.id);
}
async function sky(ctx, input = {}) {
  const r = await graph("sky", { limit: 1500, ...input }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  return r;
}

describe("the star chart", () => {
  let arch, beam, column, footing, diary, secret;
  before(async () => {
    ({ runMacro, STATE } = await macroRuntime("graph-sky"));
    ada = await depthCtx("sky-ada"); ben = await depthCtx("sky-ben");
    arch = await make(ada, { title: "Sky: arches" });
    beam = await make(ada, { title: "Sky: beams", lineage: [arch.id] });
    column = await make(ada, { title: "Sky: columns", lineage: [arch.id] });
    footing = await make(ada, { title: "Sky: footings", lineage: [column.id] });
    diary = await make(ada, { title: "Sky: what we said", source: "conversation-memory" });
    arch.visibility = "public"; // others may build on it (citation consent)
    secret = await make(ben, { title: "Sky: ben's private draft", lineage: [arch.id] });
    secret.privacy = "private"; secret.scope = "user";
    STATE.dtus.set?.(secret.id, secret);
    await settle();
  });

  it("charts linked knowledge with real brightness and hides personal and private rows", async () => {
    const s = await sky(ada);
    const byId = new Map(s.stars.map((x) => [x.id, x]));
    for (const d of [arch, beam, column, footing]) assert.ok(byId.has(d.id), d.title);
    assert.ok(!byId.has(diary.id), "personal context is not on the sky");
    assert.ok(!byId.has(secret.id), "someone else's private DTU is not on the sky");
    const a = byId.get(arch.id);
    assert.equal(a.spectral, "A"); // knowledge
    assert.ok(a.links >= 2, `arch links ${a.links}`);
    assert.ok(a.magnitude < byId.get(footing.id).magnitude, "the hub is brighter than the leaf");
    // its owner sees ben's private star; ada does not
    const benSky = await sky(ben, { include: [secret.id] });
    assert.ok(benSky.stars.some((x) => x.id === secret.id));
    assert.ok(!s.lines.some((l) => l.a === secret.id || l.b === secret.id));
  });

  it("a star's catalogue card: lineage, links, and what's hidden stays hidden", async () => {
    const r = await graph("star", { id: arch.id }, ada);
    assert.equal(r.ok, true, r.error);
    const st = r.star;
    assert.deepEqual(st.children.map((c) => c.id).sort(), [beam.id, column.id].sort());
    assert.ok(!st.children.some((c) => c.id === secret.id), "a private child isn't listed");
    assert.ok(!st.relations.some((c) => c.id === secret.id));
    assert.equal(st.isMine, true);
    assert.equal((await graph("star", { id: footing.id }, ada)).star.parents[0].id, column.id);
    assert.equal((await graph("star", { id: secret.id }, ada)).ok, false);
    assert.equal((await graph("star", { id: "nope" }, ada)).ok, false);
  });

  it("routes go over links and never through what the viewer can't see", async () => {
    const r = await graph("route", { from: beam.id, to: footing.id }, ada);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.path, [beam.id, arch.id, column.id, footing.id]);
    assert.deepEqual(r.stops.map((x) => x.title), ["Sky: beams", "Sky: arches", "Sky: columns", "Sky: footings"]);
    assert.equal((await graph("route", { from: beam.id, to: secret.id }, ada)).ok, false);
    assert.match((await graph("route", { from: beam.id }, ada)).error, /two stars/);
  });

  it("your maps are your constellations: drawn between the stars they link, yours alone", async () => {
    const map = (await lens("map-create", { title: "Load path" }, ada)).result.map;
    const n1 = (await lens("node-add", { mapId: map.id, label: "Beam" }, ada)).result.node;
    const n2 = (await lens("node-add", { mapId: map.id, label: "Footing" }, ada)).result.node;
    await lens("link-node-dtu", { mapId: map.id, nodeId: n1.id, dtuId: beam.id }, ada);
    await lens("link-node-dtu", { mapId: map.id, nodeId: n2.id, dtuId: footing.id }, ada);
    await lens("edge-add", { mapId: map.id, fromNodeId: n1.id, toNodeId: n2.id, label: "carries to" }, ada);
    await settle();
    const mine = (await graph("my-constellations", {}, ada)).constellations.find((c) => c.id === map.id);
    assert.ok(mine, "the map is one of ada's constellations");
    assert.ok(mine.stars.includes(beam.id) && mine.stars.includes(footing.id));
    assert.ok(mine.lines.some(([a, b]) => a === beam.id && b === footing.id));
    // ben sees none of ada's charts, and ada's line wasn't written into the shared lattice
    assert.deepEqual((await graph("my-constellations", {}, ben)).constellations.filter((c) => c.id === map.id), []);
    // the star card knows it's on ada's chart
    assert.ok((await graph("star", { id: beam.id }, ada)).star.charts.some((c) => c.id === map.id));
    // a map note of ada's own charts when asked for by id (class D), for ada only
    const noteDtu = (await lens("map-detail", { id: map.id }, ada)).result.map.nodes[0].dtuId;
    const withNote = await sky(ada, { include: [noteDtu] });
    const note = withNote.stars.find((x) => x.id === noteDtu);
    assert.ok(note, "ada's own map note charts on request");
    assert.ok(!(await sky(ben, { include: [noteDtu] })).stars.some((x) => x.id === noteDtu), "and never for anyone else");
  });

  it("the same lattice draws the same chart", async () => {
    const one = await sky(ada); const two = await sky(ada);
    const pos = (r) => r.stars.filter((x) => [arch.id, beam.id].includes(x.id)).map((x) => [x.id, x.x, x.y]).sort();
    assert.deepEqual(pos(one), pos(two));
  });
});
