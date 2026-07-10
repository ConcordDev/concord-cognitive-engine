# UI Quality Rubric — the premium bar every rebuilt lens is graded against

> Referenced by name in every lens-rebuild agent prompt
> (`docs/FRONTEND_REBUILD_PROGRAM.md` Phase 1 item 5). This is a
> **judgment-call rubric layered on top of** what `scripts/grade-ux-polish.mjs`
> already checks mechanically. Don't re-derive the mechanical pillars here —
> use the grader for those and this doc for everything static analysis can't
> see (density, interaction quality, identity fit, perceived perf, craft,
> honesty). If a claim in this doc is checkable by script, it belongs in the
> grader, not as prose — file a `--honest`-style extension instead of hand-
> waving it here.

## What's already mechanical (don't re-litigate, just pass it)

`node scripts/grade-ux-polish.mjs --honest` checks, per lens:

| Pillar | Signal |
|---|---|
| Loading | explicit loading UI / `aria-busy` / `*State === 'loading'` |
| Empty | `<EmptyState>`/`<EmptyStateCTA>` or an explicit `length === 0` branch |
| Error | `<ErrorState>`/`role="alert"`/`onError`/`*Error(` setter, not silent catch |
| A11y | ARIA attrs or native `<button>` |
| Responsive | Tailwind breakpoint prefixes present |
| Anti-patterns | `<div onClick>` w/o keyboard handler; inline hex bypassing tokens |
| **Scaffold cap** | generic trio (`ManifestActionBar`+`AutoActionStrip`+`RecentMineCard`) + `<UniversalActions>`/`<LensFeaturePanel>` body + no bespoke page/component → capped at `functional`, can't score `polished` |

A lens that passes all of the above is **structurally sound**, not **good**.
This rubric is the "good" layer. A rebuilt lens must clear the grader
**and** self-grade honestly against every section below.

---

## 0. Prompting for premium design (how to actually get there)

Sections 1-6 below are the *bar*. This section is the *technique* for
clearing it — added 2026-07-09 per owner directive that top-notch polish
be a hard invariant (CLAUDE.md §3), not an aspiration every agent
independently reinvents. Bake these into every rebuild-dispatch prompt
from this point forward, not just this doc.

- **Name ONE precise reference app, not a vibe.** "Make it look nice" or
  "make it professional" produces the exact generic-SaaS-dashboard look
  this program exists to kill. "Make it read like Bloomberg Terminal,
  specifically — dense dark background, monospace right-aligned numerals,
  a persistent command line" produces a designed identity. This is the
  same move as the reference-parity checklist (step 1.5) — do it for
  visual language too, not just feature coverage. §3 below names five
  identities already established (Finance/terminal, Code/IDE,
  Music/DAW, News/research-tool, plus whatever destination family a new
  lens belongs to) — extend that list, don't invent a sixth "modern
  dashboard" identity.
- **Specify the five things, every time**: reference app, color palette
  (reuse `lib/design-system.ts` tokens — don't invent a one-off palette),
  typography hierarchy (the existing type scale, not ad-hoc sizes),
  spacing rhythm (`DENSITY_TOKENS`, not eyeballed padding), and the
  intended emotion/read (terminal-cold-and-fast vs. warm-and-tactile vs.
  clinical-and-precise — this should follow from the domain, not be
  decorative).
- **Design in grayscale first, add color last.** Forces hierarchy to
  come from spacing, contrast, size, and type weight — not from "make
  the important thing blue." A layout that only reads correctly once
  color is added has a hierarchy problem color is papering over.
- **Whitespace is removed, not added.** Start deliberately oversized,
  then trim until it's tight — the opposite direction of the instinct to
  keep adding padding until something "looks clean." A lens padded out
  to fill the viewport with air (see §1's density minimums) is the
  failure mode this produces when done backwards.
- **Reduce, don't decorate.** "Reduce visual noise — remove anything
  that isn't essential" and "make this more opinionated" are higher-yield
  self-check questions than "what else could I add here." A page with
  one fewer panel that's denser and better-considered beats a page with
  one more panel that's decorative.
- **Divide-and-conquer, not one giant prompt.** The capability-audit-first
  methodology (step 1 of the rebuild loop) already does this for
  features — describe each section's real content and interaction in
  detail before implementing, rather than "build me a nice UI for X" in
  one shot. The same discipline applies to visual design: settle the
  layout/density/identity decisions explicitly (this section) before
  writing component code, not as an afterthought polish pass.

---

## 1. Information Density

**The rule, not the vibe:** density is a function of the data's shape, not
a style preference.

- **Dense table/grid** when the macro output is a list of **>8
  structurally-identical records with ≥3 comparable scalar fields**
  (prices, timestamps, statuses, quantities, IDs) — the user's job is to
  *compare rows*. Use `components/ui/DataTable.tsx`. Examples: ledger
  entries, order books, macro-call logs, inventory, standings.
- **Card grid** when the user's job is to *visually scan and pick one* —
  imagery/thumbnail is the primary signal, not a comparable scalar (art
  gallery, track list with cover art, NPC roster with portraits). Cards
  with no image and no visual differentiator are a table wearing a
  costume — don't use them for tabular data.
- **Inspector/detail panel** (master-detail split) when records are
  comparably few (<20) but each has deep nested structure worth drilling
  into (a proposal's amendments, a quest's step tree). Table for the
  master list, panel for the depth — don't cram both into one card.

**Minimum content-per-viewport (data-heavy lenses — Finance, Accounting,
Admin/Ops, Logs, Marketplace, any lens whose primary macro returns a list):**
at a 1920×1080 viewport, the first fold (no scroll) must show **either**
≥12 real data rows **or** ≥6 populated stat tiles. If you're padding out
2-3 giant cards to fill the screen, that's the "SaaS-minimal wasted
whitespace" failure mode this program exists to kill — go denser or admit
the data doesn't support it and go to the sparse case below.

**Acceptable sparseness (genuinely simple lenses):** a lens whose whole
job is a single form, a single toggle, or a single-macro utility (e.g. a
settings pane, a one-shot calculator) is **correctly** sparse. The test
isn't row count, it's: **does every visible pixel correspond to real,
actionable information or control** — not "did we fill the viewport." A
sparse lens padded with decorative panels to look dense is worse than an
honestly sparse one.

**Density toggle:** data-heavy lenses should honor `useDensity()` /
`components/ui/DensityToggle.tsx` (Low/Med/High — spacing + font-size +
row-height multipliers already defined in `lib/design-system.ts`
`DENSITY_TOKENS`). If a lens's layout can't sanely respond to density
(e.g. a fixed 3D canvas), that's fine — document why in the capability map,
don't silently omit it.

**Self-check:** screenshot the lens at 1080p. Count real data
units on screen. Data-heavy lens with <12 → too sparse. Any lens with
decorative empty panels eating >20% of the fold → air, not density.

---

## 2. Micro-interactions

**Minimum bar per rebuilt lens: 3–5+ real interactions**, each tied to an
actual state change caused by real data or a real macro call.

### Counts as a micro-interaction
- **Macro-dispatch feedback on the triggering control itself** — the
  specific button/row that fired the macro shows a distinct pending state
  (disabled + spinner glyph, or a skeleton overlay on just that cell/row),
  then transitions to a success or failure state that's visually distinct
  from idle (not just a toast that vanishes in 3s while the control looks
  unchanged).
- **Optimistic UI with reconciliation** — an add/toggle/reorder shows the
  end state immediately, then confirms (subtle settle) or reverts
  (visible rollback + error surface) when the real response lands.
- **DTU drag/cite feedback** — dragging a `DTUEmbed` onto a drop target
  highlights the valid drop zone, shows a drag preview/ghost, and animates
  a confirmation on drop (via `CitePicker`/`CitationConsentModal` or the
  workspace bus). A cite action that just silently updates a list with no
  drop-target affordance doesn't count.
- **Data-driven transitions** — a sort re-order animates row position; a
  filter narrowing the list animates the removed rows out; a new
  real-time event (socket push) slides a row in rather than snapping the
  list. The transition must be *caused by a data change*, not a page-mount
  fade.
- **Scoped keyboard commands with a visible affordance** —
  `useLensCommand` registrations that show their shortcut hint somewhere
  (a kbd chip, a palette entry), not a hidden keybinding nobody discovers.
- **Progressive disclosure on real secondary actions** — hovering/focusing
  a row reveals inline actions (edit/delete/inspect) that are wired to
  real handlers. The reveal itself is only "real" if what's revealed does
  something.

### Does NOT count
- `hover:opacity-80` / `hover:bg-white/5` alone on an otherwise static
  element with no state change underneath.
- A `framer-motion` page-mount fade-in/slide-in with no data or user
  action behind it — decorative chrome, not interaction.
- A spinner/skeleton that always resolves in <100ms because nothing is
  actually async — theater, not feedback.
- `transition-colors`/`transition-transform` Tailwind utility present on
  a button with exactly one visual state (this is what the mechanical
  grader's `hasAnimation` signal picks up — it is NOT sufficient here,
  it's necessary-but-not-sufficient).
- A toast that fires regardless of whether the underlying call succeeded
  (see §6 — this is a honesty violation, not just a weak interaction).

**Self-check:** list the 3-5 interactions you're claiming. For each, name
the macro/DTU/route/socket-event that causes it. If you can't name one,
it doesn't count.

---

## 3. Domain Visual Identity

Five named identities from the program doc. Each rebuild targets the
identity of its destination family, not a generic "dashboard" look.

### Finance — terminal identity
- Dense dark background, `font-mono` numerals **right-aligned** in
  tabular columns (never proportional-font prices).
- Tick/delta color coding applied consistently (green/red or up/down
  glyphs) on every price/change cell, updating live off real market data
  — not a static snapshot styled to look live.
- Keyboard-first command entry (ticker lookup, quick actions) — minimal
  chrome, minimal whitespace, information density maximized (see §1).

### Code — IDE identity
- File-tree + tab-strip + editor-pane layout (VSCode shape), not a card
  list of files.
- Status bar at the bottom carrying real state (branch, cursor position,
  errors count, lint status) — decorative status bars with static text
  fail this.
- Real syntax highlighting + a command palette scoped to code actions
  (not the global Cmd+K only).

### 3D / Concordia — immersive-sim identity
- HUD overlays composited on the 3D canvas (diegetic where possible), not
  modal dialogs stacking on top of the world view for routine info.
- Minimal persistent chrome — health/resource bars fade in on change, not
  permanently painted (see `docs/DESIGN_NORTH_STAR.md` §1 "minimal
  HUD/deep menus").
- Loading/entry sequences show **real** progress (asset/world-data fetch
  progress), never a fake progress bar that always completes at a fixed
  duration.

### News / Intelligence — research-tool identity
- Every surfaced fact carries visible source attribution (origin +
  timestamp), always-on, not a tooltip you have to hunt for.
- One-click pull → DTU → cite flow is the primary interaction, not a
  side feature — the lens's job is turning external signal into cited
  substrate.
- Feed/timeline layout ordered by recency with a citation-chain view
  reachable from any item — not chart-dashboard-for-its-own-sake framing.

### Governance — constitutional identity
- Formal, document-like typography for proposal/decision text (serif or
  a deliberately formal mono/serif pairing distinct from the app's
  default sans) — governance text should read like a record, not a UI
  label.
- Explicit process-state visualization (proposed → discussion → voted →
  enacted) as a visible stepper/ledger, not a status string buried in a
  table cell.
- An audit trail / vote tally that's inspectable (who voted what, when)
  — governance without a visible trail is decoration wearing the identity
  without earning it.

**Self-check:** could you swap this lens's screenshot with a generic
SaaS dashboard and nobody would notice? If yes, the identity isn't
applied yet.

---

## 4. Perceived Performance

Concrete targets, not vibes:

| Situation | Target | Mechanism |
|---|---|---|
| Lens switch (route change) | shell/skeleton visible within ~100ms | Next.js route transition renders the lens's skeleton immediately; macro data streams in after |
| Any control that dispatches a macro | visible pending state within one frame (~16ms) | never wait for the network round-trip to show ANY feedback — disable + pending glyph fires synchronously on click |
| List/table/card content whose shape is known and load is likely >300ms | **skeleton** matching real content dimensions | `components/ui/Skeleton.tsx` — prevents layout shift when data arrives |
| Genuinely indeterminate, short, shapeless operation (e.g. a full-page auth check) | **spinner** | only when there's no known content shape to skeleton |
| Action that's highly likely to succeed and is reversible (toggle favorite, add to list, reorder) | **optimistic update** | show the end state immediately; reconcile silently on success, visibly revert + surface error on failure |
| Data arriving after initial paint | **no layout shift** | skeleton dimensions must match the real content's dimensions, not a generic placeholder box |

**Anti-pattern:** a spinner used where the shape is already known (skeleton
should've been used) — this reads as slower than it is because the user
can't anticipate the layout. Also anti-pattern: optimistic-updating an
action that commonly fails (e.g. a paid purchase) — that's a UX rug-pull,
use pending state + explicit confirm instead.

**Self-check:** open the lens on a throttled connection (Chrome DevTools
"Slow 3G"). Does *something* respond within 100ms of every click? Does
the skeleton match the eventual layout, or does content jump?

---

## 5. Craft checklist

**Typography**
- [ ] Uses `TYPE_SCALE` tokens from `lib/design-system.ts` (`display` /
      `heading1-4` / `body` / `bodySm` / `caption` / `overline` / `mono*`)
      — no ad hoc `text-[13px]` one-offs.
- [ ] Numeric/tabular data uses a `mono*` token, not the sans body font.
- [ ] Clear hierarchy: page title → section header → label → body →
      caption each land on a distinct token, not font-size soup within
      the same visual tier.

**Spacing**
- [ ] Uses `SPACING_SCALE` tokens (`xs`…`3xl`) / the Tailwind spacing
      scale consistently — no arbitrary `p-[13px]` magic numbers.
- [ ] Consistent gap within a given list/grid (not a mix of `gap-2` and
      `gap-3` siblings in the same repeated structure).

**Loading / empty / error states**
- [ ] Loading uses `components/ui/Skeleton.tsx` (shape-matched) not an ad
      hoc "Loading…" text node.
- [ ] Empty state uses `components/ui/EmptyState.tsx` and **names the
      specific missing thing** ("No positions in this portfolio yet — buy
      your first asset" not "No data").
- [ ] Error uses `components/ui/ErrorState.tsx` / `role="alert"`, states
      what failed in plain language, and offers a retry where retry is
      meaningful.

**Accessibility**
- [ ] Icon-only controls have `aria-label`.
- [ ] Interactive elements are native `<button>`/`<a>`, not `<div
      onClick>` (or carry `role`, `tabIndex`, and a keyboard handler if
      truly custom).
- [ ] Focus-visible rings present (don't strip `:focus` outlines without
      a replacement).
- [ ] Real `<img>` elements have meaningful `alt` text (not `alt=""` on
      informational images).
- [ ] Error banners use `role="alert"` so screen readers announce them.

**Density**
- [ ] Data-heavy lens responds to `useDensity()` / `DensityToggle`, or
      the capability map documents why it structurally can't.

---

## 6. "No Air" — the honesty rule

**The hard rule:** every rendered element, number, status, and success/
failure indication must trace to a real macro response, DTU, route, or
socket event. Visual state must be **caused by** that response, never
**decorative of** an assumed outcome. A surface that can't do the real
thing shows an honest failure/pending/empty state with a documented
reason — it never fabricates a success, a value, or a visual
representation.

This is not aspirational — it is the single most common defect class
found in this codebase's own lenses. **Real examples fixed in this exact
repo this week**, so future rebuild agents recognize the pattern on sight
instead of relearning it:

| Anti-pattern | What happened | Where |
|---|---|---|
| **Fabricated success on failure** | `catch` block showed "AI processed. Results applied." even when the API call had thrown | Studio DAW `handleAiAction` (`effe370f`) |
| **Fabricated placeholder ID treated as real** | fell back to the literal string `'council'` as an artifact id when no real proposal existed, so every action call failed silently against a fake target | Council lens (`8a268ecf`) |
| **Fake visual fabricated as the real thing** | "3D Preview" panel was two plain CSS `<div>`s (a circle + a rounded rect) — no Three.js, no canvas, nothing 3D | Character Creator (`f2350a6a`) |
| **Dead duplicate UI reading from an unwritten store** | a second copy of an action panel read from a data source nothing in the lens ever wrote to, so it always rendered empty and silently no-opped | Art lens (`e2b71673`) |
| **Control wired to the wrong feature entirely** | dashboard "Create" button opened the Studio DAW instead of the actual quick-create flow | Dashboard (`e12fe468`) |
| **Client-fabricated numeric data presented as measured** | `addTeam` sent `powerScore: 50 + Math.random()*30` as if it were a real computed rating | Sports (`3667ca8d`) |
| **All-zero / jittered fake sensor readout labeled as measured** | mastering analysis showed fabricated all-zero LUFS/DR metrics; VU meters jittered via `Math.random()` with no real audio analyser behind them | Studio mixer (`51cc943e`) |
| **Undisclosed synthetic data, mintable as if real** | generated synthetic EEG waveforms via `Math.random()` with no synthetic/demo label, mintable into a real DTU or published to the marketplace indistinguishable from real biosignal data | NeuroActionPanel (`c74b60d6`) |

**What an honest failure looks like** (the replacement pattern, every
time): a distinct error-tinted result state + an error toast that only
fires on genuine failure + **no downstream state mutation** (nothing
gets minted, saved, or marked complete on a failed call). If the real
data legitimately doesn't exist yet (no connector wired, no backend
data), render an honest "Connect Sources" / "Not yet available" state
with the *actual* reason — never a plausible-looking placeholder.

**Mechanical backstop:** `scripts/grade-ux-polish.mjs`'s fake-data
detector (Phase 0.2 — `Math.random()` in render paths, hardcoded arrays
rendered as if live data, placeholder strings shown as real values) feeds
the rebuild backlog and ratchets so a rebuilt lens can't regress into
this class. Passing the detector is necessary; it is not sufficient —
re-read the table above before calling a rebuild "no air."

**Self-check, per element on the page:** "What macro/DTU/route produced
this exact value?" If the answer is "nothing, it's a placeholder we meant
to wire later," it doesn't ship — render the honest empty/pending state
instead, with a comment naming the substrate it's waiting on.

---

## How to use this doc in a rebuild unit

1. Pass `node scripts/grade-ux-polish.mjs --honest` (not capped as
   generic scaffold, all 5 structural pillars, no anti-patterns).
2. Self-grade against every section above — §1 through §6 — and be able
   to point at the specific macro/component/token for each claim.
3. If a claim can't be pointed at, it isn't done — go implement it or cut
   the element and render the honest absence instead.
4. Report the capability-map coverage (designed vs. generic-strip-only
   vs. unsurfaced vs. world-owned) alongside this self-grade — density
   and micro-interactions only count for macros that are actually
   *designed*, not ones sitting in a generic action array.
