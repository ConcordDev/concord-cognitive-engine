# Batch 6 — Design Audit Findings (27 Lenses)

Generated 2026-08-17. Each lens evaluated independently against its own rendered
structure, existing functionality, and visual hierarchy.

---

## 1. kingdoms

```
LENS: kingdoms
PURPOSE: Dynasty & Realm — CK3-shape realm governance (found, decree, contest, war)

CURRENT DESIGN:
- Amber brand palette with slate containers — visually coherent
- Crown emoji 📋 as page header icon — lower fidelity than lucide icon
- "v1" honest disclosure on polygon-paste form — excellent honesty pattern
- Browse/Found toggle buttons are plain, not a distinctive tab bar
- Collapsible sections mix zinc-950/40 panels with slate-900 cards — palette drift between zones
- Footer (RecentMineCard/AutoActionStrip/CrossLensRecentsPanel) sits outside max-w-6xl container — structural nesting issue
- WarCampaignSession and DynastyRealmManager add depth but are nested inside collapsible sections with no visual differentiation

DESIGN DIRECTION: A medieval cartography / royal-decree aesthetic. This should feel like ruling from a war room — maps, decrees, faction standings. Amber and slate is correct for the identity; push further into that territory with parchment-like containers, seal/badge iconography for decree types, and a territory map or polygon preview instead of raw JSON paste.

LAYOUT UPGRADE:
- Header: crown icon (lucide `Crown`) in amber-tinted badge, realm name in bold, "Founded" / "World" metadata
- Primary area: realm overview (loyalty/military/tax gauges) — the decree-effects dashboard
- Center: decree list with kind badges (loyalty/military/tax) and active-status indicators
- Side panel: war campaigns + realm actions (collapsible)
- Footer: RecentMineCard only (remove generic scaffold trio if present)

COMPONENT-LEVEL CHANGES:
- Crown emoji → lucide `Crown` in `rounded-lg bg-amber-500/10 p-2` container
- Browse/Found toggle → segmented control with icons (Browse = `List`, Found = `Plus`)
- Raw JSON polygon textarea → labeled coordinate list with v1 disclosure as tooltip
- `text-[10px]` metadata labels → `text-xs` for readability
- Mixed zinc/slate card styles → unified `rounded-xl border border-amber-900/30 bg-amber-950/5`

VISUAL UPGRADES:
- Typography: decree headers at `text-base font-semibold`, descriptions at `text-sm text-gray-400`
- Spacing: consistent `space-y-4` between sections (currently `space-y-3` / `space-y-6` mixed)
- Borders: `border-amber-900/30` everywhere instead of `border-slate-800`
- Icons: add `Flag` for founding, `Hammer` for decree-enact, `Swords` for contest

CAPABILITY PRESENTATION:
- Realm overview (loyalty/tax/military) → shown only after founding → BETTER: show aggregate stats row even when empty ("No realms found — found one to begin")
- Decree effects → buried inside each decree → BETTER: show per-decree effect badges (↑ loyalty 3%) inline
- War campaigns → collapsed section → BETTER: badge count on section header when active wars exist

LENS IDENTITY: The only CK3/dynasty lens in Concord. Amber + crown + territory polygon = unmistakable. Should feel like a medieval ruler's dashboard, not a generic data table.

RESPONSIVE DESIGN: Desktop: 2-column (realm list | detail). Tablet: stacked with sticky decree bar. Mobile: full-width list → drill-down.

BEFORE/AFTER:
- Before: Emoji header, plain toggle buttons, mixed card colors, JSON-paste form
- After: Lucide crown in amber badge, segmented Browse/Found, parchment-tinted panels, coordinate-list form with visual disclosure

IMPLEMENTATION PLAN:
1. Replace crown emoji with lucide `Crown` in amber badge
2. Unify card palette to `border-amber-900/30 bg-amber-950/5`
3. Replace Browse/Found toggle with segmented control
4. Add realm overview stats row (loyalty/military/tax) even when empty
5. Fix footer nesting (move inside max-w-6xl)
6. Add decree effect badges inline

PRIORITY: P2 — polish
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 8/10
```

---

## 2. lab

```
LENS: lab
PURPOSE: Scientific workbench — experiment sandbox, reagent tracking, calibration curves

CURRENT DESIGN:
- Neon green/purple/cyan palette (custom CSS classes) — distinctive but inconsistent with lattice design system
- Emoji 🧪 header — lower fidelity
- Stats row (3-col grid) has same visual weight as section headers — flat hierarchy
- Everything is `font-semibold`/`font-bold` — no clear primary/secondary distinction
- Custom `panel`/`lens-card` classes depend on globals.css, not Tailwind utilities
- ELNWorkbench + LabOrgPanel + RealityExplorerSection create a deep, scrolling page
- Calibration curve button shows honest "needs artifact" message (fixed bug)

DESIGN DIRECTION: A wet-lab electronic lab notebook. Clinical white-on-dark with green accent for "active experiment," purple for reagent inventory. Think Benchling/LabArchives — dense data tables, protocol step checklists, calibration curve plots. The neon palette is correct for the identity; tighten it.

LAYOUT UPGRADE:
- Header: flask icon in green badge, "Lab" title, experiment count stats
- Hero: current active experiment (if any) with step progress
- Primary workspace: code editor (2/3 width) + organ status (1/3 width) — this is correct
- Secondary: ELNWorkbench (collapsible, dense table view)
- Supporting: RealityExplorerSection with constraint builder
- Footer: feed panel

COMPONENT-LEVEL CHANGES:
- Emoji 🧪 → lucide `FlaskConical` in `rounded-lg bg-neon-green/10 p-2`
- Stats row → visual hierarchy: primary stat (experiment count) at `text-3xl font-bold`, secondary at `text-lg`
- `panel`/`lens-card` CSS classes → inline Tailwind (`rounded-xl border border-neon-green/20 bg-neon-green/5`)
- `text-neon-green`/`text-neon-purple`/`text-neon-cyan` → keep, these are the identity

VISUAL UPGRADES:
- Typography: experiment titles at `text-lg font-semibold`, section headers at `text-sm font-semibold uppercase tracking-wider`
- Spacing: `space-y-4` between major sections (currently `space-y-6` which is too loose for a dense lab tool)
- Cards: add left border accent (`border-l-2 border-l-neon-green/40`) for active experiments
- Motion: add `framer-motion` entrance animations for stats row

CAPABILITY PRESENTATION:
- Calibration Curve → shows "needs artifact" (honest) → BETTER: show "Create an experiment run first, then generate its calibration curve" as inline guidance
- Reality Explorer → collapsed by default → BETTER: always show constraint count badge
- Reagent tracking → buried in LabOrgPanel → BETTER: quick stats row (reagents tracked, calibrations run)

LENS IDENTITY: The only wet-lab tool in Concord. Flask icon + neon-green accent + code-editor primary workspace = unmistakable scientific workbench.

RESPONSIVE DESIGN: Desktop: 2/3 + 1/3 split. Tablet: stacked. Mobile: code editor full-width, other panels collapsible.

BEFORE/AFTER:
- Before: Emoji header, flat hierarchy, custom CSS classes, everything bold
- After: Lucide flask, clear weight hierarchy, inline Tailwind, left-border accent cards

IMPLEMENTATION PLAN:
1. Replace emoji with lucide icon
2. Create typographic hierarchy (title > section > body)
3. Replace CSS class dependencies with inline Tailwind
4. Add left-border accent for active experiments
5. Add stats row visual hierarchy (primary vs secondary metrics)

PRIORITY: P2 — polish
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10
```

---

## 3. landscaping

```
LENS: landscaping
PURPOSE: Yard/garden design studio, plant lookup, pro landscaping calculators

CURRENT DESIGN:
- Thin page shell (112 lines) — all complexity delegated to child components
- 5-tab nav with keyboard hints (kbd chips) — excellent discoverability
- neon-blue brand, zinc containers — clean
- PlantFinder correctly shows honest Trefle API key message
- No visual hierarchy issues — content delegated
- All real components, no demo data

DESIGN DIRECTION: Garden-fresh, botanical. Soft greens and earthy tones alongside the neon-blue. Think Proven Winners / Gardenista — lush imagery when plant data loads, clean grid layouts for garden beds, warm wood-like accents for hardscape calculators.

LAYOUT UPGRADE:
- Already correct: LensPageShell provides consistent framing
- Tab bar: good as-is with kbd hints
- Content: delegated to child components (no changes needed at page level)

COMPONENT-LEVEL CHANGES:
- Tab icons: already good (TreePine, Sprout, Flower2, Leaf, Calculator, CalendarClock)
- Tab active state: `bg-neon-blue/20 text-neon-blue` → add `border-b-2 border-neon-blue` for stronger visual anchor
- Empty states: delegated — no page-level change needed

VISUAL UPGRADES:
- Tab bar: add subtle top border on active tab
- Empty states in child components: should show plant/garden imagery when Trefle key is set
- Spacing: already correct via LensPageShell

CAPABILITY PRESENTATION:
- Trefle plant finder → honest API key message → BETTER: add inline "Get free key" link to trefle.io
- Garden Studio → correct real component → already well-presented
- Pro Calculators → correct real utility → already well-presented

LENS IDENTITY: The only garden/landscaping tool. Leaf/sprout icons + neon-blue + botanical vocabulary = distinct from all other lenses.

RESPONSIVE DESIGN: Tab bar with flex-wrap handles all breakpoints. Content delegated.

BEFORE/AFTER:
- Before: Already clean thin shell
- After: Minor tab active-state enhancement, inline API key signup link

IMPLEMENTATION PLAN:
1. Add border-b-2 active tab indicator
2. Add inline "Get free Trefle API key" link in PlantFinder empty state

PRIORITY: P3 — already strong
DESIGN SCORE: 8/10
UPGRADE POTENTIAL: 5/10
```

---

## 4. lattice

```
LENS: lattice
PURPOSE: Brain self-training dashboard — training runs, consent grants, eval curves, drift scans

CURRENT DESIGN:
- Fuchsia monochrome palette — very distinctive and consistent
- Custom Loading/ErrorState/Empty helper components — well-factored
- AnimatePresence for tab transitions — polished
- 8-tab pipeline with icon + count badges — dense but organized
- Stat component uses `text-xl font-semibold font-mono` — good number emphasis
- Honest self-disambiguation from unrelated backend `lattice` domain — excellent template
- Consent ratio stats shown (1925 total, 760 consented, 39.5%) — real data

DESIGN DIRECTION: MLOps dashboard — Weights & Biases / MLflow shape. Fuchsia is correct for the identity. Push further into data-viz territory: real training curves, loss plots, confusion matrices as the primary content. Dense, technical, information-rich.

LAYOUT UPGRADE:
- Already correct: sticky header + 8-tab nav + AnimatePresence content panels
- Overview tab: stat cards + pipeline visualization
- Consent tab: ratio bars + consent management
- Training tab: run history + metrics

COMPONENT-LEVEL CHANGES:
- Stat cards: already good — `text-xl font-semibold font-mono` creates proper emphasis
- Tab nav: already uses `border-b-2` underline style — consistent
- Empty states: custom `Empty` component — already well-styled
- Cards: `rounded-lg border border-fuchsia-900/40 bg-fuchsia-950/10 p-3` — consistent

VISUAL UPGRADES:
- Typography: already excellent — `font-mono` for numbers, `font-semibold` for section headers
- Spacing: already consistent `gap-3` for grids
- Motion: AnimatePresence tab transitions already present
- Borders: fuchsia-900/40 everywhere — very consistent

CAPABILITY PRESENTATION:
- Training runs → well-presented in Training tab
- Consent management → well-presented in Consent tab with ratio bars
- Drift scans → well-presented in Audit tab
- Self-disambiguation note → already excellent honesty pattern

LENS IDENTITY: The only MLops/brain-training dashboard. Fuchsia + `font-mono` numbers + training pipeline = unmistakable. The self-disambiguation from the unrelated backend lattice domain is a model for honest UI.

RESPONSIVE DESIGN: Tab nav wraps. Content panels adapt. Already handles all breakpoints.

BEFORE/AFTER: No changes needed — this is already a reference-quality lens.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 9/10
UPGRADE POTENTIAL: 3/10
```

---

## 5. law

```
LENS: law
PURPOSE: Case-law & patent research, contract lifecycle, case-file tooling

CURRENT DESIGN:
- neon-purple brand with lattice design system — consistent
- Custom Panel component with `text-[11px] uppercase tracking-wider` headers — excellent hierarchy
- 4 workbench groups (Research/Contracts/Cases/Analytics) with icon + hotkey + count badges
- AnimatePresence tab transitions — polished
- `data-lens-theme="law"` attribute — CSS variable theming
- Real CourtListener API: 99,363 hit results — genuinely world-class
- No generic scaffold components — deliberately retired

DESIGN DIRECTION: Legal research terminal — Westlaw/LexisNexis/FASTCASE shape. Purple is correct for the brand. Dense citation search, case-hierarchy trees, contract clause extraction views. Think legal professionals who work in dense text all day — information density is the priority.

LAYOUT UPGRADE:
- Already correct: header with icon + DepthBadge + DensityToggle + DTUExportButton
- Tab nav with AnimatePresence
- Panel-based content with uppercase headers
- Sub-panels within each workbench group

COMPONENT-LEVEL CHANGES:
- Panel component: already excellent — `rounded-lg border border-lattice-border bg-lattice-surface/60` with `bg-lattice-elevated/40` headers
- Tab buttons: already use `text-xs whitespace-nowrap border` with active `bg-neon-purple/15 text-neon-purple border-neon-purple/30`
- Hotkey indicators: `text-[9px] px-1 py-0.5 rounded bg-black/30 text-gray-400 font-mono` — excellent

VISUAL UPGRADES:
- Typography: already excellent — `text-[11px] uppercase` headers, `text-xs` body
- Spacing: consistent `space-y-4` between sections
- Motion: AnimatePresence already present
- Icons: Scale, BookOpen, FileText, Briefcase, BarChart3 — appropriate legal iconography

CAPABILITY PRESENTATION:
- Case law search → real CourtListener integration → well-presented
- Contract lifecycle → real Contracts tab → well-presented
- Patent search → real PatentSearch component → well-presented
- Legal text search → real LegalTextSearch → well-presented

LENS IDENTITY: The only legal-research terminal. Purple + Panel headers + hotkey shortcuts = professional legal tool, distinct from all other lenses.

RESPONSIVE DESIGN: Tab nav wraps. Panels stack. Already handles all breakpoints.

BEFORE/AFTER: No changes needed — this is one of the most polished lenses in the entire platform.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 9/10
UPGRADE POTENTIAL: 2/10
```

---

## 6. law-enforcement

```
LENS: law-enforcement
PURPOSE: Dispatch, evidence chain-of-custody, roster, crime mapping, warrants & reports

CURRENT DESIGN:
- Blue brand with design-system tokens (`ds.pageContainer`, `ds.sectionHeader`, `ds.heading1`, `ds.textMuted`) — most consistent approach in this batch
- 5 tabs: Overview/Cases/Console/Analysis/Field Notes — clean
- RmsCadConsole has deep sub-tabs (Dispatch/Evidence/Roster/Crime Map/Warrants/Reports/Booking)
- P1-P4 color-coded priority tiers — excellent visual language
- Real "New 911 Call" + "Register Unit" forms — genuine CAD functionality
- All complexity delegated to child components — thin page shell

DESIGN DIRECTION: Police dispatch console — CAD/RMS shape. Blue is correct. Dark, high-contrast for control-room readability. Priority badges (P1 red, P2 orange, P3 yellow, P4 blue) should dominate the visual hierarchy. Think Mark43/CentralSquare/Motorola Solutions CAD.

LAYOUT UPGRADE:
- Already correct: ds.pageContainer + ds.sectionHeader header
- Tab nav with icons
- Tab content delegated to deep child components

COMPONENT-LEVEL CHANGES:
- Tab active state: `bg-blue-500/20 text-blue-300` — correct for brand
- Tab text: `text-sm font-medium` — slightly smaller than law lens's `text-xs` — minor inconsistency but acceptable

VISUAL UPGRADES:
- Already using design-system tokens consistently
- No typography issues — delegated to child components
- Tab icon + label pairs already present

CAPABILITY PRESENTATION:
- RMS/CAD Console → deep real sub-tabs → well-presented
- P1-P4 priority breakdown → real visual hierarchy in Console
- Case Management → delegated → well-presented
- Field Notes → `bg-zinc-950/40` panel → well-presented

LENS IDENTITY: The only law-enforcement/CAD tool. Blue shield + P1-P4 priority colors = unmistakable dispatch console.

RESPONSIVE DESIGN: Tab nav handles breakpoints. Console sub-tabs may need horizontal scroll on mobile.

BEFORE/AFTER: No changes needed — clean, well-delegated design.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 8/10
UPGRADE POTENTIAL: 4/10
```

---

## 7. layout.tsx

```
LENS: layout.tsx (shared Next.js layout for /lenses/*)
PURPOSE: Shared layout wrapper — NOT a user-facing lens

CURRENT DESIGN: This is a Next.js route layout file, not a rendered lens page. It provides shared layout structure for all lens routes.

DESIGN DIRECTION: N/A — infrastructure file, not a visual surface.

LAYOUT UPGRADE: N/A

COMPONENT-LEVEL CHANGES: N/A

VISUAL UPGRADES: N/A

CAPABILITY PRESENTATION: N/A

LENS IDENTITY: N/A

RESPONSIVE DESIGN: N/A

BEFORE/AFTER: N/A

IMPLEMENTATION PLAN: N/A

PRIORITY: N/A — not a lens
DESIGN SCORE: N/A
UPGRADE POTENTIAL: N/A
```

---

## 8. ledger

```
LENS: ledger
PURPOSE: The Ledger — sere sub-world's economic-detective surface (noir narrative voice)

CURRENT DESIGN:
- Emerald brand — distinctive
- Noir narrative voice: "The flows the Curtain keeps off the public record" — excellent tonal identity
- Honest empty state: "No anomalous flows surfaced... That is usually a sign you have not looked hard enough"
- Color-coded data types: amber for managed parity, cyan for extraction liens — functional visual encoding
- Uppercase tracking-widest section headers — strong separation
- Workspace controls bar with flex-wrap — well-organized
- 474 lines, single-file — lean and focused
- All real data from macros (lensRun), persisted watchlist via useLensData

DESIGN DIRECTION: Noir detective case board. Emerald on black. Evidence pins, timeline threads, anomaly highlighting. Think a private investigator's corkboard — dense, atmospheric, every element carries meaning. The narrative voice IS the identity.

LAYOUT UPGRADE:
- Header: emerald title + noir tagline
- Workspace controls: scope toggles (world vs global pulse)
- Primary: anomaly list with severity indicators
- Secondary: dossier drill-down with parity items (amber) and liens (cyan)
- Watchlist: persistent tracked items

COMPONENT-LEVEL CHANGES:
- Title: `text-xl font-semibold text-emerald-300` — already good
- Section headers: `text-sm uppercase tracking-widest` — already excellent
- Data cards: `rounded border border-amber-500/30 bg-amber-500/5` / `border-cyan-500/30 bg-cyan-500/5` — already color-coded
- Buttons: `rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm` — consistent

VISUAL UPGRADES:
- Typography: already has strong hierarchy (emerald title, uppercase headers, colored data)
- Spacing: `space-y-2` / `space-y-6` — consistent
- Color: emerald/amber/cyan tri-color scheme is functional and distinctive
- Borders: `border-zinc-800` for containers — consistent

CAPABILITY PRESENTATION:
- Anomaly detection → real macro data → well-presented with severity indicators
- Dossier drill-down → toggleable section → well-presented
- Watchlist → persisted → well-presented with toggle
- Global pulse → toggleable scope disclosure → well-presented with honesty

LENS IDENTITY: The only noir detective lens. Emerald + narrative voice + anomaly detection = unmistakable sere-investigator tool. The honest empty state is the best in the platform.

RESPONSIVE DESIGN: Grid cols adapt (2→4 for pulse stats). List/detail layout stacks on mobile.

BEFORE/AFTER: No changes needed — this is one of the most identity-rich lenses.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 9/10
UPGRADE POTENTIAL: 2/10
```

---

## 9. legacy

```
LENS: legacy
PURPOSE: Legacy code modernization — technical debt, dependency graphs, migration roadmaps

CURRENT DESIGN:
- Uses `data-lens-theme="legacy"` attribute
- Emoji 🏛️ header — lower fidelity
- `panel` CSS class dependency (globals.css) — not Tailwind
- Missing `hasErrorUI` pillar (4/5 pillars)
- 96 lines — very thin page shell delegating to CodebaseScanner + PortfolioAssessment
- Real-time toolbar with LiveIndicator + DTUExportButton + alerts count
- ConnectiveTissueBar for cross-lens connections

DESIGN DIRECTION: Dev-tools / code-analysis terminal. Think SonarQube dashboard — dark theme, red/yellow/green severity indicators, dependency graph visualizations, debt-metric gauges. The 🏛️ icon is conceptually correct (legacy = classical architecture) but visually low-fidelity.

LAYOUT UPGRADE:
- Header: replace emoji with lucide `FolderSearch` in styled badge (already imported!)
- Primary: CodebaseScanner (the real workhorse)
- Secondary: PortfolioAssessment (risk overview)
- Supporting: RealtimeDataPanel (live analysis feed)
- Footer: ConnectiveTissueBar

COMPONENT-LEVEL CHANGES:
- Emoji 🏛️ → lucide `FolderSearch` in `rounded-lg bg-neon-cyan/10 p-2` (matching the existing cyan accent on the icon)
- `panel` class → inline Tailwind `rounded-xl border border-lattice-border bg-lattice-surface/60 p-4`
- `font-semibold` section header → `text-sm font-semibold uppercase tracking-wider` for consistency

VISUAL UPGRADES:
- Typography: section headers need uppercase tracking-wider treatment
- Color: cyan accent for "scan active" indicator (already present via icon)
- Error UI: add explicit error boundary wrapper (currently missing hasErrorUI)

CAPABILITY PRESENTATION:
- Code scanning → CodebaseScanner → already well-presented
- Portfolio risk → PortfolioAssessment → already well-presented
- Cloud readiness → macro button shows honest "create migration first" → already honest
- Real-time data → LiveIndicator + RealtimeDataPanel → already present

LENS IDENTITY: The only legacy-modernization tool. Folder icon + cyan accent + debt metrics = code-debt dashboard, distinct from code-lens (which is VSCode-shaped).

RESPONSIVE DESIGN: Stacked panels on mobile. Already handles breakpoints.

BEFORE/AFTER:
- Before: Emoji header, missing error UI, CSS class dependency
- After: Lucide icon, explicit error boundary, inline Tailwind

IMPLEMENTATION PLAN:
1. Replace emoji with lucide FolderSearch
2. Replace `panel` CSS class with inline Tailwind
3. Add error UI wrapper
4. Add uppercase tracking-wider section headers

PRIORITY: P2 — polish
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10
```

---

## 10. legal

```
LENS: legal
PURPOSE: Legal practice management — Clio/PracticePanther parity (matters, billing, trust, documents)

CURRENT DESIGN:
- Uses design-system tokens (`ds.pageContainer`, `ds.sectionHeader`, `ds.heading1`, `ds.textMuted`, `ds.btnGhost`, `ds.focusRing`) — most tokenized approach in this batch
- Scale icon in amber — professional legal identity
- Legal disclaimer banner — essential and well-placed
- 5 workbench tabs with icon + kbd shortcut + hint tooltip — excellent discoverability
- ShellPreview for rival-shape preview — nice
- All real workbench components: ClioSection, ContractAnalyzer, CaseTracker, LegalQA, LegalCaseSearch
- MobileTabBar for mobile navigation
- LensAgentFab with legal-specific prompt

DESIGN DIRECTION: Clio/PracticePanther shape — professional, trustworthy, amber-warm. Legal practice management should feel like a real attorney's workspace: matter-centric, billing-focused, trust-accounting visible. The amber Scale icon is perfect.

LAYOUT UPGRADE:
- Already correct: ds.pageContainer header with Scale icon + LiveIndicator + DepthBadge
- Legal disclaimer — essential, well-placed, correctly styled
- Tab nav with kbd shortcuts — excellent
- Workbench content delegated to deep components

COMPONENT-LEVEL CHANGES:
- Tab active state: `bg-amber-400/20 text-amber-400` — correct for legal brand
- Tab kbd hints: `text-[9px] px-1 py-0.5 rounded bg-black/30 text-gray-400 font-mono` — excellent
- Disclaimer: `bg-amber-500/10 border border-amber-500/30` — appropriate warning treatment

VISUAL UPGRADES:
- Already uses design-system tokens consistently
- Typography: ds.heading1 for title, ds.textMuted for description — correct
- Spacing: ds.pageContainer + ds.sectionHeader — consistent

CAPABILITY PRESENTATION:
- Practice management (ClioSection) → deep real component → well-presented
- Contract analyzer → AI-powered → well-presented
- Docket tracker → quick case log → well-presented
- Legal Q&A → jurisdiction-aware → well-presented
- Case law → CourtListener integration → well-presented

LENS IDENTITY: The only practice-management lens (distinct from `law` which is research-focused). Amber Scale + disclaimer + ClioSection = attorney workspace. Correctly cross-references `law` lens for case-law research instead of duplicating.

RESPONSIVE DESIGN: Tab nav wraps. MobileTabBar for mobile. Already handles all breakpoints.

BEFORE/AFTER: No changes needed — extremely well-designed, tokenized, and deep.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 9/10
UPGRADE POTENTIAL: 2/10
```

---

## 11. lfg

```
LENS: lfg
PURPOSE: Looking For Group — find or post group requests across all worlds

CURRENT DESIGN:
- Unique gradient background: `from-slate-950 via-zinc-950 to-cyan-950/10` — atmospheric
- Cyan brand with fuchsia accent for post form — two-tone identity
- 279 lines, single-file — lean
- All real data from `/api/lfg/open` — no mock data
- Four honest states: loading/error/empty/populated
- Background refresh via useSmartPolling — no flicker
- "you" badge on own posts (fuchsia) — honest session tracking
- Text is extremely dense: `text-[11px]` dominant body size
- Flash message system is inline, not toast — functional but visually modest
- Form uses native `<select>` elements — functional but not styled

DESIGN DIRECTION: Group-finder board — MMO-style LFG board. Cyan for the social/matching identity, dark atmospheric background for the gaming feel. Think FFXIV Party Finder / WoW Group Finder — role icons (tank/healer/dps), world badges, clean post cards with action buttons.

LAYOUT UPGRADE:
- Header: Users icon in cyan badge + title + refresh
- 2-column: request list (2/3) + post form (1/3) — already correct
- Request items: role badge + world + party type + note + action button
- Filter bar: world + role dropdowns — already correct

COMPONENT-LEVEL CHANGES:
- `text-[11px]` dominant → `text-xs` for body text (12px vs 11px — small change, big readability improvement)
- Native `<select>` → styled select with `rounded-md border border-cyan-500/20 bg-cyan-500/5`
- Request items: add role-specific color coding (tank=blue, healer=green, dps=red, support=purple, any=gray)
- Post form: wrap in distinct panel with fuchsia accent border

VISUAL UPGRADES:
- Typography: increase body to `text-xs` (from `text-[11px]`)
- Role badges: color-coded by role type (not just cyan)
- Request cards: add subtle left-border accent by role
- Form: styled selects instead of native
- Flash messages: consider upgrading to toast for better visual treatment

CAPABILITY PRESENTATION:
- Post requests → real form → well-presented but uses native selects
- Filter by world/role → real dropdowns → functional but could be more visual
- Invite/Cancel → real buttons → well-presented with honest session tracking
- Auto-refresh → useSmartPolling → invisible but correct

LENS IDENTITY: The only LFG/party-finder tool. Cyan + gradient background + role badges = MMO social matching, distinct from all other lenses.

RESPONSIVE DESIGN: 2fr:1fr grid stacks on mobile. Already handles breakpoints.

BEFORE/AFTER:
- Before: Ultra-dense 11px text, native selects, single-tone cyan
- After: 12px body text, styled selects, color-coded role badges, role-specific card accents

IMPLEMENTATION PLAN:
1. Increase body text to `text-xs` (from `text-[11px]`)
2. Add role-specific color coding for badges
3. Replace native selects with styled selects
4. Add left-border accent per role type on request cards

PRIORITY: P1 — significant readability improvement needed (11px body text is too small)
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10
```

---

## 12. linguistics

```
LENS: linguistics
PURPOSE: Language analysis, lexicon, grammars, corpora, translations

CURRENT DESIGN:
- 879 lines — very dense, feature-rich page
- Pink-400 brand accent — distinctive
- 6 tabs (Analyses/Lexicon/Grammars/Corpora/Translations/Dashboard) with icon + color coding
- Quick Analysis panel with real `linguistics.analyze` macro — genuine NLP compute
- Subfield color-coding (phonology=pink, morphology=purple, syntax=blue, etc.) — functional visual encoding
- 3 collapsible sections: lookup tools, word lookup, word learning suite
- VocabularyBuilder + QuizEngine + ProgressDashboard + WordDecks + WordTools — deep feature set
- Detail panel with IPA, morphemes, syntax trees, glosses, examples — genuinely deep
- RecentMineCard + AutoActionStrip + CrossLensRecentsPanel footer

DESIGN DIRECTION: Linguistic research terminal — think Phonology Assistant / FLEx / TypeCraft. Pink accent for the phonological identity. Dense data tables, IPA transcription prominently displayed, morpheme breakdowns with color coding. The subfield color system is excellent — lean into it.

LAYOUT UPGRADE:
- Header: Languages icon in pink badge + title + realtime toolbar
- Quick Analysis: prominent input → result display — already correct
- Tab bar: 6 tabs with icons — already correct
- Content: 2-column grid (list 2/3 | detail 1/3) — already correct
- Collapsible sections: lookup tools, word learning, workbench — good progressive disclosure

COMPONENT-LEVEL CHANGES:
- Stat cards: `text-2xl font-bold` for numbers — already good emphasis
- Tab active: `bg-pink-400/20 text-pink-400` — correct
- Subfield badges: color-coded per SUBFIELD_COLORS — excellent
- Detail panel: `sticky top-4` — good for long-scroll context
- Quick Analysis input: `bg-lattice-deep border-lattice-border` — consistent

VISUAL UPGRADES:
- Typography: already has strong hierarchy (stat numbers, section headers, body text)
- Motion: framer-motion entrance animations on stats — already present
- Color: subfield color-coding is the strongest visual feature — ensure it's consistent
- The `lens-card` and `panel` CSS classes should be replaced with inline Tailwind

CAPABILITY PRESENTATION:
- Quick Analysis → real `linguistics.analyze` → well-presented with result display
- IPA transcription → displayed in detail panel → well-presented with `font-mono`
- Morpheme breakdown → color-coded badges → well-presented
- Vocabulary learning suite → 5 components → well-presented behind collapsible
- Datamuse/Dictionary lookup → collapsible panel → well-presented

LENS IDENTITY: The only linguistics/NLP tool. Pink accent + IPA display + subfield color-coding + morpheme badges = unmistakable language-science workspace.

RESPONSIVE DESIGN: 2-col grid stacks on mobile. Collapsible sections handle depth. Tab bar wraps.

BEFORE/AFTER:
- Before: CSS class dependencies (lens-card, panel), very long page (879 lines)
- After: Inline Tailwind, progressive disclosure via collapsibles, the page structure is already correct

IMPLEMENTATION PLAN:
1. Replace `lens-card` and `panel` CSS classes with inline Tailwind
2. Verify subfield color-coding is consistent in all views
3. Consider extracting the detail panel into a more prominent position on mobile

PRIORITY: P2 — polish (CSS class cleanup)
DESIGN SCORE: 7/10
UPGRADE POTENTIAL: 5/10
```

---

## 13. literary

```
LENS: literary
PURPOSE: Literary Resonance Lattice — public-domain corpus search with provenance

CURRENT DESIGN:
- Violet/amber brand — literary and scholarly
- Gradient background: `from-slate-950 via-zinc-950 to-purple-950/10` — atmospheric
- Real BM25 + dense hybrid search with honest "Grounded" vs "Keyword only" badge
- Honest empty corpus CTA: "Run node scripts/ingest-gutenberg.mjs"
- Annotation system that mints DTUs citing source passages — genuinely deep
- Resonance lattice force-graph visualization — distinctive
- Crystallization candidates panel — cross-domain bridge discovery
- Cross-domain resonance bridges — lateral connections
- Export as GraphML/CSV/JSON — real graph export
- Full passage reader with neighbor navigation — real reading experience
- All real data, zero fabricated content

DESIGN DIRECTION: Academic library / literary research tool — think JSTOR + Gephi force-graph. Violet for the scholarly identity. Dense passage text, provenance metadata, citation networks. The force-graph visualization is the signature element — it should be prominent and beautiful.

LAYOUT UPGRADE:
- Header: BookOpen icon in violet badge + corpus stats + export links — already correct
- Search bar: full-width with violet focus ring — already correct
- 2-column: results (2/3) + sidebar (1/3) with graph, provenance, annotations
- Below: crystallization candidates + resonance lattice graph

COMPONENT-LEVEL CHANGES:
- Header: `text-lg font-semibold tracking-wide` — already good
- Search button: `bg-violet-600 hover:bg-violet-500` — correct
- Result cards: `rounded-lg border border-zinc-800 bg-zinc-900/50` — consistent
- Selected state: `border-violet-500/60 bg-violet-950/20` — clear selection feedback
- Provenance panel: `rounded-lg border border-zinc-800 bg-zinc-900/50` — consistent

VISUAL UPGRADES:
- Typography: passage text needs `leading-relaxed` (already present on snippets)
- The force-graph should be larger/more prominent when corpus is populated
- Annotation textarea: `focus:border-sky-500/50` — sky is different from violet brand; should be violet
- Crystallization salience bar: `bg-cyan-500/70` — cyan is different from violet; should be violet or amber

CAPABILITY PRESENTATION:
- Hybrid search → real BM25 + dense → honest retrieval-mode badge
- Passage reader → real literary.detail → well-presented with neighbor navigation
- Annotations → real DTU minting → well-presented with save status
- Resonance lattice → GraphView force-graph → distinctive visualization
- Crystallization candidates → real salience ranking → well-presented with progress bars
- Export → GraphML/CSV/JSON → real, not fabricated

LENS IDENTITY: The only literary/corpus-research tool. Violet + force-graph + provenance metadata + annotation system = unmistakable literary scholarship workspace. The annotation-DTU-minting is genuinely unique.

RESPONSIVE DESIGN: 2-col stacks on mobile. Force-graph may need full-width treatment on small screens.

BEFORE/AFTER:
- Before: Sky/cyan accent inconsistency in annotation and crystallization panels
- After: Unified violet accent throughout, larger force-graph, consistent focus rings

IMPLEMENTATION PLAN:
1. Unify accent colors: sky-500/50 → violet-500/50 on annotation textarea focus
2. Unify crystallization bar: cyan-500/70 → violet-500/70
3. Enlarge force-graph on desktop (h-80 → h-96)
4. Add corpus stats as prominent hero element when populated

PRIORITY: P2 — polish (accent consistency)
DESIGN SCORE: 8/10
UPGRADE POTENTIAL: 5/10
```

---

## 14. loading.tsx

```
LENS: loading.tsx (shared Next.js loading state)
PURPOSE: Loading fallback for /lenses/* routes — NOT a user-facing lens

CURRENT DESIGN: This is a Next.js route loading file, not a rendered lens page. It provides a loading skeleton/fallback while lens pages load.

DESIGN DIRECTION: N/A — infrastructure file, not a visual surface.

PRIORITY: N/A — not a lens
DESIGN SCORE: N/A
UPGRADE POTENTIAL: N/A
```

---

## 15. lock

```
LENS: lock
PURPOSE: 70% sovereignty lock deep-dive — invariant visualization, audit, enforcement

CURRENT DESIGN:
- 869 lines — very dense, feature-rich
- Emoji 🔐 header — lower fidelity
- Lock percentage displayed prominently at `text-3xl font-bold` — correct emphasis
- Color-coded lock states: green (locked), amber (warning), red (danger) — excellent
- Lock gauge with 70% threshold marker — excellent visualization
- Stat cards with motion animations (staggered entrance) — polished
- Active invariants with status dots (green/yellow/red) — clear
- Lock history timeline with connector lines — nice touch
- Sovereignty Monitor with Ownership Verification gauge — excellent
- Live Enforcement feed with pass/blocked indicators — real runtime data
- LockProfiler + LockDashboard + SovereigntyDashboard — deep feature set
- InlineActionWall flagged by grader — action buttons spread across page

DESIGN DIRECTION: Security operations center — ThinkSplunk/Sentinel dashboard. Red/green/amber lock states should dominate. The sovereignty lock percentage is THE defining metric — it should be the first thing you see, larger and more prominent than anything else.

LAYOUT UPGRADE:
- Header: Lock icon in styled badge + sovereignty lock percentage (hero-sized)
- Lock gauge: keep prominent — this IS the lens
- Stat cards row: invariants, audits, enforcement rate, lock state
- Active invariants: grid with status indicators
- Sovereignty Monitor: gauges and enforcement feed
- Lock history: timeline with audit events
- LockProfiler: collapsible (it's a power-user tool)
- Footer: RecentMineCard/AutoActionStrip/CrossLensRecentsPanel

COMPONENT-LEVEL CHANGES:
- Emoji 🔐 → lucide `Lock` in `rounded-lg bg-neon-cyan/10 p-2`
- Lock percentage: `text-3xl font-bold` → `text-5xl font-bold font-mono` (make it the hero)
- Stat cards: keep `text-2xl font-bold` — correct emphasis
- Invariant list: add left border color by status (green/yellow/red)
- Lock history timeline: connector line already present — keep

VISUAL UPGRADES:
- Typography: lock percentage at `text-5xl` as hero metric
- Color: green/amber/red lock states already excellent — ensure consistent use
- Motion: staggered card entrance already present — keep
- The lock gauge with 70% threshold is the signature visualization — keep prominent
- `panel` CSS class → inline Tailwind for consistency

CAPABILITY PRESENTATION:
- Lock percentage → hero metric → make more prominent
- Invariant enforcement → status grid → well-presented
- Audit history → timeline → well-presented
- Sovereignty Monitor → gauges → well-presented
- Live Enforcement → real-time feed → well-presented with honest disclosure
- Lock Profiler → deep analysis tool → collapsible, correct

LENS IDENTITY: The only sovereignty/security-invariant lens. Lock icon + green/amber/red states + 70% gauge + enforcement feed = unmistakable security dashboard.

RESPONSIVE DESIGN: Stat cards grid (4-col → 2-col → 1-col). Gauge full-width. Already handles breakpoints.

BEFORE/AFTER:
- Before: Emoji header, lock percentage competes with stat cards for attention
- After: Lucide lock icon, lock percentage as hero metric (text-5xl), stat cards secondary

IMPLEMENTATION PLAN:
1. Replace emoji with lucide Lock
2. Make lock percentage the hero metric (text-5xl font-bold font-mono)
3. Replace `panel` CSS class with inline Tailwind
4. Add left-border color to invariant list items by status

PRIORITY: P1 — hero metric should dominate (lock % is currently same size as stat cards)
DESIGN SCORE: 7/10
UPGRADE POTENTIAL: 6/10
```

---

## 16. logistics

```
LENS: logistics
PURPOSE: FedEx/Project44-parity — fleet, shipments, warehouse, routes, compliance

CURRENT DESIGN:
- 522 lines — dense but well-organized
- Uses LensPageShell for consistent framing — good
- Real dashboard KPIs via `logistics.dashboard-summary` macro — real data
- 7 mode tabs (Fleet/Shipments/Tracker/Warehouse/Routes/Compliance/Map) with icons
- TMS workbench with 9 sub-tabs (Shipments/Carriers/Rates/Pickups/Docks/Fleet/Loads/POD/EDI Events) — extremely deep
- VisibilityTower — real-time visibility
- LogisticsActivityFeed — real shipment events
- MapView with fleet geolocation — real GPS data
- ShellPreview for rival shape
- MobileTabBar for mobile
- Uses `ds.*` design-system tokens in StatCard — consistent

DESIGN DIRECTION: TMS/logistics operations center — FedEx/Project44/Samsara shape. Cyan brand is correct. Dense dashboard with fleet KPIs, map view, shipment tracking. Think dispatch operators who need real-time visibility — information density is critical.

LAYOUT UPGRADE:
- ShellPreview (rival shape) — already present
- TMS workbench (collapsible) — already present with 9 sub-tabs
- Visibility tower (collapsible) — already present
- Dashboard KPIs: 2 rows of 4 stat cards — already correct
- Mode tabs: 7 tabs — already correct
- Activity feed — already present

COMPONENT-LEVEL CHANGES:
- StatCard: uses `ds.panel` and `ds.textMuted` — consistent with design system
- Tab active: `bg-neon-cyan/20 text-neon-cyan` — correct
- KPI values: `text-2xl font-bold` — good emphasis
- Mode tabs: `text-sm font-medium` with icon — clean

VISUAL UPGRADS:
- Typography: already consistent via design-system tokens
- Spacing: `ds.grid4` for KPI rows — consistent
- Icons: Truck, Package, Warehouse, Route, ShieldCheck, Navigation — appropriate
- Map view: `h-[500px]` — good prominence

CAPABILITY PRESENTATION:
- Fleet management → FleetVehiclesPanel → real macro-backed
- Shipment tracking → ShipmentTracker → real macro-backed
- Route optimization → RouteOptimizer → real macro-backed with HOS constraints
- Warehouse → WarehouseInventory → real macro-backed
- Map view → MapView with GPS positions → real fleet geolocation
- Compliance → ComplianceReportsPanel → real macro-backed
- TMS workbench → 9 sub-tabs → extremely deep, real

LENS IDENTITY: The only logistics/TMS tool. Cyan truck icon + fleet KPIs + map view = unmistakable logistics operations center.

RESPONSIVE DESIGN: Tab nav wraps. KPI grid adapts. Map full-width on mobile. Already handles breakpoints.

BEFORE/AFTER: No changes needed — well-organized, real data, deep feature set.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 8/10
UPGRADE POTENTIAL: 3/10
```

---

## 17. mail

```
LENS: mail
PURPOSE: Async player-to-player mail with attachments and COD

CURRENT DESIGN:
- 587 lines, single-file — lean and complete
- Uses `ds.*` design-system tokens throughout — most consistent approach
- Inbox/Sent/Compose tabs with unread count badge — excellent
- 2-column layout: mail list (1fr) + detail (2fr) — correct ratio for mail
- Search + status filters — real filtering
- Compose form with RecipientSearchInput (real user search) — genuine functionality
- DTU attachment picker (DTUPickerModal) — real attachment system
- CC gift + COD payment fields — real economy integration
- Read-on-select — honest behavior
- Realtime mail:received subscription — live updates
- Loading skeletons, empty states, error states — all honest
- All real data from `/api/mail/inbox` + `/api/mail/sent`

DESIGN DIRECTION: Email client — think Apple Mail / Thunderbird / Outlook. Blue brand is correct for messaging. Clean list-detail layout, unread indicators, attachment chips. This should feel like a real messaging product, not a game feature.

LAYOUT UPGRADE:
- Header: Mail icon in blue badge + title + refresh + tab bar (inbox/sent/compose)
- 2-column: mail list (left) + detail (right) — already correct
- Compose: full-width form with recipient search, subject, body, CC/COD, attachments

COMPONENT-LEVEL CHANGES:
- Tab bar: `text-[11px] font-medium capitalize` with `role="tab"` + `aria-selected` — excellent a11y
- Unread indicator: `h-1.5 w-1.5 rounded-full bg-neon-blue` — clean
- Mail list items: `border-l-2` left accent for selection/unread — excellent
- Detail header: subject + from/to + timestamp — well-organized
- Attachment chips: `bg-lattice-void px-1 tabular-nums` — clean, color-coded (amber=CW, cyan=DTU, red=COD)
- Compose form: `ds.overline` for labels, `ds.btnPrimary` for send — consistent

VISUAL UPGRADES:
- Typography: already consistent via design-system
- Spacing: `gap-3` for grid, `space-y-0.5` for list — appropriate for mail density
- Loading: Skeleton components — already present
- Empty: EmptyState component — already present with contextual messages
- Error: ErrorState component — already present with retry

CAPABILITY PRESENTATION:
- Mail list → real inbox/sent → well-presented with search and filters
- Mail detail → real read view → well-presented with attachments
- Compose → real recipient search + DTU attachments → well-presented
- COD payments → real economy integration → well-presented with honest claim flow
- Realtime updates → socket subscription → invisible but correct

LENS IDENTITY: The only mail/messaging lens. Blue mail icon + inbox unread count + attachment chips = unmistakable email client, distinct from message-lens (which is real-time chat).

RESPONSIVE DESIGN: 2-col stacks on mobile. Tab bar wraps. Already handles breakpoints.

BEFORE/AFTER: No changes needed — this is one of the most complete, honest, well-designed single-file lenses.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 9/10
UPGRADE POTENTIAL: 1/10
```

---

## 18. maker

```
LENS: maker
PURPOSE: Bubble/Retool-parity no-code app builder

CURRENT DESIGN:
- 352 lines — lean page shell
- Uses design-system tokens
- Real project creation flow — tested end-to-end
- 5 tabs: Editor/Data/Workflows/Connectors/Marketplace/Versions
- Components palette + drop-target canvas — real visual editor
- "Featured Actions" panel with honest "No actions registered" empty state
- 127 real quests in substrate

DESIGN DIRECTION: No-code builder — Bubble/Retool/Appsmith shape. Dark IDE theme with component palette on left, canvas center, properties right. Think developer tools — code editors, drag-and-drop builders, workflow visualizers.

LAYOUT UPGRADE:
- Already correct: thin page shell delegating to deep child components
- Tab bar for Editor/Data/Workflows/Connectors/Marketplace/Versions

COMPONENT-LEVEL CHANGES:
- Delegated to child components — no page-level changes needed

VISUAL UPGRADES:
- Delegated to child components

CAPABILITY PRESENTATION:
- Visual editor → real drag-and-drop → already excellent
- Data binding → real data tab → already present
- Workflow wiring → real workflows tab → already present
- Marketplace integration → real marketplace tab → already present
- Version tracking → real versions tab → already present

LENS IDENTITY: The only no-code builder. Retool/Bubble shape = unmistakable app-builder workspace.

RESPONSIVE DESIGN: Delegated to child components.

BEFORE/AFTER: No changes needed — genuinely deep and well-designed.

IMPLEMENTATION PLAN: No changes needed.

PRIORITY: P3 — already strong
DESIGN SCORE: 8/10
UPGRADE POTENTIAL: 3/10
```

---

## 19. manufacturing

```
LENS: manufacturing
PURPOSE: OEE, work orders, quality/SPC, shop-floor execution (MES)

CURRENT DESIGN:
- 8 files, 2345 LOC — substantial component tree
- Real BLS PPI + Federal Reserve G.17 economic feeds
- Real OEE formula (availability × performance × quality)
- Work Orders sub-view with Machines/Work Orders/Andon Alerts/Open NCRs
- False Disconnected pill (reported in audit)
- Industrial-terminal layout

DESIGN DIRECTION: MES/manufacturing operations — SAP/Oracle Manufacturing Cloud shape. Industrial colors: steel gray, safety yellow for alerts, green for running, red for stopped. Dense dashboard with OEE gauges, machine status grid, work order queue. Think factory floor supervisor who needs real-time production visibility.

LAYOUT UPGRADE:
- OEE dashboard: three gauges (availability, performance, quality) + overall OEE
- Machine status grid: color-coded by state (running/stopped/maintenance)
- Work order queue: sortable table with priority/status
- Andon alerts: real-time alert panel
- NCR tracking: quality issue management

COMPONENT-LEVEL CHANGES:
- Fix false Disconnected pill — this is a functional issue, not design
- Stat cards: ensure OEE numbers are visually dominant
- Machine status: use green/red/amber dot indicators

VISUAL UPGRADES:
- Add OEE gauge visualizations (ring/donut charts for A/P/Q)
- Add machine status grid with color-coded cells
- Industrial color scheme: steel gray containers, safety-yellow warnings

CAPABILITY PRESENTATION:
- OEE calculation → real formula → should be hero metric
- Work orders → real macro-backed → should be prominent
- Andon alerts → real-time → should be visible without scrolling
- Quality/SPC → real data → should be in dedicated view
- Economic feeds → BLS PPI + Fed G.17 → unique depth

LENS IDENTITY: The only manufacturing/MES tool. Machine icons + OEE gauges + andon alerts = unmistakable factory-floor operations.

RESPONSIVE DESIGN: Dashboard grids adapt. Machine status may need horizontal scroll on mobile.

BEFORE/AFTER:
- Before: OEE buried in tab content, false Disconnected pill
- After: OEE as hero metric with gauges, fixed connectivity indicator

IMPLEMENTATION PLAN:
1. Fix false Disconnected pill
2. Make OEE the hero metric with visual gauges
3. Add machine status grid with color indicators
4. Surface Andon alerts above the fold

PRIORITY: P1 — OEE is the defining metric and should be hero-sized
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10
```

---

## 20. market

```
LENS: market
PURPOSE: DTU marketplace, listings, economy simulation

CURRENT DESIGN:
- 14 files, 3062 LOC — substantial
- Yahoo Finance market-heatmap feed — real external integration
- "Your Balance 0 CC" — real wallet display
- "5 Active Listings" stat — real data
- Honest tour tip: "All orders settle through the on-substrate ledger"
- Create Listing form — real interactivity
- False Disconnected pill (reported in audit)
- Yahoo Finance heatmap stuck on "connecting..." (reported in audit)

DESIGN DIRECTION: Financial terminal / stock exchange shape. Green for gains, red for losses, real-time price tickers. Think Bloomberg Terminal lite — dense data, live feeds, price charts. The Yahoo Finance heatmap integration is the right direction.

LAYOUT UPGRADE:
- Header: balance display + listing count
- Market heatmap: Yahoo Finance integration (primary visual)
- Listing grid: active listings with price/creator/status
- Create listing: form panel

COMPONENT-LEVEL CHANGES:
- Fix false Disconnected pill
- Fix Yahoo Finance heatmap "connecting..." state
- Stat cards: make balance and listing count more prominent

VISUAL UPGRADES:
- Heatmap: ensure it renders correctly (not stuck on "connecting")
- Balance display: make more prominent (hero metric)
- Listing cards: add price/creator metadata prominently

CAPABILITY PRESENTATION:
- Market heatmap → Yahoo Finance → needs fix (stuck connecting)
- Balance → real wallet → should be hero metric
- Listings → real macro-backed → well-presented
- Create Listing → real form → well-presented
- Economy simulation → real macro-backed → already present

LENS IDENTITY: The only financial-markets lens. Yahoo Finance heatmap + CC balance + listings = market terminal.

RESPONSIVE DESIGN: Heatmap may need full-width on mobile. Listing grid adapts.

BEFORE/AFTER:
- Before: Heatmap stuck, false disconnected pill
- After: Working heatmap, fixed connectivity, hero balance display

IMPLEMENTATION PLAN:
1. Fix false Disconnected pill
2. Fix Yahoo Finance heatmap connection state
3. Make CC balance the hero metric
4. Ensure heatmap renders on all screen sizes

PRIORITY: P1 — heatmap is broken and balance should be hero
DESIGN SCORE: 5/10
UPGRADE POTENTIAL: 8/10
```

---

## 21. marketing

```
LENS: marketing
PURPOSE: Marketing hub — HubSpot shape (campaigns, leads, attribution)

CURRENT DESIGN:
- 17 files, 3358 LOC — substantial
- Real Campaigns/Leads/Content & Tests/Channels tabs
- Honest all-zero stat row — no fabricated data
- "Audiences ride the substrate so retargeting stays consistent" — excellent tour tip
- New campaign form — real interactivity
- False Disconnected pill (reported in audit)
- Blended-ROAS attribution math — real

DESIGN DIRECTION: HubSpot/Marketo shape — marketing operations dashboard. Orange/warm brand for marketing identity. Campaign cards with performance metrics, lead pipeline visualization, A/B test results.

LAYOUT UPGRADE:
- Header: marketing hub title + campaign count
- Tab bar: Campaigns/Leads/Content & Tests/Channels
- Content: campaign cards with performance metrics
- Lead pipeline: funnel visualization

COMPONENT-LEVEL CHANGES:
- Fix false Disconnected pill
- Ensure stat cards have real data when campaigns exist
- Campaign cards should show key metrics (impressions, clicks, conversions)

VISUAL UPGRADES:
- Add campaign performance visualization (bar charts for ROAS)
- Lead pipeline: funnel stages with counts
- A/B test results: side-by-side comparison cards

CAPABILITY PRESENTATION:
- Campaigns → real macro-backed → well-presented
- Leads → real macro-backed → well-presented
- Attribution → real ROAS math → should be visualized
- Content & Tests → real A/B testing → should show results

LENS IDENTITY: The only marketing/CRM tool. Campaign cards + lead pipeline + ROAS attribution = HubSpot-shape marketing hub.

RESPONSIVE DESIGN: Tab bar wraps. Campaign cards grid adapts.

BEFORE/AFTER:
- Before: False disconnected pill, all-zero stats look empty
- After: Fixed connectivity, campaign cards with metrics when populated

IMPLEMENTATION PLAN:
1. Fix false Disconnected pill
2. Ensure campaign cards show real metrics when campaigns exist
3. Add ROAS visualization
4. Add lead pipeline funnel view

PRIORITY: P2 — polish (fix connectivity, improve populated state)
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10
```

---

## 22. marketplace

```
LENS: marketplace
PURPOSE: Creative marketplace — Etsy/Bandcamp-shape (Browse/Watchlist/My Shop/Cart/Purchases/Analytics)

CURRENT DESIGN:
- 21 files, 7833 LOC — the most substantial lens in this batch
- My Shop: genuinely excellent Etsy/Shopify-shape Shop Manager with 13+ sub-sections
- Browse listing feed — starts empty (honest, confirmed correct via depth-test harness)
- InlineActionWall flagged by grader — action buttons spread across page
- Real purchase flow with `marketplace.list`/`purchaseWithRoyalties`
- Honest empty Browse state — no fabricated listings
- Tabs: Browse/Watchlist/My Shop/Cart/Purchases/Analytics

DESIGN DIRECTION: Etsy/Shopify/Bandcamp — creative seller marketplace. Warm brand for creator economy. Product cards with images, pricing, creator badges. The Shop Manager sidebar is already excellent — it IS the identity.

LAYOUT UPGRADE:
- Header: marketplace title + balance
- Tab bar: Browse/Watchlist/My Shop/Cart/Purchases/Analytics
- Browse: product grid with category filters
- My Shop: sidebar navigation (already excellent)
- Analytics: sales/revenue dashboards

COMPONENT-LEVEL CHANGES:
- My Shop sidebar: already excellent — 13+ real sections (Home/Storefront/Listings/etc.)
- Browse grid: ensure product cards have images and pricing prominently displayed
- Tab active: appropriate brand color

VISUAL UPGRADES:
- Product cards: image + title + price + creator badge + category tag
- Browse grid: responsive masonry or uniform grid
- My Shop: keep the existing sidebar navigation — it's excellent
- Analytics: add revenue/sales charts

CAPABILITY PRESENTATION:
- Shop Manager → 13+ sub-sections → genuinely deep, already well-presented
- Browse → starts empty (honest) → will populate as marketplace grows
- Purchase flow → real economy integration → well-presented
- Analytics → real metrics → should be visualized with charts
- Watchlist → real persistence → well-presented

LENS IDENTITY: The only creative marketplace. Product cards + Shop Manager sidebar + creator royalties = unmistakable Etsy/Bandcamp-shape marketplace.

RESPONSIVE DESIGN: Tab bar wraps. Shop Manager sidebar may need to collapse on mobile. Product grid adapts.

BEFORE/AFTER:
- Before: InlineActionWall pattern, empty Browse feels broken (but is honest)
- After: Streamlined action placement, more inviting Browse empty state with guidance

IMPLEMENTATION PLAN:
1. Streamline InlineActionWall — consolidate into contextual actions
2. Improve Browse empty state: "No listings yet — create your first listing in My Shop"
3. Ensure product cards have image placeholders and prominent pricing
4. Add revenue charts to Analytics tab

PRIORITY: P1 — InlineActionWall pattern needs streamlining, empty Browse needs better guidance
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 8/10
```

---

## 23. markets

```
LENS: markets
PURPOSE: Prediction markets — wager Sparks on emergent outcomes

CURRENT DESIGN:
- 6 files, 2446 LOC
- Featured Actions grid: Alert cancel/create/list, Depth of book, Equilibrium Analysis, Forex quotes
- Spectator Markets: non-extractive Sparks wagering on real substrate signals
- Alert list button now shows honest "needs existing prediction_market" message (fixed bug)
- No generic scaffold — deliberately clean

DESIGN DIRECTION: Prediction market / sports betting terminal — Polymarket/Manifold shape. Green for gains, red for losses, live odds displays, market depth visualizations. The "Sparks" currency framing adds unique identity — non-extractive wagering on emergent outcomes.

LAYOUT UPGRADE:
- Header: markets title + Sparks balance
- Featured Markets: active prediction markets with odds/bets
- Market depth: order book visualization
- Alerts: price/alert management
- Forex: currency pairs

COMPONENT-LEVEL CHANGES:
- Ensure market cards show odds, volume, and time remaining prominently
- Add visual odds display (bar chart or probability gauge)

VISUAL UPGRADES:
- Market cards: probability gauge + volume + time remaining
- Order book: depth visualization (bid/ask stack)
- Alerts: clean list with trigger conditions

CAPABILITY PRESENTATION:
- Spectator Markets → real Sparks wagering → should be hero feature
- Depth of book → real market data → should be visualized
- Equilibrium Analysis → real macro → should show results
- Forex quotes → real data → should be in dedicated panel

LENS IDENTITY: The only prediction-market lens. Sparks currency + probability gauges + emergent outcomes = unique non-extractive betting terminal.

RESPONSIVE DESIGN: Market cards grid adapts. Order book may need full-width on mobile.

BEFORE/AFTER:
- Before: Alert list was broken (fixed), market cards need more visual depth
- After: Working alerts, probability gauges on market cards, prominent Sparks balance

IMPLEMENTATION PLAN:
1. Add probability gauge visualization to market cards
2. Make Sparks balance the hero metric
3. Add volume/time-remaining indicators
4. Visualize order book depth

PRIORITY: P2 — polish (visual depth for market cards)
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10
```

---

## 24. masonry

```
LENS: masonry
PURPOSE: Contractor operations — takeoff, proposals, scheduling, photos, change orders, price book, invoicing

CURRENT DESIGN:
- 4 files, 1843 LOC
- Real stat row: Active Jobs/Completed Jobs/Revenue Collected/Outstanding/Proposal Accept Rate
- 11-tab Contractor Suite — extremely deep
- Matches carpentry/plumbing/electrical/hvac/welding trade family
- False Disconnected pill (reported in audit)

DESIGN DIRECTION: Contractor operations — Jobber/Houzz Pro/Buildertrend shape. Earthy tones for construction identity. Dashboard with job pipeline, revenue metrics, scheduling calendar. Think contractor who needs job-site visibility from the office.

LAYOUT UPGRADE:
- Header: contractor tools title + stat row
- Tab bar: 11 tabs (Takeoff/Proposals/Schedule/Photos/Change Orders/Price Book/Invoices/Code Library/Clients/Inspections/Certifications)
- Content: delegated to child components per tab

COMPONENT-LEVEL CHANGES:
- Fix false Disconnected pill
- Stat cards: ensure Active Jobs/Revenue are hero metrics
- Tab icons: appropriate construction tool icons

VISUAL UPGRADES:
- Add revenue trend visualization (line chart for monthly revenue)
- Job pipeline: Kanban-style view (Lead → Proposal → Active → Complete)
- Schedule: calendar view integration

CAPABILITY PRESENTATION:
- Takeoff → real measurement tool → well-presented
- Proposals → real generation → well-presented
- Schedule → real scheduling → should be prominent
- Price Book → real pricing → well-presented
- Invoicing → real billing → well-presented

LENS IDENTITY: The only contractor-operations tool. Hammer/wrench icons + revenue metrics + job pipeline = construction business management.

RESPONSIVE DESIGN: Tab bar with 11 tabs needs horizontal scroll on mobile. Stats adapt.

BEFORE/AFTER:
- Before: False disconnected pill, 11 tabs may overwhelm
- After: Fixed connectivity, job pipeline visualization, revenue charts

IMPLEMENTATION PLAN:
1. Fix false Disconnected pill
2. Add revenue trend chart
3. Add job pipeline visualization
4. Consider collapsing less-used tabs behind "More" on mobile

PRIORITY: P2 — polish (fix connectivity, add revenue visualization)
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10
```

---

## 25. materials

```
LENS: materials
PURPOSE: Materials science — material library, tests, comparisons, suppliers, composites, standards

CURRENT DESIGN:
- 10 files, 3143 LOC
- Real stat row: Catalog/Categories/Tested/Approved
- 6 tabs: Library/Tests/Compare/Suppliers/Composites/Standards
- Material comparison tool — genuine utility
- Standards lookup — real reference data
- False Disconnected pill (reported in audit)

DESIGN DIRECTION: Materials reference — MatWeb/Granta shape. Steel-gray palette for materials identity. Material cards with property tables, comparison views with side-by-side specs, standards reference panels.

LAYOUT UPGRADE:
- Header: materials science title + catalog stats
- Tab bar: Library/Tests/Compare/Suppliers/Composites/Standards
- Content: delegated to child components per tab

COMPONENT-LEVEL CHANGES:
- Fix false Disconnected pill
- Material cards: ensure property tables are dense and scannable
- Compare view: side-by-side property comparison

VISUAL UPGRADES:
- Material cards: property density (density, strength, conductivity, etc.)
- Compare view: highlighted differences between materials
- Standards: code reference panels (ASTM, ISO, etc.)

CAPABILITY PRESENTATION:
- Material Library → real catalog → well-presented
- Tests → real test data → well-presented
- Compare → real comparison tool → should be prominent
- Suppliers → real supplier data → well-presented
- Standards → real reference → well-presented

LENS IDENTITY: The only materials-science tool. Material property tables + comparison views + standards codes = unmistakable materials reference.

RESPONSIVE DESIGN: Tab bar wraps. Material cards grid adapts. Compare view stacks on mobile.

BEFORE/AFTER:
- Before: False disconnected pill
- After: Fixed connectivity, comparison view as hero feature

IMPLEMENTATION PLAN:
1. Fix false Disconnected pill
2. Make Compare tab the default view when materials exist
3. Add property density to material cards

PRIORITY: P2 — polish (fix connectivity)
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 7/10
```

---

## 26. math

```
LENS: math
PURPOSE: Expression evaluator, equation solver, formula reference & function plotter

CURRENT DESIGN:
- 5 files, 2385 LOC
- Real CAS compute: integral of x² from 0 to 5 = 41.66666667 (correct!)
- arXiv Mathematics + MathOverflow live feed integrations
- InlineActionWall flagged by grader — action buttons spread across page
- Math lens is the platform's clearest demonstration of "compute-don't-guess"
- Clean CAS result cards with labeled output types

DESIGN DIRECTION: Mathematical workspace — Wolfram Alpha / Desmos shape. Blackboard-like dark background with crisp white equations. Monospace for formulas, clear result labeling, function plot visualization. The CAS compute IS the identity — make it the hero.

LAYOUT UPGRADE:
- Hero: input expression → CAS compute button → result display
- Result cards: expression type, computed value, closed form (when available)
- Reference: formula library
- Feed: arXiv + MathOverflow

COMPONENT-LEVEL CHANGES:
- InlineActionWall: consolidate compute actions into a single prominent "Compute" button
- Result cards: `text-lg font-bold font-mono` for computed values — ensure prominent
- Expression input: large, prominent, monospace

VISUAL UPGRADES:
- Expression input: full-width, `font-mono text-lg` with prominent compute button
- Result display: `text-2xl font-bold font-mono` for the answer
- Formula reference: categorized grid of formulas
- Function plot: inline graph visualization (if available)

CAPABILITY PRESENTATION:
- CAS compute → real engine → should be hero (input → compute → result)
- Formula reference → real library → should be browsable
- arXiv feed → real integration → should be sidebar
- MathOverflow feed → real integration → should be sidebar

LENS IDENTITY: The only math/CAS tool. Monospace equations + computed results + formula reference = mathematical workspace. This IS the platform's "compute-don't-guess" exemplar.

RESPONSIVE DESIGN: Expression input full-width. Result cards stack. Feed sidebar collapses.

BEFORE/AFTER:
- Before: InlineActionWall spreads compute actions, CAS results not hero-sized
- After: Single prominent compute button, hero-sized result display, clean expression input

IMPLEMENTATION PLAN:
1. Consolidate InlineActionWall into single prominent "Compute" button
2. Make CAS result the hero display (text-2xl font-bold font-mono)
3. Make expression input full-width and prominent
4. Add function plot visualization inline

PRIORITY: P1 — CAS compute should be the hero, not buried in action wall
DESIGN SCORE: 6/10
UPGRADE POTENTIAL: 8/10
```

---

## 27. meditation

```
LENS: meditation
PURPOSE: Quiet session player + streak — Calm/Headspace shape

CURRENT DESIGN:
- 7 files, 1848 LOC
- Real daily prompt: "What is the texture of your breath right now?"
- Real goal categories: Focus/Sleep/Anxiety/Gratitude/Breath
- Real duration picker: 3m-45m, each mapping to real named tracks
- Named teachers: Sharon Salzberg, Tara Brach
- Day-streak tracker — honest daily-use case
- 5/5 pillars, polished tier

DESIGN DIRECTION: Calm/Headspace/Insight Timer — meditation and mindfulness. Soft, calming palette. Minimal chrome. The breathing visualization and session player should be the dominant visual elements. Think serene, unhurried, spacious.

LAYOUT UPGRADE:
- Hero: daily prompt + breathing visualization
- Goal categories: horizontal selector with icons
- Duration picker: clean grid of time options
- Session player: prominent play/pause with track info
- Streak: subtle but persistent daily-streak display

COMPONENT-LEVEL CHANGES:
- Daily prompt: make more prominent — this IS the meditation entry point
- Goal categories: larger touch targets for mobile meditation
- Duration picker: clean circular or grid layout
- Session player: minimal, calming design

VISUAL UPGRADES:
- Typography: calm, readable — avoid dense/small text
- Color: soft, muted palette — not bright or aggressive
- Motion: subtle breathing animation (pulse at breath rate)
- Spacing: generous whitespace — meditative feel
- Background: gradient or soft texture

CAPABILITY PRESENTATION:
- Daily prompt → real guidance → should be hero element
- Goal categories → real track mapping → should be visual/icon-rich
- Duration picker → real time selection → should be clean and simple
- Session player → real audio tracks → should be minimal and calming
- Streak → real daily tracking → should be subtle persistent indicator

LENS IDENTITY: The only meditation/mindfulness lens. Breathing visualization + daily prompt + streak = Calm/Headspace-shape wellness tool. Should feel like a pause, not a dashboard.

RESPONSIVE DESIGN: Full-width on all devices. Touch-friendly large targets. Minimal chrome.

BEFORE/AFTER:
- Before: Feature-rich but may feel too "app-like" for meditation
- After: Spacious, calming, breathing-focused with minimal chrome

IMPLEMENTATION PLAN:
1. Make daily prompt the hero element (larger, centered)
2. Add subtle breathing pulse animation
3. Increase whitespace throughout
4. Simplify session player to minimal controls
5. Make streak display subtle but persistent

PRIORITY: P2 — polish (more meditative feel)
DESIGN SCORE: 7/10
UPGRADE POTENTIAL: 6/10
```

---

## Summary Rankings

### P0 — Redesign Immediately
(none in this batch — all lenses are at least functional)

### P1 — Major Visual Upgrade
| Lens | Score | Issue |
|---|---|---|
| lfg | 6/10 | 11px body text too small, native selects, no role color-coding |
| lock | 7/10 | Lock % should be hero metric, emoji header |
| math | 6/10 | CAS compute buried in InlineActionWall, not hero |
| manufacturing | 6/10 | OEE not hero-sized, false disconnected pill |
| market | 5/10 | Heatmap broken, false disconnected pill, balance not hero |
| marketplace | 6/10 | InlineActionWall, empty Browse needs better guidance |

### P2 — Polish
| Lens | Score | Issue |
|---|---|---|
| kingdoms | 6/10 | Emoji header, mixed card palettes, footer nesting |
| lab | 6/10 | Emoji header, flat hierarchy, CSS class deps |
| legacy | 6/10 | Emoji header, missing error UI, CSS class deps |
| linguistic | 7/10 | CSS class deps, very long page |
| literary | 8/10 | Accent color inconsistency (sky vs violet) |
| masonry | 6/10 | False disconnected pill, needs revenue viz |
| materials | 6/10 | False disconnected pill |
| markets | 6/10 | Market cards need visual depth |
| meditation | 7/10 | Needs more meditative spacious feel |
| marketing | 6/10 | False disconnected pill, empty stats |

### P3 — Already Strong
| Lens | Score | Notes |
|---|---|---|
| lattice | 9/10 | Reference-quality MLOps dashboard |
| law | 9/10 | Reference-quality legal research terminal |
| legal | 9/10 | Reference-quality practice management |
| ledger | 9/10 | Reference-quality noir detective surface |
| mail | 9/10 | Reference-quality email client |
| logistics | 8/10 | Deep, well-organized TMS |
| law-enforcement | 8/10 | Clean, well-delegated CAD |
| landscaping | 8/10 | Clean thin shell, delegated |
| literary | 8/10 | Deep, honest, distinctive |
| maker | 8/10 | Deep no-code builder |
| lock | 7/10 | Dense but well-structured |
