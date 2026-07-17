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

### E2 corpus-wide audit RESULTS (2026-07-17 — 6 read-only agents; 11 worlds + 12 non-world dirs; ~700+ proper nouns assessed)

**The thesis held: the class is finite.** Fully-clean worlds/dirs: **superhero,
sere, lattice-crucible** + 10 of 12 non-world dirs (incl. `karaoke-lyrics`, which
turned out to be all original). The complete actionable queue is **1 HIGH + 2 MED
+ 1 sensitivity + a LOW tail** — every fix is an owner creative call (a
replacement name), exactly like Cree→Corre. Ranked:

| # | Finding | Class | Footprint | Confidence | Disposition |
|---|---|---|---|---|---|
| 1 | **ArasaCorp** (cyber) — one-letter lift of *Arasaka*, the Cyberpunk 2020/2077 megacorp | (c) IP | faction + VP NPC + district/item ids (~37 refs) | **HIGH** | owner-name → sweep |
| 2 | **Medici** — real Florentine dynasty as an alien ice-healer people/species/faction | (b) real dynasty | **cross-world**: tunya 158 + concordia-hub 8 + _shared 2 ≈ 168 refs | **MED** | owner-name → sweep at tunya source, propagate |
| 3 | **Nymeria** (fantasy) — signature GRRM/GoT name on a bog-witch NPC | (c) IP | **cross-cutting**: fantasy + quests (`nymeria-crossing.json`) + dialogues + festivals | **MED** | owner-name → sweep |
| 4 | **Thunder Brahmin** (concord-link-frontier) — real Hindu caste for a beast of burden (+ Fallout echo) | (a) real living group | creature name+id (2 refs) | **LOW-MED / sensitivity** | owner-verify — same class as Cree ("Brahman cattle-breed" is the defense) |
| 5 | Wintersday (festivals+achievements) — Guild Wars 2 coined holiday | (c) IP | 3 refs | LOW | owner-verify (content generic; neutral coinage drops it) |
| 6 | Mournhold (fantasy) — Elder Scrolls city as a Great House | (c) IP | 2 refs | LOW | owner-verify |
| 7 | Marcus Holloway (_shared/superhero) — Watch Dogs 2 protagonist | (c) IP | 2 refs | LOW | owner-verify (common name parts; maybe coincidence) |
| 8 | Pyke (GoT/common surname); Karthal (obscure M&M, likely coincidental) — fantasy | (c) IP | 1–2 refs | LOW | owner-verify |
| 9 | Gloom Stalker (fantasy + sovereign-ruins) — D&D subclass; generic "gloom"+"stalker" | (c) IP | 2 refs | LOW | likely keep |
| 10 | Polysteel (cyber, coined org/surname); Jorah Dunmore (sovereign-ruins, biblical/GoT echo) | (c) IP | few | LOW | likely keep |
| 11 | Mercury (tunya alien goddess) — Roman god, **public domain** | (c) | 25 refs | LOW | likely keep (public-domain myth) |
| 12 | Okimaw (tunya) — Cree-language word "chief" in the now-Corre faction | (a) | 1 NPC | LOW | owner-verify (loose end of the Cree decouple) |
| 13 | Firearm brand item ids (crime): `glock_19`, `sig_p229` | (c) brand | ~8 refs | LOW | owner-preference (de-brand to generic) |

**Not a name collision but flagged:** the fantasy `meta.json` calls the world
**"Skyrim-class"** — shipped content naming a competitor product (Bethesda).
Worth an edit for the same "deliberate not derivative" reason.

### Still owner-decision-gated from the original tunya find
- **`tunya` "Kree" vs. Marvel's trademarked *Kree*** (69 refs) — owner-chosen
  replacement needed; woven through the most-developed lore, ripples hard.
- **`tunya` "Wiyowak Bay" / "Naheya Plain"** — Cree-language-adjacent place-name
  coinages (*Naheya* ≈ *Nēhiyaw*); deliberate homage or incidental?

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
