# AGENTS.md — Lens fleet refactor (Grok)

This file is the execution contract for turning Concord’s 266 lenses into
real, addictive, category-leader apps. Claude maps. Grok executes **one
lens at a time**. Do not start a lens until you have (a) that lens’s
audit findings and (b) a named reference app.

Companion law (read, don’t rewrite):

- `docs/LENS_CONSOLIDATION_PLAYBOOK.md` — de-stack a welded pile into one app
- `docs/UI_QUALITY_RUBRIC.md` — premium bar (density, identity, craft)
- `docs/FRONTEND_REBUILD_PROGRAM.md` — capability map + reference-parity loop
- `docs/PREMIUM_UI_AUDIT.md` — what “polished” currently over-claims
- `CLAUDE.md` — honesty, no fake data, no generic action walls

---

## Mission

Frontend only. The backend (macros, routes, DTUs) already exists. Each
lens must:

1. Act as a **full product** someone would keep open against the real
   category leader (Apple Music, Bloomberg, Linear, Ableton, Epic, …).
   The only honest gap is catalog/data scale, not missing product.
2. Look **unique** to its domain. Shared tokens, not a shared costume.
3. Stay **honest**: every pixel traces to a real macro/route/DTU field.
   Missing substrate stays unrendered with a reason. Never fabricate.

One lens per pass. Take the time. One lens worth using beats five
restyles.

---

## 1. Hardwire the backend (do not invent a second data layer)

A major failure mode of splitting a welded `page.tsx` is losing the
wires. Concord already has the fetch/cache layer. **Use it. Do not
autogenerate a parallel `useEffect` wall.**

| Need | Use this | Do not |
|---|---|---|
| Artifact/list CRUD | `useLensData` (`lib/hooks/use-lens-data.ts`) — already `@tanstack/react-query` | new `useEffect`+`fetch` per tab |
| Domain macros | `lensRun(domain, name, input)` from `lib/api/client` | raw `fetch('/api/lens/run')` copies |
| Live events | `useLensRealtime` | `setInterval` polling |
| Keyboard | `useLensCommand` | undocumented key handlers |
| DTUs | `useLensDTUs` / Workspace Bus (`PipingProvider`, `CitePicker`) | ad-hoc DTU POST |
| Session / draft | `useLensSession`, `useLensDraft`, `useLensStatePersistence` | anonymous `useState` soup at page root |

**Per-view state after a split:**

- Each extracted screen is `components/<lens>/<Name>Panel.tsx`.
- The **panel owns** its query hooks. Data loads when that view mounts
  (react-query `enabled` + tab-gated `active`). Switching tabs feels
  instant because the cache is already warm, not because we refetch in
  a parent `useEffect`.
- Lift to a local React context / zustand slice **only** when two
  sibling panels must share mutating state (selection, inspector
  target, in-flight draft). Name it after the view (`AssistContext`,
  `PersonaContext`, …). Do not wrap the whole lens in a kitchen-sink
  provider.
- **One call site per macro.** Duplicate buttons that hit the same
  macro with divergent loading/error handling are the stacking defect
  (`docs/LENS_CONSOLIDATION_PLAYBOOK.md` §2 step 4).

Preserve every live capability. Grep the old `page.tsx` for
`lensRun(` / `useLensData(` / `/api/lens/run` and confirm each pair
still exists in the new tree. Silent drops are bugs.

---

## 2. Shared tokens, unique identity (not 266 clones)

Pass the design system. Do not guess.

**Universal primitives (inject these, never one-off px):**

- Tokens: `lib/design-system.ts` (`ds.panel`, `ds.btnPrimary`,
  `TYPE_SCALE`, `SPACING_SCALE`, `DENSITY_TOKENS`, `STATUS_TOKENS`)
- Components: `components/ui/{DataTable,StatTile,Skeleton,EmptyState,ErrorState,StatusDot,DensityToggle}`
- Identity CSS vars: `useLensIdentity(domain)` → `--lens-accent`,
  `--lens-secondary`, `--lens-gradient` from `lib/lens-identities.ts`
- Motion: `framer-motion` is already a dependency. Use it for **view
  switches and state changes** (tab → panel, overlay open, optimistic
  settle). Not decorative hover chrome. Honor `prefers-reduced-motion`.
- Density: `useDensity()` on data-heavy lenses.

**Unique per lens (non-negotiable):**

- Name **one** reference app and steal its visual/interaction language
  (Bloomberg ≠ Ableton ≠ Linear ≠ Epic). See rubric §0.
- Design grayscale first; color last, and only from tokens + that
  lens’s identity accents.
- Trim whitespace; don’t pad a 3-card page into a “dashboard.”
- Zero generic tendencies: no ManifestActionBar / AutoActionStrip /
  UniversalActions / LensFeaturePanel as the body of a rebuilt lens.
- Figma (when MCP is authed): design the lens in Figma against the
  reference app, then implement from that file. Until OAuth lands,
  the token file + named reference is the source of truth.

Shared padding/type/radius. Different information architecture,
chrome, density, and emotion.

---

## 3. Verify like a user, then ratchet

Do not claim a lens done off typecheck.

**Functional**

- `concord-frontend`: `npm run type-check` and `npm run lint` clean
  for the files you touched.
- Lens behavior test + capability-map parity still hold.
- `node scripts/detect-lens-stacking.mjs` — this lens’s
  `stackingScore` drops (target **< 7**, `viewStateMachines` → 1,
  or 0 for canvas/world). Score must never *rise*.

**Browser (mandatory for UI work)**

- Exercise the rebuilt lens end-to-end the way a user would: every
  surviving tab/view, a real mutating action, empty/error/loading.
- Desktop and a mobile viewport.
- Hunt regressions on any sibling surface that reads the same state.
- A screenshot of the happy path is not verification.

**Honesty**

- No `MOCK_*` / fabricated stats / `Math.random()` in render.
- Optimistic UI must reconcile or visibly revert.

---

## Per-lens loop (strict order)

1. **Inventory** — stacking report row + git log on `page.tsx` +
   capability map + every screen/macro/dead view.
2. **One IA** — one reference app, one nav primitive, one `active`
   union (or one canvas + command palette).
3. **Extract** — screens → `components/<lens>/<Name>Panel.tsx`;
   page becomes a thin shell (~150–300 LOC).
4. **Wire** — panel-owned hooks from the table in §1; one call site
   per macro; context only for shared mutating selection.
5. **Delete + merge** — dead views gone; duplicate action paths gone.
6. **Feel** — unique identity, density, 3–5 real micro-interactions,
   framer-motion view transitions. Only after it is one app.
7. **Verify** — §3. Then stop. Next lens is a new pass.

`world` is last and is a game client, not a tab app — see the
playbook. Do not “tab-bar” Concordia.

---

## Queue

Wait for Claude’s fleet audit if it is in flight. When it lands, its
ranking wins.

Until then the mechanical ranking is `audit/lens-stacking-report.md`
(moderate 7–12 first, heavy ≥12 after 2–3 moderates, `chat` after
those, `world` last).

Never `git add -A`. Stage named files for this lens only.
Never batch lenses. Never edit graders/baselines without a
bidirectional pinning test and owner OK.
