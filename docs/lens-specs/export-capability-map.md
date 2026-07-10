# Export lens — capability map (Wave 2 batch 7, Docs/B2B SaaS archetype)

## Backend macro surface

Domain file: `server/domains/exportdomain.js` — 25 lens-action macros registered
via `registerLensAction("export", …)`:

| Macro | Status before this pass | Status after |
|---|---|---|
| `generatePackage` | designed but fed from a disconnected placeholder artifact (always ~empty input) | DESIGNED — fed the live DTU set + selected format |
| `validateExport` | same disconnected-artifact defect | DESIGNED — validates the live DTU set against `requiredFields: [id, title]` |
| `scheduleExport` | designed but fed the same disconnected artifact, AND fully superseded by the stateful scheduler below | retired as a duplicate (see disposition below) |
| `diffExport` | same disconnected-artifact defect (would always diff `[] vs []`) | DESIGNED — diffs the live DTU set against the last retained JSON export payload from the real history log |
| `field-schema` / `field-project` | DESIGNED (`ExportToolkit` — Selective Field Export panel) | unchanged, already real |
| `pdf-generate` | DESIGNED (`ExportToolkit` — PDF export panel) | unchanged, already real |
| `encrypt-archive` / `decrypt-archive` | DESIGNED (encrypt via `ExportToolkit`); decrypt has no UI caller | encrypt unchanged; decrypt is BACKEND-CAPABLE-BUT-UNSURFACED (see below) |
| `record-run` / `history-list` / `history-download` / `history-clear` | DESIGNED (`ExportToolkit` — Export History panel) | unchanged, already real |
| `cloud-connect` / `cloud-list` / `cloud-disconnect` / `delivery-push` | DESIGNED (`ExportToolkit` — Cloud Destinations panel) | unchanged, already real |
| `incremental-pull` / `cursor-list` / `cursor-reset` | DESIGNED (`ExportToolkit` — Incremental/Delta Export panel) | unchanged, already real |
| `schedule-create` / `schedule-list` / `schedule-toggle` / `schedule-delete` / `schedule-run-due` | DESIGNED (`ExportToolkit` — Scheduled Exports panel, auto-runs due schedules every 60s) | unchanged, already real |

Additionally, the canonical macro registry (not `registerLensAction`) has a
**second, older "export" macro set** at `server/server.js` (`export.markdown`,
`export.obsidian`, `export.json` — multi-format DTU export with an Obsidian
vault variant producing one `.md` file per DTU with frontmatter + wikilinks).
Classified below.

## Reference-parity target

Real analogs: a data-export/reporting tool with **format conversion**,
**scheduled/recurring exports**, and an **export history/audit trail** —
concretely, the shape of Airbyte/Fivetran-style scheduled syncs combined with
a personal-data-portability tool (Google Takeout: pick a data type, pick a
format, get a downloadable archive + a log of past exports).

"The only difference should be scale, nothing else" — Concord's version
should look and behave like Takeout/Airbyte, scoped to one user's DTU corpus
instead of an org's warehouse.

### Checklist

| Capability | Disposition |
|---|---|
| Pick format (JSON/CSV/Markdown/Text/.dtu) | ALREADY REAL — bulk export + per-DTU export, both live |
| Column/field selection before export | ALREADY REAL — `ExportToolkit` Selective Field Export |
| Scheduled recurring exports (daily/weekly/monthly) | ALREADY REAL — `ExportToolkit` Scheduled Exports, auto-executes due schedules every 60s |
| Export history / audit trail with re-download | ALREADY REAL — `ExportToolkit` Export History |
| Incremental/delta export (only what changed) | ALREADY REAL — `ExportToolkit` Incremental/Delta Export |
| Push to a cloud destination (Drive/Dropbox/S3/OneDrive) | ALREADY REAL — `ExportToolkit` Cloud Destinations (caller supplies a real OAuth token; only a fingerprint is retained) |
| PDF report generation | ALREADY REAL — `ExportToolkit` PDF export (server-rendered PDF 1.4) |
| Encrypted/password-protected archive | ALREADY REAL — `ExportToolkit` Encrypted Archive (encrypt is wired; **decrypt is BACKEND-CAPABLE-BUT-UNSURFACED** — `decrypt-archive` has no UI caller today. Disposition: scoped future build, ~30 LOC panel taking password + the `.enc` envelope back in; deferred because encrypting-and-keeping-your-own-password is the primary use case and decrypt is rarely needed in-app) |
| Dry-run package preview (size/format estimate before committing) | ALREADY REAL after this pass — `generatePackage`, now fed the live DTU set |
| Data-quality validation before export | ALREADY REAL after this pass — `validateExport`, now fed the live DTU set with a real required-field schema |
| "What changed since I last exported" diff | ALREADY REAL after this pass — `diffExport`, now diffs against the last retained JSON export from history |
| Obsidian-vault-style multi-file export (one note per DTU, wikilinked) | GENUINELY MISSING (frontend). Backend macro (`export.obsidian`) is real and produces correct per-DTU Markdown + frontmatter + `[[wikilinks]]`, but shipping it needs a zip library (no `jszip`-class dependency in `concord-frontend/package.json` today) to bundle N files into one download. Disposition: scoped future build — add a zip dependency, wire `export.obsidian`, ship a "Download as Obsidian Vault" button. Not done in this pass to avoid an unreviewed new dependency. |
| Bulk-export multiple named datasets (not just one corpus) | Honest relabel — the lens previously showed fabricated "Events" (hardcoded 500) and "Settings" (hardcoded 45) source toggles that did nothing (bulk export only ever included DTUs regardless of what was toggled). Removed; the bulk-export panel now honestly shows the one real exportable source (your DTU corpus) with a live count. |

## What was fixed

1. **Fabricated dataset counts** — the "Data Selection" grid in `Bulk Export`
   showed `Events: 500` and `Settings: 45` as if real, selectable, counted
   sources. Neither exists; toggling them changed nothing (the export always
   only included DTUs). Replaced with a single honest "DTUs — N items will be
   exported" indicator.
2. **Three of the four "Export Actions" quick buttons were dead-ends** —
   `generatePackage`, `validateExport`, and `diffExport` ran against a
   disconnected generic placeholder artifact (created via the shared
   lens-artifact CRUD system, type `"export"`), which never carried any real
   `items`/`current`/`previous` data. Every click silently computed against an
   empty/zeroed input and returned a technically-`ok:true` but meaningless
   result (0 items, "ready", 0 diff). Rewired all three to call the macros
   directly with the live DTU set (and, for the diff action, the last
   retained JSON export from the real history log) via `lensRun`.
3. **`scheduleExport` retired as a live duplicate** — it's a legacy one-shot
   compute macro (returns a computed `nextRun` but persists nothing); the real
   feature is the stateful scheduler already wired in `ExportToolkit`
   (`schedule-create/list/toggle/delete/run-due`, which actually persists and
   auto-executes). Keeping both was presenting a decorative dead click next
   to the real thing.
4. Removed the generic template action-button wall and the generic
   auto-discovered capability list that were still mounted on the page
   (redundant given the bespoke `ExportToolkit` + `ExportFormatGallery` +
   per-DTU export UI already present).
5. Minor honesty fix: the "Total Exports" stat card was actually counting all
   DTUs, not export runs — relabeled "Total DTUs".

## Verify gate

- `npx eslint` on the touched files: clean.
- `npx tsc --noEmit -p .`: 0 errors project-wide.
- No lens-specific vitest file exists for `export` (none found under
  `concord-frontend/tests/` or co-located `__tests__`) — noted, not invented.
- `node scripts/verify-lens-backends.mjs`: `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260 — unchanged from the pre-wave baseline; `export` stays WIRED.
- `node scripts/grade-ux-polish.mjs --honest`: `export` → `tier: "polished"`,
  `isGenericScaffold: false`.
