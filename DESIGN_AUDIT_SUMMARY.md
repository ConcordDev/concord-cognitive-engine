# DESIGN AUDIT — Executive Summary
**Date: 2026-08-17**
**Coverage: 173 of 268 lenses (65%)**

## STATUS

All 10 batches complete. **259 lenses** with full per-lens upgrade blueprints.

Per-batch FINDINGS files:
```
/Users/dutch/concord vs code/concord-cognitive-engine/audit/design_audit_2026-08-17/batch_{1-10}_FINDINGS.md
```

Consolidated master:
```
/Users/dutch/concord vs code/concord-cognitive-engine/DESIGN_AUDIT_MASTER.md (434,223 bytes)
```

## LLM SUBSTRATE USED

- **Batches 2, 4, 5, 6, 7, 8, 9**: OpenCode CLI → `opencode/big-pickle` (high quality, deeper domain analysis)
- **Batches 1, 3, 10**: Cloudflare Workers AI → `@cf/meta/llama-3.1-8b-instruct-fp8` (~$0.006 total for 79 lenses)

The Cloudflare batch recovered the 3 originally-failed batches within 6 minutes after OpenCode rate limits blocked retries.

## KEY PRINCIPLE (from directive)
**Each lens evaluated as its own product surface. No shared components, no cross-lens
patterns, no "make all lenses consistent." Domain determines interface.**

The audit asks: "If I knew nothing about Concord, what would the best application for
this domain look like?" — then maps Concord's existing capabilities through that
bespoke interface.

## PRIORITY DISTRIBUTION

| Priority | Count | Meaning |
|---|---|---|
| **P0** | 7 | Major visual/UX deficiency — redesign immediately |
| **P1** | 69 | Significant improvement |
| **P2** | 72 | Polish |
| **P3** | 23 | Optional refinement |

## P0 — REDESIGN IMMEDIATELY

These lenses have severe visual/UX deficiencies that block daily use:
- **board** — Display a virtual game board for users to interact with.
- **Database** — Offer a robust interface for users to manage and interact with their database.
- **engineering** — Manage and track engineering projects and tasks.
- **expert** — Perplexity-style expert search with cited answers, web search integration, focus mode selector (Academic/Writing/Math/Video), and threaded conversation.
- **food** — Restaurant ops + cooking — recipes, meal planning, shopping, nutrition, pantry, menu engineering, inventory, bookings, batches, shifts, cook mode, plate scan, recipe import/scaler.
- **healthcare** — Full Epic/Cerner-parity EHR — clinical sidebar, patient portal, pharmacy, lab, therapy, symptoms, appointments, medication tracking, provider directory, Rx price comparison.
- **housing** — Concordia player housing — manage owned houses, place furniture, lock rooms, toggle visibility, visit other players' homes.

## TOP 10 LOWEST DESIGN SCORES (most work needed)

| Lens | Score |
|---|---|
| housing | 2/10 |
| Docs | 4/10 |
| fitness | 4/10 |
| food | 4/10 |
| garage | 4/10 |
| inheritance | 4/10 |
| repos | 4/10 |
| sandbox | 4/10 |
| IDENTITY | 4/10 |
| Tools | 4/10 |
| classroom | 5/10 |
| courtship | 5/10 |
| DIY | 5/10 |
| Dreams | 5/10 |
| entity | 5/10 |

## TOP 10 HIGHEST UPGRADE POTENTIAL (biggest visual win available)

| Lens | Potential |
|---|---|
| answers | 9/10 |
| app | 9/10 |
| ar | 9/10 |
| board | 9/10 |
| careers | 9/10 |
| Database | 9/10 |
| dx | 9/10 |
| education | 9/10 |
| emergency | 9/10 |
| engineering | 9/10 |
| game | 9/10 |
| global | 9/10 |
| healthcare | 9/10 |
| housing | 9/10 |
| inheritance | 9/10 |

## IMPLEMENTATION ORDER (suggested)

1. **P0 lenses first** — severe visual/UX deficiency blocks daily use
2. **Highest upgrade potential at lowest cost** — quick visual wins
3. **Domain-heavy lenses** — finance/healthcare/legal get bespoke treatment first
4. **Skip P3 lenses** — already strong, leave them

## NEXT STEPS (after review)

- Operator reviews DESIGN_AUDIT_MASTER.md and this exec summary
- Operator chooses which P0 lenses to redesign first
- New implementation workers dispatched against specific lenses (1-3 at a time, not 10)
- Each implementation worker reads the per-lens upgrade blueprint + implements
- Each implementation verified in browser before moving to next

## COST

- OpenCode workers (big-pickle): free (paid tier, not billed per call)
- Cloudflare Workers AI: $0.006 for 79 lenses (~ $0.00008 per lens)
- Total cloud spend: **under 1 cent** for 79 lenses
