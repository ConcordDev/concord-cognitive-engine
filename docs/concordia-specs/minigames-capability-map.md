# Minigames & Interactive Stations — Capability Map (2026-07-11)

Re-verification + fix pass against `docs/POLISH_AUDIT.md`'s "Minigame depth
ranking" section, for the minigame-depth slice of the 7-part parallel audit.
Every claim below was checked against the working tree at commit `8ad21e64`
(one unrelated pre-existing uncommitted edit to `server/lib/kingdom-decrees.js`
+ its test are present from a different unit's work and were left untouched).
Counts are from real `grep`/`python3 -c "json.load(...)"` runs against the
content files, not from doc prose.

---

## Summary table — the 4 assigned residuals

| # | Item | Status |
|---|---|---|
| 1 | Hidden-object: no juice/SFX, no found-markers | **confirmed-open → fixed** |
| 2 | Farming: `watered_at` written, never read | **confirmed-open → fixed** |
| 3 | Mahjong legacy `/api/mahjong/resolve` route | **confirmed still live** — left untouched (sibling audit's item) |
| 4 | Restaurant: missing miss-feedback + tip popup | **confirmed-open → fixed** |

---

## 1. Hidden-object — no juice/SFX, no found-markers

**Status: confirmed, then fixed.**

`concord-frontend/components/world/HiddenObjectScenePanel.tsx` had zero
import from `lib/concordia/juice`, and a confirmed find only updated a
`{found}/{total}` counter and a one-line text result — no persistent visual
record of *where* a found object was, and no sound of any kind (compare
every other station overlay, all of which import `successJuice`/
`failureJuice`/`milestoneJuice` per the Phase Z7 pattern documented in
CLAUDE.md).

**Fix (this pass):**
- `discoveryJuice()` on a normal find, `milestoneJuice()` on the completing
  find, `failureJuice()` on a miss — the same three-way split every other
  minigame in the codebase uses (`TriviaKioskPanel.tsx`, `CodePuzzleEditor.tsx`).
- A persistent `<MapPin>` marker rendered at the exact normalized click
  position (`data-testid="hidden-object-found-marker"`) for every confirmed
  find, so the player sees what they've already cleared instead of only a
  counter.
- New test `concord-frontend/tests/hidden-object-scene-panel-wired.test.tsx`
  (3/3 passing) renders the real component, mocks the two endpoints it
  actually calls, and asserts: a found click renders a marker at the click
  coordinate + fires `discovery` juice/SFX; the completing click fires
  `milestone` instead; a miss fires `failure` and adds no marker.

No new SFX id was needed — `discoveryJuice`/`failureJuice`/`milestoneJuice`'s
defaults (`ui_discovery`/`ui_failure`/`ui_milestone`) were already aliased in
`SoundscapeEngine.tsx`'s `SFX_ALIASES` table.

Files: `concord-frontend/components/world/HiddenObjectScenePanel.tsx`,
`concord-frontend/tests/hidden-object-scene-panel-wired.test.tsx`.

---

## 2. Farming — `watered_at` written and never read

**Status: confirmed, then fixed (a real ENGINEERING gap, not data-sourcing).**

Verified before the fix: `plantSeed` (`server/lib/farming.js:63-68`, old)
stamped `watered_at = unixepoch()` unconditionally on every plant — i.e. it
was **always** "watered" from the moment of planting, which isn't a real
watering action at all, just a dead column write. `advanceGrowth`
(`:80-115`, old) computed `elapsedDays` purely from
`planted_season_idx`/`planted_day` vs. `currentSeasonIdx`/`currentDay` and
never referenced `watered_at` anywhere in the stage-advance math. There was
also no player-facing "water" HTTP route or UI affordance anywhere in
`FarmTileEditor.tsx` — the only other writer was `npc-labor-world.js`'s
`performFarming` (NPC labor tending a field), which sets `watered_at` as a
side-effect of directly incrementing `growth_stage` by hand, bypassing
`advanceGrowth` entirely. So the column was both **meaningless** (always set
at plant time, for every crop, regardless of any action) and **unused**
(nothing downstream branched on it) — matching the doc's "watering is dead
functionality" finding exactly, and worse than described: even the always-on
stamp wasn't really "watering."

**Fix (this pass) — `server/lib/farming.js`:**
- `plantSeed` no longer auto-stamps `watered_at` (removed from the INSERT) —
  a fresh crop starts unwatered (`NULL`), matching reality.
- New `waterCrop(db, userId, { claimId, tileX, tileY, isOwner })`: a real,
  owner-gated player action. Rejects a non-owner, a nonexistent tile, or an
  already-ripe crop; otherwise stamps `watered_at = unixepoch()`.
- `advanceGrowth(db, currentSeasonIdx, currentDay, nowUnix = Date.now()/1000)`
  now reads `watered_at`: a crop watered within `WATER_RECENCY_S` (env
  `CONCORD_WATER_RECENCY_S`, default 48h) of the tick gets
  `+WATER_BONUS_DAYS` (env `CONCORD_WATER_BONUS_DAYS`, default 1) added to
  its effective elapsed days before the stage-advance floor-division. An
  unwatered or stale-watered crop is unaffected — the base growth rate is
  byte-identical to before, so watering is a genuine bonus, not a
  requirement (a plot with no player attention still ripens on schedule).
- New routes `POST /api/farming/water` and
  `POST /api/farming/building/:buildingId/water` (`server/server.js`),
  mirroring the existing plant/harvest route pairs' owner-gate pattern.
- `listCropsOnClaim` now selects `watered_at` so the frontend can render it.
- `FarmTileEditor.tsx`: clicking a growing (non-empty, non-ripe) tile now
  waters it (previously did nothing); a `<Droplets>` glyph renders on a
  tile watered within the recency window; `successJuice('ui_water')` /
  `failureJuice()` on the result. New `ui_water → 'footstep-water'` SFX
  alias added to `SoundscapeEngine.tsx` (the id would otherwise have fallen
  through the heuristic table to silence — none of the suffix patterns
  `_fail|_pass|_open|...` match `ui_water`).

**Test proof (not just plumbing):** new cases in `server/tests/farming.test.js`
(11 → 15 assertions, all passing, including the pre-existing pinned
"advanceGrowth advances stage during planted season" case **unchanged** —
the fix is additive by construction since an un-watered crop never has
`last_watered` set):
- `waterCrop` rejects non-owner / missing-tile / already-ripe.
- Two identical wheat plots planted on the same day; only one is watered;
  one `advanceGrowth` tick later the watered plot is at `growth_stage=2`
  and the unwatered one is at `growth_stage=1` — a real, measured
  difference, not just "the write succeeded."
- The bonus expires outside `WATER_RECENCY_S` — a stale watering behaves
  identically to no watering.

Files: `server/lib/farming.js`, `server/server.js`,
`concord-frontend/components/world/FarmTileEditor.tsx`,
`concord-frontend/components/world-lens/SoundscapeEngine.tsx`,
`server/tests/farming.test.js`.

---

## 3. Mahjong legacy checkbox route

**Status: confirmed still live — intentionally left untouched (assigned to
the sibling combat-feel-residuals audit running in parallel).**

`server/server.js:51539` still registers
`app.post("/api/mahjong/resolve", ...)` calling
`resolveMahjongHand()` from `server/lib/minigame-resolvers.js:140` — a
player-supplied yaku-list summed against `MAHJONG_HAND_VALUES` with **no
verification against an actual hand**. The real tile engine
(`server/lib/mahjong/session.js` + `/api/mahjong/start|discard|tsumo|state`)
is what `MahjongTable.tsx` actually calls; the legacy route has no UI caller
in the current codebase (confirmed: `grep -r "mahjong/resolve"
concord-frontend/` returns nothing) but remains reachable by anyone who
knows the endpoint, which is a request-forgery-style checkbox-win surface
sitting next to a real economy (`rewardCc`/coin payouts). Leaving as-is per
instruction — do not modify `minigame-resolvers.js` or
`/api/mahjong/resolve` in this unit.

---

## 4. Restaurant — missing miss-feedback + tip-amount popup

**Status: confirmed, then fixed.**

Verified before the fix, `RestaurantDashboard.tsx#serve()`:
`if (j?.ok !== false) { ...success juice... }` — the `else` branch (an
`ok:false` response, e.g. `lib/restaurant.js#serveOrder`'s `expired` /
`order_${status}` / `not_owner` error cases) did **nothing**: no juice, no
message, silent failure. And the success branch only checked `j.combo` for
the rush-combo flash; the real per-order `payment`/`tip` numbers
`serveOrder` returns (`server/lib/restaurant.js:151`,
`{ ok, payment, tip, total, tipFrac, combo, comboMult }`) were computed
server-side and then discarded — the UI only ever showed the aggregate
`summary.tips_cc` running total, never what a specific serve earned.

**Fix (this pass) — `RestaurantDashboard.tsx`:**
- `serve()`'s failure branch now calls `failureJuice()` and shows a
  `data-testid="restaurant-miss-message"` toast, mapped through a small
  `MISS_REASON_LABEL` table (`expired → "order expired — too slow"`,
  `not_owner`, `no_order`, etc.) so a race against the server-side expiry
  sweep is visible instead of a silent no-op.
- The success branch now shows a transient
  `data-testid="restaurant-tip-popup"` (`+{payment} cc (+{tip} tip)`, or
  `"no tip — too slow"` when `tip === 0`) using the real numbers the server
  already returns — no new backend surface needed.
- New test `concord-frontend/tests/restaurant-dashboard-tip-miss-feedback.test.tsx`
  (2/2 passing): renders the real component, mocks `/api/restaurant/*`, and
  asserts the popup shows the mocked `payment`/`tip` values and the miss
  message renders on an `ok:false` response.

Files: `concord-frontend/components/world/RestaurantDashboard.tsx`,
`concord-frontend/tests/restaurant-dashboard-tip-miss-feedback.test.tsx`.

---

## Depth pass — each minigame vs. its real genre leader

### Mahjong — vs. a real riichi/American mahjong app

**Verdict: genuinely the deepest minigame; doc's own caveat still holds.**

`server/lib/mahjong/session.js` (299 LOC) deals a real seeded 136-tile wall
(`wall.js`, 87 LOC), tracks 4 seats, and runs 3 NPC discard AIs
(`npc-discard.js`, 92 LOC). `yaku-detect.js` (121 LOC) does genuine 14-tile
decomposition and detects **9 real yaku**: tanyao, toitoi, pinfu, yakuhai
(round/seat wind + dragons), iipeiko, sanshoku, ittsuu, chinitsu, honitsu —
verified by grep against the file, matching CLAUDE.md's count.

The doc's self-documented gap is **still accurate, verified in code**:
`session.js`'s own header comment states "No calls (chi/pon/kan) — strict
draw/discard rounds; No riichi declaration; No ron on discard (only tsumo on
draw); Player wins only by tsumo." A real riichi app (Tenhou/Mahjong Soul)
or American mahjong app (Gung Ho!) centers on exactly the mechanics this
build omits — calling other players' discards (chi/pon/kan) is the
defining social-tactical layer of the genre, and ron (winning off a
discard, not just self-draw) roughly doubles the win-rate of a realistic
session. This build is a legitimate, richly-scored solitaire-shaped subset
of mahjong, not full riichi.

**Triage:** ENGINEERING. No external data dependency — chi/pon/kan and ron
are pure game-logic additions to the existing session state machine
(track other seats' discard piles as callable, add a call-window between
discard and next-draw). Sizable (~a full sprint), not small/safe — correctly
out of scope for this pass.

### Karaoke — vs. SingStar / real pitch-scoring apps

**Verdict: confirmed real Web Audio pitch detection; confirmed the doc's
scoring-bug caveat; assessed the fix as primarily ENGINEERING, with an
unlock already sitting in unused content metadata.**

`KaraokeMicrophone.tsx` does real autocorrelation pitch detection
(`detectPitch` over a 2048-sample buffer via `getUserMedia`) — not faked.
But `pitchAccuracyHz` (`:123`, `Math.min(50, Math.sqrt(variance))`) is the
**standard deviation of the singer's own pitch samples** — a flatness/
consistency measure, not a distance-from-melody measure. Verified: every
lyric file in `content/karaoke-lyrics/*.json` (checked `lattice-lullaby.json`
and the directory listing, 25 files matching `content/karaoke-songs.json`'s
25-song catalog) contains only `{ at_ms, line }` — timed lyric text, no
target pitch/note contour at all. So a singer who holds a single wrong note
perfectly steady scores as "accurate," and a singer who nails the real
melody but with natural vibrato scores worse. This is a real, reproducible
scoring bug, exactly as the doc describes.

**Triage:** primarily **ENGINEERING**, not CURATION, with a notable existing
hook: every song in `content/karaoke-songs.json` already carries a `key`
field (e.g. `"C minor"`) that is currently unused by the scoring path. A
deterministic per-line target-scale-degree generator (seeded from
`songId + lineIndex`, quantized to the song's declared key/scale) would let
the resolver score "singing in key across the song's declared scale" without
requiring anyone to hand-author true melody data for 25 original, fictional,
in-universe songs (there is no free/licensed external melody to
data-source — these aren't real songs). A higher-fidelity version (true
authored melody per line) would additionally require a CURATION pass
authoring pitch contours into all 25 `karaoke-lyrics/*.json` files, but the
`key`-based in-scale check is the honest, buildable first step and doesn't
block on new authored content.

### Hacking — vs. Hacknet / Uplink

**Verdict: T1.5's fix genuinely un-shallows the interaction, but a new,
more subtle shallowness was found: the hint can over-reveal.**

`server/lib/hacking.js#hintForStep` (`:19-34`) is real and wired: on a wrong
command it resets progress **and** returns a `nextHint` describing the
*intent* of the correct next step (`"A path looks worth exploring:
\"home\""`, `"A reference points to a host: \"guest_node\". Try reaching
it."`) rather than the literal command; `getHint` (`:124-140`) exposes the
current-step hint on demand via a route, and `HackingTerminal.tsx` renders
it as a "» lead:" UI line. This genuinely fixes the doc's T1.5 finding
(exploring no longer gives zero guidance) and is pinned by
`server/tests/hacking-hints.test.js`.

**New finding (not in the doc):** `hintForStep`'s templates interpolate the
step's literal **argument** verbatim (`arg` = the exact host name / path /
filename the next command needs), not just the verb's intent. Since
`getHint` is available from the very first step with no cost or attempt
requirement, a player can solve any puzzle end-to-end by repeatedly calling
`getHint` and retyping its revealed argument — never once running `ls`/`cat`
against the authored `terminalTree` content (verified: `attemptCommand`
(`:57-117`) only checks `expected === cmd` against `solution_path_json`; it
has no path that checks whether the player actually issued the `ls`/`cat`
commands that would organically reveal that argument). The 30-puzzle
`terminal_tree` content (`content/hacking-puzzles.json`, verified count) is
real and well-authored (e.g. `intro-grep-the-system`'s tree has a
`readme.txt` with in-fiction hint text) but is now **optional flavor**, not
load-bearing — the opposite failure mode from T1.5's original bug (no
guidance) is now "guidance that makes exploration unnecessary." A genuine
Hacknet/Uplink feel requires the next lead to be *discoverable only by*
issuing `cat`/`ls` against the tree, with `getHint` as a cost-gated
fallback (e.g. a cooldown or CC cost), not a free zero-cost oracle.

**Triage:** ENGINEERING. Gate `getHint`/the auto-`nextHint` behind either an
attempt-count threshold (e.g. only surface the full-string hint after 2
wrong attempts, until then only the generic verb-level nudge) or a small CC
cost, so following the fiction (read the file, learn the host) is still the
fastest path. Not done in this pass — a design/tuning call, not a small safe
fix.

### Trivia — vs. Kahoot / Jackbox

**Verdict: multiple-choice fix confirmed solid; question-bank depth is a
real, small gap.**

`server/lib/trivia.js#getAnswerChoices` (verified present) and
`TriviaKioskPanel.tsx`'s clickable-choice UI are real — T1.2's fix holds,
matching the doc.

Bank size, verified by `python3 -c json.load` against
`content/trivia-questions.json`: **exactly 30 questions**, 45 unique tags
(mostly 1-2 uses each; top tags `combat` ×5, `ui` ×4, `npc` ×3), difficulty
distribution skewed toward 2-4 (`{1: 3, 2: 7, 3: 10, 4: 9, 5: 1}`). All 30
questions are Concordia-lore-flavored (e.g. "Which goddess governs the
warm/cold dialogue phases tied to a player's ecosystem score?") — genuinely
authored in-universe content, not generic trivia. For a "real repeatable
activity" genre leader (Kahoot decks commonly run 10-30 questions **per
single round**, with hundreds of distinct decks; Jackbox trivia packs ship
hundreds of prompts), 30 total questions means a single 10-question kiosk
session already exhausts a third of the entire bank, and any player who
visits the kiosk more than 2-3 times will see exact repeats. This is a real,
noticeable staleness gap for anyone treating trivia as a repeatable minigame
rather than a one-time flavor moment.

**Triage:** CURATION. Not DATA-SOURCING (a generic trivia API would break
the in-universe-lore framing that makes these questions belong to
Concordia specifically) and not ENGINEERING (the multiple-choice mechanism
is already correct) — this needs the existing offline authoring pipeline
(`scripts/author/`, the same one that grew crops 5→18 and hacking 10→30 per
the census) run again against the trivia bank, ideally targeting broader
tag coverage (today's 45 tags are mostly singletons) rather than just raw
count.

### Code puzzles — vs. Zachtronics (TIS-100 / Shenzhen I/O)

**Verdict: T0.1's fix confirmed solid (verified again against
`_normalizeInstr`); puzzle-count claim confirmed at 20; genre-gap is
mechanical variety, not count.**

`server/lib/programming-puzzle.js#_normalizeInstr` still maps the editor's
`{op,a,b}` onto the VM's canonical `{dst,src,to}` fields per op — re-verified
present and unchanged from the T0.1 fix description. `content/code-puzzles.json`
has exactly **20 puzzles** (verified via `python3 -c json.load`), with a real,
if modest, difficulty curve by `optimalCycles` (3 → 30) and `optimalSize`
(2 → 8 instructions) — e.g. `echo-r0` (optCycles 3) through `sum-to-n`
(optCycles 24, optSize 7).

The VM itself (`programming-puzzle.js`) supports 7 opcodes: `MOV, ADD, SUB,
JEZ, JNZ, JMP, OUT` — a single-thread, single-register-class assembly model.
Every one of the 20 puzzles is an arithmetic/loop variant on that same
model (echo, sum, double, countdown). TIS-100/Shenzhen I/O's genre-defining
depth comes from **mechanical variety** (multiple parallel nodes
communicating over ports, stack machines, image/audio processing,
self-modifying constraints), not just more of the same puzzle type — 20
well-tuned single-node arithmetic puzzles is a reasonable *intro* tier, but
there is currently no second tier that exercises a different mechanic.

**Triage:** ENGINEERING (VM feature: multi-node/port communication would be
a genuinely new opcode + execution-model addition, not content authoring)
for a second puzzle-type tier; CURATION (more puzzles in the existing
single-node model) for bank depth within the current mechanic. Neither
attempted in this pass — both are real, scoped feature work, not small/safe
fixes.

### Farming — vs. Stardew Valley

**Verdict: `watered_at` fixed this pass (see §2); crop-variety gap is real
and separate.**

18 crops confirmed (`content/crops.json`, verified via `python3 -c
json.load`), each with real season-affinity (`seasons: []`), `growth_days`
(4-10), and `yield` (3-8) — genuine mechanical variety in *when* and *how
much*, not just re-skins. What's absent, verified by reading
`server/lib/farming.js` in full: no quality tiers (Stardew's bronze/silver/
gold/iridium star system driving price multipliers), no regrowable crops
(every crop here is single-harvest — `harvestCrop` unconditionally
`DELETE`s the row), no fertilizer, no giant-crop mechanic. Watering (this
pass's fix) closes the most-cited single gap; the remaining ones are a
distinct, larger "farming depth" body of work.

**Triage:** ENGINEERING for all four (quality tiers, regrowable crops,
fertilizer, giant crops) — none depend on external data, all are pure
game-logic/schema additions to the existing `claim_crops` substrate. Not
attempted in this pass; listed for the "closing the hard 20%" backlog.

---

## Net assessment

Of the 4 assigned residuals: 3 confirmed-open and fixed this pass (hidden-object
juice/markers, farming watering, restaurant miss-feedback/tip-popup — all with
passing tests, eslint clean, `node --check server.js` clean), 1 confirmed-still-live
and correctly left for the sibling unit (mahjong legacy route). The depth pass
found mahjong is genuinely the strongest minigame (matches the doc), and
surfaced one finding the doc didn't have: the T1.5 hacking-hint fix, while a
real improvement, over-corrected into an unlimited free hint that can make
the authored terminal-tree content skippable — the opposite shallowness from
before. Every other genre-leader gap identified (mahjong chi/pon/kan,
karaoke melody scoring, code-puzzle mechanical variety, trivia bank depth,
farming quality/regrowth) is triaged above and intentionally left for future
scoped work rather than attempted as an unsafe "small fix."
