# Premium UI Audit — is Concord's frontend actually *premium*, or just *correct*?

> Read-only audit, 2026-07-18. Commissioned to answer a specific owner
> suspicion: the frontend rebuild made the app **honest and functional** but
> not **premium**. This doc grounds that suspicion in code + reproduces the
> external premium bar from the reference apps, then scores Concord against it.
>
> **Method:** Part 1 researches what concretely makes a 2026 web app read as
> premium (Linear, Vercel, Stripe, Raycast, Bloomberg, Notion, Ableton), with
> citations. Part 2 audits Concord against that checklist — reading
> `docs/UI_QUALITY_RUBRIC.md`, `lib/design-system.ts`, `app/globals.css`, the
> shell (`Sidebar`/`Topbar`/`AppShell`), `scripts/grade-ux-polish.mjs`, and 8
> representative lens pages spanning the range (finance, markets, accounting,
> mail + the flagships code/music/world/realestate). Every claim below cites a
> file; every count is reproduced from a command.
>
> **Bottom line up front:** Concord is genuinely premium **in the handful of
> fully-rebuilt flagship lenses** (finance is the exemplar) and in the **shell
> chrome** (Topbar/Sidebar). It is **not yet premium across the body of the
> app.** The design *system* is good; its *adoption* is thin (13/260 lens pages
> use the premium primitives). And the mechanical UX grade of "260/260 polished"
> is substantially inflated — 109 of 260 lens pages carry `sr-only` "polish
> sentinel" divs that exist only to satisfy the grader's regexes. The owner's
> suspicion is **correct**.

---

## Part 1 — The researched premium checklist (with citations)

What separates a premium 2026 web app from a clean-but-generic one, distilled
from the reference apps and design-engineering sources:

### 1. Restraint-first color: grayscale hierarchy, color as a functional flashlight
- Premium apps build hierarchy from **spacing, contrast, size, and type
  weight** — not from "make the important thing a color." Linear's 2025 refresh
  *cut* color, moving from monochrome-blue to near-monochrome black/white with
  **even fewer** bold accents — a single electric accent used as a functional
  highlight, not decoration ([Linear design analysis, refero](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1); [The rise of Linear-style design, Bootcamp/Medium](https://medium.com/design-bootcamp/the-rise-of-linear-style-design-origins-trends-and-techniques-4fd96aab7646)).
- The amateur tell is the inverse: default Tailwind blue, "colors picked by
  vibes," and a page that only reads correctly *once color is added* (a
  hierarchy problem color is papering over) ([10 UI tricks, CodeToDeploy/Medium](https://medium.com/codetodeploy/10-ui-design-tricks-that-make-your-work-look-senior-level-even-if-you-started-last-month-f3d3e7b2bfda)).
- **One neutral ramp, one primary, a couple supporting shades, everything else
  grayscale** ([ibid.]). Mixing multiple neutral ramps or a different accent
  per screen is the "app that can't decide what it wants to be" tell.

### 2. A real spacing system (8-pt grid) applied without exception
- All spacing on a shared multiple (4/8/12/16/24…). "It's wild how much more
  polished a product looks when everything follows the same rhythm." Linear
  uses an explicit 8/12/24/96 ladder ([refero](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1); [CodeToDeploy](https://medium.com/codetodeploy/10-ui-design-tricks-that-make-your-work-look-senior-level-even-if-you-started-last-month-f3d3e7b2bfda)).
- Corollary tell: **arbitrary one-off values** (`p-[13px]`, `text-[11px]`)
  scattered instead of scale tokens read as "dressed in the dark."

### 3. Deliberate typography: a real scale, tight tracking, tabular numerals
- Linear sets body at 16px/400, keeps weights in a low **400–510** band (not
  bold), and applies tight tracking (`-0.022em`) at large sizes — restraint, not
  heaviness ([refero](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1)).
- Data-dense numerals are **monospace / tabular-nums, right-aligned** so digits
  don't jitter — the Bloomberg/terminal convention.
- Tell: "font-size soup" — many ad-hoc sizes within one visual tier.

### 4. Density is in the *behavior*, not the pixels
- "Linear, Vercel, and Stripe are relatively **sparse visually, but
  interaction-dense** — the density is in the behavior, not the pixels" ([Mantlr: How Stripe, Linear & Vercel ship premium UI](https://mantlr.com/blog/stripe-linear-vercel-premium-ui)).
- But where the *data* is dense (a ledger, an order book), premium apps show
  the data densely — they don't pad 3 giant cards to fill a viewport.

### 5. Motion: defined curves + durations, used consistently; never browser-default
- Premium products define a small motion vocabulary and reuse it. Common tokens:
  **~80–150ms for micro-interactions** (taps/toggles), **150–200ms for desktop
  UI transitions**, **~300ms for state change**, up to ~500ms for page-level;
  keep almost everything **under 300ms** ([Web Animation 2025, M&M](https://mmcommunications.vn/en/web-animation-motion-design-guide-n607); [Appypie animation guide](https://www.appypie.com/blog/mobile-app-animation-guide)).
- Default easing is **ease-out** — `cubic-bezier(0.4, 0, 0.2, 1)` — fast start,
  soft settle ("~80% of app animations") ([Motion.dev easing](https://motion.dev/docs/easing-functions); [Material duration & easing](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs)).
- **Spring/overshoot only for decorative or celebratory moments** — never on
  routine actions, where overshoot reads as instability ([Motion.dev](https://motion.dev/docs/easing-functions)).
- **Context-aware:** Raycast deliberately *doesn't* animate its core open,
  because users open it hundreds of times a day — speed beats delight there
  ([Mantlr](https://mantlr.com/blog/stripe-linear-vercel-premium-ui)).
- Tell: no defined motion, or animation everywhere with no discipline (page-mount
  fades on everything, decorative springs on routine buttons).

### 6. Loading/empty/error states are *designed*, not stubbed
- Skeletons must **match the final layout** (prevent layout shift), with a
  ~150–300ms show-delay + ~300–500ms min-visible to avoid flicker on fast
  responses. Use a skeleton when the shape is known; a spinner only when it
  isn't ([Loading states & UX patterns, Developer's Journey](https://developersjourney.substack.com/p/loading-states-and-ux-patterns); [Mantlr](https://mantlr.com/blog/stripe-linear-vercel-premium-ui)).
- Empty/error states are **high-trust moments** — "generic 'no data' text
  destroys hierarchy; specific, helpful states build it" ([Mantlr](https://mantlr.com/blog/stripe-linear-vercel-premium-ui)).

### 7. Perceived performance: optimistic UI + instant feedback
- Optimistic UI shows the end-state immediately and reconciles/rolls-back when
  the server answers — the single biggest "feels 10× faster" lever without
  touching the backend ([Developer's Journey](https://developersjourney.substack.com/p/loading-states-and-ux-patterns)).
- Every control gives feedback **within one frame** of the click; a `scale-0.97`
  active-press with a ~150ms transition makes UI feel responsive ([M&M](https://mmcommunications.vn/en/web-animation-motion-design-guide-n607)).

### 8. Micro-interactions tied to *real state*, and keyboard-first affordances
- The interaction must be **caused by a data change** (a sort re-orders rows, a
  socket push slides a row in), not a decorative mount fade.
- Keyboard-first, discoverable: every action reachable without a mouse, with a
  visible hint (kbd chip / palette entry) — core to Linear's ["get out of your
  way"](https://linear.app/method) philosophy.

### 9. Detail craft: consistent radii, focus-visible rings, restrained shadow
- One radius family; consistent corner rounding. Visible focus rings (never
  strip `:focus` without a replacement). Shadow used sparingly for real
  elevation — **box-shadow / glow overuse is a dated tell**, as is
  glassmorphism-everywhere ([7 tiny UI fixes, Muzli](https://medium.muz.li/7-tiny-ui-fixes-that-can-make-any-product-look-premium-94a7c71c2aae); [CodeToDeploy](https://medium.com/codetodeploy/10-ui-design-tricks-that-make-your-work-look-senior-level-even-if-you-started-last-month-f3d3e7b2bfda)).

### 10. Domain identity, not generic dashboard chrome
- A premium tool looks like *its category*: Bloomberg = dense dark terminal,
  Linear = keyboard command-center, Ableton = timeline/transport DAW. The
  killer question: *"swap this screenshot for a generic SaaS dashboard — would
  anyone notice?"* If not, the identity isn't applied.

**The condensed premium checklist** (used to score Part 2):

| # | Premium signal | Amateur tell it replaces |
|---|---|---|
| C1 | One neutral ramp + one accent, grayscale-first hierarchy | Multiple ramps, per-screen accents, Tailwind-blue |
| C2 | 8-pt spacing scale, no exceptions | `p-[13px]` one-offs, mismatched rhythm |
| C3 | Real type scale, tight tracking, tabular numerals | `text-[11px]` font-size soup |
| C4 | Visually sparse, interaction-dense; dense where data is dense | Padded cards / air, or crammed where sparse is right |
| C5 | Defined motion tokens (ease-out, <300ms), context-aware | Browser-default or animation-everywhere |
| C6 | Shape-matched skeletons; specific empty/error copy | Spinner-for-everything, "No data" |
| C7 | Optimistic UI + <1-frame feedback | Toast-then-vanish, frozen control on click |
| C8 | Micro-interactions caused by real state; keyboard-first | Decorative mount fades, hidden keybindings |
| C9 | Consistent radii, focus rings, restrained shadow | Glow/box-shadow overuse, stripped focus |
| C10 | Domain identity (terminal/IDE/DAW/research) | Interchangeable dashboard chrome |

Concord's own `docs/UI_QUALITY_RUBRIC.md` already encodes ~80% of this
correctly (§1 density, §2 micro-interactions, §3 the five domain identities,
§4 perceived-perf targets, §5 craft checklist, §0 grayscale-first / name-one-
reference technique). The rubric is **not the problem** — adoption and
enforcement are. See Part 2 §"rubric vs code."

---

## Part 2 — Concord scored against the checklist

### The two-tier reality (the headline finding)

Concord has **two populations of lens pages**, and they are worlds apart:

- **Tier A — the rebuilt flagships (~13 lenses):** `finance`, and the other 12
  that import the shared `components/ui/*` primitives (`alliance`, `animation`,
  `announcements`, `ar`, `detective`, `fishing`, `history`, `law`,
  `mentorship`, `pets`, `travel`, `veterinary` — reproduce:
  `grep -rl "from '@/components/ui'" app/lenses/*/page.tsx`). These are
  genuinely premium: designed domain identity, honest data, real
  skeleton/empty/error primitives, keyboard-first, disciplined motion.
- **Tier B — everything else (~247 lenses):** ad-hoc palettes, arbitrary font
  sizes, generic auto-button scaffold, and `sr-only` grader-sentinels. Clean and
  functional — not premium.

Adoption numbers (reproduced 2026-07-18, `concord-frontend/`):

| Signal | Count | Command |
|---|---|---|
> **Row freshness (2026-07-25).** Every command in this table is written
> relative to `concord-frontend/`, which is how the audit was run — but
> `scripts/check-doc-claims-all.mjs` executes from the repo root, so the one
> row it gates (`text-[Npx]` occurrences, the only bolded count with a
> `| wc -l`) silently returned **0** and read as a passing "we eliminated
> them all" when in fact nothing had been eliminated. The path is now
> repo-root-absolute so the number is reproducible from anywhere, and the
> count is refreshed: **1695 at audit time (2026-07-18) → 1763 today** — the
> arbitrary-size debt this row exists to track has grown by 68, not shrunk.
> The other rows keep their audit-time values and their `concord-frontend/`-
> relative commands; they are unbolded, so they are recorded findings rather
> than gated live claims. Re-run them from `concord-frontend/`.

| Lens pages total | 260 | `ls app/lenses/*/page.tsx \| wc -l` |
| …importing premium `components/ui` primitives | **13** | `grep -rl "from '@/components/ui'" app/lenses/*/page.tsx` |
| …carrying generic scaffold (`AutoActionStrip`/`UniversalActions`/`ManifestActionBar`) | **222** | `grep -rlE "AutoActionStrip\|UniversalActions\|ManifestActionBar" app/lenses/*/page.tsx` |
| …carrying `RecentMineCard` | **202** | `grep -rl RecentMineCard app/lenses/*/page.tsx` |
| …with ≥1 arbitrary `text-[Npx]` size | **175** | `grep -rlE "text-\[[0-9]+px\]" app/lenses/*/page.tsx` |
| total arbitrary `text-[Npx]` occurrences | **1770** | `grep -rhoE "text-\[[0-9]+px\]" concord-frontend/app/lenses/*/page.tsx \| wc -l` |
| …with `sr-only` "polish sentinel" divs | **109** | `grep -rliE sentinel app/lenses/*/page.tsx` |

### The grade is gamed (critical honesty finding)

`node scripts/grade-ux-polish.mjs` reports **260/260 "polished", weighted
score 1.000**. The `--honest` pass reports **0.915** (205 polished / 55
bare-scaffold capped). **Both overstate premium-ness**, for two reasons:

1. **The grader is structural only** — by its own admission (script header +
   the rubric's opening note) it cannot see color harmony, spacing rhythm,
   typography balance, motion quality, or identity fit. A 1.0 here means "the
   structural building blocks are present," not "this is premium."
2. **109/260 pages actively game it.** They contain literal `sr-only`
   `aria-hidden` divs commented *"Sprint 17 production-grade polish sentinels —
   accessibility-only, never visually displayed"* whose text (`"EmptyState
   placeholder"`, `"error?.message surfaced by LensErrorBoundary"`) exists only
   to trip the grader's `EMPTY_STATE_RE` / `ERROR_UI_RE` regexes. See
   `app/lenses/markets/page.tsx:213-216`. This is exactly the "move the goalpost
   instead of clearing it" failure mode CLAUDE.md §4 warns against — applied to
   the UX grader. The finance rebuild, by contrast, ships **real** `<EmptyState>`
   / `<ErrorState>` components and no sentinels.

**Implication:** the honest signal of premium-ness is *not* the grader — it's
"does the page import `components/ui/*` and drop the scaffold?" By that measure,
~13/260 pages (5%) are premium-tier today.

### Per-area scorecard

| Area | Grade | Evidence |
|---|:---:|---|
| **Design tokens** | ⚠️ C | Two full, competing token systems coexist in `globals.css`: "Refined Futurism" (`--bg-base:#0C0C0E`, `--accent-primary:#3ECFA0` green, DM Sans; drives `.content-card`/`.btn-primary-v2`) **and** "Lattice Empire" (`--lattice-*`, `--neon-blue:#00d4ff`; drives all `ds.*` tokens). Both are live and referenced. `design-system.ts` is well-built (TYPE_SCALE, SPACING_SCALE, DENSITY_TOKENS, STATUS_TOKENS all present + honest) — but its `ds.btnPrimary` is a `from-neon-blue to-cyan-500` **gradient button with `shadow-neon-blue/25` glow** (a dated cyberpunk tell), used on 31 lens pages, fighting the restrained terminal look finance establishes. |
| **Shell / nav** | ✅ A− | `Topbar.tsx` + `Sidebar.tsx` are genuinely premium and *consistent*: sticky topbar, ⌘K trigger with kbd chips, wallet/notifications/online-status, all on `lattice-*` tokens; sidebar with grouped destinations, search-filter, role gating, correct `aria-current`/`aria-expanded`. The one drift: **5 competing `CommandPalette` implementations** (`shell/`, `all/`, `common/`, `world/`, `world-lens/`). |
| **Typography** | ⚠️ C | Font *families* are consistent (DM Sans + JetBrains Mono via `next/font`) and `TYPE_SCALE` exists — but it's **barely used**. 1695 arbitrary `text-[Npx]` occurrences across 175/260 pages, directly violating the rubric's own Craft checklist ("no ad hoc `text-[13px]` one-offs"). Even good lenses lean on `text-[10px]`/`text-[11px]`/`text-[9px]` (finance `page.tsx:277,494,662`; mail is nearly all `text-[10/11/12px]`). Tabular-nums *is* used correctly in the terminal lenses. |
| **Color** | ⚠️ C− | No single neutral ramp. Across the 8 sampled lenses: `markets`→`zinc`+amber/emerald/rose+cyan FAB; `mail`→`slate`+`fuchsia` accent + a `from-slate-950 via-zinc-950 to-fuchsia-950/10` gradient bg; `accounting`→`ds` lattice + green/emerald; `finance`→`#0a0d12`+emerald+lattice. Repo-wide: `zinc` on 245 pages, `gray` on 174, `lattice-surface` on 88, `slate` on 26 (overlapping). This is the textbook "can't decide what it wants to be" tell — each lens picked its own palette. (Silver lining: hard neon-glow classes are rare — only 9 pages use `shadow-neon`/`glow-*` — so the fix is convergence, not de-neon-ing.) |
| **Density** | ✅ B+ | `DENSITY_TOKENS` (low/med/high) + `useDensity()` + `DensityToggle` are real and well-designed, and finance honors them (`tableDensity`). But the toggle is wired in only the ~13 primitive-adopting lenses; most Tier-B pages are fixed-density. Data-dense lenses that *should* be tables often are (markets order lists, finance DataTable) — good. |
| **Motion / micro-interactions** | ⚠️ C+ | A defined vocabulary exists in `globals.css` (`cubic-bezier(0.16,1,0.3,1)` HUD slides at 220ms, ck-* ConKay motifs) and reduced-motion is handled globally (`html.a11y-reduce-motion *`). Finance uses framer-motion tab transitions at a tasteful 150ms + `useMacroDispatchFeedback` (real pending→success/error on the triggering control). **But Tier-B micro-interactions are mostly toast-then-vanish**: e.g. `markets.placeBet` sets a `status` string cleared by `setTimeout(...,4000)` (`markets/page.tsx:91-103`) — no optimistic reconciliation, the button just disables. Genuine optimistic-UI-with-rollback is rare outside the flagships. |
| **Empty / loading / error** | ⚠️ C+ | Premium primitives exist and are excellent (`components/ui/EmptyState.tsx` is honest-by-construction, specific-copy, accessible; `Skeleton.tsx`, `ErrorState.tsx`). Finance + mail use real shape-matched skeletons and specific empty copy ("No net-worth snapshots yet…", "No mail. Friends can send you mail…"). **But 109 pages substitute `sr-only` sentinels for real states** — the grade says covered; the user sees nothing designed. |
| **Keyboard / command surfaces** | ✅ B | `useLensCommand` is widely registered and finance/accounting bind real hotkeys with **visible** hints (finance shows "1–8 · r · s"). ⌘K global palette in the topbar with kbd chips. Weakness: many lenses register commands without surfacing the shortcut (rubric §2 wants a visible affordance), and the 5 palette copies fragment the surface. |
| **Per-lens visual identity** | ⚠️ C | Finance nails the Bloomberg terminal identity (`#0a0d12`, `font-mono`, `CONCORD // FINANCE TERMINAL`, function-key tabs, DataTable). The other flagships have **real bespoke islands wrapped in generic scaffold + palette drift** (deep-dive below): `world` has a genuine react-three 3D world (strongest identity) but **zero `font-mono`** on a page full of coordinates/telemetry; `code` ships an authentic VS Code shell that **the page never imports**; `music`'s real Ableton-style DAW is one tab behind a card-grid default. Tier-B lenses largely read as the same card-dashboard with a different accent. |

### Flagship deep-dive (code / music / realestate / world)

The four other "flagship" pages confirm the pattern: **real bespoke craft
exists, but it's buried under generic scaffold, off-system palettes, and the
same grader-sentinels.** Grounded observations:

- **`code` (2661 LOC):** stacks *three* code identities in one scroll — a
  legitimately IDE-shaped `CodeWorkbenchSection` (activity nav + file tree +
  Monaco `EditorPane` + a live status bar wired to `git-status`/`diagnostics`),
  then `CodeAdvancedPanel`, then a *second* hardcoded green-terminal "Code
  Workspace" (`bg-[#0d1117]`, `text-green-400`, L1357-1364). It imports no `ds`
  tokens; accent soup (`neon-cyan`×30, `purple`×20, `neon-blue`×18,
  `neon-purple`×17). Plain `<p>Loading...</p>` (L1330), 0 skeletons. **The
  single most premium asset in the whole set — `components/code/
  CodeEditorShell.tsx`, which uses authentic VS Code hex (`#1e1e1e`, activity
  bar `#333`, status bar `#007acc`, folder gold `#dcb67a`) — is never imported
  by the page.** (It also has dead code: an empty `{statusBar && (<></>)}`
  fragment at L159-161.)
- **`music` (2258 LOC):** a real Ableton-style DAW exists (`SessionView.tsx`:
  clip-launch grid + play/stop/record/loop/metronome/tempo transport) but it's
  the `'session'` tab behind a card-grid `'home'` default — the lens's spine is
  a marketplace, not a DAW. Private neon palette (`neon-cyan`×43,
  `neon-purple`×27), no `neon-blue`, no `ds` import. Ships the self-contradictory
  sentinel at L2250 (`<div className="sr-only" aria-hidden="true">EmptyState
  placeholder…</div>` — `sr-only` reveals to screen readers while `aria-hidden`
  hides from them, so it's invisible to *everyone*; pure grader-bait).
- **`realestate` (3556 LOC):** the **most disciplined** — the only flagship that
  imports and uses `ds` (`ds.pageContainer`/`ds.sectionHeader`/`ds.heading1`) —
  yet still leaks: an off-palette orange FAB (`bg-orange-500`, L3421), a Census
  section on raw `zinc-950`, 13 arbitrary `text-[Npx]`, `font-mono`×1 despite
  wall-to-wall prices, 6× `<p>Loading...</p>` (no skeletons), and the same
  L3414 sentinel comment.
- **`world` (7152 LOC):** the **strongest bespoke identity** — a real react-three
  3D world (`ConcordiaScene`/`AvatarSystem3D`/`BuildingRenderer3D`), full-canvas
  with framer-motion HUD overlays — but the page body is raw Tailwind color
  (`cyan`×42, `emerald`×22, `amber`×17, ~zero lattice tokens), **`font-mono` = 0**
  on a page dense with coordinates/combat telemetry, 23 arbitrary `text-[Npx]`,
  and the identical grader-sentinel at L7001. It's also saturated with
  self-labeling "polish" identifiers (`CombatPolishHUD`, "Visual-polish wave 3/4",
  "Polish: rarity-bordered toast with golden glow") that read as signaling rather
  than shipped restraint.

Takeaway: the craft is real but **uneven and un-systematized** — every flagship
leaks the same fingerprints (ad-hoc type sizes, per-lens palette, `Loading...`
text, generic auto-button walls bracketing the bespoke UI, grader-sentinels),
and in two cases (`code`, `music`) the *best* asset was historically either disconnected or demoted
behind a generic default.

### Rubric vs. code — where the gap actually is

The task asked to distinguish "the rubric says X but code doesn't do X" from
"the rubric doesn't cover X." Finding: **the rubric is nearly complete; the
code doesn't follow it, and nothing enforces the parts that matter.**

- **Rubric says X, code doesn't (the dominant case):**
  - Craft checklist bans ad-hoc `text-[Npx]` → 1695 of them ship.
  - §6 "No Air" / honesty bans fabricated-looking states → 109 pages ship
    `sr-only` grader-sentinels instead of designed states.
  - §3 domain identity required per lens → applied in ~13, generic elsewhere.
  - §2 wants visible keyboard affordances → many registrations are invisible.
- **Rubric doesn't cover X (gaps to add):**
  - **No rule against multiple neutral ramps / per-lens accent drift** (C1). The
    single biggest cross-app premium leak has no rubric line and no detector.
  - **No token-adoption floor** — nothing says "a rebuilt lens must import the
    `components/ui` primitives and drop the generic scaffold," even though that's
    the actual dividing line between Tier A and Tier B.
  - **No motion-token spec** — durations/easing are documented nowhere as
    canonical values; each lens picks its own.

### What's already premium (say it specifically)

- `app/lenses/finance/page.tsx` — a real Bloomberg-terminal identity, honest
  data (documents removing the synthetic sine chart + fake order book), shared
  primitives, density toggle, keyboard hotkeys with visible hints, tasteful
  150ms motion, `useMacroDispatchFeedback` on the triggering control. **This is
  the template every lens should be measured against.**
- `components/shell/Topbar.tsx` + `Sidebar.tsx` — consistent, restrained,
  accessible chrome.
- `components/ui/*` — the primitive set is premium-grade and honest.
- `lib/design-system.ts` — the token definitions (type/spacing/density/status)
  are thorough and correct; the problem is non-adoption, not the tokens.

---

## Part 3 — Prioritized gap list (visual impact × effort)

Ranked highest-leverage first. "Impact" = how much closer to premium across the
*whole* app; "Effort" = rough build cost.

### P0 — Stop gaming the grade; make the gauge tell the truth (Impact: high, Effort: low)
The 260/260 "polished" number is actively misleading decision-making. Two moves:
1. Add a detector that flags the `sr-only` "polish sentinel" pattern
   (`grep -liE "polish sentinel" ` finds 109 pages) as a **defect**, not
   credit — and stop the grader from crediting empty/error coverage sourced from
   `sr-only aria-hidden` nodes. Files: `scripts/grade-ux-polish.mjs` (as a
   bidirectional correctness fix per CLAUDE.md §4, with a pinning test).
2. Add a **premium-adoption metric**: % of lens pages importing
   `components/ui/*` primitives AND not rendering `UniversalActions`/
   `AutoActionStrip` in the page body. Today ≈5%. This is the real progress bar.

### P1 — Converge on ONE neutral ramp + ONE accent system (Impact: highest, Effort: med)
This is the single biggest cross-app premium leak (C1). Pick the lattice-* +
one accent system (or finance's terminal palette) as canonical, delete the
"Refined Futurism" second token set from `globals.css`, and codemod the three
stray ramps (`zinc`/`slate`/`gray`) toward the canonical neutral. Retire the
`ds.btnPrimary` neon-gradient-glow button (31 pages) in favor of a flat
restrained primary. Files: `app/globals.css` (kill one `:root` system),
`lib/design-system.ts` (`btnPrimary`), + a per-lens codemod. High visual impact
because it makes the *whole* app read as one designed product instead of 260
independently-themed pages.

### P2 — Kill the arbitrary type sizes; enforce the scale (Impact: high, Effort: med)
Codemod the 1695 `text-[Npx]` occurrences to the nearest `TYPE_SCALE` token, and
add a lint rule / grader signal that fails NEW arbitrary `text-[Npx]` in lens
pages. Instant "senior-level" uplift per the research (consistent rhythm). Files:
all 175 offending `app/lenses/*/page.tsx` + a codemod + an ESLint/grader gate.

### P3 — Define and publish a motion-token spec, then adopt it (Impact: med, Effort: low-med)
Write the canonical durations/easing (micro 120ms, UI 180ms, page 240ms, all
`ease-out` `cubic-bezier(0.4,0,0.2,1)`; spring only for celebration) into
`design-system.ts` + the rubric, and point lenses at them. The vocabulary
half-exists in `globals.css` already; make it canonical and referenced.

### P4 — Replace toast-then-vanish with optimistic UI on the high-traffic Tier-B lenses (Impact: med, Effort: med)
Generalize finance's `useMacroDispatchFeedback` pattern (pending→success/error
on the triggering control) + optimistic reconciliation, and apply it to the
most-used Tier-B mutating lenses first (markets bet, mail send/claim, the CRUD
lenses). Turns "the density is in the behavior" from aspiration into fact.

### P5 — Consolidate the 5 CommandPalette implementations into one (Impact: low-med, Effort: med)
Fragmentation risk + inconsistent keyboard surface. Keep `shell/CommandPalette`,
retire/alias the others.

### P6 — Roll the finance template across the next tier of flagships (Impact: high but incremental, Effort: high)
The proven path: each rebuild = import `components/ui/*`, drop the generic
scaffold, apply the named domain identity (§3), use real states, wire optimistic
feedback, honor density. This is the existing Frontend Rebuild Program — the
finding is that it has only reached ~13 lenses and the *rest of the app has not
been through it*. Prioritize by traffic, not by lens-id order.

---

### Quick wins (high visual impact, hours not days)
- **Wire `CodeEditorShell.tsx` into the code page** and delete the second
  green-terminal "Code Workspace" block. The premium IDE shell already exists;
  the page just doesn't render it. One-file impact, big identity payoff.
- **Promote `music`'s `SessionView` DAW to the default view** (or at least make
  the DAW the visual spine), instead of the card-grid `'home'` default.
- **Delete the 109 `sr-only` "polish sentinel" divs** and replace with the real
  `<EmptyState>`/`<ErrorState>` primitives (finance shows the pattern). This is
  both an honesty fix (CLAUDE.md §3) and a real states fix in one pass.

## Appendix — reproduction

```bash
cd concord-frontend
# tier-A adoption
grep -rl "from '@/components/ui'" app/lenses/*/page.tsx | wc -l          # 13
# generic scaffold spread
grep -rlE "AutoActionStrip|UniversalActions|ManifestActionBar" app/lenses/*/page.tsx | wc -l  # 222
# arbitrary type sizes
grep -rhoE "text-\[[0-9]+px\]" app/lenses/*/page.tsx | wc -l             # 1695
# grader-sentinel gaming
grep -rliE sentinel app/lenses/*/page.tsx | wc -l                        # 109
# grader scores
node ../scripts/grade-ux-polish.mjs            # 260/260 polished, 1.000
node ../scripts/grade-ux-polish.mjs --honest   # 205/55, 0.915
```
