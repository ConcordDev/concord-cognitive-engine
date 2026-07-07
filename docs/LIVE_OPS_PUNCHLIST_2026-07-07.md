# Live Ops / UX Punch List — 2026-07-07

Captured during A40 deploy triage + a UX walkthrough, then audited (parallel
read-only investigation, no fixes applied except where noted) to attach real
root causes with file:line citations. Not prioritized — this is a reference
to work through, not a plan.

---

## A. Infra / performance (found during live A40 diagnosis)

1. **Heartbeat/tick CPU contention.** Ticks running too frequently and too
   concurrently for a 9-vCPU box, blocking the event loop. Measured on the
   live box: `event_loop_lag_spike` up to 3060ms. Root cause: `CONCORD_HEARTBEAT_MS`
   defaults to 5000ms (clamped up to a 15s floor), tuned for the *recommended*
   16+ vCPU spec, not this box. **Fix identified, not yet applied**: raise
   `CONCORD_HEARTBEAT_MS` (e.g. 30000+) in `.env`.
2. **Rate limits too tight for real usage.** `server/rateLimit.js`:
   `write.lens` shares one 10/min bucket across every lens's write action
   (all funnel through `POST /api/lens/run`); `read.default` (120/min) is
   easily exhausted by polling HUD components (some poll every 1-2s). This is
   the direct cause of "too many requests" appearing across the site.
   **Fix identified, not yet applied**: raise both limits.
3. **"Connection lost / showing cached data" banner false-positives.**
   `components/common/ConnectionStatus.tsx` — 5s client-side timeout against
   `/api/brain/health`, which itself can legitimately take up to ~8s (5 parallel
   Ollama probes, each with its own 8s timeout) even without tick contention.
   Same root cause as #1 — event-loop blocking during heavy ticks pushes this
   over the edge. Note: the `stale`/`X-Concord-Stale` branch of that banner is
   dead code — the header is never set server-side, so only the harsher
   "Connection lost" message can ever fire.
4. **502 errors across multiple endpoints simultaneously** (forum, auth,
   dtus, events all failing at once) — means the whole `concord-backend`
   process was unreachable, not a per-route bug. Very likely the same tick/CPU
   root cause tipping into a full outage under load, but not confirmed —
   needs `pm2 status` / `pm2 logs concord-backend` captured live next time it
   happens to tell crash-loop vs. unresponsive-but-alive apart.
5. **DataCloneError crash.** `[FATAL] Unhandled promise rejection` from a
   `DOMException [DataCloneError]` — an HTTP-triggered call to a heavy-domain
   macro (routed through `workers/macro-pool.js`) is carrying a non-cloneable
   function inside its `input` payload into a `postMessage` call. Confirmed
   `actorInfo` (userId/role/scopes) is clean, so the function is coming in via
   the macro's actual `input`. Exact call site not yet found — need the
   domain/macro name from the next occurrence's log to trace it.
6. **Lattice-audit "object is not iterable" — FIXED.** Two unguarded
   `dtu.lineage || []` / `dtu.core?.claims || []` iterations in
   `server/emergent/index.js` didn't protect against a non-array truthy value
   (only falsy values get replaced by `||`). Hardened to
   `Array.isArray(x) ? x : []`. Committed (`dc88df0f`), pushed.
7. **`concord-tunnel` PM2 process appears dead** — `pid 0`, blank status
   column, 0 uptime/restarts, while backend/frontend show `online`.
   Unconfirmed whether it's supposed to be running.
8. **`top`/`free` inside the container report host-level stats** (515GB
   total RAM seen vs. the ~50GB actually allocated to the pod) — likely a
   multi-tenant RunPod host exposing raw `/proc/meminfo`, not a cgroup-scoped
   view. Don't use raw `top` output for capacity planning on this box; check
   the cgroup limits directly (`/sys/fs/cgroup/memory.max` etc.).

## B. New hard requirement: tick/interval spacing

9. **Every timer/interval/tick in the codebase (beyond simple env-var-driven
   ones) must be at least 4 minutes apart from every other one, and no two
   may ever fire concurrently — no simultaneous ticks, ever.** Applies to the
   heartbeat registry's per-module frequencies *and* any other ad-hoc
   `setInterval`/`setTimeout`-driven periodic work across the codebase, not
   just the main governor tick. Needs a full audit of every periodic-work
   site, not just `server/emergent/heartbeat-registry.js`. **Not yet audited.**

## C. UX / navigation — AUDITED

10. **Dashboard "Create DTU" jumps straight into Concord Studio.** Root cause
    confirmed: `components/home/MyDashboard.tsx:55-62` ("Create" quick-action
    card) and `:147` ("Mint your first thought" empty-state link) are both
    bare `<Link href="/lenses/studio">` — no modal, no confirmation. But
    `/lenses/studio` (`app/lenses/studio/page.tsx`) is a **full DAW**, not a
    generic DTU editor — landing copy literally says "A full DAW in your
    browser," and the only way in requires Title/BPM/Key/Genre. The
    mismatch is the bug: dashboard promises "mint a thought," destination
    demands a music-production project.
    **The fix is nearly free**: `components/dtu/DTUQuickCreate.tsx` already
    exists, is already backend-wired (`POST /api/dtus`), and its own doc
    comment says "Can be opened from the DTU Browser, lenses, or
    **dashboard**" — but `MyDashboard.tsx` never wires it in. Point the
    dashboard's Create card at this modal instead of `/lenses/studio`, and
    re-label the Studio card as "Make music." A second unused fallback,
    `components/common/QuickCapture.tsx` (Cmd+N FAB), also exists but isn't
    mounted on the dashboard route (it's only on `/lenses/*` via
    `app/lenses/layout.tsx`, and the dashboard lives outside that layout).
11. **Concord Studio is barely usable.** Confirmed — but it's not "broken,"
    it's a deep, mostly-real DAW (real Web Audio engines, MIDI, mastering
    analysis) with specific, locatable defects:
    - **Project state never rehydrates on reload.** `project` state
      (`page.tsx:392`) is only ever set inside `handleCreateProject`; nothing
      hydrates it from `useLensData('studio','project',...)` on mount — every
      fresh visit shows the empty "Create Project" screen even if the user
      has prior saved projects.
    - **No way back to a past project.** `RecentMineCard` (`page.tsx:2781`)
      is mounted with no `onSelect` prop, so list items render as inert
      `<div>`s, not clickable — and it's only rendered in the "active
      project" branch, not on the empty-state landing screen where it's
      actually needed.
    - **Fabricated success message on failure** (`page.tsx:1454-1489`,
      `handleAiAction`'s `catch` block): if the AI action's API call throws,
      the UI still shows *"AI [x] processed. Results applied to project."* —
      a direct violation of this project's own honest-by-construction rule.
    - **Several dead drag/drop handlers**: `ArrangementView`'s
      `onMoveClip`/`onResizeClip` (`page.tsx:1900-1901`), `AudioEditor`'s
      `onOperation` (`:2042`), `Soundboard`'s `onLoadEffectChain`/
      `onDragToTrack` (`:2154,2156`) are all wired to `() => {}` — the
      Sampler view's own instructions ("Drag audio DTUs from the soundboard")
      literally cannot be completed because the receiving handler is a no-op.
    - **Bounce/Export renders a fake placeholder tone**, not the real mix —
      disclosed honestly in-code (`BouncePanel.tsx:18-42,89`: "4-second
      sine-wave placeholder... in-browser mix rendering coming soon") but
      still a non-functional core feature.
    - Per-clip gain/pan/pitch/filter controls are honestly `disabled`
      (`SessionInspectorRail.tsx:50-60`, "not yet wired to a per-clip audio
      model") — correct per the honesty rule, but still a usability gap.
    - No loading state on initial fetch — `isLoading`/`isError`/`error` are
      destructured and immediately discarded (`page.tsx:367-374`, underscore-
      prefixed, unused).

## D. Lens architecture (structural) — AUDITED

12. **The shared lens shell causes clutter — confirmed, and the mechanism is
    concrete, not vibes.** `LensShell.tsx` itself is genuinely headless (no
    imposed chrome) — but real lens pages stack 4-6 generic primitives
    *before* their own UI, and two of them are **independent, competing
    action-bar systems reading from different manifests**
    (`ManifestActionBar` off `lib/lenses/manifest.ts`, and a separate
    `UniversalActions` off `/api/lens/manifest/:domain` — both mounted on the
    same page, e.g. `code/page.tsx:1343,1513` and `music/page.tsx` similarly).
    **Concrete overlap found, not theorized**: `music/page.tsx:2115` renders
    the real playback bar as `fixed bottom-0 z-50`; `music/page.tsx:2222`
    independently floats a second generic panel (`UniversalActions` +
    `RealtimeDataPanel`) at `fixed right-4 bottom-24 z-40` with zero layout
    coordination; `LensAgentFab.tsx` adds a *third* bottom-right `fixed` FAB
    auto-mounted on every `LensShell` unless a lens explicitly opts out (most
    don't).
13. **"Unknown macro" buttons are a real, locatable bug — not perception.**
    `LensManifest.actions` (`lib/lenses/manifest.ts:78`) is typed as a bare
    `string[]` with **no human-label field in the schema at all**.
    `ManifestActionBar.humanize()` only replaces `-`/`_` with spaces and
    title-cases — it does nothing with dots. Confirmed examples: a manifest
    with `actions: ['triage.open', 'scan.rule.add', ...]` renders literally
    as "Triage.open" / "Scan.rule.add"; another with `['wb-indicator',
    'wb-country', ...]` renders as "Wb Indicator" / "Wb Country" — the
    literal "unknown macro" complaint, reproduced exactly. The icon picker
    (`ManifestActionBar.tsx:34-56`) falls back to a generic Sparkles icon for
    anything that doesn't match ~20 known verb prefixes, compounding the
    "slapped in with no context" feel.
14. Design philosophy correction (no code finding — a direction, not a bug):
    lenses are supposed to be full apps, not lightweight shared surfaces. The
    findings above are the evidence base for why.
15. **Consolidation proposal — precedent characterized.** `lib/destinations.ts`
    says outright in its own comment: *"Promotion is presentation only —
    nothing is removed from the lens registry."* `DestinationNav.tsx` renders
    plain `<Link>` route changes between sibling lenses — a styled tab list,
    not shared state or a merged component tree. Each absorbed lens remains a
    fully separate `page.tsx` that independently re-mounts the entire clutter
    stack from #12. **Honest assessment: Destinations solves navigation/
    discoverability only. Consolidating into ~20 real apps means rebuilding
    each destination's rendering and data model, not extending the nav layer
    — a real engineering lift, not a relabeling exercise.**

## E. Per-lens bugs — AUDITED

16. **Art lens — two stacked bugs found, backend is fine.**
    (1) *JSX structural defect*: in `app/lenses/art/page.tsx`, a
    `<div className="space-y-4">` opened at line 1162 for the "Create
    Listing" modal is never closed before the 4-button "Art Compute Actions"
    panel (colorHarmony/compositionScore/generatePalette/styleClassify,
    lines 1181-1252) — so those 4 buttons only render when the *unrelated*
    marketplace listing modal happens to be open.
    (2) *Dead handler even when visible*: `handleArtAction`'s `targetId`
    comes from a generic per-lens CRUD store (`useLensData('art','artwork')`)
    that nothing in the Art lens ever writes to — real uploads go through a
    different endpoint entirely — so `targetId` is always `undefined` and the
    handler silently no-ops before any API call.
    A separately-mounted `<ArtActionPanel/>` (always visible, `page.tsx:1300`)
    correctly calls the same 4 backend macros (`server/domains/art.js`, all
    real) — it's a working duplicate of the broken one.
17. **Council lens — wrong artifact lookup + shape mismatch.** The visible
    "Council Analysis Engine" panel calls its 4 macros against
    `artifactId = proposalLensItems[0]?.id || 'council'` — with no proposal
    yet, it falls back to the literal string `'council'`, which is never a
    real artifact, so all 4 buttons fail with "not found" on first visit.
    Even once a proposal exists, 3 of 4 macros expect fields the Proposal
    data model doesn't have (`council.js` expects `data.votes` as an array,
    `data.agenda/attendees/decisions`, `data.parties` — Proposal stores votes
    as a keyed object and has none of the other fields) — so vote tallies,
    minutes, and conflict resolution are permanently empty/wrong even when
    "working." A separately-mounted `<CouncilActionPanel/>` calls the same
    macros correctly (builds the artifact from caller params directly) — same
    working-duplicate-vs-broken-original pattern as Art.
18. **Podcast lens — three disconnected episode data models on one page.**
    (1) The page's own Episodes/Create/Analytics tabs use a **generic**
    artifact CRUD store shared by every lens. (2) `PodcastPlayerSection`/
    `PodcastListeningHub`/etc. use a **real, deep, purpose-built** RSS-backed
    show/episode substrate in `server/domains/podcast.js` (real RSS parsing,
    real iTunes API calls, cross-device sync). These two never intersect — an
    episode created in one never appears in the other. (3) A third, fully
    orphaned component (`ItunesPodcastPanel.tsx`) duplicates a mounted
    component's functionality via a different, separately-registered macro,
    and is never imported anywhere. **Scoped refactor**: pick the RSS-backed
    substrate (the deeper one), migrate or delete the generic-CRUD tab, and
    delete the orphaned duplicate.
19. **Feed lens — "overlays blocking" is a global `AppShell` problem, not
    feed-specific.** Feed's own UI stays low in the stack (z-10/z-20). The
    actual collisions are from components mounted globally on *every* page
    via `components/shell/AppShell.tsx`, each independently claiming the same
    screen corner with no shared z-index scheme: `SystemStatus` (bottom-left,
    z-40) vs. `CookieConsent` (same bottom-left coords, z-60 — fully covers
    the status pill until dismissed); `Toasts` vs. `SyncIndicator` (identical
    bottom-right coords, same z-50, whichever mounts later in JSX order
    wins); `ConnectionStatus` vs. `OfflineFallback` (identical top strip,
    z-50 vs z-60). Feed's own like/repost/comment toasts fire into the
    already-contested bottom-right box. Fix belongs in `AppShell.tsx`'s
    layout, not in the Feed lens itself.
20. "Unknown macros"/unlabeled buttons — same root cause as #13, confirmed
    to reproduce on multiple real manifests, not lens-specific.
21. **Lenses failing to load — no systemic compile-time bug found.** Full
    frontend `tsc --noEmit`: 0 errors. The committed `.next` build succeeded.
    Scanned all 270 lens pages' imports (static + `dynamic()`): zero missing/
    renamed targets. Concordia's heavy Three.js components are correctly
    `ssr: false`-gated. **This likely traces to a runtime cause (backend
    API errors, auth/session state, data-shape mismatches) that static
    analysis can't see** — needs a live browser repro with devtools open to
    capture the actual console/network error, not further code reading.
22. **Concordia (world lens) stuck on loading, never advances — ROOT CAUSE
    FOUND + FIXED.** `deriveWorldDataState` (`lib/world-lens/world-data-
    state.ts`) only leaves `'loading'` when at least one of 4 world-data
    fetches (nodes/buildings/npcs/lootBags) resolves `'ok'`, or **all four**
    explicitly resolve `'error'`. All four used bare `fetch()` with **no
    timeout** (`app/lenses/world/page.tsx:2530,2609,2623,2732`) — if a
    request just hangs (which a CPU-starved backend under heavy tick load
    does — see A.1-A.4 — it doesn't necessarily error fast, it can simply not
    respond), that promise never resolves or rejects, `markWorldFetch` never
    fires for that source, and the derived state can reach neither `'live'`
    nor `'offline'` — stuck on `'loading'` forever. `ConnectionStatus.tsx`
    already uses `AbortSignal.timeout` for exactly this reason; these four
    fetches never got the same treatment. **Fixed**: added an 8s
    `AbortSignal.timeout` to all four (commit `c219a4b0`, pushed) — a hung
    backend now resolves to the honest `'offline'` "showing local preview"
    state instead of an infinite spinner. Note: this fixes Concordia's lack
    of defense against a slow backend, not the backend slowness itself (still
    A.1-A.4). The separate 237-`dynamic()`-import scale finding below is
    still worth addressing but is not what was causing this specific symptom.
    `app/lenses/world/page.tsx` is 6,964 lines with **237** separate
    `dynamic()` chunk-import calls (next-highest lens page in the app: **4**)
    — still a real fragility/hydration-cost risk worth reducing, just not the
    cause of the "stuck forever" report.
23. **Character creation screen — confirmed, root cause found, cheap fix.**
    `components/world/CharacterCustomizer.tsx:203-233` renders exactly two
    plain HTML `<div>`s (a CSS circle for the head, a rounded rectangle for
    the torso) labeled "3D Preview" underneath — not even a 2D canvas or SVG,
    just Tailwind div shapes. No Three.js/`<Canvas>`/`useGLTF` anywhere in the
    file. The real 3D machinery already exists and is reusable:
    `lib/concordia/hero-mesh-registry.ts` (real `.glb` loading) and a
    standalone-importable procedural avatar builder
    (`enhanced-avatar-builder#buildEnhancedAvatar` fed by
    `character-schema#generateAppearance`) that `AvatarSystem3D.tsx` already
    uses for in-world avatars. `CharacterCustomizer.tsx` collects the exact
    same appearance data shape but never feeds it to either. There's already
    an in-repo precedent for exactly this pattern —
    `components/concordia/mounts/MountPreviewCanvas.tsx` wraps a real
    `@react-three/fiber` `<Canvas>` around the same procedural builder for a
    different preview use case. **This is a wiring fix, not new asset/
    rendering work**: swap the two placeholder `<div>`s for an R3F `<Canvas>`
    following the `MountPreviewCanvas.tsx` template, fed by the customizer's
    own live selection state.

## F. Confirmed working (no action needed)

24. GitHub repo links load correctly (real repos load).

## G. Content: seeded DTUs taking a real-world stance — FULL SCAN COMPLETE

Full pass across `server/dtus.js` (all ~8,700 DTUs) and every file in
`server/data/seed/*.json`, 30+ keyword set (religion + politics terms),
every hit manually read for context. `content/world/*` game lore correctly
excluded (fictional, not a real-world claim).

**Flag for removal (2):**
25. `dtu_486_post_god_era_transition` — `server/dtus.js:49438` **and**
    `server/data/seed/dtus-unassigned.json:295` (exists in both places, both
    need cleanup). Claims divine hypotheses are unnecessary — direct
    metaphysical/atheistic assertion.
26. **New finding**: `dtu_456_civilization_without_narrative_drift` —
    `server/dtus.js:46941` and `server/data/seed/dtus-part8.json:3147`.
    Presents the individual-rights reading of the 2nd Amendment as
    inauthentic "narrative drift" from an "original" collective-militia
    meaning — one side of a live, contested US political/legal debate,
    stated as settled platform "knowledge." Same pattern as #25, political
    instead of religious.

**Ambiguous / judgment call (2):**
27. `dtu_393_cultural_entropy_accumulation` (`dtus-part7.json:3330`) — frames
    religious institutions' doctrinal change/splintering as "entropy," a
    value-laden lens dressed as neutral math.
28. `dtu_396_cultural_redundancy_and_stability` (`dtus-part7.json:3639`) —
    reduces real historical religious persecution (Soviet suppression of
    Jewish practice) to a formal-model variable ("K_cult=1 → cultural death").
    Not a stance-taking claim, but a reductive treatment of a real atrocity.

**Reviewed and confirmed neutral — do NOT flag (6):** DTUs 401, 445, 448,
460, 400, 320 — all cite real religious institutions/traditions (Catholic
Church, Oral Torah, Byzantine church-and-state) purely as descriptive
historical examples of institutional longevity, alongside secular examples
(central banks, Roman concrete, the US Constitution) — no stance taken.
`dtu_320` is a false-positive-adjacent case: "Physical Church-Turing thesis"
is a computer-science term (Alonzo Church), not a religious reference.

**23 additional keyword hits checked and dismissed as pure substring false
positives** ("sin" inside "basin"/"increasing", "hell" inside "shell",
"democrat" inside "democratic") — listed in the full agent report if needed,
not reproduced here.

**Bottom line**: dtu_486 and dtu_456 appear to be isolated incidents, not a
systemic pattern — no hits at all for the majority of the keyword set
(atheism, scripture, prayer, worship, bible/quran/torah, creationism,
abortion, party-politics terms, etc.). The "cultural dynamics" DTU cluster
(ids roughly 390-460) is where what real-world-sensitive examples exist
cluster, and is worth a closer look if a conservative pass is wanted beyond
the 2 clear removals.

29. Distinction to preserve when this gets worked on (unchanged from
    original): the "goddess"/deity references in `content/world/*` are
    fictional in-game lore for the Concordia world simulator — not
    real-world claims, and should **not** be swept into this cleanup.
