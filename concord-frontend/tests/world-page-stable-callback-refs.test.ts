// Regression coverage for two unstable-prop-identity bugs in
// components/world/WorldOsSurface.tsx, both found chasing a live "no game, just
// panels" report: the World Lens's WorldEntryOverlay never reached
// `sceneReady` because the page kept re-triggering child effects that
// exist to run once (or on genuine data change), driving React's
// "Maximum update depth exceeded" warning and starving the Three.js render
// loop of main-thread time.
//
// Bug A (the severe one — a real parent<->child feedback loop, not just
// wasted re-renders): `<WalkerNpcInjector onWalkers={(npcs) =>
// setWalkerNpcs(npcs)} />` wrapped the setState setter in a fresh arrow
// function every render. WalkerNpcInjector's own 100ms-interval effect
// depends on `onWalkers` (correctly, from its side) — so every page
// re-render tore down that effect (whose cleanup calls `onWalkers([])` →
// `setWalkerNpcs([])` in the PARENT) and immediately re-ran it (which
// fires an immediate tick → `onWalkers(npcs)` → `setWalkerNpcs(npcs)` in
// the parent again). Each of those parent setState calls triggers another
// page re-render, recreating the arrow function again — a genuine,
// self-sustaining ping-pong loop. Fixed by passing the already-stable
// `setWalkerNpcs` setter directly (React guarantees setState setter
// identity is stable across renders) instead of wrapping it.
//
// Bug B (unstable-prop churn, same class already fixed once on this page
// for `buildingRendererBuildings`/`mergedNpcs` — see the comments at
// those useMemo call sites): `<TerrainRenderer districts={
// deriveTerrainZones(worldBuildings)} lodCenter={{ x: 0, z: 0 }} />` handed
// a fresh array and a fresh object literal to TerrainRenderer on every
// render. Both sit in TerrainRenderer's terrain-build effect dependency
// array, so the effect re-ran on nearly every page render — including
// re-dispatching 'concordia:terrain-ready', which (before a separate fix
// in physics-world.ts) piled up duplicate Rapier heightfield colliders and
// was the root cause of a live WASM crash. Fixed by memoizing `districts`
// on `worldBuildings` and hoisting `lodCenter` to a module-level constant.
//
// The page is too large (9000+ lines) to render in a unit test — this file
// follows the same source-pin convention already used for this page
// elsewhere (see tests/world-page-wind-direction-threading.test.ts,
// tests/power-clusters-layer.test.ts).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx'), 'utf8');

describe('world lens page — stable callback/prop identity into child effects', () => {
  it('passes the setWalkerNpcs setter directly to WalkerNpcInjector, not wrapped in a fresh arrow function', () => {
    const slice = src.slice(src.indexOf('<WalkerNpcInjector'), src.indexOf('<WalkerNpcInjector') + 200);
    expect(slice).toMatch(/onWalkers=\{setWalkerNpcs\}/);
    expect(slice).not.toMatch(/onWalkers=\{\s*\(/); // no inline arrow wrapper
  });

  it('TerrainRenderer\'s districts prop is derived via a useMemo keyed on worldBuildings, not recomputed inline on every pass (structural memoization-shape pin — page.tsx is too large to mount in this suite)', () => {
    expect(src).toMatch(/const terrainDistricts = useMemo\(\s*\(\)\s*=>\s*deriveTerrainZones\(worldBuildings\),\s*\[worldBuildings\]\s*\)/);
    const slice = src.slice(src.indexOf('<TerrainRenderer'), src.indexOf('<TerrainRenderer') + 300);
    expect(slice).toMatch(/districts=\{terrainDistricts\}/);
    expect(slice).not.toMatch(/districts=\{deriveTerrainZones\(/);
  });

  it('hoists TerrainRenderer\'s lodCenter to a stable module-level constant instead of an inline object literal', () => {
    expect(src).toMatch(/^const TERRAIN_LOD_CENTER_ORIGIN = \{ x: 0, z: 0 \};/m);
    const slice = src.slice(src.indexOf('<TerrainRenderer'), src.indexOf('<TerrainRenderer') + 300);
    expect(slice).toMatch(/lodCenter=\{TERRAIN_LOD_CENTER_ORIGIN\}/);
    expect(slice).not.toMatch(/lodCenter=\{\{/);
  });

  // Bug C — the dominant remaining cause once A and B were fixed: found via
  // a live stack-trace capture (a "memory access out of bounds" Rapier WASM
  // crash inside AvatarSystem3D's character-controller registration, plus
  // the World Lens never leaving "Building the world..."). ConcordiaScene's
  // own scene-init effect (which builds the renderer, terrain, lighting,
  // AND the Rapier physics world) depends directly on `onBuildingClick`/
  // `onTerrainClick`. Both were inline arrow functions in this page's JSX
  // — a fresh identity every render — so the ENTIRE 3D engine, physics
  // world included, tore down (destroying the Rapier world) and rebuilt on
  // every single re-render of this page. AvatarSystem3D's own physics
  // registration is a separate, stable, mount-once effect — but it was
  // racing against ConcordiaScene repeatedly destroying and recreating the
  // physics world out from under it, which is what actually corrupted the
  // WASM heap. Fixed by lifting both callbacks to page-level useCallbacks
  // with `[]` deps (reading mutable state through the existing
  // activeDistrictRef/playerAvatarRef mirrors, same pattern already used
  // by handleAvatarMove/handleAvatarEmote for worldSocket.emit).
  it('passes stable useCallback references (not inline arrows) for ConcordiaScene\'s onBuildingClick/onTerrainClick', () => {
    expect(src).toMatch(/const handleConcordiaBuildingClick = useCallback\(/);
    expect(src).toMatch(/const handleConcordiaTerrainClick = useCallback\(/);
    // `<ConcordiaScene` alone also matches an unrelated earlier code comment
    // mentioning the component by name — anchor on the JSX opening tag's
    // own newline so this finds the real mount site.
    const mountIdx = src.indexOf('<ConcordiaScene\n');
    const slice = src.slice(mountIdx, mountIdx + 2000);
    expect(slice).toMatch(/onBuildingClick=\{handleConcordiaBuildingClick\}/);
    expect(slice).toMatch(/onTerrainClick=\{handleConcordiaTerrainClick\}/);
    expect(slice).not.toMatch(/onBuildingClick=\{\s*\(/);
    expect(slice).not.toMatch(/onTerrainClick=\{\s*\(/);
  });

  it('handleConcordiaBuildingClick/handleConcordiaTerrainClick have empty dependency arrays (identity never changes across renders)', () => {
    const bSlice = src.slice(src.indexOf('const handleConcordiaBuildingClick'), src.indexOf('const handleConcordiaBuildingClick') + 700);
    expect(bSlice).toMatch(/\}, \[\]\);/);
    const tSlice = src.slice(src.indexOf('const handleConcordiaTerrainClick'), src.indexOf('const handleConcordiaTerrainClick') + 100);
    expect(tSlice).toMatch(/useCallback\(\(\) => \{\}, \[\]\)/);
  });

  // Bug D — the same class of bug as Bug A above (WalkerNpcInjector), found
  // independently while chasing a live "improved character assets never
  // show up" report: `<ProcgenSettlementNpcs onSettlementNpcs={(npcs) =>
  // setProcgenNpcs(npcs)} />` wrapped the setter in a fresh arrow function
  // every render. ProcgenSettlementNpcs' own effect depends on
  // `onSettlementNpcs` (correctly, from its side) and calls it inside the
  // effect body — so every page re-render tore the effect down and
  // immediately re-ran it, which called the (new) `onSettlementNpcs` again,
  // triggering another parent re-render. Confirmed live via a temporary
  // diagnostic log: the NPC-mesh-building loop in AvatarSystem3D was
  // restarting mid-loop roughly every 0.5s (236 restarts logged in 120s),
  // always dying after the first NPC — which meant NPCs 2+ never got a
  // chance to load ANY mesh, real or procedural. Fixed the same way as Bug
  // A: pass the stable `setProcgenNpcs` setter directly.
  it('passes the setProcgenNpcs setter directly to ProcgenSettlementNpcs, not wrapped in a fresh arrow function', () => {
    const idx = src.indexOf('<ProcgenSettlementNpcs');
    expect(idx).toBeGreaterThan(-1);
    const slice = src.slice(idx, idx + 200);
    expect(slice).toMatch(/onSettlementNpcs=\{setProcgenNpcs\}/);
    expect(slice).not.toMatch(/onSettlementNpcs=\{\s*\(/);
  });

  // Bug E — the root cause blocking NPCs/buildings/nodes/loot-bags/quests/
  // events from ever showing real data: `fetch('/api/worlds/${
  // activeDistrict.id}/...')` calls used `activeDistrict.id`, which is
  // initialized to DEMO_DISTRICT ('district-demo-001') and never updated —
  // no code anywhere reads the `?district=` URL param or otherwise changes
  // it. Every one of these fetches was hitting a permanently-empty
  // placeholder world instead of the real `currentWorldId`
  // ('concordia-hub'). Confirmed live: the client-side NPC count went from
  // stuck at 0 (forever) to 130+ once fixed.
  it('fetches NPCs, buildings, resource nodes, loot bags, quests, and events by currentWorldId, not the permanently-stuck DEMO_DISTRICT activeDistrict.id', () => {
    const dataFetchPaths = ['npcs', 'buildings', 'nodes', 'loot-bags', 'quests', 'events'];
    for (const path of dataFetchPaths) {
      const re = new RegExp('`/api/worlds/\\$\\{currentWorldId\\}/' + path.replace('-', '\\-'));
      expect(src, `expected a currentWorldId-scoped fetch for /${path}`).toMatch(re);
    }
    // The bug pattern must not remain for any of these paths.
    for (const path of dataFetchPaths) {
      const re = new RegExp('`/api/worlds/\\$\\{activeDistrict\\.id\\}/' + path.replace('-', '\\-'));
      expect(src, `did not expect a stale activeDistrict.id fetch for /${path}`).not.toMatch(re);
    }
  });

  // Bug E follow-up (2026-07-20) — Bug E's initial fix only covered the ten
  // core data-loading effects; a live report ("Concordia is supposed to be
  // triple A... do the 60+ places too") named dozens of MORE call sites on
  // this page passing the identical broken `activeDistrict.id` /
  // `activeDistrict?.id || 'concordia-hub'` / `activeDistrict?.id ||
  // currentWorldId` pattern as the `worldId`/`cityId`/`districtId` prop into
  // ~50 different HUD/game components (VillageGossipFeed, FestivalBanner,
  // ClimbingTracker, QuestPanel, SkillsPanel, ChatSystem, and many more) —
  // every one of them was silently receiving the permanently-empty demo
  // placeholder instead of the real world. The two `|| currentWorldId` /
  // `|| 'concordia-hub'` fallback patterns never actually fell through
  // either, since `activeDistrict.id` is always a non-empty string. Swept
  // ALL remaining occurrences (79 at fix time) to `currentWorldId`,
  // preserving the legitimate, unrelated uses of `activeDistrict` as a
  // whole object (the 2D district editor's own local/demo building+terrain
  // model — DistrictViewport, InspectorPanel, `activeDistrict.buildings`,
  // `activeDistrict.terrain`) which this fix does not touch.
  it('has swept every activeDistrict.id / activeDistrict?.id worldId-scoping usage to currentWorldId', () => {
    expect(src).not.toMatch(/activeDistrict\.id/);
    expect(src).not.toMatch(/activeDistrict\?\.id/);
  });

  it('still uses activeDistrict as a whole object for the unrelated 2D district editor (buildings/terrain/name) — this fix did not remove that model', () => {
    expect(src).toMatch(/activeDistrict\.buildings/);
    expect(src).toMatch(/activeDistrict\.terrain/);
    expect(src).toMatch(/const \[activeDistrict, setActiveDistrict\] = useState<District>\(DEMO_DISTRICT\);/);
  });

  // The player-facing world display name (loading overlay, HUD header,
  // in-world map) was reading `activeDistrict.name` — literally 'Pioneer
  // Valley', DEMO_DISTRICT's hardcoded seed name — so the game displayed a
  // fake placeholder name as if it were the real active world's name for
  // the entire session. Fixed to derive a real label from the theme
  // registry (CONCORDIA_THEMES[themeId].label) keyed off the same
  // world-id resolution the sky/lighting theme already uses correctly.
  it('derives the displayed world name from the theme registry instead of DEMO_DISTRICT\'s hardcoded seed name', () => {
    expect(src).toMatch(/const currentWorldDisplayName =\s*\n\s*CONCORDIA_THEMES\[concordiaTheme\]\?\.label \|\| activeDistrict\.name;/);
    expect(src).toMatch(/worldName=\{currentWorldDisplayName\}/);
    expect(src).not.toMatch(/worldName=\{activeDistrict\.name\}/);
  });

  // HUD-declutter fix: lens-portal building markers (Recording Studio,
  // Architect's Office, Research Library, ~19 of them in concordia-hub
  // alone) rendered unconditionally for every portal in the world, all
  // stacked in the viewport center via the same crude 2D-approximation
  // math regardless of the player's actual position — live screenshots
  // showed a dozen overlapping building icons on top of each other. The
  // NPC overlay just below in the same file already distance-culls
  // (`if (dist > 20) return null`); the portal loop had no equivalent
  // check at all.
  it('distance-culls lens portal markers the same way the NPC overlay below it already does', () => {
    const start = src.indexOf('{portals.map((portal) => {');
    const slice = src.slice(start, start + 900);
    expect(slice).toMatch(/portalDist\s*=\s*Math\.sqrt\(portalDx \* portalDx \+ portalDy \* portalDy\)/);
    expect(slice).toMatch(/if \(portalDist > 10 && !isNearby\) return null;/);
  });

  // Plan Phase 1d (docs plan modular-zooming-snowglobe.md): the Camera Mode
  // panel's zoom slider rendered as fully live — draggable, with a moving %
  // readout — but was wired to a real no-op (`onZoom={() => {}}`), so
  // dragging it never actually changed the camera. Fixed by real cameraZoom
  // state threaded into ConcordiaScene's dist/height calc via
  // lib/world-lens/camera-zoom.ts#zoomToDistScale (unit-tested separately in
  // tests/lib/camera-zoom.test.ts — this file only pins the wiring, since
  // ConcordiaScene's render loop can't be unit-rendered here).
  it('wires the Camera Mode zoom slider to real state instead of a no-op handler', () => {
    const start = src.indexOf('{/* Camera mode controls */}');
    const slice = src.slice(start, start + 700);
    expect(slice).toMatch(/zoom:\s*cameraZoom,/);
    expect(slice).toMatch(/onZoom=\{setCameraZoom\}/);
    expect(slice).not.toMatch(/onZoom=\{\(\)\s*=>\s*\{\}\}/);
  });

  it('declares cameraZoom state seeded from DEFAULT_CAMERA_ZOOM and passes it into ConcordiaScene', () => {
    expect(src).toMatch(/const \[cameraZoom, setCameraZoom\] = useState\(DEFAULT_CAMERA_ZOOM\);/);
    const start = src.indexOf('<ConcordiaScene\n');
    // R7 — widened from 400: the `quality` prop right after `districtId`
    // grew a multi-line explanatory comment (why it's passed as `undefined`
    // rather than always a concrete QualityPreset — see quality-preset.ts's
    // hasStoredQualityPreset), pushing `cameraZoom={cameraZoom}` past the
    // old fixed window. This is an arbitrary slice bound, not a load-bearing
    // one — widen it rather than trim a comment that documents a real bug
    // fix.
    const slice = src.slice(start, start + 900);
    expect(slice).toMatch(/cameraZoom=\{cameraZoom\}/);
  });

  // Plan Phase 1c (docs plan modular-zooming-snowglobe.md): HUDOverlay's
  // bottom bar hardcoded currency={concordCoin:0}, reputationLevel=1,
  // timeOfDay="day", weather="clear" — all rendered as if live regardless
  // of real player/world state. Fixed by wiring real sources already
  // available on this page (useHUDContext's socket-driven worldDaySegment,
  // the page's own real weatherData from the `weather:update` socket
  // event, and the new shared useWalletBalance hook) or, where no real
  // signal exists (reputationLevel/professionBadge), omitting the props
  // entirely so HUDOverlay hides that sub-block rather than fabricate it.
  it('wires HUDOverlay time/weather/currency to real sources instead of hardcoded literals', () => {
    const start = src.indexOf('<HUDOverlay\n');
    const slice = src.slice(start, start + 500);
    expect(slice).toMatch(/timeOfDay=\{worldDaySegmentForHud\.charAt\(0\)\.toUpperCase\(\)/);
    expect(slice).toMatch(/weather=\{weatherTypeToIcon\(weatherData\?\.type\)\}/);
    expect(slice).toMatch(/currency=\{\{ concordCoin: walletBalanceForHud, pendingRoyalties: 0 \}\}/);
    expect(slice).not.toMatch(/timeOfDay="day"/);
    expect(slice).not.toMatch(/weather="clear"/);
    expect(slice).not.toMatch(/concordCoin:\s*0[,}]/);
    expect(slice).not.toMatch(/professionBadge=""/);
    expect(slice).not.toMatch(/reputationLevel=\{1\}/);
  });

  it('hides the three unbacked resource bars (Mana/Bio Power/Perception), keeping only real HP/Stamina', () => {
    const start = src.indexOf('{/* Resource Bars HUD');
    const slice = src.slice(start, start + 900);
    expect(slice).toMatch(/key:\s*'hp'/);
    expect(slice).toMatch(/key:\s*'stamina'/);
    expect(slice).not.toMatch(/key:\s*'mana'/);
    expect(slice).not.toMatch(/key:\s*'bio_power'/);
    expect(slice).not.toMatch(/key:\s*'perception'/);
    expect(slice).not.toMatch(/: 100;/);
  });

  // Plan Phase 1a (docs plan modular-zooming-snowglobe.md): ~15 overlay
  // mounts were missing the hudHidden gate ~13 other mounts already used,
  // so pressing H ("hide HUD") left them all on screen. Pins the 6 named
  // in the plan; the manual escape-hatch layers on top of each element's
  // own mode/data self-gating, never replaces it.
  it('gates the NPC nametag overlay loop on hudHidden', () => {
    const start = src.indexOf('{/* NPC interaction overlays');
    const slice = src.slice(start, start + 500);
    expect(slice).toMatch(/\{!hudHidden && rawWorldNPCs\.map\(\(npc\) => \{/);
  });

  it('gates MaterialAvailability, WalkerArbitrageMap, ZoneBadge, DistrictActivityFeed, and EcosystemMetricsBadge on hudHidden', () => {
    expect(src).toMatch(/\{!hudHidden && <ConcordiaHUD\.MaterialAvailability \/>\}/);
    expect(src).toMatch(/\{!hudHidden && <WalkerArbitrageMap worldId=\{currentWorldId\} \/>\}/);
    expect(src).toMatch(/\{!hudHidden && <ZoneBadge worldId=\{currentWorldId\} \/>\}/);
    expect(src).toMatch(/\{!hudHidden && <EcosystemMetricsBadge worldId="concordia-hub" \/>\}/);
    const start = src.indexOf('{/* District activity feed');
    const slice = src.slice(start, start + 400);
    expect(slice).toMatch(/\{!hudHidden && \(/);
  });

  // Plan Phase 1b (docs plan modular-zooming-snowglobe.md): three
  // overlapping tutorial systems ran in parallel on this page —
  // FirstRunTour's "1/3, 2/3, 3/3" coachmark, a 9-step fullscreen
  // OnboardingTutorial modal, and TutorialHint's tiny-toast TutorialOverlay
  // (already listening to the same concordia:tutorial-action events as
  // OnboardingTutorial, running two independent step machines off one
  // event stream). TutorialOverlay survives; the other two mounts are
  // removed from this page. FirstRunTour's component FILE is untouched —
  // confirmed via grep it's shared, load-bearing infrastructure for ~200
  // other lens pages (manifest-driven, not World-specific) — only its
  // mount here is gone.
  it('no longer mounts FirstRunTour or OnboardingTutorial on the World Lens page', () => {
    expect(src).not.toMatch(/<FirstRunTour lensId="world"/);
    expect(src).not.toMatch(/<OnboardingTutorial/);
    expect(src).not.toMatch(/import\s*\{\s*FirstRunTour\s*\}\s*from\s*'@\/components\/lens\/FirstRunTour'/);
    expect(src).not.toMatch(/import OnboardingTutorial from/);
    // TutorialOverlay (the survivor) is still mounted.
    expect(src).toMatch(/\{!hudHidden && <TutorialOverlay \/>\}/);
  });

  it('removes the showOnboarding state machine and mounts PostTutorialHints unconditionally', () => {
    expect(src).not.toMatch(/const \[showOnboarding, setShowOnboarding\]/);
    expect(src).not.toMatch(/handleOnboardingComplete/);
    expect(src).toMatch(/<PostTutorialHints \/>/);
    expect(src).not.toMatch(/\{!showOnboarding && <PostTutorialHints/);
  });
});
