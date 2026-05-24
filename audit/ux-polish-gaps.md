# UX Polish Audit

Generated: 2026-05-24T14:22:32.849Z

Lenses scanned: 235


## Tier distribution

| Tier | Count | % | Weight |
|---|---:|---:|---:|
| raw | 0 | 0.0% | 0.2 |
| functional | 123 | 52.3% | 0.6 |
| polished | 112 | 47.7% | 1 |

**Weighted UX polish score: 0.791** (1.0 = all polished)

## Signal coverage (% of lenses)

| Signal | Lenses with it | % |
|---|---:|---:|
| loading | 235 | 100.0% |
| emptyState | 235 | 100.0% |
| errorUI | 133 | 56.6% |
| aria | 223 | 94.9% |
| keyboardHandlers | 117 | 49.8% |
| nativeButtons | 235 | 100.0% |
| responsive | 233 | 99.1% |
| animation | 234 | 99.6% |
| toasts | 6 | 2.6% |
| altOnImages | 235 | 100.0% |

## Anti-patterns

- Lenses with at least one `<div onClick>` (missing keyboard handler / role / tabIndex): **101** (total instances: 447)
- Lenses with inline hex colours (bypassing design tokens): **36** (total instances: 79)

## Raw-tier lenses (need work)

_None — every lens has at least 3 of 5 structural pillars._

## Functional-tier lenses (one pillar away from polished)

Sorted by smallest gap first. Items with anti-patterns surface first within each pillar-count.

| Lens | Pillars | Missing | Anti-patterns |
|---|---:|---|---:|
| `agriculture` | 5/5 | anti-patterns(5 div-button, 1 inline-hex) | 2 |
| `automotive` | 5/5 | anti-patterns(2 div-button, 2 inline-hex) | 2 |
| `aviation` | 5/5 | anti-patterns(9 div-button, 3 inline-hex) | 2 |
| `calendar` | 5/5 | anti-patterns(9 div-button, 3 inline-hex) | 2 |
| `government` | 5/5 | anti-patterns(5 div-button, 2 inline-hex) | 2 |
| `household` | 5/5 | anti-patterns(14 div-button, 6 inline-hex) | 2 |
| `logistics` | 5/5 | anti-patterns(12 div-button, 3 inline-hex) | 2 |
| `mining` | 5/5 | anti-patterns(1 div-button, 1 inline-hex) | 2 |
| `music` | 5/5 | anti-patterns(1 div-button, 1 inline-hex) | 2 |
| `photography` | 5/5 | anti-patterns(1 div-button, 1 inline-hex) | 2 |
| `realestate` | 5/5 | anti-patterns(10 div-button, 1 inline-hex) | 2 |
| `resonance` | 5/5 | anti-patterns(2 div-button, 8 inline-hex) | 2 |
| `world` | 5/5 | anti-patterns(5 div-button, 13 inline-hex) | 2 |
| `all` | 5/5 | anti-patterns(2 div-button, 0 inline-hex) | 1 |
| `app-maker` | 5/5 | anti-patterns(0 div-button, 2 inline-hex) | 1 |
| `ar` | 5/5 | anti-patterns(2 div-button, 0 inline-hex) | 1 |
| `artistry` | 5/5 | anti-patterns(15 div-button, 0 inline-hex) | 1 |
| `carpentry` | 5/5 | anti-patterns(3 div-button, 0 inline-hex) | 1 |
| `chat` | 5/5 | anti-patterns(9 div-button, 0 inline-hex) | 1 |
| `chem` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `cognitive-replay` | 5/5 | anti-patterns(2 div-button, 0 inline-hex) | 1 |
| `construction` | 5/5 | anti-patterns(5 div-button, 0 inline-hex) | 1 |
| `consulting` | 5/5 | anti-patterns(14 div-button, 0 inline-hex) | 1 |
| `cooking` | 5/5 | anti-patterns(4 div-button, 0 inline-hex) | 1 |
| `council` | 5/5 | anti-patterns(13 div-button, 0 inline-hex) | 1 |
| `crafting` | 5/5 | anti-patterns(5 div-button, 0 inline-hex) | 1 |
| `creative` | 5/5 | anti-patterns(10 div-button, 0 inline-hex) | 1 |
| `database` | 5/5 | anti-patterns(1 div-button, 0 inline-hex) | 1 |
| `debug` | 5/5 | anti-patterns(2 div-button, 0 inline-hex) | 1 |
| `disputes` | 5/5 | anti-patterns(2 div-button, 0 inline-hex) | 1 |
| `education` | 5/5 | anti-patterns(12 div-button, 0 inline-hex) | 1 |
| `environment` | 5/5 | anti-patterns(5 div-button, 0 inline-hex) | 1 |
| `fitness` | 5/5 | anti-patterns(3 div-button, 0 inline-hex) | 1 |
| `food` | 5/5 | anti-patterns(10 div-button, 0 inline-hex) | 1 |
| `forum` | 5/5 | anti-patterns(2 div-button, 0 inline-hex) | 1 |
| `game-design` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `geology` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `grounding` | 5/5 | anti-patterns(0 div-button, 2 inline-hex) | 1 |
| `healthcare` | 5/5 | anti-patterns(16 div-button, 0 inline-hex) | 1 |
| `history` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `hr` | 5/5 | anti-patterns(2 div-button, 0 inline-hex) | 1 |
| `insurance` | 5/5 | anti-patterns(3 div-button, 0 inline-hex) | 1 |
| `kingdoms` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `landscaping` | 5/5 | anti-patterns(2 div-button, 0 inline-hex) | 1 |
| `legal` | 5/5 | anti-patterns(16 div-button, 0 inline-hex) | 1 |
| `linguistics` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `marketing` | 5/5 | anti-patterns(22 div-button, 0 inline-hex) | 1 |
| `marketplace` | 5/5 | anti-patterns(4 div-button, 0 inline-hex) | 1 |
| `materials` | 5/5 | anti-patterns(2 div-button, 0 inline-hex) | 1 |
| `mental-health` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |

_…and 73 more functional-tier lenses; full list in `audit/ux-polish.json`._

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