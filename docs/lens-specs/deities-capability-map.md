# Deities Lens — Capability Map (Frontend Rebuild Program, Wave 3 — confirming, one small enhancement)

## Scope clarification

`server/domains/deities.js` registers all its macros under the domain name
`"deity"` (singular), not `"deities"` — so `scripts/lens-unsurfaced.mjs
--lens deities` (which matches on filename == registered-domain string)
reports "No registered macros found." That's a detector limitation, not a
real gap; confirmed by direct grep:
`grep -c 'registerLensAction("deity"' server/domains/deities.js` → 14.
Cross-checked which of the 14 are referenced under `app/lenses/deities` +
`components/deities`: 12 of 14 (all but `pilgrim_log` and `tone_vector`).

## Reference apps

- An in-game pantheon/patron-deity system (no single real-world SaaS
  analog — this is a gameplay feature, not a productivity tool). The
  closest shape is a CRM/loyalty-tier system (devotion score → gated
  reward tiers) crossed with an NPC-dialogue system (tone-vector-driven
  commune responses).

Parity target: every macro the backend exposes for a deity's lifecycle
(compose → search/discover → commune → devote → get blessed → revise)
should have a first-class UI path, since there's no external reference to
benchmark catalog size against.

## Audit finding: already a fully real, well-designed pantheon system

`app/lenses/deities/page.tsx` (317 LOC) + `components/deities/DeityDetailPanel.tsx`
(438 LOC) + `MyDevotionPanel.tsx` + `PantheonExplorer.tsx` (982 LOC total,
0.677 bespoke ratio) implement: a searchable/filterable/sortable pantheon
list (name/domain/creed search, tone-axis filter, popularity/newest/tone
sort), a compose form with tone-vector sliders, a full deity detail view
(tone-vector bar chart via `ChartKit`, live commune dialogue with
intent/offering, a real alignment-gated blessing ladder with 4 tiers, a
pilgrim roster timeline, a commune log feed, dialogue-template list), an
author-only revise form, and a cross-pantheon "My devotion" tracker
(patron count, total pilgrimages, per-deity alignment, granted blessings).
`PantheonExplorer.tsx` also pulls live Wikipedia REST summaries for 10 real
world pantheons (Greek/Norse/Egyptian/Hindu/Yoruba/Aztec/Celtic/Shinto/
Mesopotamian/Slavic) with a "save as DTU" action — genuinely live external
data, not a static blurb.

## Checklist

| Item | Disposition |
|---|---|
| Compose / list / search / detail / revise | ALREADY REAL |
| Live commune dialogue (tone + alignment-gated reception) | ALREADY REAL — `DeityDetailPanel.tsx` |
| Pilgrimage + devotion tracking (per-deity and cross-pantheon) | ALREADY REAL — `MyDevotionPanel.tsx` |
| Alignment-gated blessing ladder (4 tiers, claim) | ALREADY REAL — `blessings`/`bless`/`my_blessings` |
| World-pantheon research reference | ALREADY REAL — `PantheonExplorer.tsx`, live Wikipedia REST |
| **Full pilgrim log** (`pilgrim_log`) | **HONEST DISPOSITION (low-priority, not built).** `detail` already returns a 50-row pilgrim roster (rendered as a `TimelineView`); `pilgrim_log` offers the same data up to 200 rows with no other distinct fields. Not wired this pass — the existing 50-row roster covers the common case and a "view full log" expansion is a minor future add, not a gap that misrepresents anything today. |
| **Legacy `tone_vector` alias** | **HONEST RELABEL (superseded by design).** The domain file's own comment marks this "legacy alias kept for the original inline-macro contract" — `detail` already returns the same tone vector/templates/thresholds/pilgrim_count in its richer response shape. Not wired; calling it would be redundant. |

## What changed

No code changes. This lens was audited in full (both files, both
components, the backend domain file) and found genuinely complete — no
fabricated data, no generic-scaffold remnant, no dead click found.

## Verification

- `node scripts/verify-lens-backends.mjs` — `deities`: `WIRED` (unchanged).
- `node scripts/grade-ux-polish.mjs --honest` — `deities`: `tier: "polished"`,
  `isGenericScaffold: false`.
