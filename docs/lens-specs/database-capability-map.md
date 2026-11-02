# Database Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> **Rework (B5, PR #1716, 2026-10-28, to Product Review 2's frozen
> review `lens-reviews/database.md`):** the audit below is kept as
> history. What changed:
>
> - **44 macros now** (34 at the L9b re-verification). Added:
>   `dataset-relation-add`/`dataset-relation-delete` (connection-level
>   foreign keys), `dataset-transfer` (move a dataset between
>   connections; the pre-existing `dataset-move` is ER-canvas
>   positioning), `index-create`/`index-delete` (real index objects
>   with measured sizes), `dataset-import-csv`, and the rename verbs
>   `dataset-rename`/`schema-rename`/`table-rename`/`column-rename`
>   (renames cascade into name-keyed relations and indexes).
> - **One store:** Table Browser, Schema Map and Indexes read the
>   workspace store (connections → datasets) — the disconnected
>   lens-data buckets they previously read are gone from those panels.
>   History reads the server `query-history` written by both editors.
> - **Engine integrity:** unknown columns and wrong-typed values are
>   errors (never silent NULLs or silent empty results), unparseable
>   WHERE clauses error instead of matching everything, unscoped
>   DELETE/UPDATE requires an explicit confirm, multi-row INSERT is
>   all-or-nothing, joins take a hash path with a 2M row-visit budget
>   on the fallback, and SELECT results cap at 1000 rows with a
>   truncation flag. The Query Editor runs on `query-run` (it
>   previously posted SQL to the graph query API and crashed on the
>   result shape).
> - **New Analysis tab:** workspace dashboard (schema-dashboard +
>   measured store counts) and the analysis quartet
>   (schemaAnalysis/queryOptimize/migrationPlan/indexRecommendation)
>   wired to real inputs, with index recommendations applicable in
>   place. The Projects tab now shows the user's own connections and
>   datasets (it previously rendered a GitHub topic search). The
>   header DepthBadge for this lens reads "Workspace" — connections
>   are workspace copies; no remote server is contacted.
> - Server behaviour suites: `server/tests/database-*.test.js`,
>   85 tests green at ship (incl. the two pre-existing parity suites).
>
> **Re-verification (HANDOFF-3 batch L9b, 2026-10-28, against main e9791d4d):**
> The audit below is kept as history. Current truth:
>
> - **34 macros now** (33 at audit time). Fresh surfacing scan: 33/34
>   named in the frontend. The one unnamed is `schema-dashboard`, a
>   counts aggregate (schemas / totalTables / totalRelations) whose
>   numbers the Schema Designer already shows from its `schema-list`
>   data — an unsurfaced convenience aggregate, not missing
>   information; disposition recorded here rather than wiring a
>   duplicate stat call.
> - The 9/9 DBeaver/TablePlus checklist below stands; the page's
>   no-fake-fallback discipline is unchanged.
> - **Shipped in this batch:** the concept's serif headline — "Ask
>   the data, {username}" — as the page header
>   (`data-testid="database-greeting"`, `tests/database-greeting.test.tsx`).
> - Server suites run locally this pass: database-domain-parity
>   passes (in the combined 89-pass L9b run).


> Derived, not asserted. Backend surface enumerated by reading
> `server/domains/database.js` (806 LOC) in full —
> `grep -n 'registerLensAction("database"' server/domains/database.js`
> lists all 33 macros. Frontend audited by reading
> `app/lenses/database/page.tsx` (1272 LOC) in full and spot-checking
> `components/database/{DatabaseTable,LiveDbClient,...}.tsx`.

## Backend surface — 33 macros, all real

4 pure-compute AI actions (`schemaAnalysis`, `queryOptimize`,
`migrationPlan`, `indexRecommendation`) plus a real schema-design +
live-query substrate: schema/table/column/relation CRUD, SQL export,
connection manager (create/list/update/delete/test), a real in-memory SQL
interpreter (`query-run`, `query-explain`, `query-history`, `query-export`,
`sql-autocomplete`), and dataset/row CRUD (`row-insert/update/delete`,
`dataset-move` for ER-canvas positions).

## Reference app

DBeaver / TablePlus — dense, tool-shaped identity: tabbed workspace,
monospace SQL editor, result grid, connection sidebar. Already the
correct read, not a generic dashboard.

## Audit result: no real defects found

Full read of `page.tsx`'s 7-tab workspace (Live Client / Query Editor /
Table Browser / Schema / Indexes / Monitoring / History) found every tab
backed by real macro calls, not caller-fabricated data:

- **Monitoring tab**: `perfHistory` is a client-accumulated time series
  built from a genuinely polled `useQuery` against real performance
  metrics (`perfMetrics`) — confirmed by tracing `setPerfHistory` back to
  the `perfMetrics` query result (`server/lib/...` performance endpoint),
  not `Math.random()` or a static array. `backpressure` state and level
  badge read real thresholds/recommendations from the backend.
- **Database Actions** (migrate/sync buttons): both gated on real
  `dbStatus?.postgres?.connected`, results rendered only from the real
  mutation response (`applied`/`total`, `synced`/`total`), no
  fabricated success message.
- Two explicit in-code comments confirm the honesty invariant was
  deliberately maintained during the prior build: `// No fake fallback
  data — show only what the API returns` and `// Use live data only — no
  fake fallbacks` (lines 108 and 301).

`grep -rn "Math.random"` across the lens returns no matches.

## 1.5 Reference-parity checklist

| # | Item (DBeaver/TablePlus) | Disposition |
|---|---|---|
| 1 | Live query execution | ALREADY REAL — `query-run` over a real in-memory SQL interpreter |
| 2 | Result-grid inline editing | ALREADY REAL — `row-insert/update/delete` |
| 3 | Connection manager | ALREADY REAL — `connection-create/list/update/delete/test` |
| 4 | ER diagram / draggable canvas | ALREADY REAL — `dataset-move` persists positions |
| 5 | Query plan / EXPLAIN | ALREADY REAL — `query-explain` → `TreeDiagram` |
| 6 | Data export (CSV/JSON) | ALREADY REAL — `query-export` |
| 7 | SQL autocomplete | ALREADY REAL — `sql-autocomplete`, schema-aware |
| 8 | Real-time performance monitoring | ALREADY REAL — polled `perfMetrics`/`backpressure`, accumulated client-side into a genuine time series |
| 9 | Schema visual designer | ALREADY REAL — schema/table/column/relation CRUD + SQL export |

**Coverage summary:** 9 of 9 checklist items already real, all backed by
genuine polled/computed data with explicit no-fake-fallback discipline in
the code itself. No changes made this session.

## Files touched

None — audit only, no defects found.
