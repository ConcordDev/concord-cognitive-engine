# custom — Feature Gap vs Retool / Glide

Category leader (2026): Retool / Glide (no-code internal-tool builder). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `custom` domain macros (evaluateSchema, templateRender, validateData, transformData); generic `/api/lens` store for custom lens definitions + templates; PublicGistGallery component.

## Has (verified in code)
- Custom lens builder — create/list custom lenses with JSON config (widgets, layout)
- Template library; active/inactive lens toggle; config-key count stats
- AI actions: evaluate schema, render template, validate data, transform data
- Filter custom lenses; PublicGistGallery (browse public GitHub gists as starting points)

## Missing — buildable feature backlog
- [ ] `[L]` Visual drag-drop widget canvas — place tables/charts/forms instead of raw JSON
- [ ] `[M]` Data-source binding UI — connect a lens to a macro/REST endpoint without code
- [ ] `[M]` Component palette — prebuilt widget types (table, chart, form, button) with props panels
- [ ] `[M]` Live preview while editing — render the lens as config changes
- [ ] `[S]` Publish a custom lens into the main lens navigation
- [ ] `[S]` Import/export lens definition as a shareable file
- [ ] `[M]` Event/action wiring — button click → macro call → refresh widget

## Parity
~30% of Retool's feature surface. Has the lens-definition store, templates, and schema/transform macros, but the core no-code value (visual canvas, component palette, data binding, live preview) is JSON-editing only.
