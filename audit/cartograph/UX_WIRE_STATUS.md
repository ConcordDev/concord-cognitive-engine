# Absorbed UX Components — Wire Status

Generated 2026-05-08 during Phase D of the v1 closeout. The 21 UX
components absorbed in `ef917c04` from `claude/world-lens-core-pipeline-D6Ric`
landed orphan in `concord-frontend/components/world-lens/` (mixed in with
~100 pre-existing world-lens components). Each needs a keep/drop/merge
decision before mounting — same pattern as Phase C for libs.

## Decision matrix (the 21 newly-absorbed components)

| Component | Decision | Target mount | Effort | Rationale |
|---|---|---|---|---|
| `LocalizationProvider.tsx` | **DROP** | n/a | 0 | Duplicates existing `I18nProvider` already mounted in `Providers.tsx`. Two providers would diverge. |
| `SoundSystem.tsx` | **EVAL** | Providers.tsx (replaces or augments GlobalMediaController) | 0.5d | Likely overlaps with existing `GlobalMediaController`; need to compare APIs before deciding merge or replace. |
| `SettingsPanel.tsx` | **EVAL** | `app/settings/page.tsx` | 0.5d | Overlap with whatever existing settings surface lives at /settings (need to inspect). |
| `AnalyticsDashboard.tsx` | **EVAL** | system lens stats tab | 0.5d | Overlaps with system-lens cartograph stats; could replace or fold. |
| `LensPluginSystem.tsx` | **DROP-or-merge** | n/a | — | Overlaps with `module-registry.js` + `plugin-loader.js` server-side and the existing plugin gallery surface. Frontend duplicate of backend authority. |
| `ProgressionPanel.tsx` | **EVAL** | concordia HUD | 0.5d | Likely overlaps with existing skill-XP progression UI (`SkillProgression`). Compare. |
| `SaveSystem.tsx` | **EVAL** | concordia HUD pause-menu | 0.5d | Likely duplicates the existing autosave + cloud-save pattern in concord-frontend/lib/persistence. |
| `AgentBuilder.tsx` | **WIRE** | society lens autonomy tab | 1d | Novel surface — agent-system has the backend (oracle-brain + npc-autonomy) but no authoring UI. Fits Society Lens. |
| `AccessibilityPanel.tsx` | **WIRE** | new `app/settings/accessibility/page.tsx` | 0.5d | Novel — full WCAG settings (colorblind 5-mode, one-handed, reduced-motion, screen-reader, subtitle font scale). Real gap, no overlap. |
| `AchievementSystem.tsx` | **WIRE** | concordia HUD achievement tab | 0.5d | Novel — we don't have an achievement surface, just skill-XP. Pairs with the breakthrough-clusters substrate. |
| `DailyRituals.tsx` | **WIRE** | self lens (`app/lenses/self/`) | 0.5d | Novel ritual / habit-tracking surface. Slots into the existing self-aggregator lens. |
| `DistrictTimeline.tsx` | **WIRE** | world lens district panel | 0.5d | Novel — timeline of district events. Pairs with `DistrictActivityFeed` already mounted. |
| `EnvironmentalStorytelling.tsx` | **WIRE** | concordia HUD ambient layer | 1d | Novel — surfaces world ambient state (weather, refusal-field, faction-war banners) in narrative voice. |
| `HiddenAssistance.tsx` | **WIRE** | onboarding overlay | 0.5d | Novel — context-sensitive hint system. Slots into existing FirstWinWizard / PostTutorialHints. |
| `MobileCompanion.tsx` | **EVAL** | concord-mobile or web responsive | 1d | Need to compare with existing `concord-mobile/` React Native app — may be a web-side companion or a duplicate. |
| `SeasonalContent.tsx` | **WIRE** | concordia HUD calendar tab | 0.5d | Novel — seasonal content scheduler. Pairs with content-seeder + world-event-scheduler. |
| `SecretsDiscovery.tsx` | **WIRE** | concordia HUD discovery tab | 0.5d | Novel — explorer/secret-find tracker. Pairs with concord-link-walkers + reality-explorer. |
| `WorldTravel.tsx` | **EVAL** | concordia HUD portal selector | 0.5d | Likely overlaps with the existing avatar/world-switcher (`AvatarSwitcher`); compare. |
| `AdaptiveComplexity.tsx` | **WIRE** | settings → adaptive UI tab | 0.5d | Novel — UI complexity slider (beginner/intermediate/expert reveal). Real gap. |
| `ARPreview.tsx` | **WIRE** | world lens AR mode | 1d | Novel — AR preview of buildings/avatars. Will need WebXR availability check. |
| `LensActionBar.tsx` | **WIRE** | shared `<LensShell />` wrapper | 0.5d | Novel — standardised action bar for lens pages (refresh, search, filter, settings). Could become the canonical lens chrome. |

## Phase D scope (this commit)

**WIRE** column has 11 components × ~0.5–1d each = **~7 focused days**.
**EVAL** has 7 components × ~0.5d each = **~3.5 focused days**.
**DROP** has 1 (LocalizationProvider) + 1 likely-drop (LensPluginSystem) = trivial.

Phase D ships only the audit doc + the LocalizationProvider drop +
1 quick low-risk wire (AccessibilityPanel as a settings page) so the
methodology is demonstrated. The remaining 19 mounts are real per-
component design work that needs its own commit window each.

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
