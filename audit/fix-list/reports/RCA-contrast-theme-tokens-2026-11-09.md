# RCA: text-white / text-zinc-* compute to dark (cross-lens contrast collapse)

**Date:** 2026-11-09 (America/New_York)  
**Scope:** Read-only diagnosis in `/workspace/webdb-audit` @ `dae9e10a6` (same tip as live mega deploy). **No files modified.**  
**Trigger:** Lens Tester 1 on Personas — DevTools showed `text-white` / `text-zinc-200` resolving to **dark** colours (Search 2.53:1, wiki excerpt 1.23:1, Create persona 1.22:1, FAB ~1.8:1). Many other lenses filed near-invisible / dark-on-dark contrast tickets. Sim also reports theme toggle saying **"Currently Light"** on a still-dark page (`FIX-sim-002`).

---

## Root cause (shared)

### Primary — Light-theme zinc/gray/white **invert override** fires while lattice / arbitrary backgrounds stay dark

`ThemeToggle` stores `concord_theme` and, for Light (or System+prefers-light), adds class **`light`** on `<html>`:

- `components/common/ThemeToggle.tsx:31–42` — `root.classList.add('light')` / `toggle('light', !prefersDark)`.  
  Note: it does **not** set `data-theme="light"`; the CSS covers **both** selectors so `.light` alone is enough.

When `.light` (or `[data-theme="light"]`) is on an ancestor, `app/globals.css` remaps every Tailwind zinc/gray shade **and** bare `text-white` to the opposite end of the ramp (audit 2026-07-27 "LIGHT-THEME READABILITY OVERRIDE"):

| Utility (authored for dark UI) | Remapped colour under `.light` | Evidence |
|--------------------------------|--------------------------------|----------|
| `.text-white` | `#18181b` (near-black) | `globals.css:1366` |
| `.text-zinc-50` / `.text-zinc-100` | `#09090b` / `#18181b` | `:1229–1235` |
| `.text-zinc-200` | `#27272a` | `:1241` |
| `.text-zinc-300` … `.text-zinc-400` | mid/dark greys | `:1247–1253` |
| `.bg-zinc-900` / `.bg-zinc-950` | `#f4f4f5` / `#fafafa` (light) | `:1283–1290` |
| full zinc + gray ramp (text/bg/border/ring/placeholder) | inverted 50↔950 … | `:1229–1361` |

Comment at `globals.css:1194–1226` states the intent: retrofit light mode onto ~241/269 lenses that hardcode zinc/white without editing components. Specificity `(0,2,0)` beats Tailwind's plain class `(0,1,0)`.

### Why that produces contrast 1.2–2.5 on "dark" pages

1. **`tailwind.config.js` hardcodes lattice hexes** — `lattice.void: '#0a0a0f'`, `deep`, `surface`, etc. (`tailwind.config.js:12–24`). Utilities like `bg-lattice-void` compile to **literal dark hex** and do **not** read `--lattice-void`.
2. **CSS vars for lattice do flip** under `.light` (`globals.css:103–112`: `--lattice-void: #fafafa`) — but only code using `var(--lattice-*)` benefits. `@apply bg-lattice-void` on `body` (`globals.css:129`) still paints the **compiled dark** colour.
3. **Arbitrary dark surfaces** (`bg-[#111]`, `bg-black/70`, etc.) are **not** in the invert block — they stay dark.
4. **Design-system / lens chrome** bake in `text-white` (`lib/design-system.ts:107–109,185–199`; vault tokens file itself documents this: `lib/vault/tokens.ts:7–12`).

So under Light theme you get:

- **Text** remapped → dark (`text-white` → `#18181b`, `text-zinc-200` → `#27272a`)
- **Backgrounds** that matter for most lenses → still dark (lattice utilities + `#111`-style arbitrary)
- **Result:** dark-on-dark ≈ 1.0–2.5:1 — matches Personas measurements and the "Currently Light" / dark page mismatch on Sim.

Fully zinc-paired panels (`bg-zinc-950` + `text-zinc-100`) can look OK in light mode because **both** sides remapped. Mixed lattice / `#111` / `ds.heading*` UIs collapse. That is why the bug looks "random" per lens but is one shared cascade.

### Secondary (related, not the invert)

Even with `.light` **off**, some tickets are genuine **muted-on-dark** authoring (`text-zinc-500` / `text-gray-400` on near-black) that sits under AA — e.g. education muted labels, studio time readout 4.09:1. Those need token lifts, not the invert removal. The Personas / Sim / household "nearly invisible" class is the invert mismatch.

### Contributing wiring notes

- `darkMode: 'class'` in Tailwind (`tailwind.config.js:3`) expects a `.dark` class for `dark:` variants; ThemeToggle only toggles `.light` and never adds `.dark` — so `dark:` utilities are unreliable.
- Theme persists in `localStorage['concord_theme']` (`ThemeToggle.tsx:7,24`). A single Light click (or System on a light OS preference) leaves **every** subsequent lens broken until toggled back to Dark.
- Vault island (`.vault-*`) is a deliberate light surface with its own tokens and is **out of scope** for this RCA (`globals.css:992+`, `lib/vault/tokens.ts`).

---

## Suggested single fix (builders — do not apply in this audit)

**Preferred one-shot fix that restores readability across lenses:**

1. **Disable the light-theme zinc/gray/white invert block** in `app/globals.css` (the flat rules from ~`:1229` through `:1369`, including `.text-white` → `#18181b`), **or** gate it behind a feature flag / remove `.light` matching until lattice is var-based.
2. **Force theme to dark** in `ThemeToggle.applyTheme` (or map Light → no-op with a tooltip "Light theme paused") until Wave-3 semantic retheme — so `localStorage` Light cannot keep breaking QA and users.

**Proper follow-up (not the one-liner):** wire `tailwind.config.js` `lattice` / `neon` to `var(--lattice-void)` etc., drop the zinc invert hack, migrate `ds.*` off baked `text-white`, and use semantic foreground/background tokens that flip with theme. Documented as needed in `globals.css:1223–1225` and `lib/vault/tokens.ts:7–12`.

**QA workaround (testers, no code change):** User menu / ThemeToggle → cycle until aria-label is **Currently Dark** (and `<html>` has no class `light`). Re-measure contrast after. Do not close contrast tickets based on Light-theme measurements.

---

## Tickets this RCA likely explains

High confidence when the report mentions near-invisible / dark-on-dark / theme-token / "Currently Light", or measured ratios ~1–2.5 on classes that are literally `text-white` / `text-zinc-100..300` / `ds.heading*`:

| Ticket | Lens | Why linked |
|--------|------|------------|
| **FIX-personas-009** | personas | Explicit: `text-white`/`text-zinc-200` compute dark; marked `cross_lens` |
| **FIX-sim-002** | sim | Severe low contrast + theme toggle "Currently Light" on dark page |
| **FIX-household-004** | household | Page title / headings / modal titles nearly invisible |
| **FIX-move-builder-003** | move-builder | Labels / preview / eff values nearly illegible |
| **FIX-logistics-011** | logistics | Stat numbers ~1.0–1.4:1; typed field text ~1.35:1 |
| **FIX-ar-009** | ar | Headings / stats / typed input / Cancel nearly unreadable |
| **FIX-fitness-007** | fitness | Section headings / selects / Cancel near-invisible |
| **FIX-manufacturing-002** | manufacturing | Stat values and table rows dark-on-dark |
| **FIX-science-004** | science | Mobile inputs/cards/titles nearly invisible |
| **FIX-food-006** | food | Headings/labels very low contrast "in dark theme" (likely Light class + dark lattice) |
| **FIX-creative-005** | creative | Section headings / tile titles nearly invisible |
| **FIX-retail-005** | retail | Stat values dark-on-dark (settings-on-white slice may be separate) |
| **FIX-nonprofit-011** | nonprofit | Title/headings/stat labels very low contrast |
| **FIX-goals-008** | goals | Dark-on-dark filter/tab labels |
| **FIX-healthcare-009** | healthcare | Patient names / input text low contrast |
| **FIX-aviation-009** | aviation | Modal/card text dim; dark-on-dark flight detail |
| **FIX-realestate-011** | realestate | Page text/headings very dim |
| **FIX-legal-011** | legal | Docket / panel headings low contrast |
| **FIX-insurance-010** | insurance | Headings/stat numbers very dim |
| **FIX-agriculture-009** | agriculture | Typed dialog text dark-on-dark |
| **FIX-government-005 / 011** | government | Very low text contrast (among other issues) |
| **FIX-agents-006** | agents | Inactive tabs / labels / empty copy low contrast |
| **FIX-council-007** | council | Dark helper/card text very dim |
| **FIX-accounting-007** | accounting | Lighthouse contrast (among a11y flags) |
| **FIX-security-009** | security | Lighthouse contrast (among a11y flags) |
| **FIX-environment-007** | environment | Lighthouse contrast (among a11y flags) |
| **FIX-film-studios-003** | film-studios | Header/action contrast |
| **FIX-board-013** | board | Lane header 1.29:1 / stats 2.47:1 — ratio class matches invert failure |

**Possibly mixed / secondary muted-token issues** (may remain after invert disabled; re-check in Dark):

| Ticket | Lens | Note |
|--------|------|------|
| FIX-education-009 | education | Muted gray secondary on near-black — may be intentional muted too dim |
| FIX-chat-009 | chat | Visual spot-check low contrast |
| FIX-studio-007 | studio | Time readout 4.09:1 — borderline AA, may be true muted |
| FIX-music-009 | music | Piano-roll dark-on-dark (partially Studio) |
| FIX-art-005 | art | Mentions muted helper text among other a11y |
| FIX-trades-008 | trades | Muted metadata among label issues |
| FIX-calendar-004 | calendar | Title near-invisible in agenda — verify after theme force-dark |

**Count:** ~28 tickets high-confidence linked; ~7 secondary/recheck. Closing should wait for live re-measure with `<html>` **without** `.light`.

---

## Repro for builders / re-verify

1. DevTools → `<html>` class list: if `light` present, contrast collapse is expected on lattice pages.
2. Computed style on any `text-white` node: colour `#18181b` ⇒ invert active (`globals.css:1366`).
3. ThemeToggle → Dark → `light` class gone → same node should compute to white / zinc as authored.
4. Confirm `bg-lattice-void` still `#0a0a0f` even when Light (hardcoded config) — proves the mismatch without editing files.

Code-only RCA; not a live patch.

---

## Dark-theme exceptions (Dreams)

**Date:** 2026-11-09 (America/New_York)  
**Trigger:** Lens Tester 1 — Dreams lens measured in **DARK** theme: page heading **"Dreams" 1.11:1**, section **"What's ahead" 1.06:1** (`FIX-dreams` contrast tickets). LT1 flagged these as **not** explained by the Light-theme invert RCA above.

### What the authored nodes are

| Node | File:line | Classes / surface |
|------|-----------|-------------------|
| Page title "Dreams" | `concord-frontend/app/lenses/dreams/page.tsx:104` | `h1` `font-vault text-[2.25rem] leading-tight text-zinc-100` on lens chrome over lattice / dark page |
| "What's ahead" | `concord-frontend/components/dreams/DreamPredictions.tsx:90` | `h2` `text-sm font-semibold text-zinc-100` inside parent `section` `bg-[#111]` (`page.tsx:181–183`) |

**Not found on those nodes:** `bg-clip-text`, `text-transparent`, `text-gradient-*`, `vault-letterpress*`, hardcoded dark `text-[#…]` / `text-black`, or a Dreams-only `data-lens-theme` colour override (`rg` over dreams page/components + `globals.css` lens-theme rules empty for dreams).

### Why ~1.1:1 still matches the shared invert fingerprint

Under `.light` / `[data-theme="light"]`, the same utility used by both headings is remapped:

- `.light .text-zinc-100 { color: #18181b; }` — `globals.css:1235`

Backgrounds under those headings stay dark (`bg-lattice-void` compiled `#0a0a0f`, section `bg-[#111]`). Dark text `#18181b` on `#0a0a0f` / `#111` is ~1.0–1.2:1 — **the measured 1.11 / 1.06 ratios**.

So in code there is **no separate Dreams dark-mode heading bug** (no transparent fill / missing gradient fallback). The only authored path that produces those ratios on these exact classes is the **shared light-theme zinc invert** while lattice/arbitrary backgrounds stay dark (primary RCA above).

If DevTools truly shows `<html>` **without** class `light` and computed colour on the `h1`/`h2` is still near-black, that would be a new mechanism not present in Dreams-specific CSS — re-check ThemeToggle / `concord_theme` (System + OS light still adds `.light`: `ThemeToggle.tsx:31–42`) before filing a Dreams-only token bug.

### Shared pattern count

Same north-star page title pattern (`font-vault text-[2.25rem] … text-zinc-100`) appears on **85** lens `page.tsx` files (`rg -l 'font-vault text-\[2\.25rem\] leading-tight text-zinc-100' app/lenses/**/page.tsx`). Broader `font-vault` + `text-zinc-100` co-occurrence: **90** lens pages. Any of those headings will collapse the same way whenever `.light` is on.

**Verdict:** Dreams 1.11 / 1.06 in an allegedly Dark session is still the **cross-lens invert mismatch**, not a Dreams-unique transparent/gradient exception. Keep under this RCA; QA workaround remains ThemeToggle → **Currently Dark** and confirm `<html>` has no `light` before closing contrast tickets.

## Live evidence (LT1, 7:22 AM ET 2026-11-09)
/lenses/ml <html class> = "dark ... light" simultaneously (no data-theme); ThemeToggle reads "Currently Light" while page renders dark. /lenses/dreams at same time = "dark" only. Likely real bug: theme switch to dark does not remove a stale `light` class (possibly route/lens-dependent), so the light invert block applies on dark surfaces. Fix candidates: ensure ThemeToggle/initializer removes the opposite class atomically; scope invert to `html.light:not(.dark)` as a guard. FIX-dreams-005 re-tagged to this RCA.
