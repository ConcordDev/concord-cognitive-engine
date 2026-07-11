# Maker (App Builder) — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every claim below is grep-reproducible or backed by
> a full read of the file it's about. This lens's backend domain is
> registered under the string `"app-maker"` (`server/domains/appmaker.js`),
> not `"maker"` — a filename/domain-string mismatch of the same shape found
> in `home-improvement`/`homeimprovement.js` and `realestate`/`real_estate`
> earlier this wave. `scripts/lens-unsurfaced.mjs --lens maker` and
> `--lens app-maker` both report "no registered macros found" — a tooling
> false negative caused by the mismatch, not zero macros.

## Backend surface

```
grep -c 'registerLensAction("app-maker"' server/domains/appmaker.js
```
→ **51** macros — a full low-code app builder (pages/elements/data
tables/workflows/connectors/component library/marketplace/versioning),
Bubble/Retool/Glide-parity.

**Note on scope:** this pass fixed 3 confirmed dead/unsurfaced macros
found via direct read of `ProjectBuilder.tsx`/`VisualEditor.tsx` (the
lens's two primary components); it is not a claim that all 51 macros were
individually cross-referenced. The recurring generic-CRUD-scaffold defect
pattern (`useLensData`/`useRunArtifact` against a fake artifact type) was
NOT found in either component — both call `app-maker.*` macros directly
via `lensRun`.

## The defect: 3 real macros with zero frontend caller

Read in full: `concord-frontend/components/maker/ProjectBuilder.tsx`,
`concord-frontend/components/maker/VisualEditor.tsx`. `grep -n
"Math.random|MOCK|mock|fake|Lorem|lorem"` across both plus the new
`ConnectorManager.tsx` → empty.

1. **`connectorKinds`/`connectorSave`/`connectorList`/`connectorDelete`/
   `connectorTest`** — a full external-API-binding subsystem (REST/
   GraphQL/data-source connectors an app's elements can bind to) with zero
   UI anywhere. `ProjectBuilder.tsx` already had a `Connector` TypeScript
   interface declared (unused) — the concept was modeled but never
   surfaced. **Fixed:** new `ConnectorManager.tsx` (a real list/add/test/
   delete panel — kind picker sourced from the live `connectorKinds`
   catalog, not hardcoded) mounted as a new "Connectors" tab in
   `ProjectBuilder.tsx`, positioned between Workflows and Marketplace.
2. **`editorDeletePage`** — pages could be created (`addPage`) but never
   deleted; a builder with a growing, un-prunable page list. **Fixed:**
   added a delete (×) button per page tab in `VisualEditor.tsx`, guarded
   against deleting the last remaining page, falling back to the first
   remaining page if the active one is deleted.
3. **`librarySave`** — a canvas element could be data-bound and styled but
   never saved as a reusable component for the (already-real, already-
   wired) Marketplace/`ComponentMarket.tsx` to publish. **Fixed:** added a
   "Save to library" action on the selected-element inspector panel (name
   input + save button), calling `librarySave` with the element's type/
   props.

All 3 macros confirmed real via direct grep against
`server/domains/appmaker.js`:
`registerLensAction("app-maker", "editorDeletePage"|"librarySave", ...)`
at lines 590 and 1015; the 5 connector macros at lines 1084–1157.

## Verification

- `node --check server/domains/appmaker.js` — clean (file untouched).
- `server/tests/appmaker-lens-macros.test.js`,
  `server/tests/emergent-app-maker.test.js`,
  `server/tests/app-maker-domain-parity.test.js` — 86/86 pass, unmodified.
- `cd concord-frontend && npx eslint components/maker/ProjectBuilder.tsx
  components/maker/VisualEditor.tsx components/maker/ConnectorManager.tsx`
  — clean.
- `node scripts/verify-lens-backends.mjs` — maker WIRED, totals unchanged
  (`{"WIRED":258,"NO-BACKEND-CALL":2}` total 260).
- `node scripts/grade-ux-polish.mjs --honest` — maker `tier:"polished"`,
  `isGenericScaffold:false`. `audit/` reverted via `git checkout -- audit/`.

## Left alone, with reason

- `DataModelDesigner.tsx`, `WorkflowBuilder.tsx`, `VersionHistory.tsx`,
  `PreviewPane.tsx`, `ComponentMarket.tsx` — not read in full this pass;
  no defect flagged against them, but they were not independently
  re-audited either. If a future pass finds a gap here, it isn't
  contradicted by this doc — it simply wasn't in scope for the 3 defects
  found and fixed above.
- The remaining ~46 `app-maker` macros beyond the 3 fixed and the ones
  visibly called elsewhere in `ProjectBuilder.tsx`/`VisualEditor.tsx` —
  not individually traced this pass. A full macro-by-macro classification
  (DESIGNED/GENERIC-STRIP-ONLY/UNSURFACED) table, matching the format used
  for smaller domains this wave, is a reasonable follow-up if this lens is
  revisited.
