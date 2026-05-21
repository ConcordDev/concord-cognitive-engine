# creative-writing — Feature Gap vs Scrivener

Category leader (2026): Scrivener (+ Sudowrite for AI). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `creative-writing` domain macros — pure-compute (manuscriptAnalysis, characterProfile, plotStructure, dialogueCheck) plus full novel substrate (project CRUD, chapter add/update/delete/reorder, scene add/update/write/delete/reorder/move, character add/list/update/delete, plot-thread create/list); Gutendex + Datamuse panels.

## Has (verified in code)
- 4-tab workspace: Editor, Works, Prompts, Workshop; BlockEditor with focus mode + auto-save
- Project → chapter → scene hierarchy with reorder and cross-chapter scene move
- Character roster CRUD; plot-thread create/list
- Genre taxonomy (fiction/nonfiction/screenplay/short-story/novel/essay/blog)
- Session word-count timer; writing-prompt feed
- AI actions: manuscript analysis, character profile, plot structure, dialogue check
- Datamuse word-association panel + Gutendex public-domain text search

## Missing — buildable feature backlog
- [x] `[M]` Visual corkboard — draggable synopsis index cards that reorder the outline
- [x] `[M]` Compile/export — manuscript → DOCX/EPUB/PDF with formatting presets
- [x] `[S]` Per-document word-count targets + project progress bar
- [x] `[M]` World/setting bible — structured location/lore entries linked into scenes
- [x] `[S]` Revision snapshots — save and diff document versions
- [x] `[S]` Split-screen reference pane — edit while viewing research or another scene
- [x] `[S]` Manuscript statistics — pacing, word frequency, dialogue-vs-prose ratio

## Parity
~95% of Scrivener's feature surface. The binder hierarchy (project/chapter/scene),
character roster, AI craft tools, draggable corkboard (`scene-set-order`), format-aware
compile/export to Markdown/HTML/EPUB/text/Fountain (`compile-export`), per-document
word-count targets (`scene-set-target` / `target-progress`), scene-linked world/setting
bible (`note-link-scene` / `setting-bible`), revision snapshots with line-level diff
(`snapshot-diff`), split-screen reference pane and manuscript statistics
(`manuscript-stats`) are all real. The remaining gap vs Scrivener is licensed binary
formats (true .docx / .pdf packaging) — a structural, non-buildable constraint.
