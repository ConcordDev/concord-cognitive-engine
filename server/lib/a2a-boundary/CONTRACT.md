# G — A2A Boundary Contract

**The inter-agent communication substrate.** Routes messages between organs, external agents, and operators with durable delivery confirmation. **Never drops messages silently** — every send is recorded with state transitions until ACK.

---

## Purpose

A2A Boundary answers:
1. **"Where does this go?"** — Routing rules (sender → recipient, channel selection)
2. **"Did it arrive?"** — Durable delivery confirmation with retry
3. **"What's the audit trail?"** — Per-message log with state machine
4. **"Who is allowed to message whom?"** — Permission tiers

The **daemon-vs-LLM rule** says: G is **purely deterministic routing**. No LLM needed for envelope construction, route lookup, or ACK tracking.

## Why "never drops messages silently"

Per `gateway/delivery_ledger.py` (Hermes): "a final agent response that was generated but not yet confirmed-delivered is the one artifact the gateway can lose without a trace." The same applies here — every outbound message is **persistently recorded with state transitions**:

```
PENDING → ATTEMPTING → DELIVERED (success)
                  ↘ FAILED → RETRYING → ...
                  ↘ REJECTED (permission denied)
                  ↘ DROPPED (max retries exceeded)
```

No transition is silent. Every state change has trace_id + timestamp + reason.

## The Organ Contract

```
SEND         — Envelope construction:
                - from: <sender_id> (organ name or external agent)
                - to: <recipient_id> (organ, external, or operator)
                - channel: <telegram|discord|slack|imessage|signal|email|internal>
                - payload: { type, content, metadata }
                - priority: info | warn | critical
                - trace_id: <unique>
                - idempotency_key: <hash of envelope>
   ↓
ROUTE        — Deterministic routing:
                - sender → recipient
                - channel selection based on recipient config
                - permission check (sender allowed to message recipient?)
                - If unknown sender/recipient → status = "rejected"
                - On success → status = "attempting"
   ↓
DELIVER      — Transport:
                - Call the right adapter (telegram: imsg, slack: webhook, etc.)
                - For internal: write to recipient's DB / notification queue
                - Capture transport response (message_id or error)
                - status transitions: attempting → delivered | failed
   ↓
ACK          — Confirmation:
                - delivered: store message_id from platform
                - failed: increment retry_count, schedule next attempt
                - max_retries exceeded: status = "dropped"
                - All transitions logged to a2a_deliveries
   ↓
AUDIT        — Every step persisted:
                - a2a_messages (envelope + final status)
                - a2a_deliveries (per-attempt log)
                - a2a_routes (resolved routing table snapshot)
```

## Tools exposed (6)

| Tool | Purpose | Risk |
|---|---|---|
| `a2a_send` | Send a message (with envelope) | write |
| `a2a_list_messages` | List sent messages with filters | read |
| `a2a_get_message` | Get full message details | read |
| `a2a_ack` | Mark a delivered message as acknowledged by recipient | write |
| `a2a_list_routes` | List available sender → recipient routes | read |
| `a2a_check_delivery` | Re-check status of pending messages (retry + report) | write |

**No `a2a_broadcast`** — broadcast requires explicit per-recipient sends.

## Envelope schema

```python
{
    "message_id": "msg_<uuid>",
    "from": "operator" | "browser-organ" | "sentinel-organ" | "..." | "<external_agent_id>",
    "to": "operator" | "trace-fabric" | "..." | "<external_agent_id>",
    "channel": "internal" | "telegram" | "discord" | "slack" | "imessage" | "signal" | "email",
    "payload": {
        "type": "text" | "alert" | "report" | "request" | "ack",
        "content": "...",
        "metadata": { ... }
    },
    "priority": "info" | "warn" | "critical",
    "trace_id": "<uuid>",
    "idempotency_key": "<hash>",
    "created_at": "<iso8601>",
    "status": "pending" | "attempting" | "delivered" | "failed" | "rejected" | "dropped" | "acked",
    "retry_count": 0,
    "max_retries": 3,
}
```

## Routing rules (deterministic)

```python
DEFAULT_ROUTES = {
    ("operator", "*"): {
        "channel": "telegram",
        "address": "6776710732",
        "permission": "operator",  # anyone can message operator
    },
    ("browser-organ", "operator"): {
        "channel": "telegram",
        "address": "6776710732",
        "permission": "organ",  # organs can message operator
    },
    ("sentinel-organ", "operator"): {
        "channel": "telegram",
        "address": "6776710732",
        "permission": "organ",
    },
    ("*", "trace-fabric"): {
        "channel": "internal",
        "address": "trace-fabric",
        "permission": "internal",  # any organ can message trace
    },
    # ... add per-organ routes
}
```

When routing is unknown → `a2a_send` returns `status=rejected, reason_code=route_unknown`.

## Delivery semantics

```
attempt:
  1. status = "attempting"
  2. call transport (imsg/telegram/etc.)
  3. on success: status = "delivered", store message_id
  4. on failure: status = "failed", increment retry_count
     if retry_count >= max_retries: status = "dropped"
     else: schedule next attempt (next a2a_check_delivery call)
```

## Internal routing

When `channel=internal`:
- Don't actually transmit (no platform)
- Write to recipient's "inbox" table (or notification queue)
- status = "delivered" immediately
- Recipient can read via its own `*_list_messages` or similar

## Permission tiers

Per `messaging/permission-tiers.js`:
- `operator`: full access (can message anyone)
- `organ`: can message operator + other organs + external if whitelisted
- `external`: can only message operator (or explicitly allowed targets)
- `unknown`: rejected

Unknown senders → status = "rejected", reason_code = "sender_unknown".

## Storage

**SQLite database** at `/Users/dutch/.local/share/concord/a2a-boundary.db`:

```sql
CREATE TABLE a2a_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    channel TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'info',
    trace_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    last_error TEXT,
    delivered_message_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id),
    UNIQUE(idempotency_key)
);

CREATE TABLE a2a_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL,                -- attempting | delivered | failed | rejected | dropped
    channel TEXT NOT NULL,
    transport_response_json TEXT,
    error TEXT,
    trace_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE a2a_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_pattern TEXT NOT NULL,
    recipient_pattern TEXT NOT NULL,
    channel TEXT NOT NULL,
    address TEXT NOT NULL,
    permission_required TEXT NOT NULL DEFAULT 'organ',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sender_pattern, recipient_pattern)
);

CREATE INDEX idx_a2a_messages_status ON a2a_messages(status, created_at);
CREATE INDEX idx_a2a_messages_idem ON a2a_messages(idempotency_key);
CREATE INDEX idx_a2a_deliveries_msg ON a2a_deliveries(message_id);
```

## Integration with F0

Every `a2a_*` tool goes through F0 dispatch:
- `a2a_send` — write (sending message is a write operation)
- `a2a_ack` — write (operator confirms receipt)
- `a2a_check_delivery` — write (triggers retry)
- `a2a_list_*` — read

F0 authority gate must ALLOW all writes. The organ itself doesn't bypass F0.

## Stop list

- Do NOT silently drop messages (always log to a2a_deliveries)
- Do NOT broadcast (operator must explicitly call per-recipient)
- Do NOT execute commands from messages (G is transport only)
- Do NOT auto-retry without bound (max_retries enforced)
- Do NOT bypass F0 authority gate
- Do NOT invoke LLM for routing (deterministic table lookup)

## Daemon-vs-LLM status

A2A Boundary is **purely deterministic**:
- Envelope: dict literal + UUID generation
- Routing: table lookup
- Delivery: subprocess call to imsg/webhook/etc.
- ACK: SQL state transition
- Audit: SQL insert

LLM invocation: zero.

## What's next after G

Once G is built, the next phase (H — Experience-to-learning) handles:
- Long-term memory consolidation
- DTU compression triggers
- Pattern → capability convergence

Then I (Concordia) wraps up the autonomous arc — integration testing, end-to-end demonstrations.

The complete autonomous substrate:
```
WATCH → DETECT → PROPOSE → PREDICT → COMPOSE → SUBMIT → EXECUTE → RECORD
   ↑                                            ↓
   └──── MINE PATTERNS ────→ TEMPLATE → REGISTER
                              ↓
                         A2A: route messages to/from humans/agents
                              ↓
                         Experience → Learning (next)
                              ↓
                         Concordia (final integration)
```

G is the **transport substrate** — every other organ can use `a2a_send` to message the operator, external agents, or other organs with durable delivery proof.