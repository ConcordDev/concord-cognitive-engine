> See [`STACK_REALITY.md`](./STACK_REALITY.md) for measured LIVE vs OVERCLAIM (2026-09-05).

# Self-Host Verification — R7

A start-to-finish, runnable proof that a self-hosted Concord instance
actually works: fresh clone → setup → migrations → boot → smoke test →
backup → simulated data loss → restore → verified data integrity.

**Every command below was actually run in a live environment while writing
this doc** (against a throwaway `DATA_DIR`, never the real dev database) —
not transcribed from memory of what other docs claim. Where the real
behavior differed from what you'd guess (auth-mode gotchas, a silent
integrity-check skip), that's called out explicitly rather than smoothed
over. See §6 for the exact findings and what was fixed as a result.

For the automated, CI-runnable version of this same walkthrough, see §7 —
`scripts/self-host-dry-run.sh` runs stages 2–5 below headlessly with real
pass/fail assertions, in the same spirit as `census --ci` /
`check-doc-claims-all.mjs --ci`.

For a one-click evidence bundle of the detector suite / macro-depth grade /
UX-polish grade / doc-claims drift status for an auditor, see §8 — the new
`GET /api/admin/audit-export` route.

---

## 0. Scope and what this doc is not

This is the **bare-metal / single-box verification path**. It proves the
mechanics work: migrations apply, the server boots and serves real traffic,
a backup captures real data, and a restore brings it back intact. It does
**not** cover:

- Pulling the ~23GB of Ollama models (`./setup.sh` step 7) — that step is
  network- and disk-heavy and unrelated to whether backup/restore works.
  Everything below runs the server with all five brains offline
  (`brain_offline` warnings in the boot log), which is itself a real,
  supported degraded mode — the server does not require Ollama to boot,
  migrate, serve HTTP, or back up/restore data.
- The Docker Compose / Kubernetes production topology — see
  `docs/operations/runbooks/11-backup-restore.md` for the DR-drill runbook
  aimed at that deployment shape (`kubectl`, `docker-compose exec`, S3
  offsite copies). This doc is the bare-metal complement to that runbook,
  and both use the exact same underlying scripts (`scripts/db-backup.sh`,
  `scripts/db-restore.sh`).

---

## 1. Prerequisites

```bash
node --version   # v18+ required (setup.sh enforces this)
npm --version
```

Ollama is required by `./setup.sh` (it hard-fails without the binary) but
**not** required for anything in this doc — the verification below runs
with `brain_offline` for all five brains, which is a normal, honestly-
reported degraded state, not a failure.

`sqlite3` (the CLI binary, not just the library) is optional but
recommended — see the finding in §6.2. If it's absent, `db-backup.sh` /
`db-restore.sh` now fall back to a `better-sqlite3`-based integrity check
(fixed in this pass) instead of silently skipping it.

---

## 2. Fresh clone → setup

```bash
git clone <your-fork-or-origin> concord
cd concord
./setup.sh
```

`setup.sh` is idempotent and safe to re-run. It:
1. Checks Node 18+, npm, Ollama (hard requirement), Z3 (optional, best-effort).
2. `npm install` in both `server/` and `concord-frontend/`.
3. Builds the frontend (`next build`).
4. Pulls the five Ollama models (~23GB) and builds `concord-conscious:latest`
   from the repo's `Modelfile`.
5. Creates `data/` and `logs/`.
6. Copies `.env.example` → `.env` if `.env` doesn't already exist, **and
   auto-generates `JWT_SECRET` / `SESSION_SECRET` / `ADMIN_PASSWORD` /
   `GRAFANA_PASSWORD` via `openssl rand`** (BD#28 — zero-touch self-host;
   `git log --oneline --grep="BD#28"` for the commit that added this) so a
   fresh clone doesn't need a human to hand-edit secrets before it can run.

**Not independently re-verified in this pass**: steps 2–4 above (frontend
build, Ollama model pulls) — they need real disk/network/GPU resources this
verification environment doesn't have. Steps 1, 5, and 6's *mechanism*
(secret generation via `openssl rand`, `.env.example` → `.env` copy) were
read and are straightforward `set -euo pipefail` shell — no reason to doubt
them, but "read the script" is a weaker claim than "ran it," stated
honestly rather than folded into the rest of this doc's live-verified
claims.

---

## 3. Migrations apply cleanly

```bash
cd server
npm run migrate           # applies every pending migration
npm run migrate:status    # prints the full applied-migration table
```

**Verified live** against a completely fresh, empty database in this pass:
all 375 migration files applied cleanly in one pass (`[Migrate] 375
migration(s) applied. Schema version: 376`), and `migrate:status` printed
the full ledger with real timestamps. No manual intervention needed.

---

## 4. Boot the server and confirm it's live

```bash
# Point at a real DATA_DIR — DO NOT use a directory that matters if you're
# just verifying. The commands below assume server/.env is already
# populated by setup.sh's auto-generated secrets.
npm start          # MAX_OLD_SPACE_SIZE=32768 node --max-old-space-size=32768 --expose-gc server.js
# or for hot-reload dev:
npm run dev
```

Confirm it's actually serving:

```bash
curl http://localhost:5050/ready
# {"ready":true,"checks":{"state":true,"macros":true,"database":true},"version":"1.0.0"}
curl http://localhost:5050/api/status
# {"ok":true, ..., "counts":{"dtus":...}, ...}
```

### 4.1 Two real gotchas found live-testing this (read before you file a bug)

- **`NODE_ENV=production` requires `FRONTEND_URL` or `NEXT_PUBLIC_FRONTEND_URL`.**
  Without it, `routes/oauth.js` throws `FRONTEND_URL or
  NEXT_PUBLIC_FRONTEND_URL must be set in production (oauth routes)` as an
  **uncaught exception right after boot-time DTU ingestion completes** — the
  server logs `db_initialized`, seeds DTUs, then crashes. It's not
  documented anywhere as a hard boot requirement outside `.env.example`'s
  comments; if your box crashes moments after looking like it booted fine,
  check this first.
- **`AUTH_MODE=public` is refused outright in `NODE_ENV=production`** —
  `[Auth] FATAL: AUTH_MODE='public' is not allowed in production. Set
  AUTH_MODE=jwt or AUTH_MODE=hybrid (and JWT_SECRET) before starting.` This
  is a real, intentional guard rail (`AUTH_MODE=public` is documented in
  `.env.example` as "local-first / single tenant / trusted LAN deploys" —
  the guard stops you from accidentally shipping that to the internet). For
  a genuinely trusted LAN/single-user box, run with `NODE_ENV=development`
  instead — `AUTH_MODE=public` works there and is what §5's smoke test
  below assumes. For an internet-facing box, use `AUTH_MODE=hybrid` (the
  `.env.example` default) or `jwt`, and expect the write-path smoke checks
  in §5 to correctly 401 without a Bearer token — that's the gate working,
  not a broken deploy.

---

## 5. Smoke test

```bash
cd server
npm run smoke                      # bash scripts/smoke.sh  (defaults to http://localhost:5050)
bash scripts/smoke.sh http://your-host:5050   # or against a specific URL
```

**Verified live, twice** (once pre-backup, once post-restore — see §6.1):
with `AUTH_MODE=public` + `NODE_ENV=development`, **30/30 checks pass**,
covering system health, paginated list endpoints, artifact upload, durable
DTU creation, studio projects, jobs, guidance layer, and economy status.

If you run it against a `hybrid`/`jwt` box **without** an auth token, expect
several checks to legitimately 401 (`smoke.sh`'s own comments document
this: `/api/artifacts/upload` "requires auth → 401" under those modes).
That's the auth gate doing its job, not a smoke-test failure — a fully
authenticated smoke pass on a production-mode box needs a real Bearer
token, which `smoke.sh` in its current form doesn't take as a parameter
(a natural follow-up, not built in this pass since the LAN/dev-mode path
above already proves the full write surface end-to-end).

---

## 6. Backup → simulate data loss → restore → verify

This is the part that actually matters for "is my data safe," so it's
described here exactly as it was run, including the two real gaps found
and fixed along the way.

### 6.1 The verified round trip

```bash
# 1. Create something identifiable so you can prove it survives.
curl -A "Concord-Smoke/1.0" -X POST http://localhost:5050/api/dtus/durable \
  -H "Content-Type: application/json" \
  -d '{"title":"my-integrity-marker","body":{"content":"..."},"visibility":"public"}'
# -> note the returned dtu id

# 2. Back it up.
./scripts/db-backup.sh                 # writes to $DATA_DIR/backups by default
ls -lh data/backups/concord-backup-*.tar.gz | tail -1

# 3. SIMULATE TOTAL DATA LOSS. (Only do this against a throwaway DATA_DIR —
#    this really does delete the live database files.)
kill <server pid>       # or: docker-compose stop backend / pm2 stop concord
rm -f data/concord.db data/concord.db-wal data/concord.db-shm

# 4. Restore.
./scripts/db-restore.sh data/backups/concord-backup-<timestamp>.tar.gz

# 5. Reboot and verify.
npm start
curl http://localhost:5050/ready
sqlite3 data/concord.db "SELECT id, title FROM dtus WHERE id = '<the id from step 1>';"
# or, if sqlite3 isn't installed:
node -e "
  const Database = require('./node_modules/better-sqlite3');
  const db = new Database('data/concord.db', { readonly: true });
  console.log(db.prepare('SELECT id, title FROM dtus WHERE id = ?').get('<the id from step 1>'));
"
```

**Verified live, exactly as above**, against a fresh throwaway DB with 238
DTU rows and one marker DTU created via the API: the backup wrote a real
2.1MB gzip tarball, the simulated-loss delete genuinely removed the DB
files, the restore rebuilt `data/concord.db` from the tarball, and the
marker DTU's exact id and title were present, unchanged, after restore —
confirmed both via direct SQLite query and by rebooting the server and
re-running the full 30-check smoke suite against the restored data (still
30/30).

One genuine, expected-and-documented wrinkle found while doing this: a
server's first-ever boot against a brand-new database can report `/ready`
a couple of seconds before an async content-seeding pass finishes
committing (confirmed by rebooting the *same* database twice with no
backup/restore involved at all — the DTU count still settled +2 between
boot 1 and boot 2, then held steady on boot 3). This is a general
first-boot-settling behavior, **not** a backup/restore defect — the
row count never *drops* across a real backup/restore cycle, which is the
actual data-loss invariant that matters. `scripts/self-host-dry-run.sh`
(§7) encodes this correctly: it waits a moment before taking its "before"
snapshot and asserts the restored count never drops below it, rather than
asserting byte-for-byte equality.

### 6.2 Real gap found and fixed: silent integrity-check skip

Both `scripts/db-backup.sh` and `scripts/db-restore.sh` run a `PRAGMA
integrity_check` before trusting a snapshot — described in their own
header comments as "never ship/restore a corrupt backup." Live-testing in
an environment **without the `sqlite3` CLI binary installed** (only the
`better-sqlite3` Node library, no `sqlite3` in `$PATH`) showed the actual
behavior was: the entire integrity-check block was gated behind `command -v
sqlite3`, and when that check failed, **the block silently did nothing** —
no warning, no error, no log line, just an absent "integrity: ok" that
nothing called attention to. A backup or restore could complete
"successfully" with zero verification and no indication that was what
happened.

This is fixed in this pass: both scripts now fall back to a
`better-sqlite3`-based `PRAGMA integrity_check` (the same dependency the
server already hard-requires) when the `sqlite3` CLI isn't present, and
print an explicit `WARN: neither sqlite3 nor node available — SKIPPING
integrity check` in the (now very unlikely) case neither is available.
Re-verified live after the fix: both scripts printed `integrity: ok` /
`Integrity check: OK` via the node fallback on the same environment that
previously skipped silently.

**Recommendation**: install the `sqlite3` CLI on your box anyway
(`apt-get install sqlite3` / `brew install sqlite3`) — it's the reference
implementation and marginally faster for large databases; the node
fallback exists to make the check impossible to silently skip, not to
replace the CLI as the preferred path.

### 6.3 Retention and off-box copies

`scripts/db-backup.sh` keeps the last `CONCORD_BACKUP_RETAIN` (default 28)
backups locally and rotates older ones. Set `CONCORD_BACKUP_REMOTE` to an
`s3://` URL (needs `aws` CLI) or an rclone remote name to also push each
backup off-box — a local-only backup doesn't protect against the volume
itself failing. See the script's header comment for the full resolution
order of `DB_PATH`/`DATA_DIR`/backup destination.

`server/lib/backup-scheduler.js` + `server/routes/backup.js` additionally
expose this as a running service with a cron-like schedule and admin HTTP
surface (`GET/POST /api/admin/backups/*`) for boxes that want automated,
API-driven backups rather than a cron entry calling the shell scripts
directly — both paths call the same underlying mechanism.

---

## 7. CI-runnable dry run

`scripts/self-host-dry-run.sh` automates stages 3–6 above headlessly
against a throwaway `mktemp -d` workspace — it never touches a real
`DATA_DIR`/`DB_PATH`. It asserts (not just prints) success at each stage
and exits non-zero with the exact failing stage and a log path on any
failure, matching the `census --ci` / `check-doc-claims-all.mjs --ci`
convention already used elsewhere in this repo for "prove a claim is true,
don't just assert it in prose."

```bash
./scripts/self-host-dry-run.sh          # ~35-45s, exit 0 on success
./scripts/self-host-dry-run.sh --keep   # keeps the temp workspace + logs for debugging
```

What it proves, in order:
1. Migrations apply cleanly to a fresh DB.
2. The server boots and reports `/ready`.
3. A full smoke pass (30/30) succeeds.
4. A marker DTU can be created and a backup captures it.
5. Simulated total data loss (the live DB files are actually deleted).
6. `db-restore.sh` restores from that backup.
7. The server reboots against the restored DB, the marker DTU is still
   present with the same id, the row count did not drop, and a second full
   smoke pass (30/30) succeeds.

**Verified by actually running it twice in a row** in this pass — both runs
exited 0 with all 7 stages green, and a plain-restart-drift control test
(reboot the same DB twice, no backup/restore) confirmed the one non-obvious
number in the output (`row count did not drop (238 -> 240)`) is expected
first-boot settling, not the script being too lenient.

Add this to CI (matching the existing `detectors-cartography.yml` /
`audits.yml` gate pattern) as a scheduled or PR-triggered job when you want
this proven on every change, not just this one verification pass:

```yaml
- name: Self-host backup/restore proof (R7)
  run: ./scripts/self-host-dry-run.sh
```

---

## 8. Audit export pack (evidence bundle for an auditor / self-hoster)

`GET /api/admin/audit-export` (role-gated the same as
`/api/admin/heartbeat-stats` / `/api/admin/repair/detections` — `owner`,
`admin`, `sovereign`, or `founder`) assembles a single JSON bundle out of
signals Concord already computes and persists to disk:

- Detector suite summary (`audit/detectors/BASELINE.json` totals + age)
- Macro-depth grade, default and honest (`audit/macro-depth*.json`)
- UX-polish grade, default and honest (`audit/ux-polish*.json`)
- Doc-claims drift status (`audit/doc-claims-status.json`, if generated —
  see below)
- Repo/deploy metadata: git HEAD, branch, migration/domain/route/lens
  counts, and a live (bounded, ~2-4s) `count-loc` run

```bash
curl -H "Authorization: Bearer <admin token>" \
  "http://localhost:5050/api/admin/audit-export?download=1" \
  -o concord-audit-$(date +%Y%m%d).json
```

**Honesty discipline (verified live)**: this route never re-runs an
expensive detector/grader synchronously — every section reads an
already-persisted artifact and reports **that artifact's own
`generatedAt`** plus a computed `stale: true/false` flag (14-day
threshold) so an old grade is never presented as current. A missing
artifact produces `{available:false, reason:"not_generated"}`, never a
fabricated number. Verified live against this repo's real HEAD: the
detector baseline and doc-claims status came back fresh, while
`macroDepth` and `uxPolish` correctly reported `stale:true` (their
committed artifacts are ~3-15 days old at time of writing) — exactly the
honest behavior the design targets, not a hidden failure mode.

Doc-claims drift has no persisted artifact by default (the ~13s
`check-doc-claims-all.mjs` run isn't something this route will trigger
synchronously either). Generate one periodically — e.g. as a CI step
alongside the existing doc-claims gate — with:

```bash
node scripts/check-doc-claims-all.mjs --json --out audit/doc-claims-status.json
```

Until that's been run at least once, the bundle's `docClaims` section
reports `available:false` with the exact command to fix it — not silence,
not a fabricated "0 drift."

---

## 9. Summary of what changed in this pass

| File | Change |
|---|---|
| `scripts/db-backup.sh` | Integrity check now falls back to `better-sqlite3` (via `node`) when the `sqlite3` CLI isn't installed, instead of silently skipping with no warning. |
| `scripts/db-restore.sh` | Same fix, restore side. |
| `scripts/check-doc-claims-all.mjs` | Added an additive `--out <path>` flag to optionally persist the JSON result (doesn't change pass/fail behavior or exit code) — makes doc-claims freshness readable by §8's export route without re-running the check live. |
| `scripts/self-host-dry-run.sh` | New. Headless, CI-runnable version of §3–§6, asserted not just printed. |
| `server/lib/audit-export.js` | New. Read-only bundle assembler behind the new route — see §8. |
| `server.js` | New route: `GET /api/admin/audit-export` (§8). |
| `server/tests/audit-export.test.js` | New. Unit tests for the bundle assembler against the real repo tree. |
| `docs/SELF_HOST_VERIFICATION.md` | This document. |

None of the above touch the marketplace fee / royalty cascade / withdrawal
constants, `server/domains/code.js`, connector code, or the crafting
workbench — this pass stayed entirely inside self-host operator tooling.
