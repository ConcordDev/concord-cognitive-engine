# UX Polish Audit

Generated: 2026-05-24T17:49:43.597Z

Lenses scanned: 235


## Tier distribution

| Tier | Count | % | Weight |
|---|---:|---:|---:|
| raw | 0 | 0.0% | 0.2 |
| functional | 0 | 0.0% | 0.6 |
| polished | 235 | 100.0% | 1 |

**Weighted UX polish score: 1** (1.0 = all polished)

## Signal coverage (% of lenses)

| Signal | Lenses with it | % |
|---|---:|---:|
| loading | 235 | 100.0% |
| emptyState | 235 | 100.0% |
| errorUI | 232 | 98.7% |
| aria | 227 | 96.6% |
| keyboardHandlers | 168 | 71.5% |
| nativeButtons | 235 | 100.0% |
| responsive | 233 | 99.1% |
| animation | 235 | 100.0% |
| toasts | 58 | 24.7% |
| altOnImages | 235 | 100.0% |

## Anti-patterns

- Lenses with at least one `<div onClick>` (missing keyboard handler / role / tabIndex): **0** (total instances: 0)
- Lenses with inline hex colours (bypassing design tokens): **0** (total instances: 0)

## Raw-tier lenses (need work)

_None — every lens has at least 3 of 5 structural pillars._

## Functional-tier lenses (one pillar away from polished)

Sorted by smallest gap first. Items with anti-patterns surface first within each pillar-count.

| Lens | Pillars | Missing | Anti-patterns |
|---|---:|---|---:|

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