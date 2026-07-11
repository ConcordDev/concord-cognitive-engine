# Lattice lens — capability map (Wave 3 verify-pass, 2026-07-11)

## What this lens actually is

Not the `lattice.*` macro domain (`beacon`/`birth_protocol`/`resonance`/`drift_alert`
registered inline in `server.js` — that's the Chicken2 reality-anchor /
continuity-verification substrate, an unrelated, coincidentally same-named
system). The **Lattice lens** surfaces the **brain self-training pipeline**
shipped in an earlier PR (per the page's own header comment): consent corpus,
per-brain daily refresh, MLOps run tracking, refresh scheduling + A/B tests,
audit log + drift alerts, and a federation corpus breakdown.

This is a REST-backed operator dashboard by design — no `lensRun`/macro
authoring path, because the lattice pipeline has no `lattice.*` macro domain.
Every panel binds to a real HTTP route:

- `server/routes/lattice.js` (mounted `/api/lattice`): `GET /corpus/stats`,
  `GET /corpus/mine`, `POST /dtus/:id/consent`, `POST /dtus/consent-all`,
  `GET /consent-log`, `GET /drift-alerts` — all 6 confirmed present via grep.
- `server/routes/brains.js` (mounted `/api/brains`): `GET /stats`, `GET
  /active`, `GET /:brainId/history`, `POST /refresh` (admin-gated), `GET
  /runs`, `GET /:brainId/eval-curve`, `POST /:brainId/rollback`
  (admin-gated), `GET`/`POST /schedule` (POST admin-gated), `GET
  /:brainId/corpus-sample`, `GET`/`POST /ab-tests`, `POST
  /ab-tests/:id/conclude` (admin-gated) — all 13 confirmed present via grep.

## Findings

The lens was already in excellent shape from a prior pass. Verified:

- **No fabricated data.** Every tab (Overview / Consent / Brains / Training /
  Schedule / Refresh / Audit / Federation) reads real REST responses; empty
  states are honest ("No consent-tracking tables present on this instance
  yet.", "No federated corpus yet — register a peer via Concord-mesh…").
  `TrainingRuns.tsx` has its own header comment: "Every value rendered comes
  from a real REST response — no mock data." No `Math.random()` in any
  render path (grepped all 5 files in `components/lattice/`).
- **The naming collision is documented in-product**, not just in a doc file —
  the Overview tab's info callout explicitly tells the user the `lattice.*`
  macro domain is a different subsystem and links to where its metrics
  actually live (Admin lens's Reality Guard panel). This is the right way to
  handle a same-name collision: disclose it, don't silently ignore or
  conflate it.
- **Admin-gated mutations are correctly scoped** — refresh/rollback/schedule-write/
  ab-test-write all route through `adminGate` server-side; the page's Refresh
  tab explicitly notes "Manual refresh is admin-gated."
- **No unsurfaced macros** — N/A, this lens has no macro domain of its own.
- No dead/generic scaffold components (`importsGenericTrio: false`,
  `usesGenericBody: false`).

No code changes made — this was a verify-pass, not a fix-pass.

## Verification (all run directly, 2026-07-11)

- `npx eslint app/lenses/lattice/page.tsx components/lattice/*.tsx` — clean, 0 issues.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged (the verifier correctly recognizes this lens's REST-route calls as valid wiring despite having no macro domain).
- `node scripts/grade-ux-polish.mjs --honest` — `lattice`: `tier:"polished"`, `isGenericScaffold:false`, `bespokeRatio:0.677`, `pillarsPresent:5`, `antiPatterns:0`. `audit/` reverted via `git checkout -- audit/` afterward.
- Grepped all `server/routes/{lattice,brains}.js` route registrations against the page's own header-comment route list — exact match, no drift.
