# Runbook 11 — Backup & Restore Verification

**When to use:** Quarterly DR drill, before any major schema migration, or
when the SQLite file shows signs of corruption (PRAGMA integrity_check
fails, unexpected `SQLITE_CORRUPT` in logs).

**Owner:** infra on-call.

**Tooling:** `scripts/db-backup.sh`, `scripts/db-restore.sh`,
`scripts/health-check.sh`. Cron entry installed by `scripts/setup-cron.sh`.

---

## Background

Concord persists everything in two files under `$DATA_DIR` (default
`/data` in containers, `./data` for bare-metal dev):

- `concord.db` — SQLite DB (better-sqlite3 with WAL mode). All tables,
  including the Phase F2 additions (`emergent_skills`, `creature_bonds`,
  `creature_lineage`, `faction_policy_state`, `concord_link_walkers`,
  `black_market_listings`, `vehicles`).
- `concord_state.json` — In-memory state ring buffers + heartbeat counters
  flushed periodically.

Backups are gzip-compressed tarballs containing both files plus a manifest.
The default policy is 10 retained backups, rotated daily by cron.

---

## Quarterly DR Drill

Run this in **staging**, not prod. Goal: prove a backup taken today
can restore cleanly into a fresh container.

### Step 1 — Take a fresh backup from prod

```bash
# On the prod box, or via kubectl exec into the backend pod
./scripts/db-backup.sh
ls -lh ./data/backups/concord-backup-*.tar.gz | tail -1
```

Copy that tarball to the staging machine via the standard secrets
channel (Bitwarden / 1Password attachment / scp over the bastion).

### Step 2 — Boot a clean staging container

```bash
docker-compose -f docker-compose.yml -f docker-compose.staging.yml up -d backend
docker-compose exec backend rm -f /data/concord.db /data/concord_state.json
```

### Step 3 — Restore

```bash
docker cp ./concord-backup-XXXXX.tar.gz <backend-container>:/tmp/restore.tar.gz
docker-compose exec backend ./scripts/db-restore.sh /tmp/restore.tar.gz
```

The restore script:
1. Creates a safety backup of the (empty) current DB.
2. Extracts the tarball into `$DATA_DIR`.
3. Runs `PRAGMA integrity_check` and bails on failure.

### Step 4 — Boot, verify migrations applied, run smoke

```bash
docker-compose restart backend
sleep 30                            # let init + bootEmergentSkills + ensureCrossbreedingTables run

curl http://localhost:5050/health   | jq                          # status: healthy
curl http://localhost:5050/ready    | jq                          # ready: true
curl http://localhost:5050/api/world/clock | jq '.phase'          # heartbeat alive

# Verify all migrations applied (Phase F2 should include 082, 083)
docker-compose exec backend npm run migrate:status
```

### Step 5 — Spot-check Phase F2 data round-trip

```bash
# Creatures table populated from baselines
curl http://localhost:5050/api/creature/baselines/fantasy | jq '.baselines | length'  # >= 5

# Emergent skills cache rehydrated
curl http://localhost:5050/api/emergent-skills/list | jq '.skills | length'  # >= 3 (baseline)

# Council world bridge tables intact
docker-compose exec backend sqlite3 /data/concord.db "SELECT count(*) FROM faction_policy_state;"
```

Pass criteria: every query returns sensible data and no tables show as
missing. If `emergent_skills`, `creature_bonds`, or `creature_lineage`
are missing, the migration runner didn't apply 082/083 — investigate
before promoting to prod.

### Step 6 — Document the drill

Append a row to `docs/operations/dr-log.md`:

```
| Date | Backup tarball | Restore time | Smoke result | Issues found |
| 2026-05-02 | concord-backup-20260502_120000.tar.gz | 47s | PASS | none |
```

---

## Emergency Restore (production)

**Only run if the live DB is unrecoverable.** Wakes everyone.

### Step 1 — Pause writes

```bash
# Scale backend to 0 replicas to prevent partial writes mid-restore
kubectl scale deployment/concord-backend --replicas=0 -n concord
```

### Step 2 — Snapshot the current corrupt DB

```bash
kubectl exec -n concord backup-pod -- tar czf /tmp/pre-restore-snapshot.tar.gz /data/concord.db /data/concord_state.json
kubectl cp concord/backup-pod:/tmp/pre-restore-snapshot.tar.gz ./forensics-$(date +%s).tar.gz
```

Keep this for forensics. Don't skip.

### Step 3 — Restore

Pick the most recent KNOWN-GOOD backup (default: yesterday's nightly cron
backup). Don't pick the latest — the corruption may be in it.

```bash
kubectl cp ./concord-backup-XXXXX.tar.gz concord/backup-pod:/tmp/restore.tar.gz
kubectl exec -n concord backup-pod -- ./scripts/db-restore.sh /tmp/restore.tar.gz
```

### Step 4 — Bring backend up gradually

```bash
kubectl scale deployment/concord-backend --replicas=1 -n concord
# Watch logs for 60s — heartbeat should start, no SQLITE_CORRUPT errors
kubectl logs -n concord -l app=concord-backend --tail=200 -f
```

If the synthetic monitor goes green, scale to normal replica count.

### Step 5 — Communicate

- Post to the #incidents channel: time of corruption detected, time
  restored, data loss window (since last good backup).
- File a post-mortem within 48h.
- If users wrote data during the lost window, surface it via a banner on
  /api/system/notice and document recovery options.

---

## Daily Verification (automated)

`scripts/setup-cron.sh` installs the following cron entries:

```
# Take a nightly backup at 03:00 server time
0 3 * * * /opt/concord/scripts/db-backup.sh >> /var/log/concord/db-backup.log 2>&1

# Verify last backup is < 30h old (alert if backup cron silently failed)
30 4 * * * /opt/concord/scripts/health-check.sh --check=backup-freshness >> /var/log/concord/health.log 2>&1
```

The freshness check writes a Prometheus metric (`concord_backup_age_seconds`)
that the alerting rule `BackupStale` fires on if it exceeds 36h.

---

## Common Failures

### "PRAGMA integrity_check returned error" during restore

The backup itself is corrupt. Try the previous tarball. If multiple
backups are corrupt, the corruption was in the source DB and a deeper
forensic recovery (litesync, sqlite3 .recover) is needed — page DBA
on-call.

### "Migration N already applied" during fresh boot after restore

Expected. The restored DB carries the migrations table state. The runner
just verifies, no-ops.

### "Table emergent_skills doesn't exist" after restore from a backup older than Phase F2

The backup predates migration 082. Run `npm run migrate` after restore
to bring the schema forward. The Phase F2 module's `bootEmergentSkills`
also creates the table idempotently if migrations didn't run, but the
migration is the source of truth.

### "Heartbeat not advancing after restore"

`concord_state.json` may have a stale `__bgTickCounter`. The state file
is recreated on each restart, so a clean process boot should fix it.
If the heartbeat counter (`concord_heartbeat_ticks_total`) stays flat
after 60s of uptime, escalate to runbook 04 (no-heartbeat).
