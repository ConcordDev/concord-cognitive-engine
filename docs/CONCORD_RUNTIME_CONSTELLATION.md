# Concord Runtime constellation

Sister systems are Concord domains on the existing Runtime kernel — not
add-ons and not a second process. They register through the same
`registerCapability()` contract Predict already uses.

```
Dila → Predict → Pentester → DTU → Zuko → Trading → Concordia
```

The event bus (`server/lib/runtime/event-bus.js`) is the connection.
Domains publish (`market.observed`, `trade.executed`, `finding.created`,
`agent.task.*`, `constellation.observed`). They do not grant each other
authority. **Health ≠ authorization.**

## What this pass ships

| Domain | Capabilities | What is real | What stays locked |
|---|---|---|---|
| Dila | `dila.status`, `dila.observation`, `dila.capabilities`, `agent.dila` | Capability index + observation snapshot from committed runtime libs | Dila is an agent, not the Runtime |
| Zuko | `zuko.status/observe/evaluate`, `agent.zuko`, `zuko.execute` | Read-only `~/.zuko` (auth stripped) | `zuko.execute` — no Kalshi orders |
| Trading | `trading.status/observe/evaluate/execute` | Read-only Dila AutoTrader / PPO home | `trading.execute` — does not bypass PPO safety |
| Pentester | `pentester.status/scope/authorize/labHealth/execute` | Lab-only scope + optional localhost port presence | `pentester.execute` — no exploits, no off-lab targets |
| Concordia | `concordia.status/world/simulation/asset` | In-repo Three.js / Godot / Unity + `content/world` | Does not invent a running scene |
| Constellation | `constellation.status/observe` | Aggregate health + observe cycle | Does not elevate any domain |

Homes are resolved by `server/lib/runtime/sister-homes.js` and are
**never copied into git**. Missing homes return `{ present:false,
reason:'not_present' }`. Override with `CONCORD_DILA_TRADING_HOME`,
`CONCORD_ZUKO_HOME`, `CONCORD_CYBER_RANGE_HOME`.

Operator surface: `/lenses/ops-telemetry` mounts
`RuntimeConstellationPanel`. Admin route: `GET /api/runtime/constellation`.

Heartbeat `constellation-observe-cycle` (frequency 20) publishes
`market.observed` from the on-disk traders. It never places an order.

## Tests

```
cd server && node --test tests/runtime/sister-constellation.test.js
```
