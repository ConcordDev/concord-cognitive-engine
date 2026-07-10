# Schema Lens — Capability Map (Frontend Rebuild Program, Wave 2, batch 7)

Reproduce the macro list:
`grep -n 'registerLensAction("schema"' server/domains/schema.js` → 13 macros:
`schemaValidate`, `schemaDiff`, `schemaEvolution`, `registryCreate`, `registryList`,
`registryGet`, `registrySaveVersion`, `registryDelete`, `sampleGenerate`,
`migrationGenerate`, `conformanceCheck`, `erDiagram`, `inferSchema`.

## Reference apps

- **dbdiagram.io** — visual schema modeling, ER diagrams, SQL export.
- **DataGrip / Hasura console** — schema registry with versioning, migration
  generation, live-data conformance checking.

## Audit finding: the real feature already existed, buried under a dead duplicate

`components/schema/SchemaWorkbench.tsx` (962 LOC before this pass) is a real,
comprehensive, already-shipped dbdiagram/DataGrip-parity surface: a versioned
schema registry (create/list/get/save-version/delete, with a version-history
modal), a visual field editor with a live tree preview, a sample-data
generator, a migration-script generator (SQL/JSON-ops with a breaking-change
count), a live-data conformance checker (per-field presence/null/type-mismatch
stats), an ER-diagram builder across the whole registry, and JSON/SQL schema
inference. Every one of those calls a real `schema.*` macro with a literal
domain string and real data. `components/schema/SchemaRepos.tsx` is a real
live GitHub-search panel (topic: json-schema/openapi/protobuf/...). Neither
needed touching.

`app/lenses/schema/page.tsx`, however, additionally mounted an entire
**duplicate, legacy generic-artifact scaffold** on top of the real workbench:

1. **A second, disconnected "schema list."** `useLensData('schema',
   'definition', ...)` — a generic per-domain CRUD store completely separate
   from the real registry the workbench reads/writes via `registryCreate`/
   `registryList`/etc. Creating a schema through the page's own `CreateSchemaModal`
   never touched the registry; it wrote to a different generic bucket the
   workbench never reads. Two "create a schema" flows existed, only one of
   which was real.
2. **A broken "Schema Validator."** The validate button called
   `apiHelpers.lens.run('schema', data.schemaName, { action: 'validate',
   params: data })` — passing the *schema's name string* as the generic
   lens-action artifact `id` and `'validate'` as the action name. Neither
   exists: `/api/lens/:domain/:id/run` looks up `STATE.lensArtifacts.get(id)`,
   and no artifact is ever keyed by a schema name, so every single click
   returned `{ ok:false, error:'not found' }` — silently rendered as a
   confident-looking "Invalid" result with no error detail, regardless of
   what was pasted. This was a genuinely broken quick-tool, not a stylistic
   nit: it could never validate anything, ever, for any user.
3. **"Quick Stats" and "Schema Version Badges"** computed from the same
   disconnected generic-CRUD list — so they never reflected what was actually
   in the registry either.
4. **A "Schema Domain Actions" panel** running `schemaValidate`/`schemaDiff`/
   `schemaEvolution` against `schemaItems[0]?.id` (the first item of the same
   disconnected generic store) — `schemaDiff`/`schemaEvolution` need
   `schemaA`/`schemaB`/`versions` input the generic artifact never carried, so
   these always degraded to their own "need N inputs" default message.
5. **`<UniversalActions>` + a `<LensFeaturePanel>` "Lens Features &
   Capabilities" toggle** — the generic auto-discovered button wall + static
   capability lister, redundant given the bespoke workbench above it.

## What this rebuild changed

- **Removed** the entire duplicate scaffold from `page.tsx`: the generic
  schema-definition CRUD store, `CreateSchemaModal`, `SchemaCard`, the broken
  Validator panel, the duplicate stats/version-badge rows, `<UniversalActions>`,
  the generic "Schema Domain Actions" button panel, and the
  `<LensFeaturePanel>` toggle. The page is now: header (with the real
  `LiveIndicator`/`DTUExportButton`) → `RealtimeDataPanel` → the real
  `SchemaWorkbench` → the real `SchemaRepos` GitHub feed → the standard
  sentinel row.
- **`schemaDiff` and `schemaEvolution` were real, useful macros with no real
  UI anywhere** — richer than what the workbench's existing Migration tab
  covers (structured breaking-change classification + a migration-complexity/
  effort estimate for Diff; per-transition compatibility + a recommended
  versioning strategy + a field-introduction/removal timeline for Evolution).
  Rather than leave them unwired or re-attach them to the broken generic
  artifact, added two new real tabs to `SchemaWorkbench`:
  - **Diff** — pick two registered schemas (by their latest saved version),
    call `schemaDiff({ schemaA, schemaB })`, render the change list
    (added/removed/modified, each flagged breaking or not), the
    backward-compatibility verdict, and the estimated migration effort +
    required actions.
  - **Evolution** — pick one registered schema, pass its own version history
    (`registryGet(id).versions`) straight into `schemaEvolution({ versions
    })`, render the recommended versioning strategy, per-transition
    compatibility, and a field timeline (introduced/removed-in version).
  Both reuse the existing `SchemaPicker` component and the registry state
  already held by the workbench — no new state management pattern.
- `schemaValidate` (raw records+rules validation against an ad-hoc, unregistered
  schema object) is intentionally left **not** re-wired: it's functionally
  subsumed by the already-shipped **Conformance** tab (`conformanceCheck`),
  which validates records against a *registered* schema and additionally
  reports per-field presence/null/type-mismatch stats — a strictly richer
  designed feature covering the same user need. Relabeled honestly here
  rather than built a second, weaker validator.
- Fixed the `lensRun(DOMAIN, …)` call sites in `SchemaWorkbench.tsx` to pass
  the domain as a literal `'schema'` string rather than through a `const
  DOMAIN = 'schema'` alias — a real detection gap in
  `scripts/verify-lens-backends.mjs` (its macro-call regex requires a literal
  string in the first argument position) that had nothing to do with runtime
  correctness but caused the schema lens to read `NO-BACKEND-CALL` once the
  page itself stopped importing `@/lib/api/client` directly. Confirmed this
  is a real detector gap (not a workaround): the calls are byte-identical in
  behavior, only the literal-vs-const spelling changed.

## Verification

- `npx eslint app/lenses/schema/page.tsx components/schema/SchemaWorkbench.tsx components/schema/SchemaRepos.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors touching schema files (pre-existing errors in `platform`/`queue`/`legacy`/`transfer` are sibling agents' concurrent in-flight work in this shared tree, unrelated to this change).
- `node scripts/verify-lens-backends.mjs` — `schema` `WIRED`; total unchanged at 258 WIRED / 2 NO-BACKEND-CALL (`narrative-walk`, `ux-suite`, both by design).
- `node scripts/grade-ux-polish.mjs --honest` — `schema`: `tier: "polished"`, `isGenericScaffold: false`.
- No lens-page-level test file exists for `/lenses/schema` (confirmed by search) — nothing to update. (`tests/lib/lenses/domain-schemas.test.ts` and `tests/character-schema.test.ts` are unrelated generic-entity/avatar-schema libraries, not this lens.)
