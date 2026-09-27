# Concord — Go-To-Market Plan

*Applies [`MARKET_DEMAND_MAP.md`](MARKET_DEMAND_MAP.md) (web-researched demand, 2026-06-08) to what is
actually live and verified on 2026-09-27. The research says where demand is; this doc says what to
ship, to whom, through which channels — and what has to be true first.*

> **Honesty rule.** Every readiness claim below was checked against the live system on 2026-09-27
> (a new-user QA account driving the same HTTP calls the site makes). Where something is untested or
> a hypothesis, it says so. Don't cite a market number here that isn't in the research doc's sources.

---

## 1. Positioning (from the research)

**One line:** *AI that shows its receipts.* Concord computes the answer with real deterministic
engines, cites where it came from, and remembers it — instead of generating something plausible.

Why this line: the research's strongest *revealed* demand vector is verifiable / grounded AI
(capital and product roadmaps converging on source-grounding), and the #1 reason agentic projects get
cancelled is unreliable output. "Verified" is both the wedge and the answer to the agent backlash
(MARKET_DEMAND_MAP §5.1). The defensible claim is the **combination** — grounded + private + agentic +
owned memory + creator economy on one substrate — which no incumbent ships (§2, §5.3).

**Don't say:** "local AI is winning", "private AI for everyone", "fully autonomous agents" — the
research contradicts all three (§6). Private is an enterprise/R&D wedge, not a consumer headline.

---

## 2. Audiences, in order

| # | Audience | What we lead with | Status | Why this order |
|---|---|---|---|---|
| 1 | **Engineers & technical researchers** (the R&D compute-agent wedge) | Ask in chat → Concord runs the real CAS (`math.symbolicCompute`, `lib/compute/symbolic-math.js`) and beam-frame FEA (`engineering.runFEA`, `lib/simulation/fea-solver.js`), shows the computed result, keeps a cited record | **Beachhead** — research's best demand-to-strength fit, thinnest competition (§4) | Strongest pull meets Concord's confirmed strength |
| 2 | **Knowledge workers** ("second brain") | DTUs as owned, cited, compressing memory | Expansion | Real, monetizing market but crowded (Notion/Obsidian) |
| 3 | **Players** — Concordia, a living world in the browser | NPCs with memory, grudges, schemes and grief; no install | **Hypothesis to test** (not covered by the research) | Best *reach* / virality potential; must earn its place with data |
| 4 | **Developers** | MCP server, signed plugins, SDK ([`DEVELOPER_PLATFORM_GTM.md`](DEVELOPER_PLATFORM_GTM.md)) | Built, adoption not started | Ecosystem multiplier once 1–2 have traction |

Concordia is **top-of-funnel**, not the beachhead: it earns attention (clips travel), then the
same account lands in Concord where the receipts are.

---

## 3. Channels ("show the receipts" is the channel — §5.4)

| Channel | Audience | The move | Proof it needs to show |
|---|---|---|---|
| **Show HN / technical write-up** | 1 | "I built an AI that refuses to guess: it calls a real CAS and FEA solver and shows the receipt" — with a live demo link | A chat session that computes, then cites; the repo commands that reproduce every number |
| **Engineering communities** (r/StructuralEngineering, r/MechanicalEngineering, r/engineering, eng Discords) | 1 | A beam / column check done in chat, compared against a hand calc | FEA result + the input model, reproducible |
| **MCP registries & agent builders** | 1, 4 | List Concord's MCP server: "deterministic compute your agent can call" | Working MCP tool calls from Claude/Cursor |
| **Build-in-public** (X, YouTube devlogs) | all | One founder, first project, a verified-AI OS + a living world. The scale is the story | Real commits, real numbers (`npm run count-loc`, `check-doc-claims`) |
| **Short clips** (TikTok / Shorts / r/WebGames, r/IndieDev, r/playmygame) | 3 | Emergent NPC moments: a mourning crowd after a kill, a scheme, a grudge | The moment has to be real and reproducible in the shipped build |
| **itch.io browser listing** | 3 | Free second storefront for the WebGL build | Current build, loads fast |

Every channel funnels to one path: **land → sign up free → one magic moment in < 2 minutes →
discover the rest.**

---

## 4. Launch readiness gates (checked live 2026-09-27)

Marketing multiplies whatever the product does in the first two minutes. Don't send traffic until
each gate for that audience is green.

| Gate | Audience | Status 2026-09-27 | Evidence / next step |
|---|---|---|---|
| Site up and monitored | all | 🟡 Up; **not monitored** | Homepage was down ~5 days (Sep 22–27) unnoticed. Add uptime + disk alerts |
| No request stalls under idle load | all | 🟢 Fixed | 1.2–2.8s heartbeat freeze every 15s → 503s; root-caused (`emergent/store.js` full-table re-read) and fixed |
| Login/signup doesn't starve the server | all | 🟢 Fixed | bcrypt moved to a worker thread (`lib/password-hash-pool.js`) |
| Chat computes instead of guessing | 1 | 🟢 Fixed for arithmetic | Was returning a fabricated 7,031,242 for 1234×5678 as raw JSON; now `1234 × 5678 = 7,006,652` from the engine |
| Chat never shows internal JSON or operator rules | all | 🟢 Fixed | Operator-only prompt segments + JSON-only reply guard |
| Private systems locked to the operator | all | 🟢 Fixed | Members get `operator_only`; verified live |
| Production brains (A40) online | all | 🔴 **Down** | Mac serves a small test model only. Chat quality for new users depends on this |
| "Verify" means what the pitch says | 1 | 🟡 Partial | `reason.verify` checks that a claim's *citations resolve*; it doesn't fact-check uncited text. Pitch it precisely, or build claim-level grounding |
| Engineering wedge usable from chat, end to end | 1 | 🟡 Untested | CAS + FEA work as macros; a chat-driven beam check hasn't been run as a new user yet |
| Fresh Concordia WebGL build | 3 | 🔴 Stale | Shipped player exported Sep 13; later gameplay fixes not in it. Re-export + browser play-test |
| Onboarding doesn't force Concordia on signup | all | 🔴 Open | Owner-noted: defer character creation to first World-lens open |
| Lens wiring | all | 🟡 Regressed | Verifier: 254 wired / 12 no-backend-call (docs said 262/4) — audit after the Sep 10 de-stack |
| Hosting off a single 16GB Mac | all | 🔴 Open | Swapping measured at 7.3/8 GB under load; plan: [`OFF_MAC_MIGRATION_BLUEPRINT.md`](OFF_MAC_MIGRATION_BLUEPRINT.md) |

**Rule of thumb:** audience 1 can launch when the A40 is back, "verify" is pitched precisely, and a
chat-driven engineering check passes as a new user. Audience 3 needs a fresh build and onboarding fix.

---

## 5. First 30 days

1. **Week 1 — make the first two minutes true.** A40 back as prod brain; uptime/disk alerts; run the
   engineering-in-chat QA journey (same harness as `~/concord/qa-chat-journey2.mjs`) and fix what breaks.
2. **Week 2 — the proof asset.** Record one 60-second receipt: a question → real CAS/FEA call →
   cited answer → "here's the command that reproduces it." This single asset feeds HN, Reddit and X.
3. **Week 3 — beachhead launch.** Show HN + 2 engineering communities + MCP registry listing. Watch
   signups → first-compute rate daily.
4. **Week 4 — test the Concordia hypothesis cheaply.** Fresh WebGL export, onboarding fix, then 3–5
   short clips of real emergent moments. Measure clip → signup → World-lens open. Keep or cut based
   on data, not attachment.

---

## 6. Metrics that matter

- **Activation:** % of new accounts that get a *computed, receipted* answer in their first session.
- **Time-to-magic:** seconds from signup to that answer (target < 120s).
- **Stability:** 503 rate and p95 event-loop lag (the server logs `event_loop_burst_lag`).
- **Retention:** D1 / D7 return rate per audience.
- **Concordia test:** clip view → signup → World open → 10-minute session.

---

## 7. Caveats carried over from the research (§6)

- Stated demand ≠ willingness to pay; most users don't verify output even when they distrust it.
  Consumer pay-for-verification is soft — monetize the R&D/enterprise wedge first.
- Agent reliability is weakest on small local models; lead with verification and bounded agency,
  not autonomy.
- Market-size figures in the research are directional only.
