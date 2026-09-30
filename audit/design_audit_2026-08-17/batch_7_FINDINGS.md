# Batch 7 Design Audit — Lenses 158–182
**Audit date:** 2026-08-17
**Scope:** mental-health, mentorship, mesh, message, meta, metacognition, metalearning, mining, ml, move-builder, music, narrative-walk, neuro, news, nonprofit, observe, ocean, offline, ops, ops-telemetry, organ, paper, parenting, personas, pets, pharmacy, philosophy

---

## Summary

**P0 (redesign immediately):** 1 — move-builder (inline styles, non-Concord visual language)
**P1 (significant gaps):** 4 — meta (stuck load), metacognition (stuck load), ml (stuck search), paper (lens.create broken)
**P2 (polish passes):** 8 — music (spinner/egress), ocean (spinner/egress), observe (thin compose form), organ (scaffold-heavy), neuro (scaffold-heavy), nonprofit (scaffold-heavy), ops (scaffold-heavy), personas (scaffold-heavy)
**P3 (already strong):** 14 — mental-health, mentorship, mesh, message, metalearning, mining, narrative-walk, news, offline, ops-telemetry, parenting, pets, pharmacy, philosophy

---

## 158. mental-health

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
Three-section page: `MentalHealthSection` (the main workbench with Practice/Mood/Sleep/Reflect/Companion/Factors/Calendar/Reminders/Worksheets/Safety Plan/Report tabs), `CrisisPanel` (crisis hotline + safety plan), and `MentalHealthActionPanel` (coping strategies + wellness score calculators). `MedlinePlusPanel` provides medical reference. Layout: hero section → collapsible coping/wellness calculators → main workbench → crisis panel. Uses `ManifestActionBar` + `RecentMineCard` + `AutoActionStrip` + `CrossLensRecentsPanel` (imports generic trio). Uses `ds.pageContainer` and `ds.heading1` design system tokens.

### DESIGN DIRECTION
Already correctly designed — "Calm + Headspace shape, not medical advice." The calm clinical-but-warm visual identity is exactly right for a sensitive domain. Real validated instruments (PHQ-9, GAD-7) are disclosed by name. No forced gamification. The "Safety plan" tab is present and not trivialized.

### LAYOUT UPGRADE
No structural changes needed. The layout hierarchy is clear: crisis panel prominent, workbench tabbed below.

### COMPONENT-LEVEL CHANGES
- **Minor:** The coping-strategy and wellness-score calculators at the top are collapsed by default with `ChevronDown`/`ChevronRight` toggles — they sit above the main workbench and compete for attention. Consider moving them into the workbench's "Practice" tab or a dedicated "Tools" section within the workbench to reduce top-level noise.

### VISUAL IDENTITY
- **Typography:** `ds.heading1` for title, appropriate muted text for descriptions. Correct.
- **Color:** `text-neon-pink` (Heart icon), `text-neon-purple` for accents. Appropriate warmth for the domain.
- **Spacing:** `ds.pageContainer` padding. Correct density.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Appropriate for clinical-adjacent tool
- **Micro-interactions:** ✅ Collapsible sections, tab navigation, real state updates
- **Visual identity:** ✅ Calm, clinical-but-warm — distinct from every other lens
- **Perceived performance:** ✅ Loading states present, optimistic UI where appropriate
- **Craft:** ✅ Honest empty states, no fabricated data

---

## 159. mentorship

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
Clean mentorship marketplace: `Directory` + `Requests` + `Sessions` + `Goals` + `Messages` + `Coaching Tools` + `Program` + `Community` tabs. Real `matchMentor` skill-graph algorithm. Honest "No mentors found" empty state. Real "Become a mentor" form (Display name/Headline/Short bio/Skills/Availability). Uses `ManifestActionBar` + `AutoActionStrip` + `CrossLensRecentsPanel`. Bespoke ratio: 0.899.

### DESIGN DIRECTION
"Professional mentorship marketplace" — correctly matches the reference apps (MentorCruise / ADPList). The removal of the fabricated "Match: 87%" badge (confirmed gone) makes this honest.

### LAYOUT UPGRADE
No structural changes needed. The tabbed marketplace layout is appropriate.

### COMPONENT-LEVEL CHANGES
- No changes needed.

### VISUAL IDENTITY
- Clean, appropriately professional. Uses standard Concord lattice tokens.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Dense but readable
- **Micro-interactions:** ✅ Tab switching, form submission, real state updates
- **Visual identity:** ✅ Professional mentorship-marketplace feel
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest empty states, no fabrication

---

## 160. mesh

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
7-tab off-grid mesh networking surface: Overview/Send DTU/Topology/Messages/Signal/Queue/Channels. Real GitHub `topic:mesh-networking` live feed. Real success toast "Add Node — ok" confirmed. `MeshRepos` for mesh-networking project feed. Each tab backed by a bespoke panel (`MeshTopology`, `MeshSendDtu`, `MeshMessaging`, `MeshSignal`, `MeshQueue`, `MeshChannels`). Bespoke ratio: 0.807. Uses generic trio.

### DESIGN DIRECTION
"Technical mesh-network topology identity" — correct for the domain. Meshtastic/Briar-parity tooling.

### LAYOUT UPGRADE
No changes needed.

### COMPONENT-LEVEL CHANGES
No changes needed.

### VISUAL IDENTITY
- Appropriate technical/network-topology identity. Radio icon, lattice-border cards.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Appropriate for technical operator tool
- **Micro-interactions:** ✅ Tab switching, real macro calls
- **Visual identity:** ✅ Technical/off-grid aesthetic
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest status, no fabrication

---

## 161. message

**PRIORITY: P2 — polish pass (scaffold tail + dual-panel overlap)**

### CURRENT DESIGN
Complex messaging surface. Top: `GmailSection` + `SlackSection` (connector integrations). Main: `InboxShell` rival-shape silhouette (labels sidebar + thread list + message view). InboxShell renders: labels (Inbox/Starred/Snoozed/Sent/Archive/Trash), thread list with virtualized list (Virtuoso), message view with inline reply composer, compose modal with `RecipientSearchInput`. Bottom: `MessageWorkbench` (saved/starred, search, voice notes, reactions) via floating button. `LabelManagerPanel` + `MessagingRepos` below. Keyboard shortcuts: g→inbox, g→starred, g→sent, c→compose, r→reply. Uses `LensShell` + `FirstRunTour` + `ManifestActionBar` + `DepthBadge`. Also renders `RecentMineCard` + `AutoActionStrip` + `CrossLensRecentsPanel` at the very bottom. Bespoke ratio: 0.897.

### DESIGN DIRECTION
"Slack + Gmail hybrid" — the InboxShell rival-shape silhouette is the canonical reference. The keyboard shortcuts (g→i, g→s, g→t, c, r) match Gmail conventions perfectly.

### LAYOUT UPGRADE
1. **Remove the scaffold tail:** `RecentMineCard` + `AutoActionStrip` + `CrossLensRecentsPanel` appear AFTER the `MessageWorkbench` button at the very bottom of the page — they're redundant with the real InboxShell and add dead vertical space. Remove them.
2. **Gmail/Slack sections overlap with InboxShell:** The `GmailSection` + `SlackSection` connectors at the top compete with the main `InboxShell` for attention. Move them into the InboxShell's sidebar or a settings panel — the user shouldn't see two different messaging UIs stacked.
3. **Compose modal lacks rich text:** The compose textarea is a bare `<textarea>` with no formatting toolbar — even basic bold/italic/link would match Gmail parity.

### COMPONENT-LEVEL CHANGES
- Remove `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel` from the page bottom.
- Move `GmailSection` + `SlackSection` into a "Connectors" settings tab inside InboxShell or a gear icon in the header.
- Add minimal rich-text toolbar (bold, italic, link) to the compose textarea.

### VISUAL IDENTITY
- **Typography:** Appropriate. `text-xl font-semibold text-white` for subject, `text-sm text-gray-400` for metadata.
- **Color:** `bg-neon-blue` for Workbench FAB, `border-lattice-border` for cards. Correct lattice palette.
- **Spacing:** `h-[calc(100vh-6rem)]` for the InboxShell — correct full-height messaging layout.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Dense but well-organized (sidebar + list + detail)
- **Micro-interactions:** ✅ Keyboard shortcuts, virtualized scrolling, inline reply
- **Visual identity:** ✅ Strong InboxShell silhouette matches Gmail/Slack
- **Perceived performance:** ✅ Skeleton loading states, optimistic UI
- **Craft:** ✅ Honest empty states, real connector disclosures

---

## 162. meta

**PRIORITY: P1 — stuck load blocks all assessment**

### CURRENT DESIGN
Platform self-audit dashboard: Dev Portal/Components/Lenses/Orphans/Wiring Map/Search/Lens Infrastructure tabs. `SystemHealth` + `DevPortal` bespoke components. 1308 LOC page, 0.615 bespoke ratio. Imports generic trio. Uses `useArtifacts`, `useCreateArtifact` for lens-manifest-based data. Real `LENS_STATUS_MAP`, `getLensStatusSummary`, `WIRING_PROFILES` from `@/lib/lenses`. The page is the platform's own CI-grade self-audit surfaced to users.

### DESIGN DIRECTION
"Meta/introspective identity" — layered-stack icon, appropriately technical. The concept (expose the platform's own audit as a user feature) is exceptional.

### LAYOUT UPGRADE
Cannot fully assess until the stuck load resolves. The Overview tab's "Loading inventory overview..." never resolved (5+ seconds). Once fixed:
1. The Overview tab should show a summary dashboard (total components/lenses/orphans/route count) as stat tiles, not a loading spinner.

### COMPONENT-LEVEL CHANGES
- **Bug (P1):** `SystemHealth` or the overview fetch is stuck — root-cause why "Loading inventory overview..." never resolves. This is the platform's own self-audit dashboard failing to load its own headline view.

### VISUAL IDENTITY
Cannot fully assess while stuck on loading state.

---

## 163. metacognition

**PRIORITY: P1 — stuck load blocks all assessment**

### CURRENT DESIGN
6-tab metacognition workbench: Dashboard/Introspection/Predictions/Learning/Journal/Practice. Bespoke panels: `CogsciFeed`, `DecisionJournal`, `ReflectionPrompts`, `BiasChecklist`, `StrategyLibrary`, `AccuracyTracker`, `ReasoningToolkit`. 1561 LOC page, 0.564 bespoke ratio. Uses generic trio + `ManifestActionBar`. Uses `useLensBridge('metacognition', 'strategy')` for cross-lens data. Uses `useRealtimeLens` for live data. `useQuery` calls `apiHelpers.metacognition.*`.

### DESIGN DIRECTION
Cannot assess — page stuck on "Loading metacognition data..."

### LAYOUT UPGRADE
Cannot assess until load resolves. The tab structure (6 tabs) appears well-designed from the type definitions.

### COMPONENT-LEVEL CHANGES
- **Bug (P1):** "Loading metacognition data..." never resolved after 5+ seconds. Grouped with `metalearning`'s identical failure — check if they share a broken data source.

### VISUAL IDENTITY
Cannot assess while stuck.

---

## 164. metalearning

**PRIORITY: P1 — stuck load blocks all assessment**

### CURRENT DESIGN
8-tab metalearning workbench: MetalearningFeed/SpacedRepetition/LearningPlan/TechniqueLibrary/ProgressAnalytics/GoalTracker/StrategyExperiment/StudyJournal. 824 LOC page, 0.589 bespoke ratio. Uses generic trio + `ManifestActionBar` + `ConnectiveTissueBar`. Uses `useLensBridge('metalearning', 'strategy')`. `useQuery` calls `apiHelpers.metalearning.*`. `useMutation` for `createStrategy`, `runCurriculum`, `recordOutcome`.

### DESIGN DIRECTION
Cannot assess — page stuck on bare "Loading..."

### LAYOUT UPGRADE
Cannot assess until load resolves. The 8-tab structure with real mutations (create strategy, run curriculum, record outcome) suggests genuine depth once working.

### COMPONENT-LEVEL CHANGES
- **Bug (P1):** Bare "Loading..." spinner never resolved. Third consecutive lens in the `meta`/`metacognition`/`metalearning` cluster to fail — likely shared root cause.

### VISUAL IDENTITY
Cannot assess while stuck.

---

## 165. mining

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
8-tab mining operations tool: Sites & Safety/Geology/Mine Plan/Fleet & Schedule/GIS Map/MSHA Compliance/Environmental/Quick Calcs. Bespoke panels: `MineSiteManager`, `GeologyWorkbench`, `MinePlanWorkbench`, `FleetManager`, `GisPitMap`, `MshaLookup`, `EnvironmentalCompliance`, `MiningActionPanel`. Uses `LensPageShell` (a non-standard shell wrapper). 119 LOC page — extremely thin, all depth in bespoke components. Bespoke ratio: 0.943. Does NOT import generic trio (no `RecentMineCard`/`AutoActionStrip`). No `ManifestActionBar`.

### DESIGN DIRECTION
"Industrial earth- sciences/trades identity" — correct. Pickaxe icon, amber accent, tab bar matches reference mining software (Vulcan, Maptek).

### LAYOUT UPGRADE
No changes needed. The thin page + deep components pattern is correct.

### COMPONENT-LEVEL CHANGES
- **Minor:** The MSHA Compliance tab embeds `MshaLookup` inside a raw `<div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">` wrapper — consistent with the other tabs but the wrapper is duplicated in the page source rather than using a shared tab-panel pattern. Not a visual issue, just a maintenance note.

### VISUAL IDENTITY
- **Typography:** Uses `LensPageShell` which provides consistent heading/description.
- **Color:** Zinc palette (zinc-800/zinc-900/zinc-950) — appropriate for industrial tooling.
- **Spacing:** `space-y-4` between tabs, `p-4` inside panels. Correct density.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real MSHA incident rates, ore grade calculators, GIS maps
- **Micro-interactions:** ✅ Tab switching, real macro calls
- **Visual identity:** ✅ Industrial/earth-sciences identity
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest states throughout

---

## 166. ml

**PRIORITY: P1 — stuck Model Hub search blocks primary workflow**

### CURRENT DESIGN
8-tab ML workbench: Model Hub/Playground/Experiments/Datasets/Compare/AutoML/Deployments/Spaces. Bespoke panels: `ModelHubPanel`, `InferencePlayground`, `ExperimentTracker`, `DatasetHubPanel`, `ModelComparePanel`, `AutoMLPanel`, `DeploymentsPanel`, `SpacesPanel`. Also `ArxivPanel` for arXiv cs.LG feed, `MlRepos` for GitHub repos, `MlActionPanel`. 179 LOC page — extremely thin, all depth in components. Bespoke ratio: 0.915. Uses `ManifestActionBar`. Tab bar uses neon-purple active state (`bg-neon-purple/20 text-neon-purple`). Keyboard shortcuts: m/l/e/d/c/a/p/s mapped to tabs.

### DESIGN DIRECTION
"ML-terminal layout matching the `code`/`data-science` family" — correct. Brain emoji header, tab bar pattern matches other technical lenses.

### LAYOUT UPGRADE
1. **The emoji header (`🤖`) should be replaced with a proper icon** — other technical lenses use Lucide icons consistently; the emoji breaks the visual language.
2. Once the search works, the Model Hub should show a grid of model cards (HuggingFace-style) rather than a flat list, to match the category leader.

### COMPONENT-LEVEL CHANGES
- **Bug (P1):** `ModelHubPanel` search — typing "bert" triggers "Loading models..." that never resolved (4+ seconds). Either the Hugging Face API call hangs without a timeout/fallback, or the response isn't parsed correctly.
- Replace `<span className="text-2xl">🤖</span>` with a Lucide `Brain` or `TestTube` icon.

### VISUAL IDENTITY
- **Color:** `neon-purple` tab accent — matches the `ml` theme. Correct.
- **Spacing:** `p-6 space-y-6` — correct density for a workbench.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Appropriate once search works
- **Micro-interactions:** ✅ Tab switching, playground model routing
- **Visual identity:** ⚠️ Emoji header is the one inconsistency
- **Perceived performance:** ❌ Stuck search is the blocker
- **Craft:** ✅ Honest loading states (when they resolve)

---

## 167. move-builder

**PRIORITY: P0 — inline styles, non-Concord visual language**

### CURRENT DESIGN
Single-page combat move authoring tool. 338 LOC, all in page.tsx. Inline `React.CSSProperties` style objects (`card`, `lbl`, `inp`, `stepBtn`, `primaryBtn`) defined at the bottom of the file. No Tailwind classes — entirely inline `style={{...}}`. Dark theme via hardcoded hex colors (`#1a1a22`, `#2a2a35`, `#13131a`, `#e8e4dc`). Sections: Name input → Element/Kind selectors → Modifier budget (power/speed/area/efficiency/control with +/− stepper buttons) → Live motion preview → Mint button → Your moves list (expandable detail). Bespoke ratio: 0 (entire page is the component). Does NOT import generic trio. No `ManifestActionBar`. No keyboard shortcuts.

### DESIGN DIRECTION
"Concordia combat-move authoring tool" — the concept is correct (diminishing-returns modifier budget, server-authoritative motion preview). But the visual language is completely non-Concord: inline styles with hardcoded hex colors, no Tailwind, no lattice tokens, no `ds.*` design system.

### LAYOUT UPGRADE
1. **Replace ALL inline styles with Tailwind classes + `ds.*` tokens.** This is the single most important change. The current page reads as a standalone prototype, not a Concord lens.
2. **Add a proper header** with icon, title, description, and `LiveIndicator` + `DTUExportButton` (standard Concord lens header pattern).
3. **Wrap in `LensPageShell`** (like mining uses) for consistent page structure.
4. **Add keyboard shortcuts** — at minimum Tab between sections, Enter to mint.
5. **Replace the `−`/`+` stepper buttons** with a proper slider or the `LensSlider` component used by other lenses — the current raw `−`/`+` buttons with no visual feedback on the range feel crude.
6. **Add a stat summary row** above the budget: "Budget: 6 | Spent: 4 | Balanced ✓" as a compact card, not inline text.
7. **The minted moves list** should use the `RecentMineCard` pattern or a custom card grid, not a raw `<ul>` with inline-styled `<li>` cards.

### COMPONENT-LEVEL CHANGES
- **Delete all `const card/lbl/inp/stepBtn/primaryBtn` CSSProperties** at the bottom of the file.
- **Replace inline `style={{...}}` with Tailwind classes** throughout:
  - `card` → `rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 mb-4`
  - `inp` → `w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100`
  - `stepBtn` → `bg-zinc-800 text-white border-none rounded-md px-2.5 py-1 hover:bg-zinc-700 transition-colors`
  - `primaryBtn` → `bg-emerald-600 text-white border-none rounded-lg px-5 py-2.5 font-semibold hover:bg-emerald-500 transition-colors`
- **Add `<FirstRunTour lensId="move-builder" />`** (currently missing).
- **Add `useLensNav('move-builder')`** (currently missing — the page doesn't register with the lens navigation system).
- **Add `useLensCommand`** for keyboard shortcuts.
- **Add error boundary handling** — the current error state is a raw `<div role="alert">` without the standard `ErrorState` component.

### VISUAL IDENTITY
- **Current:** Non-Concord. Hardcoded hex (#1a1a22, #e8e4dc, #2e7d32, #e05050). No lattice tokens. No Tailwind.
- **Target:** Concord lattice palette (zinc-900/950 backgrounds, lattice-border borders, emerald/green for primary actions, standard `ds.*` tokens). The move-builder is a game-authoring tool — it should feel like a spell-crafting workbench, not a standalone HTML page.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Appropriate — compose → preview → mint → library
- **Micro-interactions:** ⚠️ Live preview recomposes on every change (good), but no keyboard shortcuts, no animations
- **Visual identity:** ❌ Non-Concord — this is the #1 issue
- **Perceived performance:** ✅ Fast (deterministic macro calls)
- **Craft:** ⚠️ Honest loading/error/empty states present, but using raw HTML instead of Concord components

---

## 168. music

**PRIORITY: P2 — spinner/egress issue + scaffold tail**

### CURRENT DESIGN
2460 LOC page — the most complex in this batch. Full DAW-shape music lens: SessionView (Ableton-shape clip launcher), MusicStreamingSection (streaming feed), MusicArtistExplorer, MusicActionPanel, TrackCard, ArtistProfile, UploadFlow, PlaylistView, SessionClipPicker, MusicParityPanel (EQ/preamp). Also: `LiveIndicator`, `RealtimeDataPanel`, `LensFeedButton`, `LensAgentFab`, `VisionAnalyzeButton`, `FeedBanner`. Uses `useMusicStore` (Zustand), `getPlayer` (Web Audio), `previewRoyaltyObligations`. Keyboard shortcuts via `useLensCommand`. Bespoke ratio: 0.69. Does NOT import generic trio (no `RecentMineCard`/`AutoActionStrip`). Uses `SessionRail`.

### DESIGN DIRECTION
"Spotify + Apple Music shape" — correct. SessionView provides the DAW surface. The page is genuinely deep (EQ, preamp, royalty cascade preview, upload flow, artist explorer).

### LAYOUT UPGRADE
1. **Two loading spinners never resolved** (Library panel + stats row) — likely the documented outbound-egress constraint (iTunes/Jamendo/Audius APIs unreachable). Add an honest "External music APIs unreachable from this deployment" message instead of an indefinite spinner.
2. **The page is very tall** (2460 LOC in page.tsx alone) — consider lazy-loading below-the-fold sections (SessionView, UploadFlow) to improve initial paint.

### COMPONENT-LEVEL CHANGES
- **Fix spinner timeout:** Add a 10s timeout to the free-API fetch calls; on timeout, show "External music APIs unreachable — try again later" instead of an indefinite spinner.
- **No scaffold tail present** — this is already clean.

### VISUAL IDENTITY
- **Color:** Uses `ds.*` tokens and lattice palette. Correct.
- **Typography:** Standard Concord headings. Correct.
- **Spacing:** Appropriate for a DAW-style interface.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real DAW, real streaming, real royalty math
- **Micro-interactions:** ✅ SessionView clip launcher, EQ sliders, upload flow
- **Visual identity:** ✅ Strong Spotify/DAW identity
- **Perceived performance:** ❌ Spinners don't resolve (egress issue)
- **Craft:** ✅ Honest about egress constraints in comments

---

## 169. narrative-walk

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
229 LOC pure authored-narrative reader. NO backend macro surface — content bundled at build time (`concord-frontend/content/cinematics/*.json`). 4 UX states: loading (Film icon + pulse animation), error (AlertTriangle + retry guidance), empty (BookOpen + "No story beats yet"), populated (3-column grid of chapter cards). Each card shows: chapter number, name, summary, shot count, duration, Play button. Watched-journal via `localStorage`. Keyboard nav (arrow keys between play buttons). `ManifestActionBar` present.

### DESIGN DIRECTION
"Film treatment reader" — correct. The violet accent (`border-violet-500/20`, `text-violet-400`) gives a cinematic/literary feel. Watched cards get emerald accent (`border-emerald-500/30`). The progress tracker ("0/11 watched") is honest and non-manufactured.

### LAYOUT UPGRADE
No changes needed. The 3-column responsive grid is clean.

### COMPONENT-LEVEL CHANGES
No changes needed. The page is self-contained and correctly thin.

### VISUAL IDENTITY
- **Color:** Violet accent for literary/cinematic identity. Emerald for "watched" state. Correct and distinct.
- **Typography:** `text-base font-semibold` for title, `text-xs text-slate-400` for description. Correct.
- **Spacing:** `max-w-screen-2xl px-4 py-5 sm:px-6`. Correct.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Appropriate for a catalog/reader
- **Micro-interactions:** ✅ Play/Re-watch, keyboard nav, watched state persistence
- **Visual identity:** ✅ Distinct cinematic/literary feel
- **Perceived performance:** ✅ Async import with loading state
- **Craft:** ✅ All 4 UX states handled honestly

---

## 170. neuro

**PRIORITY: P2 — scaffold-heavy, otherwise excellent depth**

### CURRENT DESIGN
EEG/MEG analysis workbench: Research references (arXiv q-bio.NC + PubMed + Wikipedia) as collapsible section → `EegWorkbench` (EEGLAB/MNE-parity: import, waveform, topographic map, preprocessing, epoching, ERP, time-frequency, source localization, statistics) → `NeuroActionPanel` (bench mode: synthetic-signal FFT, mint/DM/publish/agent) → `NeuroTrainPanel` (real logistic-regression trainer). 126 LOC page, 0.918 bespoke ratio. Uses generic trio + `ManifestActionBar`. Honest disclosure: "every panel below traces to a neuro-domain macro run on either an imported recording or an explicitly disclosed synthetic signal."

### DESIGN DIRECTION
"Clinical/scientific EEG-terminal layout" — correct. Pink-to-purple gradient icon. The honest-by-construction disclosure is exemplary.

### LAYOUT UPGRADE
1. **The research references section should be at the bottom**, not the top — a researcher landing on this page wants the workbench first, not the paper feed. Move `EegWorkbench` to the top position.
2. **Remove the generic trio** (`RecentMineCard` + `AutoActionStrip` + `CrossLensRecentsPanel`) — they add nothing to a scientific workbench and reduce the bespoke ratio.

### COMPONENT-LEVEL CHANGES
- Move research references (arXiv/PubMed/Wikipedia) to bottom of page or into a collapsible "References" section below the workbench.
- Remove `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel`.

### VISUAL IDENTITY
- **Color:** `from-pink-500 to-purple-600` gradient icon — appropriate for neuroscience.
- **Typography:** `ds.heading1` for title. Correct.
- **Spacing:** `space-y-6 p-6`. Correct density.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real EEG analysis
- **Micro-interactions:** ✅ Collapsible sections, real macro calls
- **Visual identity:** ✅ Scientific/clinical identity
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest-by-construction exemplar

---

## 171. news

**PRIORITY: P3 — already strong (flagship rebuild)**

### CURRENT DESIGN
64 LOC page — the thinnest in this batch. Pure wrapper: `LensShell` + `IntelDesk` (the real 3962 LOC component). No generic trio. No `ManifestActionBar`. Deep-link support via `useSearchParams` for category. Keyboard shortcut: g → scroll to top. The page header comment explicitly documents the retirement of the old generic-scaffold stack.

### DESIGN DIRECTION
"Intelligence Desk / newsroom terminal" — the IntelDesk is the canonical flagship rebuild. Research-tool identity. GDELT live feed, real bias/narrative analysis. The comment "the old generic-scaffold stack is retired" confirms this is the intended pattern.

### LAYOUT UPGRADE
No changes needed at the page level — all layout lives in IntelDesk.

### COMPONENT-LEVEL CHANGES
No changes needed at the page level.

### VISUAL IDENTITY
Entirely delegated to IntelDesk. Page is a correct thin wrapper.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent (via IntelDesk)
- **Micro-interactions:** ✅ Category deep-linking, keyboard shortcut
- **Visual identity:** ✅ IntelDesk provides the full newsroom identity
- **Perceived performance:** ✅ Suspense boundary handles async
- **Craft:** ✅ Honest about GDELT feed latency

---

## 172. nonprofit

**PRIORITY: P2 — scaffold-heavy**

### CURRENT DESIGN
5-tab nonprofit CRM: Overview/Workbench/Campaigns/Analysis/Explorer. Bespoke panels: `NonprofitOverviewPanel`, `NonprofitWorkbench` (donor CRM + recurring giving + comms + receipts + donation pages + volunteers + P2P), `CampaignManager`, `NonprofitActionPanel` (retention/grant calculators), `PropublicaSearch`. 141 LOC page, 0.924 bespoke ratio. Uses generic trio + `ManifestActionBar`. Real ProPublica 990 lookup. `ds.pageContainer` + `ds.heading1` + `ds.textMuted` tokens.

### DESIGN DIRECTION
"Warm nonprofit-CRM layout matching Bloomerang/Kindful parity" — correct. Heart icon with neon-pink accent. The 990 Explorer tab is a genuine differentiator.

### LAYOUT UPGRADE
1. **Remove the generic trio** (`RecentMineCard` + `AutoActionStrip` + `CrossLensRecentsPanel`) — the 5 real tabs already provide all the surface area needed. The generic pieces add noise at the bottom.
2. **The Overview tab's "Loading overview..." didn't resolve** during the prior audit visit — worth verifying this is fixed.

### COMPONENT-LEVEL CHANGES
- Remove `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel` from the page bottom.
- Verify `NonprofitOverviewPanel` data loads reliably.

### VISUAL IDENTITY
- **Color:** `text-neon-pink` for Heart icon, `ds.pageContainer` for layout. Correct.
- **Typography:** `ds.heading1` + `ds.textMuted`. Correct.
- **Spacing:** Standard Concord density.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real donor CRM, real 990 data
- **Micro-interactions:** ✅ Tab switching, real macro calls
- **Visual identity:** ✅ Warm nonprofit identity
- **Perceived performance:** ⚠️ Overview loading may still hang
- **Craft:** ✅ Honest empty states

---

## 173. observe

**PRIORITY: P2 — thin compose form + scaffold-heavy**

### CURRENT DESIGN
Observer mode: compose empirical reports from world state. 170 LOC page. Two bare text inputs (world ID, focus) + a compose button. Report result displayed inline. `LensVerticalHero` provides a hero section. `ObservabilityRepos` + `ObserveActionPanel` + `ObservePlatform` for additional surfaces. Uses generic trio + `FirstRunTour` + `DepthBadge`. Bespoke ratio: 0.876. The compose button calls `observer.compose_report` which returns a real citable `kind='empirical_report'` DTU.

### DESIGN DIRECTION
"Journalistic/observational identity" — correct. The "Don't intervene — report" tagline is excellent. The royalty-cascade-on-citation hook is genuinely novel.

### LAYOUT UPGRADE
1. **The compose form is too thin** — two bare `<input>` elements with no labels, no context, no world-selector dropdown (the world ID is a free text field). Replace with a proper form: world selector (dropdown of known worlds), focus field with placeholder guidance, compose button with loading state.
2. **Remove the generic trio** — they add nothing to an observation-journalism surface.
3. **Add a "Recent Reports" section** showing the user's past compositions (via `RecentMineCard`-style pattern but for `empirical_report` DTUs specifically) — the current page shows no history, making it feel ephemeral.

### COMPONENT-LEVEL CHANGES
- Replace bare `<input type="text" placeholder="World id">` with a world-selector dropdown (data from `worldstate.overview` or similar).
- Add labels above each input ("World", "Focus area").
- Add a "Your Reports" section showing past `empirical_report` DTUs.
- Remove generic trio from bottom.

### VISUAL IDENTITY
- **Color:** `bg-cyan-700` compose button, `bg-zinc-900/80` card background. Appropriate for journalistic tool.
- **Typography:** `text-2xl font-bold text-zinc-100` for title. Correct.
- **Spacing:** `p-6 sm:p-8 max-w-3xl mx-auto` — good centered layout.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ⚠️ Too sparse — two inputs + a button is not enough for a 170 LOC page
- **Micro-interactions:** ✅ Compose button with loading state
- **Visual identity:** ✅ Journalistic/observational
- **Perceived performance:** ✅ Fast (when the LLM isn't stuck)
- **Craft:** ✅ Honest about DTU provenance

---

## 174. ocean

**PRIORITY: P2 — spinner/egress issue**

### CURRENT DESIGN
5-tab maritime tool: Tides/Waves & Water/Live Marine/Logbook/Map. Bespoke panels: `TidePredictions`, `NoaaTidesPanel`, `NoaaStationExplorer`, `WaveEcosystemPanel`, `TidalSalinityPanel`, `SpotLog`, `LiveMarinePanel`, `TideActionStack`. Also: `WikipediaSearchPanel`, `LensFeedPanel`, `MapView` (dynamic import). 195 LOC page, 0.902 bespoke ratio. Uses generic trio + `ManifestActionBar`. Real NOAA CO-OPS tide data. `useLensNav` + `useLensCommand` for keyboard shortcuts.

### DESIGN DIRECTION
"Maritime-terminal layout" — correct. Waves icon with cyan accent. Real NOAA integration is a genuine differentiator.

### LAYOUT UPGRADE
1. **The NOAA tide fetch stuck spinner** — the "Source: NOAA CO-OPS ·" indicator was spinning before any click, and "Load tides" for station 9414290 stayed loading for 5+ seconds. Add a timeout + honest error message ("NOAA API unreachable from this deployment") instead of an indefinite spinner.
2. **Remove the generic trio** — the 5 real tabs provide sufficient surface area.

### COMPONENT-LEVEL CHANGES
- Add 10s timeout to NOAA CO-OPS fetch; on timeout, show "NOAA API unreachable" instead of spinner.
- Remove `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel`.

### VISUAL IDENTITY
- **Color:** `text-cyan-400` for Waves icon, `bg-cyan-500/20` for icon container. Maritime identity correct.
- **Typography:** `text-xl font-bold text-white` for title. Correct.
- **Spacing:** `ds.pageContainer space-y-4`. Correct.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent once loaded
- **Micro-interactions:** ✅ Tab switching, station explorer, map view
- **Visual identity:** ✅ Maritime-terminal identity
- **Perceived performance:** ❌ NOAA spinner doesn't resolve
- **Craft:** ✅ Honest about data sources

---

## 175. offline

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
Local-first sync workbench: IndexedDB write-through, service-worker caching, CRDT conflict resolution, bidirectional replication. Real "Connectivity · Online" status. "Retry now" button with real exponential backoff visualization (±20% jitter band). 174 LOC page, 0.925 bespoke ratio. Uses generic trio + `ManifestActionBar`. The backoff-curve chart is a good template for other technical/infra lenses.

### DESIGN DIRECTION
"Technical sync-engine identity" — correct. The exponential backoff visualization is a standout UX pattern.

### LAYOUT UPGRADE
1. **Remove the generic trio** — the sync workbench's own UI is sufficient.
2. **The Featured Actions strip's loading spinner never resolved** during the prior audit — check if this is the cross-cutting Featured Actions bug.

### COMPONENT-LEVEL CHANGES
- Remove `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel`.

### VISUAL IDENTITY
- **Color:** Appropriate technical/sync identity.
- **Typography:** Standard Concord headings.
- **Spacing:** Correct for a diagnostic workbench.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Appropriate for sync diagnostics
- **Micro-interactions:** ✅ Retry button, exponential backoff visualization
- **Visual identity:** ✅ Technical/sync identity
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest connectivity status

---

## 176. ops

**PRIORITY: P2 — scaffold-heavy**

### CURRENT DESIGN
5-tab ops dashboard: Attention/Repair Network/Physical/Explorations/DTU substrate. Uses `IncidentConsole` for incident management, `OpsRepos` for repository feed, `OpsActionPanel` for actions. `AdminRequiredState` gate for non-admin users. `runGatedDomain` helper handles the server-side `requireOpsSubstrateAdminRole` gate. 343 LOC page, 0.806 bespoke ratio. Uses generic trio + `ManifestActionBar` + `LensVerticalHero`. `PipingProvider` wraps the page.

### DESIGN DIRECTION
"Real-ops-terminal layout matching Incident.io/PagerDuty parity" — correct. The admin-gate pattern is well-implemented.

### LAYOUT UPGRADE
1. **Remove the generic trio** — the 5 tabs + IncidentConsole provide sufficient surface area. The `RecentMineCard`/`AutoActionStrip`/`CrossLensRecentsPanel` at the bottom add noise.
2. **The Incident title field didn't retain typed text** during the prior audit — worth re-verifying.

### COMPONENT-LEVEL CHANGES
- Remove `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel`.
- Re-verify the Incident title field input behavior.

### VISUAL IDENTITY
- **Color:** Appropriate ops/terminal identity.
- **Typography:** Standard Concord headings.
- **Spacing:** Correct for an ops dashboard.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Good — attention allocator, repair network, physical metrics
- **Micro-interactions:** ✅ Tab switching, admin gate, macro calls
- **Visual identity:** ✅ Ops-terminal identity
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest admin gate, no fabrication

---

## 177. ops-telemetry

**PRIORITY: P3 — already strong (exemplar operator dashboard)**

### CURRENT DESIGN
818 LOC Grafana/Datadog-style operator dashboard. Sections: LivenessPanel (substrate health) → Simulation Overview (worldwide population/faction/realm/district rollup) → Federation Mesh (peer registry + inbox drain) → Inference Cost (24h LLM usage) → Worker Pools (macro + heartbeat pool utilisation) → Heartbeat Modules (p50/p90/p99 timing table, sorted by p99) → Brain Endpoints (per-brain inflight/failure counts) → Brain Activity (per-brain division of labor) → World Shards (per-world process status + restart). `useSmartPolling` at 5s with visibility-paused refresh. `AdminRequiredState` gate. 4 distinct UX states: forbidden, loading, error+retry, populated. Keyboard shortcut: r → refresh. Bespoke ratio: 0 (all inline, but correctly so — it's a dashboard, not a lens with sub-components). Does NOT import generic trio. Uses `ManifestActionBar`.

### DESIGN DIRECTION
"Grafana/Datadog NOC-style" — correct. Fuchsia accent for heartbeat/pool metrics, cyan for world/simulation, emerald for cost/brain, violet for federation. The color-per-section pattern is excellent for scannability.

### LAYOUT UPGRADE
No structural changes needed. The single-column stacked-section layout is correct for a monitoring dashboard.

### COMPONENT-LEVEL CHANGES
No changes needed. This is one of the best-designed admin surfaces in the codebase.

### VISUAL IDENTITY
- **Color:** Section-specific accent colors (fuchsia/cyan/emerald/violet) — excellent for scannability in a dense dashboard.
- **Typography:** `text-[12px] font-semibold uppercase tracking-wider` section headers — correct Grafana convention. `font-mono` for all numeric data — correct for ops dashboards.
- **Spacing:** `rounded-xl border border-zinc-800 bg-zinc-950/40 p-3` section cards — correct density.
- **Tables:** `text-[11px]` table cells with monospace numerics — excellent for dense telemetry.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — 8 real data sections in a single scrollable dashboard
- **Micro-interactions:** ✅ 5s auto-refresh, visibility-paused, keyboard shortcut, shard restart buttons
- **Visual identity:** ✅ Grafana/Datadog NOC identity — section-specific colors
- **Perceived performance:** ✅ Smart polling with jitter
- **Craft:** ✅ Honest loading/error/forbidden states throughout

---

## 178. paper

**PRIORITY: P1 — lens.create broken, blocks artifact creation across all lenses**

### CURRENT DESIGN
6-tab research workspace: Papers/Hypotheses/Evidence/Experiments/Synthesis/Bibliography. 2353 LOC page, 0.41 bespoke ratio (low — page.tsx does a lot of heavy lifting). Uses generic trio + `ManifestActionBar` + `SessionRail`. Bespoke panels: `ArxivSearch`, `PaperLibrary`, `PaperWorkbench`, `OpenLibraryPanel`, `CrossRefPanel`, `CitationSearch`, `PaperSummarizer`, `DraftedTextarea`. Real CSV/BibTeX export. `useLensData` for CRUD, `useRunArtifact` for macro calls. Uses `ds.textarea` + `ds.btnPrimary` + `ds.btnSecondary`.

### DESIGN DIRECTION
"Dense research-workspace layout" — correct. The 6-tab structure with Papers/Hypotheses/Evidence/Experiments/Synthesis/Bibliography is a genuine research methodology workflow.

### LAYOUT UPGRADE
1. **The page is very long** (2353 LOC in page.tsx) — consider extracting the per-tab content into lazy-loaded components.
2. **The stat tiles** (Papers/Citations/Hypotheses/Experiments) at the top are a good density pattern.

### COMPONENT-LEVEL CHANGES
- **Bug (P1):** `lens.create` is broken for ALL lenses using the generic `useLensData`/`useCreateArtifact()` path. The `POST /api/lens/:domain` → `lens.create` macro returns HTTP 200 with `{ ok:false, error:"scope_denied" }` because `emergent.bridge.lensScope` times out in the macro worker pool (it's in `HEAVY_DOMAINS` but not `LIGHT_OVERRIDES`). **This is not paper-specific — it affects every lens on the generic create path.** The fix is to add `"emergent.bridge.lensScope"` to `LIGHT_OVERRIDES` in `server/workers/macro-pool.js`.
- **Secondary fix:** `useLensData`'s `createMut` should check the JSON body's `ok` field, not just HTTP status, so a `200 {ok:false}` surfaces as a real error toast.

### VISUAL IDENTITY
- **Color:** Standard Concord lattice tokens via `ds.*`. Correct.
- **Typography:** Standard headings. Correct.
- **Spacing:** `ds.pageContainer` pattern. Correct.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real research methodology workflow
- **Micro-interactions:** ✅ Tab switching, CSV/BibTeX export, citation search
- **Visual identity:** ✅ Dense research-workspace identity
- **Perceived performance:** ❌ Creation is silently broken
- **Craft:** ❌ Silent failure on create (no error toast) — the `useLensData` bug masks the backend rejection

---

## 179. parenting

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
Huckleberry-parity baby-tracking tool. 123 LOC page, 0.96 bespoke ratio. Pure wrapper: `LensShell` + `FirstRunTour` + all depth in bespoke components (not shown in page.tsx but documented in the upgrade plan). Baby Care/Family Calendar/Quick Actions & Brief/Community & Safety tabs. Real create flow: add child → profile chip with computed age → per-child workbench (Today/Timers/Sleep/Schedule/Growth/Milestones/Care Log/Immunizations/Insights/Appointments/Caregivers). Quick-log buttons (Bottle/Nurse/Wet diaper/Dirty diaper/Mixed/Log medicine). Does NOT import generic trio. No `ManifestActionBar`.

### DESIGN DIRECTION
"Warm, non-clinical layout for tired parents" — correct. The quick-log button row is a density-matched pattern other "frequent small entries" lenses could borrow.

### LAYOUT UPGRADE
1. **The date field is a bare `mm/dd/yyyy` text input** — add a proper date-picker control (browser-native or custom) to reduce mis-typed DOBs, which matters because age-appropriate milestone ranges key off it.

### COMPONENT-LEVEL CHANGES
- Add a date-picker control for the DOB field in the child creation form.

### VISUAL IDENTITY
- **Color:** Warm, appropriately non-clinical.
- **Typography:** Standard Concord headings.
- **Spacing:** Appropriate for a parent-facing tool.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real baby tracking
- **Micro-interactions:** ✅ Quick-log buttons with instant state update
- **Visual identity:** ✅ Warm, approachable, non-clinical
- **Perceived performance:** ✅ Optimistic UI (instant profile chip)
- **Craft:** ✅ Honest empty states, real persistence

---

## 180. personas

**PRIORITY: P2 — scaffold-heavy**

### CURRENT DESIGN
Character.AI-parity persona marketplace. 357 LOC page, 0.717 bespoke ratio. 4 tabs: My Personas/Marketplace/Create/NPC Packaging. Bespoke panels: `CharacterStudio`, `PersonaEditor`, `PersonaMarketplace`, `PersonaDetailPanel`. Real Wikipedia REST lookups for 8 reference figures (Socrates, Confucius, etc.) in the Create tab. Real persona creation → chat loop with honest "COMPOSED FROM PERSONA" label. Uses generic trio + `LensVerticalHero`. Optimistic delete (instant card removal, restore on failure).

### DESIGN DIRECTION
"Focused authoring-workspace layout" — correct. The Wikipedia-backed reference panel is a genuinely good, non-generic touch.

### LAYOUT UPGRADE
1. **Remove the generic trio** (`RecentMineCard` + `AutoActionStrip` + `CrossLensRecentsPanel`) — the 4 real tabs provide sufficient surface area.
2. **A "2 issues" badge appeared top-right** during the prior audit — investigate what it's flagging.

### COMPONENT-LEVEL CHANGES
- Remove `RecentMineCard`, `AutoActionStrip`, `CrossLensRecentsPanel`.
- Investigate the "2 issues" badge.

### VISUAL IDENTITY
- **Color:** Appropriate for an authoring workspace.
- **Typography:** Standard Concord headings.
- **Spacing:** Correct density.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Good — authoring + marketplace + chat
- **Micro-interactions:** ✅ Optimistic delete, Wikipedia lookups, real chat
- **Visual identity:** ✅ Focused authoring workspace
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest "COMPOSED FROM PERSONA" label

---

## 181. pets

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
Pet-health tool. 130 LOC page, 0.958 bespoke ratio. Pure wrapper: all depth in bespoke components. Pets/Overdue shots/Open reminders/Month spend/Bookings stat row. Real "Live dog-breed reference feed" pull-feed. Create flow: "Add pet" → real form → pet chip with per-pet workbench (Health/Weight & Care/Reminders/Care Services/Records & ID/Insights/Discover tabs). Uses generic trio + `ManifestActionBar`. The "Discover" tab + live breed-reference feed pattern is a good cold-start template.

### DESIGN DIRECTION
"Dense, correctly-scoped layout" — correct. 7 tabs for a single pet profile is appropriately deep.

### LAYOUT UPGRADE
No structural changes needed.

### COMPONENT-LEVEL CHANGES
No changes needed.

### VISUAL IDENTITY
- **Color:** Appropriate warm/clinical identity.
- **Typography:** Standard Concord headings.
- **Spacing:** Correct for a health-tool density.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real pet health records
- **Micro-interactions:** ✅ Create flow, tab switching, real macro calls
- **Visual identity:** ✅ Warm, clinical-but-approachable
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest empty states, real persistence

---

## 182. pharmacy

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
Medication-safety tool. 145 LOC page, 0.963 bespoke ratio. Pure wrapper. Overview/My Meds/Drug Reference & Safety/Rx Bench tabs. Real OpenFDA API (50,000+ labels) with real search results ("Low Dose Aspirin, Generic: ASPIRIN"). Label/Adverse Events/Interactions sub-tabs. Correctly-worded medical disclaimer: "Do not rely on this tool for drug interaction or dosage decisions." Uses `FirstRunTour` + `DepthBadge`. Does NOT import generic trio (no `RecentMineCard`/`AutoActionStrip`). Uses `ManifestActionBar`.

### DESIGN DIRECTION
"Clinical-but-approachable layout" — correct. The disclaimer banner is a good model for health-adjacent lenses.

### LAYOUT UPGRADE
No changes needed.

### COMPONENT-LEVEL CHANGES
No changes needed.

### VISUAL IDENTITY
- **Color:** Appropriate clinical identity.
- **Typography:** Standard Concord headings.
- **Spacing:** Correct for a reference tool.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real FDA data
- **Micro-interactions:** ✅ Drug search, sub-tabs, save functionality
- **Visual identity:** ✅ Clinical-but-approachable
- **Perceived performance:** ✅ Fast
- **Craft:** ✅ Honest medical disclaimer, real data

---

## 183. philosophy

**PRIORITY: P3 — already strong**

### CURRENT DESIGN
Argument mapping + ethical frameworks + Are.na-shape channel/block idea-curation studio. 159 LOC page, 0.922 bespoke ratio. Pure wrapper. Overview/Dilemma Workbench/Curation Studio/Community Pulse tabs. Real philosophy.stackexchange.com Q&A feed. Dilemma Workbench offers: Argument map (formal logic validity/soundness), Thought experiment, Hegelian Dialectic, 6-school Ethics pack, Mint (DTU), DM, Publish, Synthesize. Honest empty state: "every tile here reads live from that state, nothing is simulated." Uses `FirstRunTour` + `DepthBadge`. Does NOT import generic trio. Uses `ManifestActionBar`.

### DESIGN DIRECTION
"Scholarly layout" — correct. The Argument Map with formal logic evaluation is a genuine differentiator.

### LAYOUT UPGRADE
1. **The placeholder-vs-real-input validation behavior** could use a subtler visual cue — dimming placeholder text further or adding a "try the example" button so users don't have to guess why "Argument map" first failed when fields looked filled.

### COMPONENT-LEVEL CHANGES
- Add a visual distinction between placeholder text and user-entered text in the Dilemma Workbench inputs (e.g., dimmer color for placeholders, or a "Try this example" chip).

### VISUAL IDENTITY
- **Color:** Appropriate scholarly identity.
- **Typography:** Standard Concord headings.
- **Spacing:** Correct for a reasoning workspace.

### UX QUALITY RUBRIC COMPLIANCE
- **Information density:** ✅ Excellent — real formal logic, real ethics frameworks
- **Micro-interactions:** ✅ Argument map, thought experiments, dialectic
- **Visual identity:** ✅ Scholarly/reasoning identity
- **Perceived performance:** ✅ Fast (deterministic logic evaluation)
- **Craft:** ✅ Honest about simulation status

---

## Cross-cutting findings

1. **Scaffold tail pattern (7 lenses):** mental-health, mesh, metacognition, metalearning, neuro, nonprofit, observe, ocean, offline, ops, personas all import `RecentMineCard` + `AutoActionStrip` + `CrossLensRecentsPanel` but don't meaningfully use them — they appear at the page bottom as dead weight. These should be removed from lenses that have their own tabbed/panel-based surface area.

2. **Stuck spinner cluster (3 lenses):** `meta`, `metacognition`, `metalearning` all failed to load their primary view in the same visit. Likely shared root cause — check for a common backend hook or data source.

3. **Egress-dependent spinners (2 lenses):** `music` (iTunes/Jamendo/Audius) and `ocean` (NOAA CO-OPS) show indefinite spinners when external APIs are unreachable. Both need timeout + honest error message.

4. **`lens.create` broken (affects all generic-path lenses):** The `paper` bug is not paper-specific — `lens.create` → `emergent.bridge.lensScope` times out in the macro worker pool, silently failing for every lens on the generic `useLensData`/`useCreateArtifact()` path.

5. **Inline styles (1 lens):** `move-builder` is the only lens using raw `React.CSSProperties` instead of Tailwind + `ds.*` tokens — it reads as a standalone prototype, not a Concord lens.
