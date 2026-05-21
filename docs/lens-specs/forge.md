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
- [ ] `[M]` Conversational iterative refinement — "make the header blue" follow-up prompts
- [ ] `[L]` Live preview sandbox — render the generated app in an iframe with hot-reload
- [ ] `[M]` Multi-file project output (currently single-file only)
- [ ] `[S]` Version history / diff between generations
- [ ] `[M]` Direct deploy (Vercel/Netlify) or shareable hosted link
- [ ] `[S]` Component-level regeneration without re-running the whole app
- [ ] `[M]` Image/screenshot → app input

## Parity
~50% of v0.dev's feature surface. The template + 13-subsystem generator + validate/repair loop is real and unusual, but it lacks conversational iteration, a live preview sandbox, and multi-file output — the interaction model that defines modern AI app builders.
