# UX Polish Audit

Generated: 2026-06-21T00:54:04.593Z

Lenses scanned: 259


## Tier distribution

| Tier | Count | % | Weight |
|---|---:|---:|---:|
| raw | 6 | 2.3% | 0.2 |
| functional | 17 | 6.6% | 0.6 |
| polished | 236 | 91.1% | 1 |

**Weighted UX polish score: 0.955** (1.0 = all polished)

## Signal coverage (% of lenses)

| Signal | Lenses with it | % |
|---|---:|---:|
| loading | 247 | 95.4% |
| emptyState | 254 | 98.1% |
| errorUI | 233 | 90.0% |
| aria | 245 | 94.6% |
| keyboardHandlers | 168 | 64.9% |
| nativeButtons | 255 | 98.5% |
| responsive | 249 | 96.1% |
| animation | 243 | 93.8% |
| toasts | 58 | 22.4% |
| altOnImages | 259 | 100.0% |

## Anti-patterns

- Lenses with at least one `<div onClick>` (missing keyboard handler / role / tabIndex): **6** (total instances: 22)
- Lenses with inline hex colours (bypassing design tokens): **0** (total instances: 0)

## Raw-tier lenses (need work)

| Lens | Pillars | Missing | Files |
|---|---:|---|---:|
| `codex` | 1/5 | empty, error, a11y, responsive | 1 |
| `ledger` | 1/5 | empty, error, a11y, responsive | 1 |
| `move-builder` | 0/5 | loading, empty, error, a11y, responsive | 1 |
| `repair-telemetry` | 2/5 | loading, error, responsive | 1 |
| `spectate` | 2/5 | loading, empty, error | 1 |
| `translation` | 2/5 | loading, empty, responsive | 1 |

## Functional-tier lenses (one pillar away from polished)

Sorted by smallest gap first. Items with anti-patterns surface first within each pillar-count.

| Lens | Pillars | Missing | Anti-patterns |
|---|---:|---|---:|
| `art` | 5/5 | anti-patterns(1 div-button, 0 inline-hex) | 1 |
| `message` | 5/5 | anti-patterns(2 div-button, 0 inline-hex) | 1 |
| `studio` | 5/5 | anti-patterns(1 div-button, 0 inline-hex) | 1 |
| `whiteboard` | 5/5 | anti-patterns(1 div-button, 0 inline-hex) | 1 |
| `world` | 5/5 | anti-patterns(13 div-button, 0 inline-hex) | 1 |
| `auction` | 4/5 | error, anti-patterns(4 div-button, 0 inline-hex) | 1 |
| `achievements` | 3/5 | loading, error | 0 |
| `announcements` | 3/5 | loading, error | 0 |
| `careers` | 3/5 | error, responsive | 0 |
| `civic-bonds` | 3/5 | error, responsive | 0 |
| `courtship` | 3/5 | error, responsive | 0 |
| `detective` | 3/5 | loading, error | 0 |
| `housing` | 3/5 | loading, error | 0 |
| `lfg` | 3/5 | loading, error | 0 |
| `mail` | 3/5 | loading, error | 0 |
| `narrative-walk` | 3/5 | loading, error | 0 |
| `photos` | 3/5 | loading, error | 0 |

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