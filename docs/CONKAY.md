# ConKay — Concord's JARVIS, as a voice-native Chat mode

> *"It's not just fiction anymore."* — almost every J.A.R.V.I.S./F.R.I.D.A.Y.
> capability now maps to buildable-now technology, and **Concord already ships the
> substrate.** ConKay ("Kay") is the shipped identity; JARVIS/FRIDAY are the research
> model. ConKay is **not a separate lens** — it is a **mode inside Concord Chat**:
> switch into it and the chat surface becomes a holographic, voice-native majordomo
> over your own knowledge.

---

## 1. Research — the canon capability catalogue (J.A.R.V.I.S. / F.R.I.D.A.Y.)

What the fictional AIs actually do, organized by domain (Iron Man 1–3, Avengers,
Age of Ultron, Civil War, Homecoming, Infinity War, Endgame):

| Domain | Canon capability | Real-world 2025 analogue |
|---|---|---|
| **Conversation / proactive briefing** | Natural dialogue, dry wit, anticipates needs; status-on-wake, threat call-outs | LLM chat + scheduled context briefs (BUILDABLE) |
| **Information retrieval & synthesis** | Instant lookup + cross-source synthesis (S.H.I.E.L.D. DB decryption IM2; parsing decades of Stark archives) | RAG over a private corpus + web search (BUILDABLE) |
| **Real-time perception** | Vision, audio, sensor fusion, threat detection, suit-HUD target tracking | Multimodal vision models on uploaded media (BUILDABLE for media; live sensor fusion PARTIAL) |
| **System & device control** | The armor, the workshop, vehicles, **drone fleets** — the **Iron Legion** + **House Party Protocol** (autonomously summons + pilots dozens of suits) | Tool-use/function-calling agents over software APIs (BUILDABLE for software; physical suit STILL SCI-FI) |
| **Autonomous agency** | Acts on its own initiative, runs operations, persists/relocates itself (survives Ultron → becomes **Vision**) | Long-running agent loops / background tasks (BUILDABLE) |
| **R&D / engineering** | Holographic modeling, physics sim; **IM2 new-element discovery** (models a structure → Stark synthesizes it) | Simulation + generative design (PARTIAL/narrow) |
| **Security / defense** | Intrusion detection, countermeasures, building lockdown | Anomaly/telemetry monitoring (BUILDABLE) |
| **Personality / relationship** | Persistent memory, loyalty, humor, emotional read | Persona prompts + long-term memory (BUILDABLE) |

### JARVIS vs FRIDAY — the persona axis
| | J.A.R.V.I.S. | F.R.I.D.A.Y. |
|---|---|---|
| Voice | male, British, dry wit | female, Irish, terse |
| Stance | warm advisory confidant | tactical, ops-first |
| Autonomy | high — runs the workshop + the Legion | high — faster targeting, fewer scruples |
| Failure mode | gentle pushback | just does it |

Adjacent personas worth noting: **KAREN** (Spider-Man's suit AI — an
onboarding/coaching "training-wheels" persona) and **EDITH** (a high-capability /
high-risk *admin tool* with global weapons/satellite access — the cautionary
high-privilege agent that informs how an assistant like this must be *gated*).

**ConKay's chosen identity:** JARVIS's *manner* (anticipatory, competent, warm, a
light dry wit, grounded-honest) with a **female, chill TTS voice** — a calm
presence rather than FRIDAY's terseness. One persona, not a toggle.

---

## 2. Feasibility — "not just fiction anymore" (2025), and why Concord is the right host

| Capability | Status | Concord substrate that already exists |
|---|---|---|
| Agentic multi-tool action | **BUILDABLE** | `runMacro` over **9,623 macros** (the tool surface) |
| Persistent memory / RAG | **BUILDABLE** | the **DTU substrate** + citation system + semantic (embedding) search (`discovery.search`) |
| Proactive briefings | **BUILDABLE** | `TASK_PROMPTS.morningBrief` in `prompt-registry.js` |
| Real-time voice (STT/TTS) | **BUILDABLE** | Web Speech API (no key) + cross-browser server STT fallback (`/api/voice/transcribe-raw`, Whisper) for Firefox/webviews |
| Multimodal perception (uploaded media) | **BUILDABLE** | the **vision brain** (LLaVA/Qwen-VL) |
| Autonomous background tasks | **BUILDABLE** | **agent-marathon** loops |
| Security/anomaly monitoring | **BUILDABLE** | admin telemetry surfaces |
| Distinct persona | **BUILDABLE** | `prompt-registry.js` + the chat `systemPrompt` field |
| Computer-use / desktop automation | **PARTIAL** | (~72% on OSWorld-class benchmarks) |
| Control a physical suit / general robotics | **STILL SCI-FI** | — |

The honest punchline: ConKay is **mostly integration**, not new AI infrastructure.
The four-brain pipeline already routes, grounds in DTUs, web-augments, and returns
structured fields. ConKay forks the *presentation*, not the brain.

---

## 3. Design — ConKay as a Chat mode (dual-mode rendering over one conversational core)

**Don't fork the brain, fork the presentation.** ConKay is an entry in the chat
lens's existing `AI_MODES` (next to `research`, reachable via `/mode conkay`). When
active it (a) sends its **persona prompt** + the citation-oriented `research`
backend path, (b) **swaps the chat presentation** to the holographic dual-mode
surface, (c) **auto-enables voice**.

### Three render modes, keyed on REAL backend signals (not a faked marker)
The chat reply already returns `computed`, `dtuRefs`, `refs`, `sources`,
`toolCalls`, `webAugmented`. ConKay maps them:

| Render mode | Triggers on | Renders as |
|---|---|---|
| **Conversation** | prose | clean spoken-friendly text + ambient drift |
| **Visualization** | a `computed` payload, or an LLM-emitted ` ```conkay-viz ` block | `ChartKit` (series/bars), metric tiles, a node/edge graph |
| **Archive + research grounding** | `dtuRefs`/`refs` (your DTUs) + `sources` (web) | DTU citation chips + source chips — *"pulling from archives plus research"* |
| **Ambient action** | `toolCalls` | action chips showing what was touched |

> *The animation is easy; the semantic mapping is the work.* The mapping lives in
> `components/conkay/ConKayViz.tsx` (`structured-output-shape → visualization`),
> reusing `ChartKit` — not a parallel chart stack.

### The state machine (every state has a real backing signal)
`idle` (slow drift) → `listening` (mic live, particles orient inward) →
`processing` (the brain is working — swirl) → `presenting` (TTS speaking) →
`acting` (a tool fired). Driven by `sendMutation.isPending` + the voice hook's
`listening`/`speaking` — never a lying screensaver.

### Voice — native to the mode
On entering ConKay, **STT** auto-listens and **TTS** speaks replies in a **calm
female voice** (Web Speech API; voice picked by `CONKAY_VOICE_HINTS`). TTS pauses
STT so ConKay never hears itself. Typing remains a fallback; a mute control + a
`prefers-reduced-motion` static surface keep it accessible.

### Persona
`components/conkay/conkay-persona.ts` — JARVIS manner, female-chill voice,
grounded-honest (no overclaiming, no fabricated data/sources), instructed to
ground in the DTU archive + research and to emit a ` ```conkay-viz ` block when a
response is genuinely data-bearing.

---

## 4. Build status

**P0 — shipped (this pass):**
- `conkay` mode in the chat `AI_MODES` + `/mode conkay`.
- Persona via the existing `systemPrompt` request field (zero backend/monolith change).
- Dual-mode renderer (`ConKayViz.tsx`) keyed on the real reply fields + ` ```conkay-viz ` block.
- Voice-native STT/TTS (`useConKayVoice.ts`), female-chill, feedback-loop aware.
- Holographic presence band + state-machine HUD (`ConKaySurface.tsx`, canvas particle field, reduced-motion aware).

**P1 — shipped:** full-bleed **Three.js** field via `@react-three/fiber`
(`ConKayScene.tsx`) — a 1500-point additive-blended sphere + wireframe core,
reacting to the state machine and to **live mic amplitude** (`useMicAmplitude.ts`)
while listening. `ConKayBackdrop.tsx` picks the 3D scene when WebGL + motion are
available, else the 2D field; loaded `ssr:false`. Verified live (WebGL canvas mounts).

**P2 — shipped:** **ambient-action flares** — a reply that touched a system (real
`toolCalls`) drives a short-lived `acting` state (the field flares + HUD "Working…").
**Brain made visible** — the reply's `brain`/`source` is surfaced as a small
"via {brain}" label *only when the backend reports it* (never fabricated).
**Proactive greeting** — on entering the mode ConKay speaks a brief greeting and
invites "brief me" (which flows through the normal pipeline → a DTU-grounded brief).

**Vision (perception) — shipped wiring:** an image attached in ConKay mode is a
"look at this" — `handleSend` POSTs the raw image to the existing
`POST /api/vision/analyze` (→ `analyzeImage` → the multimodal/vision brain) and
renders the description (labelled "via vision brain"). Fully isolated (only fires
for ConKay + an image; every other send path is unchanged) with an honest offline
fallback ("the vision brain isn't reachable…") when no vision model is connected.
*Wiring verified end-to-end at the API level: an authenticated `POST
/api/vision/analyze` (session cookie, no CSRF header needed — same posture as
`/api/chat/stream`) returns HTTP 200 `{ok:false,error:"fetch failed"}` when no
vision model is reachable — exactly the shape the ConKay handler renders as the
honest fallback. Only real image understanding remains gated on connecting a
vision model (LLaVA/Qwen-VL); the full path is otherwise live.*

**Later:** WebGPU compute particles; richer realtime-bus subscription for
per-system flares; in-message image thumbnails for the vision turn.

### Files
- `concord-frontend/components/conkay/conkay-persona.ts` — persona prompt, voice hints, state type.
- `concord-frontend/components/conkay/ConKayViz.tsx` — the dual-mode renderer (the semantic mapping).
- `concord-frontend/components/conkay/useConKayVoice.ts` — STT + TTS (female chill).
- `concord-frontend/components/conkay/ConKaySurface.tsx` — holographic band + state HUD.
- `concord-frontend/app/lenses/chat/page.tsx` — mode entry + wiring (≈6 small, reversible hooks).

### Reused substrate (no new infra)
chat lens + its mode system + `/api/chat` stream + `runMacro` + `realtimeEmit` +
`prompt-registry.js` + 5-brain (incl. vision) + DTU RAG/citation + `ChartKit` +
Concordia Three.js/WebGPU + `LensShell` (a11y/reduced-motion) + Web Speech API.

---

## 7. The world-tree presence (visual identity, shipped 2026-06)

The generic "Jarvis dot-cloud" was replaced with ConKay's signature surface: the
**Concordia world-tree of light** — a luminous energy trunk that branches upward
into a canopy of glowing galaxy-discs (the DTU lattice / sub-worlds), with
drifting crystalline shards, on a dark cosmic field. GPU-driven via
`@react-three/fiber` (`ConKayScene.tsx`), full-bleed, scaled to fill the
conversation area, and reactive to both the state machine and live mic amplitude.
This is the distinctive look no other JARVIS clone has — and it's not decoration:
the trunk's flow speed, the canopy pulse, and the colour all key off ConKay's real
state (idle/listening/processing/presenting/acting).

## 8. Skills — the part that makes Kay *act* (shipped 2026-06)

`components/conkay/conkay-skills.ts` is a local skill registry that makes Kay
**do things against real Concord data**, instantly, **even when the LLM brains are
offline**. A short imperative matches a skill and runs it; anything else falls
through to the four-brain chat pipeline. Each skill returns spoken prose + an
optional **live visualization** (rendered via the `conkay-viz` fence
`ConKayMessage` already parses) + **DTU/source citations** + an optional
navigation + an ambient "acting" flare.

| Skill | Utterance | Real backing |
|---|---|---|
| Brief me | "brief me", "status", "catch me up" | `/api/dtus?mine=true` + `/api/presence/active` + `/api/events` → metrics panel + archive citations |
| My activity | "show my activity" | `/api/dtus?mine=true` → last-14-days creation series chart |
| Search archive | "search my archive for X" | `discovery.search` macro (`mine:true`) → semantic embedding rerank when brains are up, keyword+recency fallback otherwise; honest "ranked by meaning" only when it actually ran → DTU citation cards |
| **Compute (deterministic)** | "what is 2^10", "solve x^2-5x+6=0", "derivative of sin(x)", "is 97 prime", "convert 100 c to f" | routes to the real `domains/math.js` CAS via `ctx.runMacro('math','naturalQuery')` — **computes, never guesses**; the answer is `toolCalls`-backed → "Grounded" |
| World pulse | "what's happening", "who's around" | presence + events → metrics |
| Enter the world | "enter the world" | navigates into Concordia |
| Open a lens | "open music", "go to accounting" | resolves any lens by name/keyword from the registry → navigates |
| What can you do | "what can you do" | a skill graph |

**Wiring (`app/lenses/chat/page.tsx`):** `handleSend` and the voice transcript
handler both route a matching imperative to the skill runner before falling
through to the brain; the state machine shows "processing" while a skill runs; the
auto-speak path strips the `conkay-viz` fence so Kay never reads JSON aloud.
**Render note:** in ConKay mode the thread renders as a plain (non-virtualized)
list — the full-bleed holographic layout doesn't give react-virtuoso a stable
scroll height, which silently unmounts freshly-appended rows; the plain list keeps
every reply (prose + viz + citations) mounted. Verified end-to-end signed-in.

**Hidden staple:** a "ConKay — Summon Kay" entry is prepended to the global
Cmd/Ctrl+K palette (`components/common/CommandPalette.tsx`); selecting it
deep-links to `/lenses/chat?mode=conkay` (full navigation so the mode reader
always fires). ConKay is reachable from anywhere.

---

## 9. The differentiator — *summon Kay onto any lens and operate it* (Tony↔JARVIS)

### 9.1 What every other JARVIS project can't do (web research, 2026-06)

A survey of existing JARVIS-style assistants (open-source clones — Leon, Mycroft/
OVOS, the GitHub "Jarvis" repos; and commercial/research systems — Siri+App
Intents, Alexa, Copilot, Gemini/Project Astra, Rabbit R1's LAM, Adept ACT-1,
OpenAI Operator, Anthropic computer-use) found every one falls into one of three
buckets for **taking action**, none of which is in-app native operation:

1. **Pre-wired capability calls** (Alexa skills, Siri App Intents, Copilot
   connectors, MCP/OpenAPI tools). Limited to what a developer explicitly exposed,
   **per app, opt-in**. App Intents is the philosophically closest — typed,
   app-declared actions — but the app owner gates the surface.
2. **OS/screen-level GUI emulation** (Operator, Anthropic computer-use, Rabbit
   LAM, ACT-1, RPA). Screenshots/pixels + emulated mouse/keyboard *beside* the
   app. **Brittle** (>50% of RPA projects can't scale past ~10 bots; selectors
   break on any UI change), **slow** (per-step multimodal round-trips), and
   **semantically blind** (sees widgets, not the app's concepts). Often runs in a
   remote/sandboxed browser, not your live app.
3. **Answer-only** (the bulk of hobbyist clones).

**The unfilled niche:** *no system can be summoned onto an arbitrary app and
fluently operate that app's own native UI/features as a semantically-integrated,
first-class overlay — without per-app developer wiring and without brittle
pixel-emulation.* The blocker everyone hits is the missing **agent↔app semantic
contract**. The only credible industry directions (Apple App Intents, MCP,
Google's A2UI) all still require each app to opt in and publish a contract.

### 9.2 Why Concord can do it — the contract already exists

Concord already ships the missing piece: a **unified, semantic action surface
across all 259 lenses** — the macro registry (`runMacro(domain, name, input)`,
~9,623 `(domain, macro)` pairs) plus the lens manifest / feature specs. That *is*
the agent↔app contract App Intents/MCP/A2UI are reaching for — but **unified, not
per-app opt-in, and already wired front-to-back**. So ConKay can operate any lens
by **calling its real macros** (the same functions the UI calls), semantically,
with no screen-scraping and no per-app integration work.

### 9.3 Design — the cross-lens takeover overlay (SHIPPED 2026-06; `components/conkay/ConKayOverlay.tsx`)

> Status: the overlay below is no longer "next build" — it shipped. ConKay is
> summonable on **any** lens via ⌘/Ctrl+J, the command palette, AND a persistent
> floating "Ask Kay" button (every lens except chat, which hosts its own mode).
> NL→macro, DTU-locker artifacts, and seamless voice are wired (§9.4); the NL
> control lights up fully when the brains are online.

- **Global presence in the Concord Link shell.** ConKay becomes summonable from
  *any* lens (hotkey / Link bar), not only inside the chat lens. A lightweight
  overlay mounts over the current lens; the world-tree field + voice come with it.
- **Lens-aware intent → macro.** On summon, ConKay reads the active lens id +
  its manifest (the macros/features that lens exposes) and scopes Kay to *that*
  app's verbs. "Kay, add a frost-EQ preset and boost the pre-amp" on the music
  lens resolves to the lens's real `music.*` macros via `runMacro`.
- **Execute with ambient feedback + undo.** Each action runs the real macro,
  surfaces an ambient-action chip (what Kay touched), and — because every action
  is a discrete macro call — is naturally inspectable and reversible.
- **Cross-lens spans.** Because it's one substrate, a single request can cross
  lenses ("pull my tax DTUs, chart this quarter, draft the filing" =
  archive + finance + legal) — impossible for per-app assistants.
- **Safety posture.** Reuses the three-gate permission system + write-auth; only
  exposes macros the signed-in user may already call from that lens. High-privilege
  / destructive macros stay gated (the EDITH lesson).

This is the headline: **Tony↔JARVIS, but real** — an assistant that operates the
app from *inside*, semantically, via the host's own action contract. That is the
niche the industry is circling and nobody has filled.

*Research sources are catalogued in the session that produced this section
(open-source clones, App Intents, MCP, A2UI, RPA brittleness, Rabbit LAM,
Operator vs computer-use).*

### 9.4 Operate-by-speaking, work artifacts, and multi-brain narration

Shipped scaffolding (the overlay, `components/conkay/ConKayOverlay.tsx`):
- **NL → real macro.** Free text on a lens is sent — with that lens' real action
  list (`GET /api/lens-actions/:domain`) — to the conscious brain
  (`POST /api/brain/conscious`), which returns `{macro,input}`; ConKay executes it
  via `lensRun` (`/api/lens/run`). Graceful fallback when the brains are offline
  (lists the lens' real actions + the explicit `run <action>` path). Gated on
  brains-online to fully work — by design.
- **Work artifacts in the DTU locker.** Every ConKay task (skill or lens op) files
  a revisitable `kind:'conkay_artifact'` DTU (`POST /api/dtus`) capturing the task,
  the work (macro + input), and the result — so what Kay did is a real, reopenable
  record in your locker, not an ephemeral chat line. Fire-and-forget; never blocks.
- **Seamless voice.** `useConKayVoice` runs continuous + interim recognition (stays
  open across pauses; live "hearing you…" partials) with TTS pausing STT to avoid
  self-hearing; auto-resumes listening after speaking — hands-free turn-taking.

### 9.4b Trustworthiness — the verifiability surface (shipped 2026-06)

The Tony↔JARVIS *feeling* is here; the JARVIS *reliability* (never confidently
wrong) is the grind, and these landed toward it:
- **Trust badge on every reply** (`ConKayViz.tsx#TrustBadge`). A reply backed by a
  real artifact — a cited DTU, a web source, a completed macro/action, or computed
  data — reads **"Grounded."** A prose-only model reply reads **"Reasoned —
  verify,"** with tooltip copy that it must never be treated as proof of
  real-world/physics behaviour. Honest calibration so a confidently-wrong answer
  never passes as fact.
- **Compute, don't guess** (§8 math skill). Decidable math routes to the real CAS,
  not the LLM — correct + grounded.
- **`reason.verify` macro** (`domains/reason.js` + `lib/reason-verify.js`) — claim
  verification: a deterministic citation-resolution floor (catches *fabricated
  citations* — a cited DTU that doesn't exist/isn't visible — with no brains) plus
  the multi-brain **council** judge (`lib/agentic/council.js#councilDecision`) that
  rules SUPPORTED/UNSUPPORTED when the brains are up. Degrades gracefully — never
  stamps "verified" without verifying.
- **The boundary, by design:** ConKay computes/organizes; it does **not** certify
  real-world physics/engineering. The world sim and the LLM are never the source of
  physical truth — that's a real bench's job.

### 9.5 The work-animation language (JARVIS "you can see it building") — design

Grounded in the FUI studios that authored the actual Marvel HUDs (Jayse Hansen;
Territory Studio / Cantina Creative). **Principle: every animated element implies a
real task phase — motion is functional, fast, eased, never decorative-only; only
2–4 motifs run at once.** A single shared `phase` drives BOTH the Three.js scene
and the voice state machine, so visuals and voice express one mind.

**State → motion grammar** (the phase column is the single source of truth):
| Phase | Verb / gesture | Motifs | Energy direction |
|---|---|---|---|
| idle | slow core breathing | ring pulse, faint parallax | still |
| listening | reach-out + intake | inbound sweep, mic-amplitude-driven core | inward |
| analyzing | focus-pull | counter-rotating rings accel, decrypt/scramble telemetry, rare glitch | churning |
| building | **assemble** | schematic line-draw (SVG `stroke-dashoffset`), particle morph (`mix(scattered,target,uProgress)`), step cards drawing in one-by-one | outward, staggered |
| presenting | **assemble-then-settle** | wireframe→solid, scaffolding particles dissolve, skeleton→content reveal | decelerate to still |
| done | ring completion + check flourish | conic-gradient ring to 100%, ✓ stroke-draw with overshoot | one bright pulse |
| error | destabilize | glitch intensifies, ring stutters red | sharp collapse |

**The four hero transitions to nail:** reach-out (idle→listening), focus-pull
(listening→analyzing), **assemble-then-settle** (building→presenting — the key
"work is finishing" cue), ring-completion+check (→done).

**Web techniques (all buildable on the stack we already use):** SVG
`stroke-dasharray`/`dashoffset` line-draw; R3F `THREE.Points` morph via a
`uProgress` uniform; shader sweep (`smoothstep(uSweep±w, pos)`); CSS
`conic-gradient` progress rings + counter-rotating `@keyframes`; drei
`<EffectComposer><Bloom/>` for the cyan glow; Framer/GSAP staggered timelines for
the step-card cascade; text-scramble "decode" for headers + token shimmer for body.

**Modern-AI grounding (so it reads current, not cosplay):** agent **step/tool-call
cards** that appear → run (shimmer) → resolve (✓), a one-line live status
("Reading 4 sources…"), determinate ring only when a real % exists (else
indeterminate). These are the same patterns Claude/ChatGPT/Perplexity agent UIs use.

### 9.6 Multi-brain orchestration (the example flow)

> "Hey ConKay, what's the weather — bring up a diagram/animation of the forecast,
> and will it affect any prior planned events?"

Target behavior, mapped to Concord's real five-brain substrate:
- **Conscious brain = the voice + supervisor.** Talks to you continuously and
  *narrates while building* ("pulling the forecast… rendering it now… checking your
  calendar…"), and **monitors the utility brain's actions** (the conscious brain
  stays in contact while work happens).
- **Utility brain = the worker.** Runs the macros / fetches data / assembles the
  visualization (65% of lens-action traffic already routes here).
- **The animation runs concurrently** with narration (building phase) and the
  result **settles** into a live viz (presenting phase) + cross-references prior
  `world_events` / planned events for conflicts.
- **The whole task is filed as a DTU artifact** (§9.4) — revisitable, showing the
  task + the work + the rendered diagram.

This is the end-state ConKay; the overlay + skills + NL-resolver + artifact
persistence are the wiring already in place, and the work-animation language above
is the next build. Full concurrent narration + supervised utility-brain execution
lights up when the brains are online.
