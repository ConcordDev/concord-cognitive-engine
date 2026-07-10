# Disputes Lens — Capability Map (Frontend Rebuild Program, Wave 3)

Reproduce the macro list: `grep -c 'registerLensAction("disputes"' server/domains/disputes.js` → 22

## Reference apps

- **eBay/PayPal Resolution Center** — the canonical ODR (online dispute
  resolution) shape: case timeline, evidence attachment, two-party
  messaging, settlement offers, escrow hold/release, SLA-driven
  auto-escalation.
- **Modria/Tyler ODR** — the mediator-assignment + structured-offer variant
  used by real e-commerce and small-claims platforms.

Parity target: "the only difference should be case volume, nothing else."

## Audit finding: already a comprehensive ODR workbench; one aggregate view was missing

`components/disputes/CaseWorkbench.tsx` (1,100+ LOC) is a real, deep case
workbench: case-open/list/detail/advance/resolve, evidence attach/remove,
a two-party message thread, mediator assign/unassign, settlement
offer/counter-offer exchange, an SLA-check button that surfaces
auto-escalations, a resolved-case archive search, and escrow freeze/release
controls per case. `LawStackFeed.tsx` supplies a live legal-news/precedent
feed alongside it. Every value traces to a macro call (`run()` is a named
dispatcher, not a raw generic action array/select) — no fabricated stats
found.

## `node scripts/lens-unsurfaced.mjs --lens disputes` (before this pass)

```
disputes: 1/22 macros never referenced in the frontend
  escrow-* (1): escrow-status
```

## Checklist

| Item | Disposition |
|---|---|
| Case lifecycle (open/list/detail/advance/resolve) | ALREADY REAL |
| Evidence attach/remove, two-party messaging | ALREADY REAL |
| Mediator assign/unassign | ALREADY REAL |
| Settlement offer/counter-offer | ALREADY REAL |
| SLA auto-escalation check | ALREADY REAL — `SlaCheckButton` |
| Per-case escrow freeze/release | ALREADY REAL |
| Resolved-case archive search | ALREADY REAL |
| **Portfolio-wide escrow ledger** (`escrow-status`) | **BACKEND-CAPABLE-BUT-UNSURFACED → WIRED THIS PASS.** The per-case escrow indicator only showed one case at a time; the backend's `escrow-status` macro aggregates every currently-frozen hold across the caller's whole case portfolio (case title, amount, frozen-since date) but had no caller. Added an `EscrowLedgerPanel` (a "Escrow Ledger" button next to the existing "SLA Check"/"New Case" controls) that opens a dropdown ledger listing every hold, clicking one opens that case. |

## What changed

- `concord-frontend/components/disputes/CaseWorkbench.tsx`: new
  `EscrowLedgerPanel` component calling `disputes.escrow-status`, wired into
  the workbench header next to `SlaCheckButton`.

## Verification

- `npx eslint components/disputes/CaseWorkbench.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors attributable to this lens (two
  pre-existing errors in `app/lenses/collab/page.tsx` / `app/lenses/dtus/page.tsx`
  are unrelated concurrent sibling-agent work, confirmed via `git status`).
- `node scripts/verify-lens-backends.mjs` — `disputes` still `WIRED`; fleet
  total 258 WIRED / 2 NO-BACKEND-CALL / 0 broken, unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — `disputes`: `tier: "polished"`,
  `isGenericScaffold: false`. (Transient `audit/ux-polish-honest*` files
  reverted after the run.)
