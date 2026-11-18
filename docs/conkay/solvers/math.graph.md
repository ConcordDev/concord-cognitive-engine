# math.graph — graph algorithms (SX-NUM-21)

Graph algorithms over an explicit {nodes, edges} input.
Code: `server/lib/conkay/physics/solvers/graph.js`
(registry solver, L2). Reference: closed-form small graphs —
the catalogue's reference case is the CLRS textbook flow
network.

## Targets

- **shortest-path** — Dijkstra. Its envelope is non-negative
  weights: a negative edge refuses by name, pointing at
  bellman-ford, rather than answering wrongly.
- **bellman-ford** — negative weights handled; a reachable
  negative cycle is served as a **named finding** (WARN, the
  cycle nodes listed), never dressed as distances.
- **mst** — Kruskal. A disconnected graph returns its
  minimum spanning **forest**, labelled as a forest with its
  component count.
- **topo-sort** — Kahn. A cyclic remainder is named (WARN
  with the unorderable nodes), beside the partial order.
- **max-flow** — Dinic. The result carries its **min cut**,
  whose capacity equals the flow value: the certificate a
  checker verifies without trusting the algorithm. CLRS
  reference: flow 23, cut {s,v1,v2,v4}|{v3,t} of capacity
  12 + 7 + 4 = 23.
- **matching** — Hopcroft–Karp maximum bipartite matching
  against a declared bipartition; an edge crossing outside
  it refuses by name.
- **spectral** — the Laplacian spectrum via the stack's own
  Jacobi eigensolver (SX-NUM-04), with the Fiedler value and
  a connectivity verdict; capped at 64 nodes by the dense
  eigensolver, named in the refusal.

## Envelope

Explicit node/edge inputs to 5,000 nodes / 50,000 edges
(spectral excepted, above). Node references outside the
declared set refuse with the edge index named.

## Replay

Walker: `conkay_solve` math.graph with the CLRS network
from the solver doc's test, target `max-flow` → PASS with
maxFlow 23 and minCut.capacity 23; the three-node negative
cycle, target `bellman-ford` → WARN with the cycle named.
Reachability via solve.direct rides SC-00 (named
foundation); the MCP/chain paths reach the registry entry
as registered.
