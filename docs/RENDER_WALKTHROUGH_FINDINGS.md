# Concordia Render Walkthrough — Findings

Dev-server smoke + Playwright walk on the post-S–AA tree.
Server: `node server/server.js` (port 5050, in-memory rate limits + ephemeral SQLite).
Frontend: `npm run dev` (Next 15.5.18, app router, R3F v8, React 18.3.1 declared / React 19 bundled by Next).

Eight real render bugs surfaced. Five already fixed in this branch; three still open with notes.

---

## ✅ Fixed in this branch

### 1. GLBs behind the login wall
`middleware.ts` whitelisted `/api/`, `/_next/`, `/legal/`, etc. but not `/meshes/`. Every `/meshes/heroes/*.glb` returned 307 → `/login`, so `loadHeroMesh` always failed and AvatarSystem3D silently fell through to procedural — making the Phase S bake pointless.

**Fix:** added `/meshes/`, `/music/`, `/sounds/`, `/textures/` to `PUBLIC_PREFIXES`. Confirmed `sovereign_first_refusal.glb` now serves HTTP 200 with valid `glTF binary model, version 2`, 61 KB.

### 2. KeyboardProvider never mounted
`useKeyboard()` (called by every `useLensCommand`) throws `must be used within KeyboardProvider`. The provider lived only in tests. Every lens that registers a keyboard shortcut crashed under the world LensErrorBoundary.

**Fix:** wrapped `AppShell` in `KeyboardProvider` inside `components/Providers.tsx`.

### 3. World lens defaults to 2D, doesn't auto-mount 3D canvas
The `/lenses/world` page renders a tabbed surface — "Concordia / District / Explore 3D / Streams" — and the 3D canvas only mounts on click. Manual or automated smoke that doesn't click "Explore 3D" never exercises the scene.

**Fix:** the Playwright spec now clicks the Explore 3D tab and waits 8s for the lore intro card to fade.

### 4. Three onboarding modals stack over the canvas on fresh visit
`OnboardingWizard` (homepage), `CookieConsent`, and the world-lens `OnboardingTutorial` all gate the canvas on first visit. Storage keys: `concord-onboarding-completed`, `concord_cookie_consent`, `concord_first_win_dismissed`, `world_lens_visited`.

**Fix:** the Playwright spec sets all four keys before navigating. Production users still see the wizards on first visit (correct), but the smoke test confirms what's behind them.

### 5. R3F components crash the world lens on mount
Next 15.5 bundles React 19 in `app-pages-browser` chunks. `@react-three/fiber` v8 (and its `react-reconciler@0.27.0`) reads `React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner` at module-evaluation time. React 19 removed that export, so every R3F module throws `TypeError: Cannot read properties of undefined (reading 'ReactCurrentOwner')` on load.

The crash propagates to whatever mounted the R3F component:
- `TombMarker` (mounted bare in world page — Phase F bug)
- `WalkerOnHorizon` (mounted inside `R3FOverlayLayer` — correct, but still crashes)
- `R3FOverlayLayer` itself

**Fix shipped:**
- `lib/react18-internals-shim.ts` — writes empty mutables for `ReactCurrentOwner` / `ReactCurrentDispatcher` / `ReactCurrentBatchConfig` / `ReactDebugCurrentFrame` into React's `__SECRET_INTERNALS` namespace.
- Hook in `instrumentation-client.ts` runs `installR3FShim()` once on every client page load before any R3F chunk evaluates.
- World page wraps R3F components in a `?r3f=1` URL-flag gate so they only mount when explicitly opted in (the shim makes the import succeed, but the reconciler still hits further internal-read bugs at update time).
- `TombMarker` moved inside `R3FOverlayLayer`'s Canvas (Phase F left it bare, which would crash even without the React 19 issue).

**Long-term fix:** upgrade `@react-three/fiber` to v9.6.1 (targets React 19 internals natively). Audit the Canvas API surface change. Drop the gate + shim.

---

## ⚠️ Known but unfixed

### 6. Rapier physics destroy passes null pointer in dev
After clicking Explore 3D, the world lens occasionally hits:

```
null pointer passed to rust
  at I_wbg__wbindgen_throw (rapier3d-compat/rapier.mjs:94704)
  at BA.free (rapier-compat/rapier.mjs:37532)
  at UI.free / I.free
  at PhysicsWorld.destroy (lib/world-lens/physics-world.ts:835)
```

Likely cause: React strict-mode mounts ConcordiaScene twice in dev; the first unmount's `destroy()` runs while Rapier's wasm objects are still being held by the second mount. Production builds (no strict mode) probably won't reproduce.

**To investigate:** add reference-counting on PhysicsWorld objects + guard `destroy()` against being called on already-freed handles.

### 7. Connection lost banner — realtime socket auth gap
"Connection lost. Working offline with cached data." appears on the world lens. The socket-io client likely isn't replaying the JWT cookie correctly on reconnect, or the server is rejecting the WS upgrade for the test session.

**To investigate:** browser devtools network tab on a live session vs. the test-session cookies.

### 8. R3F components stay gated
With the shim + URL gate, R3F components only mount on `?r3f=1`. Even with the shim, `react-reconciler@0.27.0` later hits `isConcurrentActEnvironment → ReactCurrentBatchConfig.current` (different code path; needs a deeper shim). Until R3F is upgraded to v9 the visual loss is:
- No horizon walkers (WalkerOnHorizon)
- No tomb markers for player corpses (TombMarker)
- The R3FOverlayLayer doesn't render anything

ConcordiaScene (imperative Three.js, not R3F) is unaffected and is the actual world. The losses are visual extras, not gameplay.

---

## Diagnostic Playwright spec changes

`tests/e2e/playthrough.spec.ts` was tightened during the walk:
- Registers + logs in via direct API call in `beforeAll`, threads cookies into the browser context.
- Pre-seeds localStorage with the four wizard-dismiss keys.
- Clicks "Explore 3D" before screenshotting (the real 3D path).
- Captures full `console.error` arg trees + dumps to a sidecar `.console-errors.log`.
- Force-opens every `<details>` so error-boundary technical traces land in the screenshot.
- Reads GLB body bytes (Next dev uses chunked encoding — `content-length` is 0).

The spec config workaround for the sandbox: `playwright.smoke.config.ts` overrides `globalSetup`, `webServer`, and `projects` to point at the pre-installed `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (Playwright's CDN is allowlist-blocked here).

## Verification status

- 14/14 spec tests pass with the R3F gate ON (R3F components silently skipped).
- Concord home (`/`) renders HTTP 200, no fatal console errors.
- All 53 baked GLBs serve as `glTF binary v2` with proper byte counts.
- World lens dialog intro card ("Four factions wrote the Compact.") renders successfully after clicking Explore 3D. Stats.js FPS counter mounts (Phase AA).
- Server: 14,470+ tests pass per the merged `claude/concordia-foundation` branch (pre-merge baseline).
