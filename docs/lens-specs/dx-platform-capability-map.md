# DX Platform Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every claim below has a grep/read reproduction
> command next to it. Read this before touching `dx.js`, `dx-platform.js`,
> `dx-billing.js`, or the `dx-platform` lens frontend again — the three
> backend files look like one feature but are three separate substrates
> with three separate audiences.

## Scope boundary — three backend files, three audiences

The lens's frontend page calls domain `"dx"`, not `"dx-platform"` — but the
lens is actually fed by **three** backend files, confirmed by direct read
and grep, not assumption:

| File | Domain registered | Macro count | Real caller(s) | Storage |
|---|---|---:|---|---|
| `server/domains/dx.js` | `dx` | 11 (`grep -c 'register("dx"' server/domains/dx.js`) | The **real IDE plugins** (`concord-vscode`, `concord-jetbrains`) + the web onboarding page + the new severity panel (this rebuild) | SQLite (`codebases`, `codebase_severity_weights` via `server/lib/dx/codebase-registry.js` + `severity-evo.js`) |
| `server/domains/dx-platform.js` | `dx-platform` | 15 (`grep -c 'registerLensAction("dx-platform"' server/domains/dx-platform.js`) | The **web DxWorkbench** only (`concord-frontend/components/dx-platform/DxWorkbench.tsx`) | In-process memory (`globalThis._concordSTATE.dxPlatformLens`) — ephemeral, lost on restart, by the file's own header comment |
| `server/domains/dx-billing.js` | `billing` (not `dx-billing` — verified: `grep -n 'register(' server/domains/dx-billing.js` shows every call is `register("billing", …)`) | 5 | Shared across **every** metered domain in Concord (billing dashboard page here is one of many callers) | SQLite (`macro_call_log`, `economy_ledger` via `economy/balances.js`) |

**This is not a naming accident to "fix."** `dx.*` is the real, persistent,
per-user codebase registry that the actual editor extensions write to on
real activation/accept/reject events. `dx-platform.*` is a self-contained,
honestly-labeled **in-browser demo/trial substrate** — you paste file
contents into a textarea, it indexes them in memory, and you can chat/
search/review/team/CI against that pasted content without installing
anything. Both are real (no fabricated data in either), they are just
answering different questions ("what has my real codebase's severity
tuning done over time" vs. "let me try Concord DX against this snippet
right now"). `dx-billing.js` is genuinely a different lens's shared
infrastructure surfaced here, not a dx-platform-specific file — I did not
touch it.

Frontend call sites, confirmed by grep (`grep -n "lensRun(" concord-frontend/app/lenses/dx-platform/page.tsx concord-frontend/components/dx-platform/*.tsx`):
- `page.tsx` calls `dx.onboarding_progress` directly via `fetch` (not `lensRun`).
- `DxWorkbench.tsx` calls 15 `dx-platform.*` actions (was 12 before this rebuild — see "What changed").
- `SeverityWeightsPanel.tsx` (new, this rebuild) calls `dx.list_codebases` + `dx.list_weights`.
- `billing/page.tsx` calls `billing.balance` / `billing.usage` / `billing.getCurrentQuota`.
- `web-editor/page.tsx` calls `dx.register_codebase` + `detectors.runAll` (the **real** ~30-detector production suite — a fourth, separate domain, out of my touch scope, that backs `server/scripts/run-detectors.js` and the actual IDE plugins; `dx-platform.js`'s own 10-rule regex array is an intentionally simpler, self-contained scanner for the paste-based demo, honestly labeled in its own header: "Detector definitions are static *rules* (regex patterns), not data").

## Step 1 — capability audit findings

`node scripts/lens-unsurfaced.mjs --lens dx` (before this rebuild):
```
dx: 8/11 macros never referenced in the frontend
  list-* (3): list_codebases, list_shadows, list_weights
  get-* (1): get_weight
  record-* (1): record_fix_decision
  touch-* (1): touch_codebase
  upsert-* (1): upsert_shadow
  weighted-* (1): weighted_findings
```
`node scripts/lens-unsurfaced.mjs --lens dx-platform` (before this rebuild):
```
dx-platform: 3/15 macros never referenced in the frontend
  ciGateCheck-* (1): ciGateCheck
  recordDetectorFire-* (1): recordDetectorFire
  recordFixOutcome-* (1): recordFixOutcome
```

Cross-checked every "unsurfaced" `dx.*` macro against the actual plugin
source (not assumed — read `concord-vscode/src/api/concord-client.ts`,
`concord-vscode/src/extension.ts`, `concord-vscode/src/sidebar/repair-webview.ts`):

| Macro | Called by plugin? | Verdict |
|---|---|---|
| `register_codebase` | Yes — `extension.ts:109 client.registerCodebase(repoRoot)` | Already real, plugin-surfaced |
| `record_fix_decision` | Yes — `repair-webview.ts:61 this.client.recordFixDecision(...)` | Already real, plugin-surfaced |
| `upsert_shadow` | **No** — defined on `ConcordClient` (`concord-client.ts:51`) but never invoked from `extension.ts` or the webview | Built, wired client-side, never called — plugin-side gap, out of my touch scope (not a `dx-platform` lens file) |
| `touch_codebase` | **No** — zero callers anywhere (`grep -rn "touch_codebase"` outside `dx.js`/`codebase-registry.js`/tests hits only the `publicReadDomains` allowlist comment in `server.js:11286`) | Genuinely unsurfaced; low-value to expose (it's a write-only last-seen-at bump, nothing to render) |
| `list_shadows` | **No** — same grep pattern, zero callers | Genuinely unsurfaced (see disposition below) |
| `list_codebases` | **No**, before this rebuild | **Fixed this rebuild** — see below |
| `list_weights` | **No**, before this rebuild | **Fixed this rebuild** — see below |
| `get_weight` | **No** — zero callers anywhere | Genuinely unsurfaced (see disposition below) |
| `weighted_findings` | **No** — zero callers anywhere, including other server code | Genuinely unsurfaced (see disposition below) |

And the important discovery this cross-check surfaced: **the page's own
"How it works" copy claims "shadow-DTU cross-file context — streamed live
to your editor," but `upsertShadow` is dead code in the real plugin** (the
client method exists, nothing calls it). The "code never leaves your
machine" privacy claim on the same page is, as a result, currently *true
in practice* — no accidental contradiction — but the cross-file-context
feature itself is not live yet. This is a `concord-vscode` gap, not a
`dx-platform` lens gap, and `concord-vscode/` is outside my assigned touch
files for this rebuild, so I did not fix it — flagging it here so it isn't
silently lost.

## Step 1.5 — reference-parity checklist

**Primary reference: SonarQube/SonarCloud + SonarLint.** Once the actual
capability surface is read (IDE-local static analysis → PR diff review →
CI quality gate → project/team dashboard → per-rule severity tuning →
per-seat billing), this is a closer analog than a generic "DX platform"
comparison — Concord DX's shape is literally SonarLint (local IDE
detector pass) + SonarCloud (PR decoration + quality gate + project
dashboard) + a rule-tuning feedback loop, wrapped in Concord's pay-per-
call economy instead of a subscription. GitHub Copilot is the secondary
reference for the `chatWithCodebase` feature specifically.

| Capability | Disposition | Evidence |
|---|---|---|
| IDE-local static analysis on save/command | ALREADY REAL | `concord-vscode/src/extension.ts:262 client.runAllDetectors(...)` → `detectors.runAll` (the real ~30-detector suite, not `dx-platform.js`'s demo array) |
| Sign-in / license activation | ALREADY REAL | `server/routes/dx-oauth.js`, `dx.onboarding_progress`/`dx.welcome`, RFC 8252 loopback flow described in the page |
| Per-rule severity tuning per project (SonarQube "quality profile") | ALREADY REAL backend, **was web-unsurfaced** | `server/lib/dx/severity-evo.js` (accept/reject/ignore → weight drift, MIN_SAMPLES=20, clamped [0.1, 3.0]) — **now surfaced** by this rebuild's `SeverityWeightsPanel` |
| PR / diff review (SonarCloud PR decoration) | ALREADY REAL, self-serve variant | `dx-platform.reviewDiff` — parses a pasted unified diff and scans added lines; honestly simpler than Sonar's native GitHub-App PR comments (see "genuinely missing" below) |
| Quality gate (pass/fail pre-merge threshold) | ALREADY REAL backend, **was disconnected from the review flow** | `dx-platform.ciGateCheck` + `generateCiConfig` existed but only `generateCiConfig` had a UI tab; `ciGateCheck` had zero callers anywhere (confirmed by grep) — **now wired** into the PR Review tab as a live "Check gate" control |
| Project/team dashboard aggregating multiple repos | ALREADY REAL | `dx-platform.teamDashboard` — real aggregation over team members' indexed codebases, computed live (not cached/stale) |
| Codebase-wide search | ALREADY REAL | `dx-platform.searchCodebase` — literal + regex, case-sensitivity toggle |
| Chat-with-codebase (Copilot-style Q&A) | ALREADY REAL, honestly grounded | `dx-platform.chatWithCodebase` — deterministic token-overlap retrieval over indexed lines, returns citations; explicitly "never invents content" per its own comment, verified by reading the implementation (no LLM call in this path at all) |
| Per-call usage billing / quota | ALREADY REAL | `dx-billing.js` (`billing.usage/balance/history/getCurrentQuota/priceForMacro`) + `billing/page.tsx` |
| Detector-fire / fix-acceptance analytics over time | ALREADY REAL backend, **was permanently empty in practice** | `dx-platform.usageAnalytics` reads `recordDetectorFire`/`recordFixOutcome` logs, but nothing in the workbench ever called either macro (confirmed: `grep -rn "recordDetectorFire\|recordFixOutcome"` outside `dx-platform.js` hit only backend contract tests) — **now wired**: PR Review logs a fire per detector that produced findings, and each finding gets Accept/Reject/Ignore controls that call `recordFixOutcome` |
| Native GitHub/GitLab PR-check integration (auto-posted inline comments on push) | GENUINELY MISSING | Disposition: scoped future task. Today's nearest equivalent is the self-serve "paste a diff" `reviewDiff` tool plus a generated GitHub Action YAML (`generateCiConfig`) the user must commit themselves — honest, not faked, just a lighter-weight delivery mechanism than a GitHub App webhook receiver |
| SARIF / standard interop export for findings | ~~GENUINELY MISSING~~ **CLOSED (2026-07-16, `29112655`)** | New `exportSarif` macro transforms `reviewDiff`'s real findings shape into a genuinely well-formed SARIF 2.1.0 document (not a loose JSON-shaped approximation). Severity→level mapping reuses `ciGateCheck`'s own existing thresholds rather than inventing a new taxonomy; `tool.driver.rules` is deduplicated to one entry per distinct `detectorId` so every `results[].ruleId` correctly resolves. `DxWorkbench.tsx`'s Review tab gets an "Export SARIF" button beside the CI gate check, reusing the on-screen findings and the project's existing `downloadFile` helper for a real Blob download. |
| Historical issue trend / "new vs. existing" across commits (Sonar's leak period) | GENUINELY MISSING | Disposition: deferred — `reviewDiff` recomputes fresh each call with no persisted per-commit findings history; would need a findings-history table, a real schema change out of scope for this pass |
| Multi-language AST-aware analysis | HONEST SCOPE LIMIT, not a defect | `dx-platform.js`'s 10-rule detector grid is line-level regex, explicitly documented as such in its own header ("static *rules* (regex patterns), not data") — the *real* AST/production detector suite is the separate `detectors.*` domain the IDE plugin actually uses; the web demo intentionally trades depth for a zero-install trial surface |
| `dx.list_shadows` / shadow-DTU browsing in the web lens | GENUINELY MISSING (this rebuild) | Disposition: deferred. `upsert_shadow` is dead code in the real plugin (see above) — no live shadow content exists to browse yet, so building a browsing UI now would render a permanently-empty panel. Revisit once `concord-vscode` actually calls `upsertShadow` on file-save |
| `dx.get_weight` / `dx.weighted_findings` single-lookup or apply-weights read paths | GENUINELY MISSING (this rebuild) | Disposition: deferred, low priority. `get_weight` is superseded by `list_weights`, which the new panel already renders in full; `weighted_findings` applies weights to a caller-supplied findings array meant for whatever surface presents *live* findings — that's the IDE's own detector-grid UI (a different id-space than `dx-platform.js`'s demo detectors), not this web lens |

## Step 2–6 — classification

**Overall: real, already-good, non-generic UI with two concrete, scoped gaps — not a rebuild-from-scratch case.**

- **Not generic scaffold.** `page.tsx` imports `RecentMineCard` + `AutoActionStrip` (cross-lens standard footer widgets) but **not** `ManifestActionBar` — `scripts/grade-ux-polish.mjs`'s `GENERIC_TRIO` check requires all three (`grep -n "ManifestActionBar\|AutoActionStrip\|RecentMineCard" concord-frontend/app/lenses/dx-platform/page.tsx` shows only two), so `importsGenericTrio` is `false` and the lens was never at scaffold risk.
- **Not fabricated data.** No `Math.random()` in a render path, no hardcoded array presented as live data, no lorem placeholder. `DevToolingPulse.tsx` genuinely calls the live GitHub search API. `DxWorkbench.tsx`'s "codebases" are real user-pasted content, honestly labeled as in-memory/ephemeral by the domain file's own comments. `web-editor/page.tsx`'s `STARTER_CODE` sample contains a `TODO` and a `Math.random()` call, but it's inside a `@fake-data-ok-file` annotated starter snippet the user is meant to *edit*, not unresolved work in Concord itself.
- **The two real gaps found:**
  1. A **dead in-page anchor**: the "Per-codebase severity" quick-link card pointed at `/lenses/dx-platform#severity`, and no element on the page carried `id="severity"` (`grep -n 'id="severity"' concord-frontend/app/lenses/dx-platform/page.tsx` returned nothing before this rebuild) — a real instance of the "share link that goes nowhere" defect class called out in `CLAUDE.md`'s zero-fabrication section, sitting right next to two genuinely built, genuinely unsurfaced backend macros (`dx.list_codebases`, `dx.list_weights`) that would have made the link real.
  2. **Disconnected analytics**: `dx-platform.usageAnalytics`'s Analytics tab depends entirely on `recordDetectorFire`/`recordFixOutcome` data, but nothing in the workbench ever called either macro — any workbench-only user (no IDE plugin) would see "No detector activity recorded yet" forever, regardless of how many diffs they reviewed. `ciGateCheck` sat fully built and fully tested (`server/tests/dx-platform-domain-parity.test.js`, `server/tests/dx-platform-domain-macros.test.js`) with zero frontend callers.

## What changed

1. **`concord-frontend/components/dx-platform/SeverityWeightsPanel.tsx` (new).** Reads the real `dx.list_codebases` + `dx.list_weights` registry (distinct from the DxWorkbench's paste-based demo codebases — see scope boundary above). Honest four-state UI: loading, error+message, empty (with links to the real VS Code/JetBrains marketplace listings and the web-editor demo), and populated (a per-detector weight table with accept/reject/ignore counts and a color band matching the exact thresholds in `severity-evo.js#applyWeights`). Mounted in `page.tsx` with `id="severity"`, closing the dead anchor.
2. **`concord-frontend/app/lenses/dx-platform/page.tsx`** — one import + one mount point for the panel above; no other structural change.
3. **`concord-frontend/components/dx-platform/DxWorkbench.tsx` — `ReviewTab`**:
   - After a successful `reviewDiff`, logs one `recordDetectorFire` call per detector that produced a finding (best-effort, non-blocking), so the Analytics tab now reflects real workbench review activity instead of staying permanently empty.
   - Each finding row now has Accept / Reject / Ignore controls that call `recordFixOutcome` and lock into a decided-state badge — real per-finding disposition tracking, not a cosmetic button.
   - Added a "CI gate check" control (fail-on selector + button) that calls the previously-orphaned `ciGateCheck` against the current review's findings and renders a pass/fail verdict distinct from the review's own built-in verdict (so a user can see how CI would gate the same diff at a different threshold without re-running the scan).
4. **No backend changes.** Every macro needed already existed and was already correct (confirmed by reading `dx.js`, `dx-platform.js`, and their backing libs/tests) — this was a wiring gap, not a missing-engine gap. `dx-billing.js` was read for scope-boundary confirmation only; not modified.

## Verification

- `cd concord-frontend && npx eslint app/lenses/dx-platform/page.tsx components/dx-platform/DxWorkbench.tsx components/dx-platform/SeverityWeightsPanel.tsx components/dx-platform/DevToolingPulse.tsx` — clean, 0 errors (one `@next/next/no-html-link-for-pages` error was caught and fixed by switching the web-editor empty-state link to `next/link`).
- `npx tsc --noEmit` output filtered to `dx-platform` paths — no errors attributable to these files (full project-wide tsc run deferred to the orchestrator per instructions, to avoid racing 5 concurrent sibling agents).
- `npx vitest run tests/dx-platform-workbench-states.test.tsx tests/dx-platform-billing-page.test.tsx tests/dx-platform-web-editor-page.test.tsx tests/dx-platform-onboarding-page.test.tsx` — **10/10 passing**, no regressions. (The onboarding test's `ECONNREFUSED` stderr lines are pre-existing and intentional — that test exercises the real-fetch-failure path.)
- `node scripts/lens-unsurfaced.mjs --lens dx-platform` — **0/15 unsurfaced**, down from 3/15 (`ciGateCheck`, `recordDetectorFire`, `recordFixOutcome` all now called).
- `node scripts/lens-unsurfaced.mjs --lens dx` — **6/11 unsurfaced**, down from 8/11 (`list_codebases`, `list_weights` now called); the remaining 6 are dispositioned above (4 are genuinely plugin-side concerns outside this rebuild's touch scope, 2 are low-value superseded read helpers).
- No existing test file references `SeverityWeightsPanel` (new component) — none to update; a future pass could add a four-state contract test mirroring `dx-platform-workbench-states.test.tsx`'s pattern, but wasn't required to avoid regression on this pass's scope.
