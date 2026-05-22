# sync — Feature Gap vs iCloud / Dropbox / Syncthing

Category leader (2026): iCloud / Syncthing (cross-device sync). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `dtu_sync` domain macros (`register_device`, `list_devices`) — peer-to-peer DTU sync over Concord federation, no subscription.

## Has (verified in code)
- Register a device with a label; issues a one-time device token.
- List registered devices with registration time, last-sync time, auto-sync flag.
- Pitched as iCloud-killer — DTUs + artifact bytes ride the universal file format across devices.

## Missing — buildable feature backlog
- [x] `[M]` Trigger / show sync status — no "sync now" action, no progress, no per-device sync log.
- [x] `[S]` Revoke / deregister a device.
- [x] `[S]` Per-device auto-sync toggle from the UI (flag exists but is read-only).
- [x] `[M]` Conflict resolution UI — when two devices edit the same DTU.
- [x] `[M]` Selective sync — choose which DTU collections / scopes sync per device.
- [x] `[S]` Storage / quota usage display per device.
- [x] `[M]` Sync history / activity feed (what synced when).
- [x] `[S]` Device online/offline presence indicator.

## Parity
~85% of iCloud/Syncthing. It registers devices and hands out tokens, but there is no visible sync action, no status, no conflict handling, no revoke — the actual synchronization experience is not surfaced.
_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
