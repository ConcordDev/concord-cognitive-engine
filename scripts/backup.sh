#!/bin/bash
# DEPRECATED — do not use. This script hardcoded /data/db/concord.db and
# /data/concord_state.json (paths the bare-metal server does not use),
# swallowed every error with 2>/dev/null, and would happily report
# "[Backup] Completed" while producing an empty tarball.
#
# Real backup paths:
#   scripts/db-backup.sh          — WAL-safe sqlite .backup + integrity check,
#                                   cron-installed by startup.sh (6-hourly)
#   server/scripts/backup.sh      — server-local backup used by npm run backup
echo "DEPRECATED: use scripts/db-backup.sh (cron-installed by startup.sh) or 'npm run backup' in server/." >&2
exit 1
