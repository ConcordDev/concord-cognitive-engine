# concord-os.org — user-test findings (2026-09-07)

Tester: owner (mobile Safari, iPhone) + Claude (API repro, mobile UA) + a
headless-Chrome browser-agent walkthrough (49 lenses).
Deploy under test: production standalone build, commits `63cc665` + `c1127eb`.

## Fix status (commit `ce4b004`)

| Finding | Status |
|---|---|
| **Memory leak** | Not a leak — event-loop starvation under load on the shared box. Blueprint written: `docs/OFF_MAC_MIGRATION_BLUEPRINT.md`. |
| R2 — `/lenses/dtus` React #185 crash | **FIXED** — `useShallow` on the zustand v5 selectors. |
| B4 — locker shows global/junk | **FIXED** — locker defaults to "My vault" (owner-only) + toggle; backend passes viewer id + honors offset/limit/query. 14 harness-junk DTUs purged from `dtu_store` during the redeploy. |
| B1/R4 — "You don't have permission" toast | **FIXED** — silent for background-GET 403s; bare user-action 403 now reads as a session/CSRF expiry, not authz. |
| B2 — mobile chat layout | **PARTLY FIXED** — BrainModePanel `compact` pill (was rendering the full disclosure wall in the header); toasts clear the tab bar + span width; Agent Mode FAB above the tab bar. A full mobile chat pass is still owed. |
| B3 — onboarding forces Concordia | **FIXED** — `/onboarding/location` → `/hub`; character creation deferred to first World-lens open. |
| R3 — `127.0.0.1:5050` in prod bundle | **FIXED** — `concord-frontend/.env.production.local` blanks the two `NEXT_PUBLIC_*` vars for builds. |
| B1 (agent numbering) — 503 load-shedding | **ROOT-CAUSED, not yet fixed** — needs the off-Mac migration. |

## Second batch (commit `dab6243`)

| Item | Status |
|---|---|
| **#7 — Sovereign Health ribbon** | **DONE** — `components/shell/SovereignHealthRibbon.tsx` in the global Topbar. Reads the PUBLIC `/api/system/health` (now returns `heartbeat` + `substrate` too). 3 pulse chips: brain count/mode, governorTick liveness, DTU substrate size. Honest — gray "—" when unreachable, never a fake green. Replaces the powerMode-only pulse dot **and** the chat header's `CycleTelemetryRibbon`. |
| **#5 — ConKay scaffolding examples** | **DONE** — 3 clickable worked-example prompts under the "Build in world" field in `ConKayOverlay`; click populates + fires the NLP→partMesh/FEA→apply_mesh path. |
| **#6 — optimistic UI / skeletons** | **chat already covered** (optimistic user bubble on `onMutate`, a "thinking" indicator while pending, live streaming render + ConKay `workStatus` micro-status). A broader per-lens content-skeleton pass is genuine follow-up work, not done here. |
| **D3 — user-menu "Settings" → admin lens** | **FIXED** — now `/settings`. |
| R1 world-lens assets/socket, R5 code-lens CSP, D1 privacy copy, D2 brain differentiation, D7 "Fallback 5/4" chip | logged, not yet addressed |

## TL;DR — "what's the deal"

Two categories. Most of the "it's broken / offline / permission errors" experience is
**one root cause: the box is overloaded.** A smaller set are real code/UX bugs.

---

## A. ENVIRONMENTAL — the production box is a laptop under ~4x its own dev load

- concord-os.org backend + frontend run on the **same Mac** that also runs the
  agent fleet (~30 `llm-worker.py`), VS Code, Ollama, Spotlight (indexing the fresh
  555 MB build), and my build jobs.
- Measured: `GET /api/dtus/*` returned **HTTP 503 `event_loop_lag_critical`,
  `lagMs: 3595`, `thresholdMs: 900`** during a load spike. The backend's own
  shed-load guard was dumping requests.
- When the box is calm (load avg ~5): **10/10 `/api/auth/me` → 200**, brain health
  `allHealthy: true`, chat context loads. Nothing wrong with the code path.
- **This is the cause of:** "goes offline too much", "Health: unreachable",
  "Context: not loaded", and a chunk of the "permission errors" (503 → generic
  error toast).
- **Fix options:** (1) move the public site off the dev box (the pod, or a
  separate machine); (2) `renice`/core-pin the agent fleet below the backend;
  (3) raise `event_loop_lag` shed thresholds (band-aid, hides the problem).

---

## B. REAL BUGS (independent of load)

### B1. "You don't have permission to do that" is shown for almost any 403
`concord-frontend/lib/api/client.ts:523` — every HTTP 403 without a specific
`code` renders that toast. **CSRF-cookie failures return bare 403**, and mobile
Safari is strict about SameSite / Secure / partitioned cookies, so the CSRF token
frequently doesn't stick → every action shows a fake "permission" error.
- Fix a: make the CSRF cookie + token flow robust on mobile Safari.
- Fix b: stop labelling generic 403 as "permission denied" — distinguish
  CSRF/session-token failure ("refresh and retry") from a real authz denial.

### B2. Chat lens mobile layout is broken (screenshot)
`app/lenses/chat/page.tsx` on a 390px viewport:
- The Private/High-Power explainer card eats the whole screen — you open Chat and
  see a wall of disclosure text, not a chat.
- Error toast floats mid-screen, overlapping the "Activity Timeline" row.
- "Fallback 5/4" dropdown is clipped / text overflows its container.
- Floating buttons (＋, JARVIS orb, share, sitemap, robot) stack on top of content.
- The actual chat input is not visible.
Needs a dedicated mobile pass — collapse the explainer to a chip, fix toast
positioning/z-index, make the header controls wrap, dock the composer.

### B3. Onboarding forces character creation + dumps you into Concordia
(Logged separately in memory `onboarding-flow-issues.md`.) `/onboarding/location`
→ `/onboarding/character` → `/lenses/world` with no non-Concordia exit; the
"Skip" on the character page still `router.push('/lenses/world')`.

### B4. DTU locker shows test-harness pollution as a new user's content
`GET /api/dtus/paginated` for a brand-new "Empty Universe" account returns 9 DTUs,
**all `scope: "global"`, `ownerId: "system"`, `createdBy: "shield"`**, titled
"EXPLOIT threat: unknown", with `source: "user:smoke:shield.report"` /
`"user:runtime-capability-coverage"` / `"user:lens-behavioral-harness"` — i.e.
**auto-generated threat records from test/smoke harnesses that leaked into the
production global substrate.**
- No cross-user *private* DTU leak found via the API — `userVisibleDTUs()`
  (`server/server.js:17593`) does filter `privacy in {private, followers-only}` /
  `scope: user` to owner-only. The "private" ones the owner saw were most likely
  these `scope: global` shield records.
- Fixes: (1) purge the harness-generated threat DTUs from prod;
  (2) default the `dtus` lens to "mine only" with a toggle for global;
  (3) "Empty Universe" should set that filter by default.

### B5. The "N DTUs" chip counts shadow DTUs
`dtu.stats` → `total: 10, shadowCount: 34`. The chat header's "34 DTUs" is the
**shadow** count — internal/system records the user never created. Show `total`
(user-visible) instead, or label it.

### B6. "Fallback 5/4" brain-slot indicator
Renders a nonsensical "5/4" and is visually clipped on mobile. Needs a look at the
brain-endpoint fallback count logic + the chip's mobile layout.

---

## Still pending
Cloud headless-Chrome walkthrough (25+ lenses, core flows, mobile viewport) —
running; full report will land at `/tmp/concord-usertest/FINDINGS.md`.
