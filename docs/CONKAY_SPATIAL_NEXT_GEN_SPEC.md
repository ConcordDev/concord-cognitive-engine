# ConKay — Truly Next-Gen Spatial 3D (design spec)

> Written 2026-07-18 at the owner's direction ("the obvious wedge is ConKay but I
> need it to be truly next-gen spatial 3D"). This is a **code-grounded spec**, not
> a vibe: it opens with the real current state (mapped by three read-only audits
> this session, every claim cited to `file:line`), then defines the concrete leap
> beyond it. It is deliberately taste-heavy and **not** a blind-fleet work order —
> the spatial feel needs strong-hand + real-device iteration. The units in §7 are
> fleet-shaped where they can be (new adapters, backend geometry) and flagged
> hand-built where they must be (the inhabit camera, the round-trip choreography).
>
> Source of truth for the design intent: this doc + `docs/CONKAY_HONEST_HOLOGRAM_PLAN.md`
> (the Track-K design source) + `docs/NEXT_ARC_PLAN.md` §B. Where they disagree with
> the code, the code wins (per CLAUDE.md §"Runtime-truth over source-guessing").

---

## 0. The wedge, in one paragraph

Every big lab in 2026 is racing to *generate* interactive 3D worlds from a prompt —
Genie 3 (24 fps persistent worlds), World Labs' Marble ($1B raised, Feb 2026), Meta's
WorldGen (traversable world from one prompt in ~5 min). They are all **hallucinated
geometry**: beautiful, and structurally not-real — you cannot own it, sell it, cite it,
or trust that the beam actually holds. ConKay's wedge is the exact inverse: you ask Kay
to build something, and it builds **the real thing** — a physics-solved structure, a
walkable world, a creature with a real body-plan — as an **ownable, cited, verifiable
DTU** you can step inside and change by talking to it, where *every pixel is a real
backend value*. That property — honest-by-construction spatial output over real
deterministic engines — is the one thing the generative-world-model race structurally
cannot copy. This spec turns today's inspect-only cockpit into that.

---

## 1. Where ConKay's spatial-3D actually is today (grounded)

**The JARVIS cockpit is already shipped.** Track K (K1–K6 + K6-voice) landed on 2026-07-03
(`docs/NEXT_ARC_PLAN.md` §B, commit hashes per phase). What exists and is wired:

- **Honest event spine** (Phase 0/1): `macro:started / macro:stage / macro:completed`
  socket events, run-correlated by `x-conkay-run-id`, drive `conkayHudStore` (single
  writer = the socket adapter). Verification climax via `reason.verify` → `TrustBadge`.
  (`ConKayOverlay.tsx:190-250`.)
- **Spatial FUI cockpit**: `ConKayCockpit.tsx` — a 3-column CSS-grid panel takeover
  (`[220px | 1fr | 220px]`, `hidden lg:flex` desktop-only) over a WebGL backdrop
  (`ConKayBackdrop` / `ConKayScene` "world-tree of light"). Panels resolve lazily from
  `lib/panel-registry.ts`; any registered `conkay.*` panel auto-appears.
- **The three concept panels**: `MacroLibraryPanel`, `ProvenancePanel`, `ForwardSimPanel`
  (`components/conkay/panels/`).
- **Lattice globe**: `LatticeGlobe.tsx` — spins ≥0.72 rad/s only while a real macro is in
  flight, idle ≤0.05 rad/s; emissive-driven Bloom (glow ∝ a real value).
- **The generalized artifact→3D pipeline** (K5, `7428d219`): a pure normalizer registry
  (`lib/conkay/artifact-kinds.ts`) → adapter map (`components/conkay/artifacts/ArtifactViewer.tsx`)
  → honesty **STOP-POINT** ("No 3D inspector registered … inspectable soon" for any
  unregistered kind, never a fake shape). **Five kinds render today:**

| Kind | Producer (real macro) | Render | Adapter | Class |
|---|---|---|---|---|
| `ar-render` | `ar.render` → `{drawList[]}` | exploded-view, click-to-inspect | `ArAdapter`→`ConKayArtifactExploded` | interactive 3D |
| `fea-frame` | `engineering.runFEA` → `{displacements, stresses, utilization}` | orbit + stress-colored deformed truss | `FeaAdapter`→`FEAResultViewer` | interactive 3D — **the strongest non-world surface** |
| `building` | `game-design.building-publish` → live `world_buildings` row | procedural archetype mesh | `BuildingAdapter`→`BuildingRenderer3D` | interactive 3D |
| `foundry-worldspec` | `foundry.preview` → `{previewWorldId}` | **full walkable `ConcordiaScene`** | `FoundryAdapter` | interactive 3D — the one "step-in" surface |
| `forge-app` | `forge.sandbox` → `{html}` | sandboxed iframe | `ForgeAdapter` | flat (2D web app) |

- **"Kay, build a tavern" is wired end-to-end**: NL → conscious brain picks
  `game-design.building-publish` → `ConKayActionConfirm` gate (publish ∈ WRITE_VERBS) →
  real `world_buildings` INSERT + blueprint DTU mint + `world:building-spawned` emit →
  `detectArtifact` → `BuildingRenderer3D`. (`server/domains/gamedesign.js:1905`,
  `ConKayOverlay.tsx:440-475`.)
- **Voice**: `conkay-persona.ts` pins `en_US-amy-medium` + "Kay, online." (honest caveat:
  server `voice.tts` still reads only `PIPER_VOICE` env, ignores per-request voice —
  identity pinned, server steering not yet guaranteed).

**The honest advantages already on the shelf** (audit §"Bottom line"): `BuildingRenderer3D`
+ `TerrainRenderer` are world-agnostic prop-driven renderers; `createBuilding` /
`createCreatureMesh` are pure procedural geometry factories; a full post/shader factory
set exists (`post-*.ts`, `ssgi`, `pcss-shadows`, `reflection-probes`, instancing/LOD/cull);
the `world_buildings` spawn+read backend is world-agnostic (`world_id` column throughout);
`@react-three/postprocessing@^3.0.4` **is installed and imported** (the stale "blocker" in
old docs is false).

### The four honest gaps (this is what "not yet truly next-gen" means)

1. **Inspect-only, not inhabit.** Four kinds render as an object you rotate/explode from
   *outside*. Only `foundry-worldspec` lets you step in. You look *at* the tavern; you
   don't walk *into* it at real scale.
2. **One-shot, not round-trip.** Kay builds → you inspect → done. There is no
   conversational manipulation loop: "make the tower taller / add a beam / thicken the
   columns" does not re-run the real macro and update the *same* artifact in place with
   the real engine re-solving. The compute-don't-guess oracle is not yet *iterative and
   spatial*.
3. **Narrow truthful-geometry surface.** Only 5 kinds. Deterministic engines that already
   emit renderable geometry are unwired: `robotics.forwardKinematics/inverseKinematics`
   return joint `points[]` + `endEffector` (`server/domains/robotics.js:200,232`) but
   have **no adapter** — and they're **2D planar** (`x,y`), so they need a lift-to-3D, not
   just a renderer. CAS/`math.js` results feed only 2D `ChartKit` (`ConKayViz.tsx`); no
   3D plot/field surface. No molecule / CAD / generic-mesh adapter exists.
4. **The moat is enforced weakly.** The honesty invariant (no `setInterval`/`setTimeout`
   driving "work" animation) is enforced by **per-panel opt-in test scans**
   (`ArtifactViewer.test.tsx`, three panel tests) — **not a repo-wide gate**. A new panel
   is uncovered unless its own test adds the scan. There is no `scripts/` honesty gate for
   `components/conkay/**`. The single most un-clonable property in the whole product is
   guarded by convention, not by CI.

---

## 2. What "truly next-gen" means here (the thesis)

Not "prettier cockpit." Not "chase photorealistic generated worlds" (we *can't* — a
hallucinated mesh is not a real backend value, so it violates honest-by-construction; see
§6). The leap is a **spatial creative-partner loop** that no competitor has, defined by
three verbs:

> **Inhabit → Iterate → Own.**
> You ask Kay to build the real thing. You **step inside it** at real scale. You **change
> it by talking** and watch the real engine re-solve in place. And what you're standing in
> is an **ownable, cited, verifiable DTU** — not a render, an asset with a lineage and a
> royalty cascade.

Every one of those three is honest-by-construction and each rides a moat a generative
world-model can't cross:
- **Inhabit** rides Concord's *real* walkable-world engine (ConcordiaScene) — the geometry
  is a real structure, not a diffusion frame.
- **Iterate** rides the *deterministic engines* (FEA, CAS, procedural-build) as an oracle —
  "watch the physics re-solve as you speak" is impossible without them.
- **Own** rides the *DTU substrate + royalty cascade* — the thing you built is a first-class
  asset that pipes into any other lens and pays you when it's built on.

---

## 3. Reference bars (and the anti-patterns)

**Aim at:**
- **JARVIS / F.R.I.D.A.Y.** (the canonical model; already the cockpit's north star) — but
  the upgrade is the *Tony-in-the-workshop* beat: grab the holographic engine, pull it
  apart, tell it to change, watch it re-form. That's Inhabit+Iterate, not just a HUD.
- **World Labs "Marble" / Genie 3 "step into the world"** — match the *felt* bar (you're
  inside a place, free camera, real scale) while beating it on *what* you're inside (a real
  ownable structure, not a hallucination).
- **The FEA re-solve** is our unique "wow": no reference app lets you say "make it taller"
  and watch a real stress field recompute on the geometry in front of you. This is the
  30-second shareable moment (§9).
- **Mission-control agent UIs** (the 2026 consensus: chat-first fails; readable timeline of
  what/when/why/with-which-data, confirmation checkpoints, receipts) — the cockpit's
  orchestration trace + confirm gate already match this; the round-trip loop extends it into
  the artifact itself.

**Explicitly avoid (anti-patterns):**
- **Minority Report mid-air gestures / sustained arm-in-air** — *Make It So* (Shedroff &
  Noessel) gorilla-arm lesson. Voice + pointer, never sustained gesture.
- **Spatial-as-chrome** — do not make the *conversation* 3D. The Vision Pro lesson: 3D
  interaction on a flat task is friction. The conversation stays flat and fast; the
  *artifact* is where the dimension lives (§5).
- **VR-headset requirement** — desktop WebGL first; WebXR is progressive enhancement, never
  a gate.
- **Generative photorealism chase** — see §6.

---

## 4. The four pillars (concrete capabilities)

### Pillar 1 — Inhabit: from "inspect from outside" to "step inside at real scale"

Promote any geometric artifact from a panel-sized orbit view to a **full-bleed spatial
workspace you can enter**. `foundry-worldspec` already proves the walk-in is possible; the
work is to *generalize* it.

- **A "step in" affordance** on the `ArtifactViewer` for `building` / `fea-frame` / (future)
  `creature` kinds: orbit → free-cam / first-person walk at the artifact's real dimensions.
- Reuse `ConcordiaScene`'s camera modes (`cameraMode: 'isometric'|'free'|...`,
  `ConcordiaScene.tsx:125`) and the existing LOD/instancing/cull infra so real-scale walk
  holds 60fps.
- **Decoupling prerequisite** (audit §2): `ConcordiaScene` binds its data layer to
  `localStorage['concordia:activeWorldId']` with a `'concordia-hub'` fallback, *not* to its
  `districtId` prop. To host an arbitrary artifact-world honestly, formalize the binding —
  drive the data-fetch worldId from the prop, drop the localStorage side-channel (or make it
  an explicit, documented artifact-scoped channel). This is the single highest-leverage
  refactor for Inhabit.
- Honesty: entering an artifact renders *only* the geometry the backend produced. An FEA
  frame you "step into" shows the real deformed shape + real per-member stress color —
  nothing interpolated into existence.

### Pillar 2 — Iterate: the conversational round-trip (the killer loop)

The differentiator. Today the pipeline is `macro → detectArtifact → render`, terminal. Make
it a **loop**:

```
inspect artifact  →  "make the tower taller / add a second beam / thicken the columns"
      ↑                                    ↓
  same artifact updates in place  ←  Kay re-runs the REAL macro with the delta
                                    ←  the real engine re-solves (FEA recomputes stress)
```

- **Delta intent extraction**: the conscious brain maps the utterance to a *parameter delta*
  on the artifact's source macro + input (both are already carried on the artifact:
  `sourceDomain`, `sourceMacro`, and the normalized input). "Taller" → `dimensions.height +=`;
  "add a beam" → append a member to the FEA model; etc.
- **Re-run + reconcile**: re-invoke the real macro (through the existing confirm gate for
  mutating ops) → new result → `detectArtifact` → **diff against the current artifact** →
  animate the *change* as a pure function of the returned delta (a beam slides in, the stress
  field recolors). No `setInterval`; the animation is the real before→after.
- **The FEA re-solve is the showcase**: change the geometry, `engineering.runFEA` recomputes,
  `FEAResultViewer` recolors utilization. "Watch the physics update as you talk" — provably
  real, impossible to fake, impossible for a world-model competitor to match.
- **Honest failure**: if a delta can't be honestly applied (macro rejects it, engine errors),
  the artifact **does not change** and Kay says so — never a cosmetic tweak pretending the
  backend agreed.

This pillar is **hand-built, not fleet-dispatched** — the delta grammar + reconcile
choreography is taste-heavy and needs real-device iteration.

### Pillar 3 — Widen the truthful-geometry surface (close the kind gap)

Add kinds by following the *existing* pattern (pure normalizer → adapter → STOP-POINT) — the
pipeline is not reinvented, only extended. Priority order by "real geometry already exists":

1. **`robotics-arm`** (fastest honest win): `robotics.forwardKinematics/inverseKinematics`
   already return `points[]` + `endEffector`. Lift the 2D planar chain to a 3D polyline +
   joint spheres; animate the IK solve (CCD iterations are real steps). New normalizer +
   `RoboticsAdapter`. *Note the 2D→3D lift is real work, not just a renderer.*
2. **`cas-field`**: `math.js` numeric results → a 3D surface/vector-field plot for functions
   of 2 vars (real sampled grid, not a hallucinated surface). Honest STOP-POINT for symbolic
   results with no plottable field.
3. **`creature`**: `createCreatureMesh` is a pure standalone factory; wire a `creature-publish`
   artifact (the audit notes creatures are the natural fusion home) so "Kay, design a
   six-legged pack animal" renders the real body-plan mesh.
4. **`mesh` / molecule / CAD** (later): generic mesh adapter for any macro that emits vertices
   + faces; only when a real producer exists.

Every kind keeps the rule: it renders 3D **only** when a real engine produces the field;
otherwise the STOP-POINT stands. (Charts stay 2D `ChartKit` unless a real 3D field exists —
do not 3D-ify a bar chart for spectacle.)

### Pillar 4 — Make the moat un-erodable + legible

Two halves — mechanize the honesty rule, then make the honesty *visible*.

**(a) Global honesty gate (close the enforcement gap).** Promote the per-panel `setInterval`
scans to a **single repo-wide gate** over `concord-frontend/components/conkay/**` +
`lib/conkay/**`: no `setInterval`/`setTimeout` may drive "work" animation. Allow a **narrow,
explicitly-listed** set of known-safe UX-teardown timers (e.g. `ConKayOverlay`'s 1400ms
finished-spine clear, nav delays) — an allowlist file, not a blanket exemption. Register it
like the other integrity gates (`scripts/`, CI-wired in `audits.yml`), `severity: high` on a
NEW unallowlisted timer, pinned by a bidirectional test (proves it catches a real violation
AND passes the allowlisted set). This turns the single most un-clonable property from
"convention" into a PR gate — the same move that closed fabricated-data and generic-scaffold
(see `docs/CONTENT_INTEGRITY_SWEEP.md`: this is a new integrity-class, "honest-hologram
motion," to add to that ledger).

**(b) Provenance-in-space (the differentiator, made visible).** Every spatial artifact carries
its receipts *in the scene*, not just in a side panel: the DTU id it *is*, the macro that made
it, the `reason.verify` verdict badge, and its lineage/royalty position. You are not looking at
a render — you are standing in an **ownable, cited, verifiable object**. Surface a "this is a
DTU — own it / list it / see its lineage" affordance on the inhabited artifact, wiring the
existing marketplace-list + royalty-cascade path. This is the hook the generative-world-model
competitors structurally lack: their output can't be owned, cited, or paid-forward.

---

## 5. The flat/spatial split + feel/latency targets

**The split (non-negotiable):**
- **Conversation = flat + fast.** Text, transcript, command bar, telemetry chip, orchestration
  trace — all flat DOM. No 3D interaction tax on the talking.
- **Artifact = spatial.** The dimension lives in the thing Kay built. Inhabit/Iterate/Own all
  operate on the artifact, never on the chat.
- **Graceful degrade**: WebGL-less / `prefers-reduced-motion` / mobile → the same panels flat,
  the artifact as a static labeled view. `@react-three/a11y` already in the stack.

**Feel/latency targets (the docs today state none — these are the bar):**
- **Artifact appears within one frame of `macro:completed`.** No fabricated loading spinner
  between the real result and the render (an honest "solving…" beat tied to a real
  `macro:stage` is fine; a fake progress bar is not).
- **Round-trip (Iterate) target: < ~2s** from "make it taller" to the re-solved artifact
  updating in place, for a small model. If the re-run is slower, the *honest* in-flight beat
  (lattice globe spinning, stage beats) carries it — never a fake fill.
- **Inhabit holds 60fps** at real scale via the existing LOD/instancing/cull infra; a dropped
  frame budget degrades quality preset, never fakes smoothness.
- **Glanceable**: readable in ~1s, detail on demand (the mission-control principle).

---

## 6. Non-goals / guardrails (what we will NOT build)

- **No generative-world-model photorealism.** A diffusion/neural-rendered mesh is not a real
  backend value; rendering one as an artifact would be fabrication-by-substitution (the exact
  `atlas`-change-map / mesh-tomography trap in `docs/FUNDING_GATED_FEEDS.md` §B). If we ever
  add neural assets, they are labeled generated, never presented as a computed/verified object.
- **No 3D conversation UI.** See §5.
- **No mandatory VR.** WebXR is progressive enhancement (the K5 stretch `ARPreview.tsx` real
  hit-test is welcome, but never the floor).
- **No mid-air gesture control.**
- **No fake motion, ever.** Pillar 4a makes this mechanical. Any animation with no real
  backend event behind it is a bug, not a polish choice.
- **No silent artifact mutation.** Iterate changes the artifact **only** when the real macro
  agreed; a rejected delta leaves the geometry untouched + says why.

---

## 7. Phased build plan

Ordered by leverage × honesty-safety. Fleet-shaped units are marked ⚙; hand-built /
taste-heavy units are marked ✋ (dispatch a scoped agent for the plumbing, but the orchestrator
drives the feel).

**Phase S1 — Widen + harden (fleet-friendly, no new interaction model):**
- ⚙ **S1-a** `RoboticsAdapter` + `robotics-arm` normalizer (2D→3D lift of the real FK/IK
  `points[]`; animate CCD iterations). Reuse the normalizer→adapter→STOP-POINT pattern.
- ⚙ **S1-b** Global honesty gate (Pillar 4a): `scripts/check-conkay-honest-motion.mjs --ci` +
  allowlist + bidirectional pinning test + wire into `audits.yml` + add the row to
  `docs/CONTENT_INTEGRITY_SWEEP.md`. **Guard-adjacent** (it's a new gate) → owner-reviewed.
- ⚙ **S1-c** `creature` kind: `creature-publish` artifact + `CreatureAdapter` over the pure
  `createCreatureMesh` factory.

**Phase S2 — Inhabit (the decoupling + the camera):**
- ✋ **S2-a** Formalize `ConcordiaScene`'s worldId binding (prop-driven data fetch; retire the
  `localStorage['concordia:activeWorldId']` / `'concordia-hub'` fallback for artifact-hosting).
  Highest-leverage refactor; test against the existing foundry-preview path so no regression.
- ✋ **S2-b** "Step in" affordance on `ArtifactViewer` for `building`/`fea-frame`/`creature`:
  orbit → free-cam walk at real scale, reusing ConcordiaScene camera modes + LOD infra.

**Phase S3 — Iterate (the killer loop, hand-built):**
- ✋ **S3-a** Delta-intent extraction: conscious-brain prompt mapping an utterance → a parameter
  delta on `{sourceDomain, sourceMacro, input}`. Start with `building` (dimensions) — the
  smallest honest slice.
- ✋ **S3-b** Re-run + reconcile + before→after animation (through the confirm gate). Honest
  failure path first.
- ✋ **S3-c** The FEA re-solve showcase: "add a beam / make it taller" → `engineering.runFEA`
  recomputes → `FEAResultViewer` recolors utilization in place. This is the demo (§9).

**Phase S4 — Own (provenance-in-space):**
- ⚙ **S4-a** Provenance overlay on the inhabited artifact (DTU id + macro + verify badge +
  lineage), reading fields the backend already produces.
- ⚙ **S4-b** "Own it / list it / see lineage" affordance wiring the existing marketplace-list +
  royalty-cascade path. **Touches the marketplace/royalty surface** → money-adjacent, owner-
  reviewed, pinning test (no new payment machinery — reuse `purchaseArtifact` / the cascade).

**Sequencing note:** S1 ships visible wins immediately and hardens the moat before any new
interaction model. S2's decoupling unblocks both Inhabit and a cleaner artifact host. S3 is the
wedge and is where the strong-hand time goes. S4 makes the "you can own this" hook real.

---

## 8. Honest-by-construction invariants (must hold across all phases)

1. **Every animated element is a pure function of a real backend event.** Mechanized by the
   Phase-S1-b global gate. No `setInterval`/`setTimeout` work-animation; allowlist only for
   named UX-teardown timers.
2. **Single-writer store.** Only the socket-event adapter writes `conkayHudStore`.
3. **STOP-POINT over fake render.** An artifact kind with no real renderer shows "inspectable
   soon," never a placeholder shape. A macro with no natural internal boundary stays
   start/complete-only.
4. **Iterate never fabricates agreement.** The artifact changes only when the real macro
   returned a real new result; a rejected delta leaves it untouched and says why.
5. **Compute-don't-guess.** Forward-sim / FEA / CAS render only real engine outputs; a
   non-computed claim carries the "Reasoned — verify" badge, never a "Grounded" one.
6. **Provenance is truthful.** The DTU id, macro, verify verdict, and lineage shown in-scene
   are the real ones; if a field is absent it is omitted, not invented.

---

## 9. The demo (the shareable 30-second moment)

> "Kay, build me a three-story timber watchtower here." — a real tower rises
> (`building-publish`, live `world_buildings` row, ownable DTU). "Let me walk in." — you step
> inside at real scale. "Run the structure." — `engineering.runFEA` solves; the frame recolors,
> the overloaded top beam glows red. "Make the corner posts thicker." — Kay re-runs with the
> delta, the posts thicken, the physics **re-solves in front of you**, red → green. "It's mine
> now." — the tower is a cited, verifiable DTU you can list, and anyone who builds on it pays
> you.

No other product on Earth can show that clip honestly, because no one else has the real
deterministic engines under the hologram *and* the DTU-ownership substrate around it. That clip
is the wedge.

---

## Appendix — audit provenance

This spec is grounded in three read-only code audits (2026-07-18, this session) + two web-
research grounding passes (2026 spatial-computing frontier; agentic mission-control UX). The
current-state claims in §1 are each cited to `file:line`; the highest-leverage findings (the
5-kind registry, robotics-geometry-without-a-renderer, per-panel-not-global honesty
enforcement, postprocessing-installed) were independently re-verified by direct grep before this
doc was written.
