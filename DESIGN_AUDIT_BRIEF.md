# CONCORD LENS DESIGN AUDIT — INDIVIDUAL LENS UPGRADE

## BASELINE STATUS
The functional QA baseline is GREEN. This is a DESIGN-ONLY audit. Do NOT
modify code, do NOT propose shared components, do NOT make cross-lens
recommendations.

## CRITICAL CONSTRAINTS
DO NOT propose, create, refactor, or depend on:
- shared UI components
- shared lens shells
- shared design systems
- global component abstractions
- cross-lens UI refactors
- design tokens that span lenses
- "extract to a primitive" patterns
- consistency-for-its-own-sake

Concord's existing shared-component approach has historically caused breakage
and regressions. Preserve the independence of each lens.

Every lens must be evaluated independently.

## EVALUATE FOR EACH LENS
- the actual rendered structure
- existing functionality
- existing capability documentation
- current visual hierarchy
- controls and interactions
- data presentation
- loading/empty/error states
- responsive layout
- typography
- spacing
- imagery/icons
- color usage
- animation/motion where appropriate
- overall visual identity

## THE GOAL
Produce an actionable blueprint for upgrading the appearance and UX of
THAT SPECIFIC LENS — not for making it look like other lenses.

The design audit should uncover each lens's distinct identity rather than
flatten it. A healthcare lens might want a clinical dashboard composition.
A DTU lens might want a dense technical/data-oriented composition. A literary
lens might benefit from a completely different visual language. A marketplace
lens might need another.

The goal: each lens is individually excellent, while still unmistakably
belonging to Concord.

## OUTPUT FORMAT (per lens — REQUIRED)

```
LENS:
PURPOSE:

CURRENT DESIGN:
- What the lens currently looks like
- What works visually
- What feels unfinished
- What feels generic
- What feels cluttered
- What feels empty
- What information is visually buried

DESIGN DIRECTION:
Describe the ideal visual direction for this particular lens.
Do NOT make it generic. Do NOT say "make it cleaner."
Explain what the lens should visually feel like.

LAYOUT UPGRADE:
Describe the proposed page composition from top to bottom.
- header treatment
- hero/primary information area
- primary workspace
- secondary information
- controls
- supporting panels
- footer/secondary navigation
Be specific about placement and hierarchy.

COMPONENT-LEVEL CHANGES:
List the actual existing UI elements that should be changed.
For each: CURRENT → PROPOSED
Example: "Current dense 4-column stat grid → large primary metric with contextual trend visualization"

VISUAL UPGRADES:
- typography
- spacing
- sizing
- hierarchy
- borders
- surfaces
- iconography
- imagery
- charts
- backgrounds
- motion
- interaction states

CAPABILITY PRESENTATION:
Identify existing capabilities that are poorly presented.
For each: CAPABILITY → CURRENT PRESENTATION → BETTER PRESENTATION
Do not invent new backend functionality.

LENS IDENTITY:
Explain what makes this lens visually distinct from other Concord lenses
and how the design should communicate that identity.

RESPONSIVE DESIGN:
Give specific recommendations for desktop, tablet, and mobile.

BEFORE/AFTER CONCEPT:
Describe what a user would see before and after the proposed redesign.

IMPLEMENTATION PLAN:
Give an ordered list of concrete UI changes that a worker could execute.

PRIORITY:
P0 = major visual/UX deficiency
P1 = significant improvement
P2 = polish
P3 = optional refinement

DESIGN SCORE: /10
UPGRADE POTENTIAL: /10
```

## IMPORTANT
The output must contain enough information that a coding worker can take the
lens-specific recommendation and implement the redesign WITHOUT having to
rediscover the design problem.

## WORKFLOW
1. Audit only — no code modifications
2. Final deliverable: a complete lens-by-lens design upgrade blueprint
3. STOP after audit. Do not begin implementing.

## EXISTING ARTIFACTS TO REFERENCE
- `audit/LENS_DESIGN_UPGRADE_PLAN.md` (1931 lines, per-lens Tier 1/2/3 plans)
- `audit/UI_POLISH_AUDIT.md`
- `audit/ux-polish-honest.json` (machine-readable per-lens data)
- `audit/audit_design_2026-08-17/` (locally mirrored audit files)

## TIMING
30-45 minutes per batch. Write tight, evidence-based findings.
Skip lenses that are genuinely well-designed — score them, note "no upgrades
needed", move on.

## RANKING (after all batches complete)
P0 — redesign immediately
P1 — major visual upgrade
P2 — polish
P3 — already strong

P0 for Healthcare doesn't have to resemble P0 for DTUs.
Each lens's P0 reflects its own visual problem.
