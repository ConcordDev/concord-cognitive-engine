# Lens Audit Methodology — feature depth vs the category leaders

**Purpose.** Concord is ~259 app-shaped lenses on one substrate. Their feature
depth vs the category leaders is **highly variable, and the docs don't tell you
which is which** — you have to read code. This is the repeatable, code-first way
to find (a) which lenses genuinely rival their competitor (latent value to
surface) and (b) where a lens is *oversold* (UI that doesn't deliver — fixable
defects). It is the lens-level sibling of the depth-test multiplier.

**The finding that motivated it (all verified in code, 2026-06-03):**
- `accounting` ≈ **QuickBooks-core parity** — real double-entry, all 3 financial
  statements, bank reconciliation, payroll w/ withholding, multi-currency w/ live
  FX, IRS-format e-file. Genuinely competitive, and *under*-sold.
- `code` **beats VS Code** on CRDT-multiplayer, git richness, and an LLM multi-file
  agent; **loses** on real LSP / step-debugger / PTY / extensions. Deep but
  *different*, not a lite clone.
- `music` is a **facade with real oversell**: EQ/crossfade were stored but never
  applied to the audio graph; downloads faked a byte-size. (Fixed — see case study.)

So: do NOT assume "shallow vs specialists." Some lenses are at parity; some are
facades. Audit, don't guess.

## Two layers

### Layer 1 — deterministic scorecard (cheap, covers ALL lenses) — `npm run lens:audit`
`scripts/lens-audit.mjs` reads only code-grounded sources and writes
`audit/lens-audit.json` + a ranked table. Per lens it reports:
- **rival** (from `scripts/lens-rivals.json` — hand-maintained; see below),
- **macros** + **substantive** (production+utility+functional = real feature code)
  vs **stub** (placeholder), from `audit/macro-depth-honest.json`,
- **behaviorallyTested** (production+utility — the honest test-depth, for reference),
- **frontendFiles** (UI under `app/lenses/<lens>/` + `components/<lens>/`),
- a **band**: `parity-candidate` (≥60 substantive + ≥3 FE files) · `deep` · `moderate`
  · `thin` (mostly stub) · `facade-risk` (UI but thin backend, or backend but no UI).

Use it to TRIAGE: confirm/showcase the `parity-candidate`s, fix the `facade-risk`s,
ignore the long `thin` tail (small lenses, correctly small).

**Honest limitation (don't hide it):** the scorecard catches "backend deep / no UI"
and "UI / no backend" facades, but NOT the **music-style facade** — where both exist
yet the frontend never *applies* the backend output (the EQ-stored-but-unwired
pattern). The macro `eq-set` is substantive; the gap is in the wiring. That needs
Layer 2 (or a dedicated wiring detector). The scorecard triages; it does not certify.

### Layer 1.5 — orphaned-panel detector (deterministic, all-lenses) — `npm run lens:orphans`
`scripts/lens-orphans.mjs` catches ONE concrete slice of the wiring-facade class the
scorecard admits it misses: the **orphaned-but-wired panel** — a `components/<lens>/*`
file that is fully backend-wired (calls a real macro/route) but is **never imported or
referenced anywhere in the frontend**, so the user can't reach it. Both backend and
frontend exist; the gap is that the panel was never mounted. It flags each as a
candidate surgical win (import + mount = an unreachable feature goes live).
- **It is a candidate, not a fix.** ⚠ An orphan is often a **superseded duplicate** of
  a richer mounted sibling (debate/`DebateTree` → mounted `KialoArgumentMap`;
  daily/`DailyJournal` → mounted `JournalStudio`). Always check for a sibling covering
  the same feature, and that the macro it calls actually exists, before wiring it in.
- Token-grep matching (not just import-path regex) so it catches dynamic `import()` +
  JSX usage — without that the naive scan over-reports ~3×.
- This is strictly more reliable than the Layer-2 LLM for *this* question: in practice
  the deep-dive repeatedly claimed panels "never mounted" that were dynamically
  imported, and missed genuine orphans. Run `lens:orphans` first; deep-dive second.

### Layer 1.5 — unsurfaced-macro detector (deterministic, all-lenses) — `npm run lens:unsurfaced`
`scripts/lens-unsurfaced.mjs` catches the **backend-built / no-UI** gap class: a
registered `(domain, action)` macro whose action token appears **nowhere** in the
frontend. Where `lens:orphans` finds a built *panel* that was never mounted, this finds
a built *macro* that was never given a panel at all. It groups hits into feature
clusters by prefix — a cluster of ≥3 (e.g. message `labels-*` ×5, whiteboard
`shared-*` ×3) is the strong signal: a whole feature lives on the backend with no UI.
- **Triage, not a defect list.** Many macros are legitimately frontend-invisible
  (LLM/agent tools, heartbeat-only, internal helpers, REST-routed). Read the cluster,
  then judge. Most clusters are **backlog** (need a new UI build), not surgical facades.
- Drill in with `npm run lens:unsurfaced --lens <name>`.

**Batch F — surfaced clusters (2026-06-04).** Worked the highest-coherence clusters,
**reading each macro's transport before building** (the triage rule above is load-bearing —
two clusters turned out to be intentionally-unsurfaced and were correctly skipped):
- **message `labels-*` →** completed the Gmail-labels feature. `LabelManagerPanel` only
  managed the catalog (list/create); new `ThreadLabelBar` in the thread header surfaces the
  per-message workflow (`labels-apply`/`labels-remove`/`labels-for-message`) as removable
  chips + an add-label picker.
- **art `brush-*` →** `ArtCanvas` read `brush-presets` but couldn't save/delete custom
  brushes; added a "+ Save" control (`brush-preset-save`) + hover-delete (`brush-preset-delete`).
- **food `review-*` →** `YelpDiscoverPanel` created reviews but the votes
  (`review-vote` useful/funny/cool) + self-delete (`review-delete`) had no UI; added both.
  `review-list` stays — `biz-detail` already returns the reviews (alternate path).
- **insurance `pact-*` →** the whole P2P mutual-aid pact feature (10 macros) had ZERO UI.
  New `MutualAidPactsPanel` + a "Pacts" mode tab surfaces 8 user-facing macros (write / list /
  respond-handshake / pay-premium / renew / auto-renew / revoke / payout-history).
  `pact-record-payout` (a **system / death-event** trigger keyed to the insured, not a button)
  and `pact-premium-schedule` (a redundant detail read) stay intentionally unsurfaced.
- **music `playlist-*` →** added per-track up/down reorder (`playlist-reorder`) + per-playlist
  delete (`playlist-delete`) to `MusicLibraryPanel`.
- **Correctly SKIPPED (intentionally unsurfaced):** **world `voice-*` (6)** — these are the
  lens-action mirror of a real-time WebRTC proximity-voice mesh whose actual client
  (`VoiceMesh.tsx` / `ProximityVoiceChat.ts`) signals over **sockets**, not request/response
  lens-run; surfacing them would duplicate the real transport. **The transport-read is the
  triage:** a macro that has a better-suited real-time/REST/system path is *not* a missing UI.

### Layer 1.5 — broken-wire detector (deterministic, all-lenses) — `npm run lens:broken-calls`
`scripts/lens-broken-calls.mjs` catches the **highest-severity** facade: a frontend
call to a macro that DOES NOT EXIST — a button the user clicks that 404s because
`runMacro(domain, action)` finds no handler (the `research.generate` bug: the lens
"Analyze" button POSTed it but no macro was registered). It cross-references every
literal `(domain, action)` the frontend calls against every `register(LensAction)?`
the server defines, and reports the calls whose domain is real but whose `domain.action`
is unregistered.
- Literal-only (computed action names are skipped), so it **under**-reports — a clean,
  low-false-positive signal. A few hits may be REST-route shims or dynamically-registered
  macros; verify each (grep the action tree-wide, read the call site) before fixing.
- Fix = register a real macro (deterministic + opt-in-LLM body, per the
  `literature-review`/`research.generate` convention) OR repoint the call to the right
  macro. The first run found 13 broken wires across the lenses (see batch 7).

### Layer 2 — LLM feature-parity deep-dive (expensive, per-lens, on demand)
For a chosen lens (prioritized by Layer 1), run an Explore agent with this template:

> Give an HONEST, code-grounded feature comparison of Concord's `<lens>` lens vs
> `<rival>`. **Read the actual code, not docs.**
> 1. BACKEND: read `server/domains/<lens>.js`. Enumerate feature areas; for EACH,
>    judge REAL implementation vs thin stub (quote 4–5 representative handler
>    bodies). Note anything gated on network egress.
> 2. FRONTEND: read `concord-frontend/app/lenses/<lens>/page.tsx` + its
>    `components/<lens>/*` (incl. the rival-shape shell). How deep is the UI?
>    Crucially: does the frontend actually CALL/APPLY the backend (not just store
>    settings)? — that's where facades hide.
> 3. COMPARE to `<rival>`'s CORE feature set. For each: present (cite `file:line`),
>    present-but-shallow, or absent.
> Be brutally specific — distinguish "macro/component exists" from "it actually does
> the thing." FLAG oversold features as fixable defects. Verdict on real depth.

### The honesty rules (carried from the depth multiplier)
- Distinguish **"exists"** from **"does it correctly."** A macro/component being
  present is not the feature working.
- **Flag oversell as a fixable defect**, never rubber-stamp (the music EQ-theater /
  faked-download pattern is the canonical example).
- Cite `file:line`. **Trust code over docs**, including CLAUDE.md.

## Runbook loop
```
npm run grade-macros:honest          # refresh the depth data the scorecard reads
npm run lens:audit                    # all-lens scorecard → audit/lens-audit.json
npm run lens:audit -- --band facade-risk    # the ones to fix first
#   → pick a lens; run the Layer-2 Explore deep-dive (template above)
#   → log defects; fix the oversold ones; surface the parity-candidates
#   → re-run lens:audit
```

## The lens→rival map
`scripts/lens-rivals.json`. There is **no structured `rival` field** in the
manifests — it lives in prose (empty-state captions) + the rival-shape shell names
(`VSCodeShell`, `WalletShell`, `KPIStrip`, …) in `concord-frontend/lib/lenses/manifest.ts`.
The map is seeded for the well-known lenses; `null` = unmapped. Extend it as you
audit — add `"<lens>": "<rival>"`.

## Worked case study — `music` (the first audit + fix, 2026-06-03)
- **Found:** EQ/crossfade/normalize settings stored server-side but `player.ts`'s
  audio graph was `source → analyser → out` — no EQ/gain nodes, so the sliders did
  nothing. `download-add` reported `sizeKb: durationSec*16` as if audio was stored.
  Karaoke vocal-cancel was a pref with no DSP. CLAUDE.md claimed an audio graph that
  didn't exist.
- **Fixed:** real 3-band BiquadFilter EQ + preamp gain wired into `player.ts`
  (`applyAudioSettings()`); `MusicParityPanel` applies it so sliders reach the sound;
  download de-faked to an honest offline metadata queue (`bytesStored:false`);
  CLAUDE.md corrected. **Flagged, not faked:** karaoke center-cancel + true
  track-to-track crossfade (needs a 2nd audio element); audible output needs device QA.
- **Lesson:** the scorecard rated `music` `parity-candidate` (deep both sides) — the
  facade was in the *wiring*, which only Layer 2 caught. Always deep-dive a
  parity-candidate before claiming it competes.

## Worked case study — batch 2: `crypto` (parity-candidate) + `forecast` (false-positive), 2026-06-03
Two lenses deep-dived in one batch — one real wiring facade fixed, one scorecard
false-positive cleared. **Both Layer-2 reports themselves over-claimed; every claim
was re-checked against code before acting** (the honesty rule cuts both ways — trust
the code over the *audit report*, not just over CLAUDE.md).

- **`crypto` (vs Coinbase / Phantom) — REAL facade found + fixed.** The watchlist was
  persisted only to `localStorage` (`TokenSearch.tsx#loadWatchlist/saveWatchlist`,
  `STORAGE_KEY='concord:crypto:watchlist:v1'`) while real user-scoped backend macros
  `crypto.watchlist-{list,add,remove}` (`server/domains/crypto.js:1292-1322`) sat
  **dead — never called by any frontend.** Net effect: the watchlist didn't sync
  across sessions/devices and the backend feature was unreachable. The music pattern
  exactly: backend exists, frontend never wires to it.
  - **Fixed:** `app/lenses/crypto/page.tsx` now seeds from the local cache then
    reconciles against `crypto.watchlist-list` (server = source of truth), and
    `toggleWatch` fires `watchlist-add`/`watchlist-remove`; a first-sync migrates any
    existing local watchlist up to the account. localStorage stays as an offline
    cache. The dead macros are now live and the list syncs.
  - **Over-claims from the deep-dive that code DISPROVED (cleared, not fixed):**
    "Holdings tab never mounts" — false, `activeTab === 'holdings'` renders at
    `page.tsx:884` (also `transactions`:888, `wallets`:995). "Swap has no
    simulation warning" — false, `page.tsx:1235` states "No external router is
    contacted; this view is informational + ledger-only" and the toast says "Swap
    simulated". "Send flow is broken / never persists" — false, `handleSend`
    (`page.tsx:485`) writes a ledger transaction, consistent with the lens's stated
    ledger-only model.
  - **Flagged, not fixed (genuine backlog, not surgical facades):** `crypto`'s
    DCA/recurring-buys, `tax-report`, NFT CRUD, `ai-portfolio-insight`, and the
    staking add/unstake UI have real backend macros but **no frontend surface** —
    each is a new-tab feature build (~80-180 LOC), tracked as backlog, not oversell.
- **`forecast` (weather) — FALSE POSITIVE, cleared.** Scorecard banded it
  `facade-risk` because no `server/domains/forecast.js` exists and it scored 7/11
  substantive. In fact all 11 `forecast.*` macros are registered **inline in
  `server/server.js:74848-74959`** and delegate to a real 512-LOC
  `server/lib/world-forecast.js` (deterministic embodied-signal composition, diurnal
  cosine, honest confidence decay, real `world_forecasts`/`forecast_alert_subs`
  persistence; the 7th tab is a live Open-Meteo fetch, clearly labeled). No
  fabricated data, no dead wiring. Correctly-thin + honest.
  - **Why the scorecard missed it:** `grade-macro-depth` attributes the inline
    `server.js` handlers to the `forecast` domain but doesn't recurse the delegated
    `world-forecast.js` lib, so the thin wrapper bodies under-score. This is the
    documented "scorecard triages, doesn't certify" gap — recorded here rather than
    chased in the grader. Added `forecast` to `scripts/lens-rivals.json`.
- **Meta-lesson:** the facade-risk band's "UI but thin backend" rule false-positives
  whenever a lens's macros live in `server.js` and delegate to a lib (forecast,
  and likely the other domain-file-less facade-risk entries: `lattice`). Confirm the
  backend's *real* location before treating a facade-risk flag as a defect.

## Worked case study — batch 3: `legal` (latent value surfaced) + `government` (over-claims cleared), 2026-06-03
Both lenses had `behaviorallyTested=0` (the wiring-facade risk profile). Again both
Layer-2 reports over-claimed — re-checking every claim against code is non-optional.

- **`legal` (vs Clio / DocuSign) — latent value SURFACED (the showcase half).** The
  backend is genuine Clio-parity (matters, IOLTA 3-way trust reconciliation,
  time/timer→invoice, FRCP-aware deadline calc, e-sign envelopes, doc templates —
  `server/domains/legal.js`). But two fully-built, fully-backend-wired panels were
  **orphaned** — never imported, never mounted:
  - `components/legal/IntakeFormsPanel.tsx` (client intake → `intake-forms-list`,
    `intake-submit`, `intake-convert` which spins a submission into a real
    contact+matter) and `components/legal/ReportsPanel.tsx` (firm realization +
    per-matter budget → `realization-rollup`, `budget-report`, `budget-set`). All
    target macros exist and are real.
  - **Fixed:** mounted both as new tabs in `app/lenses/legal/page.tsx` (`ModeTab`
    union + `MODE_TABS` + render branches + imports). Two working Clio-parity
    features (client intake, realization/budget reporting) went from unreachable to
    live with no backend change. This is "surface the parity-candidate," not a bug fix.
  - **Over-claims cleared:** the report said both panels were "imported at line 12/15"
    — false, they were not imported at all (that's *why* they were dead). It also
    flagged a missing Payment-Portal UI as P1 — real backlog, but the
    `payment-record`/`payment-portal-summary` macros have no component at all, so
    that's a build, not a surgical mount; left as backlog.
- **`government` (vs Gov.uk / GovTrack / USAspending) — NOT the facade the report
  claimed.** The report's TIER-0 "fabricated data shipped as real" finding was
  **wrong**: the `seedData` arrays in `page.tsx` are injected by `useLensData` only
  when `process.env.NODE_ENV === 'development'` (`lib/hooks/use-lens-data.ts:88`, with
  an explicit comment: *"in production, empty means genuinely empty… seeding would
  mask real auth/connection failures"*). That's a dev affordance, not a prod facade.
  The report also claimed `ElectionsPanel` "exists but is never mounted" — false, it's
  imported (`page.tsx:18`) and rendered (`page.tsx:3648`). The genuinely-real features
  (representatives via Congress.gov, bills, USAspending budget, NWS civic alerts) are
  live API-wired. The legitimate-but-non-surgical observation: the main-dashboard
  tabs persist via the *generic* artifact store rather than the specialized
  `permits-*` / `service-requests-*` workflow macros — a deeper rewire, logged as
  backlog, not forced.
- **Meta-lesson (compounding from batch 2):** the Layer-2 *report* is itself an
  untrusted source — treat its `file:line` claims exactly like CLAUDE.md's: verify
  before acting. Across batches 2-3, ~7 of the reports' "defects" were already-correct
  code; the real wins were 1 watchlist wiring fix + 2 orphaned-panel mounts, all
  confirmed by reading the lines.

## Worked case study — batch 4-5: `trades` + `whiteboard` (honest backlog) + the orphan sweep, 2026-06-03
- **`trades` (vs ServiceTitan/Jobber) and `whiteboard` (vs Miro/FigJam): real core +
  honest backlog, NO surgical facade.** Both Layer-2 reports again over-claimed and
  self-corrected: `trades`' "unwired" macros were mostly wired (dynamic
  `quotes-${act}` dispatch); `whiteboard`'s "templates are browse-only" was false (the
  Apply button exists, `WhiteboardWorkbench.tsx:169-186`), and its connector/frame/
  realtime/cursor gaps are **explicitly labelled "2026 parity backlog" in
  `server/domains/whiteboard.js:944`** — engineered backlog, not oversell. The
  methodology distinguishes the two: a code-documented backlog is honest; only an
  unlabelled UI-that-doesn't-deliver is the fixable facade. Neither lens got a forced
  change. (The whiteboard realtime emit-with-no-listener IS a genuine gap, but it
  falls inside that documented backlog and a blind state-reconciler is riskier than the
  honest gap — flagged, not faked.)
- **The deterministic pivot — `npm run lens:orphans` (Layer 1.5).** Rather than keep
  paying for over-claiming LLM deep-dives, batch 5 used a mechanical scan for the
  orphaned-but-wired panel class. It surfaced 9 candidates; the duplicate-check culled
  most (debate/`DebateTree`←`KialoArgumentMap`, daily/`DailyJournal`←`JournalStudio`,
  podcast/`ItunesPodcastPanel`←`ItunesSearch`, society/`WorldBankExplorer`←
  `SocietyActionPanel`, environment/`AirQualityPanel`← existing AQ surfaces). **Two
  were genuine, verified wins and were mounted:**
  - `travel/ParksPanel` → `travel.live_nps_parks` (`server/domains/key-required-live.js:130`,
    NPS-key-gated, honest `missing_api_key` envelope). Mounted in `app/lenses/travel/page.tsx`
    beside the Zippopotam reference panel.
  - `finance/FredSeriesPanel` → `finance.live_fred_series` (`key-required-live.js:62`,
    FRED-key-gated, honest envelope). Mounted beside `WorldBankPanel` in the finance page.
  Both were fully-built REAL_FREE reference panels that had simply never been imported —
  unreachable features made live with an import + one mount line each, zero backend change.
- **Lesson:** for the orphaned-panel facade class, the deterministic detector beats the
  LLM — it doesn't hallucinate mounts, and the only judgement it needs (is this a
  superseded duplicate?) is a fast sibling-grep. Layer 1.5 is now the first move on any
  lens before a Layer-2 deep-dive.

## Worked case study — batch 6: `research` (vs Zotero/Notion) — a real dropped-result facade, 2026-06-03
The first Layer-2 deep-dive that found genuine, surgical, *non-orphan* defects — the
music pattern in its purest form (backend computes the right answer; the frontend reads
the wrong field, or calls a macro that was never registered). All verified against code
(the report again flip-flopped on ~6 non-defects first):
- **`research.generate` was called but never registered.** The lens "Analyze" button +
  Enter key (`app/lenses/research/page.tsx` `handleRunAnalysis`) POST
  `/api/lens/run {domain:'research', action:'generate'}`, but no
  `registerLensAction("research","generate", …)` existed → the button 404'd silently.
  **Fixed:** added a real `research.generate` macro (`server/domains/research.js`) — a
  deterministic hypothesis-analysis scaffold (construct extraction → testable framing →
  operationalization → validity threats → next steps) with opt-in LLM enrichment and a
  deterministic fallback, matching the `literature-review` convention. Returns
  `{title, content}` exactly as the UI expects. Behavioral test at
  `server/tests/depth/research-generate-behavior.test.js` (4 cases).
- **Four result-field mismatches — backend returns X, UI reads Y (always blank).** All
  display-only, fixed in the frontend to read the real fields (zero backend/test risk):
  `citationNetwork` UI read `totalCitations` (never returned) → now `networkDensity`
  ("Density"); `methodologyScore` read `score`/`quality` → now `percentage`%/`grade`;
  `reproducibilityCheck` read `reproducibilityScore` → now `reproducibilityPercentage`%,
  and the issues list read `issues` → `criticalIssues`. Each verified field-by-field
  against the macro's exact `return { result: {…} }` object.
- **Lesson:** the dropped-result facade (backend right, UI reads the wrong key) is
  invisible to all three deterministic detectors — the macro IS surfaced (its name is in
  the frontend), the panel IS mounted, the backend IS deep. Only a field-by-field
  read of the return object against the UI's `result.<field>` accesses catches it. This
  is the residue Layer 2 exists for — but confirm every claim against the lines, because
  the report mislabels ~½ of them.

## Worked case study — batch 7: the broken-wire sweep (`lens:broken-calls`), 2026-06-03
The `research.generate` 404 (batch 6) generalised: if one lens called a macro that was
never registered, others probably did too. So instead of deep-diving lens by lens, the
new `lens:broken-calls` detector cross-referenced all frontend literal `(domain,action)`
calls against the registered macro set in one pass. **It found 13 broken wires** — every
one a button that silently fails (best case the AI catch-all answers; worst case a 404):

| Broken call | Caller | Class / disposition |
|---|---|---|
| `linguistics.analyze` | linguistics lens | **FIXED** — registered a real morphosyntactic analyzer (tokens, readability, lexical diversity, affix-inferred word classes; deterministic; reads params or artifact.data). Test added. |
| `art.generate` | art lens | needs an **image model** — no honest deterministic fallback; flag, don't fake. |
| `code.generate`, `code.forge-generate`, `code.execute` | code lens | code-gen / sandbox-exec — need LLM / a real runner; backlog. |
| `creative.generate` | maker lens | generative; needs a model; backlog. |
| `healthcare.generate` | healthcare lens | care-plan-from-symptoms — distinct from the working `generateSummary`; **medical content, deliberately NOT fabricated** (flag). |
| `meta.classify` | QuickCapture | auto-detect-domain for captured text; the `meta` domain is observability (services/metrics), has no classifier, and the call is `.catch`-guarded (falls back to a default domain). Backlog — needs a real text→lens classifier, and `meta` is the wrong home for it. |
| `ingest.batch-ingest` | ingest lens | the file picker sends only `{fileCount, filenames}`, never the file *contents* — so a backend macro can't honestly ingest anything (an ack-only macro would be oversell). Real fix is frontend: read each file + call the existing `ingest.parseDocument`/`pushRecord` macros. Backlog (frontend gap, not a missing macro). |
| `dtu.listByKind` | studio SessionBrowserRail | **FIXED** — added a thin `register("dtu","listByKind")` over the same `userVisibleDTUs` set as `dtu.list`, filtered by `machine.kind` (surfaces the browser's DTU/Forge tabs). |
| `music.browse` | studio SessionBrowserRail | no clean target — `music` has `list-published-stems` (stems) but no loops source; the call is `.catch`-guarded → graceful empty. Backlog (needs a loops/stems browse macro). |
| `crypto.wallet` | RivalShapePreview | preview shim; low priority. |
| `auth.me` | self lens | genuine unregistered lens call (`runDomain('auth','me')`) but **guarded** with `.catch(() => null)`, so it degrades to "no user" instead of crashing — low severity, but still a dead macro. |

- **Fixed this batch:** `linguistics.analyze` (real macro + 4-case behavioral test). The
  rest are recorded here with an honest disposition — the generative ones (`*.generate`)
  need a model and have no faithful deterministic fallback, and `healthcare.generate`
  is medical content I will not fabricate; those are backlog, not quick fixes. The point
  of the detector is that these 13 broken buttons are now *known and tracked* instead of
  silently 404ing in production.
- **Lesson:** the broken-wire class is the cheapest-to-find and highest-severity facade,
  and it's fully deterministic — one cross-reference beats N expensive deep-dives. Run
  `lens:broken-calls` on every PR that touches a lens. The four Layer-1.5 detectors
  (`lens:audit` depth · `lens:orphans` · `lens:unsurfaced` · `lens:broken-calls`) now
  cover the four mechanical facade/gap classes; Layer 2 is reserved for the
  dropped-result residue only it can see.

## Worked case study — batch 8: re-verify your culls (`environment/AirQualityPanel`), 2026-06-03
A discipline note, not a new lens. When the orphan sweep (batch 5) flagged the 9
candidates, I culled `environment/AirQualityPanel` as a presumed duplicate (the
environment lens already has air-quality surfaces). That was wrong: a second look showed
its macro, `environment.live_air_quality` (EPA AirNow real-time AQI, registered at
`server/domains/key-required-live.js:93`), is **surfaced by no mounted component** — the
existing `AirQualityActionStack` uses a different macro. So AirQualityPanel was a genuine
zero-overlap reference-panel win, identical in kind to `ParksPanel`/`FredSeriesPanel`, and
it's now mounted (3 such panels surfaced this session). The other re-checked culls held:
`daily/DailyJournal` shares `entry-create`/`entry-delete` with the mounted `JournalStudio`
(composer overlap → redundant surface), and `podcast/ItunesPodcastPanel`
(`live_itunes_search`) is a functional twin of the mounted `ItunesSearch`
(`itunes-search`) — both correctly skipped.
- **Lesson:** the duplicate-check that culls orphan candidates is itself fallible — a
  "presumed duplicate" must be confirmed by checking the *mounted sibling actually calls
  the same macro / surfaces the same feature*, not just that the lens "has something about
  air quality." Re-verify culls the same way you verify fixes.

## Worked case study — batch 10: `message` (vs Gmail/Slack) — a CLEAN parity-candidate (the showcase result), 2026-06-03
Not every deep-dive finds a defect, and a clean one is a real deliverable: it *confirms*
the lens competes (the methodology's whole "surface the parity-candidate" purpose — per
the music lesson, always deep-dive before claiming parity). The `message` deep-dive
checked **18 frontend↔backend field contracts** (saved, search, reactions, channels,
inbox-summary, messages, scheduled, snoozed, mentions, threads, huddles, files, directory,
bookmarks, pins, typing/live-state, notif-prefs) and found **every one matching**, plus
**0 broken wires** (all ~50 called macros registered) and **0 orphans** (all 13 components
mounted). Spot-verified two of its claims against code (`channels-list` BE `result:{channels}`
@`message.js:309` ↔ FE `result?.channels` @`ChannelList.tsx:41`; inbox-summary field set) —
the clean result holds. `message` is a fully-wired Slack/Gmail parity-candidate; its only
gap is the `labels-*` cluster (5 macros, backend-built / no UI — the `lens:unsurfaced` hit),
which is honest backlog.
- **Methodology insight (the most useful thing this batch produced):** this Layer-2 run
  did NOT over-claim — a sharp contrast to the open-ended deep-dives in batches 2-6, which
  mislabeled ~half their "defects." The difference is the *prompt*: I asked a **precise,
  falsifiable** question — "for each display, quote the backend `return {result:{…}}` AND
  the FE `result.<field>` read, and show whether the keys match" — instead of the
  open-ended "find the facades." Precise field-contract verification is the form of Layer-2
  that the LLM does *reliably*; open-ended facade-hunting is the form it hallucinates.
  Prefer the contract-verification prompt, and still spot-check the negatives (a clean
  report can hide a false negative as easily as a noisy one hides a false positive).

## Worked case study — batch 11: the systemic snake_case→camelCase break (21 buttons, 7 lenses), 2026-06-03
The `food`/`retail` contract-verification deep-dives both surfaced the SAME shape: the
frontend dispatches actions in **snake_case** (`scale_recipe`, `reorder_check`) but the
backend registers them **camelCase** (`scaleRecipe`, `reorderCheck`). The `/api/lens/run`
dispatch does an exact `LENS_ACTIONS.get("domain.action")` string match (`server.js`), so
the call misses the real handler and **falls through to the utility-brain AI catch-all** —
the button "works" but returns generic AI text instead of the real computation. A silent,
widespread facade.
- **Why the detector missed it (and the fix):** these lenses bind the domain in a hook
  (`useRunArtifact('retail')`) and dispatch via a wrapper (`handleAction('reorder_check')`),
  so there is no `domain:'x', action:'y'` literal adjacency for `lens:broken-calls` to
  match. Enhanced the detector with a **hook-bound-domain mode**: when a file binds exactly
  one domain via `useRunArtifact`/`useLensData`, pair the file's bare `…Action('literal')`
  dispatch tokens with that domain. The broken-wire count went **13 → 127** — the enhanced
  detector exposed the whole population the original missed.
- **Separating fixable bugs from intentional AI-use:** of the 127, **19 had a registered
  camelCase twin** (computed by normalising each snake call and checking the registry) —
  those are unambiguous bugs with a known fix. The other 108 are mostly the deliberate
  `*.analyze` / `*.generate` AI-catch-all convention (no twin) and were left alone.
- **Fixed (21 buttons across 7 lenses):** `retail` (`reorder_check`→`reorderCheck`,
  `ltv_calculator`→`customerLTV`) + the 19 twin-backed repoints in `aviation` (5),
  `food` (7), `education` (2), `realestate` (2), `creative` (1), `government` (2). Each is
  a frontend token swap, verified safe (the tokens appear only in dispatch context — no
  `actionResult.action === 'snake'` display branch keys on them — and the target macro is
  a registered artifact-analysis handler). 127 → 108 broken wires.
- **Lesson:** the most valuable thing the LLM deep-dives produced was not their per-lens
  verdicts but the *recurring shape* — once `food` and `retail` showed the same snake/camel
  break, the right move was to teach the deterministic detector the pattern and sweep all
  259 lenses at once, not deep-dive them one by one. Detectors scale; deep-dives don't.
- **Batch 12 follow-on (reordered-name twins):** the snake↔camel twin check only catches
  pure case differences. A second pass matched each broken action's **token set** (split on
  case + `_`/`-`, sorted) against the domain's registered macros — catching reordered names
  the first pass missed: `aviation.wb_calculate`→`calculate-wb`,
  `creative.generate_shot_list`→`shotListGenerate`, `fitness.{attendance-report→attendanceReport,
  body-comp-report→bodyCompReport}`, `manufacturing.scheduleMaintenance→maintenance-schedule`,
  `nonprofit.volunteer-match→volunteerMatch`. 6 more repointed (108 → 102), all verified the
  same way. **27 buttons fixed total** across the snake/camel/reorder class. The remaining
  102 broken wires now have NO registered macro under any name normalisation — they're the
  intentional `*.analyze`/`*.generate` AI-catch-all convention or genuinely-unbuilt features
  (need a model/new macro), i.e. real backlog, not a quick repoint.

## Worked case study — batch 14: triage the residue (crypto/fitness clean, `.analyze` is intentional), 2026-06-03
Consolidation after the broken-wire sweep — two findings worth pinning:
- **The dropped-result/field-mismatch class is RARE.** Of six lenses contract-verified
  with the precise prompt (research, message, food, retail, crypto, fitness), only
  `research` had field mismatches (4, fixed). `crypto` came back clean across 12 panels
  (dashboard-summary's 7-field destructure vs the backend's 11-key return, holdings,
  staking, allocation-breakdown, import-csv — all match), `message` clean across 18,
  `fitness`/`food`/`retail` clean on fields. So field mismatches are an occasional bug,
  not a systemic one — don't over-invest in hunting them; the snake/camel **wire** break
  was the systemic one.
- **`<domain>.analyze` is a deliberate convention, not 27 bugs.** 27 lenses dispatch
  `handleAction('analyze', item.id)` with no `analyze` macro registered; the `lens.run`
  dispatch routes unregistered actions to the utility brain by design (the "AI-analyze
  this artifact" button). Same for bare `*generate*`. Taught `lens:broken-calls` to split
  its count: **63 genuine (likely real bug) vs 38 likely-intentional AI-catch-all** — so the
  number gates on real wiring breaks, not the convention.
- **Where the 28 fixes + the residue leave it:** the clean-repoint seam (a real macro
  exists under a snake/camel/reordered/obviously-semantic name) is fully mined — 28 buttons
  fixed. The ~63 "genuine" remaining have NO macro under any normalisation: they need a new
  macro, structured params the artifact-only button can't supply (e.g.
  `fitness.generate-program` wants `goal`/`daysPerWeek`/LLM), or a model (`art/code.generate`)
  — real backlog, tracked, not faked. Run `lens:broken-calls` on every lens-touching PR;
  the genuine count is the number to keep at zero.
- **Batch 15 (redundant-suffix repoints):** a keyword-overlap pass over the 63 genuine
  found 7 more where the button calls `<macro>+<redundant suffix>` — the real
  artifact-analysis macro exists, the frontend just appends a word:
  `education.schedule_conflict_check`→`scheduleConflict`, `insurance.coverageGapCheck`→
  `coverageGap`, `manufacturing.{bomCostCalc→bomCost, safetyRateReport→safetyRate}`,
  `nonprofit.donor-retention-report`→`donorRetention`, `realestate.{cap_rate_calc→capRate,
  cash_flow_analysis→cashFlow}`. Each target confirmed artifact-based (works with the
  `{id}` dispatch) and free of display-branch comparisons. 101 → 94 broken (genuine
  63 → 56).
- **Batch 16 (synonym repoints — the last clean ones):** 3 more where the name differs by
  a synonym the token matcher can't see: `manufacturing.{oeeCalculator→oeeCalculate,
  scheduleOptimizer→scheduleOptimize}` (-er/-or vs -e) and `accounting.pnl-report→profitLoss`
  (pnl ≡ profit-loss). All artifact-based, verified. 94 → 91 broken (genuine 56 → 53).
- **The clean-repoint seam is now fully mined: 38 buttons fixed** across the
  snake/camel/reorder/suffix/synonym classes (batches 11-16). The remaining **53 genuine**
  broken wires have NO macro under any name — they need a new backend macro (`code.execute`,
  `neuro.train`, `temporal.simulate`, the ~17 `government.*` actions, `manufacturing.defectAnalysis`,
  `nonprofit.impactReport`), structured params an artifact-only button can't supply
  (`retail.{process_refund,send_tracking,initiate_return}` need rate/amount/address), or a
  model. That is real feature backlog, not an audit fix — and `lens:broken-calls` now tracks
  it (genuine count = the number to drive to zero as those features get built).

## Making it self-enforcing — the CI ratchet (batch 17)
A one-time audit decays; a gate doesn't. The broken-wire detector is now wired into
`.github/workflows/audits.yml` as a ratchet (`node scripts/lens-broken-calls.mjs --ci 53`):
the build fails if the **genuine** broken-wire count exceeds 53 (the floor measured after
the 38-button repoint sweep). So a new lens button that calls an unregistered macro can't
merge — it must register the macro, repoint it, or (if it's an intentional AI-analyze
button) be named `*analyze`/`*generate` so the `.analyze`/`*generate*` exclusion covers it.
The ceiling only tightens: each time a genuine wire gets a real macro, drop the `--ci`
number to lock the gain in. The other three detectors (`lens:orphans`, `lens:unsurfaced`,
`lens:audit`) stay report-only — orphans/unsurfaced macros are often legitimately
intentional, so they inform triage rather than gate. This mirrors the repo's existing
ratchet gates (verify-lens-backends WIRED ≥ 234, move-render, event-consumers): the
audit's findings become a floor the codebase can't regress below.

## Worked case study — batch 18-19: RUN THE APP — the double-nest facade, 2026-06-03
The single highest-value finding of the whole audit, and it was **invisible to every
static layer** — only surfaced by booting both dev servers and hitting the API.
- **The bug:** a `registerLensAction` macro returns `{ ok, result:{payload} }`, and the
  `POST /api/lens/run` handler wraps it AGAIN → the HTTP response is
  `{ ok, result:{ ok, result:{payload} } }`. `lensRun()` unwraps that envelope; a raw
  `api.post('/api/lens/run')` does NOT. So every raw caller reading `data.result.<field>`
  silently got the inner wrapper, not the payload. Effects confirmed live: **chem /
  physics / bio / markets calc workbenches rendered blank** (`setResult(data.result)`
  stored the wrapper), and three of my OWN earlier "fixes" (research.generate,
  linguistics.analyze, crypto.watchlist-list) rendered a JSON blob / never loaded.
- **How it was found:** `curl`-ing the live `/api/lens/run` showed `result.result.<field>`
  for `linguistics.analyze`, `chem.molecular-weight`, etc. A static scan then found **74**
  raw-`api.post` → `registerLensAction` sites — but most are fire-and-forget or use
  defensive `?? data.X` fallbacks, so the crude count over-states it; only the read-and-
  display sites were user-visibly broken.
- **The root fix (batch 19):** unwrap exactly one `{ ok, result }` layer in the
  `/api/lens/run` handler itself (`_unwrapLensEnvelope`, `server/server.js`), so the
  response is single-nested for ALL callers at once. Verified backward-compatible by
  construction AND live: `register` macros returning bare `{ ok, dtu }` (no `result` key)
  pass through unchanged (defensive `data.result.dtu.id` readers still resolve); `lensRun`
  tolerates single-nest; `{ ok:false, error }` shapes still surface; the only 3 frontend
  `.result.result` readers are defensive/field-named; mobile + the server tests use the
  macro path, not this handler. One ~4-line change fixed the blank calculators and the
  dropped results across the whole lens surface.
- **Lesson (the capstone):** static analysis + LLM deep-dives found wires and contracts;
  the *runtime envelope shape* was a facade NONE of them could see — `lens:broken-calls`
  said these macros were registered (true), `lens:audit` said the lenses were deep (true),
  the deep-dive said the fields matched (true at the macro return). Only running the app
  exposed that the transport double-wrapped the payload. **When you can, run it** — the
  cheapest detector for a transport/serialization facade is one real request.

### Layer 3 — runtime exercise (when a stack is available)
With both dev servers up (`server/ npm start` on :5050 + `concord-frontend/ npm run dev`
on :3000, which proxies `/api/*` → :5050), POST real requests to `/api/lens/run` and read
the actual response. Setup notes learned this session:
- Auth: `POST /api/auth/register` (a browser `User-Agent` + `Origin` header are required —
  there's a bot gate); use the returned `token` as `Authorization: Bearer`.
- Boot takes ~60s for the full ghost-fleet; `/health` answers earlier. `CONCORD_DISABLE_FEEDS=1`
  and `--max-old-space-size` reduce memory pressure on a small box.
- **Sandbox caveat (don't mistake infra for bugs):** a broad all-macro sweep is unreliable
  on a constrained box — it trips the request **rate-limiter (HTTP 429)** and can **OOM the
  process** (the log just stops, no crash line). Those `429`/`fetch failed` results are
  infrastructure, NOT macro defects. Sweep in small chunks, health-gate between them, pace
  ~700ms/call, and flag only `result.error === 'handler_error'` (a caught internal throw),
  non-200, or timeout — never raw `ok:false` (that's normal input validation).
- **What the runtime exercise actually found (2026-06-03):** the systemic **double-nest**
  facade (batch 19) — the one real systemic runtime defect — plus confirmation that the
  compute layer is healthy: a curated 24-macro check (accounting/manufacturing/realestate/
  insurance/research/linguistics/bio/physics/chem/ml/…) ran **24/24 clean, 0 handler_error**.
  The 38 repointed buttons were verified to hit real macros live (`oee`, `capRate`,
  `retentionRate`, …), and the `.analyze` AI-catch-all degrades gracefully (HTTP 200,
  honest "fetch failed" in <1s with no Ollama, no hang). Runtime is Layer 3: it certifies
  what the static layers can only triage.

## Execution program — closing the genuine broken-wire backlog (2026-06-04)
Following the approved plan (`/root/.claude/plans/1-51-genuine-broken-steady-kay.md`),
the genuine broken-wire backlog is being closed batch-by-batch, each
research→audit→build/repoint→**validate-live**→ratchet→commit. Progress so far
(genuine count 51 → 9, CI ratchet lowered in lockstep):
- **Batch A (5 repoints):** `events.budget_analysis→budgetReconcile`,
  `creative.budget_analysis→budgetTrack`, `education.calculate_grades→gradeCalculation`,
  `services.inventoryCheck→supplyCheck`, `trades.generateEstimate→calculateEstimate`.
  Each target re-derived from code (the inventory agent's suggestions were ~all wrong),
  confirmed `registerLensAction` + **artifact-based** (rejected `events.budget-summary`
  which reads `params.eventId` the `{id}` dispatch can't supply), display-compatible,
  validated live.
- **Batch B — manufacturing (4 builds):** `advanceStep`/`defectAnalysis`/`generateTraveler`/
  `logDowntime` as deterministic macros (oeeCalculate template) + 4 matching typed display
  branches (the lens has no generic fallback). Test + live-validated.
- **Batch B — creative+events (2 repoints + 2 builds):** `asset_report→assetOrganize`,
  `event_summary→advanceSheet`; new `creative.project_summary`/`revision_summary`. Generic
  display, validated.
- **Batch B — nonprofit (2 repoints + 4 builds + a generic fallback):** `campaign-analysis→
  campaignProgress` and `export-grant-report→grantReporting` (both happen to match existing
  typed branches); new `view-giving-history`/`grant-deadline-check`/`impact-report`/
  `send-acknowledgment`; added a JSON fallback to the typed-only result panel. Validated.
- **Recurring lessons reconfirmed:** (1) a repoint target must read the **artifact**, not
  unsupplied `params.X`; (2) typed-display lenses need the target's fields to match a branch
  OR a generic fallback added; (3) the sandbox can't hold both servers — free the frontend,
  run backend alone, foreground `nohup … & disown` (background-tool launches get reaped),
  pace ≤700ms.

**State after the macro-over-artifact sweep: 51 → 9 genuine** (41 real wires closed + 1
detector false-positive removed). Closed: a batch of verified repoints; **government (16 —
incl. 12 new deterministic civic-dashboard macros)**; manufacturing, creative/events,
nonprofit, affect/meta clusters; plus `paper.export_pdf` (text export + client download),
`security.accessAudit` (STATE posture audit), `temporal.simulate` (trend-projection). ~30 new
deterministic macros, 9 behavioral test files, every one validated live against the running
backend. The detector regex was tightened (`Action(` capital-A) to drop the `world.authored`
false positive (`recordAssetInteraction` over-match).

**Continuation — the "capability-blocked" 9 re-examined → 9 → 2 (2026-06-04 cont.).** The
"capability-blocked" label was treated as a hypothesis to falsify, not a verdict. Re-reading
each call site against the data model showed **7 of the 9 had an honest deterministic
closure** that didn't need the assumed UI/VM/model:
- **Batch D — retail ×3 (`process_refund`/`send_tracking`/`initiate_return`):** these run from
  the inline **order-card** buttons via the artifact-runner, so the order artifact IS the
  handler's 2nd arg — no param-modal required. Built three real `registerLensAction` macros
  that mutate the order artifact with **Shopify-style deterministic defaults** (full-remaining
  refund pre-fill, auto-generated `CONCORD…` tracking, RMA issuance) + optional param
  overrides, push a real timeline event, and best-effort mirror into the dashboard
  refunds/returns buckets. 7 behavioral tests (`retail-fulfillment-behavior`).
- **`music.browse`:** the studio SessionBrowserRail's loops/stems tabs. Its sibling `dtu`/
  `forge` tabs already read the DTU substrate via `dtu.listByKind`; loops/stems have the same
  source (stems = `adaptive_music`-tagged DTUs from `music.publish-as-stem`; loops =
  loop-typed/tagged DTUs). Built a real `register("music","browse")` MACROS-path macro that
  queries them from the db — **honest empty when none exist, never fabricated**.
- **`ingest.batch-ingest`:** the old call sent only `{fileCount, filenames}` (no bytes) → brain
  catch-all. The honest closure read the actual file content client-side (`FileReader`) and a
  real macro creates a **DTU per text file** via `dtu.create` (the proven `/api/dtus` path);
  binaries carry no extractable text here, so they're returned as `skipped` with a reason —
  **not faked as ingested**. A legacy filenames-only payload now errors `no_file_content`
  rather than pretending. 2 behavioral tests.
- **`neuro.train`:** the lens carries hyperparameters, not samples. Built a macro with **two
  honest modes** — REAL seeded logistic-regression gradient descent (true decreasing BCE loss)
  when `data.dataset=[{features,label}]` is attached, and otherwise a deterministic
  learning-curve **projection explicitly flagged `{simulated:true, basis:'hyperparameter_
  projection'}`** with a note that it is NOT a trained model. The flag is what makes the
  projection honest rather than theater. 2 behavioral tests.

**Final state: 51 → 2 genuine.** The remaining **2 are genuinely capability-blocked** and
stay flagged, not faked: `ar.render` (a client-side 3D/WebXR scene-activation **side-effect** —
there is no server payload to compute, so there's no macro to register) and `code.execute`
(needs a real sandboxed code VM; the programming-puzzle VM is opcode-only, not a general JS
runner). **Lesson:** "capability-blocked" is a claim to re-test per item against the actual
data model and dispatch path — most of the residue had a deterministic closure hiding behind
an assumption about the UI. Only a true client-only side-effect (`ar.render`) or a genuine
missing runtime (`code.execute`) is truly blocked.

**Batch H — AI-catch-all `*generate*` → real deterministic macros (2026-06-04).** The 37
`*.analyze`/`*generate*` actions route to the (in this env, unavailable) utility brain. Most
`.analyze` are genuinely freeform reasoning over an arbitrary artifact and are correctly left
on the brain — a shallow deterministic "analyze" would be *worse* than the honest catch-all,
and the trade domains already surface their specific compute macros (`welding.jointStrength`,
…) separately. But the ones with a **structured, computable output** were converted:
- **`retail.generate_label` →** a shipping label is a structured record, so it's deterministic:
  carrier + service tier, reused/minted tracking number, weight estimate (0.5kg + 0.3/item), a
  tiered ground/express/overnight cost model, and a scannable barcode. The brain's *prose* was
  useless for an actual label. Stamps the label + a timeline event onto the order artifact.
- **`fitness.generate-program` / `workout-plan-generate` →** was LLM-**only** (`"llm
  unavailable"` — the lens was dead without a model). Rebuilt **deterministic-first**: a real
  templated generator (rep schemes per goal, a day-split rotation by weekly frequency, an
  exercise library per focus×equipment) composes a periodised plan; the LLM is now an opt-in
  enhancement (`CONCORD_FITNESS_PLAN_LLM=true`) with the deterministic plan as the guaranteed
  fallback. AI-catch-all count 37→35; both with behavioral tests + live validation.
- **The conversion test:** does the action have a *structured, fully-derivable* output (a label,
  a templated plan, a calc)? Convert it — and the brain version was probably returning unusable
  prose anyway. Is it open-ended reasoning over arbitrary content? Leave it on the brain; that's
  what the catch-all is for. Deterministic-first never means faking a model's judgement.

### Layer 1.5 — unloaded-domain detector (deterministic, all-domains) — `npm run lens:unloaded`
`scripts/lens-unloaded-domains.mjs` catches the **most severe** facade: not one button, a
WHOLE domain. A `server/domains/<X>.js` that registers `registerLensAction("<X>", …)` macros
but is never wired into the runtime loader (`server/domains/index.js`'s export array, walked
by `server.js`'s `domainModules.forEach(mod => mod(registerLensAction))`, or an explicit
server.js import) — so every macro returns `unknown_macro` and the lens's entire backend is
dead. **The source-based verifiers (verify-lens-backends, lens-broken-calls) can't see it** —
the `registerLensAction` calls exist in source, they just never run. Only a live request, or
this loader cross-check, exposes it (same class as the double-nest transport bug).
- **Found 2026-06-04 (this session):** `genesis`, `staking`, `sponsorship`, `system`,
  `code-quality` — **64 macros across 5 whole domains** — were all unloaded. Discovered while
  building the genesis saved-searches panel (its macro returned `unknown_macro` live).
  Fixed by adding the 5 imports + array entries to `server/domains/index.js`
  (superLensDomains 217 → 222). Now a **CI ratchet at floor 0** in `audits.yml`, so a new
  domain file can't be left unwired.
