# The Five Living-Product Concerns — what to worry about once correctness is solved (research)

## 0. The five, ranked by risk

Once the L0–L5 gates are green and the user-bug intake runs, the remaining concerns are **not bugs** —
they're the open-ended realities of a living product. Honest risk ranking for Concordia:

1. **Distribution** (does anyone come) — dominant, least controllable. *[deep: see COLD_START_AND_LIVEOPS]*
2. **Economics** (does it sustain) — and there's a concrete cold-start cost trap, below.
3. **People** (community health / social exploits) — amplified by the creator economy.
4. **Judgment** (is it *good*) — unfalsifiable, and hard to do at solo scale.
5. **Liveness** (reason to return) — most de-risked, because the world self-moves. *[deep: see COLD_START_AND_LIVEOPS]*

This doc goes deep on the three not covered by the cold-start research: **Judgment, People, Economics.**

---

## 1. Judgment — is it *good*? (craft, never "correct")

**Frameworks (Games User Research):** playtesting is the only real instrument — 1-on-1 observation,
group sessions, post-session interviews, and standardized instruments like the **Game Experience
Questionnaire (GEQ)** / **Intrinsic Motivation Inventory (IMI)**. Quant via **telemetry** (where do
players drop, struggle, rage-quit); biometrics (HR, facial) for deep studies. **Juice** (excessive
feedback per input) is the proven lever for making actions *feel* good. Test in stages: **scattershot**
(which abilities/loops are fun) → **experience** (does the whole thing cohere).

**Concordia's exposure:**
- The "is it fun" surface is *enormous* (253 lenses + action combat + a player economy + an emergent
  sim) — and "fun" is unfalsifiable. **A solo dev cannot playtest all of this alone.** This is the real
  constraint: your own taste can't cover the surface, and you're too close to it.
- The **emergent sim is double-edged**: emergence can be *magic* (a scheme that surprises you) or
  *incoherent noise* (NPCs doing nonsense). It needs *curation/taste*, not just code.
- You already have the **juice** layer (GameJuice, the Concord Link juice helpers) — the feel-good
  feedback lever is built; the question is whether the *loops* underneath are fun.

**What to do:**
- **Make the atomic network double as the playtest cohort** — the first ~100 engaged users ARE your GUR
  panel. Watch them via telemetry (you have macro-telemetry + Grafana), not just opinions.
- **Focus playtesting on the two core loops**, not all 253 lenses: the onboarding loop
  (cook→eat→fight→commune) and the creative loop (create→cite→royalty). If those two aren't *fun and
  fair*, nothing else matters; if they are, the rest is breadth.
- **Trust telemetry + testers over your own taste** — the hardest discipline for a solo creator, and the
  one that separates "good" from "good in my head."

---

## 2. Liveness — reason to return (summary; deep in COLD_START_AND_LIVEOPS)

MMO timescale (patch-cycle return, not mobile D7-or-gone). Habit loops you already have (daily rituals /
weekly objectives / seasons / festivals). **The self-moving world is the unfair advantage** — the
emergent sim + self-improving substrate generate content between patches, so a *quarterly* (EVE-style)
cadence is survivable solo. This is the *most* de-risked pillar.

---

## 3. People — the bugs become human (the creator-economy magnet)

**Frameworks:** moderation must be **central from conception, not bolted on**; modern T&S uses
**behavioral pattern tracking across sessions**, not reactive keyword filters; **toxicity spreads through
networks, not individuals** — target the *clusters* who disproportionately misbehave, don't whack-a-mole
each user; **positive/endorsement systems** incentivize good play. On economies: **RMT / gold-farming
overproduction damages the virtual economy** — organized groups exploit the economic safety system and
break the player-growth model.

**Concordia's exposure — this is its HIGHEST human risk, because of the creator economy:**
- A **player-created economy with perpetual royalties** is a *magnet* for coordinated manipulation:
  cartels cornering royalty lineages, wash-trading to farm cascades, content-farming low-effort DTUs for
  royalty income, **RMT of Concord Coin**, and the self-wager-class exploits (legal-but-degenerate).
- The **temperament engine defends the *world* from NPCs** — but the **economy needs defending from
  coordinated *players***, which is harder (it's social, not mechanical). You can't anti-cheat your way
  out of a cartel.
- You already have **`detectWashTrading`** (a real head start) + **governance/council/voting systems**
  (which can become *player* governance).

**What to do:**
- **Behavioral cluster detection** — extend `detectWashTrading` into an economy-manipulation monitor that
  flags *networks* (royalty-cycle rings, dupe patterns, coordinated wash) — not individual transactions.
- **RMT detection** + the existing withdrawal-hold (48h) as the anti-exploit gate.
- **Endorsement / positive-play systems** (you have skill/achievement/reputation substrate — turn it
  toward social health).
- **Recruit volunteer moderators early** and **turn the in-game governance on the real community** — the
  player-driven social layer needs human stewards *before* it needs more code.

---

## 4. Economics — does it sustain? (and a concrete cold-start cost trap)

### 4a. Virtual-economy balance (faucets vs sinks)
**Framework:** balance currency/item *creation* (faucets) against *removal* (sinks). If faucet output
scales with player count / game age without matching sinks, **currency value collapses (inflation)**.
The biggest MMO sinks are **marketplace cuts (5–15%)**.
- **Concordia's faucet risk:** the **perpetual royalty cascade** is a *standing faucet* — it creates
  ongoing currency claims that don't stop. World-event mints, quest rewards, run-mode payouts are faucets.
- **Concordia's sinks (already present):** marketplace fees (4%–5.46%), the **30% royalty cap**, the
  **48h withdrawal hold**, token-purchase fees. **Whether the sinks balance the cascade-faucet at scale
  is a model to run** (Machinations-style), not assume. This is the long-term economy-health question.

### 4b. Unit economics
**Framework:** live games are funded by a minority — WoW's ~**5% of players paid 20× baseline ARPU**,
enough to fund ongoing dev. Your ARPU must cover your costs.

### 4c. THE cold-start cost trap — the self-hosted 5-brain stack ⚠️
**This is the most important economics finding.** Research on self-hosted LLM economics:
- Self-hosting is cheaper than API **only above ~500M tokens/day**; the breakeven is ~2M tokens/day, and
  below it **API is cheaper** once you count **idle-GPU time + DevOps + maintenance**.
- Self-hosting costs **3–5× the raw GPU price** (cooling/facilities/ops add ~$2–7/hr per GPU).

**The collision:** Concordia runs **5 self-hosted Ollama brains 24/7**. At **cold-start (few players =
low token volume)**, those GPUs are **mostly idle and burning money** — the *worst* cost structure
exactly when you have the *least* revenue. The 5-brain self-hosted architecture earns its keep **only
after critical mass**; before that, it's a candle-burner.

**What to do:**
- **Right-size the brain stack to the player count.** Don't run 5 GPUs 24/7 for 50 players. Cold-start
  options: a smaller brain set, on-demand/autoscaled inference, or **API/cheaper models during cold-start**
  (frontier-equiv is now ~$0.40/M tokens), crossing over to the self-hosted 5-brain stack once volume
  passes the ~500M-tokens/day breakeven.
- **Instrument ARPU vs burn** (the Ollama GPUs are likely your dominant cost) — the candle metaphor is
  literal here: idle inference is the wax.
- **Model the faucet/sink balance** before the economy has enough players to inflate.

---

## 5. Distribution — does anyone come? (summary; deep in COLD_START_AND_LIVEOPS)

The dominant, least-controllable risk. Concordia's rare advantage: **the tool works solo** (the lenses
deliver value with zero network), so you can lead with the tool and let the world/economy accrete —
the textbook "come for the tool, stay for the network." Seed ONE atomic network (one world + one creator
niche + ~100 people) before opening wide. *Most beautiful solo projects die here, not in the code.*

---

## 6. The honest synthesis

| Pillar | Risk | Concordia's edge | Concordia's exposure |
|---|---|---|---|
| Distribution | dominant | tool works solo | two-sided cold-start |
| Economics | high | sinks already exist | **idle-GPU cost trap at cold-start** |
| People | high | detectWashTrading + governance built | creator-economy = manipulation magnet |
| Judgment | medium | juice built; telemetry built | can't playtest 253 lenses solo |
| Liveness | low | **self-moving world** | (most de-risked) |

Three findings worth sitting with, because they're the uncomfortable-but-true ones:
1. **The self-hosted 5-brain stack is a cost trap at low scale** — right-size it for cold-start, or idle
   GPUs burn the candle before players arrive.
2. **The creator economy is Concordia's biggest *human*-exploit surface** — the very thing that makes it
   unique (player-created perpetual royalties) is the thing cartels will target. Defend it like the
   temperament engine defends the world.
3. **You can't judge "is it good" alone** — the atomic network must double as your playtest panel, and
   you must trust telemetry over your own taste.

None of these are reasons it won't work — they're the *named, researchable* shape of the post-correctness
phase, and Concordia walks in with real structural edges on four of five. The honest order of operations:
**get the first atomic network (Distribution) on the solo-tool value → right-size the inference cost so
you don't burn out before they arrive (Economics) → defend the economy from coordinated players (People)
→ let the atomic network tell you what's fun (Judgment) → let the self-moving world hold them (Liveness).**

**Sources:** [playtesting & measuring fun](https://www.gamedeveloper.com/design/how-to-measure-fun-for-game-designers) ·
[Games User Research](https://www.interaction-design.org/literature/topics/games-user-research) ·
[game feel / juice survey](https://arxiv.org/pdf/2011.09201) ·
[in-game moderation guide](https://www.conectys.com/blog/posts/what-is-in-game-moderation-the-ultimate-guide-for-gaming-companies/) ·
[T&S networks-not-individuals (ADL)](https://www.adl.org/resources/report/caught-vicious-cycle-obstacles-and-opportunities-trust-and-safety-teams-games) ·
[RMT black markets in games](https://arxiv.org/pdf/1801.06368) ·
[faucets & sinks](https://medium.com/1kxnetwork/sinks-faucets-lessons-on-designing-effective-virtual-game-economies-c8daf6b88d05) ·
[game economy inflation](https://machinations.io/articles/what-is-game-economy-inflation-how-to-foresee-it-and-how-to-overcome-it-in-your-game-design) ·
[self-hosted LLM vs API breakeven](https://www.braincuber.com/blog/self-hosted-llms-vs-api-based-llms-cost-performance-analysis) ·
[inference unit economics](https://introl.com/blog/inference-unit-economics-true-cost-per-million-tokens-guide) ·
[live service unit economics / ARPU](https://www.gameanalytics.com/blog/how-games-create-value)
