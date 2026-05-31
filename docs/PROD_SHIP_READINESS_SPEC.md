# Production Ship-Readiness — does the whole codebase reach the live site, with all features on? (Spec)

## 0. Thesis

Two distinct questions, both answered here:
1. **Does everything *ship* (reach the deployed site)?** — Mostly YES; the build/deploy plumbing is
   sound. The exceptions are things that ship as *files* but don't *function* (gated by known audit
   bugs).
2. **Is prod configured with all intended features ON?** — **NO, not by default.** The feature
   kill-switches aren't in the env templates, so the default-OFF features (civic bonds, viability,
   firearms, social-life, the LLM-gated systems…) deploy **off**. This spec gives the exact prod env
   to turn them on.

Everything below was verified from a no-network sandbox against the real repo.

---

## 1. Build & deploy plumbing — VERIFIED SOUND

| Check | Result |
|---|---|
| `next.config` output mode | `output: 'standalone'` ✓ |
| Standalone static-asset copy (the classic gotcha) | Dockerfile copies `public` + `.next/standalone` + `.next/static` ✓ |
| Client API base | `lib/api/client.ts` → `NEXT_PUBLIC_API_URL \|\| ''` = **same-origin relative `/api`**, proxied by `next.config` `rewrites()` to `BACKEND_URL` ✓ (doesn't break if the URL is unset) |
| Socket base | same same-origin fallback ✓ |
| Build pre-gate | `prophet-check` → **"Pre-flight clear. 0 warnings", exit 0** ✓ |
| Required prod env validation | `REQUIRED_ENV_PRODUCTION = ["JWT_SECRET","ADMIN_PASSWORD"]` + JWT length ≥32 check ✓ |
| Prod stack (docker-compose) | backend · frontend · nginx · certbot(TLS) · prometheus · grafana · redis · qdrant · 5+ Ollama instances ✓ |
| Heap | `MAX_OLD_SPACE_SIZE=32768`, build `--max-old-space-size=6144` ✓ |

**Caveat (not a failure):** `next build` is heavy — it timed out at an 8-min cap *in the sandbox*; it
completes on a real box (RunPod). Confirm a full prod build at least once after the schema-drift
fixes. `CI_SKIP_TYPECHECK` / `CI_SKIP_LINT_IN_BUILD` exist but default to OFF — **do not set them in
the prod build** (you want the checks to run).

---

## 2. The prod feature-flag manifest — turn ALL features ON

The kill-switches are read from env at boot; docker-compose sets only *infra* flags
(`CONCORD_WS_ENABLED`, heartbeat, sqlite, brain concurrency). The **feature** flags are absent from
`.env.example` (0 CONCORD vars) and `.env.runpod` (8 infra ones), so they ship at **code defaults**.
Polarity audited from source (round-6 exploration):

### 2a. Default-OFF → MUST set for "all features on" (`=== "1"` / `!== "true"` gates)
```bash
# Add to .env (prod) / docker-compose backend environment:
CONCORD_CIVIC_BONDS=1
CONCORD_VIABILITY=1
CONCORD_VIABILITY_ETHICS=1
CONCORD_SOCIAL_LIFE=1
CONCORD_SOCIAL_EVENTS=1
CONCORD_SKILL_FORGE=1
CONCORD_CHILD_REFUSAL=1
CONCORD_AUTOFIX_LOOP=true       # gate is `!== "true"`, so literal true
CONCORD_FIREARMS=1
CONCORD_EXPRESSION=1
CONCORD_REALM_CONTROL=1
CONCORD_MOVE_BUILDER=1
CONCORD_COUNCIL=1
```

### 2b. LLM-gated features — prod HAS Ollama (5 instances), so enable them (off by default)
```bash
CONCORD_SKILL_EVOLUTION_LLM=true
CONCORD_NPC_DIALOGUE_LLM=true
CONCORD_QUEST_DIALOGUE_LLM=true
CONCORD_DREAM_LLM=true
CONCORD_FORWARD_SIM_LLM=true
CONCORD_PROCGEN_BACKSTORY_LLM=true
```
> These were left OFF in the sandbox (no Ollama → they'd timeout). In prod they're the *point* —
> each has a deterministic fallback, so enabling them upgrades quality without risk.

### 2c. Already-ON by default (`=== "0"` gates) — no action needed
`MOVE_RESOLVER, MOVEMENT_POWERS, CRAFT_RESOLVE, SKILL_EVOLUTION, SKILL_FUSION, FACTORY_ENABLED,
FESTIVALS_ENABLED, ANNOUNCEMENTS_ENABLED, WORLD_BOSSES_ENABLED, AMBIENT_CHAT_ENABLED, NEMESIS_CYCLE,
CREATURE_FLOCK, SIGNAL_PROPAGATION, ZONE_HAZARD, SEASONS, TIME_LOOPS, PERSONAL_BEATS, DISEASE_ENGINE,
PROCGEN_NPCS, WORLD_MIGRATION, ECOLOGY_QUESTS, WAR_SKIRMISH, CROSS_WORLD_POTENCY, RESOURCE_GATED_BUILD,
CHRONICLE`. (Set them =1 explicitly anyway if you want the prod env self-documenting.)

### 2d. Do NOT enable in prod
- `CONCORD_SHARD_WORLDS` — only when running the multi-process world-shard topology; flipping it on a
  single process races writers.
- `CONCORD_RATE_LIMIT_BYPASS` / `CONCORD_DISABLE_*` — debugging/sandbox only.
- The `CONCORD_TEMPERAMENT` switch is for a spec not yet built (no-op today).

---

## 3. Required prod env (must be set, no safe default)
```bash
JWT_SECRET=<≥32 random chars>        # prod exits / runs insecure without it
ADMIN_PASSWORD=<strong>              # in REQUIRED_ENV_PRODUCTION
NODE_ENV=production
MAX_OLD_SPACE_SIZE=32768
BACKEND_URL=http://127.0.0.1:5050    # server-side rewrites target (or the internal backend host)
# Frontend build-arg (optional — same-origin fallback works without it):
#   docker build --build-arg NEXT_PUBLIC_API_URL=https://concord-os.org ...
# Brain URLs/models: docker-compose defaults are correct for the in-compose Ollama hosts.
# Stripe / Sentry / federation token: set if those features are live.
```
Plus the **SSE hardening** (`X-Accel-Buffering: no` + heartbeat + nginx block) from
`docs/SSE_STREAMING_SPEC.md` — chat streaming buffers/drops in prod without it.

---

## 4. "Ships but doesn't FUNCTION" — the gates between *present* and *working*

Everything compiles and deploys, but these audit findings mean some shipped surfaces are inert in
prod. They are the real ship-blockers for "everything works," ordered by leverage:

1. **Schema-drift (rounds 2–3)** — ghost tables (`user_wallets`, `world_events`, `city_presence`,
   `npc_relations`, …) + wrong-column queries crash/silently no-op. Affects auctions, mail, achievements,
   corpse, creator-dashboard, nemesis, spouse-reactivity, NPC-vs-NPC combat, etc. **Highest leverage:
   a boot-time SQL-schema gate retires the whole class.**
2. **Ghost-fleet macros (round 1 #11)** — `quest.*`, `agents.*`, `research.*`, `religion.*`, `city.*`
   fall through to the LLM → `/lenses/{quests,agents,research,attention}` render shells with dead reads.
3. **`seedRumor` built-but-unwired (round 7 #T1)** — the project's OWN wiring gate is RED; wire it (or
   allowlist) to green the gate.
4. **#P1 LLM prompt injection** (NPC-dialogue `choice` unsanitized) — whitelist before prod-enabling
   LLM dialogue (§2b).
5. **SSE buffering** (§3) — chat streaming.
6. **Hydration sites** (frontend runtime spec) — `Date.now()`/`new Date()` rendered raw at fork /
   mental-health / collab; ~520 TZ-dependent date renders.

None block the *deploy*; all block specific features *working*. The CI gates that prevent recurrence:
the existing **wiring gate** (#T1) + the recommended **SQL-schema gate**.

---

## 5. From-here ship checklist (what we can drive without the live box)

- [x] prophet-check green · standalone+assets copy confirmed · same-origin API confirmed · required-env
      validation confirmed · feature-flag polarity mapped.
- [ ] Add §2 feature flags + §3 required env to `.env.runpod` / docker-compose (the "all on" config).
- [ ] Fix the §4 schema-drift (boot-time SQL gate) — turns "present" into "working".
- [ ] Wire `seedRumor` → green the wiring gate (`npm test` clean).
- [ ] Apply the SSE hardening + #P1 whitelist before enabling LLM features.
- [ ] One full `next build` on RunPod (it times out only in the sandbox).
- [ ] `npm run validate-routes` + `score-lenses` + `check-deps` as pre-ship gates.
- [ ] Browser-runtime sweep via RunPod + named (SSE-capable) Cloudflare tunnel — see the
      frontend-runtime runbook.

---

## 6. Verdict

The **plumbing ships correctly** — standalone build, assets, same-origin API, TLS, the full service
stack, required-env validation, prophet-check green. The two real gaps are **(a) prod is configured
features-off by default** (fix: the §2 flag block) and **(b) a bounded set of shipped-but-inert
surfaces** gated by the schema-drift + ghost-fleet bugs (fix: §4, retired wholesale by one SQL CI
gate). Close those and the entire codebase doesn't just *reach* concord-os.org — it *works* there,
with every system on.

**Sources:** [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) ·
[Next.js production checklist](https://nextjs.org/docs/app/guides/production-checklist) ·
[standalone static-asset copy](https://prototypr.io/note/nextjs-standalone-build-local-production)
