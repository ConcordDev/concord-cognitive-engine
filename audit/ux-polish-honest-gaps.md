# UX Polish Audit — HONEST mode

Generated: 2026-10-16T01:01:01.317Z

Mode: **honest**

Lenses scanned: 267


> Honest mode demotes lenses that are still the generated scaffold
> (generic ManifestActionBar + AutoActionStrip + RecentMineCard trio
> + a generic `<UniversalActions>`/`<LensFeaturePanel>` body on a thin
> page with no substantial bespoke component) from `polished` →
> `functional`. Lenses with a bespoke page, a flagship-scale component,
> or a custom body that dropped the generic wrappers are NOT capped.
> **0 lenses capped** (of 0 detected as generic scaffolds).

## Tier distribution

| Tier | Count | % | Weight |
|---|---:|---:|---:|
| raw | 0 | 0.0% | 0.2 |
| functional | 3 | 1.1% | 0.6 |
| polished | 264 | 98.9% | 1 |

**Weighted UX polish score: 0.996** (1.0 = all polished)

## Signal coverage (% of lenses)

| Signal | Lenses with it | % |
|---|---:|---:|
| loading | 267 | 100.0% |
| emptyState | 266 | 99.6% |
| errorUI | 266 | 99.6% |
| aria | 266 | 99.6% |
| keyboardHandlers | 175 | 65.5% |
| nativeButtons | 266 | 99.6% |
| responsive | 261 | 97.8% |
| animation | 267 | 100.0% |
| toasts | 65 | 24.3% |
| altOnImages | 266 | 99.6% |

## Anti-patterns

- Lenses with at least one `<div onClick>` (missing keyboard handler / role / tabIndex): **3** (total instances: 4)
- Lenses with inline hex colours (bypassing design tokens): **0** (total instances: 0)

## Generic-scaffold lenses capped this run (polished → functional)

_None._

## Raw-tier lenses (need work)

_None — every lens has at least 3 of 5 structural pillars._

## Functional-tier lenses (one pillar away from polished)

Sorted by smallest gap first. Items with anti-patterns surface first within each pillar-count.

| Lens | Pillars | Missing | Anti-patterns |
|---|---:|---|---:|
| `conkay` | 5/5 | anti-patterns(1 div-button, 0 inline-hex) | 1 |
| `government` | 5/5 | anti-patterns(2 div-button, 0 inline-hex) | 1 |
| `projects` | 5/5 | anti-patterns(1 div-button, 0 inline-hex) | 1 |

## What this audit does NOT measure

Static analysis catches **structural** UX building blocks. It cannot evaluate:

- **Visual design quality** — colour harmony, hierarchy, white-space, typography balance
- **Microcopy** — empty-state messages, error tone, button labels
- **Perceived performance** — does the spinner block too long? Does the layout shift on load?
- **Animation polish** — eased curves, durations, staggering, reduced-motion respect
- **Responsive breakpoints in practice** — does the lens actually work at 375px wide?
- **Keyboard flow** — focus order, focus visibility, focus traps in modals
- **Onboarding friction** — is the empty state of a fresh account guiding?
- **Screen-reader narrative** — does the page make sense announced aloud?

All of these require either (a) a browser-driven audit pass (axe-core, Lighthouse,
manual screen-reader walk-through), or (b) actual user testing.
This static audit is the **floor** — every lens with all 5 pillars + animation + toasts
is at least structurally complete. Real UX polish work goes on top.