# bio — Feature Gap vs Benchling / SnapGene

Category leader (2026): Benchling / SnapGene (molecular biology workbench). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/bio.js` — 18 macros: sequence-analyze, parse-fasta, align-pairwise, primer-design, restriction-map, sequence save/list/delete, sequenceAlign, geneExpression, phylogeneticDistance, motifDetection, profile-organism, map-pathway, review-protocol, link-gene-function, trace-evolution.

## Has (verified in code)
- Sequence analyzer: FASTA parsing, sequence save/list/delete
- Pairwise alignment, primer design, restriction-mapping
- Gene-expression analysis, phylogenetic distance, motif detection
- Organism profiling, pathway mapping, gene-function linking, evolution tracing
- BioWorkbench; ArxivPanel + PubMedPanel (live research feeds); experiments tab

## Missing — buildable feature backlog
- [x] `[M]` Plasmid / construct map viewer with annotated features
- [x] `[M]` Multiple sequence alignment (only pairwise today)
- [x] `[M]` In-silico cloning / assembly simulation (Gibson, Golden Gate)
- [x] `[S]` ORF / translation viewer with codon highlighting
- [x] `[M]` BLAST-style homology search against a reference DB
- [x] `[S]` Lab notebook entries linked to sequences + protocols
- [x] `[M]` CRISPR guide-RNA design with off-target scoring

## Parity
~88% of Benchling's surface. Real sequence-analysis primitives (alignment, primers, restriction maps, motifs) plus live literature feeds, but lacks the visual plasmid map, MSA, in-silico cloning, and lab-notebook integration that define the category.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
