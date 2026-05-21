# philosophy — Feature Gap vs Are.na / IEP

Category leader (2026): Are.na (idea curation) + Internet Encyclopedia of Philosophy. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/philosophy.js` — 12 macros: argumentMap, thoughtExperiment, dialecticSynthesis, ethicalFramework (reasoning tools) + channel CRUD, channel-detail, typed block-add, block-connect/disconnect, block-delete, search, dashboard.

## Has (verified in code)
- Argument map: premises → conclusion validity/soundness analysis
- Thought experiment permutation generator; Hegelian dialectic synthesis
- Ethical framework comparison across moral theories
- Are.na-shape curation: channels with typed blocks (text/link/quote), multi-channel block membership (connect/disconnect)
- Cross-channel search, dashboard (channels/blocks/cross-connected counts/by-kind)
- 6 tabs (Arguments/Concepts/Thinkers/Traditions/Dialogues/Dashboard); Wikipedia search, DilemmaPanel, PhiloFeed

## Missing — buildable feature backlog
- [ ] `[M]` Visual block grid with images — Are.na's signature image-block masonry, not just text blocks
- [ ] `[M]` Public channel browse + discovery — explore other users' channels, not only your own
- [ ] `[S]` Channel collaborators — multiple authors curating one channel
- [ ] `[M]` Block embeds — rich link previews, embedded media/PDF in blocks
- [ ] `[S]` Concept/thinker reference pages — structured entries (the IEP-style encyclopedia side)
- [ ] `[S]` Connections graph — visualize how blocks/channels interlink
- [ ] `[S]` Argument debate threads — collaborative premise critique

## Parity
~50% of Are.na+IEP's feature surface. The reasoning tools (argument map, dialectic, ethics) are a genuine differentiator and the channel/block curation model is real, but it lacks the visual image-grid, public discovery, and collaboration that make Are.na a platform.
