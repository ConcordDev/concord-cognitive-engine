# UX Polish Audit — HONEST mode

Generated: 2026-10-31T23:36:22.642Z

Mode: **honest**

Lenses scanned: 268


> Honest mode demotes lenses that are still the generated scaffold
> (generic ManifestActionBar + AutoActionStrip + RecentMineCard trio
> + a generic `<UniversalActions>`/`<LensFeaturePanel>` body on a thin
> page with no substantial bespoke component) from `polished` →
> `functional`. Lenses with a bespoke page, a flagship-scale component,
> or a custom body that dropped the generic wrappers are NOT capped.
> **1 lenses capped** (of 1 detected as generic scaffolds).

## Tier distribution

| Tier | Count | % | Weight |
|---|---:|---:|---:|
| raw | 0 | 0.0% | 0.2 |
| functional | 6 | 2.2% | 0.6 |
| polished | 262 | 97.8% | 1 |

**Weighted UX polish score: 0.991** (1.0 = all polished)

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

## Generic-scaffold lenses capped this run (polished → functional)

These import the generic trio, lean on the `<UniversalActions>`/`<LensFeaturePanel>` template body, and have neither a bespoke page (≥700 LOC) nor a flagship-scale component (≥1000 LOC). Rebuild target: real designed product UI.

| Lens | Page LOC | Max component LOC | Bespoke ratio |
|---|---:|---:|---:|
| `__ux_polish_scaffold_fixture__` | 25 | 0 | 0 |

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
| `__ux_polish_scaffold_fixture__` | 5/5 |  | 0 |

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