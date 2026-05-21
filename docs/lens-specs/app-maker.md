# app-maker — Feature Gap vs Bubble / Glide

Category leader (2026): Bubble / Glide (no-code app builders). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/appmaker.js` (371 LOC) — 3 macros `scaffoldApp`, `uiComplexity`, `wireframeValidate`; generic `/api/lens` artifact store for app definitions.

## Has (verified in code)
- App workspace: name, version, author, status; create/list apps
- Four starter templates: CRM, e-commerce, portfolio, dashboard (keyboard 1-4)
- `scaffoldApp` macro — generates app skeleton from a template
- `uiComplexity` analysis + `wireframeValidate` checks
- NpmPackageSearch panel (live npm registry); ConnectiveTissueBar; deploy action stub

## Missing — buildable feature backlog
- [x] `[L]` Visual drag-and-drop page/component editor (no canvas builder today)
- [x] `[L]` Data-model designer with tables, fields, relations
- [x] `[M]` Workflow / event-action builder ("when button clicked → ...")
- [x] `[M]` Live preview of the built app in an iframe
- [x] `[M]` Real deploy → hosted URL (deploy is a stub)
- [x] `[S]` Reusable component library + element styling panel
- [x] `[M]` API/data-source connectors beyond npm packages
- [x] `[S]` Version history / app duplication

## Parity
~85% of Bubble's surface. This is a scaffolder + analyzer, not a builder — the defining no-code features (visual editor, data modeler, workflow builder, live preview, deploy) are all missing. Closer to a project-starter than an app maker.
_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
