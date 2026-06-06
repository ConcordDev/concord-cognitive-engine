# Lens UX/UI Audit — research-grounded, per-app-identity-preserving

**Scope.** All 259 lenses, audited against current UX + UI research. Grounded in
**real authenticated screenshots** (signed in as a user — the app blocks bot
scraping, so an API-mocked capture only ever shows the login page) plus a
code-level survey of the shared lens layer.

**The governing constraint.** *Each lens is a different app and must look
different* — code is VS Code, accounting is QuickBooks, crypto is Coinbase,
music is Spotify/a DAW, message is Slack, healthcare is an EHR, whiteboard is
tldraw, atlas is a map. This audit **protects that diversity.** It judges each
lens on (a) how faithfully it nails ITS OWN rival-app identity, and (b) the
**invisible shared layer** — accessibility, feedback states, polish discipline —
which is the only thing that *should* be uniform. **No finding here pushes toward
visual homogenization.** Every backlog item is tagged `[shared-layer]` (apply to
all lenses, invisibly) or `[per-app]` (one lens, in its own idiom).

---

## 1. Research rubrics (the yardstick)

### UX (sources: nngroup.com, w3.org/WAI/WCAG22)
- **Nielsen's 10 heuristics** (NN/g, updated 2024): visibility of system status;
  match to the real world; user control/undo; consistency; error prevention;
  recognition over recall; flexibility/shortcuts; aesthetic-minimalist; help users
  recover from errors; help & docs.
- **Empty states in complex apps** (NN/g): educate + give a first-action CTA — an
  empty screen should teach and invite, never read as broken.
- **Progressive disclosure** (NN/g): show the few most-important options first;
  ≤2 disclosure levels.
- **Command palette ⌘K**: a standard expectation once a product has >10 features.
- **WCAG 2.2 AA blockers**: target size (2.5.8, ≥24px), focus appearance (2.4.13),
  focus not obscured (2.4.11), contrast 4.5:1 text.

### UI (sources: m3.material.io, Refactoring UI, Linear/Vercel/Stripe commentary)
- **Dark mode**: not pure black (#000) — near-black surfaces, elevation via
  *lightness*, not just borders (Material 3 tonal surfaces).
- **Restraint**: one accent + two neutral text colors; ≤4 type levels / single
  family; **a 1px border at ~8% opacity beats drop shadows** (Linear/Vercel).
- **Spacing**: an 8pt scale; generous whitespace reads premium.
- **Motion**: purposeful, ≤300ms, with `prefers-reduced-motion`.
- **Data-ink**: no chartjunk; the right chart for the data.

---

## 2. What's already strong (keep — do not "fix")

Verified in the live screenshots and the shared-layer code:

- **Rival-shape commitment is HIGH and genuine** — 100–250 LOC of real layout per
  silhouette, not cosmetic wrappers around generic cards. This is the product's
  signature and its biggest UX asset.
- **`LensShell`** gives *every* lens, invisibly: an error boundary (a render bug
  degrades gracefully instead of white-screening), accessibility data-attrs
  (reduced-motion / high-contrast / colorblind / text-scale), a `<main>` landmark,
  and a skip-to-content target.
- **Natural-language "Ask about X" bars with suggestion chips** (accounting,
  message, atlas, healthcare) — a genuinely modern, on-trend pattern. (It's also
  the seed of the ConKay direction.)
- **Honest degradation** — "Simulated" / "Demo" badges, crypto's "Live prices
  unavailable (CoinGecko didn't respond) — holdings still reflect your real cost
  basis." This is exemplary status-visibility.
- **Per-lens "quick tour" coachmarks** — contextual onboarding per app.
- **Design tokens**: near-black surfaces (`--lattice-void #0a0a0f`, not pure
  black) ✓, an 8pt `--space-*` scale ✓, a constrained neon accent set.

---

## 3. Per-app identity scorecard (verified lenses)

Grade = fidelity to its OWN rival app + UX quality *in that app's idiom*. Notes are
lens-specific (`[per-app]`), never "make it look like the others."

| Lens | Rival app | Grade | Lens-specific notes |
|---|---|---|---|
| **code** | VS Code / IDE | **A** | Activity bar, file tree, tabs, status bar, verb bar (Execute/Lint/Format/Refactor/Diff/Review). Reads as an IDE instantly. Empty tree state is fine ("No projects"). |
| **accounting** | QuickBooks | **A** | Real Books sidebar (Sales/Expenses/Reports), KPI strip, NL "ask your books" + chips. Exemplary. |
| **crypto** | Coinbase / Phantom | **A** | Portfolio hero, Send/Receive/Swap, holdings, **honest** live-price degradation. |
| **finance** | Robinhood / Monarch | **A** | Net-worth hero, time-range chips, Trade/Transfer/Budget, holdings + watchlist, sparklines. |
| **healthcare** | Epic EHR | **A** | Clinical sidebar, KPI strip, NL chart search + clinical chips, Demo badge. |
| **whiteboard** | tldraw / Miro | **A-** | Canvas, floating tool toolbar, zoom controls, AI cluster panel. Good empty CTA ("No boards yet. Create one"). Canvas could show a faint grid/ghost when empty. |
| **message** | Slack / Gmail | **A-** | Icon rail, channel list, search-across + chips, verb bar. `[per-app]`: the left **icon rail has no tooltips/labels** — discoverability gap. |
| **music** | Spotify/Apple + DAW | **A-** | Library, playlists, stat row, bottom toolbar, Session (DAW) view. `[per-app]`: **triple navigation** (top tabs + bottom toolbar + KPI cards) is heavy; the all-zero stat row + flat "No tracks." is a weak first-run. |
| **atlas** | OpenStreetMap | **B+** | Real map shell, tool rail, saved-places, geocoding. Map tiles need network egress (not a code defect). `[per-app]`: icon rail needs tooltips. |
| **social** | X / Instagram | **B** | Stories, composer, feed tabs, trending. `[per-app]`: **(1)** right rail shows *"Profile Not Found — this user does not exist or their profile is private"* to a brand-new user — an **error-as-empty-state** that reads as a bug; should be "Set up your profile." **(2)** two composers (story box + feed box) is redundant. |
| **marketplace** | Bandcamp | **A-** | (per survey) `BandcampGrid` silhouette committed; verify empty/loading states. |

---

## 4. Cross-cutting findings — the INVISIBLE shared layer (fix everywhere, never touching per-app identity)

These are the *only* things that should be uniform. Each lens keeps its own look;
these improve the substrate underneath all of them.

1. **`[shared-layer]` Empty states are inconsistent, and some are error-as-empty.**
   Worst: social's "Profile Not Found" for a new user. Common: flat one-liners
   ("No tracks.") with no CTA; some Tier-3 lenses render blank. → Standardize on the
   existing **`EmptyStateCTA`** (manifest-derived "Create your first {artifact}"),
   **tinted with each lens's own accent** so it still fits that app. *(Per NN/g:
   educate + CTA.)*

2. **`[shared-layer]` Loading states are mostly absent** — content pops in; no
   skeletons. → A shared **`Skeleton`** primitive, **shaped per lens** (a wallet
   skeleton ≠ a ledger table skeleton ≠ a clip-grid skeleton) so perceived
   performance improves without flattening identity. *(Visibility of system status.)*

3. **`[shared-layer]` Error states fall back to raw strings or silent console
   logs.** `ErrorState` and `AdminRequiredState` + `isForbidden()` already exist in
   `components/common/EmptyState.tsx` + `lib/api/client.ts` but are under-used. →
   Route lens load-errors through `ErrorState`; admin-gated lenses through
   `AdminRequiredState`. *(Help users recover from errors.)*

4. **`[shared-layer]` Keyboard & focus.** Only ~30% of lenses bind keys via
   `useLensCommand`; modal focus-trap and Esc-to-close are inconsistent (the per-lens
   coachmark didn't dismiss on Esc in testing). → Focus-trap + Esc-close in the
   shared modal/overlay; widen `useLensCommand` coverage. *(WCAG 2.2 focus;
   flexibility/shortcuts.)*

5. **`[shared-layer]` Icon-only navigation tooltips** — **PARTLY DONE (verified in
   code):** `AtlasShell.tsx:48` already sets `title={n.label}` on its rail icons, so
   atlas has tooltips + an accessible name. Remaining: audit the message lens's
   icon strip and any other icon-only rails for the same `title`/`aria-label`
   treatment. *(Recognition over recall; WCAG name/role/value.)*

6. **`[shared-layer]` WCAG 2.2 AA pass.** **A visible `:focus-visible` ring already
   exists** (`globals.css:711-718`, plus a high-contrast override at `:845`) — so
   that sub-item is DONE; don't re-add it. Remaining: verify neon-on-near-black
   accents clear 4.5:1 (the brightest neons on `#0a0a0f` are borderline for small
   text); ensure interactive targets ≥24px; add `role="grid"`/`aria-sort` to data
   tables (accounting ledger, finance holdings).

   > **Audit discipline note:** items 5 and 6 were each found *partly already
   > implemented* when checked against code. Verify every backlog item against the
   > source before building it — a blind sweep would duplicate existing work.

7. **`[per-app, case-by-case]` Redundant navigation/controls** — music's triple-nav,
   social's two composers. Flag per lens; **do not** force-merge, since some rival
   apps legitimately have multiple zones. Each owner decides within their app idiom.

---

## 5. Prioritized backlog

Ordered by impact × reach. Tags: `[shared-layer]` = one fix lifts all 259 lenses
invisibly; `[per-app]` = one lens, in its own idiom.

### P0 — correctness / "reads as broken"
- `[per-app]` **social**: replace the "Profile Not Found" error-as-empty with a
  "Complete your profile" CTA for users without a profile yet.
- `[shared-layer]` Adopt **`EmptyStateCTA`** as the default zero-data state across
  lenses that currently render flat text or blank (accent-tinted per lens).
- `[shared-layer]` Route all lens **load errors** through `ErrorState` /
  `AdminRequiredState` (kill raw-string and silent-fail paths).

### P1 — feedback & accessibility
- `[shared-layer]` Shared **`Skeleton`** primitive + per-lens skeleton shapes for the
  data-heavy lenses (accounting, finance, healthcare, music, crypto, message).
- `[shared-layer]` **Focus management**: focus-trap + Esc-close in the shared
  modal/coachmark; `:focus-visible` ring token in `globals.css`.
- `[shared-layer]` **Tooltips** on icon-only nav (message, atlas, any lens with an
  unlabeled rail).
- `[shared-layer]` **WCAG contrast** sweep on neon-on-dark small text; table aria
  (`role=grid`/`aria-sort`).

### P2 — polish & per-app refinement
- `[per-app]` **music**: reconcile the triple-nav (top tabs vs bottom toolbar vs KPI
  cards) within the Spotify/DAW idiom; richer first-run than the all-zero stat row.
- `[per-app]` **whiteboard**: faint grid/ghost shapes on the empty canvas.
- `[per-app]` **atlas**: offline/no-tiles affordance (a "map tiles unavailable"
  state mirroring crypto's honest degradation).
- `[shared-layer]` Widen `useLensCommand` keyboard coverage toward the ~Linear bar
  (every primary action reachable by key) — per lens, in that app's verbs.

---

## 6. Method & reproduction

- **Real screenshots**: boot backend (`:5050`), register a user, drive Playwright
  (cached Chromium) through the real `/api/auth/login` so the session cookie is set,
  then navigate each `/lenses/<id>`. (Mocking `/api/**` only yields the login page —
  the app refuses unauthenticated/bot access by design.)
- **Shared-layer survey**: `components/lens/LensShell.tsx`,
  `components/common/EmptyState.tsx`, `app/globals.css` tokens, `hooks/useLensCommand.ts`,
  and the rival-shape silhouettes (`code/VSCodeShell`, `crypto/WalletShell`,
  `accounting/KPIStrip`, `music/SessionView`, `healthcare/EHRShell`, …).
- This audit is **findings only** — no lens code was changed in this pass (per the
  "don't build and audit at the same time" rule). The P0/P1/P2 backlog is the
  hand-off; building it is the follow-up.
