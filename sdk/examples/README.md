# Concord SDK Examples

Each example is a standalone TS file that exercises one capability through `@concord/sdk`.

| Example | What it shows |
|---|---|
| `link-send.ts` | Send a Concord Link courier message and subscribe to delivery / interception events |
| `dtu-citation.ts` | Fork an existing DTU with auto-citation, then publish to the marketplace (royalties cascade) |
| `lens-macro.ts` | Run macros across multiple domains (agriculture, council, intelligence) |
| `mesh-peer.ts` | Discover BLE / WiFi-Direct peers and sync a DTU through the conflict-resolved mesh |
| `presence-stream.ts` | Subscribe to live world presence + combat events for a recording rig or dashboard |

## Setup

```bash
cd sdk
npm install
npm install --save-dev tsx socket.io-client
export CONCORD_API_KEY=csk_your_key
export CONCORD_BASE_URL=http://localhost:5050   # or https://concord-os.org
```

## Run

```bash
npx tsx examples/lens-macro.ts
npx tsx examples/dtu-citation.ts
npx tsx examples/link-send.ts
npx tsx examples/presence-stream.ts
npx tsx examples/mesh-peer.ts
```

## Auth

Two auth modes are supported:

* **API key** (`csk_...`) — generate via the Settings → API Keys page or `POST /api/keys`. Best for server-side scripts.
* **JWT** — pass the JWT after browser login. Best for user-context calls (lens runs that need the user's library).

Pass either as the first argument to `new ConcordClient(...)`. The client auto-detects format.

## Realtime

Examples that subscribe to events (`link-send`, `presence-stream`) require `socket.io-client`. The SDK lazy-loads it so the rest of the surface works without it.
