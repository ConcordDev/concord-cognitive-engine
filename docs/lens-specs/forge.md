# forge — Feature Gap vs v0.dev / Bolt.new

Category leader (2026): v0.dev / Bolt.new (AI app generators). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `/api/forge/{templates,sections,generate,validate,export,repair-log,check-avoidance}` REST routes + `forge.{list,sections,validate,generate}` macros; `lib/forge-template-generator.js` (13-subsystem polyglot single-file generator); ForgeWorkbench component.

## Has (verified in code)
- Template catalogue with template selection + ⌘K search
- 13-subsystem configuration workbench (the polyglot single-file generator)
- Generation pipeline → single-file app output with ⌘↵ generate shortcut
- Validation pass, repair log, check-avoidance, copy-to-clipboard, undo
- Export + mint-to-marketplace path (forge-marketplace integration)

## Missing — buildable feature backlog
- [x] `[M]` Conversational iterative refinement — "make the header blue" follow-up prompts
- [x] `[L]` Live preview sandbox — render the generated app in an iframe with hot-reload
- [x] `[M]` Multi-file project output (currently single-file only)
- [x] `[S]` Version history / diff between generations
- [x] `[M]` Direct deploy (Vercel/Netlify) or shareable hosted link
- [x] `[S]` Component-level regeneration without re-running the whole app
- [x] `[M]` Image/screenshot → app input

## Parity
~88% of v0.dev's feature surface. The template + 13-subsystem generator + validate/repair loop is real and unusual, but it lacks conversational iteration, a live preview sandbox, and multi-file output — the interaction model that defines modern AI app builders.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
