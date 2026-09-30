# H — Experience-to-Learning Contract

**The memory consolidation substrate.** Reads episodic chunks from across all organs, distills them into recurring patterns, and consolidates those patterns into long-term semantic memories that other organs can query.

---

## Purpose

H answers:
1. **"What just happened across all organs?"** — Episodic compression
2. **"What patterns repeat?"** — Distillation into semantic memories
3. **"What do we know that's worth keeping?"** — Consolidation to long-term
4. **"What have we learned?"** — Queryable memory

The **daemon-vs-LLM rule** says: H is **primarily deterministic** — hash-based clustering, frequency analysis, content fingerprinting. **LLM only when** operator explicitly requests semantic interpretation (separate tool `experience_interpret`).

## The Memory Pipeline

```
EPISODIC (read across organs)
   - sentinel: alerts
   - incident-engine: incidents + outcomes
   - research-frontier: findings + state
   - opportunity-engine: proposals + approvals
   - proactive-engine: predictions + outcomes
   - economic-controller: budget snapshots
   - initiative-engine: proposals + executions
   - capability-forge: patterns + registrations
   - a2a-boundary: messages
       ↓
COMPRESS (chunk by time + content)
   - Group events by (organ, kind, hour_bucket)
   - Compute content_hash per chunk
   - Skip chunks already compressed (idempotent)
       ↓
DISTILL (extract patterns)
   - Same (kind, target_tool) across organs → pattern
   - High-frequency kinds → high-confidence memory
   - Outliers (rare but important) → anomaly memory
       ↓
CONSOLIDATE (persist semantic memories)
   - Link back to source chunks (lineage)
   - Compute confidence score
   - TTL: default 30 days (renewable)
       ↓
QUERY (read back)
   - List memories by organ/kind/confidence
   - Get full memory + lineage
   - Get compression stats
```

## Tools exposed (5)

| Tool | Purpose | Risk |
|---|---|---|
| `experience_compress` | Run episodic compression (scan + chunk + persist) | write |
| `experience_distill` | Extract patterns from compressed chunks | write |
| `experience_consolidate` | Distill + persist semantic memories | write |
| `experience_list_memories` | List consolidated memories | read |
| `experience_get_memory` | Get full memory + lineage | read |
| `experience_stats` | Compression/distillation stats | read |

**No `experience_forget`** — memories are append-only; operator must explicitly delete.

## Envelope: Chunk

```python
{
    "chunk_id": "chk_<uuid>",
    "organ": "browser-organ" | "sentinel-organ" | ...,
    "kind": "alert" | "incident" | "proposal" | "execution" | "delivery" | "finding" | ...,
    "hour_bucket": "2026-08-31T18",  # UTC hour
    "count": 1,
    "content_hash": "sha256:<hex>",
    "content_sample": "...",  # first 200 chars
    "source_ids_json": "[1, 2, 3, ...]",  # source row IDs
    "compressed_at": "<iso8601>",
    "trace_id": "<uuid>",
    "status": "compressed" | "distilled" | "consolidated",
}
```

## Envelope: Memory

```python
{
    "memory_id": "mem_<uuid>",
    "organ": "...",
    "kind": "...",
    "pattern": "short pattern summary",
    "frequency": 5,
    "confidence": 0.7,
    "source_chunk_ids": ["chk_a", "chk_b", ...],
    "supporting_evidence_count": 12,
    "first_observed": "<iso8601>",
    "last_observed": "<iso8601>",
    "ttl_days": 30,
    "expires_at": "<iso8601>",
    "trace_id": "<uuid>",
    "created_at": "<iso8601>",
}
```

## Source organ readers

Each organ has its own DB. H reads from:

| Organ | DB | Tables | What we read |
|---|---|---|---|
| browser-organ | browser_organ.db | observations | (kind, observation_json, created_at) |
| sentinel-organ | sentinel.db | alerts | (kind, alert_json, created_at) |
| trace-fabric | trace-fabric.db | traces | (kind, payload, created_at) |
| incident-engine | incident-engine.db | incidents | (kind, signal_json, created_at) |
| research-frontier | research.db | findings | (kind, recommendation, created_at) |
| opportunity-engine | opportunity.db | proposals | (kind, source_id, created_at) |
| proactive-engine | proactive-engine.db | predictions | (kind, prediction_json, created_at) |
| economic-controller | economic.db | states | (snapshot, created_at) |
| initiative-engine | initiative.db | proposals | (kind, target_tool, created_at) |
| capability-forge | capability-forge.db | patterns | (target_tool, occurrences, created_at) |
| a2a-boundary | a2a-boundary.db | messages | (sender, recipient, status, created_at) |

## Pattern distillation logic

For each (organ, kind) pair:
- Count chunks in last N hours
- If count >= MIN_OCCURRENCES (default 3): candidate memory
- Confidence = min(1.0, count / 10) (saturates at 10 occurrences)
- Frequency = actual count
- Memory pattern = top 3 most common `target_tool` or `kind` value within chunks

## TTL & expiry

- Default TTL: 30 days
- `experience_compress` skips chunks older than 7 days (they should already be in memories)
- Memories track `expires_at`; expired memories are skipped from queries (but kept in DB)

## Storage

```sql
CREATE TABLE experience_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_id TEXT NOT NULL UNIQUE,
    organ TEXT NOT NULL,
    kind TEXT NOT NULL,
    hour_bucket TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    content_hash TEXT NOT NULL,
    content_sample TEXT,
    source_ids_json TEXT,
    compressed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    trace_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'compressed',
    UNIQUE(organ, kind, hour_bucket)
);

CREATE TABLE experience_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_id TEXT NOT NULL UNIQUE,
    organ TEXT NOT NULL,
    kind TEXT NOT NULL,
    pattern TEXT NOT NULL,
    frequency INTEGER NOT NULL DEFAULT 1,
    confidence REAL NOT NULL DEFAULT 0.5,
    source_chunk_ids_json TEXT NOT NULL,
    supporting_evidence_count INTEGER NOT NULL DEFAULT 1,
    first_observed TEXT,
    last_observed TEXT,
    ttl_days INTEGER NOT NULL DEFAULT 30,
    expires_at TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(organ, kind, pattern)
);

CREATE TABLE experience_consolidations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL UNIQUE,
    chunks_processed INTEGER NOT NULL,
    memories_created INTEGER NOT NULL,
    organs_touched_json TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    trace_id TEXT NOT NULL
);

CREATE INDEX idx_experience_chunks_organ ON experience_chunks(organ, kind);
CREATE INDEX idx_experience_memories_organ ON experience_memories(organ, kind);
CREATE INDEX idx_experience_memories_expires ON experience_memories(expires_at);
```

## Daemon-vs-LLM status

H is **purely deterministic**:
- Compression: SQL aggregation + SHA256 hashing
- Distillation: frequency analysis + statistical thresholding
- Consolidation: SQL insert + confidence formula
- Query: SQL SELECT

LLM invocation: zero by default. (Future: `experience_interpret` would use Research Frontier for semantic interpretation.)

## Why "append-only"

Memory is sacred. Per the user's principle **"Authority is sacred"** — once we've learned something, we don't silently forget it. Memories can be:
- Renewed (extends expires_at)
- Suppressed (operator marks as no longer relevant; future queries skip)
- Never deleted automatically

## What's next after H

I (Concordia) is the **final integration** — assemble all organs into a single observable system, verify end-to-end, demonstrate cross-organ workflows. After I, O002-O007 organs plug in afterward.

The complete autonomous substrate (after H):
```
WATCH → DETECT → PROPOSE → PREDICT → COMPOSE → SUBMIT → EXECUTE → RECORD
   ↑                                            ↓
   └──── MINE PATTERNS ────→ TEMPLATE → REGISTER
                              ↓
                         A2A: route messages
                              ↓
                  COMPRESS → DISTILL → CONSOLIDATE
                              ↓
                          MEMORY
                              ↓
                        Concordia (next)
                              ↓
                   Final integration + demonstration
```

H is the **memory substrate** — turning episodic events into long-term semantic memories that make the system smarter over time.