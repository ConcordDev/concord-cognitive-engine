# math.geometry-comp — computational geometry (SX-NUM-23)

Computational geometry at the JS tier. Code:
`server/lib/conkay/physics/solvers/geometry-comp.js`
(registry solver, L2). Reference: closed-form geometry —
the catalogue's reference case is the hull of the unit
cube's vertices.

## Targets

- **convex-hull-2d** — monotone chain; area and perimeter;
  collinear inputs return the segment hull, labelled
  degenerate rather than dressed as a polygon.
- **convex-hull-3d** — incremental beneath-beyond hull;
  volume, surface area, hull vertices. Reference: the unit
  cube (with its center point in the input) → volume 1,
  area 6, exactly 8 hull vertices.
- **delaunay** — Bowyer–Watson triangulation.
- **point-in-polygon** — ray casting, with **boundary** as
  its own verdict beside inside/outside.
- **closest-pair** — exact scan under its declared cap.
- **segment-intersection** — proper crossing, endpoint
  touching, and collinear overlap classified distinctly.
- **boolean** — not this tier: refused by name as the OCC
  engine tier's scope; point-in-solid via OCC likewise.

## The verification discipline

A hull is served only after **every input point is checked
inside or on every facet**; a triangulation is served only
after **every triangle's circumcircle is checked empty** of
the other points — the defining properties, verified rather
than trusted from the constructions. A violated gate is a
solver FAIL with the violation measured, never a quietly
served answer. Orientation predicates run at 1e-12, the
verification gates at 1e-9.

## Envelope

2D sets to 20,000 points; 3D hull and Delaunay to 2,000;
closest pair to 5,000 — Qhull-scale work is the engine
tier, named in the refusals.

## Replay

Walker: `conkay_solve` math.geometry-comp with the cube
vertices plus center, target `convex-hull-3d` → PASS with
volume 1, surfaceArea 6, containmentVerified true; the
square-plus-center set, target `delaunay` → 4 triangles,
emptyCircleVerified true. Reachability via solve.direct
rides SC-00 (named foundation); the MCP/chain paths reach
the registry entry as registered.
