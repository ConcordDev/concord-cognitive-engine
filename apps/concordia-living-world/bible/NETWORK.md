# NETWORK

**Status:** LIVE (mount + kingdom snapshot) · PARTIAL (needs a listening server)  
**Authority:** Concord  
**Source:** `ConcordClient.cs`; `server/lib/unity-bridge.js`; `server/lib/godot-gateway.js`; `server/lib/concordia-kingdom-snapshot.js`; `server.js` Unity mount

`/unity-ws` is a real `mountGodotGateway` path. Events: auth, hello, scene:request, **kingdom:request**, player:move, combat:attack.

`kingdom:data` is `concord-kingdom/v1` from authored `content/world` — never invented settlements. Caravans/tariffs on that snapshot stay empty until persist-sync; Unity `WorldMemory` holds the live rows.

Kitchen/Editor may auth as `unity-local-guest` when `NODE_ENV !== production`. Production still needs a real bearer. Offline play stays `{ok:false, reason:'no_gateway'}`.

TARGET: same validation as socket.io combat. Honest disconnect. No second physics.
