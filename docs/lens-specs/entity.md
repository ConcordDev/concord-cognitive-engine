# entity — Feature Gap vs Palantir Foundry / knowledge-graph tools

Category leader (2026): no consumer rival — closest analog is an entity-resolution / knowledge-graph workbench (Palantir Foundry, Senzing). Content fills via free public APIs (Wikidata) + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `entity` domain macros (entityResolution, relationshipGraph, attributeValidation); generic `/api/lens` artifact store; WikidataSearch + QualiaSensoryFeed/QualiaBodyMap components.

## Has (verified in code)
- Entity artifact management with attributes
- AI actions: entity resolution (dedup/match), relationship graph, attribute validation
- Wikidata search (live public API) for entity enrichment
- Qualia sensory feed + body map components; realtime data panel

## Missing — buildable feature backlog
- [ ] `[M]` Interactive relationship graph canvas — node-link map you can explore and edit
- [ ] `[M]` Entity merge/split UI — resolve duplicates with a side-by-side reconciliation view
- [ ] `[S]` Entity type schema — define entity classes with typed attributes
- [ ] `[M]` Linked-data import — pull Wikidata entities into the graph as nodes
- [ ] `[S]` Provenance per attribute — track which source asserted each value
- [ ] `[S]` Graph query / path-finding between two entities
- [ ] `[S]` Bulk entity import from CSV/JSON

## Parity
~40% of an entity-resolution workbench. Has entity artifacts, resolution/graph/validation compute, and Wikidata enrichment, but missing the interactive graph canvas, merge/split reconciliation UI, and typed schema that define the category.
