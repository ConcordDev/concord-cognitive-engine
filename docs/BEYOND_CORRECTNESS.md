# Beyond Correctness — the five frontiers

Past the gates, "does it work" gives way to five harder questions. **Two are not
agent-executable** (craft + go-to-market — the human's). **Three have real engineering
substrate** (mostly instrumentation that makes the unfalsifiable *legible*, plus monitors that
extend the user-bug intake). Being straight about the line is the point. Track F (decided scope)
builds the engineering slices of all five **including the measurement scaffolding for the two
human-owned ones** — the verdict/GTM stays the human's; only the instrumentation is built.

---

## Frontier 1 — Judgment (is it *good*, not just correct) ❌ Human-owned

Not "does combat crash" but "is combat *satisfying*"; not "does the economy balance
arithmetically" but "is it fun to play, fair to lose at, worth grinding." Unfalsifiable, never
done — craft, playtesting, taste, iteration forever. A game is never "correct," only "good or
not." An agent can't decide it.

**What CAN be built — the cold-watcher (F1):** fun-funnel telemetry — where players stall,
rage-quit, abandon a quest/run/craft — surfaced so the judgment *you* make is data-informed.
The **tool-first funnel split** distinguishes solo-tool engagement (lenses/OS — value with zero
network) from network engagement (world/economy/MP), so "come for the tool, stay for the network"
is measurable. The verdict stays yours.

---

## Frontier 2 — Liveness (a reason to come back tomorrow) ✅ Tractable

A live world needs the content treadmill: events, seasons, new reasons. The question flips from
"does it work" to "does it *hold people*." Concordia's treadmill substrate already exists
(`world-event-scheduler`, seasons, festivals, `lattice-born-quests`, `weekly_objectives`
mig 272).

**Build (F2):** a **liveness dashboard** + a daily/weekly "reason to return" surface, measuring
the *right* things for a tool-first, MMO-clock, solo product (see `COLD_START_STRATEGY.md`):
- **Retention on the MMO clock** — track D1/D7/D30 for first-impression health, but **optimize
  for patch-cycle return** (a player gone 4 months who returns for a season/patch is the model
  working, not churn). Return-cohort keyed to season/event cadence, not a 7-day window.
- **Atomic-network cohort metrics** — not global DAU; **utility × density in ONE world/niche**
  (the first ~100), sliced by world + creator-niche.
- **Self-moving-world novelty health** — a heartbeat-health check that the emergent sim
  (drift→quest, faction war, scheduler, seasons) **actually emits novelty between patches** (a
  frozen sim is the failure mode — this gate catches it). This is the asset that lets a solo
  cadence be quarterly instead of a WoW treadmill.
- Discovery loop (DESIGN_NORTH_STAR §1): lean into lore mysteries/quest markers/lattice-born
  quests as undiscovered markers that keep generating breadcrumbs.

---

## Frontier 3 — People (the bugs become human) ✅ Tractable, extends Track E

Once players are in, exploits stop being `runMacro` and start being coordinated social
manipulation: cartels cornering the royalty economy, griefing, abuse. You built a world that
defends itself from NPCs (the temperament engine) — now it has to defend itself from *people*,
which is harder.

**Build (F3):** **anti-cartel / royalty-cornering detection** (extends `detectWashTrading` + E2's
economy-anomaly cycle to multi-account collusion patterns); a **griefing/abuse report path**
(extends E4 client-intake with a player-report kind); a **moderation queue + governance surface**
(reuses the existing org-governance voting). Observe + route, **no economy-behavior change.**
**Community-ops are config, not build** — governance/voting/council + volunteer-mod roles already
exist; "turn it on for the real community" is positioning the human owns.

---

## Frontier 4 — Economics (does it sustain) ✅ Tractable instrumentation

Five Ollama brains, compute, storage, the perpetual-royalty cascade balancing over years. Unit
economics. A beautiful system that costs more to run than it returns is a candle that burns out.
*(Note: at a flat compute cost, idle GPUs aren't the worry — they run the whole cognitive
substrate with zero players online; cost scales as a step-function in GPUs only if you grow huge,
which is a good problem.)*

**Build (F4) — can't *make* it profitable, can make it legible:** cost telemetry (Ollama
GPU-hours, DTU-storage growth curve, per-active-user compute); a **royalty-cascade solvency sim**
(does the perpetual cascade stay bounded over N years at projected volume — extends the cascade
math in `server/economy/royalty-cascade.js`); a unit-economics dashboard panel.

---

## Frontier 5 — Distribution (does anyone come) ❌ Human-owned — the dominant risk

The honest one: a flawless, gated, gorgeous, unique world with no players is a tree falling in an
empty forest — and Concordia has the **hardest** version of cold-start (a two-sided creator-
economy AND a multiplayer world, both needing critical mass). Most beautiful solo projects don't
die in the code; they die here. The skills that built it (relentless verifiable engineering) are
not the skills that get the first thousand people through the door. **This is now the dominant,
least-controllable risk — bigger than any bug.**

**What CAN be built (F5) — the shareability substrate:** FTUE polish (Gap-closure Track 1),
invite/referral mechanics (`world_invites` exists), share-card / deep-link instrumentation so
growth is *measurable*. **Bringing the people is yours** (see `COLD_START_STRATEGY.md` — and the
genuinely hopeful part: Concordia's architecture pre-solves much of the cold-start trap because
the *tool works solo*).

---

## The human-vs-engineering line (summary)

| Frontier | Owner | What the agent builds |
|---|---|---|
| 1 Judgment | **Human** (taste) | cold-watcher fun-funnel telemetry + tool/network funnel split |
| 2 Liveness | Engineering | liveness dashboard + return surface + novelty-health gate |
| 3 People | Engineering (+ human community-ops) | anti-cartel/abuse monitors + moderation queue |
| 4 Economics | Engineering (legibility) | cost + cascade-solvency telemetry + unit-econ panel |
| 5 Distribution | **Human** (GTM) | share/referral/deep-link instrumentation + FTUE |

All Track-F builds are kill-switched, tested, and **make no economy-behavior change.** The
strategy is the human's to execute; the docs + the instrumentation make it data-informed.
