# NETWORK

**Status:** WIRED-BUT-UNUSED  
**Authority:** Concord  
**Source:** `ConcordClient.cs`; `server/lib/unity-bridge.js`; `server/lib/godot-gateway.js`; `server.js` ~70823

`/unity-ws` aliases Godot gateway. Events: hello, scene:request, player:move, combat:attack, portal enter/exit.

Runtime 2026-09-01: `Connected=false`.

TARGET: same validation as socket.io combat. Honest disconnect. No second physics.
