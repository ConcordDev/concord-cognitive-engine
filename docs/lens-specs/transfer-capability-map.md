# Transfer — capability map (Wave 2 batch 7, Docs/B2B SaaS archetype)

## Parity target

Reference apps: **Fivetran/Airbyte** (connectors, pipelines, scheduled/
incremental sync, schema-drift detection) for the ETL surface, plus a real
data-migration toolkit (schema mapping, data-quality scoring, dependency-
ordered migration planning — the class of thing Flyway/AWS DMS/Talend do).
"The only difference should be connector catalog breadth, nothing else."

## Backend macro surface (`server/domains/transfer.js`, 16 macros)

### ETL macros (12 — Fivetran/Airbyte parity)
`connector-upsert/list/read/delete`, `pipeline-upsert/list/delete`,
`mapping-suggest`, `dry-run`, `run-sync`, `run-log`, `schedule-due`,
`schema-drift`. **ALREADY REAL, all 12 designed** —
`components/transfer/EtlWorkbench.tsx` (666 LOC) covers every one: connector
registration, a drag-connect pipeline/mapping editor, dry-run preview, full/
incremental change-data-capture sync, a run log, and schema-drift detection.
Confirmed by grep against every macro registration.

### Analysis macros (3 — the real gap)
| Macro | Shape | Disposition before | Disposition after |
|---|---|---|---|
| `schemaMapping` | Levenshtein + type-compatibility + hierarchical-path field matcher from `{sourceSchema[], targetSchema[]}` | **BACKEND-CAPABLE-BUT-UNSURFACED, fed from a MISMATCHED artifact type** — the old "Transfer Actions Panel" ran these off `useLensData('transfer','analogy')`, which holds `findAnalogies` results (`{source, target}` text pairs), not schema field lists. Even with an artifact present, the macro would receive no `sourceSchema`/`targetSchema` and return a guaranteed failure (`"Both sourceSchema and targetSchema are required."`). | wired: `TransferAnalysisPanel` "Schema Mapping" tab — real source/target field-list editors call the macro directly |
| `dataQuality` | completeness/accuracy/consistency/timeliness scoring from `{records[], schema[]}` | same mismatched-artifact dead end | wired: "Data Quality" tab — a CSV-sample parser turns pasted header+rows into real `records`/`schema` |
| `migrationPlan` | topological-sort + batch-sizing + rollback-checkpoint plan from `{entities[]}` | same mismatched-artifact dead end | wired: "Migration Plan" tab — a real entity+dependency list editor |

## What was genuinely wrong

Worse than a merely-disconnected store: the generic artifact bridge
(`useLensBridge('transfer', 'analogy')`) fed the three schema/quality/
migration macros from **analogy-search results**, an artifact shape with zero
overlap with what any of the three macros actually read. Every button press
either did nothing (no analogy run yet, so no artifact existed) or, once an
analogy existed, called the macro with an artifact whose `.data` had no
`sourceSchema`/`records`/`entities` — a guaranteed `ok:false` every time. This
is a stronger version of the disconnected-generic-CRUD-store pattern flagged
across the wave: it isn't just empty, it's actively wrong data going in.

## Fix

New `components/transfer/TransferAnalysisPanel.tsx`, mounted where the old
dead action bar was. Three small purpose-built editors:
- **Schema Mapping** — two field-list editors (name + type dropdown per row)
- **Data Quality** — a CSV-paste textarea (header + rows), parsed client-side
  into `records`/`schema` (field types inferred from header names) — a
  legitimate real-world DQ-tool input shape, not a JSON-paste stand-in for a
  form
- **Migration Plan** — an entity editor (name, row-count, priority,
  dependency multi-select against the other entities already added)

All three call their macro directly via `lensRun`. The generic AI-actions bar
and the generic capability-list collapsible section were also removed —
redundant now that every backend macro has a real, correctly-shaped caller.

## Verify gate

- `npx eslint`: clean.
- `npx tsc --noEmit -p .`: 0 errors in `transfer`-scoped files (unrelated
  transient errors in sibling agents' concurrently in-flight
  `export/legacy/audit/schema/projects` lenses in this shared worktree,
  confirmed via `git status`).
- `node scripts/verify-lens-backends.mjs`: `transfer` stays WIRED; total
  unchanged at 258 WIRED / 2 NO-BACKEND-CALL.
- `node scripts/grade-ux-polish.mjs --honest`: `transfer` → `tier: "polished"`,
  `isGenericScaffold: false` (was `functional`/`true` before this pass).
- No dedicated `transfer` lens vitest file exists; backend coverage lives in
  `server/tests/transfer-domain-parity.test.js` and
  `server/tests/depth/transfer-behavior.test.js`.
