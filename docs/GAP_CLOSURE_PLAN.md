# Gap-Closure Plan — four tracks (audit-verified 2026-05-31)

Each track was checked against the working tree before planning (trust the code
over docs). Status legend: 🟢 headless-buildable + verifiable here · 🟡 partly
headless (data/scaffold yes, feel/visual verification blocked by the chromium
network policy) · ✅ already done.

---

## Track 4 — T-series polish bugs → ✅ ALREADY CLOSED (verify-only)

All four were fixed in the "Depth & Balance continuation" sprint; the code
confirms it. **Nothing to re-fix** — the remaining work is a regression test per
fix so they can't silently regress.

| Bug | Fix in code (verified) |
|---|---|
| T0.1 code-puzzle operand shape | `server/lib/programming-puzzle.js#_normalizeInstr` (`:86`) maps editor `{op,a,b}` → VM `{dst,src,to}`, keeps explicit canonical fields. Editor still ships `{op,a,b}` (`CodePuzzleEditor.tsx:60`) — adapter handles it. |
| T0.2 SFX id mismatch | `SoundscapeEngine.tsx` `SFX_ALIASES` + `resolveSfxId` (`:203`) map underscored `ui_*` ids onto the hyphenated synth voices. |
| T1.2 trivia unplayable | `server/lib/trivia.js#getAnswerChoices` (`:140`) builds the multiple-choice set; attached in `list` (`:127`). |
| T1.5 hacking memory-test | `server/lib/hacking.js#hintForStep`/`getHint`/`nextHint` (`:19`,`:124`) guided trail. |

**Action:** add `tests/polish-regression.test.js` pinning `_normalizeInstr`,
`getAnswerChoices`, `hintForStep` (pure, headless). Frontend SFX alias map gets a
vitest assertion. ~1 commit. 🟢

---

## Track 3 — Cleanup: orphaned lenses + dead-wired modules → 🟢 (highest headless value)

**Orphaned lenses — REAL, precisely measured.** `node scripts/audit/gates/
lens-reachability.mjs` (gate merged in `91c8eb74`): **258 lens dirs, 211
registered, 50 violations** — lens directories with a real `page.tsx` but **no
`lens-registry.ts` entry**, so they're unreachable from the Ctrl+K palette /
sidebar. The gate ratchets at `FLOOR=50` today; driving it to 0 is the finishable
proof-of-progress.

The 50 (minus the `[parent]` scan artifact → 49 real): forge, foundry, kingdoms,
lattice, social, society, tournaments, markets, staking, sponsorship, sandbox,
sub-worlds, world-creator, worldmodel, deities, goddess, dreams, meditation,
wellness, cognition, cognitive-replay, observe, ops, crisis-ops, sentinel,
psyops, ghost-tracker, expedition-journal, event-timeline, forecast, inheritance,
death-insurance, bounties, byo-keys, classroom, code-quality, dx-platform,
expert-mode, gallery, maker, mesh, personas, productivity, saved, self,
sessions, sync, system, tools.

Every one has a `page.tsx` (verified forge/foundry/kingdoms/social/tournaments/
markets). The registry entry shape (`lens-registry.ts:153`) is
`{ id, title, icon, description, category, sidebar:boolean, palette:boolean, href }`.

**Approach (one PR, ratchet to 0):**
1. Triage each of the 49 into one of three buckets:
   - **Wire into registry** — standalone lens with its own page (most: forge,
     foundry, kingdoms, lattice, tournaments, markets, …). Add a registry entry
     with the right `category` + icon.
   - **Absorb as sub-tab** — small/related surfaces folded into a parent lens
     (e.g. `byo-keys`/`sessions`/`saved` → a settings/account lens; `goddess`/
     `deities` → one) and listed as `intentionalExceptions`.
   - **Intentional exception** — nav-only/utility dirs (join `ux-suite`,
     `reasoning`), documented in the gate's exception list.
2. Drop `FLOOR` to the new violation count after each batch; target `--floor=0`.
3. `npm run validate-routes` + `npm run score-lenses` stay green.

Verifiable headlessly: the gate runs in frontend-installed jobs and via the
committed JSON; each batch lowers `violationCount`. Pure mechanical + judgment,
no runtime needed.

**Dead-wired modules — smaller than the doc claims.** The
`CombatMotorBridge.tsx`/`ReflexBridge.tsx` files CLAUDE.md flags as dead **no
longer exist** (already removed). Remaining: `lib/concordia/reflex-layer.ts` is
referenced only by itself + `combat-motor-driver.ts` (dead); `combat-motor-
driver.ts` is referenced by `impact-resolver.ts` + a live test. **Action:**
confirm `impact-resolver.ts`'s motor path is actually on the render path; if yes,
keep `combat-motor-driver`, delete the orphaned `reflex-layer.ts`; if no, delete
both. One commit, type-check + the existing impact tests gate it. 🟢

---

## Track 1 — First-10-minutes feel (the weak axis) → 🟡

**Built surface (verified):** `FirstWinWizard.tsx`, `OnboardingTutorial.tsx`,
`content/quests/onboarding.json` (cook→eat→fight→commune), the `/api/guidance/
first-win` + `/api/onboarding/*` + `/api/tutorial/first-cycle` routes, and the
Tier-3 `first-cycle-journey.test.js`. The machinery exists; the **feel** (≤3-min
hook, minute-one aliveness) is the weak axis — a sequencing/tuning problem, not a
build-from-scratch.

**Headless-buildable (do these):**
- **L1.4** — the `first_cycle_forge` onboarding step routing `FirstWinWizard` →
  the Forge tab (the user's listed item). Content + route wire + a structural test.
- Pacing pass on `onboarding.json` so the first *player action* lands inside 3
  minutes (reorder steps, trim gates), pinned by extending `first-cycle-journey`.
- FTUE telemetry hooks (event emits at each step) so FTUE3's funnel can be
  measured — server-side, testable.

**Blocked here (runtime):** FTUE1/FTUE4 *feel* tuning and the first-10-minutes
Playwright gate need a real browser (chromium install fails under the network
policy). Ship the content/route/telemetry now; queue the feel pass for a
browser-enabled run.

---

## Track 2 — Visual coherence (the one bounded authored-art cost) → 🟡

**The bounded cost:** ART Layer-1 — an authored human-character art basis that
gates the genome-morph. That single asset is genuinely external art; everything
around it is data + harness that *is* headless-buildable.

**Headless-buildable (do these):**
- **Atmosphere profiles as data** — per-world `{ skyTint, fogColor, sunDisk,
  colourKey, ambientDb }` (extends the existing `concordia-theme.ts`
  `sunDiskForWorld`/`buildingStyleForWorld`). Pure data + a loader; unit-testable.
- **Colour-key contract** — each world declares its palette; a static gate
  asserts every world has a complete profile (sibling of the lens-reachability
  gate). Headless.
- **Screenshot-diff harness scaffold** — the spec + fixtures + the runner config,
  so it executes in a browser-installed job (the actual diff run is blocked here).

**Blocked here (art + runtime):** the authored character basis (external art
cost) and the per-world screenshot-diff verification (chromium). Land the
profile data + colour-key gate + harness scaffold now; the art asset + visual
diff are the explicitly-bounded external follow-on.

---

## Recommended order
1. **Track 4 verify** (1 commit) — cheap, locks the already-won T-fixes.
2. **Track 3 orphaned lenses** (batched, ratchet 50→0) — highest headless value,
   directly finishable, gate-measured.
3. **Track 3 dead-wire cleanup** (1 commit).
4. **Track 1 headless slice** (L1.4 + pacing + telemetry).
5. **Track 2 headless slice** (atmosphere profiles + colour-key gate + harness).

Tracks 1–2's *feel/visual* tails and the runtime Playwright gates stay queued for
a browser-enabled environment — flagged, not forgotten.
