# Operator Guide — Running Your Own Concord

Concord is **infrastructure you own**. This is what it takes to run your own instance — for yourself, for a small org, or as a federation peer.

---

## Hardware (recommended)

- **GPU**: NVIDIA RTX PRO 4500 Blackwell (32GB GDDR7, 5th-gen tensor cores). Concord's 5-brain default models target this card. You can run on smaller cards with smaller models — see the brain table in `CLAUDE.md`.
- **RAM**: 64GB+ (32GB for Node heap, 32GB headroom for OS + Ollama + DB).
- **Storage**: 200GB+ NVMe. Models are ~70GB; DTU corpus growth is modest (~50KB/DTU average).
- **Network**: Static IP if federating. Bandwidth: federation polling is light (~1MB/hour), DTU exports/imports can spike to 100MB/min during user migration.

You can run on lower specs; performance scales with cuts to brain quality and concurrent users.

---

## First Run

```bash
git clone https://github.com/<your-fork>/concord-cognitive-engine
cd concord-cognitive-engine
./setup.sh                  # installs deps + creates data dirs + .env + runs migrations
docker-compose up           # starts backend + frontend + 4 Ollama instances + LLaVA
```

### RunPod + Cloudflare Tunnel (recommended for solo operators)

If you're renting GPU on RunPod (or any GPU box without a stable inbound IP), the easiest deploy shape is a Cloudflare Tunnel sidecar — outbound-only connection from the GPU container to Cloudflare's edge, free TLS, your-own-domain, no inbound ports.

1. Boot a RunPod pod with Docker support.
2. Mount a Network Volume at `/workspace` and set `DB_PATH=/workspace/concord.db` so your DTU corpus survives restarts. Mount another to `/root/.ollama` so the ~70GB of brain models persist.
3. Clone the repo into the pod, run `./setup.sh`.
4. Run `bash infra/cloudflare/setup-tunnel.sh` — interactive helper that walks you through tunnel creation in the Cloudflare Zero Trust dashboard.
5. Bring up the stack including the tunnel sidecar:

   ```bash
   docker compose \
     -f docker-compose.yml \
     -f infra/cloudflare/docker-compose.cloudflared.yml \
     up -d
   ```

Within ~5 seconds, `https://concord.<your-domain>.com` is live with TLS. See `infra/cloudflare/README.md` for full RunPod-specific notes (storage, GPU sizing, ~$310-520/mo cost estimate, troubleshooting).

### Required env vars (production)

```bash
JWT_SECRET=<32+ random bytes>
NODE_ENV=production
MAX_OLD_SPACE_SIZE=32768
DB_PATH=/var/lib/concord/concord.db        # outside the repo
PORT=5050
```

### Brain endpoints (defaults match docker-compose)

```bash
BRAIN_CONSCIOUS_URL=http://localhost:11434
BRAIN_SUBCONSCIOUS_URL=http://localhost:11435
BRAIN_UTILITY_URL=http://localhost:11436
BRAIN_REPAIR_URL=http://localhost:11437
BRAIN_VISION_URL=http://localhost:11438
```

### Optional cap overrides

```bash
CONCORD_MAX_SHADOWS=50000              # DTU shadow cap
CONCORD_LLM_QUEUE_DEPTH=1000           # concurrent prompt queue
CONCORD_DOWNLOADS_PER_USER=25
CONCORD_DIALOGUE_MAX_CONCURRENT=50
```

### Phase kill-switches

Each Phase 1-6 cycle has a kill-switch env var if you want to disable it on your instance:

```bash
CONCORD_PERSONAL_BEATS=0      # Phase 3 — no beats from goddess
CONCORD_NPC_ROUTINES=0        # Phase 4a — NPCs stand still
CONCORD_NPC_ECONOMY=0         # Phase 4b — no resource flows
CONCORD_LATTICE_QUESTS=0      # Phase 4c — drift findings stay quiet
CONCORD_KNOWLEDGE_TRADE=0     # Phase 1.5 — no NPC marketplace participation
CONCORD_SEASONS=0             # Phase 5c — single perma-season
CONCORD_LAND_CLAIMS=0         # Phase 5a — no maintenance ticks (claims persist)
```

---

## Federation

To accept incoming DTU flows from peers:

```bash
CONCORD_FEDERATION_TOKEN=<random 32-byte token>
```

Peers calling `/api/world/social-shadows` must include `Authorization: Bearer <token>`.

To send to peers: configure peer URLs in your federation registry (see `lib/cnet-federation.js#configurePeers`).

---

## Constitutional Constants

These are **not** environment overrides. They are gated by governance:

- **Marketplace fees** (`server.js#MARKETPLACE_FEE 0.04`, `CREATOR_SHARE 0.70`, `ROYALTY_SHARE 0.20`, `TREASURY_SHARE 0.10`)
- **Royalty cascade** (`MAX_ROYALTY_RATE 0.30`, `INITIAL_ROYALTY_RATE 0.21`, `ROYALTY_HALVING 2`, `ROYALTY_FLOOR 0.0005`, `MAX_CASCADE_DEPTH 50`)
- **48-hour withdrawal hold** (`server/economy/withdrawals.js#WITHDRAWAL_HOLD_HOURS 48`)

If you're operating a federation peer, these must match across instances or royalty math diverges. **Do not change them without governance approval.**

---

## Operator Economics

If you run an instance and other people use it:

- **Marketplace fee** (5%) accumulates in your treasury wallet, not Anthropic's, not Concord-Inc's. There is no Concord-Inc.
- **Token purchase fee** (1.46%) on Stripe → Concord Coin: also yours.
- Storage / compute costs are yours.
- You set your own ToS, your own moderation, your own deplatforming policy.

You can offer a hosted Concord as a service (charge a subscription on top of the marketplace fee) or run it as a community asset (subsidize the box, no markup). The substrate doesn't care.

---

## Running the Test Suite Before You Trust It

```bash
cd server
npm test          # ~250 Tier-2 + 4 Tier-3 E2E, ~1.5 minutes
node scripts/run-detectors.js --diff    # 0 critical / 0 high / 0 medium added
npm run smoke
```

```bash
cd concord-frontend
npm run lint
npm run type-check
npm run test:run
```

---

## Backup & Restore

The DB file at `DB_PATH` is the entire substrate. Stop the server, copy the file, you have a complete snapshot.

```bash
# nightly cron
sqlite3 /var/lib/concord/concord.db ".backup /var/backups/concord/$(date -u +%Y%m%d).db"
```

The backup-restore round-trip is regression-tested. To restore:

```bash
systemctl stop concord
cp /var/backups/concord/<date>.db /var/lib/concord/concord.db
systemctl start concord
```

DTU corpus migration to another instance: use `dtu_portability.export` (Phase 6b), not raw DB copy. The export envelope verifies cryptographically; a raw DB copy doesn't.

---

## Monitoring

Prometheus scrape at `/metrics` (port 5050). Alerts in `monitoring/prometheus/alerts.yml`. Two Grafana dashboards ship:

- `concord-overview.json` — request rate, latency, status.
- `concord-phases-1-6.json` — substrate health: heartbeats, beats, economy flows, drift→quest+region, deaths, seasons, claims, discovery latency.

The most important metric: `rate(concord_heartbeat_skipped_total[5m])`. If it's > 0 for more than 5 minutes, your tick budget is blown — the substrate is starving.

---

## Updating

Concord migrations are append-only. To update:

```bash
git pull
cd server && npm install
npm run migrate            # applies any new migrations
systemctl restart concord
```

The Tier-3 E2E test (`tests/e2e/full-loop.test.js`) pins the cross-phase wiring. If a refactor breaks any phase's integration, this test surfaces it before you deploy.

---

## When to Ask for Help

- Heartbeat overruns sustained > 10 min: post in #concord-ops with the dashboard screenshot.
- Federation peer rejecting your handshake: check that `CONCORD_FEDERATION_TOKEN` matches AND your routes/world-narrative.js exports the v1 shape.
- Royalty cascade math seems off: check `tests/royalty-cascade.test.js` runs green against your DB. If it fails, you have a constants drift; do not deploy.
