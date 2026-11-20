// The star chart's rules, as pure functions: magnitude from real links and
// citations; class from the shelf; personal and system rows kept off the
// sky; constellations found deterministically and named for their brightest
// star; the same data always drawing the same chart; routes that respect
// what the viewer may see.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { magnitude, communities, buildSky, route, unitHash } from "../lib/star-chart.js";

function graph({ nodes, edges, hidden = [], shelves = {}, cites = {} }) {
  const map = new Map(nodes.map((id) => [id, { id, title: `Star ${id}` }]));
  return {
    nodes: map,
    edges: edges.map(([source, target, type = "parent"]) => ({ source, target, type })),
    dtu: (id) => (map.has(id) ? { id, title: `Star ${id}` } : null),
    canSee: (id) => map.has(id) && !hidden.includes(id),
    shelfOf: (d) => shelves[d.id] || "knowledge",
    citations: (id) => cites[id] || 0,
  };
}

describe("magnitude", () => {
  it("is the astronomical scale from links + 2 × citations", () => {
    assert.equal(magnitude(0, 0), 6);
    assert.equal(magnitude(9, 0), 3.5);          // 6 − 2.5·log10(10)
    assert.equal(magnitude(0, 4.5), 3.5);        // citations count double
    assert.equal(magnitude(99, 0), 1);           // 6 − 2.5·2
    assert.equal(magnitude(1e9, 0), -1.5);       // clamped
    assert.equal(magnitude(-5, -5), 6);          // nothing negative
  });
});

describe("constellations", () => {
  it("two triangles joined by one link are two communities, the same every time", () => {
    const adj = new Map();
    const link = (a, b) => { for (const [x, y] of [[a, b], [b, a]]) { if (!adj.has(x)) adj.set(x, new Set()); adj.get(x).add(y); } };
    link("a", "b"); link("b", "c"); link("a", "c"); link("x", "y"); link("y", "z"); link("x", "z"); link("c", "x");
    const l1 = communities(adj); const l2 = communities(adj);
    assert.deepEqual([...l1], [...l2]);
    assert.equal(l1.get("a"), l1.get("b"));
    assert.equal(l1.get("y"), l1.get("z"));
    assert.notEqual(l1.get("a"), l1.get("z"));
  });
});

describe("the sky", () => {
  const base = {
    nodes: ["a", "b", "c", "d", "x", "y", "z", "lone", "priv", "diary", "sys"],
    edges: [["a", "b"], ["b", "c"], ["a", "c"], ["a", "d"], ["x", "y"], ["y", "z"], ["x", "z"], ["c", "x"], ["a", "priv"], ["a", "tag:t", "tagged"]],
    hidden: ["priv"],
    shelves: { diary: "records", sys: "system", x: "works", y: "works", z: "works" },
    cites: { a: 3 },
  };

  it("charts only what the viewer may see on charted shelves, with real brightness", () => {
    const sky = buildSky(graph(base), {});
    const ids = sky.stars.map((s) => s.id).sort();
    assert.deepEqual(ids, ["a", "b", "c", "d", "lone", "x", "y", "z"]);
    assert.equal(sky.visibleTotal, 8);
    const a = sky.stars.find((s) => s.id === "a");
    // a links to b, c, d (the private star and the tag don't count) and has 3 citations
    assert.deepEqual([a.links, a.citations, a.magnitude], [3, 3, magnitude(3, 3)]);
    assert.equal(sky.stars.find((s) => s.id === "lone").magnitude, 6);
    assert.equal(sky.stars.find((s) => s.id === "x").spectral, "G"); // works
    assert.equal(a.spectral, "A"); // knowledge
    assert.ok(!sky.lines.some((l) => l.a === "priv" || l.b === "priv"));
  });

  it("names a constellation for its brightest star, and draws the same chart every time", () => {
    const one = buildSky(graph(base), {}); const two = buildSky(graph(base), {});
    assert.deepEqual(one, two);
    const ca = one.stars.find((s) => s.id === "a").constellation;
    assert.equal(ca, "a"); // a is the brightest of {a,b,c,d}
    assert.equal(one.constellations.find((c) => c.id === "a").name, "Star a");
    assert.equal(one.stars.find((s) => s.id === "lone").constellation, null); // a field star
    for (const s of one.stars) assert.ok(s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1);
    assert.ok(one.lines.find((l) => (l.a === "a" && l.b === "b") || (l.a === "b" && l.b === "a")).within);
    assert.equal(one.lines.find((l) => [l.a, l.b].sort().join() === "c,x").within, false); // a bridge
  });

  it("keeps the brightest under a limit, and charts a star asked for by id even off-shelf", () => {
    const many = { nodes: Array.from({ length: 40 }, (_, i) => `n${i}`), edges: Array.from({ length: 39 }, (_, i) => [`n${i}`, `n${i + 1}`]) };
    many.nodes.push("note"); many.shelves = { note: "records" };
    const sky = buildSky(graph(many), { limit: 20, include: ["note"] });
    assert.equal(sky.shown, 20);
    const note = sky.stars.find((s) => s.id === "note");
    assert.equal(note.spectral, "D");
    // a system row is never charted, even asked for
    assert.ok(!buildSky(graph(base), { include: ["sys", "priv"] }).stars.some((s) => s.id === "sys" || s.id === "priv"));
  });

  it("unitHash is stable and in [0, 1)", () => {
    assert.equal(unitHash("dtu_1"), unitHash("dtu_1"));
    assert.notEqual(unitHash("dtu_1"), unitHash("dtu_2"));
    for (const k of ["a", "b", "long-id-0123456789"]) { const h = unitHash(k, 7); assert.ok(h >= 0 && h < 1); }
  });
});

describe("routes", () => {
  const g = graph({ nodes: ["a", "b", "c", "d", "e", "secret"], edges: [["a", "b"], ["b", "c"], ["c", "d"], ["a", "secret"], ["secret", "e"], ["a", "e", "tagged"]], hidden: ["secret"] });
  it("finds the shortest path over links, with each step's kind", () => {
    const r = route(g, "a", "d");
    assert.deepEqual(r.path, ["a", "b", "c", "d"]);
    assert.equal(r.hops, 3);
    assert.deepEqual(r.steps.map((s) => s.type), ["parent", "parent", "parent"]);
  });
  it("never routes through a star the viewer can't see, nor over tags", () => {
    const r = route(g, "a", "e");
    assert.equal(r.path, null);
    assert.match(r.note, /no route within 8 jumps/);
  });
  it("refuses unknown or hidden endpoints and stops at the hop limit", () => {
    assert.equal(route(g, "a", "secret").ok, false);
    assert.equal(route(g, "nope", "a").ok, false);
    assert.equal(route(g, "a", "d", 2).path, null);
    assert.deepEqual(route(g, "a", "a").path, ["a"]);
  });
});
