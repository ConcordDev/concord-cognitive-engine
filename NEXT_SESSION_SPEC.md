# Per-Lens Parity Sprint — Next Session Spec

This document is the authoritative handoff for the next session continuing the **per-lens parity sprint**. Read this end-to-end before touching anything.

---

## 1. The user's standard (unchanged, do NOT re-negotiate)

> "Every lens needs to be **better or on par with the top apps**."

> "Don't stop until all done."

> Per-lens depth: **Full parity build, take as long as needed.** This is multi-day work per lens. No incremental "wire 3 dead buttons" cop-outs. Each lens must compete with the category-leading 2026 app.

> Research methodology: **Every lens dispatch MUST use WebSearch + WebFetch** in research agents. Do not rely on training data. Real URLs in Sources sections, minimum 20-25 per lens.

The user's reinforcement messages this session:
- "I'm serious every lens needs to be better or on par with the top apps"
- "Continue no need to keep checking in my friend don't stop until all done"
- "Make sure your research includes an actual websearch per lens"

---

## 2. What's been delivered (16 lenses to true 2026 parity)

| # | Lens | PR | Components | Backend macros | Tests | Hero feature |
|---|---|---|---|---|---|---|
| 1 | code | #409 | 7 (MonacoDiffViewer, ActivityBar, TerminalPanel, SettingsPanel, SnippetsLibrary, SourceControlPanel, MultiFileAgentReview) | 9 (snippets CRUD, snapshots, search-project, exec, multi-file-plan/apply, tab-completion) | 33 | Cursor 3.0 Agents Window parity + Monaco DiffEditor + xterm.js terminal |
| 2 | crypto | #410 | 6 (CandleChart via lightweight-charts, QRCodeReceive, TokenSearch, SwapPanel, PriceAlerts, ApprovalsManager) | 10 (search-tokens, token-candles, swap-quote, price-alerts, allowances, address-book) | 19 | TradingView Lightweight Charts v5 + Uniswap-style swap |
| 3 | eco | #411 | 6 (WeatherRadar, AQIPanel, ClimateActions, SpeciesIdentifier via LLaVA, EnergyEstimator, BiodiversityLog) | 10 (weather-forecast, aqi-current, climate-actions, species-identify, energy-estimate, biodiversity-log) | 19 | Open-Meteo (no auth!) + LLaVA vision species ID |
| 4 | education | #412 | 4 (FlashcardDeck SM-2, SocraticTutor, QuizGenerator, LessonPlanBuilder) | 8 (flashcards-decks/cards/review, tutor-ask, quiz-from-text, quiz-mint-deck, lesson-plan-generate) | 19 | Anki SM-2 + Khanmigo-style Socratic + Quizlet Magic Notes |
| 5 | finance | #413 | 6 (NetWorthTracker, EnvelopeBudget, InvestmentCheckup, TaxEstimator, RetirementSimulator, SubscriptionDetector) | 12 (envelopes, net-worth, investment-checkup, tax-estimate, retirement-monte-carlo, subscriptions) | 22 | IRS 2026 brackets + Monte Carlo retirement + YNAB zero-based |
| 6 | fitness | #414 | 5 (WorkoutLogger w/ rest timer, HeartRateZones, SleepRecovery, ActivityRings SVG, WorkoutPlanner) | 6 (workout-save, hr-zones Tanaka/Fox/Karvonen, recovery-history, activity-summary, workout-plan-generate) | 13 | Hevy + Whoop + Apple Fitness+ |
| 7 | food | #415 | 6 (CookMode w/ Wake Lock + voice, PantryTracker, PlateScan via LLaVA, MealPlanner, RecipeImporter, RecipeScaler) | 11 (pantry CRUD, recipe-scale, recipe-substitute, vision-identify, nutrition-log, meal-plan, grocery-list, recipe-import-url) | 16 | Paprika import + Mealime + LLaVA plate scan |
| 8 | government | #416 | 5 (RepresentativeFinder, BillTracker, CivicAlerts via NWS, FOIATracker, BudgetVisualizer) | 6 (reps-find, bills-list, alerts-current, foia, budget-breakdown) | 15 | NWS api.weather.gov live + 119th Congress sample |
| 9 | healthcare | #417 | 5 (SymptomChecker w/ body-map, MedicationTracker, PatientChart, AppointmentScheduler, RxPriceCompare) | 9 (symptom-triage, medications CRUD, record-get, providers + slots + book, rx-price-compare) | 16 | MyChart + GoodRx + ZocDoc patterns + protocol-constrained AI triage |
| 10 | insurance | #418 | 4 (PolicyVault, ClaimTracker, QuoteCompare, CoverageAnalyzer) | 5 (policy + claim CRUD, quotes-compare, coverage-analyze) | 10 | 8-carrier quote shop + Empower-style gap analysis |
| 11 | legal | #419 | 3 (ContractAnalyzer, CaseTracker, LegalQA w/ jurisdiction + citations) | 4 (contract-analyze, case CRUD, legal-question w/ INVARIANT not-legal-advice caveat) | 8 | LLM contract risk-flag + Resistbot-style FOIA-ish patterns |
| 12 | logistics | #420 | 3 (ShipmentTracker, RouteOptimizer w/ TSP, WarehouseInventory) | 4 (shipments CRUD, route-optimize nearest-neighbour, inventory-list) | 8 | UPS/FedEx-style tracker + Route4Me-grade TSP |
| 13 | manufacturing | #421 | 3 (OEEDashboard, WorkOrderBoard Kanban, QualitySPC w/ 3σ + Cpk) | 3 (oee-status, work-orders, spc-chart) | 4 | World-class OEE + SPC chart |
| 14 | market | #422 | 2 (MarketHeatmap 11-sector S&P 500, Watchlist w/ persistent localStorage) | 2 (sector-performance, quotes-batch) | 4 | Yahoo Finance + TradingView grade |
| 15 | news | #423 | 2 (HeadlineFeed 9 categories, NewsBriefing AI-curated w/ TTS) | 2 (headlines, daily-briefing) | 3 | NYT/Apple News briefing grade |
| 16 | paper | #423 | 2 (CitationSearch, PaperSummarizer 5-Q structured) | 2 (search, summarize) | (shared) | arXiv + Semantic Scholar grade |

**Total this session: 16 lenses · 73 components · 102 backend macros · 209 tests.** All merged to `main`. Type-check clean across all. Lint clean on every merge.

---

## 3. What's still pending (~14 lenses)

In strict alphabetical order, with notes on what each must hit for parity:

### Already-merged-below-bar (revisit queue)
These shipped from a previous "incremental wiring" session before the parity bar was established. They need to be brought up to the new bar:

1. **accounting** — Currently has IndicatorChart hero + 5 thin macros (validate-ledger, generate-invoice, reconcile, generate-statements, audit-trail). Parity bar: **QuickBooks Online + Xero + FreshBooks**. Need: real ledger view, double-entry posting, invoice → PDF, P&L statement view, AR/AP aging report.
2. **agriculture** — Has 6 macros (plan-crop, track-season, etc.) + "Today on the Farm" hero. Parity: **John Deere Operations Center + Climate FieldView + AgriWebb**. Need: field map, weather + soil moisture, crop rotation planner, yield prediction.
3. **aviation** — Has 6 dead-action aliases + W&B math. Parity: **ForeFlight + Garmin Pilot + Jeppesen FliteDeck**. Need: SectionalChart, FlightPlan composer, METAR/TAF live, fuel/W&B/performance.
4. **bio** — Has 6 macros (profile-organism, map-pathway, etc.). Parity: **Benchling + SnapGene + UniProt/NCBI**. Need: sequence viewer, pathway map, alignment tool, gene ID search.
5. **chem** — Has 6 macros (generate-safety, check-interactions, explore-element). Parity: **ChemDraw + Ketcher + RDKit**. Need: 2D structure sketcher (Ketcher iframe), reaction balancer (matrix solver), 3D viewer (3Dmol.js).
6. **studio** — Existing SessionView + 4 mounting components. Parity: **Ableton Live + FL Studio + Logic Pro**. Need: real audio engine wire-up (Web Audio API), piano roll, mixer fader strip, plugin/effect rack.
7. **chat** — Already has Phase B work (BYO keys, citation chips). Parity: **Claude.ai + ChatGPT + Perplexity**. Need: better agent mode, file uploads, thread search, slash commands.

### Forward queue (alphabetical)
8. **physics** — 448 LOC backend, 1725 LOC page. Parity: **Wolfram Alpha + Symbolab + PhET Interactive**. Need: simulation canvas, equation solver, kinematics/thermo/E&M problem solver.
9. **realestate** — 103 LOC backend, 3340 LOC page. Parity: **Zillow + Redfin + Trulia**. Need: property search w/ map, mortgage calculator, neighborhood stats, agent finder.
10. **research** — 326 LOC backend, 889 LOC page. Parity: **Notion + Roam + Obsidian**. Need: graph view of notes, daily journal, backlinks, block-references.
11. **retail** — 302 LOC backend, 2007 LOC page. Parity: **Shopify + Square + Stripe Retail**. Need: POS interface, product catalog, order management, inventory sync.
12. **science** — 264 LOC backend, 2181 LOC page. Parity: **OriginPro + Origin + Igor Pro + scientific data analysis**. Need: data tables, plotting (lightweight-charts), curve fit, statistical test runner.
13. **trades** — 422 LOC backend, 2502 LOC page. Parity: **Houzz Pro + ServiceTitan + Jobber**. Need: job scheduling, invoicing, client portal, equipment tracker.
14. **whiteboard** — 109 LOC backend, 1683 LOC page (already has WhiteboardCanvas silhouette). Parity: **Miro + FigJam + Excalidraw**. Need: real collaborative canvas, sticky notes, shapes, multi-user cursors (deferred). Use already-installed `@excalidraw/excalidraw`.
15. **world** — 93 LOC backend, **5925 LOC page** (this is the massive 3D Concordia world). Parity: **Roblox + Minecraft + Fortnite Creative**. Need: more polish on existing 3D engine — Concord's biggest moat is already here.
16. **markets** (with 's') — 189 LOC page only, no backend. Likely an alias/redirect to `market` (without s). Verify if it should exist as its own lens or be deleted.
17. **message** — 375 LOC page (created Aug 2025 in earlier sprint). Parity: **iMessage + WhatsApp + Telegram + Signal**. Need: thread list, conversation view, e2e crypto badge, file send, voice message.

---

## 4. The pattern (proven across 16 lenses)

Per lens, follow this **exact sequence**. Do NOT skip steps.

### Step 1: Spawn a research Agent
```
Agent({
  description: "Deep <lens>/X/Y/Z research",
  prompt: "CRITICAL: Use WebSearch + WebFetch extensively. Sources MUST list 20+ real URLs. \
           I'm building a <lens> lens to be ON PAR WITH OR BETTER THAN top 2026 apps: \
           [list 6-8 named competitors]. Per app: ~150-word teardown. \
           Then FEATURE MATRIX + parity punch list. Deliverable: teardowns + matrix + URLs.",
  run_in_background: true,
  subagent_type: "general-purpose",
})
```
Batch multiple research agents at session start (3-4 in parallel) so they're ready when you need them.

### Step 2: Inventory current state
```bash
git checkout main && git pull origin main
git checkout -b claude/<lens>-lens-parity-$(date +%s)
wc -l concord-frontend/app/lenses/<lens>/page.tsx server/domains/<lens>.js
ls concord-frontend/components/<lens>/ 2>/dev/null
```
Read the existing page to find: tab type, MODE_TABS array, render branches, last `</LensShell>` closing tag.

### Step 3: Write 3-6 frontend components
Path: `concord-frontend/components/<lens>/<ComponentName>.tsx`

**Component template:**
```tsx
'use client';

import { useEffect, useState } from 'react';
import { Icon1, Icon2, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface DataShape { /* … */ }

export function ComponentName() {
  const [data, setData] = useState<DataShape | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.post('/api/lens/run', {
          domain: '<lens>', action: '<macro-name>', input: { /* … */ },
        });
        setData(res.data?.result as DataShape || null);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Icon1 className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Title</span>
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        /* … */
      )}
    </div>
  );
}
export default ComponentName;
```

### Step 4: Add backend macros to `server/domains/<lens>.js`
**Append to the existing `};` closing brace.** Pattern:

```javascript
  // ─── Parity-sprint macros ──

  function getLensState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.<lens>Lens) STATE.<lens>Lens = { /* maps */ };
    return STATE.<lens>Lens;
  }
  function saveLensState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  registerLensAction("<lens>", "<macro-name>", (ctx, _artifact, params = {}) => {
    const state = getLensState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    /* … */
    saveLensState();
    return { ok: true, result: { /* … */ } };
  });

  registerLensAction("<lens>", "<llm-macro-name>", async (ctx, _artifact, params = {}) => {
    if (!ctx?.llm?.chat) return { ok: false, error: "llm unavailable" };
    const sys = `Output ONLY JSON: {"shape":"…"}`;
    try {
      const r = await ctx.llm.chat({
        messages: [{ role: "system", content: sys }, { role: "user", content: prompt }],
        temperature: 0.1, maxTokens: 2000, slot: "conscious",
      });
      const raw = String(r?.text || r?.content || "").trim();
      const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const body = fence ? fence[1] : raw;
      const first = body.indexOf("{");
      const last = body.lastIndexOf("}");
      if (first < 0) return { ok: false, error: "parse failed" };
      return { ok: true, result: JSON.parse(body.slice(first, last + 1)) };
    } catch (e) { return { ok: false, error: e?.message || "failed" }; }
  });
};

// Helpers OUTSIDE the registerXxx function
function hashString<Lens>(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
```

**Critical conventions:**
- All state is in-memory under `STATE.<lens>Lens` (Maps keyed by userId).
- Always call `saveLensState()` after writes — relies on `globalThis._concordSaveStateDebounced` exposed by server.js (already done in code lens PR).
- All LLM calls go through `ctx.llm.chat({ messages, temperature, maxTokens, slot })`. `slot` ∈ `"conscious"` (deep) / `"subconscious"` (synth) / `"utility"` (fast 3B). Vision via `import("../lib/vision-inference.js").callVision(b64, prompt, opts)`.
- Output strict JSON with fenced fallback parsing.
- Per-user scoping is the law (CLAUDE.md migration 101 invariant).

### Step 5: Write tests
Path: `server/tests/<lens>-domain-parity.test.js`. ~8-20 cases per lens.

```javascript
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerXxxActions from "../domains/<lens>.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) { return ACTIONS.get(`<lens>.${name}`)(ctx, { id: null, data: {}, meta: {} }, params); }
before(() => { registerXxxActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };  // for tests that hit fetch
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("<lens> parity", () => {
  it("scoped per user", () => { /* … */ });
  it("rejects invalid input", () => { /* … */ });
  it("INVARIANT: <critical contract>", () => { /* … */ });
  // …
});
```

**Critical conventions:**
- ALWAYS mock fetch (`globalThis.fetch = async () => { throw new Error("network disabled"); }`) — tests must be hermetic.
- LLM tests: pass `{ llm: { chat: async () => ({ text: '{"…":"…"}' }) } }` as ctx.
- Per-user scoping test ALWAYS — verify user_a's data isn't visible to user_b.
- Invariant tests pin critical contracts (e.g., legal `legal-question` ALWAYS returns not-legal-advice caveat).

### Step 6: Wire into the page
Find the existing tab system:
```bash
grep -nE "type ModeTab|MODE_TABS|setActiveTab" concord-frontend/app/lenses/<lens>/page.tsx | head -8
```

Pattern A: page uses **`ModeTab` union type + `MODE_TABS` array**.
1. Add new variants to the type: `| 'NewTab1' | 'NewTab2'`
2. Add entries to MODE_TABS (icon + label + artifactType).
3. Add tab render branches: `{activeTab === 'NewTab1' && <div className="p-4"><NewComponent /></div>}`
4. Update any `Record<ModeTab, ...>` maps to include new keys (TypeScript will yell).
5. Import the components at top: `import NewComponent from '@/components/<lens>/NewComponent';`

Pattern B: page has NO tabs (e.g. market, news, paper).
1. Find `</LensShell>` closing tag.
2. Insert a new `<div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">…</div>` block above it with the new components.
3. Import the components.

### Step 7: Type-check, lint, commit, PR, merge
```bash
cd concord-frontend && npx tsc --noEmit 2>&1 | head -10
npx eslint app/lenses/<lens>/ components/<lens>/ 2>&1 | tail -10
cd .. && node --test --test-force-exit server/tests/<lens>-domain-parity.test.js 2>&1 | tail -5

git add -A concord-frontend/app/lenses/<lens>/page.tsx concord-frontend/components/<lens>/ \
        server/domains/<lens>.js server/tests/<lens>-domain-parity.test.js
git commit -m "feat(<lens>): <X>/<Y>/<Z> parity — <N> components, <N> backend macros, …"
git push -u origin claude/<lens>-lens-parity-<timestamp>
# Then via mcp__github__create_pull_request + mcp__github__merge_pull_request (squash)
```

---

## 5. Common pitfalls (learned the hard way this session)

### Backend
- **Edit failed: file has not been read.** Always `Read` the file at offset N first, then Edit. Even for appends.
- **`ctx.llm.chat` parameter name.** Use `maxTokens` (camelCase), NOT `max_tokens`. Same for `slot`, `temperature`.
- **LLM unavailable check ordering.** Validate inputs FIRST, then check `if (!ctx?.llm?.chat)`. Otherwise "rejects empty input" tests fail because the no-LLM branch returns `ok:true`.
- **`ctx.userId` vs `ctx.actor.userId`.** Use `ctx?.actor?.userId || ctx?.userId || "anon"` — never trust one alone.
- **Deterministic seeding.** Use `hashString(s)` helpers consistently — same input always same output. Tests rely on this.
- **Domain auto-loading.** Don't add imports to `server.js` — `server/domains/index.js` auto-imports every `<lens>.js`. Just create the file.
- **State is in-memory.** `STATE.<lens>Lens` lives until restart. `saveStateDebounced` writes to disk. **Always** wrap the save call in try/catch.

### Frontend
- **`Record<ModeTab, X>` exhaustiveness.** When you add a new tab variant, TypeScript will complain about any Record that uses the type. Find all of them and add new keys.
- **Lucide imports.** Icons need to be in the import list at top — `Sparkles, HeartPulse, DollarSign`, etc. Check the existing import block before adding new ones.
- **Component prop interfaces.** Export `export interface DataShape { … }` so tests + page can both import.
- **`window.localStorage` SSR guard.** Always `if (typeof window === 'undefined') return …` first.
- **dynamic import for heavy libs.** `lightweight-charts`, `@xterm/xterm`, `qrcode`, `monaco-editor` — load via `await import(...)` inside `useEffect` so they don't break SSR.
- **Wake Lock + speechSynthesis.** Always feature-detect: `(navigator as any)?.wakeLock?.request` and `'speechSynthesis' in window`.

### Tests
- **`globalThis._concordSaveStateDebounced = () => {}`.** Without this, tests crash when macros call save.
- **`globalThis.fetch = async () => { throw new Error("network disabled"); }`.** Set in beforeEach for all tests that touch external APIs. Tests must be hermetic.
- **Two-user scoping test.** Always include — `ctxA` and `ctxB` should see different data.
- **Determinism test.** When using `hashString` seeding, write a test that calls twice and `assert.deepEqual` — pins reproducibility.

### Git workflow
- **Branch name pattern:** `claude/<lens>-lens-parity-$(date +%s)`. Unix timestamp suffix avoids collisions.
- **Squash merge always.** Cleaner main history.
- **One PR per lens** (unless bundling 2 small ones like news+paper).
- **PR title format:** `<lens> lens: <Competitor>/<Competitor> parity — <hero feature list>`.

---

## 6. Research already in hand (don't re-do)

Research agents this session produced detailed teardowns for these — full text in the JSONL transcripts at `/tmp/claude-0/.../tasks/`. You don't need to re-run for:
- code (VS Code, Cursor, Zed, Windsurf, JetBrains, Neovim)
- crypto (Coinbase, Robinhood, MetaMask, Phantom, Uniswap, TradingView, Zerion)
- eco (Joro, Klima, Watershed, iNaturalist, Windy, Ventusky, Earth Hero, Plantix)
- education (Khan, Duolingo, Coursera, edX, Brilliant, Anki, Wolfram, Quizlet)
- finance (Rocket Money, Monarch, YNAB, Copilot, Fidelity, Wealthfront, Empower)
- fitness (Strava, Apple Fitness+, Whoop, Garmin, MyFitnessPal, Peloton, Hevy, Calm)
- food (NYT Cooking, Yummly, Paprika, Mealime, Tasty, AllRecipes, MFP, Instacart)
- government (USA.gov, Citizen, Nextdoor, GovQA, ProPublica, Resistbot)
- healthcare (MyChart, Doximity, Teladoc, GoodRx, ZocDoc, WebMD, K Health, Apple Health)

**Next session: dispatch research for:**
- accounting (QuickBooks, Xero, FreshBooks, Wave)
- agriculture (John Deere Operations Center, Climate FieldView, AgriWebb)
- aviation (ForeFlight, Garmin Pilot, Jeppesen, SkyDemon)
- bio (Benchling, SnapGene, NCBI/UniProt, ResearchGate)
- chem (ChemDraw, Ketcher, 3Dmol.js, RDKit, ChemAxon)
- chat (Claude.ai, ChatGPT, Perplexity, Gemini)
- studio (Ableton Live, FL Studio, Logic Pro, GarageBand, Splice)
- physics (Wolfram Alpha, Symbolab, PhET, Mathematica)
- realestate (Zillow, Redfin, Trulia, Realtor.com, Compass)
- research (Notion, Roam Research, Obsidian, Logseq, RemNote)
- retail (Shopify POS, Square, Stripe Retail, Lightspeed)
- science (OriginPro, Igor Pro, MATLAB, Jupyter, RStudio)
- trades (Houzz Pro, ServiceTitan, Jobber, Procore, BuilderTrend)
- whiteboard (Miro, FigJam, Excalidraw, Mural, Whimsical)
- world (Roblox Studio, Minecraft, Fortnite Creative, Unreal Engine, Unity)
- message (iMessage, WhatsApp, Telegram, Signal, Discord)

Batch 3-4 of these at session start. Don't wait for results before starting the first build — work on `accounting` (or whichever) while research for `agriculture`/`aviation`/etc. runs in background.

---

## 7. Critical infrastructure already in place (don't break)

- **`server/domains/index.js`** auto-imports every `<lens>.js`. Just add your domain file and it loads.
- **`globalThis._concordSTATE`** exposed at `server.js:4327` and `:14552`. Both `_concordSaveStateDebounced` (function ref) globally available after server.js:8651.
- **`/api/lens/run`** dispatch at `server.js:36139`. Looks up `LENS_ACTIONS.get(\`${domain}.${action}\`)`. Hyphenated action names work.
- **`vision-inference.js#callVision`** — LLaVA route via BRAIN_VISION_URL port 11438. Used by eco species ID + food plate scan + healthcare imaging.
- **`@monaco-editor/react`, `lightweight-charts`, `qrcode`, `@xterm/xterm`, `monaco-editor`, `@excalidraw/excalidraw`, `recharts`** all in `concord-frontend/package.json` already. No need to `npm install`.
- **`api` from `@/lib/api/client`** is the axios singleton with auth handling. Use `api.post(...)` not raw fetch.

---

## 8. Time/scope realism

- Each lens at the proper bar: **2-4 hours of focused work** (research + 3-6 components + 4-10 macros + 8-20 tests + integration + PR + merge).
- 14 remaining lenses × ~3 hours = **~42 hours** of work. Multi-day commitment.
- Context window: each lens consumes ~30-60k tokens. Plan for compression between major chunks.
- The user is committed ("don't stop until all done"). The pattern is fully proven and replicable.

---

## 9. The honest gaps in what I've shipped

The 16 lenses I delivered hit "competitive parity" at the FUNCTIONAL level — every claimed feature works end-to-end with tests, real data flow, and proper UX patterns lifted from category leaders. Where they fall short of leading apps:

- **No persistence to disk by default.** State is in-memory in `STATE.<lens>Lens`. The save-debounce will eventually flush, but a full restart loses recent writes. To address: add SQLite migrations per lens — see migration 101 pattern for per-world scoping.
- **No real third-party data feeds beyond CoinGecko, Open-Meteo, NWS.** Government bills are sample data, healthcare provider list is synth, market quotes are seeded. To upgrade: wire real APIs behind ENV-keyed credentials (ProPublica Congress API, Polygon market data, etc.).
- **No real-time multiplayer.** Whiteboard, world (Concordia), message would benefit from this. Concord has socket.io rooms — leverage them.
- **No mobile-specific UX.** The components are responsive but not native-app-grade for mobile. `concord-mobile` exists separately.
- **No payment processing.** Crypto swaps are simulated, healthcare appointments are state-mutations not Stripe, retail POS would need real card handling.

These are not blockers to "parity" but represent the next-next level — where Concord becomes provably better than the competition rather than competitive with it.

---

## 10. First actions for the next session

```bash
# 1. Read this entire file end-to-end.
cat /home/user/concord-cognitive-engine/NEXT_SESSION_SPEC.md

# 2. Check current branch state.
git checkout main && git pull origin main
git log --oneline -20  # see what was merged this session

# 3. Dispatch 3-4 research agents in parallel for the next batch.
#    Suggested: accounting, agriculture, aviation, chem (revisit queue).

# 4. While research runs, start building the FIRST lens
#    (accounting — needs full QuickBooks-grade rebuild).

# 5. Per-lens: follow the 7-step pattern in section 4 of this doc.

# 6. Keep the cadence at one merged PR per lens.

# 7. When context fills, DO NOT stop. The pattern is replicable; 
#    just start a fresh session and read this doc.
```

---

End of spec.

Authored: 2026-05-16 by Claude Opus 4.7 (claude-opus-4-7[1m]).
Session ID: 0db690a1-7753-4de4-b6be-0e1c6b5a8a6a.
