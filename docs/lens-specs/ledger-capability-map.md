# Ledger lens — capability map (Wave 3, 2026-07-11)

## What this lens actually is

"The Ledger" — the analytical overlay you toggle to see the flows a fictional
in-world institution ("the Curtain") keeps off the public record: managed-parity
war funding (who funds both sides of a conflict) and extraction liens (rescue
loans that are really acquisitions). This is a narrative/satire payoff surface
for the `sere` sub-world — the corruption is uncovered by looking, not by being
told. Read-only by design; the real value-add is that every row is a real
economy-ledger read (`faction_funding` + `extraction_loans` tables), never
authored prose.

Backend: `server/domains/ledger.js` (3 macros, all reading from
`server/lib/economy-flows.js`, all fail-closed on bad numeric input, all
table-guarded to degrade to empty on a minimal build):
- `ledger.anomalies` — managed parity + extraction liens for one world.
- `ledger.faction_economy` — a faction's treasury + who funds it + liens against it ("follow the money up the chain").
- `ledger.flow_summary` — a platform-wide (not per-world — the underlying ledger has no per-row world id) rollup of `economy_ledger` by type.

## Finding: two real macros with zero UI caller

`ledger.anomalies` was already fully wired (with an unusually careful envelope-unwrap
implementation — the page's own comments walk through defending against exactly
the two-level `{data:{ok,result}}` / `{result:{ok}}` envelope bug this session's
audit has repeatedly found elsewhere). But `ledger.faction_economy` and
`ledger.flow_summary` were registered and tested at the macro layer, listed in
`concord-frontend/lib/lenses/manifest.ts`, and never called from any component.

## Fix

Added a faction dossier drill-down: every actor name in the managed-parity and
extraction-lien lists (funder, both sides of a funded war, creditor, debtor) is
now a clickable button that opens an inline dossier panel calling
`ledger.faction_economy` for that faction id — treasury, who funds them, liens
against them. Added a "Show global pulse" toggle that calls `ledger.flow_summary`
and renders the byType rollup, explicitly labelled as platform-wide (not scoped
to the selected world) since that's what the macro's own doc comment says it is
— honesty about scope matters as much as honesty about data source.

Both new panels follow the page's existing four-state discipline (loading /
error+retry / empty / populated) and the same envelope-unwrap defense already
used by the `anomalies` load path.

## Verification (all run directly, 2026-07-11)

- `npx eslint app/lenses/ledger/page.tsx tests/ledger-lens-states.test.tsx tests/components/LedgerLensPage.test.tsx` — clean, 0 errors (4 pre-existing warnings on unrelated `exportJson`/`exportCsv` callbacks, not introduced by this change).
- `npx vitest run tests/ledger-lens-states.test.tsx tests/components/LedgerLensPage.test.tsx` — **14/14 passing** (5 new tests added for the dossier + pulse features; 2 pre-existing assertions updated from a single-node regex match to a container-textContent match after splitting `fundsBothSidesOf` into individually-clickable buttons broke the old single-leaf-node match — the underlying rendered text is unchanged, only its DOM structure).
- `node --test server/tests/ledger-domain-macros.test.js server/tests/ledger-lens-macros.test.js server/tests/ledger.test.js` — **110/110 passing** (no backend changes; these macros were already correct and tested, just unsurfaced).
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — `ledger`: `tier:"polished"`, `isGenericScaffold:false`. `audit/` reverted afterward.
