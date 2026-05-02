# Phase 15: Continuous Integrity Verification

**Status:** COMPLETE — daily sweep script operational  
**Date:** 2026-04-29

## Implementation

**File:** `server/scripts/daily-integrity.js`

Runs the full audit suite daily and persists results.

## Schedule

```bash
# Add to crontab:
0 4 * * * /usr/bin/node /path/to/server/scripts/daily-integrity.js >> /var/log/concord-integrity.log 2>&1
```

Or via the existing `ecosystem.config.cjs` (PM2):
```javascript
{
  name: 'integrity-sweep',
  script: 'server/scripts/daily-integrity.js',
  cron_restart: '0 4 * * *',
  autorestart: false
}
```

## What Runs Each Day

1. **Provenance audit** — all capability claims verified against running system
2. **Wiring audit** — detect newly orphaned modules
3. **Silent failure detection** — track pattern count over time (rising count = degradation)
4. **Import audit** — detect newly broken imports

## Report Persistence

Results written to `reports/production-integrity/integrity-YYYY-MM-DD.json`. Enables trend tracking: is the number of empty_catch blocks rising or falling over time?

## Pre-Deployment Gate

```bash
# Blocks deployment if any check fails
node server/scripts/daily-integrity.js --fail-fast
```

Exit code 1 on failure, 0 on success — integrates with any CI/CD pipeline.

## Drift Detection

The daily run detects drift:
- A provenance claim that was `verified` yesterday is now `failed` → alert
- Wiring audit orphan count increased → new built-but-not-wired pattern
- Critical silent failures increased → new empty_catch introduced

Alerts go to `ops` via the existing notification channel (configurable via `ALERT_WEBHOOK_URL` env var).
