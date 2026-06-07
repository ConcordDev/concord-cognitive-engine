# Self-hosting Concord — point a brain at your own model

You can run the entire Concord substrate — the affect/instinct engine, the living NPCs,
the autonomous agents, the cost telemetry — on your own hardware, against your own LLM
endpoints. Nothing about the living-world layer requires our hosted brains.

## 1. Boot the server

```bash
cd server
npm install
npm run migrate          # applies all migrations (schema version ≥ 330)
npm start                # node server.js  (dev: npm run dev — node --watch)
```

Dev needs only `JWT_SECRET`. **Production** validates a stricter set on boot (it will
print exactly which are missing and exit):

```bash
JWT_SECRET=<≥32 chars>  ADMIN_PASSWORD=…  SESSION_SECRET=<≥32 chars> \
SOVEREIGN_USERNAME=…    FRONTEND_URL=https://your-frontend  NODE_ENV=production \
node server.js
```

Health: `GET /health` and `GET /ready` (both unauthenticated).

## 2. Point the brains at your own LLM (BYO)

The five brain slots are configured in `server/lib/brain-config.js` and overridable by
env. Use your own Ollama, or any OpenAI/Anthropic/xAI/Google endpoint via the BYO router
(`server/lib/byo-providers.js`, per-user keys in migration 170 `byo_brain_overrides`):

```bash
# self-hosted Ollama
BRAIN_CONSCIOUS_URL=http://localhost:11434   BRAIN_CONSCIOUS_MODEL=qwen2.5
BRAIN_SUBCONSCIOUS_URL=http://localhost:11434 BRAIN_SUBCONSCIOUS_MODEL=qwen2.5:7b-instruct-q4_K_M
BRAIN_UTILITY_URL=http://localhost:11434      BRAIN_UTILITY_MODEL=qwen2.5:3b
# …or BYO an external provider per-slot with the user's own key.
```

If no brain is reachable, the server still boots and the **deterministic fallbacks**
engage — a calm village is fully playable with zero LLM. (The startup log shows
`embeddings_unavailable` / `llm_fallback_initialized`; both are non-fatal.)

## 3. The cost dial: LLM only on salience

The whole point: idle NPC life costs ~nothing, and the LLM wakes only when something is
salient. The relevant switches:

| Env | Effect |
|---|---|
| `CONCORD_AFFECT_SALIENCE=0` | disable the salience gate → always-LLM (the old, expensive behaviour) |
| `CONCORD_NPC_DIALOGUE_LLM_PER_MIN` | per-world budget cap on dialogue LLM wakes (default 120) |
| `CONCORD_AGENT_ENABLED=1` | enable autonomous agents (opt-in) |
| `CONCORD_AGENT_ACTION_CAP` | per-agent action/min commons cap (default 60) |
| `CONCORD_AGENT_AUTOGOAL=0` | disable autonomous goal formation |
| `CONCORD_AWARENESS_LOOP=1` | enable the Tier-3 awareness loop + reasoning journal |
| `CONCORD_AGENT_DRIFT_WATCH=0` | disable the periodic values-drift sweep |

Verify the savings with the benchmark:

```bash
node --test server/tests/bench/npc-population-cost.bench.js
# → 100 NPCs and 10,000 NPCs make the SAME number of LLM wakes.
```

## 4. Drop NPCs and watch the cost

```bash
CONCORD_API_KEY=csk_… CONCORD_BASE_URL=http://localhost:5050 \
  npx tsx sdk/examples/living-village.ts
```

Then read `/api/admin/inference-costs?hours=1` (admin-gated) or open
`/lenses/ops-telemetry` — the call count tracks salient exchanges, not the head-count.

## 5. Multi-tenant / scale-out (optional)

- `CONCORD_SHARD_WORLDS=true` forks one process per world (`server/lib/world-shard-manager.js`,
  ~200 MB/world, idle teardown). Respect the per-world vs user-global write-ownership rules
  in `server/lib/world-shard-protocol.js`.
- `BRAIN_<NAME>_URLS` (comma-separated) rotates across multiple endpoints with load-aware
  picking; surfaced at `/api/admin/brain-endpoints`.

See **[SDK_QUICKSTART.md](./SDK_QUICKSTART.md)** for the client side.
