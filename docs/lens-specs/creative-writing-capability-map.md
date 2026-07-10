# Creative Writing Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command.

## Backend surface

```
grep -c 'registerLensAction("creative-writing"' server/domains/creativewriting.js
```
→ **56** macros. The domain file is `server/domains/creativewriting.js` (no
hyphen — `DOMAIN_TO_LENS_ALIAS` in `scripts/lens-rebuild-backlog.mjs` should
map `creativewriting` → `creative-writing`, same pattern as the other
mismatched-name aliases already in that table). They split into clear
families: `project-*` (list/create/get/update/delete), `chapter-*`
(create/update/reorder), `scene-*` (create/update/move/reorder/
thread-tag/delete), `character-*` (create/update/delete, relationships),
`thread-*` (list/create — plot-thread tracking), `snapshot-*`
(create/restore/delete — versioned scene history), plus dashboard/stats
macros.

## The defect this rebuild fixed

`app/lenses/creative-writing/page.tsx` carried **two independent, unrelated
manuscript systems on one page**:

1. **`CreativeWritingSection`** (mounted via `<CreativeWritingSection />`) —
   the real Scrivener/Dabble/Plottr-shape studio: binder (chapters/scenes
   with reorder, POV, plot-thread tagging, snapshots), character sheets with
   relationships, corkboard, research notes, targets/progress, compile,
   snapshot-diff. Every action in this tree calls a real `creative-writing.*`
   macro — confirmed by reading `CwBinderPanel.tsx`/`CwCharactersPanel.tsx`/
   `CwThreadsPanel.tsx`/etc.
2. **A second, parallel "My Works" CRUD system** that used to live directly
   in `page.tsx` (works/editor/prompts/workshop tabs) — backed entirely by
   `useLensData('creative-writing', 'work', ...)` and `useRunArtifact`
   against a **client-invented `work`/`prompt` artifact type that has no
   corresponding macro**. None of its create/edit/delete/AI-action buttons
   ever called any of the 56 real macros above — it was a disconnected
   shadow editor sitting next to the real one, satisfying "does *a* button
   do something" while never touching the actual manuscript substrate.

This is the same failure class CLAUDE.md's "zero generic tendencies"
invariant names: real depth existed, but a chunk of the page reached a
generic, unconnected store instead. Removed the ~800-line dead system;
kept the real studio; kept the reference tools (`DatamusePanel`,
`GutendexSearch` — real Datamuse/Project-Gutenberg API calls, unrelated to
the removed CRUD).

## What else this pass added (closing previously-unsurfaced macros)

- **Manuscript settings** (`CreativeWritingSection.tsx`) — `project-update`
  had no UI caller; title/genre/word-target were create-only. Added an
  inline settings editor (gear icon next to the stats row).
- **Chapter rename** (`CwBinderPanel.tsx`) — `chapter-update` had no caller;
  chapters could be created/reordered/deleted but never renamed. Added
  inline rename (click pencil, edit, Enter/blur to commit).
- **Scene → chapter move** (`CwBinderPanel.tsx`) — `scene-move` had no
  caller; a scene's chapter was fixed at creation. Added a per-scene
  "move to chapter" dropdown.
- **Plot-thread tagging** (`CwBinderPanel.tsx`) — `thread-list` and
  `scene-thread-tag` had no caller in the binder (only `CwThreadsPanel`
  managed thread definitions, never attaching them to scenes). Added a
  toggle-chip row in the scene detail panel.
- **Snapshot delete** (`CwBinderPanel.tsx`) — `snapshot-delete` had no
  caller; snapshots could be created and restored but never pruned. Added
  a delete button next to restore.
- **Character edit** (`CwCharactersPanel.tsx`) — `character-update` had no
  caller; characters were create/delete-only. Added inline edit
  (name/role/description/arc).

## Reference apps

Scrivener (binder + corkboard + snapshots), Dabble (distraction-free scene
editor + plot-thread tagging), Plottr (character relationship mapping),
NaNoWriMo tracker (word-count targets/progress) — `CreativeWritingSection`
and its `Cw*Panel` children already matched this shape before this pass;
this pass closed callers, not architecture.

## Known honest-grader false positive

`grade-ux-polish.mjs --honest` flags this lens `isGenericScaffold: true`
(`tier: "functional"`) because `app/lenses/creative-writing/page.tsx` is
thin (92 LOC) and no single `components/creative-writing/*.tsx` file
individually exceeds `FLAGSHIP_COMPONENT_LOC` (1000). The grader's
`maxBespokeComponentLoc` signal takes the single largest bespoke file, not
the sum — so a lens deliberately split into many well-organized files (13
files, ~2,400 LOC total: `CreativeWritingSection` 244 + `CwBinderPanel` 471
+ `CwCharactersPanel` 224 + `CwBiblePanel`/`CwCompilePanel`/
`CwCorkboardPanel`/`CwProgressPanel`/`CwResearchPanel`/
`CwSnapshotDiffPanel`/`CwStatsPanel`/`CwTargetsPanel`/`CwThreadsPanel`,
100–190 LOC each) reads as "generic" by this narrow structural check even
though the page genuinely orchestrates a real, deep, multi-panel studio.
This is the same documented blind spot as the `eco` lens's capability map
(2026-07) — better-organized multi-file architecture penalized relative to
one giant flagship file. Not a fabrication or an unsurfaced-macro gap; a
known limitation of a single structural heuristic. The generic-trio
components (`ManifestActionBar`/`RecentMineCard`/`AutoActionStrip`/
`UniversalActions`/`LensFeaturePanel`) are kept at the bottom of the page as
their designed secondary role, not as a stand-in for the real UI above them.

## Verify

- `cd concord-frontend && npx eslint app/lenses/creative-writing/page.tsx components/creative-writing/CreativeWritingSection.tsx components/creative-writing/CwBinderPanel.tsx components/creative-writing/CwCharactersPanel.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — `creative-writing` still WIRED.
- `node --test server/tests/creative-writing-domain-parity.test.js server/tests/creativewriting-domain-parity.test.js` — 39/39 pass.
