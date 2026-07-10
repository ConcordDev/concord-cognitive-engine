# Custom lens — capability map (Wave 2 batch 7, Docs/B2B SaaS archetype)

## What "custom" means here (checked against the domain file, not assumed)

`server/domains/custom.js`'s own header describes it precisely: **"Custom
Lens Builder backend... a per-user no-code lens builder substrate: a widget
canvas, component palette, data-source bindings, live-preview renderer,
publish-to-nav registry, import/export, and event/action wiring."** This is a
Retool/Airtable-class no-code app builder, not a generic "custom fields"
concept.

## Backend macro surface

`server/domains/custom.js` — 23 macros:

| Macro | Status before | Status after |
|---|---|---|
| `palette`, `canvasList/Get/Create/Save/Delete`, `bindingList/Create/Delete/Test`, `previewRender`, `publish`/`unpublish`/`publishedList`, `exportCanvas`/`importCanvas`, `wiringList/Create/Delete` (20 macros) | ALREADY REAL — `CanvasBuilder` exercises every one of these | unchanged |
| `evaluateSchema` | designed but fed from a disconnected placeholder artifact (a generic `"lens-config"` CRUD item whose `data` was raw JSON the user pasted for an unrelated purpose) | DESIGNED — new `DataUtilities` component, Schema Designer tab |
| `templateRender` | same disconnected-artifact defect | DESIGNED — Template Renderer tab |
| `validateData` | same disconnected-artifact defect | DESIGNED — Validation Rules tab |
| `transformData` | same disconnected-artifact defect | DESIGNED — Data Transform tab |

## Reference-parity target

**Retool** / **Airtable** — "the only difference should be scale, nothing
else." Retool's core loop: drag components onto a canvas, bind them to a
data source (a query or API), wire button clicks to actions, preview live,
publish. Airtable's adjacent angle: schema design (field types, required
fields) and data validation as first-class citizens, not an afterthought.

### Checklist

| Capability | Disposition |
|---|---|
| Drag components from a palette onto a canvas | ALREADY REAL — `CanvasBuilder` |
| Bind a widget to a macro or REST endpoint | ALREADY REAL — `CanvasBuilder` Data Sources panel, with a live REST-reachability test (`bindingTest` actually fetches the URL) |
| Live preview before publishing | ALREADY REAL — `CanvasBuilder` Preview |
| Publish into the app's navigation | ALREADY REAL — `CanvasBuilder` Publish/Unpublish, reflected in a real "In Navigation" list |
| Wire a button click to an action (with an optional widget refresh) | ALREADY REAL — `CanvasBuilder` Event Wirings |
| Import/export a shareable app definition | ALREADY REAL — `CanvasBuilder` Import/Export (versioned `concord-custom-lens/v1` envelope, re-keys imported bindings so they never collide) |
| Schema design (field name/type/required) | GENUINELY MISSING as a real UI before this pass (macro real, no real caller); DESIGNED after this pass — `DataUtilities` Schema Designer |
| Mail-merge-style template rendering | Same — DESIGNED after this pass, Template Renderer tab |
| Validation rule authoring + testing | Same — DESIGNED after this pass, Validation Rules tab |
| Field transform pipeline (uppercase/trim/round/rename/default) | Same — DESIGNED after this pass, Data Transform tab |
| A separate "saved custom lenses" CRUD library with named configs | GENUINELY MISSING as a real backend concept — the pre-existing "Custom Lenses List" + "Lens Templates" gallery were built entirely on a generic per-user artifact CRUD store (`lens-config`/`lens-template` types) with **no connection to any of the 23 real macros**, including a raw JSON-paste textarea standing in for what should have been a real canvas. Honest disposition: **removed, not relabeled** — the real equivalent of "my saved custom apps" is the canvas list `CanvasBuilder` already manages (create/save/delete/publish), so nothing of substance was lost; the duplicate, disconnected, JSON-driven version was pure scaffold. |

## What was fixed

1. Removed the disconnected "Custom Lenses List" panel, its "Create Custom
   Lens" modal (a raw JSON-configuration textarea — exactly the "JSON-paste
   standing in for a real form" anti-pattern), the "Lens Templates" gallery,
   and the "Config Keys" stat — all built on a generic per-user CRUD artifact
   type with zero connection to the real 23-macro no-code builder substrate
   already present one panel below it.
2. The four pure-compute macros (`evaluateSchema`, `templateRender`,
   `validateData`, `transformData`) were real but reachable only through that
   same disconnected artifact system — every click ran against whatever
   generic JSON a user had pasted for an unrelated purpose, so the "Custom
   Actions" button row almost always produced a degenerate "define custom
   fields to evaluate" / "provide a template" message. Built
   `components/custom/DataUtilities.tsx`: four real, hand-built forms
   (add/remove field rows, key/value pairs, rule rows, transform steps) that
   call the macros directly via `lensRun`, matching the exact pattern used
   for the analogous fix in this wave's `anon` lens.
3. Wired real header stat tiles (Canvases / Published / Data Sources / Widget
   Types) sourced from `CanvasBuilder`'s own live state via a new
   `onStatsChange` callback prop, replacing the fabricated stat row that
   counted the disconnected artifact system instead.
4. Removed the generic auto-discovered action bar and the generic capability
   list that were still mounted on the page (redundant given the bespoke
   canvas builder + data utilities + community gallery already present).
5. Left `CanvasBuilder` and `PublicGistGallery` unchanged — both were already
   real, comprehensive, and on-topic (a live GitHub public-gists feed as
   inspiration for a no-code builder is a defensible real feature, same
   pattern as Retool's community template gallery).

## Verify gate

- `npx eslint` on the touched files: clean.
- `npx tsc --noEmit -p .`: 0 errors project-wide.
- No lens-specific vitest file exists for `custom` — noted, not invented.
- `node scripts/verify-lens-backends.mjs`: `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260 — unchanged; `custom` stays WIRED.
- `node scripts/grade-ux-polish.mjs --honest`: `custom` → `tier: "polished"`,
  `isGenericScaffold: false`.
