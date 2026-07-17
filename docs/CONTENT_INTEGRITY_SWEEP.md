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
| **Real-name / IP-name collisions** | **◑ NOT yet mechanized — this doc** | **manual sweep now; `content-name-collision-detector` gate (E3) to finish the class** |

The last row is the one this doc opens. The base rate matters: **tunya alone
carried ≥3 collisions** (Cree, Kree, Naheya/Wiyowak) in a single sub-world, which
strongly implies the other 9 authored sub-worlds carry their own — so this is a
real corpus-wide class, not a tunya quirk.

## Live findings queue (name/IP-collision class)

### CLOSED
- **`tunya` faction "Cree" → "Corre"** (2026-07-17, `b94154db`). Real living
  Indigenous nation (the Cree Nation) reused for a fictional ark-arrived people.
  Renamed corpus-wide (16 files incl. the lowercase `cree` faction id, the
  cross-world test, and the `world-lens/character-schema.ts` archetype map).
  Verified: `Kree`/`kree` untouched, all tunya JSON valid, `correspondent` and
  other substrings untouched (word-boundary rename), cross-world test 12/12.

### OPEN — owner-decision-gated (each fix is a creative call, like Cree→Corre)
- **`tunya` faction "Kree" vs. Marvel's trademarked *Kree***. A real **IP**
  collision (distinct from Cree: trademarked alien-race name, not a living
  people). "Kree" is woven through the most-developed lore in the game (~52
  refs), so a rename ripples hard — needs an owner-chosen replacement that keeps
  the intended texture, then the same surgical word-boundary sweep + verify
  (`Kree` count → 0, JSON valid, cross-world test green). **Do NOT sweep
  silently.**
- **`tunya/naming_conventions.json` place names "Wiyowak Bay" / "Naheya
  Plain"**. Cree-language-adjacent coinages tied to the same (now Corre) people
  — *Naheya* ≈ *Nēhiyaw* (the Cree autonym). Owner-decision: deliberate homage
  or incidental? If swept, rename to non-derived coinages in the same pass.

### OPEN — not yet audited (the corpus-wide sweep, E2)
- Every other authored sub-world + `content/quests/`, `content/festivals/`,
  faction/NPC/lore JSON, seeded catalogs — **not yet swept** for this class.

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
