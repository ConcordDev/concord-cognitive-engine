# DOSSIER — Character import, full set (B3-5)

- **Step:** B3-5 from the B3-1 step plan (PR #1750): the full-108 character import, following B3-4's hero set. This dossier is the pre-build ground truth; **no build work has started** (dossier rule: report + release first). It deliberately inherits two B3-4 decisions as named dependencies (folder P1, pilot-proven import settings P4) — if Ramaj's morning rulings change them, this dossier's plan inherits the change without rework, because it is written against the *decisions*, not against one guessed outcome.
- **Date:** 2026-10-28
- **Authorization:** Overseer dossier rule + amendments; B3-1 step plan; Rule 9 START NOTICE in the report carrying this dossier.
- **Bases:** haul `MANIFEST.md` read in full + VM folder re-listed 2026-10-28 (same ground as the B3-4 dossier, PR #1793 — not re-derived here); B3-2 dossier §5/§5.4 (securing rails, license); tracker facts (Court editor perf ~23–26 fps GPU-bound; Mac disk chronic) from `.Aura/ROADMAP.md` / `REQUESTS_FOR_CLAUDE.md`, read 2026-10-28.

## 1. RESEARCH — the full-set question is a staging question, not an import question

B3-4 settles *how* a character imports (pilot-proven settings, own avatar, folder). B3-5's question is *how much of the 3.57 GiB belongs inside the project at all*:

| Set | Files | Bytes | Role |
|---|---|---|---|
| Named (incl. hero-6) | 58 | ≈ 0.66 GiB | Distinct people: heroes, NPCs, hostiles, creatures |
| Generic bodies (Ch01–Ch50, `_nonPBR`) | 50 | ≈ 2.9 GiB (13–136 MB each) | Crowd stock / blank NPC bodies |

Three facts shape the answer. (1) **Editor cost is real:** Unity imports and caches every source FBX in `Library/`; 3.57 GiB of character sources land on a Mac whose disk is chronically near-full and whose editor already runs the Court GPU-bound — importing the generics *en masse* taxes exactly the machine Aura works on, for bodies no current roadmap task dresses a crowd with. (2) **The generics are interchangeable by design** — "blank NPC stock / crowd fillers" (manifest) — needed per-world, in handfuls, when W/A-phase population work arrives; the named set is needed as a *cast*, browsable and bindable now. (3) **Securing cost scales with the set:** under B3-4's recommended folder, the named set is a ≈0.66 GiB rail decision (LFS budget or exemption — the D1 question at 10× the clips' size); the generics would make it 3.57 GiB, a different decision class entirely.

**Options:** (A) all 108 in-project — simplest mental model, worst editor/disk/securing cost; (B) **named-58 in-project; generics held as a staged external library** (the verified VM set + zips), imported per-world in named batches when a roadmap task calls for crowd bodies — each such import a small Aura task with this dossier's settings; (C) generics first converted/compressed — no FBX-character compression path exists in the project's tooling today (the game-lod machinery is GLB-side); inventing one is a new step, not this one. **Recommendation: B.** It also matches how the set was authored: 58 *someones* and 50 *anyones*.

## 2. AUDIT — what B3-5 adds beyond B3-4's ground

- **Prop variants are distinct assets, flagged against helpful deduplication:** the named set contains three ±prop pairs — Maria_J_J_Ong / Maria_WProp_J_J_Ong, Paladin_J_Nordstrom / Paladin_WProp_J_Nordstrom, Erika_Archer / Erika_Archer_With_Bow_Arrow. The WProp files carry the character's weapon/prop in-hand — a C-04 (weapons in hands) gear source, not a duplicate. The import census counts all 58; nobody "cleans up" the pairs.
- **Category spread of the named 58** (from the manifest's names — the batching plan in §3 uses it): hero/archetype bodies (Paladin, Knight, Vanguard, Castle Guards ×2, Swat, The_Boss), townsfolk & life (Peasants ×2, claire, kaya, Aj, Ty, Remy, Sporty_Granny, Girlscout, Peasant-class), hostiles & undead (Mutant, Brute, Warzombie, Zombiegirl, copzombie, Skeletonzombie, Vampire, Parasite, Maw, Pumpkinhulk), creatures/fantasy (Ganfaul, Demon, Uriel, Medea, Nightshade, goblin, Warrok, Kachujin, Heraklios), sci-fi (Exo_Gray, exo_red, Eve, Ely, Dreyar, Mremireh), and the two bots (X_Bot, Y_Bot).
- **The generics are `_nonPBR` only.** The set as held is the non-PBR series ("plain bodies"); no PBR-textured generic variants exist in any holding. If a future crowd task wants textured generics, that's a re-download conversation (Ramaj's Mixamo account), not a missing-file hunt — stated now so nobody searches for them later.
- **Transfer reality (inherited from B3-4 §2, scaled):** the named set (~0.66 GiB) can ride the same class of channel as the hero-6, in batches. The generics' 2.9 GiB is what the existing 3.6 GB all-in-one zip + Ramaj's Drive tap exist for — under option B that transfer is *not* on this step's critical path at all (it happens when the first crowd batch is scheduled, or whenever Ramaj makes the tap for other reasons).

## 3. MAP + PLAN

- **Q1 · Strategy ratification (Ramaj, XS).** Option B recommended (named in-project, generics staged). *Done: strategy of record; if A is chosen instead, Q3 gains a generics batch sequence and the securing decision in Q2 is re-sized — the dossier's other steps stand.*
- **Q2 · Securing size decision (Ramaj, with D1/D2).** The named set under the B3-4 folder: ≈0.66 GiB via the D1 rail. The dossier's ask is that this be decided *as* the D2 follow-on it is, with the generics explicitly excluded from the figure under option B. *Done: the rail + figure recorded.*
- **Q3 · Batch import (Aura executes; B3 package).** Named-52 (the 58 minus B3-4's hero-6) in five category batches per §2's spread, using B3-4 P4's pilot-proven settings verbatim; per-file avatar validation logged; a file that fails validation is **listed and skipped, never silently retried with changed settings** — failures come back to B3 as a named list for a follow-up package. *Done: in-project census 58/58 named (or 58 minus the named failure list), each with `.meta`; per-batch PROGRESS_LOG lines with avatar-valid counts.*
- **Q4 · Spot verification (Aura).** Six characters across categories (one per §2 spread) skinned + idle-posed screenshots; Library size delta recorded in the Result line so the editor cost of the cast is a known number. *Done: screenshots filed; delta recorded.*
- **Q5 · Generics staging index (B3, paper, size XS).** A one-page index in the package: the 50 generics by file/size (from the manifest), where the verified copies live (VM folder + zips), and the import-on-demand procedure (batch of N for world W, same settings, census line per batch). *Done: index filed with the package; the first crowd task on the roadmap can order bodies without re-deriving any of this.*
- **Risks:** community-authored models vary (bone counts, stray props, scale outliers) — absorbed by per-file validation + the failure-list rule, and by batching (a bad batch is 10 files, not 52); editor slowdown after +0.66 GiB of sources — measured honestly at Q4 rather than discovered anecdotally.
- **Needs from others:** Ramaj — Q1, Q2. Aura — Q3/Q4 scheduling after B3-4 lands (this step's batches assume the hero-6 pilot's settings exist).

## 4. Standing sections — B3-5

**Needs to operate.** B3-4 complete (pilot settings + folder); the named set transferred (batches ride ordinary channels); Aura's editor. The generics need nothing until a crowd task exists.

**What it can do.** The full cast, in-project and bindable: quest NPCs stop sharing three faces (the Canon census gives the game named people across 9 worlds — §2's spread maps onto them), hostiles vary by world, and F-19/A-phase population work draws from stock instead of waiting on imports. With Q5, the crowd is one order away at all times without ever taxing the editor.
- **JUICE:** repetition is the enemy of place. The second time a player sees the *same* "different" NPC, the world admits it's a stage set. Fifty-eight distinct bodies — a vampire that isn't the paladin repainted, a granny who is actually a granny — is what lets the Court and the worlds read as inhabited rather than populated-by-one-actor. This step is casting, and casting is half of believability.

**What's limited.**
- **(a) Not-yet-built-but-codeable:** the batch imports (Q3), the staging index (Q5), any per-file rig repairs the failure list produces (follow-up packages, scoped per file).
- **(b) Genuinely external / ruling-gated:** the strategy + securing-size calls (Q1/Q2, Ramaj's); PBR generics don't exist in any holding (Mixamo re-download under Ramaj's account is the only source — a fact, not a gap in this step); Mixamo's no-redistribution term (§5.4) bounds all 108 as DTU assets while leaving in-game use unlimited.

## 5. DOUBLE-CHECK LOG

1. **Set arithmetic re-verified against two sources:** manifest census (58 + 50 = 108, "every Ch number present exactly once") vs tonight's folder listing (58 top-level FBX; Generic_Bodies = 50 entries) — agreement (B3-4 dossier §5; relied on, not repeated).
2. **The ±prop pairs** were found by reading the manifest's full named list against the folder listing — three pairs, both members present in both sources.
3. **NOT PROVEN:** per-file texture embedding and avatar validity for the 52 (the B3-4 pilot proves the *method* on 6; Q3's per-file validation is the proof for the rest — the plan carries the check rather than the dossier asserting the outcome); the claim that no PBR generics exist anywhere rests on the manifest + both character folders (VM) — a copy in an unsearched Mac worktree would change availability, not the import plan.

---

STANDARD CHECK
- Governing docs followed: Overseer dossier rule + amendments; Builder Quality Standard (rules 2b/8/9); B3-1 step plan; B3-4 dossier (dependencies named, not duplicated)
- Flows verified live or by behaviour tests: none run (dossier stage). Verification = manifest + listings + the B3-4 ground, cross-checked in §5
- NOT RUN / not proven: per-file import behaviour for the 52 (Q3 carries the checks); no editor session run by B3
- Fake data / stubs: none — option B is labeled a recommendation; category spread is read off the manifest's names
- Constraints held: PR-only, no excluded files touched, DATA_DIR temp, mem-gate used: no builds/tests ran (docs-only dossier); aura-wt untouched; no Mac writes
- Queue check: latest Overseer directive checked 2026-10-28 20:37 ET (sweep note); START NOTICE sent: yes (in the report carrying this dossier); current assignment: B3-5 character dossier (full set)
- Independent pass requested from: Overseer (dossier review); Ramaj for Q1/Q2

*Builder 3 — Concordia & Game. Coordination via Concord Overseer — Founder Office.*
