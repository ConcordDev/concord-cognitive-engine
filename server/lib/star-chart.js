// server/lib/star-chart.js
//
// The knowledge lattice drawn as a star chart. Pure functions over a
// graph you hand in (nodes, edges, a visibility predicate, citation
// counts), so the same rules hold wherever they're called from and the
// tests can run without a server.
//
//   magnitude  — astronomical scale (brighter = smaller number), computed
//                from the star's real connections and citations:
//                  score = links + 2 × citations
//                  m     = 6 − 2.5 · log10(1 + score), clamped to [−1.5, 6.5]
//                An unconnected, uncited DTU is magnitude 6: barely visible.
//   class      — the DTU's shelf (works, specs, documents, knowledge, data,
//                parts), shown as a spectral letter and colour. Personal
//                context (records) only appears when you ask for it by id
//                (your own map notes, class D); system rows never appear.
//   constellation — a community found by modularity (deterministic Louvain
//                local moving) over the links among the stars on the
//                chart. Three or more stars
//                make a constellation; it is named after its brightest
//                star. Fewer are field stars.
//   position   — a chart coordinate, not a real sky: constellations sit on
//                a golden-angle spiral (largest nearest the centre) and
//                their stars settle by a short, seeded force layout; field
//                stars sit where their id hashes. Same data → same chart.

export const SPECTRAL = Object.freeze({
  specs: { letter: "B", colour: "#9db4ff" },
  knowledge: { letter: "A", colour: "#cad7ff" },
  data: { letter: "F", colour: "#f8f7ff" },
  works: { letter: "G", colour: "#fff4d6" },
  documents: { letter: "K", colour: "#ffd2a1" },
  parts: { letter: "M", colour: "#ffb08a" },
  // a star charted only because you asked for it by name (e.g. a note of
  // yours on one of your maps) when its shelf isn't charted by default
  notes: { letter: "D", colour: "#c9c9d6" },
});
const CHARTED = new Set(["specs", "knowledge", "data", "works", "documents", "parts"]);
const LINK_TYPES_SKIP = new Set(["tagged"]);

export function magnitude(links, citations) {
  const score = Math.max(0, links) + 2 * Math.max(0, citations);
  const m = 6 - 2.5 * Math.log10(1 + score);
  return Math.round(Math.max(-1.5, Math.min(6.5, m)) * 100) / 100;
}

/** Stable 32-bit hash → [0, 1). */
export function unitHash(s, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Undirected adjacency among `ids` over the given edges (tag edges excluded). */
function adjacency(ids, edges) {
  const adj = new Map([...ids].map((id) => [id, new Set()]));
  for (const e of edges) {
    if (LINK_TYPES_SKIP.has(e.type)) continue;
    if (e.source === e.target) continue;
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source).add(e.target);
    adj.get(e.target).add(e.source);
  }
  return adj;
}

/**
 * Communities by modularity: deterministic Louvain local moving (one level).
 * Each node, in id order, moves to the neighbouring community with the best
 * modularity gain  k_in − Σtot · k / 2m  (staying put on a tie; ties between
 * communities go to the smaller id), until a full pass moves nothing.
 * Returns Map id → community label.
 */
export function communities(adj, rounds = 20) {
  const order = [...adj.keys()].sort();
  const deg = new Map(order.map((n) => [n, adj.get(n).size]));
  const m2 = [...deg.values()].reduce((a, b) => a + b, 0);
  const comm = new Map(order.map((n) => [n, n]));
  if (!m2) return comm;
  const tot = new Map(order.map((n) => [n, deg.get(n)]));
  for (let r = 0; r < rounds; r++) {
    let moved = false;
    for (const n of order) {
      const k = deg.get(n);
      if (!k) continue;
      const cur = comm.get(n);
      tot.set(cur, tot.get(cur) - k);
      const kin = new Map();
      for (const nb of adj.get(n)) { const c = comm.get(nb); kin.set(c, (kin.get(c) || 0) + 1); }
      let best = cur;
      let bestGain = (kin.get(cur) || 0) - (tot.get(cur) * k) / m2;
      for (const [c, w] of [...kin.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
        const gain = w - (tot.get(c) * k) / m2;
        if (gain > bestGain + 1e-12) { best = c; bestGain = gain; }
      }
      tot.set(best, tot.get(best) + k);
      if (best !== cur) { comm.set(n, best); moved = true; }
    }
    if (!moved) break;
  }
  return comm;
}

/**
 * Build the chart.
 * @param {object} g
 *   nodes: Map id → { id, title, tier, tags }
 *   edges: iterable of { source, target, type }
 *   dtu(id): the DTU record (for shelf/created) or null
 *   canSee(id): visibility for this viewer
 *   shelfOf(dtu): the DTU's shelf
 *   citations(id): citation count
 * @param {object} opts { limit = 400, include = [] }
 */
export function buildSky(g, opts = {}) {
  const limit = Math.max(20, Math.min(1500, Math.round(Number(opts.limit) || 400)));
  const include = new Set((opts.include || []).map(String).slice(0, 200));
  const edges = [...g.edges];

  // every chartable star the viewer may see, with its real link count
  const candidates = new Map();
  for (const n of g.nodes.values()) {
    if (n.type === "tag" || !g.canSee(n.id)) continue;
    const dtu = g.dtu(n.id);
    if (!dtu) continue;
    let shelf = g.shelfOf(dtu);
    if (!CHARTED.has(shelf)) {
      if (!include.has(n.id) || shelf === "system") continue;
      shelf = "notes";
    }
    candidates.set(n.id, { id: n.id, title: String(n.title || dtu.title || "Untitled").slice(0, 120), shelf, links: 0, citations: Number(g.citations(n.id)) || 0 });
  }
  const linkPairs = new Set();
  for (const e of edges) {
    if (LINK_TYPES_SKIP.has(e.type) || e.source === e.target) continue;
    const a = candidates.get(e.source); const b = candidates.get(e.target);
    if (!a || !b) continue;
    const key = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
    if (linkPairs.has(key)) continue;
    linkPairs.add(key);
    a.links++; b.links++;
  }
  const visibleTotal = candidates.size;

  // the brightest `limit`, plus anything asked for by name
  const ranked = [...candidates.values()].sort((x, y) => (y.links + 2 * y.citations) - (x.links + 2 * x.citations) || (x.id < y.id ? -1 : 1));
  const chosen = new Map();
  for (const id of include) if (candidates.has(id)) chosen.set(id, candidates.get(id));
  for (const s of ranked) { if (chosen.size >= limit) break; chosen.set(s.id, s); }

  const adj = adjacency(new Set(chosen.keys()), edges);
  const label = communities(adj);
  const groups = new Map();
  for (const [id, l] of label) { if (!groups.has(l)) groups.set(l, []); groups.get(l).push(id); }

  const stars = new Map();
  for (const s of chosen.values()) {
    const sp = SPECTRAL[s.shelf];
    stars.set(s.id, { ...s, magnitude: magnitude(s.links, s.citations), spectral: sp.letter, colour: sp.colour, constellation: null, x: 0, y: 0 });
  }

  // constellations: 3+ stars, largest first, named for their brightest star
  const consts = [...groups.values()].filter((m) => m.length >= 3)
    .map((members) => {
      const sorted = members.map((id) => stars.get(id)).sort((a, b) => a.magnitude - b.magnitude || (a.id < b.id ? -1 : 1));
      return { id: sorted[0].id, name: sorted[0].title, members: sorted.map((s) => s.id), size: members.length };
    })
    .sort((a, b) => b.size - a.size || (a.id < b.id ? -1 : 1));

  // place constellations on a golden-angle spiral, then settle their stars
  const GOLD = Math.PI * (3 - Math.sqrt(5));
  consts.forEach((c, i) => {
    const r = 0.06 + 0.4 * Math.sqrt((i + 0.5) / Math.max(1, consts.length));
    const cx = 0.5 + r * Math.cos(i * GOLD); const cy = 0.5 + r * Math.sin(i * GOLD);
    const spread = Math.min(0.16, 0.035 + 0.012 * Math.sqrt(c.size));
    const pos = new Map(c.members.map((id) => [id, { x: cx + (unitHash(id, 1) - 0.5) * spread, y: cy + (unitHash(id, 2) - 0.5) * spread }]));
    for (let it = 0; it < 60; it++) {
      for (const a of c.members) {
        const pa = pos.get(a); let fx = 0; let fy = 0;
        for (const b of c.members) {
          if (a === b) continue;
          const pb = pos.get(b); const dx = pa.x - pb.x; const dy = pa.y - pb.y; const d2 = dx * dx + dy * dy + 1e-6;
          fx += (dx / d2) * 0.00002; fy += (dy / d2) * 0.00002; // repel
        }
        for (const b of adj.get(a)) {
          if (!pos.has(b)) continue;
          const pb = pos.get(b); fx += (pb.x - pa.x) * 0.04; fy += (pb.y - pa.y) * 0.04; // pull along links
        }
        fx += (cx - pa.x) * 0.02; fy += (cy - pa.y) * 0.02;
        pa.x += Math.max(-0.01, Math.min(0.01, fx)); pa.y += Math.max(-0.01, Math.min(0.01, fy));
      }
    }
    for (const id of c.members) { const s = stars.get(id); const p = pos.get(id); s.x = p.x; s.y = p.y; s.constellation = c.id; }
  });
  for (const s of stars.values()) {
    if (s.constellation) continue;
    s.x = 0.03 + unitHash(s.id, 3) * 0.94; s.y = 0.03 + unitHash(s.id, 4) * 0.94;
  }
  for (const s of stars.values()) { s.x = Math.round(Math.max(0, Math.min(1, s.x)) * 10000) / 10000; s.y = Math.round(Math.max(0, Math.min(1, s.y)) * 10000) / 10000; }

  // the lines drawn: links between charted stars, within a constellation
  // first (its figure), then the bridges between constellations
  const lines = [];
  for (const key of linkPairs) {
    const [a, b] = key.split("|");
    if (!stars.has(a) || !stars.has(b)) continue;
    const ca = stars.get(a).constellation; const cb = stars.get(b).constellation;
    lines.push({ a, b, within: !!ca && ca === cb });
  }

  return {
    visibleTotal,
    shown: stars.size,
    stars: [...stars.values()].map((s) => ({ id: s.id, title: s.title, shelf: s.shelf, spectral: s.spectral, colour: s.colour, magnitude: s.magnitude, links: s.links, citations: s.citations, constellation: s.constellation, x: s.x, y: s.y })),
    constellations: consts.map((c) => ({ id: c.id, name: c.name, size: c.size })),
    lines: lines.slice(0, 6000),
  };
}

/** Shortest route between two visible stars over links (not tags), up to `maxHops`. */
export function route(g, from, to, maxHops = 8) {
  if (!g.canSee(from) || !g.canSee(to) || !g.dtu(from) || !g.dtu(to)) return { ok: false, error: "star not found" };
  if (from === to) return { ok: true, path: [from], hops: 0, steps: [] };
  const adj = new Map();
  const add = (a, b, type) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push({ to: b, type }); };
  for (const e of g.edges) {
    if (LINK_TYPES_SKIP.has(e.type) || e.source === e.target) continue;
    add(e.source, e.target, e.type); add(e.target, e.source, e.type);
  }
  const prev = new Map([[from, null]]);
  let frontier = [from];
  for (let hop = 0; hop < maxHops && frontier.length; hop++) {
    const next = [];
    for (const id of frontier) {
      for (const { to: n, type } of adj.get(id) || []) {
        if (prev.has(n) || !g.canSee(n) || !g.dtu(n)) continue;
        prev.set(n, { id, type });
        if (n === to) {
          const path = [to]; const steps = [];
          let cur = to;
          while (prev.get(cur)) { const p = prev.get(cur); steps.unshift({ from: p.id, to: cur, type: p.type }); path.unshift(p.id); cur = p.id; }
          return { ok: true, path, hops: path.length - 1, steps };
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return { ok: true, path: null, hops: null, steps: [], note: `no route within ${maxHops} jumps` };
}
