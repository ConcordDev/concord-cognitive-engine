# Official Plan — Production Ship-Readiness (A–G) + Design North-Star

> **For the next instance.** This is the durable, merged-to-main copy of the working plan.
> It captures the **entire plan**, **what has shipped** (with commit hashes + verification),
> and **what's still left**. Trust the code over any doc, including this one — but this is the
> map. Develop on `claude/system-p1-resolver-conflicts-sA2Hw` (or a fresh feature branch);
> never push directly to `main`.

---

## 0. Status at a glance (2026-06-01)

| Track | Scope | Status |
|---|---|---|
| **A** — playtest bug tail | #11, #F1, #30, #R7, #S1, #T4, #32 | ✅ **COMPLETE** (shipped + live-verified) |
| **G** — data-provenance + licensing | G1 vision swap, G2 feed hygiene, G3 MapLibre, G4 license gate | ✅ **COMPLETE** (shipped + gate clean) |
| **E** — user-bug intake & observability | E1 desync, E2 econ-anomaly, E3 triage, E5 Sentry env | 🟡 **MOSTLY** (E1/E2/E3/E5 shipped; **E4 + E6 remain**) |
| **C** — prevention/verification | Gate D param-schema, L2 no-mask | 🟡 **STARTED** (Gate D + L2 shipped; **L4/L5/dynamic-SQL remain**) |
| **Stealth** — step-zero | `stealth-perception.js` skill-lookup fix | ✅ **SHIPPED** (was always returning 0) |
| **B** — feature builds | Temperament P4–P7, Concord Link (8 phases), gap-closure 1–2 | ⬜ **NOT STARTED** (largest; multi-session) |
| **F** — five frontiers instrumentation | F1 cold-watcher, F2 liveness, F3 anti-cartel/mod, F4 cost/solvency, F5 share/referral | ⬜ **NOT STARTED** |
| **D** — ship | wiring report, `next build`, validate-routes/score-lenses/check-deps, **the PR** | 🟡 in progress |

**~41 new tests this session, all green.** Every server-side edit confirmed on a live clean
boot (`runtime_tables_ensured`, health 307, no module/reference errors).

---

## 1. What shipped (commits on `claude/system-p1-resolver-conflicts-sA2Hw`)

| Commit | Track | Summary |
|---|---|---|
| `c1804a8` | A | #11 ghost-fleet race (225s→20s, `CONCORD_GHOST_FLEET_DELAY_MS`); #F1 `ensure-runtime-tables.js` (+51 tables, idempotent, boot-wired @ `server.js:4942`); #30 spell licensing via `dtu_licenses`; #R7 `startWorkstationSession` signature; #S1 `reportDanglingFactionRefs` soft-warn; #T4 wiring report (103 wired/104 inline/0 orphan). #32 = false positive (`dtu.get` reads in-mem `STATE.dtus`). |
| `c835b54` | G1+G4 | Vision model `llava:13b-v1.6-vicuna` → `qwen2.5vl:7b` (Qwen2.5-VL, Apache-2.0) across config/profiles/compose/env/docs (env-override `BRAIN_VISION_MODEL`); `docs/DATA_PROVENANCE.md` + `docs/LICENSING.md`; `scripts/audit/gates/license-scan.mjs`. |
| `0aecfbf` | G2 | Feed-manager hygiene: `CONCORD_FEED_MANAGER_ENABLED` kill-switch, robots.txt reuse + 429/Retry-After backoff, `purgeBySource()` takedown + denylist, LRCLIB source-URL persistence. |
| `4d8ab19` | G3+G4 | react-leaflet (Hippocratic-2.1) → **MapLibre GL (BSD-3)** in 4 components via `lib/maplibre/osm.ts`; ~30 consumers untouched (props preserved); license gate wired into `audits.yml`, **0 violations across 2,187 pkgs incl. mobile**. |
| `85819ac` | E1 | Desync telemetry: `concord_combat_reach_rejected_total` + `concord_combat_damage_rejected_total` counters (`lib/desync-metrics.js`), incremented at the 2 reject sites in `routes/worlds.js`, `ConcordDesyncSpike` alert. |
| `bdb35cd` | E3 | `lib/bug-triage.js#classify` — Critical/Major/Moderate/Minor severity router (Critical=data-loss/exploit/security → page). |
| `840abfe` | E2+E5 | `emergent/economy-anomaly-cycle.js` heartbeat (freq 240, global, `CONCORD_ECON_ANOMALY=0`): detectPathologies + wash-trade → `concord_econ_anomaly_total{kind}` → bug-triage → error-alerting. **Observe-only.** + Sentry env in `.env.runpod`. |
| `fb7f194` | C/Gate D | `lib/macro-param-schema.js#validateParamSchema` + `runMacro` guard on `spec.paramSchema` (opt-in, additive) — retires param-key drift (#6/#31/#21). |
| `3ca2a86` | C/L2 | `isFallthroughMasking` assertion in `tests/behavior/lens-behavior-smoke.behavior.js` — a deterministic macro must never leak the `{ok:false,source:'utility-brain'}` mask (#3/#27). |
| _(this batch)_ | Stealth | `lib/stealth-perception.js#_getSkillLevel` now reads the authoritative `player_skill_levels` (was querying `dtus` with wrong owner column → always 0). |

---

## 2. What's still left (the honest remainder)

### Track E (finish the observability half)
- **E4 — client-error intake + auto-context.** `POST /api/client-error` (rate-limited,
  public-write, kill-switched) → `kind='client_error'` DTU → `bug-triage`. Wire
  `ErrorBoundary onError` + `app/global-error.tsx` to POST it; extend `FeedbackWidget` with the
  same auto-context (lens/world, last-N actions, console-tail, UA/viewport) via a new
  `useBugContext()` hook (ring-buffer). **Held this session — it's a cross-stack public-write
  route through the three-gate auth system; do it carefully (the public-POST allowlist).**
- **E6 — synthetic journeys.** Reuse `first-cycle-journey.test.js` + an SSE incremental-stream
  check as a scheduled probe (shared with Track C-L5).

### Track C (the rest of the verification tiers)
- **L4 browser (Playwright).** Extend `tests/e2e/all-lenses-walk.spec.ts` to auto-derive from
  `app/lenses/*`; assert no `console.error`/`pageerror`/`requestfailed` + content renders.
  **Chromium download was 403-blocked in-sandbox** — commit the spec, run on a browser box.
- **L5 scale/LLM/mobile.** Artillery socket.io journeys; Promptfoo+Giskard golden-set/red-team
  over the 28 `TASK_PROMPTS`; Maestro mobile flows. **Environment-gated to RunPod/EAS** — build
  the configs in-repo runnable; full external run is environment-gated.
- **Dynamic-SQL fuzz.** Log every `db.prepare`/`db.exec` (incl. the 167 `${}` ones) during the
  L2/L4 sweep + validate vs live schema; Schemathesis the dynamic-SQL endpoints.

### Track B (feature builds — largest, multi-session; all kill-switched + tested)
- **B1 Temperament P4–P7** (`docs/TEMPERAMENT_BUILD_PLAN.md`, behind `CONCORD_TEMPERAMENT`):
  P4 proportionality + surrender/arrest state machine (`lib/combat-restraint.js` + mig **317**
  `world_npcs.combat_state`); P5 DOWNED band + capture/transport (`lib/capture-transport.js` +
  mig **318**); P6 Graham 3-factor legitimacy rubric + 2 CI gates; P7 assistance-gate + depth-cap
  + zone/child lore-weld. **This IS the "safeguard the emergence" layer (see §3).**
- **B2 Concord Link** (`docs/CONCORD_LINK_BUILD_PLAN.md`, 8 phases, behind `CONCORD_LINK_SYSTEM`):
  Glance→Summon→Sanctum. Includes the cross-world-effectiveness key fix (`skill_affinity` vs
  `skill_effectiveness_rules`). **This IS the "missing pause" (see §3).**
- **B3 Gap-closure**: first-10-min FTUE (`first_cycle_forge` → Forge; onboarding pacing ≤3 min);
  per-world atmosphere profiles (`concordia-theme.ts`) + colour-key gate + screenshot-diff.

### Track F (five-frontiers instrumentation — all kill-switched + tested, no economy change)
- **F1 cold-watcher** fun-funnel telemetry (stall/rage-quit/abandon), tool-vs-network funnel split.
- **F2 liveness** dashboard (patch-cycle return on the MMO clock, atomic-network cohort metrics,
  self-moving-world novelty-health) + daily/weekly "reason to return" surface (`weekly_objectives`).
- **F3 anti-cartel/abuse** monitors (extend `detectWashTrading` + E2 to multi-account collusion)
  + griefing/abuse report path (extend E4) + moderation queue (reuses org-governance).
- **F4 economics** cost telemetry (Ollama GPU-hours, DTU-storage curve) + royalty-cascade solvency
  sim + unit-econ panel.
- **F5 distribution** share-card/referral/deep-link instrumentation (`world_invites`).
  *(Judgment + Distribution verdicts stay the user's; only the instrumentation is built.)*

### Track D (ship)
- `next build` + `validate-routes` + `score-lenses` + `check-deps` on a Phase-0/RunPod box.
- **Open the PR** `claude/system-p1-resolver-conflicts-sA2Hw` → `main`. (Outward-facing —
  the one action paused for explicit go-ahead.) Offer to watch CI / autofix.

---

## 3. Design north-star — the four framing lessons (folded; `DESIGN_NORTH_STAR` content)

Concordia is reaching for a feel — curiosity/go-anywhere, an emergent living world,
minimal-HUD/deep-menus, fluid movement, earned relationships, real stealth — in a **real-time
multiplayer real-economy** context that strips away single-player crutches (the pause button,
the license to be janky, free local netcode, imperfect-AI-only stealth). The recurring answer:
the substrate to do these **better** than the source games already exists; the cost is the
**multiplayer tax** (server-authority + prediction/reconciliation), which is the **same desync
axis Track E1 now measures**.

- **Bethesda feel.** Concord Link = the missing **pause** (Glance→Summon→Sanctum: depth-on-demand,
  no world-freeze; B2 acceptance bar = "minimal HUD, deep menus"). The **gates** = the missing
  **jank-license** (freedom-feel without the jank-tax). **Invariant 1 — safeguard the emergence**
  (Temperament P4–P7 is the guardrail so the scheme/secret/hook/nemesis sim can't grief or
  soft-lock). **Invariant 2 — keep emergence invisible** (it must read as *world-flavor*, not a
  debug feed; `EmergentEventFeed`/cold-watcher/liveness are *operator* surfaces, not player UI).
  **Compass discovery loop** = the retention hook (F2 leans into lore mysteries/quest markers/
  lattice-born quests as undiscovered markers that keep generating breadcrumbs).
- **High-on-Life movement fluidity.** Chain the verbs / **preserve momentum** across transitions
  (`traversal-kinematics.ts` already tracks momentum — a tuning job); movement+combat fusion is
  native (move-system fire⊕flight); add the **invisible forgiveness layer** (coyote time, air
  control, web-swing snap-to-anchor); juice the camera off `GameJuice` + `concordia:flight-state`.
  **The catch:** MP fluidity needs **client prediction + server reconciliation** — measured by E1.
- **ARK earned relationships.** tame→level→breed→imprint→saddle, but **generative** (adaptation
  engine), **economic** (a bred+imprinted lineage = a royalty-bearing DTU asset — ARK never had
  that), **non-tedious** (fidelity dial), **relationship-universal** (mounts + courtship/spouse +
  nemesis + schemes). Don't copy the grind or **loss-as-griefing** (gate mount loss to non-safe
  zones via Temperament/Refusal + `world-zones` sanctuary — the same safeguard + E2 spine).
- **Proper MMO stealth = information control, not invisibility.** Server-authoritative **gradient
  perception** (light/sound/distance/facing — Concordia's per-cell Layer-7 `sight_os.illumination`
  + `sonic_os.ambient_db` is the keystone almost no MMO has) + **partial-info reveal** (tells,
  footprints/`FootprintLayer`, last-known-position) + **social blending** (crowds/disguise/
  faction/wardrobe) + **real cost** + **observer counterplay** (the detective lens). Alert ladder =
  Temperament's NEUTRAL→WARY→WARNING→HOSTILE. **Step zero (DONE):** `stealth-perception.js` was
  reading 0 for everyone — fixed to `player_skill_levels`. **The crux:** server-authoritative
  per-observer reveal (don't send full position to clients who shouldn't see it — same prediction/
  anti-cheat problem as movement; PvE-vs-NPC is the easier first target).

These are **acceptance bars + invariants on B/E/F**, not new tracks. The strategy (taste,
go-to-market, community-ops) stays the user's; the engineering + instrumentation make it legible.

---

## 4. Key invariants this plan must not violate

- **Constitutional economy** (`MAX_ROYALTY_RATE=0.30`, `WITHDRAWAL_HOLD_HOURS=48`, the fee splits)
  — no change without governance. All E/F monitors are **observe-and-alert only**.
- **Heartbeat modules never throw** (try/catch); new per-world writes are `scope:'world'`.
- **NPC secrets never reach LLM prompts** (`narrative-bridge.js`).
- **Everything new is kill-switched, off == byte-identical, and has a test.**
- **Migrations are append-only** (next numbers: 317, 318 for Temperament).
- Boot-order TDZ: code referencing `app`/`LENS_ACTIONS` at top-level must sit after their
  declaration or run post-boot.

---

## 5. Reproduce / verify

```bash
# backend (no external services needed; Ollama degrades gracefully)
cd server && JWT_SECRET=<32+chars> PORT=5050 node server.js
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5050/api/health   # 307 = up

# the gates
node scripts/audit/gates/schema-drift.mjs --ci          # 0
node scripts/audit/gates/license-scan.mjs --ci          # 0 violations
node scripts/audit-emergent-wiring.mjs                  # 0 orphan

# this session's new tests (all green)
cd server && node --test tests/glyph-spells-license-cast.test.js \
  tests/ensure-runtime-tables.test.js tests/feed-ingestion-hygiene.test.js \
  tests/desync-metrics.test.js tests/bug-triage.test.js \
  tests/economy-anomaly-cycle.test.js tests/macro-param-schema.test.js \
  tests/stealth-perception.test.js
```

The four framing docs (Bethesda / High-on-Life / ARK / stealth) and the cold-start/retention/
solo-liveops research live in §3 + the build-plan docs; trust the code first.
