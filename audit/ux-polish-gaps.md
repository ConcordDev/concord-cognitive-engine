# UX Polish Audit

Generated: 2026-05-24T14:59:18.271Z

Lenses scanned: 235


## Tier distribution

| Tier | Count | % | Weight |
|---|---:|---:|---:|
| raw | 0 | 0.0% | 0.2 |
| functional | 41 | 17.4% | 0.6 |
| polished | 194 | 82.6% | 1 |

**Weighted UX polish score: 0.93** (1.0 = all polished)

## Signal coverage (% of lenses)

| Signal | Lenses with it | % |
|---|---:|---:|
| loading | 235 | 100.0% |
| emptyState | 235 | 100.0% |
| errorUI | 133 | 56.6% |
| aria | 227 | 96.6% |
| keyboardHandlers | 168 | 71.5% |
| nativeButtons | 235 | 100.0% |
| responsive | 233 | 99.1% |
| animation | 234 | 99.6% |
| toasts | 6 | 2.6% |
| altOnImages | 235 | 100.0% |

## Anti-patterns

- Lenses with at least one `<div onClick>` (missing keyboard handler / role / tabIndex): **5** (total instances: 7)
- Lenses with inline hex colours (bypassing design tokens): **36** (total instances: 79)

## Raw-tier lenses (need work)

_None — every lens has at least 3 of 5 structural pillars._

## Functional-tier lenses (one pillar away from polished)

Sorted by smallest gap first. Items with anti-patterns surface first within each pillar-count.

| Lens | Pillars | Missing | Anti-patterns |
|---|---:|---|---:|
| `photography` | 5/5 | anti-patterns(1 div-button, 1 inline-hex) | 2 |
| `agriculture` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `app-maker` | 5/5 | anti-patterns(0 div-button, 2 inline-hex) | 1 |
| `automotive` | 5/5 | anti-patterns(0 div-button, 2 inline-hex) | 1 |
| `aviation` | 5/5 | anti-patterns(0 div-button, 3 inline-hex) | 1 |
| `calendar` | 5/5 | anti-patterns(0 div-button, 3 inline-hex) | 1 |
| `chat` | 5/5 | anti-patterns(1 div-button, 0 inline-hex) | 1 |
| `chem` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `crafting` | 5/5 | anti-patterns(1 div-button, 0 inline-hex) | 1 |
| `game-design` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `geology` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `government` | 5/5 | anti-patterns(0 div-button, 2 inline-hex) | 1 |
| `grounding` | 5/5 | anti-patterns(0 div-button, 2 inline-hex) | 1 |
| `history` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `household` | 5/5 | anti-patterns(0 div-button, 6 inline-hex) | 1 |
| `kingdoms` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `linguistics` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `logistics` | 5/5 | anti-patterns(0 div-button, 3 inline-hex) | 1 |
| `mental-health` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `mining` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `music` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `pharmacy` | 5/5 | anti-patterns(0 div-button, 2 inline-hex) | 1 |
| `realestate` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `resonance` | 5/5 | anti-patterns(0 div-button, 8 inline-hex) | 1 |
| `space` | 5/5 | anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `world` | 5/5 | anti-patterns(0 div-button, 13 inline-hex) | 1 |
| `black-market` | 5/5 |  | 0 |
| `studio` | 4/5 | error, anti-patterns(3 div-button, 3 inline-hex) | 2 |
| `bio` | 4/5 | error, anti-patterns(0 div-button, 2 inline-hex) | 1 |
| `code` | 4/5 | error, anti-patterns(0 div-button, 2 inline-hex) | 1 |
| `collab` | 4/5 | error, anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `finance` | 4/5 | error, anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `graph` | 4/5 | error, anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `legacy` | 4/5 | error, anti-patterns(1 div-button, 0 inline-hex) | 1 |
| `maker` | 4/5 | error, anti-patterns(0 div-button, 2 inline-hex) | 1 |
| `meditation` | 4/5 | error, anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `ops` | 4/5 | error, anti-patterns(0 div-button, 1 inline-hex) | 1 |
| `srs` | 4/5 | error, anti-patterns(0 div-button, 2 inline-hex) | 1 |
| `tick` | 4/5 | error, anti-patterns(0 div-button, 2 inline-hex) | 1 |
| `wellness` | 4/5 | error, anti-patterns(0 div-button, 2 inline-hex) | 1 |
| `sandbox` | 3/5 | error, responsive | 0 |

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