# Read scale-out — activation runbook

Horizontal read scale-out for the bare-metal (launchd) deploy. The writer never
changes; a read-only replica + a fail-safe front-door router take GET catalog
traffic off the writer's single event loop.

## Pieces

| | what | risk |
|---|---|---|
| `server/lib/read-replica-allowlist.js` | already in the codebase — the vetted GET allowlist + default-deny gate | — |
| `CONCORD_READ_REPLICA=1` | already in `server.js` — RO SQLite, no heartbeat/migrations/seeders, allowlist gate | writer byte-identical |
| `engines/concord-read-router/` | Go splitter: allowlisted GET → replica (fallback to writer on ANY error), else → writer | **fail-safe** — worst case a read goes to the writer (= today) |
| `deploy/com.concord.backend-read.plist` | replica launchd unit, port 5053 | additive |
| `deploy/com.concord.read-router.plist` | router launchd unit, port 5057 | only in the path once ingress points at it |

## Prerequisites

- `dtu-sidecar` running (`CONCORD_DTU_SIDECAR=1`) — the replica's DTU catalog
  reads go through it (`STATE.dtus` is empty on a replica; the sidecar reads
  `dtu_store` directly).
- The box has spare cores (the replica is a second full Node process; ~0.3GB RSS
  idle, one more event loop).

## Activate (staged — each step reversible)

### 1. Bring up the replica (no routing change yet — harmless)
```sh
cp engines/concord-read-router/deploy/com.concord.backend-read.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.concord.backend-read.plist
curl -s http://127.0.0.1:5053/health           # 200
curl -s "http://127.0.0.1:5053/api/dtus?limit=3" -H "Authorization: Bearer <tok>"   # real data via the sidecar
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:5053/api/lens/run # 401/403 — gate denies non-allowlisted
```
Watch `/Users/dutch/concord/logs/backend-read.err` — a couple of
`readonly database` write-rejections at boot are expected and harmless (guarded
paths: heartbeat, saveStateDebounced, periodic save). A recurring stream is a
bug — file it.

### 2. Bring up the router (still not in the path)
```sh
cd engines/concord-read-router && GOFLAGS=-trimpath go build -ldflags="-s -w" -o bin/concord-read-router .
codesign -s - --force bin/concord-read-router            # macOS arm64 — required
cp deploy/com.concord.read-router.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.concord.read-router.plist
curl -s http://127.0.0.1:5057/v1/router-health           # writer + replica both reachable:true
# sanity: route an allowlisted GET + a POST through the router and confirm the split
curl -s http://127.0.0.1:5057/v1/router-health | grep -o '"routed":{[^}]*}'
```

### 3. Flip ingress (the only real cutover step)
The Mac deploy's `/api/*` comes in via the **Cloudflare tunnel ingress**
(`infra/cloudflare/…` / the `cloudflared` config), NOT nginx. Point that ingress
rule for `/api`, `/health`, `/socket.io`, `/godot-ws` at **`127.0.0.1:5057`**
instead of `:5050`. (Local `next dev` uses `BACKEND_URL` — set it to `:5057`.)

**Revert:** point the ingress back at `:5050`. Instant.

### 4. Watch for 10 min under real traffic
```sh
watch -n5 'curl -s http://127.0.0.1:5057/v1/router-health'
# healthy: routed.replica climbing, routed.replicaFallback ~0, both reachable:true
# tail both: /Users/dutch/concord/logs/{backend,backend-read,read-router}.err
```
Run `AUTH=1 BASE=http://127.0.0.1:5057 node load-tests/chaos-storm.mjs` and
compare writer health-under-load before/after.

## Docker/nginx path (parallel — not this deploy)

`nginx/conf.d/default.conf` already has a commented `location` block + the
`backend_read` upstream in `nginx.conf`. Bring up replicas via the docker-compose
`read-replica` profile, uncomment the block, `nginx -s reload`. The allowlist in
`main.go` and in `read-replica-allowlist.js` and in that nginx block must stay in
sync — one source of truth is the JS file; the other two are ports of it.

## Known caveat

This offloads the **allowlisted GET catalog** reads (DTU catalog/detail, worlds,
cities, feeds, marketplace browse, atlas, leaderboards). It does NOT offload
`POST /api/lens/run` (the macro chokepoint) — those stay on the writer, because a
replica can't safely run arbitrary macros against divergent in-memory STATE.
Real throughput gain depends on how much of your traffic is GET-catalog vs
macro-POST.
