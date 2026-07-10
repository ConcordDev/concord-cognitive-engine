# Database Lens — Capability Map (Frontend Rebuild Program, Wave 3)

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
