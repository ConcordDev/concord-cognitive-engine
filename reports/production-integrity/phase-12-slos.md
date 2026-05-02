# Phase 12: SLO Definitions and Monitoring

**Status:** COMPLETE — 7 SLOs defined, tracker operational  
**Date:** 2026-04-29

## Implementation

**File:** `server/lib/monitoring/slo.js`

- `CONCORD_SLOS` — frozen object with 7 SLO definitions
- `SLOTracker` class — in-memory circular buffer (1000 samples/SLO), percentile calculation
- `wireInferenceToSLO()` — connects inference tracer spans to SLO recording
- `getSLODashboard()` — returns current status of all SLOs

## Defined SLOs

| SLO | Target | Error Budget | Metric |
|-----|--------|-------------|--------|
| `chat_response_latency` | p95 < 5000ms | 5%/month | Time to first response token |
| `inference_availability` | 99.5% uptime | 0.5%/month | Inference success rate |
| `refusal_gate_correctness` | 100% block rate | 0% | Known-harmful patterns blocked |
| `royalty_cascade_completion` | p99 < 30000ms | 1%/month | Transaction to all royalties paid |
| `voice_round_trip` | p95 < 700ms | 5%/month | Voice input to voice output |
| `thread_checkpoint_write` | p99 < 500ms | 1%/month | Checkpoint write latency |
| `sandbox_creation` | p95 < 5000ms | 5%/month | Sandbox workspace creation time |

## Prometheus Integration

Each SLO maps to a Prometheus metric name (e.g., `concord_chat_latency_ms`). The existing Prometheus config at `monitoring/prometheus/prometheus.yml` should be extended with alert rules for SLO breaches:

```yaml
# Add to monitoring/prometheus/alerts.yml
- alert: ChatLatencySLOBreach
  expr: histogram_quantile(0.95, rate(concord_chat_latency_ms_bucket[5m])) > 5000
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "Chat latency SLO at risk"
```

## In-Memory Tracker Status

The `SLOTracker` accumulates samples as inference spans arrive. After `wireInferenceToSLO()` is called at startup, every finish/failure span automatically records:
- `chat_response_latency`: latency from finish spans
- `inference_availability`: success=true on finish, success=false on failure

The `GET /api/inference/slos` endpoint (via inference-debug router) can surface the dashboard.

## Tests

4/4 SLO tracker tests passing in production-integrity.test.js.
