# Engine RPC transport — SXE-51 (CI scope)

The authenticated transport between ConKay and a
compute host, built in the CI-only scope of the founder
F1 ruling (2026-11-18). Code:
`server/lib/conkay/engines/rpc.js` (on the SXE-00
framework). The H2 host provisioning itself is this
ticket's deferred-open remainder: no host is stood up,
nothing installs on the prod Mac, and until an endpoint
is configured every heavy engine answers NOT_COMPUTED
`engine_unavailable` on prod — honest absence.

## Contract

- **Client** `runRemoteEngine(engineId, op, request)` —
  returns the SXE-00 result shape on every path. On
  success the body is the host's `runProcessKernel`
  result verbatim (status, outputs, provenance) with
  `via: "engine-rpc"` stamped.
- **Host** `createEngineHost({ token, maxQueue })` — an
  http.Server (caller binds it) serving POST /run for
  the engines registered in the host process's manifest
  registry, dispatching through the same
  `runProcessKernel`. CI binds loopback; H2 will bind
  its provisioned interface.
- **Authentication is mandatory.** The host throws
  without a token; the client never sends an
  unauthenticated call; a rejection is
  `engine_rpc_auth_failed:<id>` — a configuration error,
  never confused with absence. Token comparison is
  timing-safe.
- **Queue.** Heavy runs serialize on the host, FIFO,
  one at a time (the ticket's behavioural contract). A
  call whose run cannot START within its declared
  `queueTimeoutMs` is refused
  `engine_rpc_queue_timeout:<id>` naming the budget,
  and the run never executes late. A full queue refuses
  as absence with the reason named.
- **Removal.** An engine the host does not carry
  answers `engine_unavailable:<id>` (HTTP 404) — the
  ticket's adversarial leg: removal is a refusal, never
  a crash.

## Configuration

Env only; the SXE-00 manifest shape is untouched.

- `CONKAY_ENGINE_<ID>_RPC_URL` — per-engine endpoint
  (id uppercased, dashes as underscores).
- `CONKAY_ENGINE_RPC_TOKEN` — the shared bearer token,
  required on client and host.

## CI lane

`server/tests/conkay/engines/engine-rpc.test.js` —
hermetic, loopback-only: round-trip health + compute
against a fixture kernel through the real
`runProcessKernel`; the no-endpoint absence posture;
auth failures named (wrong token, missing token); the
removed-engine refusal; FIFO serialization proven by
the fixture's start/end markers; the queue-timeout
refusal proven with the timed-out run never executing.
The heavy engines' own lanes (SXE-52..54) are
manual-dispatch workflow lanes under the F8 ruling.

## Replay

Walker: with no endpoint configured (prod today),
`conkay_engine_list` shows the heavy engines
present=false and any engine-tier solver call returns
NOT_COMPUTED `engine_unavailable` — the F1 posture.
The transport's positive path replays in CI, not on
prod, until H2 is provisioned and SXC-24 verifies.
