# I — Concordia Integration Contract

**The final integration audit.** Assembles all 12 organs into a single observable system, verifies each one is healthy + reachable, and demonstrates end-to-end cross-organ workflows. **Read-only** — never modifies state.

---

## Purpose

I answers:
1. **"What organs are alive?"** — Inventory of all 12 organs
2. **"Are they all healthy?"** — Per-organ health check
3. **"Can they talk to each other?"** — Cross-organ workflow verification
4. **"Does the full loop work?"** — End-to-end demonstration

The **daemon-vs-LLM rule** says: I is **purely deterministic** — no LLM. Just call each organ's health-check tool, gather status, report.

## Organs in the Concordia Fleet

| Phase | Organ | Tool Count | DB |
|---|---|---|---|
| F0 | Authority Kernel | (gates) | (in-memory) |
| O001 | Browser Organ | 3 | browser_organ.db |
| A | Sentinel | 4 | sentinel.db |
| F3 | Trace Fabric | 6 | trace-fabric.db |
| B | Incident Engine | 5 | incident-engine.db |
| D | Research Frontier | 5 | research.db |
| C | Opportunity Engine | 5 | opportunity.db |
| C.5 | Proactive Engine | 5 | (proactive-engine.db) |
| E | Economic Controller | 6 | economic.db |
| F | Initiative Engine | 6 | initiative.db |
| F.5 | Capability Forge | 5 | capability-forge.db |
| G | A2A Boundary | 6 | a2a-boundary.db |
| H | Experience-to-Learning | 6 | experience-learner.db |

## Tools exposed (4)

| Tool | Purpose | Risk |
|---|---|---|
| `concordia_assemble` | Build full fleet snapshot (organ + DB + tool counts) | read |
| `concordia_verify` | Run health check on all 12 organs | read |
| `concordia_demonstrate` | Execute end-to-end cross-organ workflow + report | write (sends trace, creates memory) |
| `concordia_list_assemblies` | List previous assemblies/verifications | read |

## Assembly Envelope

```python
{
    "assembly_id": "asm_<uuid>",
    "started_at": "<iso8601>",
    "completed_at": "<iso8601>",
    "trace_id": "<uuid>",
    "organs": [
        {
            "name": "browser-organ",
            "phase": "O001",
            "db_path": "/Users/dutch/.local/share/concord/browser_organ.db",
            "db_exists": True,
            "db_size_bytes": 12345,
            "tool_count": 3,
            "tool_names": ["browser_check_coins", "browser_check_rate_limits", "browser_check_incidents"],
            "reachable": True,
            "healthy": True,
            "last_heartbeat": "<iso8601>",
            "record_count": 229,
        },
        ...
    ],
    "summary": {
        "total_organs": 13,
        "reachable": 13,
        "healthy": 12,
        "total_tools": 80,
        "total_records": 12345,
        "total_db_size_bytes": 67890123,
    },
}
```

## Health Check

For each organ:
1. **DB existence**: Check `~/.local/share/concord/{organ}.db` exists
2. **DB size**: `os.path.getsize()` for storage health
3. **Tool count**: From MCP_TOOLS array (or hardcoded as fallback)
4. **Reachable**: Call a known tool (e.g. `*_list` or `*_status`) with timeout
5. **Healthy**: Response is `ok=True` AND no error field
6. **Last heartbeat**: Read from organ's main state table
7. **Record count**: `SELECT COUNT(*) FROM <primary_table>`

## Cross-Organ Verification

For each pair of organs (F, D), check if their data flows are wired:
- F (Initiative) → reads from C (Opportunity), C.5 (Proactive)
- F.5 (Capability Forge) → reads from F (Initiative)
- E (Economic) → reads from research_roi_ledger.json
- H (Experience) → reads from all 11 organ DBs
- A2A (G) → routes messages between organs and operator

## Demonstration Workflow

`concordia_demonstrate` runs a non-destructive workflow:

```
1. PROPOSE: opportunity_list to find existing approved proposals
2. PREDICT: proactive_list_predictions to find predictions
3. COMPOSE: initiative_compose with since_minutes=1440 (dry_run)
4. SUBMIT: initiative_validate a sample initiative
5. TRACE: trace a2a_send internal message
6. MEMORY: experience_stats to confirm consolidation
7. ECONOMIC: economic_snapshot to confirm budget

All steps write to a2a_messages + experience_chunks (audit trail)
but NO auto-execute. Report results.
```

## Storage

```sql
CREATE TABLE concordia_assemblies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assembly_id TEXT NOT NULL UNIQUE,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    organs_total INTEGER NOT NULL,
    organs_healthy INTEGER NOT NULL,
    summary_json TEXT NOT NULL,
    trace_id TEXT NOT NULL
);

CREATE TABLE concordia_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    verification_id TEXT NOT NULL UNIQUE,
    organ TEXT NOT NULL,
    reachable INTEGER NOT NULL,
    healthy INTEGER NOT NULL,
    tool_count INTEGER NOT NULL,
    record_count INTEGER NOT NULL,
    details_json TEXT,
    verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    trace_id TEXT NOT NULL,
    UNIQUE(verification_id, organ)
);
```

## Daemon-vs-LLM status

I is **purely deterministic**:
- Assembly: file system checks + DB queries
- Verification: subprocess calls with timeout
- Demonstration: invocation of other organs' tools
- Reporting: dict assembly

LLM invocation: zero.

## Why "read-only"

I is the **final audit**. It proves the system works end-to-end without modifying production state. If any organ is unhealthy, that's a **reportable finding** — operator decides whether to fix.

## Stop list

- Do NOT auto-execute any organ tool beyond list/get/stats (write ops only for audit trail)
- Do NOT modify organ DBs
- Do NOT submit initiatives automatically (only validate)
- Do NOT send external messages (only internal trace)

## What's next after I

After I, O002-O007 organs plug in afterward. The complete autonomous substrate:
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
                        Concordia (final audit)
                              ↓
                   O002-O007 organs plug in
```

I is the **demonstration substrate** — proving that all 12 organs work together end-to-end.