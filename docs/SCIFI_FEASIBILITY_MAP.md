# Concord — Sci-Fi Feasibility & Market-Demand Map
*Code-grounded feasibility audit · 2026-06-08*

> **What "feasible" means here:** each rating is checked against the actual codebase (file-level
> evidence), not estimated. **"Feasible now" means the capability is *built in the substrate* — NOT
> that it is polished, QA'd, or demo-ready.** Per Concord's own rule: *wired ≠ working.* Treat this
> as "the invention is done; what remains is surfacing + polish," unless a row says otherwise.

> **Audit provenance (READ THIS).** An earlier draft of this map attached raw *file-count* numbers
> to each capability (e.g. "voice ~128 files", "vision 94 files"). A three-agent verification pass
> against the tree on 2026-06-08 found those counts **systematically inflated (1.25×–23.5×)** and a
> few verdicts wrong in *both* directions. **Counts are grep-fragile; depth is the honest signal.**
> So this version replaces counts with **anchor file(s) + a depth verdict**. The strategic thesis
> survived the audit intact — the capabilities are real and mostly production-grade — but the
> *evidence* had to be corrected, because for this product **honesty is the moat**: a pitch that
> says "here are the receipts" cannot ship inflated receipts. See §3a for the corrections log.

---

## TL;DR

- **~10 of 13 iconic sci-fi software systems are feasible *now*** — the substrate exists and is
  mostly production-grade (verified, not estimated).
- **Most top market-demand vectors are implemented** — with one honest exception: external
  *connectors* (Gmail/Calendar/Slack/…) are **scaffold**, not real two-way sync. MCP + OAuth-signin
  are the real integration surface.
- **Genuine gaps live in one bucket: hardware / physics / real-world** (robots, suits, AR display,
  tetra/nonlinear FEA, real-world prediction) **plus the connector-depth gap above.**
- **Two audit surprises:** (a) **engineering CAD/FEA is a real STRENGTH, not a gap** — there is a
  genuine direct-stiffness FEA solver + a real CAS; (b) the **causal-closure analyzer is BUILT**
  (not "designed"). Both are corrections to the earlier draft.
- **Strategic consequence:** for the software/AI half, the roadmap is **reveal + polish + wedge +
  distribution**, not invention. The build is mostly done; *show* is the game.

---

## 1. Sci-Fi Systems → Concord (feasibility vs. the code)

Legend: ✅ feasible now (substrate built) · 🟡 foundation present, depth varies ·
🔶 split (part built / part frontier) · ⛔ needs hardware/physics or out of scope

| # | Sci-Fi System | What it is | Concord mapping | Verdict | Code evidence (anchor file + depth) |
|---|---|---|---|---|---|
| 1 | **Star Trek ship computer (LCARS)** | Voice AI wired to everything | ConKay | ✅ | `server/routes/voice*.js` + `lib/voice/voice-pipeline.js` + agentic macros + `reason.verify`. Real STT (Web Audio MediaRecorder) / TTS routing; **production-grade, modest scope** (~22 core files, not "128"). |
| 2 | **Star Wars Holocron** | Knowledge archive + adaptive AI "gatekeeper" | DTU substrate + agent-personas | 🟡→✅ | DTU substrate real + substantial (674 tables, ~1.5M-DTU cap, auto-consolidation). Agent-persona/`agent-autobiography.js` real. **Caveat:** a single "Holocron record" *object* isn't built as such — the substrate is present, the packaged product object is aspirational. |
| 3 | **Foundation psychohistory** | Math-predict large populations | Concordia + forward-sim | ✅ in-sim / ⛔ real-world | `lib/embodied/forward-sim.js` + `emergent/forward-sim-cycle.js`. **Scope is 100% sandbox** (quest/NPC/faction state-drift only). Do **not** claim real-world forecasting. |
| 4 | **Snow Crash Librarian** | Daemon navigating a vast cross-reference web | ConKay + citation graph | ✅ | `lib/reason-verify.js` (deterministic citation floor + council judge) + DTU citation graph. ~21 files; production-grade. |
| 5 | **Person of Interest "The Machine"** | Aligned, private, nudge-not-control AI | refusal-field + value-drift flagging + salience-gated outreach | ✅ (ethos, built) | `lib/refusal-field.js`, `personal-beat-scheduler` + `initiative-cycle` heartbeats (verified wired), local Ollama. The autonomous-but-constrained "Machine" framing holds. |
| 6 | **Iron Man holographic workshop** | Gesture-design hardware in 3D | compute-grounded CAS/FEA + 3D HUD | 🔶 (CAS/FEA **real**) | **Corrected: NOT a gap.** `domains/engineering.js` (944 LOC, **18 macros** incl. `runFEA`) + `lib/simulation/fea-solver.js` (~380 LOC) = genuine direct-stiffness FEA (3D frames, 6 DOF/node, 11-entry material library, member stress/utilization). `domains/math.js` (1,552 LOC) = real CAS. **Frontier = tetra/nonlinear FEA + AR display only.** |
| 7 | **Dune Mentat + Other Memory** | Human-computer analysis + ancestral memory | compute-grounded CAS + DTU lineage/NPC inheritance | ✅ | CAS verify (above) + `lib/npc-legacy.js` inheritance/legacy system. |
| 8 | **2001 — HAL 9000 (anti-pattern)** | The AI you must NOT build | causal-closure + Grounded + local + kill-switch | ✅ ethos / ✅ **built** | **Corrected: built, not "designed."** `lib/causal-closure.js` (~280 LOC) + `tests/causal-closure.test.js` (16/16), bridged to `agent-awareness-index.js`. Anti-HAL props present (local, Grounded, kill-switch). |
| 9 | **The Matrix Construct ("I know kung fu")** | Instant skill loading | recipe/skill/glyph instantiation | ✅ | `lib/skill-evolution.js`, `lib/glyph-spells.js` (base-6 algebra), `craftTool`, `skill-forge.js`. ~71 files; production-grade with behavioral tests. |
| 10 | **Halo — Cortana** | Bonded companion w/ affect, runs your systems | ConKay + affect/qualia stack | ✅ | affect/qualia stack + agent agency + ConKay front door. |
| 11 | **Neuromancer — Dixie Flatline** | ROM persona of a person you consult | agent-self/identity/autobiography | ✅ (functional, honestly labeled) | `lib/agent-self.js`, `agent-autobiography.js`, `foundation-identity.js`, `agent-awareness-index.js`. ~71 files; functional constructs, honestly labeled (not "conscious"). |
| 12 | **Star Trek Translator + Tricorder** | Translate anything; handheld scan/analyze | LLM + vision + mobile sensors | 🟡 (translate **not built**) | **Corrected.** Vision real but light: `lib/vision-inference.js` → `BRAIN_VISION_URL` (Qwen2.5-VL); mobile BLE/NFC/cam present. **Translation has NO subsystem** — only an i18n UI provider; an LLM *could* translate but it is not wired. Don't claim "translate anything" yet. |
| 13 | **Hitchhiker's Guide** | Crowd-knowledge, honest about being wrong | DTU archive + Grounded/"verify me" badge | ✅ | DTU archive + `reason.verify` Grounded/"Reasoned—verify" badge (the TrustBadge). |

**Result: ~10/13 feasible now; engineering (row 6) is a strength not a gap; translation (row 12)
and AR display are the software-side frontier; real-world prediction (row 3) is out of scope by design.**
*(Update 2026-06-08: row 12 translation is **no longer a gap** — a real machine-translation lens now
ships via the local LLM: `server/domains/translation.js` + `lib/prompt-registry.js#machineTranslate`,
`/lenses/translation`, 16 contract tests. Sovereignty intact — no external API. AR display moved too:
see §1a Holodeck + the AR note in §3.)*

### 1a. Tier 2/3 + bonus analogs (audit + canon-verified)

Same legend, plus **🛠️ = foundation present, surfacing/polish in progress** (the user's "buildable"
tier). Canon was web-verified (see § Sources) so the mappings are accurate, not misremembered.

| Sci-Fi system | Canon (verified) | Concord mapping | Verdict | Code anchor |
|---|---|---|---|---|
| **TRON — enter the Grid** | Humans digitized *into* a computer world where Programs live as inhabitants. | Concordia 3D world you navigate as an avatar | 🛠️ | `concord-frontend/lib/world-lens/` + `components/world-lens/ConcordiaScene.tsx` |
| **Westworld — Hosts** | Androids run authored narrative *loops*; the show's core question is whether they're truly conscious. | NPC sim (loops/schedules/memory) **with the ethics caution kept** | 🛠️ + ⛔ (consciousness) | `server/lib/npc-*.js`, `server/lib/oracle-brain.js`, `server/emergent/quest-engine.js` |
| **Mass Effect — EDI + Codex** | EDI = the ship's AI; the Codex = the unlockable in-game knowledge archive. | ConKay (ship AI) + DTU archive (Codex) | ✅ / 🛠️ | `components/conkay/*` + the DTU substrate (674 tables) |
| **Stargate — Repository of Knowledge** | Ancient device that *downloads* a vast knowledge bank into a human mind — which can't hold it. | The DTU vault is the archive ✅; the **brain-download is the ⛔** (no neural write-back — by design) | ✅ archive / ⛔ download | DTU substrate; ⛔ = same refusal as mind-upload below |
| **Ex Machina — "is it conscious, or just convincing me?"** | A Turing-test-style eval the film deliberately leaves unresolved. | The honest answer stays **unmeasurable, never claimed**; the code ships *functional* correlates only | ⛔ by design | `server/lib/causal-closure.js` + `agent-awareness-index.js` |
| **Star Wars — droids** | General-purpose autonomous robots. | Suits/robots hardware roadmap (frontier, sequenced after users) | ⛔ hardware | — (the frontier track) |
| **Star Trek — Holodeck** | A room simulating any environment with interactive characters. | Concordia as a **proto-holodeck** — screen now, VR later via the existing WebXR path | 🛠️ | world-lens + the `renderer.xr` WebXR session in `app/lenses/ar/page.tsx` |
| **Mind-upload (Black Mirror "cookie" / San Junipero)** | A digital copy of a person's *consciousness* with full subjective experience. | **The on-brand NO.** Functional persona-persistence is real — "a holocron of a person" (knowledge, voice, recorded character) — but phenomenal experience is untransferable + unverifiable. **Make the holocron; never promise the soul.** | ⛔ by design (headline refusal) | `server/lib/agent-self.js`, `agent-autobiography.js`, `foundation-identity.js` |

Two canon refinements worth keeping honest: (a) Snow Crash's Librarian (§1 row 4) *explicitly disclaims
being intelligent* — it retrieves + connects, candid about its limits; that candor is exactly the
Grounded-badge discipline, so the mapping is tighter than flattering. (b) The Star Wars Holocron
"gatekeeper gauges the user's worthiness" detail (§1 row 2) is chiefly *Legends* canon — cite it as the
Legends conception, not current canon.

---

## 2. Market Demand (2026) → Concord

> **Web-researched evidence + competitive landscape + sizing live in
> [`docs/MARKET_DEMAND_MAP.md`](MARKET_DEMAND_MAP.md)** (5-angle deep-research fan-out, 2026-06-08,
> every claim source-cited). This table is the summary; that doc is the receipts. The "Code" column
> is the in-repo capability (verified §1/§3 anchors); the "Market signal" column is the *external*
> demand verdict from that research, with the load-bearing source noted.

| What people are asking for | Concord (code) | Market signal (web-verified — see companion) |
|---|---|---|
| **Verifiable AI** — cites sources, refuses when unsure | `reason.verify` (deterministic citation floor + council judge) / Grounded badge / compute-grounded routing | **🟢 strongest *revealed* pull.** Perplexity ~$18–20B val on cited answers; Google/MS shipping citations as default; trust *fell* as use rose (only 46% trust AI). **Lead with this.** |
| **Proactive / agentic** — does real multi-step tasks | `initiative-cycle` / `personal-beat-scheduler` + ~9,600 macros (478 domains) | **🟡 loudest demand, weakest delivery.** Gartner: agentic in 33% of apps by 2028 — *but* best agents finish ~30–35% of multi-step tasks and >40% of agentic projects are forecast cancelled by 2027. **A *verified* agent is the answer to that backlash.** |
| **Private / local / no-harvest** | local Ollama 5-brain + consent gates + `personal_dtus_never_leak` | **🔵 real but niche.** On-prem >50% of 2025 enterprise LLM spend; Ollama ~174k stars — but ChatGPT's ~800–900M users dwarf local by 2–3 orders. **Enterprise/R&D wedge, not a mainstream claim.** |
| **Controllable, trustworthy memory** | DTU substrate (674 tables, ~1.5M-DTU cap) + scope/consent gates | **🟢 real + monetizing.** Notion ~$500M ARR, >50% AI-attributed; ChatGPT shipped controllable memory. |
| **Owned / no-subscription** | free + local + take-rate + creator economy | **⚪→🔵 grievance > behavior.** 41–47% subscription fatigue + 81% enterprise lock-in concern, but subs still growing fast; strongest in enterprise/regulated. |
| **External integration** (connect your stack) | **bidirectional MCP** + Google/Apple OAuth **sign-in** | 🟡 **partial — see §3.** MCP is real; OAuth is identity-only; Gmail/Calendar/Slack/etc. connectors are **scaffold, not real two-way sync.** |

**The white space (from the companion's landscape):** every incumbent owns exactly *one* vector
(Perplexity=grounded, ChatGPT=general, Copilot=enterprise, Ollama=privacy, Notion=PKM). No one ships
the *intersection*. Concord's defensible claim is the combination × depth — never any single checkbox
(this restates Honesty Caveat #2 below with market evidence behind it).

---

## 3. The Honest Gap List (what's genuinely NOT there)

Real gaps = hardware / physics / real-world **+ connector depth**:

- **External connectors (Gmail/Calendar/Sheets/Slack/GitHub/Notion)** — **foundation now built;
  live sync needs secrets.** The token core is real: `migration 331 connector_oauth_tokens` +
  `lib/connector-tokens.js` persist access/refresh tokens **encrypted at rest (AES-256-GCM)** with
  refresh-rotation and **`invalid_grant`→re-consent** handling; `lib/connector-client.js` is an
  SSRF-guarded outbound client (Bearer + 401 forced-refresh retry) with a Google Calendar write
  helper; `domains/calendar.js#accounts-push-event` is a direction-gated two-way write;
  `integrations.connectApp` no longer fabricates a token. Hardened to the OAuth security BCP
  ([RFC 6819 §5.1.4.1.3](https://datatracker.ietf.org/doc/html/rfc6819),
  [RFC 9700](https://datatracker.ietf.org/doc/rfc9700/),
  [OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)).
  **Still required for *live* Gmail/Calendar:** real `GOOGLE_CLIENT_ID/SECRET` + the
  connector-authorize callback (the documented wiring point). MCP remains the other real surface.
- **Machine translation** — ✅ **shipped** (was a gap): `domains/translation.js` (translate/detect/
  batch/languages) through the local LLM, lens at `/lenses/translation`, 16 tests. No external API.
- **Physical robots & exo-suits** — hardware; not built. (Where ConKay-as-R&D-partner aims.)
- **Engineering-grade tetra/nonlinear FEA & full CAD** — the *beam-frame* FEA + CAS are **real**
  (corrected above); the frontier is tetrahedral meshes, nonlinear/large-deformation, contact
  elements, and parametric CAD. ⚠️ *Pitch the real beam-frame FEA + CAS; do not overclaim full CAD.*
- **AR / holographic display** — `ARPreview.tsx` is now a **real WebXR `immersive-ar` surface**
  (feature-detect → session → hit-test placement → honest non-XR fallback), built to the WebXR BCP
  (GPU/hit-test disposal on session end, foveation, transient-activation —
  [MDN WebXR](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API),
  [W3C Hit Test](https://www.w3.org/TR/webxr-hit-test-1/)). **Live AR still needs AR hardware**
  (Quest/ARCore; not iOS Safari / visionOS as of 2026); the detection + fallback are verified headless.
- **Real-world prediction** (psychohistory applied to reality) — sandbox only; do **not** claim it.
- **Verified phenomenal consciousness** — unmeasurable in principle, for anyone; the code correctly
  ships *functional* constructs labeled as correlates (`agent-awareness-index.js`, `causal-closure.js`),
  never "it's conscious."

### 3a. Corrections log (earlier draft → verified)

| Claim in earlier draft | Verified reality | Direction |
|---|---|---|
| Engineering CAD/FEA "thin ~13 files, incidental" | Real direct-stiffness FEA + CAS + materials + chem | ⬆ understated → **strength** |
| External integration "✅ all implemented" | MCP real; OAuth sign-in only; connectors scaffold; no two-way Gmail/Calendar | ⬇ **overstated** |
| Translation "✅ ~28 files" | **0 files — does not exist** (i18n UI only) | ⬇ **false** |
| causal-closure "designed, not built" | **Built**: `causal-closure.js` + 16/16 tests, wired | ⬆ stale → **built** |
| Vision/LLaVA "94 files" | 4 files (real router, lightly used) | ⬇ inflated 23.5× |
| Voice "~128" · reason.verify "45" · agent-personas "143" · skill/glyph "89" · forward-sim "43" | ~22 · 21 · 71 · 71 · ~10 (all production-grade) | ⬇ inflated 1.25×–5.8× |

---

## 4. Honesty Caveats (keep these to protect credibility)

1. **"Built in code" ≠ "polished product."** The remaining work for the software half is
   *integration + polish + QA*, not new capability. Demo quality is its own lift.
2. **Demand ≠ victory.** "Private AI" is a contested category. The edge is the **combination +
   depth** (private AND verifiable AND agentic AND creator-economy AND world-sim on one substrate),
   never any single checkbox.
3. **Cite paths, not counts.** File counts drift and inflate; this map cites anchor files + a depth
   verdict so any claim is one `grep` from being checked. Keep it that way.
4. **Verify-before-pitch (now resolved here):** connector depth = scaffold; CAS/FEA = real beam-frame
   (not full CAD); translation = not built. Pitch accordingly.

---

## 5. Strategic Reframe

For the software/AI half, **you are not building the future — you are revealing it.** Most iconic
sci-fi software capabilities already sit in the repo. That changes the roadmap shape:

- **Software/AI sci-fi (~10/13):** ✅ built → needs **surfacing, polish, a wedge, distribution.**
  (ConKay animation that *shows real system work*, the Holocron pitch, getting humans in the door.)
- **The frontier (the ⛔s):** hardware (suits/robots), full CAD + tetra/nonlinear FEA, AR display,
  real-world claims — genuine build/physics work, sequenced after users.
- **The newly-confirmed wedge asset:** the **verified, private compute-agent for R&D** is now backed
  by *confirmed* CAS + beam-frame FEA + materials + chem depth — not a claimed gap. Lead with it.

---

## 6. Recommended Pitch Language

- **Identity / one-liner:** *"A Holocron you can actually open — a private archive with an AI
  gatekeeper that learns you."*
- **Moral positioning:** *"Build the Machine, not Samaritan."* (aligned + private + human-in-the-loop)
- **Product shape:** *"A Holocron with a Librarian, run by the Machine — and I'll show you the receipts."*
- **Lead demand vectors (deepest + loudest):** **verifiable/grounded** (cites sources, refuses when
  unsure) + **owned/private/all-in-one** (anti-subscription, anti-harvest).
- **R&D wedge (now defensible):** *"A private compute-agent that does the math, runs the beam-frame
  FEA, and shows its work — on your hardware, never phoning home."*

---

## 7. Next Moves (priority order)

1. **Surface + polish ConKay** as the wedge (ship-computer / Librarian / Machine front door) —
   animation that *shows real system work*, never faked (Track B of the continuation plan).
2. **Pick ONE wedge audience** and ship the 3-minute first-win (the funnel is instrumented).
3. **Distribution / build-in-public** — the honest "it's all real, here are the receipts" narrative
   is the unfair channel (now that the receipts are corrected).
4. **Make the marquee connector real** (Gmail/Calendar two-way) before claiming it — tracked as
   "Track C" in `docs/CONKAY_HONEST_HOLOGRAM_PLAN.md`.
5. **Hardware frontier (later):** smallest verified actuator loop with ConKay doing the math,
   validated in sim, then metal.

---

## Sources (sci-fi canon for §1a — web-verified)

The §1a mappings were checked against canon so they're accurate, not misremembered (all confirmed):
- TRON — https://en.wikipedia.org/wiki/Tron
- Westworld (Hosts + the consciousness question) — https://www.imdb.com/title/tt0475784/
- Mass Effect — EDI https://masseffect.fandom.com/wiki/EDI · Codex https://masseffect.fandom.com/wiki/Codex
- Stargate SG-1 — Repository of Knowledge https://stargate.fandom.com/wiki/Repository_of_knowledge
- Ex Machina — https://en.wikipedia.org/wiki/Ex_Machina_(film)
- Star Trek — Holodeck https://en.wikipedia.org/wiki/Holodeck
- Black Mirror — the "cookie" / mind-copy https://reactormag.com/black-mirror-shared-universe-cookies-human-rights-copies/
- Person of Interest — the Machine vs. Samaritan design contrast https://personofinterest.fandom.com/wiki/Samaritan
- Snow Crash — the Librarian (and its disclaimer that it isn't intelligent) https://en.wikiquote.org/wiki/Snow_Crash
- Star Wars — Holocron gatekeeper (*Legends* conception) https://starwars.fandom.com/wiki/Gatekeeper/Legends

## Cross-references
- **Market-demand half** (web-researched evidence, competitive landscape, sizing, wedge segments):
  [`docs/MARKET_DEMAND_MAP.md`](MARKET_DEMAND_MAP.md).
- Master continuation plan + tracks: `docs/CONKAY_HONEST_HOLOGRAM_PLAN.md`.
- Depth fleet (Track A) status + resume loop: `docs/DEPTH_FLEET_PLAN.md`.
- Causal-closure substrate: `docs/CAUSAL_CLOSURE_EXPERIMENT.md` + `server/lib/causal-closure.js`.

*This document rates capability against source code as of 2026-06-08. Ratings reflect substrate
presence, not product polish. Counts were replaced with anchor-files + depth verdicts after a
three-agent verification pass (re-spot-checked 2026-06-08: all seven load-bearing anchors still hold).
§1a adds canon-verified Tier-2/3 + bonus analogs (TRON, Westworld, Mass Effect, Stargate, Ex Machina,
droids, Holodeck, mind-upload) with code anchors + sources. The Market-Demand half (§2) is backed by a
web-research pass with cited sources — see the companion `MARKET_DEMAND_MAP.md`. Where a claim could not
be confirmed from code, it is marked "verify."*
