# C.5 — Proactive Engine Contract

**The predictive substrate.** Forecasts near-future events from upstream signal patterns, schedules reminders, persists predictions. **Never auto-acts** — every prediction is a stored candidate awaiting operator review or future Initiative Engine.

---

## Purpose

Proactive Engine answers:
1. **"What's likely to happen next?"** — Predictive timeline generation
2. **"When should I worry about X?"** — Threshold prediction
3. **"What reminders should be scheduled?"** — Time-based scheduling
4. **"What was predicted vs what happened?"** — Calibration tracking

The **daemon-vs-LLM rule** says: C.5 is primarily deterministic. Statistical prediction (linear regression on time-series, threshold projections) doesn't need LLM.

## Why "never auto-act"

Just like Opportunity Engine:
- Predictions are uncertain by nature
- False positives erode trust
- Reminders are operator-facing nudges, not commands
- Future Initiative Engine can promote high-confidence predictions to action (after F0 authority)

## The Organ Contract

```
WATCH       — Consume historical patterns from:
                - sentinel_alerts (frequency trends)
                - browser_organ observations (rate, provider health over time)
                - incident_engine outcomes (recovery patterns, recurring failures)
                - opportunity_proposals (recurring themes)
                - trace_fabric (error rate over time)
   ↓
PREDICT     — For each pattern, generate predictions:
                - rate_limit_imminent (browser_organ rate-limit probe approaching threshold)
                - recovery_recurring (same incident class likely to recur)
                - opportunity_cluster (similar proposals appearing repeatedly)
                - sentinel_alert_growing (alert count trending up over N hours)
                - provider_degrading (success rate dropping over time)
                - dedupe_pending (proposal about to expire)
   ↓
SCORE       — Deterministic confidence calculation:
                confidence = base_confidence * pattern_strength * recency_factor
                where:
                  base_confidence = pattern-specific baseline (0.3-0.7)
                  pattern_strength = how clear the pattern is (0-1)
                  recency_factor = 1.0 if last 1h, decays over time
   ↓
HORIZON     — Predict time-to-event:
                near: < 1 hour (urgent reminders)
                soon: 1-6 hours (planned reminders)
                later: 6-24 hours (forecast only)
                far: > 24 hours (informational)
   ↓
SCHEDULE    — For near/soon predictions, create reminder:
                - reminder_id
                - prediction_id (linked)
                - fire_at (when to remind)
                - severity (info | warn | critical)
                - message (operator-facing)
                - status: pending | fired | dismissed | expired
   ↓
RECORD      — Update proactive_state:
                - predictions_generated
                - reminders_scheduled
                - reminders_fired
                - predictions_confirmed
                - predictions_disproved
                - alert_level
   ↓
NOTIFY      — Tier-based: critical reminders fire immediately via telegram
                info reminders wait for next tick
```

## Prediction kinds (deterministic)

| Kind | Pattern | Confidence formula |
|---|---|---|
| `rate_limit_imminent` | same provider rate-limit hits 3+ times in last hour | base 0.5 + (frequency-3)*0.1 |
| `recovery_recurring` | same incident_class appears 2+ times in last 24h | base 0.6 + (recurrence-2)*0.1 |
| `opportunity_cluster` | same kind proposed 3+ times | base 0.4 + (count-3)*0.1 |
| `sentinel_alert_growing` | alert count this hour > 2x previous hour | base 0.55 + (ratio-2)*0.1 |
| `provider_degrading` | success rate dropping 20% over last 24 probes | base 0.5 + (drop-20)*0.005 |
| `dedupe_pending` | approved proposal expires in < 1 hour | base 0.7 |
| `balance_drift` | USDC balance changing > 10% in last 24h | base 0.4 |
| `agent_silent` | entity_tick_history has gaps > 1h | base 0.5 |

## Horizon + Reminder rules

```python
def decide_horizon(confidence, pattern_strength):
    if confidence >= 0.8:
        return "near"  # < 1 hour
    elif confidence >= 0.6:
        return "soon"  # 1-6 hours
    elif confidence >= 0.4:
        return "later"  # 6-24 hours
    else:
        return "far"   # informational only

def should_schedule_reminder(horizon):
    return horizon in ("near", "soon")
```

## Tools exposed (5)

| Tool | Purpose |
|---|---|
| `proactive_predict` | Run full sweep — collect signals, generate predictions, schedule reminders |
| `proactive_list_predictions` | List predictions (with filters: kind, horizon, since) |
| `proactive_list_reminders` | List reminders (with filters: status, since) |
| `proactive_dismiss_reminder` | Operator dismisses a reminder (status pending → dismissed) |
| `proactive_calibration` | Show prediction accuracy: how many confirmed vs disproved |

**No `proactive_act`.** Proactive is **forecast + remind**, never action. Initiative Engine (F) is the future action phase.

## Storage

**SQLite database** at `/Users/dutch/.local/share/concord/proactive.db`:

```sql
CREATE TABLE proactive_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    observed_at TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    signals_observed INTEGER NOT NULL DEFAULT 0,
    predictions_generated INTEGER NOT NULL DEFAULT 0,
    reminders_scheduled INTEGER NOT NULL DEFAULT 0,
    reminders_fired INTEGER NOT NULL DEFAULT 0,
    predictions_confirmed INTEGER NOT NULL DEFAULT 0,
    predictions_disproved INTEGER NOT NULL DEFAULT 0,
    alert_level TEXT NOT NULL DEFAULT 'none',
    alert_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE proactive_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    state_id INTEGER,
    prediction_id TEXT NOT NULL,            -- composite: kind + signature
    kind TEXT NOT NULL,                       -- rate_limit_imminent, etc.
    source TEXT NOT NULL,                     -- sentinel | browser_organ | opportunity | incident | trace_fabric
    source_pattern TEXT NOT NULL,             -- JSON of the historical pattern
    summary TEXT NOT NULL,
    confidence REAL NOT NULL,
    horizon TEXT NOT NULL,                    -- near | soon | later | far
    predicted_event TEXT,                     -- what we predict will happen
    predicted_at TEXT,                        -- when we predict it will happen
    fired_at TEXT,
    outcome TEXT,                             -- confirmed | disproved | pending
    trace_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE proactive_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id INTEGER REFERENCES proactive_predictions(id),
    severity TEXT NOT NULL,                   -- info | warn | critical
    message TEXT NOT NULL,
    fire_at TEXT NOT NULL,
    fired_at TEXT,
    dismissed_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | fired | dismissed | expired
    trace_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_proactive_predictions_pending ON proactive_predictions(outcome, horizon);
CREATE INDEX idx_proactive_reminders_pending ON proactive_reminders(status, fire_at);
```

## Integration with F0

Every `proactive_*` tool goes through F0 dispatch:
- `proactive_predict` — write (generates predictions)
- `proactive_list_predictions`, `proactive_list_reminders` — read
- `proactive_dismiss_reminder`, `proactive_calibration` — write (calibration is read-heavy but may write confirmed/disproved)

## Prediction evaluation (proactive_calibration)

After predictions are made, when events actually happen, mark predictions:
- **confirmed**: predicted event happened within predicted horizon
- **disproved**: predicted event did NOT happen within predicted horizon
- **pending**: prediction still within horizon, awaiting outcome

Calibration is what makes predictions improve over time. Initial calibration is 0 (no baseline).

## Stop list

- Do NOT create `proactive_act` tool
- Do NOT auto-trigger reminders (must persist, not execute)
- Do NOT auto-promote predictions to opportunities (each organ keeps its own scope)
- Do NOT invoke LLM for prediction (pure statistical)
- Do NOT propose predictions without historical evidence
- Do NOT propose duplicate predictions within 1 hour

## Daemon-vs-LLM status

Proactive Engine is **purely deterministic**:
- Pattern detection: SQL aggregation queries
- Prediction scoring: deterministic math
- Horizon classification: deterministic thresholds
- Reminder scheduling: deterministic rules
- Persistence: deterministic SQL
- Dismissal: explicit operator action

LLM is never invoked by C.5. If a prediction needs interpretation, the operator can use Research Frontier (D).

## What's next after C.5

Once predictions are stored, the next phase (F — Initiative Engine) would:
- Read approved predictions from proactive_predictions
- Promote high-confidence predictions to opportunity_proposals
- Submit approved opportunities to F0 for execution
- Track execution outcomes

C.5 is the **predict half**. F is the **execute half** (reading from C and C.5).

The complete loop:
```
WATCH (sentinel) → DETECT (incident) → PROPOSE (opportunity)
                → PREDICT (proactive) → APPROVE (operator) → EXECUTE (initiative) → RECORD (opportunity)
```