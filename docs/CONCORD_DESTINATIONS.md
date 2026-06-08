# Concord — The 25 Destinations (editable draft)

> **Status: IMPLEMENTED (2026-06-08).** The Core-6 + grouped "Destinations" sidebar tier
> (`lib/destinations.ts`), the per-destination workspace tab bar (`components/common/DestinationNav.tsx`),
> and the cross-mount affinity map (`lib/panel-affinity.ts` + `lib/panel-registry.ts`) are shipped.
> Edit this file to re-curate (move lenses between destinations, adjust cross-mount panels) and the
> changes flow through. All 259 lenses remain reachable.

## Why this IS the polish strategy (not a tradeoff against it)

A 259-surface "do-everything" app *reads* as unpolished for a structural reason — the
Starfield-density trap: a thousand shallow tiles feel like a thousand unfinished things, and no
team (let alone one person) can buff 259 surfaces to incumbent depth. Concord's answer is the
super-lens consolidation, and it's a **deliberate polish/UX architecture**, not a breadth play:

- **Consolidate the front door to ~25 destinations**, and make each one *deep* via the two knobs
  below — absorbed sub-lenses as workspace tabs **+** cross-mounted panels. Finance reaches
  Robinhood-class depth precisely because it absorbs `markets`/`wallet`/`staking`/`ledger` and
  cross-mounts the crypto/accounting/energy panels — it's engineered to be a real app, not a tile.
- **Keep all 259 reachable** (Hub / ⌘K / sub-lens tree) for focused + power use, so consolidation
  costs nothing in capability.
- Net: **depth-by-composition on the front door, breadth-on-demand behind it.** You don't polish
  259 surfaces; you compose ~25 deep ones and hold the rest one keystroke away.

So "would Concord lose a polish fight?" is the wrong frame (corrected from an earlier lazy
absolute): on a *single* incumbent's home screen they have more polish *depth* (big team × years ×
one surface), but that's a fight nobody is choosing Concord to win. On the fight that matters —
**coherent, real-feeling depth across an enormous surface area, held on one design system from one
builder** — Concord is genuinely strong, and the consolidation model is *why*. The polish gaps the
2026-06-08 pass actually found were cleanup-grade (demo-stage chrome, FAB clutter), not structural.

## The model (what's shipped)

- **Sidebar = Core 6 (prominent) + a collapsible "Destinations" group (~19).** 25 "full version"
  workspaces total. (Your chosen density: Core 6 up top, the other 19 one click away.)
- **Everything else stays reachable, unchanged:** the **Lens Hub** (`/hub`, `/lenses/all`), the
  **Sub-Lens tree**, the **Extensions** section, and **⌘K**. All 259 lenses remain available.
- **Two depth knobs per destination** (both mechanisms already shipped):
  1. **Absorbs** = sub-lenses that fold under it as **nav tabs** (`coreLens`/`absorbedLensIds` +
     `getAbsorbedLenses`). *Exclusive:* a lens has exactly **one** home (the `ABSORPTION_MAP`).
  2. **Cross-mount panels** = panels from OTHER lenses surfaced **in-page** + summonable
     (`lib/panel-affinity.ts`). *Non-exclusive:* a panel can deepen many destinations.
- **Overlap rule:** if a capability is relevant to two destinations, it gets ONE home (absorb) and
  is **cross-mounted** into the other (panel). e.g. `wallet`'s home is `crypto`; it cross-mounts a
  portfolio panel into `finance`. No lens is duplicated as a nav child.

**Legend for cross-mount panels:** ✓ already in `lib/panel-registry.ts` · ✚ needs registering
(must be a self-contained no-prop/`onChange`-only panel — verified at build time).

---

## CORE (6) — unchanged homes, prominent in sidebar

| Destination | Absorbs (nav tabs) | Cross-mount panels (in-page) |
|---|---|---|
| **world** — Concordia 3D | courtship, fishing, creatures, garage, kingdoms, sub-worlds, quests, questmarket, spectate, deities, goddess, expedition-journal, training-room, move-builder | (in-world HUD PanelHost already; Part-4 later) |
| **chat** — think out loud | thread, forum, daily, anon, voice, news | ✚`research.answers`, ✚`grounding.factcheck` |
| **code** — build & ship | debug, database, repos, code-quality, dx-platform, app-maker, foundry, sandbox, fork, queue, schema | ✓`code-quality.pr-decoration`, ✓`observe.action`, ✚`repos.activity` |
| **board** — get things done | goals, timeline, srs, productivity, household, tools | ✚`finance.bills`, ✚`calendar.agenda` |
| **studio** — create anything | art, fractal, game, sim, ar, animation, film-studios, game-design, artistry, creative-writing, poetry | ✚`music.session`, ✚`gallery.recent` |
| **graph (atlas)** — connect everything | schema, entity, temporal, eco, meta, codex, worldmodel, commonsense | ✚`research.citations`, ✚`history.timeline` |

> *Decisions in Core:* `music`, `whiteboard`, `calendar`, `photography/gallery`, `feed`, `council`
> currently live under a core. This draft **promotes** several to their own destinations (below) —
> strike them from the core's `absorbs` if you agree, or keep them folded and delete the new
> destination row.

---

## WORK (7)

| Destination | Absorbs (nav tabs) | Cross-mount panels (in-page) |
|---|---|---|
| **finance** | markets, market, wallet, staking, insurance, billing, ledger | ✓`crypto.portfolio`, ✓`accounting.budgets`, ✓`accounting.ratios`, ✓`energy.billing` |
| **accounting** | (own tabs: ledger/invoicing/payroll/tax) | ✓`accounting.budgets`, ✓`accounting.ratios`, ✚`finance.networth`, ✚`tax.estimator` |
| **healthcare** | pharmacy, mental-health, fitness, wellness, veterinary, organ, meditation | ✓`wellness.daily-recommendation`, ✓`wellness.cbt`, ✓`fitness.training`, ✓`pharmacy.adherence`, ✓`pharmacy.price-lookup` |
| **legal** | law, disputes, ethics, audit, privacy, compliance | ✚`docs.review`, ✚`law.deadline` |
| **projects** | consulting, careers, hr, services, logistics, supplychain, manufacturing, ops, crisis-ops, command-center | ✚`projects.gantt`, ✚`analytics.forecast` |
| **analytics** | forecast, inference, ml, hypothesis, attention, ops-telemetry, repair-telemetry | ✓`observe.action`, ✚`finance.markets-pulse` |
| **marketplace** | auction, retail, black-market, sponsorship, marketing, realestate, housing | ✓`crypto.portfolio`, ✚`creator.royalties` |

---

## CREATE (4 new destinations — promoted out of cores)

| Destination | Absorbs (nav tabs) | Cross-mount panels (in-page) |
|---|---|---|
| **music** *(out of studio)* | (own tabs: tracks/artists/playlists/session) | ✚`music.session`, ✚`music.eq`, ✓`food.discover` (vibe) |
| **whiteboard** *(out of board)* | (own canvas/moodboard) | ✚`graph.local`, ✚`board.tasks` |
| **creator** — creator economy | fashion, photography, gallery, photos | ✚`marketplace.listings`, ✚`creator.royalties` |
| **crypto** — wallet/DeFi | (own tabs: holdings/trade) | ✓`crypto.portfolio`, ✓`accounting.ratios` |

---

## KNOWLEDGE (4)

| Destination | Absorbs (nav tabs) | Cross-mount panels (in-page) |
|---|---|---|
| **research** | paper, science, philosophy, linguistics, history, education, classroom, mentorship, debate, answers, reasoning, grounding, cognition, metacognition, understanding | ✚`grounding.factcheck`, ✓`astronomy.targets` |
| **lab** — STEM + trades | physics, chem, quantum, materials, math, engineering, robotics, astronomy, space, geology, ocean, environment, energy, aviation, electrical, hvac, plumbing, welding, carpentry, masonry, construction, mining, forestry, agriculture, landscaping, urban-planning | ✓`astronomy.targets`, ✚`math.cas`, ✚`chem.periodic` |
| **calendar** *(out of board)* | events, event-timeline, sessions | ✚`calendar.agenda`, ✚`board.goals` |
| **agents** | personas, automation | ✚`agents.runs`, ✚`observe.action` (✓ exists) |

> *Note:* `lab` absorbs ~25 STEM+trades lenses — that's the densest. Consider **splitting** into
> `lab` (science) + `trades` (build trades) → that would make **26**. Your call; easy either way.

---

## COMMS (4 → total 25; drop one if you want 24)

| Destination | Absorbs (nav tabs) | Cross-mount panels (in-page) |
|---|---|---|
| **message** | mail | ✚`social.feed`, ✚`council.sessions` |
| **social (feed)** *(out of chat)* | feed, social | ✚`social.activity` |
| **council** *(out of chat)* | council, vote, debate, governance, government, alliance, federation, civic-bonds | ✚`council.sessions`, ✚`legal.disputes` |

*(Counting: Core 6 + Work 7 + Create 4 + Knowledge 4 + Comms 3 = **24**. The `lab`/`trades`
split makes 25, or add a 25th destination of your choosing — `command-center`/`ops` is a candidate.)*

---

## What I build once you sign off

1. **`lens-registry.ts`** — add a `tier: 'destination'` flag (+ a `group` field:
   core/work/create/knowledge/comms) to the ~25 entries; update each destination's
   `absorbedLensIds` per the "Absorbs" columns (moves the promoted lenses out of their old cores).
2. **`Sidebar.tsx`** — render **Core 6** as today + a collapsible **"Destinations"** section
   grouped by `group`. Hub / sub-lens tree / extensions / ⌘K untouched (still cover all 259).
3. **`lib/panel-affinity.ts`** — extend from 3 → all 25 destinations using the "Cross-mount panels"
   columns; **register the ✚ panels** in `panel-registry.ts` (each verified self-contained first).
4. **Tests** — extend `tests/lib/panel-registry.test.ts`: every destination id is a real lens,
   every affinity panel resolves, density cap holds; + a registry-coverage check that every
   `tier:'destination'` lens has a page.

**Edit anything above** — destinations, the absorb lists, the panel picks, the groupings, the
24-vs-25-vs-26 count. When it reads right to you, I'll implement it exactly.
