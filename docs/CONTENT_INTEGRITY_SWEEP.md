# Content Integrity Sweep — "completing Concord" as finishable audit-classes

> Captured 2026-07-17 at the owner's direction, from a real realization while
> fixing the `tunya` "Cree" faction naming collision. This is the durable repo
> home for the thesis + the live findings queue. (The master execution plan in
> the container-ephemeral `/root/.claude/plans/` references this doc as its
> Track E; per CLAUDE.md §"Docs are a build artifact," the repo doc is the
> source of truth.)

## The thesis

"Completing Concord" is **not** an infinite frontier. It is a **finite set of
discrete integrity-classes**, each of which can be:

1. **swept to zero** across the WHOLE corpus (not one lens/world at a time), and
2. **gated** so it never regresses (a detector/grader/CI check).

A class is "done" when there is **no open instance corpus-wide AND a gate keeps
it that way**. Concord is "complete" in a definable, defensible sense when every
known class is either at-zero-and-gated or a bounded owner-decision queue —
*not* "no more ideas" (there are always more), but "no open instance of any
known integrity class, and a gate on each so none reopens."

### Why this is the right unit of work (the "cracked the code" moment)

The Cree→Corre fix (commit `b94154db`) was not a one-off content edit. It ran a
complete loop, and — crucially — **the sweep surfaced adjacent instances of the
same class** (the "Kree"/Marvel IP collision; the "Naheya/Wiyowak" Cree-language
place names). That is the tell that a **class, not an item**, is the right unit:
fix one instance the shallow way and you leave siblings; sweep the class and you
find and close them together, then gate so they can't come back. Every class
Concord already mechanized (fabricated-data, generic-scaffold, doc-drift) went
from "an endless source of regressions" to "green and gated." The remaining work
is doing that for the not-yet-mechanized classes.

## The integrity-classes ledger

| Class | State | Gate / mechanism |
|---|---|---|
| Fabricated data in a live path | ✅ mechanized + gated | `server/lib/detectors/frontend-fake-data-detector.js` (PR ratchet vs `audit/detectors/BASELINE.json`) |
| Generic-scaffold UI | ✅ mechanized + gated | `scripts/grade-ux-polish.mjs --honest` (GENERIC_TRIO), pinned by `grade-ux-polish-idiom.test.js` |
| Doc-claim numeric drift | ✅ mechanized + gated | `scripts/check-doc-claims-all.mjs --ci` |
| Rotted invariant→test links | ✅ mechanized + gated | `scripts/verify-invariant-test-links.mjs --ci` |
| Schema drift | ✅ mechanized + gated | `scripts/verify-schema-drift.mjs --ci` |
| Behavioral depth floor | ◑ measured, grind-to-ceiling | `scripts/grade-macro-depth.mjs --honest` (depth-fleet loop) |
| Capability-map "genuinely missing" gaps | ◑ per-lens manual triage | Frontend-Rebuild Wave-4 gap-closure (DATA-SOURCING / ENGINEERING / CURATION) |
| **Real-name / IP-name collisions** | **✅ mechanized + gated (2026-07-17)** | `scripts/check-name-collisions.mjs --ci` (E3 gate, wired in `audits.yml`), pinned by `name-collision-gate.test.js` |
| Honest-hologram motion (no `setInterval` work-animation in ConKay) | ✅ mechanized + gated | `scripts/check-conkay-honest-motion.mjs --ci` (allowlist of named UX-teardown timers, wired in `audits.yml`), pinned by `conkay-honest-motion-gate.test.js` |

The last row is the one this doc opens. The base rate matters: **tunya alone
carried ≥3 collisions** (Cree, Kree, Naheya/Wiyowak) in a single sub-world, which
strongly implies the other 9 authored sub-worlds carry their own — so this is a
real corpus-wide class, not a tunya quirk.

## Live findings queue (name/IP-collision class)

### CLOSED
- **`tunya` faction "Cree" → "Corre"** (2026-07-17). Real living Indigenous
  nation (the Cree Nation) reused for a fictional ark-arrived people. Renamed in
  two passes: display name + faction id + cross-world test +
  `character-schema.ts` (`b94154db`), then **21 residual `cree_*` snake_case
  identifiers** the E2 audit caught (`cree_eldest_walker`,
  `scarf_of_cree_cedar_dye`, `give_to_cree`, …) that the `\bcree\b` regex missed
  because `cree_` has no word boundary — swept with a boundary-precise
  `[_"]cree[_"]` pattern that provably left `decree`/`screened` (5) and `Kree`
  (72) untouched (`6799d4fc`). Verified: repo-wide ethnonym-cree count = 0 at
  BOTH display and identifier level, JSON valid, cross-world test 12/12. **This
  is the class-to-zero worked example.**

### CLOSED — 2026-07-18 owner-authorized sweep batch (12 renames)
The owner authorized the audited replacement names; all swept boundary-precisely
(count→0 corpus-wide, JSON valid, coupled tests green), and the 12 entries were
dropped from `audit/name-collisions/BASELINE.json` (v2). The E3 gate is GREEN
(`check-name-collisions.mjs --ci` → 0 new, 7 known-covered) and the dictionary
still guards every old term against reintroduction.

- **`tunya` "Kree" → "Vrellan"** — the Marvel-IP collision, ~139 refs across 17
  tunya JSON + codex + concordia-hub cultures + the **bloodline engine**
  (`bloodline-powers.js`, `concordia-npc-seeder.js`) + **frontend**
  (`character-schema.ts`, `BloodlineBadge.tsx` + test) + **forward-repair
  migration 368** (sorted-pair `culture_relations` re-check verified live). (`f22f8e33`)
- **`tunya` place/given names** — "Wiyowak Bay" → "Hotamek Bay", "Naheya Plain" →
  "Kohanti Plain", "Okimaw" → "Tamohek", "Neyahwetin" → "Kanewola" (the remaining
  Cree-language-derived coinages, re-coined from the corre culture's own phoneme
  set). (`f22f8e33`)
- **Thunder Brahmin → Thunder Yak**, **Wintersday → Hearthtide** (+ file rename +
  achievement + festival/seasonal/belonging tests), **Mournhold → House Vaelmoor**,
  **Karthal → House Thornvale**, **Marcus Holloway → Marcus Vantree**, **Pyke →
  Wrenlow**, **glock_19 → compact_9mm / sig_p229 → duty_40cal**, **"Skyrim-class"
  → generic descriptor**. (`477eed7c`)

### OPEN — the 3 "likely-keep" residuals (bounded owner queue)
Only these remain baselined, each a plausible-coincidence generic term the audit
rated "likely keep" — awaiting an owner keep-or-rename call, not blocking:
- **Gloom Stalker** (fantasy + sovereign-ruins) — D&D subclass vs. generic
  "gloom"+"stalker".
- **Jorah Dunmore** (sovereign-ruins) — biblical/GoT echo, procgen surname combo.
- **Polysteel** (cyber + _shared) — coined material/org, not a real trademark.

### E2 corpus-wide audit RESULTS (2026-07-17 — 6 read-only agents; 11 worlds + 12 non-world dirs; ~700+ proper nouns assessed)

**The thesis held: the class is finite.** Fully-clean worlds/dirs: **superhero,
sere, lattice-crucible** + 10 of 12 non-world dirs (incl. `karaoke-lyrics`, which
turned out to be all original). The complete actionable queue is **1 HIGH + 2 MED
+ 1 sensitivity + a LOW tail** — every fix is an owner creative call (a
replacement name), exactly like Cree→Corre. Ranked:

| # | Finding | Class | Footprint | Confidence | Disposition |
|---|---|---|---|---|---|
| 1 | ✅ **ArasaCorp → Nevex Corp** (cyber, `353fef39`) — *Arasaka*/Cyberpunk | (c) IP | ~40 refs incl. ids + cross-refs; 0 residual | **HIGH** | DONE |
| 2 | ✅ **Medici → Vessine** (`360cf381`) — real Florentine dynasty | (b) real dynasty | ~332 cross-world refs + bloodline engine + frontend + forward-repair migration 367; 0 functional residual | **MED** | DONE |
| 3 | ✅ **Nymeria → Maeris of the Bog** (`353fef39`) — GRRM/GoT | (c) IP | cross-cutting fantasy + quests (file renamed) + dialogues + festivals; 0 residual | **MED** | DONE |
| 4 | ✅ **Thunder Brahmin → Thunder Yak** (`477eed7c`) | (a) real living group | 2 refs; 0 residual | LOW-MED / sensitivity | DONE |
| 5 | ✅ **Wintersday → Hearthtide** (`477eed7c`) — + file rename + achievement + 3 tests | (c) IP | 0 residual | LOW | DONE |
| 6 | ✅ **Mournhold → House Vaelmoor** (`477eed7c`) | (c) IP | 0 residual | LOW | DONE |
| 7 | ✅ **Marcus Holloway → Marcus Vantree** (`477eed7c`) — incl. `_shared` power-tier registry | (c) IP | 0 residual | LOW | DONE |
| 8 | ✅ **Pyke → Wrenlow, Karthal → House Thornvale** (`477eed7c`) | (c) IP | 0 residual | LOW | DONE |
| 9 | Gloom Stalker (fantasy + sovereign-ruins) — D&D subclass; generic "gloom"+"stalker" | (c) IP | 2 refs | LOW | **likely keep (still baselined)** |
| 10 | Polysteel (cyber, coined org); Jorah Dunmore (sovereign-ruins, biblical/GoT echo) | (c) IP | few | LOW | **likely keep (still baselined)** |
| 11 | Mercury (tunya alien goddess) — Roman god, **public domain** | (c) | 25 refs | LOW | keep (public-domain myth; `acceptedTerms`) |
| 12 | ✅ **Okimaw → Tamohek** (`f22f8e33`) — + Neyahwetin → Kanewola | (a) | 0 residual | LOW | DONE |
| 13 | ✅ **glock_19 → compact_9mm, sig_p229 → duty_40cal** (`477eed7c`) | (c) brand | 0 residual | LOW | DONE |

**Not a name collision but flagged:** ✅ **DONE** — the fantasy `meta.json`
"Skyrim-class" competitor name-drop was replaced with a generic descriptor
(`477eed7c`).

### Status: name/IP-collision class is at-zero-and-gated
Every owner-decided rename is swept to 0 corpus-wide; `BASELINE.json` v2 carries
only the 3 "likely-keep" residuals (Gloom Stalker / Jorah Dunmore / Polysteel) as
a bounded owner queue; the E3 gate (`check-name-collisions.mjs --ci`) is GREEN and
CI-wired, guarding every old term against reintroduction. Nothing here is open
except the owner's keep-or-rename call on the 3 residuals.

## Execution plan for the name/IP-collision class

- **E1 — the folded-in tunya findings** (Kree, Naheya/Wiyowak): resolve the two
  owner decisions above, then surgical sweep + verify each. Scoped, ready.
- **E2 — corpus-wide read-only audit** (fleet-parallelizable, one agent per
  sub-world): produce a ranked findings list — the collision + its refs + a
  proposed disposition — for (a) real living-nation / ethnonym names, (b)
  real-person names, (c) trademarked IP used for unrelated fictional entities.
  The *audit* is parallel; the *fixes* are an owner-decision queue (replacement
  names), same shape as Cree→Corre. **Never rename authored lore silently — the
  replacement name is always the owner's creative call.**
- **E3 — mechanize the class so it can't regress**: a
  `content-name-collision-detector` (a real dictionary of ethnonyms + a curated
  trademarked-IP list, run over `content/**`), registered like the other
  detectors, `severity: high` on a NEW real-name-for-fictional-entity match vs a
  baseline of **owner-accepted exceptions** (some borrowings are deliberate and
  fine — the baseline records those). This is what turns the class from "manual
  vigilance" into a PR gate — the move that makes it *stay* at zero, which is the
  difference between "fixed once" and "the class is complete."

## How to add a new integrity-class

When a fix surfaces sibling instances of a shared shape, that shape is a class.
Add a row to the ledger above with: a one-line definition, its current state,
and either its existing gate or a note that E3-style mechanization is still owed.
The goal state for every row is **at-zero-and-gated**.
