# Data Directory Structure

Concord Cognitive Engine stores all persistent state in the `data/` directory
(override with the `DATA_DIR` environment variable).

## Directory Layout

```
data/
  concord.db            # Main SQLite database (better-sqlite3, WAL mode)
  concord.db-wal        # Write-ahead log (auto-managed by SQLite)
  concord.db-shm        # Shared memory file (auto-managed by SQLite)
  concord_state.json    # Runtime state snapshot (heartbeat, config cache)
  backups/              # Automated and manual backups (created by db-backup.sh)
  artifacts/            # Generated artifacts (DTUs, exports, rendered output)
  uploads/              # User-uploaded files (when applicable)
```

### `data/concord.db`

The primary SQLite database. Schema is managed by numbered migration files in
`server/migrations/` (`001_core_tables.js` through `192_foundry_phase7.js` — 192
numbered migrations at HEAD). Migrations run automatically on server startup via
`server/migrate.js`.

To export the current schema to SQL:

```bash
./scripts/db-export-schema.sh
# produces server/migrations/schema-export.sql
```

### `data/concord_state.json`

Lightweight JSON file written periodically by the server to persist runtime
state across restarts (e.g. heartbeat timestamps, feature flags, queue
positions). Not a substitute for the database -- treat it as ephemeral cache
that improves cold-start performance.

### `data/backups/`

Timestamped `.tar.gz` archives created by the backup script. Each archive
contains `concord.db` and `concord_state.json` (if it existed at backup time).

### `data/artifacts/`

Generated artifacts managed by the server (DTU packs, rendered content,
exports). Backed up separately by `server/scripts/backup.sh`.

### `data/uploads/`

User-uploaded files. Created on demand when upload features are used.

## Backup and Restore

### Create a backup

```bash
# Default location (data/backups/)
./scripts/db-backup.sh

# Custom directory
./scripts/db-backup.sh /mnt/external/concord-backups
```

The backup script:
- Uses SQLite `.backup` API for a consistent snapshot (falls back to file copy)
- Runs `PRAGMA integrity_check` on the copy
- Includes `concord_state.json` if present
- Compresses with gzip into a single `.tar.gz`
- Rotates old backups, keeping the 10 most recent

### Restore from a backup

```bash
./scripts/db-restore.sh ./data/backups/concord-backup-20260331_120000.tar.gz
```

The restore script:
- Validates the backup archive and runs integrity checks
- Stops PM2 processes if running
- Creates a safety copy of the current database (`concord.db.pre-restore-*`)
- Restores the database and state file
- Restarts PM2 processes

### Production backups

For production and S3-based backups, see `server/scripts/backup.sh`,
`server/scripts/backup-s3.sh`, and `server/scripts/restore-s3.sh`.

## Moving Data Between Machines

1. **Create a backup** on the source machine:

   ```bash
   ./scripts/db-backup.sh
   ```

2. **Transfer the archive** to the target machine:

   ```bash
   scp data/backups/concord-backup-YYYYMMDD_HHMMSS.tar.gz user@target:/path/to/concord/
   ```

3. **Restore** on the target machine:

   ```bash
   ./scripts/db-restore.sh /path/to/concord-backup-YYYYMMDD_HHMMSS.tar.gz
   ```

4. **Run migrations** to apply any schema changes the target codebase expects:

   ```bash
   cd server && node migrate.js
   ```

### Manual transfer (without scripts)

If you prefer not to use the scripts:

```bash
# On source: checkpoint WAL then copy
sqlite3 data/concord.db "PRAGMA wal_checkpoint(TRUNCATE);"
cp data/concord.db /transfer/concord.db
cp data/concord_state.json /transfer/ 2>/dev/null

# On target:
cp /transfer/concord.db data/concord.db
cp /transfer/concord_state.json data/ 2>/dev/null
```

## Environment Variables

| Variable   | Default                          | Description                    |
|------------|----------------------------------|--------------------------------|
| `DATA_DIR` | `./data` (relative to `server/`) | Root directory for all data    |
| `DB_PATH`  | `$DATA_DIR/concord.db`           | SQLite database file path      |
