# Mesh lens — capability map (Wave 3 verify-pass, 2026-07-11)

## What this lens actually is

Off-grid mesh networking (Meshtastic + Briar parity): a 7-transport DTU
routing substrate (`server/lib/concord-mesh.js`) surfaced through two disjoint
macro sets — see below — and a comms-tool UI (topology graph, direct/group
messaging with delivery+read state, per-transport signal metrics,
store-and-forward queue management, encrypted group channels).

## Prior fix already landed (found during this audit, not new)

`server/domains/mesh.js` header documents a "Phase 4.14 wire-the-Lost" fix:
the file used to register through a legacy convention and was never imported
by `server.js`, so every `mesh.*` domain macro (`meshMap`/`addNode`/
`sendMessage`/`signalMetrics`/…) hit `unknown_macro` and all 5 lens components
were dead-wired. Already fixed — now registered through the canonical
`register` (MACROS) path via a documented shim.

## Two disjoint macro sets — verified intentional, not a naming collision

`server.js` registers 10 inline macros reading the SAME shared substrate
(`status`, `topology`, `channels`, `send`, `pending`, `stats`, `relay`,
`peers`, `transfer`, `sync`) — these are lower-level DTU-transport primitives
(e.g. `mesh.send` routes an actual DTU through the mesh with proximity/priority
options; `mesh.transfer` initiates multi-path "consciousness transfer" of DTU
components; `mesh.sync` plans offline sync). `server/domains/mesh.js` registers
18 disjointly-named macros (`meshMap`, `addNode`, `listNodes`, `pingNode`,
`removeNode`, `sendMessage`, `conversation`, `markRead`, `signalMetrics`,
`coverage`, `queueList`, `queueRetry`, `queuePrioritize`, `queueDrop`,
`createChannel`, `listChannels`, `setChannelKey`, `deleteChannel`, `overview`)
— the comms-tool usability layer this lens's UI actually calls. The domain
file's own header comment documents this split explicitly ("NAME-COLLISION
NOTE... verified by grep at fix time") — a deliberate, documented layering,
not an accidental duplicate registration.

All 18 domain-file macros (+ `overview`) have a real UI caller — confirmed via
grep across `app/lenses/mesh/page.tsx` + all 5 `components/mesh/*.tsx` files.

## Deferred, documented gap (not fixed this pass)

None of the 10 inline substrate macros (`send`/`transfer`/`sync`/`relay`/
`stats`/`pending`/`status`/`topology`/`channels`/`peers`) are called from
ANYWHERE in the frontend — not just this lens. `mesh.send` in particular ("send
a DTU through the mesh with automatic routing") is arguably the single most
mesh-lens-defining capability given the header's own framing ("7-transport DTU
routing"), yet no UI anywhere lets a user actually send a DTU over the mesh —
`MeshMessaging`'s `sendMessage` is a text-chat feature, not a DTU-transport one.

Triaged **ENGINEERING** (real backend capability, no external dependency, just
needs a UI): building it properly needs a DTU picker + destination-node
selection (sourced from `listNodes`) + priority/proximity controls — a
distinctly-scoped feature, not a same-shape fix like the ledger/literary
drill-downs this session. Deliberately deferred rather than rushed. Flagging
for a future Wave 4 gap-closure pass.

## Verification (all run directly, 2026-07-11)

- `npx eslint app/lenses/mesh/page.tsx components/mesh/*.tsx` — clean, 0 issues.
- `npx vitest run tests/mesh-lens-states.test.tsx` — **4/4 passing**.
- `node --test server/tests/mesh-domain-macros.test.js server/tests/mesh-domain-parity.test.js server/tests/depth/mesh-behavior.test.js` — **39/39 passing**.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — `mesh`: `tier:"polished"`, `isGenericScaffold:false`, `bespokeRatio:0.782`. `audit/` reverted afterward.
- No code changes made — this was a verify-pass with one honestly-documented deferred gap.
