# UX Polish Audit

Generated: 2026-07-01T21:52:23.498Z

Lenses scanned: 260


## Tier distribution

| Tier | Count | % | Weight |
|---|---:|---:|---:|
| raw | 1 | 0.4% | 0.2 |
| functional | 13 | 5.0% | 0.6 |
| polished | 246 | 94.6% | 1 |

**Weighted UX polish score: 0.977** (1.0 = all polished)

## Signal coverage (% of lenses)

| Signal | Lenses with it | % |
|---|---:|---:|
| loading | 253 | 97.3% |
| emptyState | 259 | 99.6% |
| errorUI | 246 | 94.6% |
| aria | 258 | 99.2% |
| keyboardHandlers | 172 | 66.2% |
| nativeButtons | 260 | 100.0% |
| responsive | 255 | 98.1% |
| animation | 256 | 98.5% |
| toasts | 63 | 24.2% |
| altOnImages | 260 | 100.0% |

## Anti-patterns

- Lenses with at least one `<div onClick>` (missing keyboard handler / role / tabIndex): **5** (total instances: 18)
- Lenses with inline hex colours (bypassing design tokens): **0** (total instances: 0)

## Raw-tier lenses (need work)

| Lens | Pillars | Missing | Files |
|---|---:|---|---:|
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
| `ledger` | 4/5 | responsive | 0 |
| `move-builder` | 4/5 | responsive | 0 |
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