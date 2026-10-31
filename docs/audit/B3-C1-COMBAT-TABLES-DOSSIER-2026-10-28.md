# DOSSIER — Server combat tables: make all 12 weapon classes first-class (B3-C1)

- **Step:** B3-C1 (new step, Builder 3 — Concordia & Game). Origin: roadmap task **C-03** (weapon class table, done 2026-10-26 by Claude, ahead of schedule) generated the client's `WeaponClassDef.cs` for 12 classes **from the server's own combat tables** — and its Result line recorded, honestly, that the server tables don't cover all 12. Every C-phase task downstream (C-04…C-17) builds on that data. This dossier audits the gap first-hand and plans the server-side completion. **No build work has started** — dossier first, release gates the build (Overseer/Ramaj).
- **Date:** 2026-10-28
- **Authorization:** Overseer dossier rule; B3 queue (filed 2026-10-28 — server wiring is B3's surface); Rule 9 START NOTICE in the report carrying this dossier.
- **Bases:** origin/main read first-hand 2026-10-28: `server/lib/combat/loadout.js`, `server/lib/combat-frame-data.js`, `server/lib/combat-impact.js`, `server/lib/combat/telegraph-peril.js`; roadmap C-03 task text + Result (live tracker, read 2026-10-28).

## 1. RESEARCH — the data contract

The client's weapon data is **generated, not hand-written**: `.Aura/tools/weapon_classes.mjs` reads the server tables and emits `WeaponClassDef.cs`; an EditMode test (`WeaponClassDefTests`, 5/5 at C-03) checks the 12 classes against them. The server tables are therefore the single source of truth for how every weapon *times and feels* (startup/active/recovery, parry/dodge windows, mass/momentum, reach) on both sides of the wire — server combat math consumes the same tables for live NPC/player resolution (B-09 proved server combat live in Play). A class missing from a table doesn't error; it silently falls back to the `default` row or a null class — the exact silent-wrong-answer shape this fleet keeps hunting. The fix belongs in the tables, once, not in per-class client patches.

## 2. AUDIT — the coverage matrix (verified row by row)

The 12 client classes: sword, greatsword, hammer, dagger, spear, axe, shield, staff, bow, pistol, rifle, unarmed.

| Class | loadout `NAME_TO_CLASS` | frame-data row | impact rows (mass/reach) | peril kind |
|---|---|---|---|---|
| sword | ✓ | ✓ | ✓ | — |
| greatsword | ✓ | **✗ → default** | **✗ → default** | sweep ✓ |
| hammer | ✓ | ✓ | ✓ | sweep ✓ |
| dagger | ✓ | ✓ | ✓ | — |
| spear | **✗ null** | ✓ | ✓ | thrust ✓ |
| axe | **✗ null** | ✓ | ✓ | sweep ✓ |
| shield | ✓ | **✗ → default** | **✗ → default** | — |
| staff | ✓ | ✓ | ✓ | — |
| bow | ✓ | ✓ | ✓ | — |
| pistol | ✓ | **✗ → default** | **✗ → default** | — |
| rifle | ✓ | **✗ → default** | **✗ → default** | — |
| unarmed | **✗ null** (by design, see §2 note) | ✓ as `fist` | ✓ as `fist` | — |

Readings: `NAME_TO_CLASS` (loadout.js:14–25) has 9 regex rows — spear and axe absent (unarmed is deliberately not a name pattern), so `inferWeaponClass` returns null for a spear or axe item name even though the frame/impact/peril layers all know those weapons. Frame-data (combat-frame-data.js `KIND_FRAME_BASE`) carries sword/axe/spear/bow/staff/**fist**/dagger/hammer + default. Impact (combat-impact.js `KIND_BONE_MASS` / `KIND_LEVER_ARM`) carries the same 8 kinds, **fist included** (mass 2.5, lever arm 0.42), + default. Telegraph-peril is complete for this purpose (spear→thrust, axe→sweep present). **C-03's recorded gaps check out, with one CORRECTION to the first draft of this dossier:** greatsword/shield/pistol/rifle are default-row classes and spear/axe are class-null in `NAME_TO_CLASS`, as C-03 said. The first draft also claimed *unarmed* had no frame/impact rows and proposed invented values for it. **That was wrong** (found in review, 2026-10-28): the server already has `fist` rows — frames 140/60/220, parry 260, dodge 300; impact mass 2.5, lever arm 0.42 — and `loadout.js` already falls back to `weaponClass: "fist"` when nothing is equipped (loadout.js:184–185). The client's `unarmed` class is the server's `fist` kind under another name. The only real unarmed question is therefore the **name mapping** (`unarmed` ⇄ `fist`) in the generator, not new balance data.

## 3. MAP + PLAN

- **S1 · Values proposal (this dossier's §4 table — ratification gate).** The four missing frame/impact rows (greatsword, shield, pistol, rifle) and the spear/axe class patterns are **balance data**. §4 proposes each value derived from the existing tables' internal relationships (never invented from nothing), and **Ramaj/Overseer ratify or adjust before S2 is written**. No numbers ship unratified.
- **S2 · Server slice (B3, size S).** Edits, all in `server/lib/`: (a) `combat/loadout.js` — add spear and axe rows to `NAME_TO_CLASS` in the file's existing style and ordering discipline (specific-before-general: the greatsword row already precedes sword for exactly this reason; proposed patterns in §4). (b) `combat-frame-data.js` — add the four ratified rows. (c) `combat-impact.js` — add the four ratified mass/reach entries. **Unarmed (no new data):** the server already models empty hands as the `fist` kind in all three places that matter. S2 adds **no** unarmed rows and **no** name regex (empty hands are a loadout state, not an item name). The only decision for S1 is whether the generator (`.Aura/tools/weapon_classes.mjs`) maps client `unarmed` → server `fist`, or the server grows an `unarmed` alias; recommendation: map in the generator, touch nothing server-side.
  *Done: the three files cover all 12 classes (unarmed via the existing `fist` kind); the existing suites pass — `server/tests/combat-frame-data.test.js`, `combat-impact-pvp-feel.test.js`, `integration/combat-impact-feel.test.js`, `integration/combat-impact-stagger.test.js`, `integration/telegraph-peril.test.js` — plus new assertions added per added row/class in the same test style; exact pass counts in the build report.*
- **S3 · Regeneration hand-off (Aura, packaged by B3 in one paragraph).** After S2 merges, Aura re-runs `.Aura/tools/weapon_classes.mjs`; `WeaponClassDef.cs` regenerates with `ServerWeaponClass` non-null for spear/axe and `ServerFrames`/`ServerImpact` true for all 12 (unarmed resolved through `fist`); `WeaponClassDefTests` re-run in the editor. *Done: Aura's Result line on C-03 (or PROGRESS_LOG) records the regeneration + test state.*
- **Risks:** regex collisions in NAME_TO_CLASS (a new pattern swallowing an existing class's items — mitigated by ordering + a test case per existing class name staying stable); balance values shifting live server combat feel for NPC weapons that currently ride `default` (greatsword-armed NPCs get slower/heavier — that's the point, but it's a feel change Ramaj should see coming, hence S1).
- **Needs from others:** S1 ratification (Ramaj/Overseer); Aura for S3 after merge.

## 4. PROPOSED VALUES (for S1 ratification — derivations stated, nothing shipped yet)

Deltas for ratification — only these four rows would be new. Existing anchors (read from main): fist 140/60/220, parry 260, dodge 300, mass 2.5, reach 0.42 · sword 200/100/300, parry 220, dodge 260, mass 1.6, reach 0.95 · hammer 350/180/450, parry 160, dodge 220, mass 5.2, reach 0.95 · dagger 120/50/200, parry 240, dodge 320, mass 1.2, reach 0.45 · bow 350/80/250, parry 0, dodge 320, mass 1.0, reach 0.70 (frame ms = startup/active/recovery).

| New row | Frames (start/active/rec, parry, dodge) | Mass / reach | Derivation |
|---|---|---|---|
| greatsword | 320/160/420, 180, 230 | 4.6 / 1.30 | Between sword and hammer on speed (it is the sweep heavy that isn't a blunt); mass just under hammer; reach the longest melee (two-hand blade) |
| shield | 160/80/240, 300, 260 | 2.4 / 0.55 | A defensive class: fastest guard-adjacent parry window in the table (300 > dagger 240 — the shield's identity), short reach, mid mass |
| pistol | 180/40/220, 0, 300 | 0.8 / 0.60 | Ranged ⇒ parry 0 like bow/staff; fastest startup of the ranged set (sidearm), lightest mass |
| rifle | 300/60/300, 0, 280 | 1.8 / 0.80 | Ranged, parry 0; slower than pistol, heavier; under bow's startup (350) as a firearm |
| ~~unarmed~~ | *(withdrawn — `fist` already exists on main; see §2)* | — | — |

Class patterns for loadout.js (file style: `[regex, class, handedness]`): spear — `/spear|pike|glaive|trident/i, "spear", "two"` (halberd deliberately excluded — it's a poleaxe; if Ramaj wants it as axe, S1 says so); axe — `/axe|hatchet|tomahawk/i, "axe", "either"` (does not collide with existing rows; placed before the sword row's broad `/sword|blade/` cannot swallow it — order still checked in tests).

## 5. Standing sections — B3-C1

**Needs to operate.** The three server files + their named test suites (mem-gate, temp DATA_DIR). No Mac, no key, no editor for S2. S3 needs Aura + the editor, after merge.

**What it can do.** Every weapon a player can hold gets its *own* timing, weight, and reach in the server's math and the client's data at once — a spear stops being a null-class item wearing spear frames, a greatsword stops swinging on generic defaults, and C-04…C-17 build on complete data instead of C-03's flagged fallbacks. The generator contract (server tables → client defs) becomes total: 12/12 classes, no silent defaults.
- **JUICE:** weapon feel *is* these numbers. Startup is anticipation, active is contact, recovery is commitment; mass is the stagger you cause, reach is the distance you own. A greatsword on default timing feels like a sword with a bigger mesh — the exact flatness the Feel phase exists to kill. This step is small in code and large in how every swing in the game reads.

**What's limited.**
- **(a) Not-yet-built-but-codeable:** everything in §2's matrix — that's the step (§3). Nothing else in the combat stack was audited for this dossier (damage-calculator, executions, boss tables are their own surfaces; not claimed here).
- **(b) Genuinely external / ruling-gated:** the §4 values are **balance rulings** — codeable in minutes, but they're Ramaj's game to tune; the dossier proposes with derivations and ships nothing unratified. The spear-pattern halberd call and the unarmed-class shape are the same class of decision (named in S1/§4).

## 6. DOUBLE-CHECK LOG

1. **C-03's claims re-derived independently:** the tracker's gap list (spear/axe class-null; greatsword/shield/pistol/rifle default-row) was checked against the three tables read directly — agreement. **Correction after review:** the first draft's extra claim that unarmed lacked frame/impact rows was false (`fist` rows exist; `loadout.js` falls back to `fist`); §2/§4 are restated accordingly and the invented unarmed values withdrawn.
2. **File locations corrected against assumption:** C-03's Result cites `combat-frame-data.js` / `combat-impact.js` — they live at `server/lib/` root, **not** under `server/lib/combat/` (verified by listing; telegraph-peril.js is in both listings because it exists under combat/ — the frame/impact pair does not). S2's edit paths use the verified locations.
3. **Peril layer not assumed:** telegraph-peril.js read directly — spear/axe kinds present, so no S2 edit there; stated in the matrix rather than left implicit.

---

STANDARD CHECK
- Governing docs followed: Overseer dossier rule; Builder Quality Standard (rules 2b/8/9); roadmap C-03 task + Result as the originating record; no-invented-numbers discipline (§4 = proposals with derivations, ratification-gated)
- Flows verified live or by behaviour tests: none run (dossier stage). Verification = the three tables + loadout read in full, coverage matrix derived row by row, C-03's claims independently re-derived (§6)
- NOT RUN / not proven: the named combat test suites (they run at S2 build); the generator's re-run (S3, Aura's); live server combat with new rows (post-merge behaviour, B-09-style proof belongs to the build report)
- Fake data / stubs: none — §4 values are labeled proposals, not findings
- Constraints held: PR-only, no excluded files touched, DATA_DIR temp, mem-gate used: no builds/tests ran (docs-only dossier)
- Queue check: latest Overseer directive checked 2026-10-28 20:37 ET (sweep note); START NOTICE sent: yes (in the report carrying this dossier); current assignment: B3-C1 combat-tables dossier
- Independent pass requested from: Overseer (dossier review); Ramaj for the §4 values ratification (S1)

*Builder 3 — Concordia & Game. Coordination via Concord Overseer — Founder Office.*
