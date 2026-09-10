# Lens consolidation playbook

**The problem, stated plainly (owner, 2026-09-08):** "every Claude session adds
on to lenses and never removes or fixes, so it's literally piles of UIs per lens
on top of each other instead of one coherent app each."

The evidence is concrete. `concord-frontend/app/lenses/chat/page.tsx`:
**101 commits by "Claude"** (5 by Dutch, 5 by Concord_Founder), 4,951 lines,
46 feature-component imports, 3 inline component definitions, **15 `return (`
blocks**, a 5-value `chatMode` view union. Each session added a screen; none
merged or deleted one. `grade-ux-polish.mjs` scores it **"polished"** — because
that grader checks loading/empty/error states and micro-interactions, and is
blind to *architectural* incoherence.

`scripts/detect-lens-stacking.mjs` measures the incoherence directly. Run it,
read `audit/lens-stacking-report.md`.


> **2026-09-09 refresh:** Grok/Dutch pass landed thin-shell consolidations for many
> moderate lenses (`marketplace`, `wallet`, `aviation`, `collab`, `sim`, `whiteboard`,
> `billing`, `calendar`, `creator`, `meta`, …) plus chrome de-dup across ~200 pages.
> Re-run `node scripts/detect-lens-stacking.mjs` and prefer the live heavy/moderate
> lists over the historical names in §3 when picking the next lens.

---

## 1. The two shapes

### Welded pile (bad) — `chat`, `world`, `healthcare`, `trades`, `studio`, `education`

- Thousands of LOC of screen logic **inline** in `page.tsx`.
- **2+ independent view-state machines** gating different regions
  (`chatMode` + a `sortMode` + a `showX` modal boolean + a `tab`), added by
  different sessions, none aware of the others.
- Heterogeneous render strategies coexisting: a tab-union switch AND top-level
  `{cond && <Screen/>}` AND a stack of `show<X>`/`is<X>Open` modal booleans.
- Duplicate action paths — the same macro reached from a button in screen A and
  a different button in screen C, with divergent loading/error handling.
- Dead view values — a union member (`chatMode: 'connect'`) that no control
  flow ever sets, so a whole screen is unreachable but still compiled and
  maintained.

### One coherent app (good) — `retail` (191 LOC), and what every lens should become

- `page.tsx` is a **thin shell**: `LensShell` + one navigation primitive + a
  screen router. ~150–300 LOC.
- **One** view-state machine — a single `active` union — driving a data-defined
  tab bar (`TABS.map(t => …)`), `setActive(t.id)`.
- Every screen is its own `components/<lens>/<Screen>Panel.tsx`, imported and
  rendered by the router. 17 tabs → 17 panel files, page stays thin.
- Every macro has exactly one call site (usually a hook the relevant panel
  owns).
- No modal-boolean soup — modals go through the shared `usePanelStack` / a
  single `overlay` state.

`retail` scores **low on every stacking signal while importing 17 feature
panels** — delegation is not stacking. Aim there.

---

## 2. The per-lens procedure

Do this for **one lens per pass**. It is a careful merge, not a rewrite — every
capability the old page reached must still be reachable.

### Step 0 — inventory (read-only, ~30 min)
1. `git log --format='%an %ad %s' --follow -- app/lenses/<lens>/page.tsx` — see
   how many sessions piled on and what each added.
2. List every screen: each `return (`, each `{x && <Screen/>}`, each modal.
   For each: what triggers it, what macro(s) it calls, is it reachable.
3. Cross-check the lens's **capability map** (`docs/lens-specs/<lens>-capability-map.md`)
   and its behavior test (`server/tests/behavior/…` / the lens's own test) —
   that is the contract the consolidation must preserve.
4. Note the dead branches (from the report's `dead-view` column + your read).

### Step 1 — decide the ONE information architecture
Per `docs/UI_QUALITY_RUBRIC.md` §3, name the single reference this lens is:
terminal / IDE / DAW / research-tool / Bloomberg-style dashboard / inbox /
canvas. **One.** The welded pile usually happened because session 3 built a
"dashboard", session 40 bolted on a "workspace", session 88 added a "chat mode".
Pick the one that matches the lens's actual job and the capability map's
reference app.

### Step 2 — one navigation primitive
- Most lenses: a single `active` string union + a data-defined tab/segment bar.
- A few (code, whiteboard, world): a spatial/canvas shell with a command
  palette (`useLensCommand`) as the nav — still ONE.
- Kill the competing machines: fold `sortMode`/`viewMode`/secondary tabs into
  either the `active` union or into the panel that owns them.

### Step 3 — extract screens to panels
For each surviving screen, move its JSX + its local state + its data hook into
`components/<lens>/<Name>Panel.tsx`. The panel owns its own loading/empty/error
(reuse `<LoadingTransitions>` / `<EmptyStateCTA>` / `<ErrorState>` — the same
components `grade-ux-polish` already recognizes). `page.tsx` just renders
`<Router active={active} />`.

### Step 4 — delete + merge
- Delete every dead branch identified in Step 0. If a capability behind a dead
  branch is real and wanted, wire it into a live tab — don't resurrect the dead
  screen.
- Merge duplicate action paths: one hook per macro, called by the one panel
  that needs it. If two panels need the same data, lift the hook to the router
  or use the shared query cache.

### Step 5 — verify (do not skip)
- `npm run type-check` in `concord-frontend/` — clean.
- `npm run lint` — clean.
- Grep the old `page.tsx` (from git) for every `lensRun(`/`useLensData(`/
  `'/api/lens/run'` literal pair; confirm each still appears somewhere in the
  new lens tree. **No macro may be dropped silently.**
- Run the lens's behavior test + any `docs/lens-specs` parity check.
- `node scripts/detect-lens-stacking.mjs` — the lens's `stackingScore` must
  drop below 7, and `viewStateMachines` to 1 (or 0 for canvas lenses).
- Manual: click through every tab, confirm loading/empty/error each render.

### Step 6 — THEN invest in domain feel (separate pass)
Only once the lens is one coherent app: apply `docs/UI_QUALITY_RUBRIC.md` §0-2
and the premium-design technique — the domain-specific interaction language
(a real Bloomberg terminal, an Ableton timeline, a generative stress-map
cascade). Doing depth-of-feel and de-stacking in the same pass is how the pile
got here; keep them separate.

---

## 3. Order of work

`audit/lens-stacking-report.md` ranks all 266. Suggested order:

1. **Moderate tier first (score 7–12, 21 lenses)** — `creator`, `marketplace`,
   `admin`, `wallet`, `aviation`, `government`, `environment`, `crafting`,
   `agents`, `reasoning`, `calendar`, `graph`, … . These are 1.5–3k LOC with
   2 machines — a clean 2–4h consolidation each, and each one teaches the
   pattern for the harder ones.
2. **Heavy tier (score ≥ 12, 13 lenses)** — `chat`, `healthcare`, `trades`,
   `studio`, `education`, `fitness`, `crypto`, `council`, `game`, `music`,
   `code`, `agriculture`. Each is a real day. `chat` is the flagship — do it
   after 2–3 moderate ones.
3. **`world` last, with its own plan.** 7,625 LOC, 3 machines, and it is the
   *canonical gameplay surface* (CLAUDE.md: "every gameplay feature must be
   reachable from inside `/lenses/world`"). It is not one app — it is a game
   client. Its consolidation is a scoped project: separate the HUD shell from
   the ~20 feature overlays (each overlay → `components/world/<X>Overlay.tsx`,
   mounted by one `WorldOverlayRouter` keyed off the DA1/DA2 interaction
   events), and keep the canonical-surface invariant intact.

---

## 4. Guardrails

- **One lens per branch/PR.** A consolidation touches one `page.tsx` + a handful
  of new `components/<lens>/` files. Never batch.
- **Never `git add -A`** — a shared worktree may hold another actor's edits.
- **The detector is the ratchet.** After the first few consolidations, wire
  `node scripts/detect-lens-stacking.mjs` into a check that fails if any lens's
  `stackingScore` *increases* vs a committed `audit/lens-stacking-baseline.json`
  — so the next 101 sessions can't re-pile.
- **Honest-by-construction still holds.** A dead screen sometimes hides a real,
  wanted capability that was half-built and abandoned. Don't just delete the UI
  — check the capability map, and either wire the capability into a live tab or
  record it in the map's "genuinely missing / deferred" section with a reason.
- This is not a mandate to delete features. It is a mandate to make each lens
  *one* app instead of five. Every real capability survives; it just gets a
  coherent home.
