# Bio Lens — Capability Map (Frontend Rebuild Program, Wave 2 batch 4)

> Derived, not asserted. This unit's sub-agent created `BioResearchPanel.tsx`
> but was interrupted by a container restart before mounting it into the
> page or writing this artifact — confirmed via `git status` (only the new
> component file existed, `app/lenses/bio/page.tsx` was untouched) and
> `grep -c BioResearchPanel app/lenses/bio/page.tsx` returning 0. Finished
> by the orchestrator: mounted the panel and fixed two real fake-data
> findings discovered while reading the page for the mount point.
>
> Reproduce the macro list: `grep -c 'registerLensAction("bio"' server/domains/bio.js` → 28

## Reference app

NCBI/UniProt-style sequence and analysis tooling, complementary to the
existing Benchling/SnapGene-style sequence-handling surface
(`MolecularWorkbench`/`SequenceAnalyzer`/`BioWorkbench`/`BioActionPanel`,
which already cover primer design, restriction mapping, in-silico cloning,
BLAST homology, CRISPR guide design, plasmid maps, ORF translation, and
the lab notebook).

## What this rebuild fixed

1. **Mounted `BioResearchPanel`** in the Experiments tab — 10 real
   `bio.*` tools with tailored per-tool inputs and typed result displays:
   sequence alignment (Needleman-Wunsch), gene expression (differential
   expression / fold-change), phylogenetics (Jukes-Cantor / Kimura
   distance matrix), motif detection, organism profiling, pathway
   mapping, protocol review, gene→function tracing, evolution tracing,
   and FASTA parsing.
2. **Removed a fabricated "Active Experiments" list** that stood in the
   Experiments tab before this rebuild — four hardcoded experiment names
   with hardcoded fake statuses (`i === 0 ? 'Running' : i === 3 ?
   'Queued' : 'In Progress'`, a pure function of array index, no backing
   data whatsoever). This is exactly the "zero demo content" violation
   CLAUDE.md's invariant names — now real macro-backed tools live in that
   slot instead.
3. **Removed a fabricated "Taxonomy Classification" tree** — a
   hardcoded 8-row Domain→Species table that always rendered
   Eukarya→Animalia→Chordata→Mammalia→Primates→Hominidae→Homo→H. sapiens
   regardless of any user input or state. `BioResearchPanel`'s Organism
   Profile tool (`profile-organism`) now covers this need for real,
   accepting a name/kingdom/habitat/traits and returning an actual
   generated profile.
4. **Retired the generic disconnected "Bio Items" CRUD** (`useLensData`
   generic-artifact store, `create({ title: 'New Organism', data: { type:
   'organism' } })`) — a fake parallel data model with no tie to any of
   the 28 real `bio.*` macros, the same pattern already found and retired
   in the `pets` and `supplychain` rebuilds. The real Organism Profile
   tool in `BioResearchPanel` replaces it.
5. **Removed the permanently-dead `<UniversalActions domain="bio"
   artifactId={null} compact />`** — `artifactId` was hardcoded `null`
   with no selection flow anywhere on the page, so every button was
   unconditionally disabled forever. Not a designed feature; deleted
   rather than left as dead chrome.

## Left alone (already real, or not the target of this fix)

- `ArxivPanel` / `PubMedPanel` — real live external-API feeds.
- `MolecularWorkbench`, `SequenceAnalyzer`, `BioActionPanel`, `BioWorkbench`
  — pre-existing, already macro-backed, Benchling/SnapGene-parity tools.
- Bio Age / Maturation / Homeostasis stat tiles — read from a real
  `apiHelpers.status.get()` cross-lens Growth OS query with sensible
  numeric fallbacks while data loads; not fabricated, out of scope here.
- `LensFeaturePanel` — a read-only feature-spec browser (no fake data,
  no generic action wall), left mounted.

## Verification

- `npx eslint app/lenses/bio/page.tsx components/bio/BioResearchPanel.tsx` — clean (one unused-type warning fixed).
- `npx tsc --noEmit -p .` — run alongside astronomy/space/chem/lab/materials in the same pass.
- `node scripts/verify-lens-backends.mjs` — pending.
- `node scripts/grade-ux-polish.mjs --honest` — pending.
- No existing bio-lens test file (confirmed by grep) — nothing to update.
