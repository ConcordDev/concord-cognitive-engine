# Absorbed UX Components — Wire Status

Generated 2026-05-08 during Phase D of the v1 closeout. The 21 UX
components absorbed in `ef917c04` from `claude/world-lens-core-pipeline-D6Ric`
landed orphan in `concord-frontend/components/world-lens/` (mixed in with
~100 pre-existing world-lens components). Each needs a keep/drop/merge
decision before mounting — same pattern as Phase C for libs.

## Decision matrix (the 21 newly-absorbed components)

All EVAL decisions resolved; remaining work is per-component product
integration (real data, real semantic mount). The ux-suite lens at
`/lenses/ux-suite` is the showcase mount for everything not yet wired
to its semantic home.

| Component | Decision | Target mount | Status | Rationale |
|---|---|---|---|---|
| `LocalizationProvider.tsx` | **DROP** | n/a | done | Duplicates `I18nProvider`. Deleted in Phase D. |
| `LensPluginSystem.tsx` | **WIRE** | system lens plugins tab | ux-suite | Surfaces backend plugin-gallery (migration 085) to frontend. Different from server-side module-registry — that's runtime dep graph; this is user-installable plugins. Real surface is product-design work. |
| `SoundSystem.tsx` | **WIRE** | Providers.tsx (alongside GlobalMediaController) | ux-suite | Different role from GlobalMediaController. SoundSystem = district-aware ambient audio (weather, interior/exterior, district SFX). GlobalMediaController = global music playback persistence. Complementary, not duplicate. |
| `SettingsPanel.tsx` | **WIRE** | `app/settings/page.tsx` | **shipped** | New canonical settings page with localStorage-backed persistence (graphics / audio / controls / notifications / privacy / language). |
| `AnalyticsDashboard.tsx` | **WIRE** | system lens stats tab | ux-suite | Different from cartograph stats (system structure); this is personal/world/global activity. Real surface needs backend macro for the stats payload. |
| `ProgressionPanel.tsx` | **WIRE** | concordia HUD progression tab | ux-suite | No `SkillProgression` component exists — only the inline XP bars in CombatHUD. Progression panel is the dedicated milestone/unlock surface. Real wire needs backend macro. |
| `SaveSystem.tsx` | **WIRE** | concordia HUD pause-menu | ux-suite | No existing save UI. Backend persistence runs on a heartbeat; this is the user-visible save status + manual cloud-sync trigger. |
| `MobileCompanion.tsx` | **WIRE** | web responsive shell | ux-suite | Different role from `concord-mobile` (React Native native app). MobileCompanion = web-side responsive mode for users without the native app. |
| `WorldTravel.tsx` | **WIRE** | concordia HUD portal selector | ux-suite | Different from `AvatarSwitcher` (avatar swap within world); WorldTravel is full world warp + invite/bookmark management. |
| `AgentBuilder.tsx` | **WIRE** | society lens autonomy tab | ux-suite | Novel — agent-system has the backend (oracle-brain + npc-autonomy) but no authoring UI. |
| `AccessibilityPanel.tsx` | **WIRE** | settings (sub-tab in SettingsPanel) | ux-suite | Now reachable via `app/settings/page.tsx` accessibility tab. Still a separate component for embedding in onboarding. |
| `AchievementSystem.tsx` | **WIRE** | concordia HUD achievements tab | ux-suite | Novel surface. Pairs with the breakthrough-clusters substrate. |
| `DailyRituals.tsx` | **WIRE** | self lens (`app/lenses/self/`) | ux-suite | Novel ritual / habit-tracking surface. |
| `DistrictTimeline.tsx` | **WIRE** | world lens district panel | ux-suite | Pairs with `DistrictActivityFeed` already mounted. |
| `EnvironmentalStorytelling.tsx` | **WIRE** | concordia HUD ambient layer | ux-suite | Surfaces world ambient state in narrative voice. |
| `HiddenAssistance.tsx` | **WIRE** | onboarding overlay | ux-suite | Slots into FirstWinWizard / PostTutorialHints. Wrapper component. |
| `SeasonalContent.tsx` | **WIRE** | concordia HUD calendar tab | ux-suite | Pairs with content-seeder + world-event-scheduler. |
| `SecretsDiscovery.tsx` | **WIRE** | concordia HUD discovery tab | ux-suite | Pairs with concord-link-walkers + reality-explorer. Wrapper component. |
| `AdaptiveComplexity.tsx` | **WIRE** | settings → adaptive UI tab | ux-suite | UI complexity slider (beginner/intermediate/expert reveal). Wrapper component. |
| `ARPreview.tsx` | **WIRE** | world lens AR mode | ux-suite | AR preview of buildings/avatars. Needs WebXR availability check. |
| `LensActionBar.tsx` | **WIRE** | shared `<LensShell />` wrapper | ux-suite | Standardised action bar. Could become the canonical lens chrome — design decision for a future commit. |

## Status (post-queue-resolution)

- **DROP**: 1 (LocalizationProvider — Phase D)
- **WIRE → ux-suite (showcase)**: 20 (Phase D)
- **WIRE → semantic home (real)**: 1 shipped (SettingsPanel → /settings)
- **EVAL queue**: empty — every component has a final decision

Remaining work is product integration: each component connects to
real backend data and moves from the ux-suite showcase to its
semantic-home parent. That's per-component design work, not queue
work — see the Status column for current mount.

## Component-by-component next-action playbook

For the WIRE-decision components, the wire-up commit should:

1. Read the absorbed component's props signature
2. Find the parent surface where it lands (per "Target mount" column)
3. Wire props (typed) to the parent's state / queries
4. Ensure the parent passes through realtime updates if applicable
5. Add a Tier-2 contract test for the integration

For EVAL components, the audit commit should:

1. Diff the absorbed component vs the existing one (if any)
2. Decide replace / merge / drop with rationale
3. Commit decision into `audit/cartograph/UX_WIRE_STATUS.md`
4. Wire if replace; merge code if merge; delete if drop

This matches the Phase C pattern exactly.

## Convention

When future absorption passes land more orphan UX components, append to
the matrix above. Decision must be **WIRE / EVAL / DROP** with a target
mount + estimated effort.
