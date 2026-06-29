# UX Polish Audit

Generated: 2026-06-29T14:45:15.268Z

Lenses scanned: 260


## Tier distribution

| Tier | Count | % | Weight |
|---|---:|---:|---:|
| raw | 2 | 0.8% | 0.2 |
| functional | 17 | 6.5% | 0.6 |
| polished | 241 | 92.7% | 1 |

**Weighted UX polish score: 0.968** (1.0 = all polished)

## Signal coverage (% of lenses)

| Signal | Lenses with it | % |
|---|---:|---:|
| loading | 251 | 96.5% |
| emptyState | 259 | 99.6% |
| errorUI | 244 | 93.8% |
| aria | 258 | 99.2% |
| keyboardHandlers | 171 | 65.8% |
| nativeButtons | 260 | 100.0% |
| responsive | 252 | 96.9% |
| animation | 254 | 97.7% |
| toasts | 59 | 22.7% |
| altOnImages | 260 | 100.0% |

## Anti-patterns

- Lenses with at least one `<div onClick>` (missing keyboard handler / role / tabIndex): **6** (total instances: 22)
- Lenses with inline hex colours (bypassing design tokens): **0** (total instances: 0)

## Raw-tier lenses (need work)

| Lens | Pillars | Missing | Files |
|---|---:|---|---:|
| `careers` | 2/5 | loading, error, responsive | 1 |
| `repair-telemetry` | 2/5 | loading, error, responsive | 1 |

## Functional-tier lenses (one pillar away from polished)

Sorted by smallest gap first. Items with anti-patterns surface first within each pillar-count.

| Lens | Pillars | Missing | Anti-patterns |
|---|---:|---|---:|
| `art` | 5/5 | anti-patterns(1 div-button, 0 inline-hex) | 1 |
| `message` | 5/5 | anti-patterns(2 div-button, 0 inline-hex) | 1 |
| `studio` | 5/5 | anti-patterns(1 div-button, 0 inline-hex) | 1 |
| `whiteboard` | 5/5 | anti-patterns(1 div-button, 0 inline-hex) | 1 |
| `world` | 5/5 | anti-patterns(13 div-button, 0 inline-hex) | 1 |
| `codex` | 5/5 |  | 0 |
| `auction` | 4/5 | error, anti-patterns(4 div-button, 0 inline-hex) | 1 |
| `civic-bonds` | 4/5 | responsive | 0 |
| `ledger` | 4/5 | responsive | 0 |
| `move-builder` | 4/5 | responsive | 0 |
| `photos` | 4/5 | loading | 0 |
| `courtship` | 3/5 | error, responsive | 0 |
| `detective` | 3/5 | loading, error | 0 |
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