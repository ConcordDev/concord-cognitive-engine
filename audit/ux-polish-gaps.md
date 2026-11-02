# UX Polish Audit

Generated: 2026-11-02T01:33:40.720Z

Mode: **default**

Lenses scanned: 268


## Tier distribution

| Tier | Count | % | Weight |
|---|---:|---:|---:|
| raw | 0 | 0.0% | 0.2 |
| functional | 5 | 1.9% | 0.6 |
| polished | 263 | 98.1% | 1 |

**Weighted UX polish score: 0.993** (1.0 = all polished)

## Signal coverage (% of lenses)

| Signal | Lenses with it | % |
|---|---:|---:|
| loading | 268 | 100.0% |
| emptyState | 267 | 99.6% |
| errorUI | 267 | 99.6% |
| aria | 267 | 99.6% |
| keyboardHandlers | 175 | 65.3% |
| nativeButtons | 267 | 99.6% |
| responsive | 264 | 98.5% |
| animation | 268 | 100.0% |
| toasts | 65 | 24.3% |
| altOnImages | 267 | 99.6% |

## Anti-patterns

- Lenses with at least one `<div onClick>` (missing keyboard handler / role / tabIndex): **5** (total instances: 15)
- Lenses with inline hex colours (bypassing design tokens): **0** (total instances: 0)

## Raw-tier lenses (need work)

_None — every lens has at least 3 of 5 structural pillars._

## Functional-tier lenses (one pillar away from polished)

Sorted by smallest gap first. Items with anti-patterns surface first within each pillar-count.

| Lens | Pillars | Missing | Anti-patterns |
|---|---:|---|---:|
| `conkay` | 5/5 | anti-patterns(1 div-button, 0 inline-hex) | 1 |
| `government` | 5/5 | anti-patterns(2 div-button, 0 inline-hex) | 1 |
| `projects` | 5/5 | anti-patterns(3 div-button, 0 inline-hex) | 1 |
| `studio` | 5/5 | anti-patterns(6 div-button, 0 inline-hex) | 1 |
| `timeline` | 5/5 | anti-patterns(3 div-button, 0 inline-hex) | 1 |

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