# How to run the Concord Godot client

This is the Godot 4 client for Concord's 3D layer. It talks to the Concord
server over a WebSocket gateway (`/godot-ws`). The server stays authoritative;
Godot renders + simulates locally.

**Honest status:** this project has been validated by `gdparse` + `gdlint`
(syntax/lint clean) and its server-side protocol is proven with a real
WebSocket integration test — but it has **never been opened in a real Godot
editor or rendered a frame** (the build container it was authored in has no
Godot binary and no display). So the steps below are the **first real run**.
Expect to hit a few runtime issues static linting can't catch (typed-array
coercions, a missing InputMap action, etc.) — that's normal and expected for a
first boot; note anything that breaks and it can be fixed quickly.

---

## 1. Get the Godot binary (2 minutes, on your own computer)

A "binary" is just the runnable Godot app itself. Download it — it's free, no
installer, no admin rights:

1. Go to **https://godotengine.org/download**
2. Download **Godot 4.4** (or newer 4.x) for your OS. Pick the **standard**
   build, **NOT** the ".NET / C#" build — this project is GDScript.
3. Unzip it. You get a single Godot app. Double-click to launch.

> The cloud container that built this project can't download Godot (its egress
> is policy-locked — every source returned 403) and has no screen, so this one
> step has to happen on a real machine.

## 2. Open this project

1. In Godot's Project Manager, click **Import**.
2. Navigate to this folder and select **`world-lens-godot/project.godot`**.
3. Open it. Godot will import assets on first load.
4. Run the boot scene (F5, or the Play button). Main scene is
   `scenes/boot.tscn`.

## 3. Point it at a running Concord server

The client connects to the gateway; it needs a server to talk to.

1. Start Concord's server (from repo root): `cd server && npm start`
   (or `npm run dev`). It logs `godot_gateway_mounted {"path":"/godot-ws"}`
   near the end of boot — that confirms the gateway is live.
2. In the Godot client, set the gateway URL (see `world/boot.gd` —
   `gateway_url`, default `ws://127.0.0.1:5050/godot-ws`) to wherever your
   server runs.
3. Auth: the client authenticates with a JWT or API key over the socket
   (first message `{evt:"auth", data:{token:"<JWT>"}}`). For a local test you
   can mint a token the way `server/tests/godot-gateway-integration.test.js`
   does, or log in through the web app and reuse its token.

## 4. What you should see (and what to check)

On a successful boot + connect:
- The client authenticates → receives a `hello` frame.
- It requests the scene (`scene:request`) → receives `scene:data` (the
  `concord-scene/v1` building list from the live world) → instances placeholder
  boxes (or real GLBs where they resolve) at the right transforms.
- Movement: WASD drives a `CharacterBody3D`; the client streams `player:move`
  to the server, which validates it through real anti-cheat and acks/nacks.

**What to report back** (this is the VISUAL_QA handoff — see `VISUAL_QA.md`):
- Does the scene render? Do buildings appear at plausible positions?
- Does the camera orbit / movement feel right?
- Any runtime errors in Godot's Output/Debugger panel (paste them — those are
  the first-boot issues to fix).

## 5. Headless validation (optional, no display needed)

Once you have the binary, you can also run the GDScript unit tests and a
headless import without a screen:

```bash
# from repo root, with godot on PATH:
godot --headless --path world-lens-godot --import   # build .godot/, catch script errors
godot --headless --path world-lens-godot --script world-lens-godot/tests/run_all.gd
```

The `tests/*.gd` suites (chunk streaming, LOD, snapshot interpolation, movement
math, DTU-prop placement) are currently parse-validated only; running them with
a real engine is the next validation tier.

---

## What's real vs. what's coming

**Real now (server-side, headless-proven):** the gateway (bidirectional —
`player:move`/`player:mode`/`room:join`/`scene:request` all round-trip through
server anti-cheat), scene bootstrap from live world data, district geometry,
server-canonical terrain (`/api/worlds/:worldId/terrain-spec`), DTU-props
(`dtu_props.list`/`interact`), the evo-asset resolver.

**Client-side, authored but never rendered:** chunk streaming + LOD +
MultiMesh, the CharacterBody3D controller (jump/glide/swim constants mirrored
from the Three.js client), the snapshot-interpolation buffer, the DTU-prop
renderer. These need a real engine run to validate — that's what this doc
unblocks.

**Not yet built (the migration program):** avatar/skeletal animation, combat
presentation, cameras, full world rendering, and the other lenses' 3D surfaces
are still Three.js-only. Godot is an additive second client today, not a
replacement — porting those to parity and then flipping the default is the
remaining multi-phase effort.
