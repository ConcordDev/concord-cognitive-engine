# HV-01 harvest census — RESIDUAL

Census head (fix/audit-sweep-20261110): 759265ae8afd16e023b32f6a0ce518b215b0358e
Main: 7126ab4fc8093ceaea7dc6b176b4d4baa32074f3
Table: §6 of MEGA_PLAN.md (100 PRs, extract scripts/harvest/plan-table.json)
Tool: scripts/harvest/residual.mjs — added: present/MISSING · modified: APPLIED / APPLIED-IDENTICAL / LANDED-EVOLVED (>= 0.9 added-line coverage) / ABSENT · residual = MISSING + ABSENT
DIFFERS rows: 17 (each returns to the office before its HV ticket starts)

| PR | §6 verdict | residual files | census |
|---|---|---|---|
| #2357 | SUPERSEDED | — | AGREE |
| #2356 | TARGET | — | — | AGREE |
| #2355 | HARVEST-ALL | server/domains/fitness.js, server/tests/fitness-domain-parity.test.js | AGREE |
| #2354 | HARVEST-ALL | concord-frontend/components/manufacturing/ShopFloorSuite.tsx, concord-frontend/components/manufacturing/ShopFloorToolsPanel.tsx, concord-frontend/components/manufacturing/manufacturing-build-slices.test.tsx, concord-frontend/hooks/useDepthBadge.ts, server/domains/manufacturing.js, server/tests/manufacturing-build-slices.test.js | AGREE |
| #2352 | HARVEST-PART | concord-frontend/package-lock.json, concord-frontend/package.json | AGREE |
| #2351 | HARVEST-ALL | server/package-lock.json, server/package.json | AGREE |
| #2350 | HARVEST-ALL | .github/workflows/codeql.yml, .github/workflows/deploy.yml, .github/workflows/platinum-security.yml | AGREE |
| #2349 | HARVEST-ALL | concord-frontend/components/lens/ContentPublisher.tsx, concord-frontend/components/lens/LiveIndicator.tsx, concord-frontend/tests/chrome-fix-a6.test.tsx | AGREE |
| #2348 | HARVEST-ALL | concord-frontend/components/concordia/world/LeaderboardPanel.tsx, concord-frontend/components/finance/OverviewPanel.tsx, concord-frontend/components/law/BillingCalculator.tsx, concord-frontend/components/lens/IndicatorChart.tsx, concord-frontend/components/markets/MarketsQuoteDetail.tsx, concord-frontend/components/media/UniversalPlayer.tsx, concord-frontend/components/music/TrackCard.tsx, concord-frontend/components/sim/SimConsole.tsx, concord-frontend/components/studio/EffectsPanel.tsx, concord-frontend/components/tick/TickStreamContext.tsx, concord-frontend/components/trades/ProjectDeskPanel.tsx, concord-frontend/tests/formatter-throws-p1.test.mjs | AGREE |
| #2347 | HARVEST-ALL | concord-frontend/components/hr/HrBenefitsPanel.tsx, concord-frontend/components/hr/HrClockPanel.tsx, concord-frontend/components/hr/HrLearningPanel.tsx, concord-frontend/components/hr/HrTimeOffPanel.tsx, server/domains/hr.js, server/tests/hr-retain-label.test.js | AGREE |
| #2346 | HARVEST-ALL | server/domains/bounties.js, server/lib/autofix/bounty-proposal.js, server/server.js, server/tests/autofix-bounty-proposal.test.js, server/tests/bounties-pool-definition.test.js | AGREE |
| #2345 | HARVEST-PART | concord-frontend/app/lenses/commonsense/page.tsx, concord-frontend/tests/commonsense-build.test.mjs, server/domains/commonsense.js, server/tests/commonsense-answer-build.test.js | AGREE |
| #2333 | SUPERSEDED | server/domains/alliance.js, server/domains/daily.js, server/domains/literary.js, server/tests/meditation-recomplete.test.js, server/tests/wave7-parent-fk.test.js | DIFFERS |
| #2325 | SUPERSEDED | concord-frontend/components/lens/ContentPublisher.tsx, concord-frontend/components/lens/LiveIndicator.tsx, concord-frontend/tests/chrome-fix-a6.test.tsx | DIFFERS |
| #2222 | SUPERSEDED | — | AGREE |
| #2218 | SUPERSEDED | — | AGREE |
| #2217 | SUPERSEDED | — | AGREE |
| #2215 | SUPERSEDED | — | AGREE |
| #2214 | SUPERSEDED | — | AGREE |
| #2213 | SUPERSEDED | — | AGREE |
| #2212 | SUPERSEDED | — | AGREE |
| #2211 | SUPERSEDED | concord-frontend/components/bridge/ConcordLinkWalkers.tsx, concord-frontend/components/bridge/FederationConsole.tsx | DIFFERS |
| #2210 | SUPERSEDED | — | AGREE |
| #2209 | SUPERSEDED | — | AGREE |
| #2208 | HARVEST-PART | concord-frontend/tests/legal-coverage.test.tsx | AGREE |
| #2203 | SUPERSEDED | concord-frontend/components/events/EventsWorkbench.tsx, server/domains/events.js, server/tests/events-planning-domain-parity.test.js | DIFFERS |
| #2202 | SUPERSEDED | concord-frontend/app/lenses/geology/page.tsx, concord-frontend/components/geology/FieldLog.tsx, concord-frontend/components/geology/FieldSitesMap.tsx, concord-frontend/components/geology/Geology.coverage.test.tsx, concord-frontend/components/geology/RockMineralIdPanel.tsx, concord-frontend/components/geology/StratigraphicColumnPanel.tsx, concord-frontend/components/geology/UsgsQuakePanel.tsx, server/domains/geology.js, server/tests/depth/geology-behavior.test.js, server/tests/geology-domain-parity.test.js, server/tests/geology-lens-macros.test.js | AGREE |
| #2200 | SUPERSEDED | — | AGREE |
| #2193 | SUPERSEDED | — | AGREE |
| #2191 | SUPERSEDED | concord-frontend/components/manufacturing/OEEDashboard.tsx | DIFFERS |
| #2189 | SUPERSEDED | — | AGREE |
| #2188 | SUPERSEDED | concord-frontend/components/nonprofit/CampaignManager.tsx, concord-frontend/components/nonprofit/PropublicaSearch.tsx | DIFFERS |
| #2185 | SUPERSEDED | concord-frontend/components/cooking/CookingActionPanel.tsx | DIFFERS |
| #2183 | SUPERSEDED | — | AGREE |
| #2182 | SUPERSEDED | concord-frontend/components/supplychain/SupplyChainActionPanel.tsx | DIFFERS |
| #2174 | SUPERSEDED | — | AGREE |
| #2170 | SUPERSEDED | — | AGREE |
| #2168 | SUPERSEDED | — | AGREE |
| #2165 | SUPERSEDED | concord-frontend/components/engineering/ModelPanel.tsx | DIFFERS |
| #2163 | SUPERSEDED | — | AGREE |
| #2161 | SUPERSEDED | — | AGREE |
| #2151 | SUPERSEDED | concord-frontend/app/hub/page.tsx, concord-frontend/app/lenses/bounties/page.tsx, concord-frontend/components/bounties/BountyCard.tsx, concord-frontend/components/bounties/BountyFilters.tsx, concord-frontend/components/bounties/BountyLeaderboard.tsx, concord-frontend/components/bounties/CreateBountyForm.tsx, concord-frontend/components/bounties/GhsaAdvisories.tsx, concord-frontend/components/bounties/__tests__/Bounties.coverage.test.tsx, concord-frontend/components/bounties/types.ts, concord-frontend/components/defense/MissionPlanner.tsx, concord-frontend/hooks/useDepthBadge.ts, concord-frontend/lib/lenses/manifest.ts, concord-frontend/tests/bounties-depth-badge.test.ts, server/domains/bounties.js, server/tests/bounties-build.test.js, server/tests/depth/bounties-behavior.test.js | DIFFERS |
| #2150 | SUPERSEDED | — | AGREE |
| #2149 | SUPERSEDED | — | AGREE |
| #2148 | SUPERSEDED | — | AGREE |
| #2145 | SUPERSEDED | — | AGREE |
| #2144 | SUPERSEDED | server/domains/photos.js, server/routes/photos.js, server/tests/photo-gallery.test.js | DIFFERS |
| #2143 | SUPERSEDED | concord-frontend/app/lenses/automotive/page.tsx, concord-frontend/components/automotive/FuelRepairPanel.tsx, concord-frontend/components/automotive/GarageSection.tsx, concord-frontend/components/automotive/VehicleHistory.tsx, concord-frontend/components/automotive/VinDecoder.tsx, concord-frontend/components/automotive/__tests__/Automotive.coverage.test.tsx, concord-frontend/components/creative/CreativeBoardsSection.tsx, server/domains/automotive.js, server/tests/automotive-lens-macros.test.js, server/tests/depth/automotive-behavior.test.js | DIFFERS |
| #2142 | SUPERSEDED | — | AGREE |
| #2141 | SUPERSEDED | — | AGREE |
| #2140 | SUPERSEDED | — | AGREE |
| #2139 | SUPERSEDED | concord-frontend/components/defense/MissionPlanner.tsx | DIFFERS |
| #2138 | SUPERSEDED | concord-frontend/components/retail/StorefrontShell.tsx | DIFFERS |
| #2136 | HARVEST-PART | concord-frontend/app/hub/page.tsx, concord-frontend/app/lenses/bounties/page.tsx, concord-frontend/components/bounties/BountyCard.tsx, concord-frontend/components/bounties/BountyFilters.tsx, concord-frontend/components/bounties/BountyLeaderboard.tsx, concord-frontend/components/bounties/CreateBountyForm.tsx, concord-frontend/components/bounties/GhsaAdvisories.tsx, concord-frontend/components/bounties/types.ts, concord-frontend/hooks/useDepthBadge.ts, concord-frontend/lib/lenses/manifest.ts, concord-frontend/tests/bounties-depth-badge.test.ts, server/domains/bounties.js, server/tests/bounties-build.test.js | AGREE |
| #2135 | SUPERSEDED | — | AGREE |
| #2133 | SUPERSEDED | — | AGREE |
| #2132 | SUPERSEDED | — | AGREE |
| #2131 | SUPERSEDED | — | AGREE |
| #2130 | SUPERSEDED | concord-frontend/components/creative/CreativeBoardsSection.tsx | DIFFERS |
| #2129 | SUPERSEDED | concord-frontend/components/events/EventsWorkbench.tsx, concord-frontend/tests/fishing-lens-states.test.tsx, server/domains/events.js, server/tests/events-planning-domain-parity.test.js | DIFFERS |
| #2128 | SUPERSEDED | — | AGREE |
| #2124 | SUPERSEDED | — | AGREE |
| #2123 | SUPERSEDED | — | AGREE |
| #2122 | SUPERSEDED | — | AGREE |
| #2120 | SUPERSEDED | — | AGREE |
| #2119 | SUPERSEDED | — | AGREE |
| #2118 | SUPERSEDED | — | AGREE |
| #2117 | SUPERSEDED | — | AGREE |
| #2116 | SUPERSEDED | concord-frontend/components/mentorship/MentorDirectoryPanel.tsx | DIFFERS |
| #2114 | SUPERSEDED | — | AGREE |
| #2113 | SUPERSEDED | — | AGREE |
| #2112 | SUPERSEDED | — | AGREE |
| #2103 | HARVEST-ALL | concord-frontend/components/events/EventOps.tsx, concord-frontend/components/events/EventPlanner.tsx, concord-frontend/components/events/EventsWorkbench.tsx, concord-frontend/components/events/event-when.test.ts, concord-frontend/components/events/event-when.ts, server/domains/events.js, server/tests/events-planning-domain-parity.test.js | AGREE |
| #2102 | SUPERSEDED | — | AGREE |
| #2100 | HARVEST-ALL | concord-frontend/components/events/EventsWorkbench.tsx, server/domains/events.js, server/tests/events-planning-domain-parity.test.js | AGREE |
| #2099 | HARVEST-ALL | concord-frontend/components/events/EventsWorkbench.tsx, concord-frontend/components/events/OperationsStorePanel.tsx, concord-frontend/components/events/operations-store.test.ts, concord-frontend/components/events/operations-store.ts | AGREE |
| #2094 | SUPERSEDED | — | AGREE |
| #2054 | HARVEST-PART | server/server.js, server/tests/cross-model-schema-targets.test.js | AGREE |
| #2047 | HARVEST-ALL | server/domains/database.js, server/lib/db-dial.js, server/tests/database-dbx4-remote-query.test.js, server/tests/db-dial-query.test.js | AGREE |
| #2046 | HARVEST-ALL | server/lib/canonical-result.js, server/tests/canonical-result.test.js, server/tests/cohesive-r1-dtu-create-equivalence.test.js | AGREE |
| #2045 | HARVEST-ALL | server/domains/database.js, server/lib/db-dial.js, server/tests/database-dbx3-connection-test.test.js, server/tests/db-dial.test.js | AGREE |
| #2044 | SUPERSEDED | — | AGREE |
| #2043 | SUPERSEDED | — | AGREE |
| #2039 | SUPERSEDED | — | AGREE |
| #2037 | SUPERSEDED | — | AGREE |
| #2036 | SUPERSEDED | — | AGREE |
| #2035 | SUPERSEDED | — | AGREE |
| #1998 | HARVEST-PART | concord-vscode/package-lock.json, concord-vscode/package.json | AGREE |
| #1779 | DUTCH | docs/audit/B3-2-DOSSIER-2026-10-28.md | AGREE |
| #1524 | DUTCH | concord-frontend/package-lock.json, concord-frontend/package.json | AGREE |
| #1522 | DUTCH | concord-frontend/package-lock.json, concord-frontend/package.json | AGREE |
| #1521 | DUTCH | concord-frontend/package-lock.json, concord-frontend/package.json | AGREE |
| #1520 | DUTCH | concord-frontend/package-lock.json, concord-frontend/package.json | AGREE |
| #1516 | DUTCH | server/package-lock.json, server/package.json | AGREE |
| #1515 | DUTCH | server/package-lock.json, server/package.json | AGREE |
| #1514 | DUTCH | server/package-lock.json, server/package.json | AGREE |
| #1511 | DUTCH | server/package-lock.json, server/package.json | AGREE |
| #1506 | DUTCH | concord-frontend/package-lock.json, concord-frontend/package.json | AGREE |
| #1494 | DROP | apps/concordia-living-world/unity-client/.Aura/LIVE_PATH.md, apps/concordia-living-world/unity-client/.Aura/PROGRESS_LOG.md, apps/concordia-living-world/unity-client/.Aura/QUEST_AUDIT.md, apps/concordia-living-world/unity-client/.Aura/REQUESTS_FOR_CLAUDE.md, apps/concordia-living-world/unity-client/.Aura/ROADMAP.md, apps/concordia-living-world/unity-client/.Aura/Skills/concordia-nonstop/SKILL.md, apps/concordia-living-world/unity-client/.Aura/tools/quest_audit.py, apps/concordia-living-world/unity-client/.Aura/tools/weapon_classes.mjs, apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/AuraShots.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/AuraShots.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/AuraVerifyProbe.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/AuraVerifyProbe.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/ComponentDump.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/ComponentDump.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/HeroRigProbe.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/HeroRigProbe.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/InputProbe.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/InputProbe.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/RebindProbe.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/RebindProbe.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/SettingsProbe.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/SettingsProbe.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks/Fauna/Animals_Pack_Quaternius/Animals Pack by Quaternius/FBX/Chick.fbx.meta, apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks/Fauna/Animals_Pack_Quaternius/Animals Pack by Quaternius/FBX/Fish.fbx.meta, apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks/Fauna/Animals_Pack_Quaternius/Animals Pack by Quaternius/FBX/Red Fox.fbx.meta, apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks/Fauna/Animals_Pack_Quaternius/Animals Pack by Quaternius/FBX/Whale.fbx.meta, apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks/Fauna/Animals_Pack_Quaternius/Animals Pack by Quaternius/FBX/bird.fbx.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/consolidation-stake.json, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/consolidation-stake.json.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/faction-quests.json, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/faction-quests.json.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/first_cycle_phase_d.json, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/first_cycle_phase_d.json.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/kael-torchlight.json, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/kael-torchlight.json.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/main-arc.json, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/main-arc.json.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/southern-arc-mystery.json, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/southern-arc-mystery.json.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/the-handshake-revelation.json, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/the-handshake-revelation.json.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/sere/quests.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/sere/quests/main-arc.json, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/sere/quests/main-arc.json.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/ConcordiaControls.inputactions, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/ConcordiaControls.inputactions.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/ConcordiaLocomotion.controller, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/AerialTraffic.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/AerialTraffic.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/AuraVerify.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/AuraVerify.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/Combat.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/Combat/WeaponClassDef.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/Combat/WeaponClassDef.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/ConcordiaInput.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/ConcordiaInput.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/ConcordiaSettings.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/ConcordiaSettings.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/FrameWatch.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/FrameWatch.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/LocomotionPolish.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/LocomotionPolish.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/Net.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/Net/ConcordRest.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/Net/ConcordRest.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/ServerProgress.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/ServerProgress.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ConcordClient.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ConcordiaGame.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ConcordiaHUD.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ConcordiaPlayer.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ContentBind/ContentBindVolumeCatalog.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ContinentStream.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/CreatureCompiler.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/FreePacks.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/GameplayCore/Persistence/ConcordiaPersistenceService.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Hostile.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/HubDataNpcSeed.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/HubKit.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/HubLook.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/HubResidents.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/HubResidents.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/HubWilderness.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Organic/OrganicBind.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/RealmFill.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/TrainingDummy.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/WorldBuilder.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Tests/EditMode/ConcordRestTests.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Tests/EditMode/ConcordRestTests.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Tests/EditMode/ConcordiaPersistenceTests.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Tests/EditMode/ServerCombatClientTests.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Tests/EditMode/ServerCombatClientTests.cs.meta, apps/concordia-living-world/unity-client/Assets/Concordia/Tests/EditMode/WeaponClassDefTests.cs, apps/concordia-living-world/unity-client/Assets/Concordia/Tests/EditMode/WeaponClassDefTests.cs.meta, apps/concordia-living-world/unity-client/Assets/Editor/LeanPlayStarveProbe.cs | AGREE |
| #1389 | DUTCH | concord-vscode/package-lock.json, concord-vscode/package.json | AGREE |

## Per-file detail

### #2357 — SUPERSEDED → HV-60
plan head 04b7b5d4b · measured head 04b7b5d4b · census: AGREE (residual empty)
- PRESENT — docs/cockpit/ARCHITECTURE.md
- PRESENT — docs/cockpit/AUDIT.md
- PRESENT — docs/cockpit/PLAN.md
- PRESENT — docs/cockpit/RESEARCH.md
- PRESENT — docs/cockpit/tickets/A-foundations.md
- PRESENT — docs/cockpit/tickets/B-engine.md
- PRESENT — docs/cockpit/tickets/C-surfaces.md
- PRESENT — docs/cockpit/tickets/D-harness.md

### #2355 — HARVEST-ALL → HV-20
plan head 15f79e529 · measured head 15f79e529 · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0.192) — server/domains/fitness.js
- ABSENT (added-line coverage 0.351) — server/tests/fitness-domain-parity.test.js

### #2354 — HARVEST-ALL → HV-21
plan head 1d20b6967 · measured head 1d20b6967 · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0.067) — concord-frontend/components/manufacturing/ShopFloorSuite.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/manufacturing/ShopFloorToolsPanel.tsx
- ABSENT (added-line coverage 0.147) — concord-frontend/components/manufacturing/manufacturing-build-slices.test.tsx
- ABSENT (added-line coverage 0.4) — concord-frontend/hooks/useDepthBadge.ts
- ABSENT (added-line coverage 0.105) — server/domains/manufacturing.js
- ABSENT (added-line coverage 0.126) — server/tests/manufacturing-build-slices.test.js

### #2352 — HARVEST-PART (minus the 3 majors) → HV-32
plan head aad164e90 · measured head aad164e90 · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0.099) — concord-frontend/package-lock.json
- ABSENT (added-line coverage 0) — concord-frontend/package.json

### #2351 — HARVEST-ALL → HV-31
plan head c915c64e1 · measured head c915c64e1 · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0.28) — server/package-lock.json
- ABSENT (added-line coverage 0) — server/package.json

### #2350 — HARVEST-ALL → HV-30
plan head c4f9a43bf · measured head c4f9a43bf · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0) — .github/workflows/codeql.yml
- ABSENT (added-line coverage 0) — .github/workflows/deploy.yml
- ABSENT (added-line coverage 0) — .github/workflows/platinum-security.yml

### #2349 — HARVEST-ALL (beats #2325) → HV-22
plan head 33026d68e · measured head 33026d68e · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0.235) — concord-frontend/components/lens/ContentPublisher.tsx
- ABSENT (added-line coverage 0.111) — concord-frontend/components/lens/LiveIndicator.tsx
- MISSING — concord-frontend/tests/chrome-fix-a6.test.tsx

### #2348 — HARVEST-ALL → HV-23
plan head b596b7279 · measured head b596b7279 · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0) — concord-frontend/components/concordia/world/LeaderboardPanel.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/finance/OverviewPanel.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/law/BillingCalculator.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/lens/IndicatorChart.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/markets/MarketsQuoteDetail.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/media/UniversalPlayer.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/music/TrackCard.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/sim/SimConsole.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/studio/EffectsPanel.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/tick/TickStreamContext.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/trades/ProjectDeskPanel.tsx
- MISSING — concord-frontend/tests/formatter-throws-p1.test.mjs

### #2347 — HARVEST-ALL → HV-24
plan head 2e239f9ac · measured head 2e239f9ac · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0) — concord-frontend/components/hr/HrBenefitsPanel.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/hr/HrClockPanel.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/hr/HrLearningPanel.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/hr/HrTimeOffPanel.tsx
- ABSENT (added-line coverage 0.101) — server/domains/hr.js
- MISSING — server/tests/hr-retain-label.test.js

### #2346 — HARVEST-ALL (flag on the new macro) → HV-13
plan head d2abdffc3 · measured head d2abdffc3 · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0) — server/domains/bounties.js
- MISSING — server/lib/autofix/bounty-proposal.js
- ABSENT (added-line coverage 0.483) — server/server.js
- MISSING — server/tests/autofix-bounty-proposal.test.js
- MISSING — server/tests/bounties-pool-definition.test.js

### #2345 — HARVEST-PART (answer leg only) → HV-25
plan head 2301b1509 · measured head 2301b1509 · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0.745) — concord-frontend/app/lenses/commonsense/page.tsx
- MISSING — concord-frontend/tests/commonsense-build.test.mjs
- PRESENT — concord-frontend/tests/commonsense-build.test.ts
- ABSENT (added-line coverage 0.675) — server/domains/commonsense.js
- PRESENT — server/migrations/498_commonsense_check_provenance.js
- MISSING — server/tests/commonsense-answer-build.test.js
- PRESENT — server/tests/commonsense-checks-build.test.js

### #2333 — SUPERSEDED → HV-60
plan head de6e355e1 · measured head de6e355e1 · census: DIFFERS (residual beyond the named member: server/domains/alliance.js, server/domains/daily.js, server/domains/literary.js, server/tests/meditation-recomplete.test.js, server/tests/wave7-parent-fk.test.js)
- APPLIED — concord-frontend/components/classroom/quiz-attempt.test.ts
- APPLIED — concord-frontend/components/education/catalog-search.test.ts
- APPLIED — concord-frontend/components/linguistics/dictionary-copy.test.ts
- APPLIED — concord-frontend/components/mentorship/rating-caption.test.ts
- APPLIED — concord-frontend/tests/accounting-depth-badge.test.ts
- APPLIED — concord-frontend/tests/components/AllianceWorkspace.test.tsx
- APPLIED — concord-frontend/tests/components/LegalCaseSearch.test.tsx
- APPLIED — concord-frontend/tests/components/ProductCatalogPanel.test.tsx
- APPLIED — concord-frontend/tests/fishing-lens-states.test.tsx
- APPLIED — concord-frontend/tests/lenses/fishing-page.test.tsx
- APPLIED — concord-frontend/tests/lenses/photos-page.test.tsx
- ABSENT (added-line coverage 0.048) — server/domains/alliance.js
- ABSENT (added-line coverage 0) — server/domains/daily.js
- ABSENT (added-line coverage 0) — server/domains/literary.js
- ABSENT (added-line coverage 0.5) — server/tests/meditation-recomplete.test.js
- ABSENT (added-line coverage 0) — server/tests/wave7-parent-fk.test.js

### #2325 — SUPERSEDED → HV-60
plan head 7202b8229 · measured head 7202b8229 · census: DIFFERS (residual beyond the named member: concord-frontend/components/lens/ContentPublisher.tsx, concord-frontend/components/lens/LiveIndicator.tsx, concord-frontend/tests/chrome-fix-a6.test.tsx)
- ABSENT (added-line coverage 0.235) — concord-frontend/components/lens/ContentPublisher.tsx
- ABSENT (added-line coverage 0.231) — concord-frontend/components/lens/LiveIndicator.tsx
- MISSING — concord-frontend/tests/chrome-fix-a6.test.tsx

### #2222 — SUPERSEDED → HV-60
plan head 08d168525 · measured head 08d168525 · census: AGREE (residual empty)
- APPLIED — concord-frontend/app/lenses/services/page.tsx
- APPLIED — concord-frontend/components/services/BookingActionDock.tsx
- LANDED-EVOLVED (added-line coverage 0.972) — concord-frontend/components/services/BookingSuite.tsx
- APPLIED — concord-frontend/components/services/RevenueRetentionPanel.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/services/ServicesDeskPanel.tsx
- APPLIED — concord-frontend/components/services/services-model.ts
- PRESENT — concord-frontend/tests/services-full-build.test.tsx
- APPLIED — server/domains/services.js
- APPLIED — server/tests/services-domain-parity.test.js
- PRESENT — server/tests/services-full-build.test.js
- APPLIED — server/tests/services-stripe-payment-intent.test.js

### #2218 — SUPERSEDED → HV-60
plan head 63ba69958 · measured head 63ba69958 · census: AGREE (residual empty)
- APPLIED — concord-frontend/app/lenses/custom/page.tsx
- LANDED-EVOLVED (added-line coverage 0.99) — concord-frontend/components/custom/CanvasBuilder.tsx
- APPLIED — concord-frontend/components/custom/DataUtilities.tsx
- APPLIED — concord-frontend/components/custom/PublicGistGallery.tsx
- PRESENT — concord-frontend/tests/custom-build.test.tsx
- APPLIED — server/domains/custom.js
- PRESENT — server/tests/custom-build.test.js

### #2217 — SUPERSEDED (follow-on is #2355) → HV-60
plan head 490557c4e · measured head 490557c4e · census: AGREE (residual empty)
- APPLIED — concord-frontend/components/fitness/WgerFeedPanel.tsx
- APPLIED — concord-frontend/tests/fitness-feed-listing.test.tsx
- LANDED-EVOLVED (added-line coverage 0.953) — server/domains/fitness.js
- LANDED-EVOLVED (added-line coverage 1) — server/tests/fitness-domain-parity.test.js

### #2215 — SUPERSEDED → HV-60
plan head 05772d773 · measured head 05772d773 · census: AGREE (residual empty)
- APPLIED — concord-frontend/components/alliance/AllianceAnalyticsPanel.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/alliance/AllianceWorkspace.tsx
- APPLIED — concord-frontend/components/alliance/FactionWarIntel.tsx
- PRESENT — concord-frontend/tests/alliance-build.test.tsx
- LANDED-EVOLVED (added-line coverage 0.967) — server/domains/alliance.js
- PRESENT — server/tests/alliance-build.test.js

### #2214 — SUPERSEDED → HV-60
plan head bdbe4adb9 · measured head bdbe4adb9 · census: AGREE (residual empty)
- APPLIED — concord-frontend/app/lenses/vote/page.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/vote/GovernanceWorkbench.tsx
- PRESENT — concord-frontend/tests/vote-build.test.tsx
- APPLIED — server/domains/vote.js
- PRESENT — server/tests/vote-build.test.js
- APPLIED — server/tests/vote-domain-parity.test.js

### #2213 — SUPERSEDED → HV-60
plan head 83b96d6c0 · measured head 83b96d6c0 · census: AGREE (residual empty)
- APPLIED — concord-frontend/app/lenses/marketing/page.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/marketing/MarketingActionPanel.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/marketing/MarketingCampaignsPanel.tsx
- APPLIED — concord-frontend/components/marketing/MarketingChannelsPanel.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/marketing/MarketingEmailPanel.tsx
- APPLIED — concord-frontend/components/marketing/MarketingGmailSendPanel.tsx
- LANDED-EVOLVED (added-line coverage 0.909) — concord-frontend/components/marketing/MarketingLeadsPanel.tsx
- APPLIED — concord-frontend/components/marketing/MarketingSEOPanel.tsx
- PRESENT — concord-frontend/tests/marketing-full-build.test.tsx
- APPLIED — server/domains/marketing.js
- PRESENT — server/tests/marketing-full-build.test.js

### #2212 — SUPERSEDED → HV-60
plan head 31937e49e · measured head 31937e49e · census: AGREE (residual empty)
- PRESENT — concord-frontend/tests/art-studio-deeplink.test.tsx
- PRESENT — concord-frontend/tests/chat-artifact-open-in-art.test.tsx

### #2211 — SUPERSEDED → HV-60
plan head e51b21594 · measured head e51b21594 · census: DIFFERS (residual beyond the named member: concord-frontend/components/bridge/ConcordLinkWalkers.tsx, concord-frontend/components/bridge/FederationConsole.tsx)
- APPLIED — concord-frontend/components/bridge/BridgeActionsPanel.tsx
- ABSENT (added-line coverage 0.875) — concord-frontend/components/bridge/ConcordLinkWalkers.tsx
- ABSENT (added-line coverage 0.864) — concord-frontend/components/bridge/FederationConsole.tsx
- PRESENT — concord-frontend/tests/bridge-build.test.tsx
- APPLIED — server/domains/bridge.js
- PRESENT — server/tests/bridge-build.test.js

### #2210 — SUPERSEDED → HV-60
plan head 7a697ebb7 · measured head 7a697ebb7 · census: AGREE (residual empty)
- APPLIED — concord-frontend/components/insurance/AmsWorkbench.tsx
- APPLIED — concord-frontend/components/insurance/InsuranceActionPanel.tsx
- APPLIED — concord-frontend/components/insurance/InsuranceClaimsPanel.tsx
- APPLIED — concord-frontend/components/insurance/InsuranceClientsPanel.tsx
- APPLIED — concord-frontend/components/insurance/InsurancePoliciesPanel.tsx
- APPLIED — concord-frontend/components/insurance/InsuranceWalletSection.tsx
- APPLIED — concord-frontend/components/insurance/MutualAidPactsPanel.tsx
- PRESENT — concord-frontend/tests/insurance-build-slices.test.tsx
- APPLIED — server/domains/insurance.js
- PRESENT — server/tests/insurance-build-slices.test.js

### #2209 — SUPERSEDED → HV-60
plan head d1ab1e89a · measured head d1ab1e89a · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/consulting/ClientPortal.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/consulting/ConsultingDeskPanel.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/consulting/EngagementTracker.tsx
- APPLIED — concord-frontend/components/consulting/ExpenseTracker.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/consulting/InvoiceManager.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/consulting/ProposalBuilder.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/consulting/RetainerManager.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/consulting/StaffingPlanner.tsx
- APPLIED — concord-frontend/components/consulting/consulting-shared.ts
- PRESENT — concord-frontend/tests/consulting-build.test.tsx
- APPLIED — server/domains/consulting.js
- PRESENT — server/tests/consulting-build.test.js

### #2208 — HARVEST-PART (the test file) → HV-27
plan head 888cd12f9 · measured head 888cd12f9 · census: AGREE (residual is the harvest §6 names)
- APPLIED — concord-frontend/app/lenses/legal/page.tsx
- APPLIED — concord-frontend/components/legal/CalendarPanel.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/legal/CaseTracker.tsx
- APPLIED — concord-frontend/components/legal/ContactsPanel.tsx
- APPLIED — concord-frontend/components/legal/IntakeFormsPanel.tsx
- APPLIED — concord-frontend/components/legal/LegalActionPanel.tsx
- APPLIED — concord-frontend/components/legal/LegalCaseSearch.tsx
- APPLIED — concord-frontend/components/legal/LegalDashboard.tsx
- APPLIED — concord-frontend/components/legal/LegalQA.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/legal/MattersPanel.tsx
- APPLIED — concord-frontend/components/legal/TimeTracker.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/hooks/useDepthBadge.ts
- APPLIED — concord-frontend/lib/lenses/manifest.ts
- PRESENT — concord-frontend/tests/legal-build-slices.test.tsx
- MISSING — concord-frontend/tests/legal-coverage.test.tsx
- APPLIED — concord-frontend/tests/legal-depth-badge.test.ts
- APPLIED — server/domains/law.js
- LANDED-EVOLVED (added-line coverage 1) — server/domains/legal.js
- APPLIED — server/tests/law-citation-graph.test.js
- APPLIED — server/tests/law-real-data-domain-parity.test.js
- PRESENT — server/tests/legal-full-build.test.js

### #2203 — SUPERSEDED → HV-60
plan head f772f57cb · measured head f772f57cb · census: DIFFERS (residual beyond the named member: concord-frontend/components/events/EventsWorkbench.tsx, server/domains/events.js, server/tests/events-planning-domain-parity.test.js)
- LANDED-EVOLVED (added-line coverage 0.935) — concord-frontend/app/lenses/gallery/page.tsx
- PRESENT — concord-frontend/components/events/EventsWorkbench.coverage.test.tsx
- ABSENT (added-line coverage 0.214) — concord-frontend/components/events/EventsWorkbench.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/tests/gallery-lens-states.test.tsx
- PRESENT — concord-frontend/tests/helpers/exercise.tsx
- ABSENT (added-line coverage 0.216) — server/domains/events.js
- APPLIED — server/domains/fashion.js
- APPLIED — server/domains/gallery.js
- ABSENT (added-line coverage 0.059) — server/tests/events-planning-domain-parity.test.js
- PRESENT — server/tests/fashion-met-feed.test.js
- APPLIED — server/tests/gallery-domain-parity.test.js
- APPLIED — server/tests/gallery-lens-macros.test.js

### #2202 — SUPERSEDED (geology stays held) → HV-60
plan head 14eca1649 · measured head 14eca1649 · census: AGREE (residual confined to the member its row names)
- ABSENT (added-line coverage 0) — concord-frontend/app/lenses/geology/page.tsx
- PRESENT — concord-frontend/components/food/Food.coverage.test.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/food/FoodActionPanel.tsx
- APPLIED — concord-frontend/components/food/FoodKitchenWorkbench.tsx
- ABSENT (added-line coverage 0.222) — concord-frontend/components/geology/FieldLog.tsx
- MISSING — concord-frontend/components/geology/FieldSitesMap.tsx
- MISSING — concord-frontend/components/geology/Geology.coverage.test.tsx
- ABSENT (added-line coverage 0.208) — concord-frontend/components/geology/RockMineralIdPanel.tsx
- ABSENT (added-line coverage 0.085) — concord-frontend/components/geology/StratigraphicColumnPanel.tsx
- ABSENT (added-line coverage 0.071) — concord-frontend/components/geology/UsgsQuakePanel.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/math/FormulaNotebookPanel.tsx
- PRESENT — concord-frontend/components/math/Math.coverage.test.tsx
- LANDED-EVOLVED (added-line coverage 0.98) — concord-frontend/components/math/MathActionPanel.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/math/MathStackFeed.tsx
- LANDED-EVOLVED (added-line coverage 0.993) — concord-frontend/components/math/SymbolicWorkbench.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/plumbing/FieldServiceConsole.tsx
- APPLIED — concord-frontend/components/plumbing/PlumbCalc.tsx
- PRESENT — concord-frontend/components/plumbing/Plumbing.coverage.test.tsx
- APPLIED — concord-frontend/components/visualizations/STSVKExplorer.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/hooks/useDepthBadge.ts
- APPLIED — concord-frontend/lib/lenses/manifest.ts
- APPLIED — concord-frontend/tests/components/FieldServiceConsoleInspections.test.tsx
- PRESENT — concord-frontend/tests/food-ops-contract.test.tsx
- PRESENT — concord-frontend/tests/food-workbench-save.test.tsx
- PRESENT — concord-frontend/tests/helpers/exercise.tsx
- ABSENT (added-line coverage 0.177) — server/domains/geology.js
- APPLIED — server/domains/math.js
- APPLIED — server/domains/plumbing.js
- APPLIED — server/lib/domain-logic-extended.js
- APPLIED — server/lib/lens-artifact-types.js
- ABSENT (added-line coverage 0) — server/tests/depth/geology-behavior.test.js
- APPLIED — server/tests/depth/plumbing-behavior.test.js
- PRESENT — server/tests/food-create-validation.test.js
- ABSENT (added-line coverage 0.145) — server/tests/geology-domain-parity.test.js
- ABSENT (added-line coverage 0) — server/tests/geology-lens-macros.test.js
- PRESENT — server/tests/math-full-build.test.js
- APPLIED — server/tests/plumbing-calculators.test.js
- APPLIED — server/tests/plumbing-domain-parity.test.js
- APPLIED — server/tests/plumbing-lens-macros.test.js

### #2200 — SUPERSEDED → HV-60
plan head 416331413 · measured head 416331413 · census: AGREE (residual empty)
- APPLIED — concord-frontend/components/art/ArtCanvas.tsx
- APPLIED — concord-frontend/components/art/ArtStudioSection.tsx
- APPLIED — concord-frontend/components/chat/ChatArtifacts.tsx
- APPLIED — server/domains/art.js
- APPLIED — server/lib/agent-marathon.js
- PRESENT — server/lib/art/art-draw.js
- PRESENT — server/lib/art/draw-fallbacks.js
- PRESENT — server/lib/art/vector-drawing.js
- APPLIED — server/lib/chat-agent.js
- APPLIED — server/lib/chat-tool-surface.js
- APPLIED — server/lib/chat/progress.js
- PRESENT — server/tests/art-draw.test.js
- APPLIED — server/tests/chat-agent-tool-protocol.test.js
- APPLIED — server/tests/chat-image-router.test.js

### #2193 — SUPERSEDED → HV-60
plan head 9842d5bd9 · measured head 9842d5bd9 · census: AGREE (residual empty)
- APPLIED — concord-frontend/app/lenses/realestate/page.tsx
- LANDED-EVOLVED (added-line coverage 0.952) — concord-frontend/components/realestate/ArtifactDeskPanel.tsx
- PRESENT — concord-frontend/components/realestate/FeedItemsPanel.tsx
- LANDED-EVOLVED (added-line coverage 0.9) — concord-frontend/components/realestate/ListingDetailDrawer.tsx
- LANDED-EVOLVED (added-line coverage 0.9) — concord-frontend/components/realestate/ListingInspectorPanel.tsx
- PRESENT — concord-frontend/components/realestate/__tests__/DeskInspectorDrawer.test.tsx
- PRESENT — concord-frontend/components/realestate/__tests__/FeedItemsPanel.test.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/hooks/useDepthBadge.ts
- APPLIED — concord-frontend/lib/lenses/manifest.ts
- APPLIED — server/domains/realestate.js
- PRESENT — server/tests/realestate-full-build.test.js

### #2191 — SUPERSEDED → HV-60
plan head 2e7984d70 · measured head 2e7984d70 · census: DIFFERS (residual beyond the named member: concord-frontend/components/manufacturing/OEEDashboard.tsx)
- APPLIED — concord-frontend/app/lenses/manufacturing/page.tsx
- PRESENT — concord-frontend/components/manufacturing/DeleteSafety.tsx
- ABSENT (added-line coverage 0.825) — concord-frontend/components/manufacturing/OEEDashboard.tsx
- LANDED-EVOLVED (added-line coverage 0.931) — concord-frontend/components/manufacturing/QualitySPC.tsx
- LANDED-EVOLVED (added-line coverage 0.995) — concord-frontend/components/manufacturing/ShopFloorSuite.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/manufacturing/ShopFloorToolsPanel.tsx
- LANDED-EVOLVED (added-line coverage 0.975) — concord-frontend/components/manufacturing/WorkOrderBoard.tsx
- PRESENT — concord-frontend/components/manufacturing/delete-safety-store.ts
- PRESENT — concord-frontend/components/manufacturing/manufacturing-build-slices.test.tsx
- PRESENT — concord-frontend/components/manufacturing/mfg-events.ts
- APPLIED — concord-frontend/lib/lenses/manifest.ts
- LANDED-EVOLVED (added-line coverage 1) — server/domains/manufacturing.js
- APPLIED — server/tests/depth/manufacturing-behavior.test.js
- PRESENT — server/tests/manufacturing-build-slices.test.js
- APPLIED — server/tests/manufacturing-domain-parity.test.js

### #2189 — SUPERSEDED → HV-60
plan head 2a4ffec97 · measured head 2a4ffec97 · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/app/lenses/mental-health/page.tsx
- LANDED-EVOLVED (added-line coverage 0.933) — concord-frontend/components/mental-health/MentalHealthActionPanel.tsx
- APPLIED — concord-frontend/components/mental-health/MhCompanionPanel.tsx
- APPLIED — concord-frontend/components/mental-health/MhMoodPanel.tsx
- APPLIED — concord-frontend/components/mental-health/MhPracticePanel.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/lib/lenses/manifest.ts
- PRESENT — concord-frontend/tests/mental-health-lens-build.test.ts
- PRESENT — concord-frontend/tests/mental-health-panels-render.test.tsx
- APPLIED — server/domains/mentalhealth.js
- LANDED-EVOLVED (added-line coverage 1) — server/lib/integration-registry.js
- PRESENT — server/tests/mental-health-lens-build.test.js
- PRESENT — server/tests/mental-health-tier-live.test.js

### #2188 — SUPERSEDED → HV-60
plan head 157f73ed9 · measured head 157f73ed9 · census: DIFFERS (residual beyond the named member: concord-frontend/components/nonprofit/CampaignManager.tsx, concord-frontend/components/nonprofit/PropublicaSearch.tsx)
- ABSENT (added-line coverage 0.769) — concord-frontend/components/nonprofit/CampaignManager.tsx
- PRESENT — concord-frontend/components/nonprofit/NonprofitCoverage.test.tsx
- APPLIED — concord-frontend/components/nonprofit/NonprofitWorkbench.tsx
- ABSENT (added-line coverage 0.8) — concord-frontend/components/nonprofit/PropublicaSearch.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/hooks/useDepthBadge.ts
- APPLIED — concord-frontend/lib/lenses/manifest.ts
- PRESENT — concord-frontend/tests/nonprofit-explorer.test.tsx
- APPLIED — server/domains/nonprofit.js
- APPLIED — server/lib/domain-logic-extended.js
- APPLIED — server/tests/depth/nonprofit-behavior.test.js
- APPLIED — server/tests/nonprofit-domain-parity.test.js

### #2185 — SUPERSEDED → HV-60
plan head 3b4a39dcf · measured head 3b4a39dcf · census: DIFFERS (residual beyond the named member: concord-frontend/components/cooking/CookingActionPanel.tsx)
- APPLIED — concord-frontend/app/lenses/cooking/page.tsx
- APPLIED — concord-frontend/components/cooking/CookMode.tsx
- ABSENT (added-line coverage 0.568) — concord-frontend/components/cooking/CookingActionPanel.tsx
- PRESENT — concord-frontend/components/cooking/CookingBench.coverage.test.tsx
- APPLIED — concord-frontend/components/cooking/RecipeBoxSection.tsx
- PRESENT — concord-frontend/components/cooking/UnitConverter.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/hooks/useDepthBadge.ts
- APPLIED — concord-frontend/lib/lenses/manifest.ts
- PRESENT — concord-frontend/tests/components/cooking-full-build.test.tsx
- APPLIED — server/domains/cooking.js
- APPLIED — server/domains/free-api-live.js
- APPLIED — server/lib/integration-registry.js
- APPLIED — server/tests/cooking-domain-parity.test.js
- PRESENT — server/tests/cooking-full-build.test.js
- APPLIED — server/tests/depth/cooking-behavior.test.js
- PRESENT — server/tests/e2e/cooking-full-build.test.js

### #2183 — SUPERSEDED → HV-60
plan head 3cccae2bf · measured head 3cccae2bf · census: AGREE (residual empty)
- APPLIED — concord-frontend/app/lenses/hr/page.tsx
- APPLIED — concord-frontend/components/hr/BlsWageForecast.tsx
- APPLIED — concord-frontend/components/hr/HrBenefitsPanel.tsx
- APPLIED — concord-frontend/components/hr/HrCompliancePanel.tsx
- APPLIED — concord-frontend/components/hr/HrPayrollPanel.tsx
- LANDED-EVOLVED (added-line coverage 0.967) — concord-frontend/components/hr/HrPeoplePanel.tsx
- PRESENT — concord-frontend/tests/hr-build.test.tsx
- APPLIED — server/domains/hr.js
- PRESENT — server/tests/hr-build.test.js

### #2182 — SUPERSEDED → HV-60
plan head 650219c18 · measured head 650219c18 · census: DIFFERS (residual beyond the named member: concord-frontend/components/supplychain/SupplyChainActionPanel.tsx)
- LANDED-EVOLVED (added-line coverage 0.955) — concord-frontend/components/supplychain/OrgCollabPanel.tsx
- ABSENT (added-line coverage 0.732) — concord-frontend/components/supplychain/SupplyChainActionPanel.tsx
- LANDED-EVOLVED (added-line coverage 0.963) — concord-frontend/components/supplychain/SupplyChainOverview.tsx
- LANDED-EVOLVED (added-line coverage 0.928) — concord-frontend/components/supplychain/SupplyChainPlanner.tsx
- APPLIED — concord-frontend/lib/lenses/manifest.ts
- PRESENT — concord-frontend/tests/supplychain-build-slices.test.tsx
- LANDED-EVOLVED (added-line coverage 0.987) — server/domains/supplychain.js
- PRESENT — server/tests/supplychain-build-slices.test.js

### #2174 — SUPERSEDED → HV-60
plan head c12c01897 · measured head c12c01897 · census: AGREE (residual empty)
- APPLIED — concord-frontend/app/lenses/worldmodel/page.tsx
- APPLIED — concord-frontend/components/worldmodel/ComparePanel.tsx
- PRESENT — concord-frontend/components/worldmodel/DeleteSafety.tsx
- APPLIED — concord-frontend/components/worldmodel/EntitiesPanel.tsx
- APPLIED — concord-frontend/components/worldmodel/LibraryPanel.tsx
- APPLIED — concord-frontend/components/worldmodel/RelationsPanel.tsx
- APPLIED — concord-frontend/components/worldmodel/SimulatePanel.tsx
- APPLIED — concord-frontend/components/worldmodel/SnapshotsPanel.tsx
- PRESENT — concord-frontend/components/worldmodel/delete-safety-store.ts
- APPLIED — concord-frontend/components/worldmodel/wm-shared.tsx
- PRESENT — concord-frontend/tests/components/WorldmodelBuild.test.tsx
- PRESENT — server/tests/worldmodel-build-slices.test.js

### #2170 — SUPERSEDED → HV-60
plan head eab3ca8fa · measured head eab3ca8fa · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/chat/lensAccountFacts.ts
- APPLIED — concord-frontend/components/conkay/workbench/WorkbenchPages.tsx
- APPLIED — concord-frontend/components/conkay/workspace/BeamViewport.tsx
- APPLIED — concord-frontend/components/conkay/workspace/ConKayWorkspace.tsx
- LANDED-EVOLVED (added-line coverage 0.973) — concord-frontend/components/conkay/workspace/ParameterPanel.tsx
- APPLIED — concord-frontend/components/conkay/workspace/WorkspaceNav.tsx
- APPLIED — concord-frontend/components/conkay/workspace/useConKayWorkspace.ts
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/hooks/useDepthBadge.ts
- APPLIED — concord-frontend/lib/conkay/workspace-commands.ts
- PRESENT — concord-frontend/lib/material-format.ts
- PRESENT — concord-frontend/tests/conkay-account-facts.test.ts
- APPLIED — concord-frontend/tests/conkay-workspace.test.tsx
- PRESENT — concord-frontend/tests/lib/conkay-scope-and-materials.test.ts
- APPLIED — server/domains/engineering.js
- APPLIED — server/lib/dtu-list-source.js
- PRESENT — server/tests/conkay-build.test.js

### #2168 — SUPERSEDED → HV-60
plan head b83919b02 · measured head b83919b02 · census: AGREE (residual empty)
- APPLIED — concord-frontend/components/environment/EnviroPanel.tsx
- APPLIED — concord-frontend/components/environment/FieldMonitoringPanel.tsx
- APPLIED — concord-frontend/components/environment/FieldOpsPanel.tsx
- APPLIED — concord-frontend/components/environment/GbifPanel.tsx
- APPLIED — concord-frontend/components/environment/ScenarioModeler.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/hooks/useDepthBadge.ts
- APPLIED — concord-frontend/lib/lenses/manifest.ts
- APPLIED — server/lib/domain-logic-extended.js
- PRESENT — server/tests/environment-site-manager-status.test.js

### #2165 — SUPERSEDED → HV-60
plan head ce47ecb2e · measured head ce47ecb2e · census: DIFFERS (residual beyond the named member: concord-frontend/components/engineering/ModelPanel.tsx)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/app/lenses/engineering/page.tsx
- APPLIED — concord-frontend/components/engineering/BomPanel.tsx
- LANDED-EVOLVED (added-line coverage 0.947) — concord-frontend/components/engineering/EngineeringActionPanel.tsx
- APPLIED — concord-frontend/components/engineering/EngineeringFeaProvider.tsx
- APPLIED — concord-frontend/components/engineering/HnEngineeringFeed.tsx
- APPLIED — concord-frontend/components/engineering/LoadsPanel.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/engineering/MaterialsPanel.tsx
- ABSENT (added-line coverage 0.871) — concord-frontend/components/engineering/ModelPanel.tsx
- APPLIED — concord-frontend/components/engineering/MultiDisciplineCalcPanel.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/engineering/MultiPhysicsPanel.tsx
- PRESENT — concord-frontend/components/engineering/NumCell.tsx
- LANDED-EVOLVED (added-line coverage 0.962) — concord-frontend/components/engineering/ResultsPanel.tsx
- APPLIED — concord-frontend/components/engineering/TolerancePanel.tsx
- APPLIED — concord-frontend/components/engineering/fea-verification.ts
- APPLIED — server/domains/engineering.js
- APPLIED — server/tests/engineering-domain-parity.test.js

### #2163 — SUPERSEDED → HV-60
plan head 6d5902ac7 · measured head 6d5902ac7 · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/math/FormulaNotebookPanel.tsx
- LANDED-EVOLVED (added-line coverage 0.98) — concord-frontend/components/math/MathActionPanel.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/math/MathStackFeed.tsx
- LANDED-EVOLVED (added-line coverage 0.993) — concord-frontend/components/math/SymbolicWorkbench.tsx
- APPLIED — concord-frontend/components/visualizations/STSVKExplorer.tsx
- APPLIED — server/domains/math.js
- APPLIED — server/lib/lens-artifact-types.js
- PRESENT — server/tests/math-full-build.test.js

### #2161 — SUPERSEDED → HV-60
plan head ff8f1424d · measured head ff8f1424d · census: AGREE (residual empty)
- APPLIED — concord-frontend/app/lenses/space/page.tsx
- APPLIED — concord-frontend/components/space/ApodFeed.tsx
- APPLIED — concord-frontend/components/space/LaunchCountdown.tsx
- APPLIED — concord-frontend/components/space/RocketDetail.tsx
- PRESENT — concord-frontend/components/space/SpaceArtifactPanel.test.tsx
- APPLIED — concord-frontend/components/space/SpaceArtifactPanel.tsx
- APPLIED — concord-frontend/components/space/SpaceflightNewsPanel.tsx
- APPLIED — concord-frontend/components/space/UpcomingLaunchesPanel.tsx
- APPLIED — server/domains/space.js
- PRESENT — server/tests/space-build.test.js

### #2151 — SUPERSEDED (bounties part → HV-13) → HV-13 / HV-60
plan head e0c4c8c9a · measured head e0c4c8c9a · census: DIFFERS (residual beyond the named member: concord-frontend/app/hub/page.tsx, concord-frontend/components/defense/MissionPlanner.tsx, concord-frontend/hooks/useDepthBadge.ts, concord-frontend/lib/lenses/manifest.ts)
- ABSENT (added-line coverage 0) — concord-frontend/app/hub/page.tsx
- APPLIED — concord-frontend/app/lenses/artistry/page.tsx
- ABSENT (added-line coverage 0.043) — concord-frontend/app/lenses/bounties/page.tsx
- APPLIED — concord-frontend/app/lenses/desert/page.tsx
- APPLIED — concord-frontend/app/lenses/law-enforcement/page.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/artistry/ProjectStudio.tsx
- PRESENT — concord-frontend/components/artistry/StudyCanvas.tsx
- APPLIED — concord-frontend/components/artistry/index.ts
- ABSENT (added-line coverage 0.321) — concord-frontend/components/bounties/BountyCard.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/bounties/BountyFilters.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/bounties/BountyLeaderboard.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/bounties/CreateBountyForm.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/bounties/GhsaAdvisories.tsx
- MISSING — concord-frontend/components/bounties/__tests__/Bounties.coverage.test.tsx
- ABSENT (added-line coverage 0.188) — concord-frontend/components/bounties/types.ts
- APPLIED — concord-frontend/components/defense/AssetReadiness.tsx
- LANDED-EVOLVED (added-line coverage 0.928) — concord-frontend/components/defense/CommonOperatingPicture.tsx
- LANDED-EVOLVED (added-line coverage 0.957) — concord-frontend/components/defense/CommsLog.tsx
- PRESENT — concord-frontend/components/defense/ConfirmDeleteButton.tsx
- PRESENT — concord-frontend/components/defense/Defense.coverage.test.tsx
- APPLIED — concord-frontend/components/defense/DefenseWorkspace.tsx
- PRESENT — concord-frontend/components/defense/EventFeed.tsx
- LANDED-EVOLVED (added-line coverage 0.957) — concord-frontend/components/defense/LogisticsBoard.tsx
- ABSENT (added-line coverage 0.739) — concord-frontend/components/defense/MissionPlanner.tsx
- APPLIED — concord-frontend/components/defense/PersonnelRoster.tsx
- LANDED-EVOLVED (added-line coverage 0.957) — concord-frontend/components/defense/ThreatBoard.tsx
- LANDED-EVOLVED (added-line coverage 0.973) — concord-frontend/components/desert/DesertWeatherWatch.tsx
- APPLIED — concord-frontend/components/desert/SolarCalculator.tsx
- PRESENT — concord-frontend/components/desert/__tests__/Desert.coverage.test.tsx
- LANDED-EVOLVED (added-line coverage 0.988) — concord-frontend/components/emergency-services/CADConsole.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/emergency-services/EmergencyWorkspace.tsx
- PRESENT — concord-frontend/components/emergency-services/__tests__/CADConsole.coverage.test.tsx
- APPLIED — concord-frontend/components/law-enforcement/CaseManagementPanel.tsx
- LANDED-EVOLVED (added-line coverage 0.966) — concord-frontend/components/law-enforcement/LawEnforcementActionPanel.tsx
- PRESENT — concord-frontend/components/law-enforcement/LimitationNotice.tsx
- APPLIED — concord-frontend/components/law-enforcement/RmsCadConsole.tsx
- PRESENT — concord-frontend/components/law-enforcement/__tests__/LawEnforcementPanels.coverage.test.tsx
- PRESENT — concord-frontend/components/law-enforcement/__tests__/RmsCadConsole.coverage.test.tsx
- PRESENT — concord-frontend/components/lens/LimitationNotice.tsx
- LANDED-EVOLVED (added-line coverage 0.962) — concord-frontend/components/masonry/ContractorSuite.tsx
- PRESENT — concord-frontend/components/masonry/__tests__/ContractorSuite.coverage.test.tsx
- ABSENT (added-line coverage 0.839) — concord-frontend/hooks/useDepthBadge.ts
- APPLIED — concord-frontend/lib/lens-registry.ts
- ABSENT (added-line coverage 0.8) — concord-frontend/lib/lenses/manifest.ts
- APPLIED — concord-frontend/tests/artistry-lens-states.test.tsx
- MISSING — concord-frontend/tests/bounties-depth-badge.test.ts
- APPLIED — concord-frontend/tests/components/ContractorSuiteInspectionsCerts.test.tsx
- PRESENT — concord-frontend/tests/defense-delete-confirm.test.tsx
- PRESENT — concord-frontend/tests/defense-event-feed.test.tsx
- APPLIED — concord-frontend/tests/defense-lens-states.test.tsx
- PRESENT — concord-frontend/tests/defense-map-legibility.test.tsx
- PRESENT — concord-frontend/tests/emergency-services-cad-roster.test.tsx
- APPLIED — concord-frontend/tests/emergency-services-lens-states.test.tsx
- PRESENT — concord-frontend/tests/helpers/exercise.tsx
- PRESENT — concord-frontend/tests/masonry-delete-confirm.test.tsx
- PRESENT — concord-frontend/tests/masonry-depth-badge.test.ts
- PRESENT — concord-frontend/tests/masonry-modal-typing.test.tsx
- PRESENT — concord-frontend/tests/masonry-stats-refresh.test.tsx
- PRESENT — concord-frontend/tests/study-canvas.test.tsx
- APPLIED — content/contracts/overrides/law-enforcement.caseAnalysis.json
- PRESENT — content/contracts/overrides/law-enforcement.caseDelete.json
- APPLIED — content/contracts/overrides/law-enforcement.crimeStats.json
- PRESENT — content/contracts/overrides/law-enforcement.evidenceTransfer.json
- APPLIED — server/domains/artistry.js
- ABSENT (added-line coverage 0.286) — server/domains/bounties.js
- APPLIED — server/domains/defense.js
- LANDED-EVOLVED (added-line coverage 1) — server/domains/emergencyservices.js
- LANDED-EVOLVED (added-line coverage 1) — server/domains/lawenforcement.js
- LANDED-EVOLVED (added-line coverage 1) — server/lib/integration-registry.js
- APPLIED — server/tests/artistry-study-restart.test.js
- MISSING — server/tests/bounties-build.test.js
- APPLIED — server/tests/defense-lens-macros.test.js
- ABSENT (added-line coverage 0.125) — server/tests/depth/bounties-behavior.test.js
- PRESENT — server/tests/e2e/emergency-services-unit-lifecycle.test.js
- PRESENT — server/tests/emergency-services-unit-lifecycle.test.js
- PRESENT — server/tests/law-enforcement-full-build.test.js

### #2150 — SUPERSEDED → HV-60
plan head d47374a71 · measured head d47374a71 · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/food/FoodActionPanel.tsx
- APPLIED — concord-frontend/components/food/FoodKitchenWorkbench.tsx
- PRESENT — concord-frontend/tests/food-ops-contract.test.tsx
- PRESENT — concord-frontend/tests/food-workbench-save.test.tsx
- APPLIED — server/lib/domain-logic-extended.js
- APPLIED — server/lib/lens-artifact-types.js
- PRESENT — server/tests/food-create-validation.test.js

### #2149 — SUPERSEDED → HV-60
plan head b777bddf4 · measured head b777bddf4 · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 0.962) — concord-frontend/components/masonry/ContractorSuite.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/hooks/useDepthBadge.ts
- APPLIED — concord-frontend/lib/lenses/manifest.ts
- APPLIED — concord-frontend/tests/components/ContractorSuiteInspectionsCerts.test.tsx
- PRESENT — concord-frontend/tests/masonry-delete-confirm.test.tsx
- PRESENT — concord-frontend/tests/masonry-depth-badge.test.ts
- PRESENT — concord-frontend/tests/masonry-modal-typing.test.tsx
- PRESENT — concord-frontend/tests/masonry-stats-refresh.test.tsx

### #2148 — SUPERSEDED → HV-60
plan head c5dcbd8d6 · measured head c5dcbd8d6 · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/plumbing/FieldServiceConsole.tsx
- APPLIED — concord-frontend/components/plumbing/PlumbCalc.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/hooks/useDepthBadge.ts
- APPLIED — concord-frontend/lib/lenses/manifest.ts
- APPLIED — concord-frontend/tests/components/FieldServiceConsoleInspections.test.tsx
- APPLIED — server/domains/plumbing.js
- APPLIED — server/tests/depth/plumbing-behavior.test.js
- APPLIED — server/tests/plumbing-calculators.test.js
- APPLIED — server/tests/plumbing-domain-parity.test.js
- APPLIED — server/tests/plumbing-lens-macros.test.js

### #2145 — SUPERSEDED → HV-60
plan head 24d7a13e6 · measured head 24d7a13e6 · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 0.988) — concord-frontend/components/emergency-services/CADConsole.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/emergency-services/EmergencyWorkspace.tsx
- PRESENT — concord-frontend/components/lens/LimitationNotice.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/hooks/useDepthBadge.ts
- APPLIED — concord-frontend/lib/lenses/manifest.ts
- PRESENT — concord-frontend/tests/emergency-services-cad-roster.test.tsx
- APPLIED — concord-frontend/tests/emergency-services-lens-states.test.tsx
- LANDED-EVOLVED (added-line coverage 1) — server/domains/emergencyservices.js
- LANDED-EVOLVED (added-line coverage 1) — server/lib/integration-registry.js
- PRESENT — server/tests/e2e/emergency-services-unit-lifecycle.test.js
- PRESENT — server/tests/emergency-services-unit-lifecycle.test.js

### #2144 — SUPERSEDED → HV-60
plan head 51b788774 · measured head 51b788774 · census: DIFFERS (residual beyond the named member: server/domains/photos.js, server/routes/photos.js, server/tests/photo-gallery.test.js)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/app/lenses/photos/page.tsx
- LANDED-EVOLVED (added-line coverage 0.967) — concord-frontend/components/photos/PhotoLightboxModal.tsx
- APPLIED — concord-frontend/tests/photos-lens-states.test.tsx
- APPLIED — concord-frontend/tests/photos-lightbox.test.tsx
- ABSENT (added-line coverage 0.667) — server/domains/photos.js
- LANDED-EVOLVED (added-line coverage 0.947) — server/lib/photo-gallery.js
- PRESENT — server/migrations/496_photo_metadata.js
- ABSENT (added-line coverage 0.5) — server/routes/photos.js
- APPLIED — server/server.js
- ABSENT (added-line coverage 0.833) — server/tests/photo-gallery.test.js
- LANDED-EVOLVED (added-line coverage 0.952) — server/tests/photos-domain-macros.test.js
- APPLIED — server/tests/photos-routes.test.js

### #2143 — SUPERSEDED (automotive stays held) → HV-60
plan head 29a1038ea · measured head 29a1038ea · census: DIFFERS (residual beyond the named member: concord-frontend/components/creative/CreativeBoardsSection.tsx)
- LANDED-EVOLVED (added-line coverage 0.99) — concord-frontend/app/lenses/animation/page.tsx
- ABSENT (added-line coverage 0) — concord-frontend/app/lenses/automotive/page.tsx
- APPLIED — concord-frontend/app/lenses/creative/page.tsx
- LANDED-EVOLVED (added-line coverage 0.967) — concord-frontend/app/lenses/film-studios/page.tsx
- APPLIED — concord-frontend/app/lenses/game-design/page.tsx
- APPLIED — concord-frontend/app/lenses/poetry/page.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/animation/AnimationStudioSection.tsx
- PRESENT — concord-frontend/components/animation/__tests__/AnimationStudioSection.coverage.test.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/automotive/FuelRepairPanel.tsx
- ABSENT (added-line coverage 0.075) — concord-frontend/components/automotive/GarageSection.tsx
- ABSENT (added-line coverage 0.12) — concord-frontend/components/automotive/VehicleHistory.tsx
- ABSENT (added-line coverage 0.122) — concord-frontend/components/automotive/VinDecoder.tsx
- MISSING — concord-frontend/components/automotive/__tests__/Automotive.coverage.test.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/creative/CreativeActionPanel.tsx
- ABSENT (added-line coverage 0.824) — concord-frontend/components/creative/CreativeBoardsSection.tsx
- APPLIED — concord-frontend/components/creative/CreativeDashboardStrip.tsx
- PRESENT — concord-frontend/components/creative/CreativeProduction.coverage.test.tsx
- LANDED-EVOLVED (added-line coverage 0.977) — concord-frontend/components/creative/ProductionSuite.tsx
- PRESENT — concord-frontend/lib/creative/dashboard-bus.ts
- APPLIED — concord-frontend/tests/animation-lens-states.test.tsx
- PRESENT — concord-frontend/tests/creative-boards-delete-confirm.test.tsx
- PRESENT — concord-frontend/tests/creative-dashboard-bus.test.ts
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/tests/creative-lens-states.test.tsx
- APPLIED — concord-frontend/tests/film-studios-lens-states.test.tsx
- APPLIED — concord-frontend/tests/game-design-lens-states.test.tsx
- PRESENT — concord-frontend/tests/helpers/exercise.tsx
- APPLIED — concord-frontend/tests/poetry-lens-states.test.tsx
- APPLIED — server/domains/animation.js
- ABSENT (added-line coverage 0.25) — server/domains/automotive.js
- APPLIED — server/domains/filmstudios.js
- APPLIED — server/domains/gamedesign.js
- APPLIED — server/domains/poetry.js
- APPLIED — server/tests/animation-shot-restart.test.js
- ABSENT (added-line coverage 0.313) — server/tests/automotive-lens-macros.test.js
- ABSENT (added-line coverage 0) — server/tests/depth/automotive-behavior.test.js
- APPLIED — server/tests/film-studios-lens-macros.test.js
- APPLIED — server/tests/game-design-restart.test.js
- LANDED-EVOLVED (added-line coverage 1) — server/tests/lens-export.test.js
- APPLIED — server/tests/poetry-poem-restart.test.js

### #2142 — SUPERSEDED → HV-60
plan head da2e48f22 · measured head da2e48f22 · census: AGREE (residual empty)
- APPLIED — concord-frontend/app/lenses/artistry/page.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/artistry/ProjectStudio.tsx
- PRESENT — concord-frontend/components/artistry/StudyCanvas.tsx
- APPLIED — concord-frontend/components/artistry/index.ts
- APPLIED — concord-frontend/tests/artistry-lens-states.test.tsx
- PRESENT — concord-frontend/tests/study-canvas.test.tsx
- APPLIED — server/domains/artistry.js
- APPLIED — server/tests/artistry-study-restart.test.js

### #2141 — SUPERSEDED → HV-60
plan head 5d2824723 · measured head 5d2824723 · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 0.99) — concord-frontend/app/lenses/animation/page.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/animation/AnimationStudioSection.tsx
- APPLIED — concord-frontend/tests/animation-lens-states.test.tsx
- APPLIED — server/domains/animation.js
- APPLIED — server/tests/animation-shot-restart.test.js

### #2140 — SUPERSEDED → HV-60
plan head f1f114a83 · measured head f1f114a83 · census: AGREE (residual empty)
- APPLIED — concord-frontend/app/lenses/law-enforcement/page.tsx
- APPLIED — concord-frontend/components/law-enforcement/CaseManagementPanel.tsx
- LANDED-EVOLVED (added-line coverage 0.966) — concord-frontend/components/law-enforcement/LawEnforcementActionPanel.tsx
- PRESENT — concord-frontend/components/law-enforcement/LimitationNotice.tsx
- APPLIED — concord-frontend/components/law-enforcement/RmsCadConsole.tsx
- APPLIED — content/contracts/overrides/law-enforcement.caseAnalysis.json
- PRESENT — content/contracts/overrides/law-enforcement.caseDelete.json
- APPLIED — content/contracts/overrides/law-enforcement.crimeStats.json
- PRESENT — content/contracts/overrides/law-enforcement.evidenceTransfer.json
- LANDED-EVOLVED (added-line coverage 1) — server/domains/lawenforcement.js
- PRESENT — server/tests/law-enforcement-full-build.test.js

### #2139 — SUPERSEDED → HV-60
plan head 31d4eee3b · measured head 31d4eee3b · census: DIFFERS (residual beyond the named member: concord-frontend/components/defense/MissionPlanner.tsx)
- APPLIED — concord-frontend/components/defense/AssetReadiness.tsx
- LANDED-EVOLVED (added-line coverage 0.928) — concord-frontend/components/defense/CommonOperatingPicture.tsx
- LANDED-EVOLVED (added-line coverage 0.957) — concord-frontend/components/defense/CommsLog.tsx
- PRESENT — concord-frontend/components/defense/ConfirmDeleteButton.tsx
- APPLIED — concord-frontend/components/defense/DefenseWorkspace.tsx
- PRESENT — concord-frontend/components/defense/EventFeed.tsx
- LANDED-EVOLVED (added-line coverage 0.957) — concord-frontend/components/defense/LogisticsBoard.tsx
- ABSENT (added-line coverage 0.739) — concord-frontend/components/defense/MissionPlanner.tsx
- APPLIED — concord-frontend/components/defense/PersonnelRoster.tsx
- LANDED-EVOLVED (added-line coverage 0.957) — concord-frontend/components/defense/ThreatBoard.tsx
- APPLIED — concord-frontend/lib/lens-registry.ts
- PRESENT — concord-frontend/tests/defense-delete-confirm.test.tsx
- PRESENT — concord-frontend/tests/defense-event-feed.test.tsx
- APPLIED — concord-frontend/tests/defense-lens-states.test.tsx
- PRESENT — concord-frontend/tests/defense-map-legibility.test.tsx
- APPLIED — server/domains/defense.js
- APPLIED — server/tests/defense-lens-macros.test.js

### #2138 — SUPERSEDED → HV-60
plan head d9d93ed41 · measured head d9d93ed41 · census: DIFFERS (residual beyond the named member: concord-frontend/components/retail/StorefrontShell.tsx)
- APPLIED — concord-frontend/app/lenses/retail/page.tsx
- APPLIED — concord-frontend/components/lens/ShellPreview.tsx
- LANDED-EVOLVED (added-line coverage 0.909) — concord-frontend/components/retail/CustomersPanel.tsx
- PRESENT — concord-frontend/components/retail/FeedItemsPanel.tsx
- APPLIED — concord-frontend/components/retail/LivePosTerminal.tsx
- APPLIED — concord-frontend/components/retail/ProductCatalogPanel.tsx
- APPLIED — concord-frontend/components/retail/RetailWorkbench.tsx
- APPLIED — concord-frontend/components/retail/SalesAnalytics.tsx
- ABSENT (added-line coverage 0.803) — concord-frontend/components/retail/StorefrontShell.tsx
- APPLIED — concord-frontend/components/retail/TaxRatesPanel.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/hooks/useDepthBadge.ts
- APPLIED — concord-frontend/lib/lenses/manifest.ts
- PRESENT — concord-frontend/tests/retail-money-truth-ui.test.tsx
- APPLIED — server/domains/retail.js
- APPLIED — server/lib/domain-logic-extended.js
- PRESENT — server/tests/depth/retail-money-truth.test.js

### #2136 — HARVEST-PART (branch fixes win on overlap) → HV-13
plan head b5ddcfef6 · measured head b5ddcfef6 · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0) — concord-frontend/app/hub/page.tsx
- ABSENT (added-line coverage 0.043) — concord-frontend/app/lenses/bounties/page.tsx
- ABSENT (added-line coverage 0.321) — concord-frontend/components/bounties/BountyCard.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/bounties/BountyFilters.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/bounties/BountyLeaderboard.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/bounties/CreateBountyForm.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/bounties/GhsaAdvisories.tsx
- ABSENT (added-line coverage 0.188) — concord-frontend/components/bounties/types.ts
- ABSENT (added-line coverage 0.444) — concord-frontend/hooks/useDepthBadge.ts
- ABSENT (added-line coverage 0) — concord-frontend/lib/lenses/manifest.ts
- MISSING — concord-frontend/tests/bounties-depth-badge.test.ts
- ABSENT (added-line coverage 0.286) — server/domains/bounties.js
- MISSING — server/tests/bounties-build.test.js

### #2135 — SUPERSEDED → HV-60
plan head 0bc7b145c · measured head 0bc7b145c · census: AGREE (residual empty)
- APPLIED — concord-frontend/app/lenses/poetry/page.tsx
- APPLIED — concord-frontend/tests/poetry-lens-states.test.tsx
- APPLIED — server/domains/poetry.js
- LANDED-EVOLVED (added-line coverage 1) — server/tests/lens-export.test.js
- APPLIED — server/tests/poetry-poem-restart.test.js

### #2133 — SUPERSEDED → HV-60
plan head 4764889a7 · measured head 4764889a7 · census: AGREE (residual empty)
- APPLIED — concord-frontend/app/lenses/game-design/page.tsx
- APPLIED — concord-frontend/tests/game-design-lens-states.test.tsx
- APPLIED — server/domains/gamedesign.js
- APPLIED — server/tests/game-design-restart.test.js

### #2132 — SUPERSEDED → HV-60
plan head ab4567569 · measured head ab4567569 · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 0.967) — concord-frontend/app/lenses/film-studios/page.tsx
- APPLIED — concord-frontend/tests/film-studios-lens-states.test.tsx
- APPLIED — server/domains/filmstudios.js
- APPLIED — server/tests/film-studios-lens-macros.test.js

### #2131 — SUPERSEDED → HV-60
plan head b9e526a32 · measured head b9e526a32 · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 0.984) — concord-frontend/app/lenses/maker/page.tsx
- APPLIED — concord-frontend/tests/maker-lens-states.test.tsx
- PRESENT — server/domains/maker.js
- PRESENT — server/migrations/497_maker_pieces.js
- APPLIED — server/server.js
- PRESENT — server/tests/maker-domain.test.js

### #2130 — SUPERSEDED → HV-60
plan head cd83b3176 · measured head cd83b3176 · census: DIFFERS (residual beyond the named member: concord-frontend/components/creative/CreativeBoardsSection.tsx)
- APPLIED — concord-frontend/app/lenses/creative/page.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/creative/CreativeActionPanel.tsx
- ABSENT (added-line coverage 0.824) — concord-frontend/components/creative/CreativeBoardsSection.tsx
- APPLIED — concord-frontend/components/creative/CreativeDashboardStrip.tsx
- LANDED-EVOLVED (added-line coverage 0.977) — concord-frontend/components/creative/ProductionSuite.tsx
- PRESENT — concord-frontend/lib/creative/dashboard-bus.ts
- PRESENT — concord-frontend/tests/creative-boards-delete-confirm.test.tsx
- PRESENT — concord-frontend/tests/creative-dashboard-bus.test.ts
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/tests/creative-lens-states.test.tsx

### #2129 — SUPERSEDED → HV-60
plan head 6f0e34b92 · measured head 6f0e34b92 · census: DIFFERS (residual beyond the named member: concord-frontend/components/events/EventsWorkbench.tsx, concord-frontend/tests/fishing-lens-states.test.tsx, server/domains/events.js, server/tests/events-planning-domain-parity.test.js)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/app/lenses/fishing/page.tsx
- LANDED-EVOLVED (added-line coverage 0.935) — concord-frontend/app/lenses/gallery/page.tsx
- ABSENT (added-line coverage 0.214) — concord-frontend/components/events/EventsWorkbench.tsx
- LANDED-EVOLVED (added-line coverage 0.959) — concord-frontend/components/fishing/CatchLog.tsx
- LANDED-EVOLVED (added-line coverage 0.953) — concord-frontend/components/fishing/SpeciesCatalog.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/fishing/types.ts
- APPLIED — concord-frontend/components/world-lens/FishingMinigameOverlay.tsx
- ABSENT (added-line coverage 0.4) — concord-frontend/tests/fishing-lens-states.test.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/tests/gallery-lens-states.test.tsx
- APPLIED — concord-frontend/tests/lenses/fishing-page.test.tsx
- ABSENT (added-line coverage 0.216) — server/domains/events.js
- APPLIED — server/domains/fashion.js
- APPLIED — server/domains/fishing.js
- APPLIED — server/domains/gallery.js
- APPLIED — server/lib/event-shapes.js
- APPLIED — server/lib/fishing.js
- APPLIED — server/routes/fishing.js
- ABSENT (added-line coverage 0.059) — server/tests/events-planning-domain-parity.test.js
- PRESENT — server/tests/fashion-met-feed.test.js
- APPLIED — server/tests/fishing.test.js
- APPLIED — server/tests/gallery-domain-parity.test.js
- APPLIED — server/tests/gallery-lens-macros.test.js

### #2128 — SUPERSEDED → HV-60
plan head cc7cb57bb · measured head cc7cb57bb · census: AGREE (residual empty)
- APPLIED — concord-frontend/app/lenses/app-maker/page.tsx
- LANDED-EVOLVED (added-line coverage 0.931) — concord-frontend/app/lenses/creative-writing/page.tsx
- PRESENT — concord-frontend/components/app-maker/ActionsPanel.test.tsx
- APPLIED — concord-frontend/components/app-maker/ActionsPanel.tsx
- PRESENT — concord-frontend/components/app-maker/AppBuilderStudio.coverage.test.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/app-maker/AppBuilderStudio.tsx
- PRESENT — concord-frontend/components/app-maker/AppMakerProjectContext.tsx
- APPLIED — concord-frontend/components/app-maker/AppsPanel.test.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/app-maker/AppsPanel.tsx
- LANDED-EVOLVED (added-line coverage 0.917) — concord-frontend/components/sim/AgentBasedRunner.tsx
- APPLIED — concord-frontend/components/sim/DiscreteEventRunner.tsx
- APPLIED — concord-frontend/components/sim/SimConsole.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/sim/SimToolkit.tsx
- LANDED-EVOLVED (added-line coverage 0.969) — concord-frontend/components/sim/SystemDynamicsBuilder.tsx
- PRESENT — concord-frontend/components/sim/__tests__/SimConsole.coverage.test.tsx
- PRESENT — concord-frontend/components/sim/__tests__/SimRunners.coverage.test.tsx
- PRESENT — concord-frontend/components/sim/extractRunArtifactId.test.ts
- PRESENT — concord-frontend/lib/app-maker/project-to-compute-input.ts
- PRESENT — concord-frontend/lib/sim/format.ts
- PRESENT — concord-frontend/lib/sim/studio-activity.ts
- APPLIED — concord-frontend/tests/app-maker-lens-states.test.tsx
- PRESENT — concord-frontend/tests/app-maker-n-shortcut.test.tsx
- APPLIED — concord-frontend/tests/creative-writing-lens-states.test.tsx
- PRESENT — concord-frontend/tests/helpers/exercise.tsx
- PRESENT — concord-frontend/tests/lib/sim-format.test.tsx
- PRESENT — concord-frontend/tests/lib/sim-studio-activity.test.tsx
- APPLIED — server/domains/appmaker.js
- APPLIED — server/domains/creativewriting.js
- APPLIED — server/lib/domain-logic.js
- APPLIED — server/tests/app-maker-domain-parity.test.js
- APPLIED — server/tests/appmaker-lens-macros.test.js
- PRESENT — server/tests/sim-run-artifact-lifecycle.test.js

### #2124 — SUPERSEDED → HV-60
plan head 38636e67e · measured head 38636e67e · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 0.957) — concord-frontend/app/lenses/garage/page.tsx
- LANDED-EVOLVED (added-line coverage 0.978) — concord-frontend/components/garage/VehicleInspectorPanel.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/hooks/useDepthBadge.ts
- APPLIED — concord-frontend/lib/lenses/manifest.ts
- PRESENT — concord-frontend/tests/components/garage/VehicleInspectorPanel.test.tsx
- LANDED-EVOLVED (added-line coverage 0.955) — concord-frontend/tests/lenses/garage-page.test.tsx
- LANDED-EVOLVED (added-line coverage 1) — server/domains/garage.js
- APPLIED — server/tests/garage-domain-macros.test.js

### #2123 — SUPERSEDED → HV-60
plan head a54b55e1e · measured head a54b55e1e · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 0.935) — concord-frontend/app/lenses/gallery/page.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/tests/gallery-lens-states.test.tsx
- APPLIED — server/domains/gallery.js
- APPLIED — server/tests/gallery-domain-parity.test.js
- APPLIED — server/tests/gallery-lens-macros.test.js

### #2122 — SUPERSEDED → HV-60
plan head a33032aad · measured head a33032aad · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/app/lenses/fishing/page.tsx
- LANDED-EVOLVED (added-line coverage 0.959) — concord-frontend/components/fishing/CatchLog.tsx
- LANDED-EVOLVED (added-line coverage 0.953) — concord-frontend/components/fishing/SpeciesCatalog.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/fishing/types.ts
- APPLIED — concord-frontend/components/world-lens/FishingMinigameOverlay.tsx
- APPLIED — server/domains/fishing.js
- APPLIED — server/lib/event-shapes.js
- APPLIED — server/lib/fishing.js
- APPLIED — server/routes/fishing.js
- APPLIED — server/tests/fishing.test.js

### #2120 — SUPERSEDED → HV-60
plan head 7705ab992 · measured head 7705ab992 · census: AGREE (residual empty)
- APPLIED — concord-frontend/app/lenses/app-maker/page.tsx
- PRESENT — concord-frontend/components/app-maker/ActionsPanel.test.tsx
- APPLIED — concord-frontend/components/app-maker/ActionsPanel.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/app-maker/AppBuilderStudio.tsx
- PRESENT — concord-frontend/components/app-maker/AppMakerProjectContext.tsx
- PRESENT — concord-frontend/lib/app-maker/project-to-compute-input.ts
- APPLIED — concord-frontend/tests/app-maker-lens-states.test.tsx

### #2119 — SUPERSEDED → HV-60
plan head 5487b8147 · measured head 5487b8147 · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/app-maker/AppsPanel.test.tsx
- APPLIED — concord-frontend/components/app-maker/AppsPanel.tsx

### #2118 — SUPERSEDED → HV-60
plan head 8569b3a72 · measured head 8569b3a72 · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/app-maker/AppBuilderStudio.tsx
- APPLIED — server/domains/appmaker.js
- APPLIED — server/tests/app-maker-domain-parity.test.js
- APPLIED — server/tests/appmaker-lens-macros.test.js

### #2117 — SUPERSEDED → HV-60
plan head 8329d81d4 · measured head 8329d81d4 · census: AGREE (residual empty)


### #2116 — SUPERSEDED → HV-60
plan head 1b51cab8b · measured head 1b51cab8b · census: DIFFERS (residual beyond the named member: concord-frontend/components/mentorship/MentorDirectoryPanel.tsx)
- APPLIED — concord-frontend/app/lenses/mentorship/page.tsx
- ABSENT (added-line coverage 0.75) — concord-frontend/components/mentorship/MentorDirectoryPanel.tsx
- PRESENT — concord-frontend/components/mentorship/rating-caption.test.ts
- PRESENT — concord-frontend/components/mentorship/rating-caption.ts
- APPLIED — concord-frontend/tests/mentorship-lens-states.test.tsx
- LANDED-EVOLVED (added-line coverage 1) — server/domains/mentorship.js
- LANDED-EVOLVED (added-line coverage 1) — server/tests/mentorship-domain-parity.test.js

### #2114 — SUPERSEDED → HV-60
plan head a095d93e8 · measured head a095d93e8 · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/app/lenses/classroom/page.tsx
- APPLIED — concord-frontend/tests/classroom-lens-states.test.tsx
- LANDED-EVOLVED (added-line coverage 1) — server/lib/lens-activity-labels.js
- APPLIED — server/tests/lens-activity-labels.test.js

### #2113 — SUPERSEDED → HV-60
plan head 76161d3f5 · measured head 76161d3f5 · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/app/lenses/classroom/page.tsx
- LANDED-EVOLVED (added-line coverage 0.929) — concord-frontend/components/classroom/ClassroomWorkspace.tsx
- PRESENT — concord-frontend/components/classroom/quiz-attempt.test.ts
- PRESENT — concord-frontend/components/classroom/quiz-attempt.ts

### #2112 — SUPERSEDED → HV-60
plan head 1d3edc7fe · measured head 1d3edc7fe · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/education/CoursesCatalog.tsx
- PRESENT — concord-frontend/components/education/catalog-search.test.ts
- PRESENT — concord-frontend/components/education/catalog-search.ts
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/linguistics/DictionaryPanel.tsx
- PRESENT — concord-frontend/components/linguistics/dictionary-copy.test.ts
- PRESENT — concord-frontend/components/linguistics/dictionary-copy.ts

### #2103 — HARVEST-ALL → HV-26
plan head 4d0b1ba40 · measured head 4d0b1ba40 · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0) — concord-frontend/components/events/EventOps.tsx
- ABSENT (added-line coverage 0) — concord-frontend/components/events/EventPlanner.tsx
- ABSENT (added-line coverage 0.16) — concord-frontend/components/events/EventsWorkbench.tsx
- MISSING — concord-frontend/components/events/event-when.test.ts
- MISSING — concord-frontend/components/events/event-when.ts
- ABSENT (added-line coverage 0) — server/domains/events.js
- ABSENT (added-line coverage 0.091) — server/tests/events-planning-domain-parity.test.js

### #2102 — SUPERSEDED → HV-60
plan head ff630b716 · measured head ff630b716 · census: AGREE (residual empty)
- APPLIED — concord-frontend/components/events/EventOps.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/events/EventsWorkbench.tsx
- PRESENT — concord-frontend/components/events/OperationsBudgetPanel.tsx
- APPLIED — server/domains/events.js
- APPLIED — server/tests/events-planning-domain-parity.test.js

### #2100 — HARVEST-ALL → HV-26
plan head 3099884a2 · measured head 3099884a2 · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0.214) — concord-frontend/components/events/EventsWorkbench.tsx
- ABSENT (added-line coverage 0.216) — server/domains/events.js
- ABSENT (added-line coverage 0.059) — server/tests/events-planning-domain-parity.test.js

### #2099 — HARVEST-ALL → HV-26
plan head 85dca8fff · measured head 85dca8fff · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0) — concord-frontend/components/events/EventsWorkbench.tsx
- MISSING — concord-frontend/components/events/OperationsStorePanel.tsx
- MISSING — concord-frontend/components/events/operations-store.test.ts
- MISSING — concord-frontend/components/events/operations-store.ts

### #2094 — SUPERSEDED → HV-60
plan head 3d2c55503 · measured head 3d2c55503 · census: AGREE (residual empty)
- APPLIED — server/domains/fashion.js
- PRESENT — server/tests/fashion-met-feed.test.js

### #2054 — HARVEST-PART (port, CK-SC-06) → HV-10
plan head 71d7f19d2 · measured head 71d7f19d2 · census: AGREE (residual is the harvest §6 names)
- PRESENT — server/lib/cross-model-dtu.js
- ABSENT (added-line coverage 0.208) — server/server.js
- MISSING — server/tests/cross-model-schema-targets.test.js

### #2047 — HARVEST-ALL (behind flag) → HV-12
plan head 653c3a3e8 · measured head 653c3a3e8 · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0.543) — server/domains/database.js
- MISSING — server/lib/db-dial.js
- MISSING — server/tests/database-dbx4-remote-query.test.js
- MISSING — server/tests/db-dial-query.test.js

### #2046 — HARVEST-ALL → HV-11
plan head d2b876d78 · measured head d2b876d78 · census: AGREE (residual is the harvest §6 names)
- MISSING — server/lib/canonical-result.js
- MISSING — server/tests/canonical-result.test.js
- MISSING — server/tests/cohesive-r1-dtu-create-equivalence.test.js

### #2045 — HARVEST-ALL (behind flag) → HV-12
plan head a391ed4c5 · measured head a391ed4c5 · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0.646) — server/domains/database.js
- MISSING — server/lib/db-dial.js
- MISSING — server/tests/database-dbx3-connection-test.test.js
- MISSING — server/tests/db-dial.test.js

### #2044 — SUPERSEDED → HV-60
plan head 208a2376c · measured head 208a2376c · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 0.921) — concord-frontend/components/code/CodeEditorWorkspacePanel.tsx
- PRESENT — concord-frontend/components/code/scriptDtu.ts
- PRESENT — concord-frontend/tests/code-script-save-dtu.test.ts

### #2043 — SUPERSEDED → HV-60
plan head c03a0a06c · measured head c03a0a06c · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 0.996) — concord-frontend/components/docs/ApiHubPanel.tsx
- PRESENT — concord-frontend/tests/docs-api-hub-honesty.test.tsx

### #2039 — SUPERSEDED → HV-60
plan head a0fff21f1 · measured head a0fff21f1 · census: AGREE (residual empty)
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/docs/BlockEditorRow.tsx
- APPLIED — concord-frontend/components/docs/DatabaseViews.tsx
- APPLIED — concord-frontend/components/docs/DeleteSafety.tsx
- LANDED-EVOLVED (added-line coverage 1) — concord-frontend/components/docs/DocsWorkspace.tsx
- APPLIED — concord-frontend/tests/docs-delete-safety.test.tsx

### #2037 — SUPERSEDED → HV-60
plan head ad5391ed8 · measured head ad5391ed8 · census: AGREE (residual empty)
- APPLIED — concord-frontend/tests/auth-refresh-storm.test.ts
- APPLIED — concord-frontend/tests/lib/socket-connection-grace.test.ts

### #2036 — SUPERSEDED → HV-60
plan head 5d733799b · measured head 5d733799b · census: AGREE (residual empty)
- APPLIED — concord-frontend/app/lenses/marketplace/page.perf.test.tsx
- APPLIED — concord-frontend/tests/accounting-lens-states.test.tsx
- APPLIED — concord-frontend/tests/affect-lens-states.test.tsx
- APPLIED — concord-frontend/tests/agriculture-lens-states.test.tsx
- APPLIED — concord-frontend/tests/app-maker-lens-states.test.tsx
- APPLIED — concord-frontend/tests/audit-lens-states.test.tsx
- APPLIED — concord-frontend/tests/calendar-lens-states.test.tsx
- APPLIED — concord-frontend/tests/collab-session-invitations.test.tsx
- APPLIED — concord-frontend/tests/components/LensShell.test.tsx
- APPLIED — concord-frontend/tests/components/ReasoningCounterArgumentAngles.test.tsx
- APPLIED — concord-frontend/tests/components/ResearchLensPage.test.tsx
- APPLIED — concord-frontend/tests/construction-lens-states.test.tsx
- APPLIED — concord-frontend/tests/debate-lens-states.test.tsx
- APPLIED — concord-frontend/tests/education-lens-states.test.tsx
- APPLIED — concord-frontend/tests/events-lens-states.test.tsx
- APPLIED — concord-frontend/tests/hvac-lens-states.test.tsx
- APPLIED — concord-frontend/tests/lenses/ingest-detect-schema.test.tsx
- APPLIED — concord-frontend/tests/linguistics-lens-states.test.tsx
- APPLIED — concord-frontend/tests/lock-lens-enforcement-feed.test.tsx
- APPLIED — concord-frontend/tests/retail-lens-states.test.tsx
- APPLIED — concord-frontend/tests/security-lens-states.test.tsx
- APPLIED — concord-frontend/tests/services-lens-states.test.tsx
- APPLIED — concord-frontend/tests/voice-lens-states.test.tsx

### #2035 — SUPERSEDED → HV-60
plan head a714e1eee · measured head a714e1eee · census: AGREE (residual empty)
- APPLIED — server/lib/ssrf-guard.js
- PRESENT — server/tests/ssrf-guard-db-target.test.js

### #1998 — HARVEST-PART (hold @types/vscode) → HV-33
plan head f64bd06a4 · measured head f64bd06a4 · census: AGREE (residual is the harvest §6 names)
- ABSENT (added-line coverage 0) — concord-vscode/package-lock.json
- ABSENT (added-line coverage 0) — concord-vscode/package.json

### #1779 — DUTCH (default: harvest docs) → HV-35
plan head 92cc11c0b · measured head 92cc11c0b · census: AGREE (content off the branch, as §6 states)
- MISSING — docs/audit/B3-2-DOSSIER-2026-10-28.md

### #1524 — DUTCH (default: defer) → HV-L5
plan head 48fdfa821 · measured head 48fdfa821 · census: AGREE (content off the branch, as §6 states)
- ABSENT (added-line coverage 0.53) — concord-frontend/package-lock.json
- ABSENT (added-line coverage 0) — concord-frontend/package.json

### #1522 — DUTCH (default: defer) → HV-L4
plan head 418de68b0 · measured head 418de68b0 · census: AGREE (content off the branch, as §6 states)
- ABSENT (added-line coverage 0.4) — concord-frontend/package-lock.json
- ABSENT (added-line coverage 0) — concord-frontend/package.json

### #1521 — DUTCH (default: defer) → HV-L2
plan head ca33cd9e4 · measured head ca33cd9e4 · census: AGREE (content off the branch, as §6 states)
- ABSENT (added-line coverage 0.644) — concord-frontend/package-lock.json
- ABSENT (added-line coverage 0) — concord-frontend/package.json

### #1520 — DUTCH (default: defer) → HV-L3
plan head 99d9ee3a6 · measured head 99d9ee3a6 · census: AGREE (content off the branch, as §6 states)
- ABSENT (added-line coverage 0.561) — concord-frontend/package-lock.json
- ABSENT (added-line coverage 0) — concord-frontend/package.json

### #1516 — DUTCH (default: defer) → HV-L6
plan head ac836d0d1 · measured head ac836d0d1 · census: AGREE (content off the branch, as §6 states)
- ABSENT (added-line coverage 0.453) — server/package-lock.json
- ABSENT (added-line coverage 0) — server/package.json

### #1515 — DUTCH (default: defer) → HV-L7
plan head afb3136af · measured head afb3136af · census: AGREE (content off the branch, as §6 states)
- ABSENT (added-line coverage 0) — server/package-lock.json
- ABSENT (added-line coverage 0) — server/package.json

### #1514 — DUTCH (default: defer) → HV-L6
plan head 342572f89 · measured head 342572f89 · census: AGREE (content off the branch, as §6 states)
- ABSENT (added-line coverage 0.787) — server/package-lock.json
- ABSENT (added-line coverage 0) — server/package.json

### #1511 — DUTCH (default: defer) → HV-L5
plan head 647bcda95 · measured head 647bcda95 · census: AGREE (content off the branch, as §6 states)
- ABSENT (added-line coverage 0.526) — server/package-lock.json
- ABSENT (added-line coverage 0) — server/package.json

### #1506 — DUTCH (default: defer) → HV-L1
plan head d139a7e20 · measured head d139a7e20 · census: AGREE (content off the branch, as §6 states)
- ABSENT (added-line coverage 0.244) — concord-frontend/package-lock.json
- ABSENT (added-line coverage 0) — concord-frontend/package.json

### #1494 — DROP (not harvested) → none
plan head 60b7ab9f8 · measured head 60b7ab9f8 · census: AGREE (content off the branch, as §6 states)
- MISSING — apps/concordia-living-world/unity-client/.Aura/LIVE_PATH.md
- MISSING — apps/concordia-living-world/unity-client/.Aura/PROGRESS_LOG.md
- MISSING — apps/concordia-living-world/unity-client/.Aura/QUEST_AUDIT.md
- MISSING — apps/concordia-living-world/unity-client/.Aura/REQUESTS_FOR_CLAUDE.md
- MISSING — apps/concordia-living-world/unity-client/.Aura/ROADMAP.md
- MISSING — apps/concordia-living-world/unity-client/.Aura/Skills/concordia-nonstop/SKILL.md
- MISSING — apps/concordia-living-world/unity-client/.Aura/tools/quest_audit.py
- MISSING — apps/concordia-living-world/unity-client/.Aura/tools/weapon_classes.mjs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/AuraShots.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/AuraShots.cs.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/AuraVerifyProbe.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/AuraVerifyProbe.cs.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/ComponentDump.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/ComponentDump.cs.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/HeroRigProbe.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/HeroRigProbe.cs.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/InputProbe.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/InputProbe.cs.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/RebindProbe.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/RebindProbe.cs.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/SettingsProbe.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Editor/Aura/SettingsProbe.cs.meta
- ABSENT (added-line coverage 0) — apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks/Fauna/Animals_Pack_Quaternius/Animals Pack by Quaternius/FBX/Chick.fbx.meta
- ABSENT (added-line coverage 0) — apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks/Fauna/Animals_Pack_Quaternius/Animals Pack by Quaternius/FBX/Fish.fbx.meta
- ABSENT (added-line coverage 0) — apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks/Fauna/Animals_Pack_Quaternius/Animals Pack by Quaternius/FBX/Red Fox.fbx.meta
- ABSENT (added-line coverage 0) — apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks/Fauna/Animals_Pack_Quaternius/Animals Pack by Quaternius/FBX/Whale.fbx.meta
- ABSENT (added-line coverage 0) — apps/concordia-living-world/unity-client/Assets/Concordia/FreePacks/Fauna/Animals_Pack_Quaternius/Animals Pack by Quaternius/FBX/bird.fbx.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/consolidation-stake.json
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/consolidation-stake.json.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/faction-quests.json
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/faction-quests.json.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/first_cycle_phase_d.json
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/first_cycle_phase_d.json.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/kael-torchlight.json
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/kael-torchlight.json.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/main-arc.json
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/main-arc.json.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/southern-arc-mystery.json
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/southern-arc-mystery.json.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/the-handshake-revelation.json
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/concordia-hub/quests/the-handshake-revelation.json.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/sere/quests.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/sere/quests/main-arc.json
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/Canon/sere/quests/main-arc.json.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/ConcordiaControls.inputactions
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/ConcordiaControls.inputactions.meta
- ABSENT (added-line coverage 0.398) — apps/concordia-living-world/unity-client/Assets/Concordia/Resources/Concordia/ConcordiaLocomotion.controller
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/AerialTraffic.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/AerialTraffic.cs.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/AuraVerify.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/AuraVerify.cs.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/Combat.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/Combat/WeaponClassDef.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/Combat/WeaponClassDef.cs.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/ConcordiaInput.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/ConcordiaInput.cs.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/ConcordiaSettings.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/ConcordiaSettings.cs.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/FrameWatch.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/FrameWatch.cs.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/LocomotionPolish.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/LocomotionPolish.cs.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/Net.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/Net/ConcordRest.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/Net/ConcordRest.cs.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/ServerProgress.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/ServerProgress.cs.meta
- ABSENT (added-line coverage 0.233) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ConcordClient.cs
- ABSENT (added-line coverage 0.199) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ConcordiaGame.cs
- ABSENT (added-line coverage 0.202) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ConcordiaHUD.cs
- ABSENT (added-line coverage 0.244) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ConcordiaPlayer.cs
- ABSENT (added-line coverage 0) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ContentBind/ContentBindVolumeCatalog.cs
- ABSENT (added-line coverage 0.306) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/ContinentStream.cs
- ABSENT (added-line coverage 0.2) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/CreatureCompiler.cs
- ABSENT (added-line coverage 0.222) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/FreePacks.cs
- ABSENT (added-line coverage 0.162) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/GameplayCore/Persistence/ConcordiaPersistenceService.cs
- ABSENT (added-line coverage 0.375) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Hostile.cs
- ABSENT (added-line coverage 0) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/HubDataNpcSeed.cs
- ABSENT (added-line coverage 0.235) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/HubKit.cs
- ABSENT (added-line coverage 0) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/HubLook.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/HubResidents.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/HubResidents.cs.meta
- ABSENT (added-line coverage 0.25) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/HubWilderness.cs
- ABSENT (added-line coverage 0.538) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Organic/OrganicBind.cs
- ABSENT (added-line coverage 0.292) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/RealmFill.cs
- ABSENT (added-line coverage 0.267) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/TrainingDummy.cs
- ABSENT (added-line coverage 0) — apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/WorldBuilder.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Tests/EditMode/ConcordRestTests.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Tests/EditMode/ConcordRestTests.cs.meta
- ABSENT (added-line coverage 0.226) — apps/concordia-living-world/unity-client/Assets/Concordia/Tests/EditMode/ConcordiaPersistenceTests.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Tests/EditMode/ServerCombatClientTests.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Tests/EditMode/ServerCombatClientTests.cs.meta
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Tests/EditMode/WeaponClassDefTests.cs
- MISSING — apps/concordia-living-world/unity-client/Assets/Concordia/Tests/EditMode/WeaponClassDefTests.cs.meta
- ABSENT (added-line coverage 0) — apps/concordia-living-world/unity-client/Assets/Editor/LeanPlayStarveProbe.cs

### #1389 — DUTCH (default: defer) → HV-L8
plan head d888c19a6 · measured head d888c19a6 · census: AGREE (content off the branch, as §6 states)
- ABSENT (added-line coverage 0.545) — concord-vscode/package-lock.json
- ABSENT (added-line coverage 0) — concord-vscode/package.json
