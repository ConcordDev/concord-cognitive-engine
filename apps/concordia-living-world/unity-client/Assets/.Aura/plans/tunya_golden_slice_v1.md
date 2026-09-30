# Golden Slice Implementation Plan

## Scope
Implement the first runtime-reachable Tunya golden slice for `settlement/tunya/sandrun_sanguire`, using existing economy, WorldFabric, Fabrication, Gunsmithing, equipment, container, persistence, and ConKay authorities. Add only minimal bridge seams and new runtime glue under a `GoldenSlice` folder.

## Steps
1. Inspect the canonical bridge, economy/gathering, WorldFabric, fabrication/gunsmithing, containers, persistence, ConKay, authored settlement/runtime construction, and generated asset metadata.
2. Identify exact APIs and stable IDs needed for the slice, then create a minimal integration design without parallel authorities.
3. Add `GoldenSlice` runtime glue and minimal seam edits for ore source, forge/workbench binding, material consumption, fabrication/gunsmithing, equipment/container linkage, persistence, and ConKay provenance inspection.
4. Bind the generated ore vein and gunsmith workbench, and register the pack horse only if an existing vehicle/container authority can safely own it; otherwise register it as available-only provenance.
5. Refresh/compile, fix errors, validate runtime reachability and persistence/provenance paths, and report changed paths, asset bindings, and actual reachable stages.