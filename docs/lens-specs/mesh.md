# mesh — Feature Gap vs Meshtastic / Briar

Category leader (2026): Meshtastic (off-grid mesh networking) / Briar (resilient P2P messaging). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `mesh` macros in server.js — status, topology, channels, send, pending, stats, relay, peers, transfer, sync — over `server/lib/concord-mesh.js`.

## Has (verified in code)
- 7-transport substrate — Internet / WiFi / BLE / LoRa / RF-Ham / Telephone / NFC routing of DTU frames
- Status tab — mesh health, transport availability
- Channels tab — per-transport channel listing
- Peers tab — connected peer list
- Transfers tab — pending DTU transfers
- Send / relay / transfer / sync macros for frame routing; MeshRepos component

## Missing — buildable feature backlog
- [ ] `[M]` Mesh map / topology visualization — graph of nodes and active links
- [ ] `[M]` Direct messaging over mesh — person-to-person chat with delivery/read state
- [ ] `[S]` Per-transport signal/quality metrics — RSSI, hop count, latency
- [ ] `[M]` Store-and-forward queue management — inspect, retry, prioritize pending frames
- [ ] `[S]` Channel encryption / key management — per-channel PSK config
- [ ] `[M]` Broadcast / group channels — multicast to a named group
- [ ] `[S]` Node naming & presence — friendly names, last-seen, online indicators
- [ ] `[S]` Range / coverage estimate per transport

## Parity
~45% of a Meshtastic/Briar surface. The 7-transport routing substrate is genuinely novel and the status/channels/peers/transfers surface is real, but missing topology visualization, direct messaging, signal-quality metrics, and encryption management that make a mesh network usable as a comms tool.
