# Phase 13: Load Testing Harness

**Status:** COMPLETE — k6 scripts ready  
**Date:** 2026-04-29

## Implementation

**Files:**
- `load-tests/baseline.k6.js` — full load test (24 minute ramp-up/sustain/ramp-down)
- `load-tests/smoke.k6.js` — smoke gate (2.5 minutes, 5 VUs, for PRs)

## Test Configuration

### Baseline (baseline.k6.js)
```
Stages: 2m@10VU → 5m@50VU → 5m@200VU → 5m@200VU → 5m@50VU → 2m@0VU
Thresholds: p(95) < 5000ms, error rate < 1%
Endpoints tested: /api/health, /api/inference/traces, /api/inference/costs, /api/voice/session/create
```

### Smoke Gate (smoke.k6.js)
```
Stages: 30s@5VU → 90s@5VU → 30s@0VU
Thresholds: p(95) < 8000ms, error rate < 5%
Purpose: PR gate — fast verification of basic availability
```

## Usage

```bash
# Install k6 (macOS)
brew install k6

# Install k6 (Ubuntu)
sudo apt install k6

# Run smoke gate
k6 run load-tests/smoke.k6.js

# Run full baseline (against staging)
BASE_URL=https://staging.concord-os.org k6 run load-tests/baseline.k6.js

# Results written to:
# reports/production-integrity/load-test-results.json
```

## CI Integration

Add to `.github/workflows/`:
```yaml
- name: Smoke test
  run: k6 run load-tests/smoke.k6.js
  env:
    BASE_URL: ${{ env.STAGING_URL }}
```

## SLO Correlation

Load test thresholds mirror SLO targets:
- p95 < 5000ms matches `chat_response_latency` SLO
- error rate < 1% matches `inference_availability` SLO (99% threshold for load test)

Results from `handleSummary` are written to `reports/production-integrity/load-test-results.json` for trending.
