# D — Research Frontier Contract

**The LLM boundary organ.** Filters deterministic signal stream down to genuine novelty, then invokes LLM research only where it adds value. Persists findings to DTU store.

---

## Purpose

Research Frontier answers:
1. **"Is this signal genuinely novel or just noisy?"** — Deterministic novelty detector
2. **"Should we invoke LLM research for this?"** — Cost/value gate
3. **"What did the research find?"** — Findings written as DTUs

The **daemon-vs-LLM rule** says: this is where LLMs become genuinely valuable. Before this phase, everything was deterministic (F0, O001, A, F3, B). D is the first organ where LLM invocation is part of the design.

But **D is still primarily a daemon**:
- **Novelty filter** is deterministic (statistical: rarity, deviation from baseline, source diversity)
- **Cost/value gate** is deterministic (don't invoke LLM for trivial signals)
- **Only when novelty + value both pass** does it invoke LLM
- **Output persistence** is deterministic (write DTU)
- **Failure handling** is deterministic (fallback to escalated unknown_class)

## The Organ Contract

```
WATCH       — Consume sentinel alerts + incident escalations + trace-fabric errors
   ↓
NOVELTY     — Deterministic filter: is this signal genuinely novel?
   ↓              - rarity: how often has this class appeared?
   ↓              - deviation: how different from baseline?
   ↓              - source_diversity: multiple sources reporting it?
   ↓              - complexity: needs interpretation?
   ↓
DECIDE      — Cost/value gate: should we invoke LLM research?
   ↓              - LLM cost: $$$ + latency
   ↓              - value: would novel interpretation help?
   ↓              - threshold: only if novelty_score > 0.6 AND value_score > 0.5
   ↓
RESEARCH    — If yes, invoke LLM with structured prompt
   ↓              - system prompt: "You are the research frontier. Given this signal,
   ↓                produce a finding with: hypothesis, evidence, counterarguments,
   ↓                recommendation, citations_needed. Cite at least one external source."
   ↓              - return: structured JSON
   ↓
GROUND      — DTU grounding: must show its work
   ↓              - empirical claims need external URLs (c06_research.py logic)
   ↓              - creative claims need reproducibility
   ↓
PERSIST     — Write finding to research_findings + DTU store
   ↓
RECORD      — Update research_state, alert Sentinel if high-value finding
```

## Novelty score (deterministic)

```
novelty_score = (
    rarity_weight * (1 - log(freq_in_last_24h + 1) / log(100)) +
    deviation_weight * (abs(z_score_of_severity) / 3) +
    source_diversity_weight * (sources_reporting / 3) +
    complexity_weight * (1 - similarity_to_known_class)
)
```

Where:
- rarity_weight = 0.3
- deviation_weight = 0.3
- source_diversity_weight = 0.2
- complexity_weight = 0.2

Score normalized to [0, 1]. Threshold: > 0.6 means novel.

## Value score (deterministic)

```
value_score = (
    decision_impact * (0 if "critical" else 0.5 if "warn" else 0.2) +
    actionability * (1 if known recovery exists, else 0.3) +
    temporal_urgency * (1 - minutes_since_observation / 60)
)
```

Threshold: > 0.5 means worth invoking LLM.

## LLM invocation (only when both pass)

```json
{
  "model": "minimax-m3:cloud",
  "fallback_chain": ["groq/gpt-oss-20b", "mistral-small", "ollama/qwen3.5:2b"],
  "system_prompt": "You are the research frontier for an autonomous OS. Given this signal from internal monitoring, produce a structured finding. Be honest about uncertainty. Cite at least one external source. Output JSON.",
  "user_prompt": {
    "signal": "<the signal>",
    "novelty_score": 0.7,
    "value_score": 0.6,
    "known_recovery": null,
    "context": "<relevant state>"
  },
  "output_schema": {
    "finding_title": "string",
    "hypothesis": "string",
    "evidence": ["string"],
    "counterarguments": ["string"],
    "recommendation": "string (action or escalate)",
    "citations_needed": ["url or search_query"],
    "confidence": "number 0-1"
  }
}
```

## Tools exposed (5)

| Tool | Purpose |
|---|---|
| `research_filter` | Run novelty + value filter on a given signal (returns scores without invoking LLM) |
| `research_invoke` | Invoke LLM research on a signal (only if both scores pass threshold) |
| `research_findings` | List recent research findings |
| `research_pending` | List signals that passed filter but haven't been researched yet |
| `research_get` | Get full details of a research finding |

## Storage

**SQLite database** at `/Users/dutch/.local/share/concord/research.db`:

```sql
CREATE TABLE research_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  signal_id TEXT,                 -- composite: source + signature
  source TEXT NOT NULL,           -- sentinel | incident | trace_fabric | external
  signal_signature TEXT NOT NULL, -- the pattern that triggered novelty check
  novelty_score REAL NOT NULL,
  value_score REAL NOT NULL,
  filter_decision TEXT NOT NULL,  -- pass | skip
  skip_reason TEXT,               -- low_novelty | low_value | duplicate
  research_status TEXT NOT NULL,  -- pending | in_progress | complete | failed
  research_started_at TEXT,
  research_completed_at TEXT,
  llm_model TEXT,
  llm_cost_estimate_usd REAL,
  finding_id INTEGER REFERENCES research_findings(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE research_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state_id INTEGER NOT NULL REFERENCES research_state(id),
  finding_title TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  evidence_json TEXT NOT NULL,        -- array of strings
  counterarguments_json TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  citations_needed_json TEXT,
  confidence REAL,
  grounding_pass TEXT,                -- passed | probation | failed
  grounding_reason TEXT,
  dtu_id INTEGER,                    -- if promoted to DTU
  raw_llm_response TEXT,              -- full LLM response for audit
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_research_state_pending ON research_state(research_status, novelty_score DESC);
CREATE INDEX idx_research_findings_recent ON research_findings(created_at DESC);
```

## Integration with F0

Every `research_*` tool goes through F0 dispatch:
- `research_filter` — read (deterministic filter, no LLM)
- `research_invoke` — write + execute (invokes LLM, persists finding)
- `research_findings`, `research_pending`, `research_get` — read

`research_invoke` is risky because it costs money. Per F0's authority field:
- Requires `execute: true` (LLM invocation is an external action)
- Requires `read: true` (signal consumption)
- Does NOT require `trade`, `deploy`, `code`, `destructive`
- Decision: every invocation logged to F0 audit

## Cost guardrails

- LLM invocation must be enabled via `CONCORD_RESEARCH_LLM_ENABLED=true`
- Default: disabled. Operator must explicitly enable.
- Daily budget: $5.00 USD (configurable via env)
- Per-invocation cap: $0.50 USD (configurable via env)
- If daily budget exceeded: skip LLM, fall back to escalation

## What "novelty" means here

A signal is **novel** when:
- It's not in the recent history (rarity)
- It deviates from known patterns (statistical z-score)
- Multiple sources corroborate (cross-source signal)
- It needs interpretation that deterministic classifiers can't provide

A signal is **not novel** when:
- It's the same alert repeating (dedupe)
- It matches a known class with known recovery (escalation only)
- It's pure noise (low signal-to-noise)
- The cost of LLM invocation exceeds potential value

## Verification (D.5)

Independent evaluator test:
- `research_filter` returns scores for any signal
- Low-novelty signals are skipped without LLM invocation
- High-novelty signals are marked pending
- `research_invoke` actually calls LLM (or returns honest "disabled" error)
- Findings written to DB
- DTU grounding flag set correctly
- No fake research (LLM not invoked when filter would skip)

## Stop list

- Do not modify c06_research.py (compose, don't replace)
- Do not modify dtu-grounding.js (compose, don't replace)
- Do not invoke LLM without going through the filter
- Do not bypass F0 for LLM invocations
- Do not auto-write DTUs without grounding check
- Do not run research on every signal (must pass threshold)

## What "research" means here

A **research finding** = the output of a single LLM invocation that passed both filters. The finding is:
- **Grounded** in external sources (per DTU grounding rules)
- **Structured** per the output schema
- **Persisted** to research_findings + (optionally) DTU store
- **Cited** with at least one external URL or search query

A research finding without grounding is "probation" — kept in research_findings but not promoted to DTU. This is the same rule as DTU grounding: "show your work" or stay probation.