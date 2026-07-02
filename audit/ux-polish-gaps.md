# UX Polish Audit

Generated: 2026-07-02T11:08:12.746Z

Lenses scanned: 260


## Tier distribution

| Tier | Count | % | Weight |
|---|---:|---:|---:|
| raw | 0 | 0.0% | 0.2 |
| functional | 4 | 1.5% | 0.6 |
| polished | 256 | 98.5% | 1 |

**Weighted UX polish score: 0.994** (1.0 = all polished)

## Signal coverage (% of lenses)

| Signal | Lenses with it | % |
|---|---:|---:|
| loading | 255 | 98.1% |
| emptyState | 259 | 99.6% |
| errorUI | 248 | 95.4% |
| aria | 258 | 99.2% |
| keyboardHandlers | 172 | 66.2% |
| nativeButtons | 260 | 100.0% |
| responsive | 258 | 99.2% |
| animation | 260 | 100.0% |
| toasts | 63 | 24.2% |
| altOnImages | 260 | 100.0% |

## Anti-patterns

- Lenses with at least one `<div onClick>` (missing keyboard handler / role / tabIndex): **0** (total instances: 0)
- Lenses with inline hex colours (bypassing design tokens): **0** (total instances: 0)

## Raw-tier lenses (need work)

_None — every lens has at least 3 of 5 structural pillars._

## Functional-tier lenses (one pillar away from polished)

Sorted by smallest gap first. Items with anti-patterns surface first within each pillar-count.

| Lens | Pillars | Missing | Anti-patterns |
|---|---:|---|---:|
| `housing` | 3/5 | loading, error | 0 |
| `narrative-walk` | 3/5 | loading, error | 0 |
| `quests` | 3/5 | loading, error | 0 |
| `training-room` | 3/5 | loading, error | 0 |

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