# app-maker — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("app-maker"' server/domains/appmaker.js` → 55
>
> Note: `node scripts/lens-unsurfaced.mjs --lens app-maker` reports "No
> registered macros found" — the script's lens→domain-file lookup doesn't
> know the hyphenated `app-maker` domain lives in `server/domains/appmaker.js`
> (no hyphen). This is a tooling naming-convention gap, not evidence the
> domain is unwired; `verify-lens-backends.mjs` (which walks the real
> `registerLensAction`/`register` call sites, not a filename guess) reports
> `app-maker` WIRED, and the manual grep-and-read audit below is the ground
> truth for this lens.

## Reference app + parity target

**Bubble / Glide / Retool (2026 shape)** — the real best-in-class no-code
app builder: visual canvas, data-model designer, workflow automations,
live preview, one-click deploy, versioning, a component library, external
connectors, and (the two things most no-code tools under-invest in) a
branching-narrative/quest authoring surface and a cross-user template
marketplace. `AppBuilderStudio.tsx` (1,064 LOC before this pass) already
wired 30 of the domain's 55 macros into 8 real tabs (Editor, Data Model,
Workflows, Connectors, Components, Preview, Deploy, History).

## Findings

### Data binding (`dataBindElement` / `dataUnbindElement` / `dataBindings`) — REAL GAP (fixed)

The whole point of a no-code builder's canvas is wiring UI elements to
data, and the backend fully supports it (bind a canvas element to a table
or a connector, with an optional query), but nothing in the frontend ever
called any of the three macros — the canvas inspector had props/size/style
controls but no way to make an element live. **Fix:** added a "Data
binding" section to the Editor tab's element inspector (`CanvasEditor` in
`AppBuilderStudio.tsx`) — pick a source kind (table/connector), pick the
specific one, optional query string, bind/unbind. Also added a project-wide
"Data bindings" summary list to the Data Model tab (`dataBindings`) so a
builder can see every live wire in one place.

### Quest/narrative authoring (`questGraphCreate/List/Get/Delete`, `questNodeSave/Delete`, `questEdgeAdd/Delete`, `questGraphValidate`) — REAL GAP (fixed)

12 macros implementing a genuine branching-narrative graph author (nodes:
start/step/choice/reward/ending; edges with condition labels; structural
lint for unreachable nodes, dead ends, missing endings) had zero frontend
surface at all. **Fix:** added a new "Quests" tab (`QuestGraphEditor`) —
graph list/create/delete, a lightweight click-to-connect node canvas
(reusing the same drag-and-SVG-edge pattern as the visual page canvas,
not a generic list), a node inspector (title/body/reward), and a
"Validate" button rendering the real issue list with severity icons.

### Component marketplace (`marketPublish/Browse/Install/Unpublish`) — REAL GAP (fixed)

The Component Library tab already let a builder save reusable styled
components to their own project, but the cross-user marketplace layer
(publish a component, browse others' published components by
category/search, install one, unpublish your own) was entirely unwired.
**Fix:** extended `ComponentLibraryPanel` with a "Publish" action per saved
component and a "Community marketplace" browse/search/install section
underneath — the natural, non-generic home for this capability, since it's
a marketplace *of* library components, not a separate concept.

### `connectorList` — DISPOSITION: effectively covered

`ConnectorPanel` never calls `connectorList` directly, but the connectors
array ships inline on the project object returned by `projectGet` /
`projectCreate`, which the panel already reads. A standalone list-only
call would only matter for a connectors-only view that doesn't exist; not
a real gap.

## Verify gate

- `npx eslint components/app-maker/AppBuilderStudio.tsx` — 0 errors/warnings.
- `npx tsc --noEmit -p .` — 0 errors attributable to this file.
- `node scripts/verify-lens-backends.mjs` — `app-maker` reports WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `app-maker`: `tier: "polished"`, `isGenericScaffold: false`, `bespokeRatio: 0.704`.
