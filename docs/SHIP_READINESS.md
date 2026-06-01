# Production Ship-Readiness

Two questions: does everything *ship* (reach the deployed site), and is prod
configured with all features *on*? Folds the Ship-Readiness spec + tracks status.

## Plumbing — VERIFIED SOUND (no change needed)
`next.config` `output: 'standalone'` ✓; Dockerfile copies `public` + `.next/
standalone` + `.next/static` ✓; client API base is same-origin relative `/api`
proxied to `BACKEND_URL` ✓; `prophet-check` green ✓; `REQUIRED_ENV_PRODUCTION =
["JWT_SECRET","ADMIN_PASSWORD"]` + JWT≥32 ✓; full service stack (backend/frontend/
nginx/certbot/prometheus/grafana/redis/qdrant/5×Ollama) ✓; heap 32GB ✓.
*Caveat:* a full `next build` times out only in the sandbox — run it once on
RunPod. Do NOT set `CI_SKIP_TYPECHECK`/`CI_SKIP_LINT_IN_BUILD` in the prod build.

## "All features on" config — ✅ ADDED to `.env.runpod`
The feature kill-switches default OFF in code and were absent from the env
templates, so default-OFF systems shipped inert. The §2 manifest (default-OFF
features, LLM-gated features, + the new Temperament engine) and §3 required env
are now in `.env.runpod`. Note: the spec called `CONCORD_TEMPERAMENT` a no-op —
**it's now a real, tested feature** (Phases 1–3) this cycle, included behind its
kill-switch. Required env (`JWT_SECRET`≥32, `ADMIN_PASSWORD`, `NODE_ENV=production`,
`BACKEND_URL`) must be set per environment.

## §4 "ships but doesn't FUNCTION" — the present-vs-working gates

| # | Blocker | Status |
|---|---|---|
| 1 | **Schema-drift** (ghost tables + wrong-column crashes — auctions/mail/achievements/corpse/creator-dashboard/nemesis/…) | ✅ **CLEARED** — gate at **0/0**; migrations 315/316 + redirects + money-rewrites; the recommended boot-time SQL CI gate (`scripts/audit/gates/schema-drift.mjs`) **is built and ratcheted to 0**. |
| 2 | **Ghost-fleet macros** (#11 — quest/agents/research/… fall through to LLM) | 🟡 **partially** — the masking is **fixed** (#3/#27: the catch-all now returns honest `unknown_macro` + can't hang); the registration race itself (make them dispatchable) is the remaining wire. Gate B logs it at boot. |
| 3 | **`seedRumor` built-but-unwired** (#T1, wiring gate RED) | ✅ **WIRED** — `secrets.js#discoverSecret` seeds rumors; the project's wiring gate is green. |
| 4 | **#P1 LLM prompt injection** (NPC-dialogue `choice`) | ✅ **FIXED** — whitelist before the prompt; safe to enable LLM dialogue (§2b). |
| 5 | **SSE buffering/drop in prod** | ✅ **FIXED** — `startSSE` (X-Accel-Buffering + no-transform + heartbeat) + nginx block; `docs/SSE_STREAMING.md`. Deploy needs a **named** CF tunnel (not the quick one). |
| 6 | **Hydration / raw-`Date.now()` renders** (~520 TZ-dependent) | ⬜ open — frontend runtime; browser-blocked here. Tracked. |

## Ship checklist
- [x] prophet-check green · standalone+assets · same-origin API · required-env validation · flag polarity mapped.
- [x] §2 feature flags + §3 required env → `.env.runpod` ("all on").
- [x] Schema-drift fixed + boot-time SQL gate (gate 0/0).
- [x] `seedRumor` wired → wiring gate green.
- [x] SSE hardening + #P1 whitelist (before enabling LLM features).
- [ ] Ghost-fleet #11 registration wire (unmask done; make-dispatchable remaining).
- [ ] One full `next build` on RunPod.
- [ ] `npm run validate-routes` + `score-lenses` + `check-deps` pre-ship.
- [ ] Browser-runtime sweep (RunPod + named SSE-capable tunnel) for §6 hydration.

## Verdict
Plumbing ships correctly. The two real gaps the spec named are now mostly closed:
**(a)** prod is no longer features-off (the §2 block is in `.env.runpod`); **(b)**
the shipped-but-inert surfaces were gated by schema-drift (cleared, 0/0) +
ghost-fleet (masking fixed; the dispatch wire is the last piece) + the safety/SSE
fixes (done). Remaining to *fully* "works there with everything on": the
ghost-fleet dispatch wire, a RunPod build, and the browser hydration sweep.
