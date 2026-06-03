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
