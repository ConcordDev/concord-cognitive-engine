# Off-Mac Production Migration — Blueprint

**Status:** blueprint only (2026-09-07). Nothing migrated yet.
**Why now:** live CDP profiling (see `docs/USER_TEST_FINDINGS_2026-09-07.md`) showed
the backend event loop lagging **3.6 s** under light single-user load, tripping
`request-admission.js`'s 900 ms shed threshold → ~75% of POSTs return
`503 service_overloaded` → chat/settings/World-lens all fail. **Not a memory leak**
(idle heap is flat) — it's event-loop starvation because concord-os.org shares one
Mac (~10 cores) with the ~30-worker agent fleet + Ollama + VS Code. The fix is CPU
headroom the current box cannot provide.

---

## Current topology (verified 2026-09-07)

| Component | Where | How |
|---|---|---|
| Backend (`server/server.js`) | **Mac**, port 5050 | launchd `com.concord.backend` |
| Frontend (Next standalone) | **Mac**, port 3000 | launchd `com.concord.frontend` → `.next/standalone/server.js` |
| Cloudflare tunnel | **Mac** | launchd `com.concord.cloudflared` (token-based; routes `/api`,`/socket.io`,`/godot-ws` → :5050, rest → :3000 at the edge) |
| Postgres | **Mac** | `/opt/homebrew/opt/postgresql@15`, db `concord`, 127.0.0.1:5432 |
| Redis | **Mac** | `/opt/homebrew/opt/redis` 127.0.0.1:6379 (cache only — ephemeral) |
| DTU substrate | **Mac** | SQLite `server/data/concord.db` (**6.1 GB**) + `server/data/concord_state.json`; `STATE.dtus` rehydrates from `dtu_store` on boot |
| 5 brains (Ollama) | **A40 pod** `69.30.85.73` | reached from Mac via SSH tunnel `-L 11435:127.0.0.1:11434`; vision → Cloudflare Workers AI |
| Agent fleet (~30 `llm-worker.py`), Hermes, openclaw | **Mac** | **stays on the Mac** — not part of this migration |

---

## Target topology

Move **backend + frontend + Postgres + Redis + the DTU SQLite** to a dedicated
**CPU-only RunPod pod** (no GPU needed — inference stays on the A40). Brains keep
running on the A40; the new web pod reaches them over the same private network /
tunnel the Mac uses today.

```
                 ┌──────────────────────────── Cloudflare tunnel (same tunnel id) ───────────┐
   users ──────► │  concord-os.org                                                            │
                 └───────────────┬───────────────────────────────────────────────────────────┘
                                 ▼
                 NEW web pod (CPU, ~8–16 vCPU / 32GB)          A40 pod (unchanged)
                 ├─ cloudflared (connector #2, then #1 retired) ├─ ollama ×5 brains :11434
                 ├─ frontend  :3000  (next standalone / pm2)    └─ (vision → CF Workers AI)
                 ├─ backend   :5050  (pm2, ecosystem.config)          ▲
                 ├─ postgres  :5432  (local)                          │ BRAIN_*_URL over
                 ├─ redis     :6379  (local)                          │ private net or tunnel
                 └─ /workspace/concord/{db,state,backups} (volume)────┘
```

Repo already carries the scaffolding: `.env.runpod`, `startup.sh`,
`ecosystem.config.cjs` (pm2), `scripts/concord-deploy.sh`, `docs/RUNPOD_DEPLOY.md`,
`docs/DEPLOYMENT_TOPOLOGY.md`.

---

## Migration steps

### 0. Pre-flight audit (do first — don't assume)
- Confirm every datastore actually in the prod path. `/health` shows Postgres +
  Redis connected, but the DTU substrate is SQLite. Enumerate: `grep -rn "new Database\|Pool(\|createClient(" server/ | grep -v node_modules`. Map each to a file/DSN.
- `du -sh server/data/*` — the 6.1 GB `concord.db` needs a plan (it's mostly WAL +
  dead pages; `VACUUM` first — likely drops well under 1 GB).
- Snapshot the Cloudflare tunnel's current ingress rules (Zero Trust → Tunnels →
  the tunnel → Public Hostnames) so the new connector serves identically.

### 1. Provision the web pod
- RunPod CPU pod, Ubuntu, ≥8 vCPU / 32 GB, a persistent network volume mounted at
  `/workspace`. Node 20+, pm2, `cloudflared`, `postgresql@15`, `redis`.
- `git clone` the repo to `/workspace/concord`; `cd server && npm ci`;
  `cd concord-frontend && npm ci`.

### 2. Config
- `cp .env.runpod .env`, fill the REQUIRED blanks (`JWT_SECRET`, `SESSION_SECRET` —
  generate fresh; do NOT copy the Mac's if they were ever git-committed).
- Point `BRAIN_*_URL` at the A40 (private-network IP if RunPod gives the two pods
  a shared VPC; otherwise an SSH reverse tunnel or a dedicated Cloudflare tunnel
  hostname for :11434 locked to the web pod's IP).
- `DATABASE_URL` / PG creds → localhost on the web pod.
- `DATA_DIR=/workspace/concord`, `DB_PATH=/workspace/concord/db/concord.db`,
  `STATE_PATH=/workspace/concord/concord_state.json`.
- Frontend: `.env.production.local` with `NEXT_PUBLIC_API_URL=` /
  `NEXT_PUBLIC_SOCKET_URL=` empty (already the fix for the localhost-in-bundle bug).

### 3. Data move (single cutover window, ~15–30 min)
1. Put the Mac backend in read-only / stop writes (or just accept the short window).
2. Postgres: `pg_dump -Fc concord` on the Mac → `pg_restore` on the web pod.
3. SQLite: on the Mac, `sqlite3 concord.db "VACUUM;"` then `.backup` to a file →
   copy to `/workspace/concord/db/concord.db` on the web pod. Copy
   `concord_state.json` and `data/artifacts/` too.
4. Redis: nothing to move (cache) — it repopulates.
5. `cd server && npm run migrate` on the web pod to apply any pending migrations.

### 4. Bring up the web pod
- `pm2 start ecosystem.config.cjs --env runpod` (backend). Verify `/health` →
  `postgres.connected`, `redis.connected`, all 5 brains enabled.
- `cd concord-frontend && npm run build && pm2 start ... next` (or the standalone
  server). Verify `curl localhost:3000`.
- Start `cloudflared` on the web pod with the **same tunnel token**. Cloudflare
  multiplexes connectors — for a few minutes BOTH the Mac and the web pod serve
  the tunnel. Watch `/health` through concord-os.org; confirm it's the new pod
  (bump a version string or check `uptime`).

### 5. Cutover + retire
- Stop the Mac's `com.concord.frontend`, `com.concord.backend`, `com.concord.cloudflared`
  launchd jobs (`launchctl bootout`). Tunnel now served only by the web pod.
- Keep the Mac's Postgres/Redis/data for ~a week as a rollback, then archive.
- The agent fleet on the Mac now points `BRAIN_*`/API at the web pod's public
  origin (or the A40 directly) instead of `localhost`.

### 6. Post-migration verification
- Re-run the CDP event-loop probe under the browser-agent load test — lag should
  stay well under 300 ms with real cores.
- Re-run the new-user walkthrough (signup → chat → forge → World lens).
- Confirm `docs/USER_TEST_FINDINGS_2026-09-07.md` B1 (503 shedding) is resolved.

---

## Rollback
The Mac keeps its full stack + data until the web pod is proven. Rollback =
re-`launchctl bootstrap` the three Mac launchd jobs; Cloudflare fails back to the
Mac connector automatically once the web pod's connector stops.

## Not solved by this migration (separate work)
- World-lens ~235-requests-per-load storm + tight-loop 503 retries (client-side).
- Heavy synchronous per-request work on the main thread (prompt assembly, DHTP) —
  a worker-pool offload is the real throughput fix; more cores buys headroom, not
  a pass.
- Missing world assets (`/meshes/heroes/*.glb`, `/music/stems/*`, `/godot-client/`).
