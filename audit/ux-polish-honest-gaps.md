# UX Polish Audit — HONEST mode

Generated: 2026-07-09T11:45:29.223Z

Mode: **honest**

Lenses scanned: 260


> Honest mode demotes lenses that are still the generated scaffold
> (generic ManifestActionBar + AutoActionStrip + RecentMineCard trio
> + a generic `<UniversalActions>`/`<LensFeaturePanel>` body on a thin
> page with no substantial bespoke component) from `polished` →
> `functional`. Lenses with a bespoke page, a flagship-scale component,
> or a custom body that dropped the generic wrappers are NOT capped.
> **55 lenses capped** (of 55 detected as generic scaffolds).

## Tier distribution

| Tier | Count | % | Weight |
|---|---:|---:|---:|
| raw | 0 | 0.0% | 0.2 |
| functional | 55 | 21.2% | 0.6 |
| polished | 205 | 78.8% | 1 |

**Weighted UX polish score: 0.915** (1.0 = all polished)

## Signal coverage (% of lenses)

| Signal | Lenses with it | % |
|---|---:|---:|
| loading | 260 | 100.0% |
| emptyState | 259 | 99.6% |
| errorUI | 260 | 100.0% |
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

## Generic-scaffold lenses capped this run (polished → functional)

These import the generic trio, lean on the `<UniversalActions>`/`<LensFeaturePanel>` template body, and have neither a bespoke page (≥700 LOC) nor a flagship-scale component (≥1000 LOC). Rebuild target: real designed product UI.

| Lens | Page LOC | Max component LOC | Bespoke ratio |
|---|---:|---:|---:|
| `alliance` | 108 | 697 | 0.877 |
| `animation` | 508 | 958 | 0.783 |
| `anon` | 363 | 758 | 0.703 |
| `ar` | 616 | 905 | 0.624 |
| `artistry` | 525 | 330 | 0.832 |
| `astronomy` | 474 | 990 | 0.856 |
| `atlas` | 543 | 537 | 0.904 |
| `audit` | 621 | 932 | 0.677 |
| `bio` | 471 | 833 | 0.794 |
| `chem` | 691 | 782 | 0.73 |
| `custom` | 656 | 691 | 0.543 |
| `defense` | 437 | 360 | 0.852 |
| `desert` | 433 | 340 | 0.789 |
| `emergency-services` | 526 | 561 | 0.645 |
| `energy` | 606 | 344 | 0.771 |
| `export` | 697 | 549 | 0.488 |
| `fashion` | 646 | 212 | 0.727 |
| `forestry` | 455 | 221 | 0.764 |
| `fork` | 649 | 660 | 0.594 |
| `fractal` | 343 | 718 | 0.696 |
| `geology` | 636 | 224 | 0.679 |
| `grounding` | 658 | 813 | 0.648 |
| `history` | 665 | 472 | 0.774 |
| `hr` | 449 | 277 | 0.852 |
| `lab` | 532 | 902 | 0.649 |
| `law` | 687 | 299 | 0.637 |
| `legacy` | 415 | 606 | 0.62 |
| `marketing` | 579 | 306 | 0.831 |
| `materials` | 404 | 654 | 0.804 |
| `mentorship` | 696 | 322 | 0.7 |
| `metalearning` | 603 | 205 | 0.662 |
| `mining` | 416 | 300 | 0.774 |
| `ml` | 159 | 285 | 0.923 |
| `neuro` | 417 | 801 | 0.735 |
| `ocean` | 579 | 634 | 0.726 |
| `offline` | 187 | 489 | 0.906 |
| `parenting` | 405 | 361 | 0.83 |
| `pets` | 473 | 551 | 0.855 |
| `pharmacy` | 691 | 684 | 0.801 |
| `philosophy` | 591 | 957 | 0.724 |
| `platform` | 583 | 630 | 0.792 |
| `projects` | 528 | 537 | 0.835 |
| `quantum` | 680 | 265 | 0.387 |
| `questmarket` | 149 | 337 | 0.926 |
| `queue` | 637 | 156 | 0.436 |
| `reflection` | 487 | 963 | 0.811 |
| `robotics` | 192 | 260 | 0.887 |
| `schema` | 509 | 963 | 0.669 |
| `space` | 683 | 225 | 0.756 |
| `suffering` | 280 | 348 | 0.829 |
| `supplychain` | 260 | 894 | 0.824 |
| `transfer` | 425 | 667 | 0.634 |
| `travel` | 607 | 777 | 0.804 |
| `urban-planning` | 410 | 432 | 0.82 |
| `veterinary` | 173 | 345 | 0.938 |

## Raw-tier lenses (need work)

_None — every lens has at least 3 of 5 structural pillars._

## Functional-tier lenses (one pillar away from polished)

Sorted by smallest gap first. Items with anti-patterns surface first within each pillar-count.

| Lens | Pillars | Missing | Anti-patterns |
|---|---:|---|---:|
| `alliance` | 5/5 |  | 0 |
| `animation` | 5/5 |  | 0 |
| `anon` | 5/5 |  | 0 |
| `ar` | 5/5 |  | 0 |
| `artistry` | 5/5 |  | 0 |
| `astronomy` | 5/5 |  | 0 |
| `atlas` | 5/5 |  | 0 |
| `audit` | 5/5 |  | 0 |
| `bio` | 5/5 |  | 0 |
| `chem` | 5/5 |  | 0 |
| `custom` | 5/5 |  | 0 |
| `defense` | 5/5 |  | 0 |
| `desert` | 5/5 |  | 0 |
| `emergency-services` | 5/5 |  | 0 |
| `energy` | 5/5 |  | 0 |
| `export` | 5/5 |  | 0 |
| `fashion` | 5/5 |  | 0 |
| `forestry` | 5/5 |  | 0 |
| `fork` | 5/5 |  | 0 |
| `fractal` | 5/5 |  | 0 |
| `geology` | 5/5 |  | 0 |
| `grounding` | 5/5 |  | 0 |
| `history` | 5/5 |  | 0 |
| `hr` | 5/5 |  | 0 |
| `lab` | 5/5 |  | 0 |
| `law` | 5/5 |  | 0 |
| `legacy` | 5/5 |  | 0 |
| `marketing` | 5/5 |  | 0 |
| `materials` | 5/5 |  | 0 |
| `mentorship` | 5/5 |  | 0 |
| `metalearning` | 5/5 |  | 0 |
| `mining` | 5/5 |  | 0 |
| `ml` | 5/5 |  | 0 |
| `neuro` | 5/5 |  | 0 |
| `ocean` | 5/5 |  | 0 |
| `offline` | 5/5 |  | 0 |
| `parenting` | 5/5 |  | 0 |
| `pets` | 5/5 |  | 0 |
| `pharmacy` | 5/5 |  | 0 |
| `philosophy` | 5/5 |  | 0 |
| `platform` | 5/5 |  | 0 |
| `projects` | 5/5 |  | 0 |
| `quantum` | 5/5 |  | 0 |
| `questmarket` | 5/5 |  | 0 |
| `queue` | 5/5 |  | 0 |
| `reflection` | 5/5 |  | 0 |
| `robotics` | 5/5 |  | 0 |
| `schema` | 5/5 |  | 0 |
| `space` | 5/5 |  | 0 |
| `suffering` | 5/5 |  | 0 |

_…and 5 more functional-tier lenses; full list in `audit/ux-polish.json`._

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