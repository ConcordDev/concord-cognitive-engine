# DOSSIER — Character import, hero set (B3-4)

- **Step:** B3-4 from the B3-1 step plan (PR #1750): import a hero set of 6 characters (X Bot + 5 named) into the Unity project under a recorded folder decision, rigs Humanoid, materials checked — done-state: 6 named FBX in-project with `.meta`, one of them skinned and idle-animated in the hub scene, screenshot/log evidence filed. This dossier is the pre-build ground truth; **no build work has started** (dossier rule: report + release first). The import itself is editor work — Aura's surface; B3's deliverables are this dossier and, after release, the descriptive import package.
- **Date:** 2026-10-28
- **Authorization:** Overseer dossier rule + amendments (three standing sections, JUICE); B3-1 step plan; Ramaj's ownership split (B3 = non-editor surface: manifests, specs, packages); Rule 9 START NOTICE in the report carrying this dossier.
- **Bases:** VM holdings re-listed and the haul `MANIFEST.md` read in full 2026-10-28; B3-1 audit + B3-2 dossier §5 sweep (import state: 0/108 anywhere, verified 2026-10-28); license field from B3-2 dossier §5.4.

## 1. RESEARCH — what a character import needs that the clips didn't

The 110 clips were animation-only (Without Skin) and needed one rig conversion (Package #1, PKG1-1). Characters are the opposite problem: each is a **skinned, T-posed body with no animation attached** (haul manifest spec: FBX Binary, T-pose, Kaydara-verified), driven by the clips once imported. Per character, the import must settle four things the clips never raised: (1) its **own avatar** (Create From This Model — the skeleton is the character's, not X Bot's, though the clips were authored on X Bot and retarget through Humanoid); (2) **skin + materials** — whether the FBX embeds its textures or expects externals is a per-source unknown the pilot import must establish (see §5); (3) **scale/orientation** sanity against the project's human baseline (Soldier/Xbot + CX rigs); (4) a **folder + securing decision** with real size consequences:

| Set | Files | Bytes | Character |
|---|---|---|---|
| Hero-6 (this step, proposed §3) | 6 | ≈ 56 MB | The working cast: rig reference + Court/proving-ground bodies |
| Named set (B3-5 territory) | 58 | ≈ 0.66 GiB | Every distinct person Mixamo offered |
| Generic bodies (B3-5 territory) | 50 | ≈ 2.9 GiB (13–136 MB each) | Crowd stock — the bulk, and the least urgent |

Folder fork: importing under `Assets/Concordia/Models/**` lands inside the existing gitignore — the import would be local-only on arrival, the same loss class B3-2 exists to close. A new **`Assets/Concordia/Characters/`** folder is not ignored, is LFS-routed like every FBX (rail per Ramaj's D1 precedent), and keeps characters addressable separately from the organic/Meshy Models mass. The dossier recommends the new folder; the call is Ramaj's (it is also D2's follow-on in miniature).

## 2. AUDIT — holdings and current state, verified

- **Holdings (VM, re-listed 2026-10-28):** `~/workspace/concordia-mixamo-characters/` = **58 named FBX** (top level) + `Generic_Bodies/` (**50** Ch01–Ch50 `_nonPBR` FBX) + `MANIFEST.md` — set complete per the manifest (108 = Mixamo's 108 grid slots, no gaps/duplicates, 3.57 GiB on disk), CRC-verified zips behind them (B3-1). Named sizes run 1.7 MB (X_Bot) to 32.7 MB (exo_red); the manifest lists each with its size.
- **Imported: nowhere.** 0/108 in git (every branch) and 0/108 in aura-wt (B3-1 + sweep, 2026-10-28). The project's committed human baseline is Soldier.glb / Xbot.glb + the Rocketbox-derived CX rigs; the browser client's hero GLBs are a separate pipeline's output, not a Unity import path.
- **The transfer gap (this step's critical path, named plainly):** the clips reached aura-wt in Oct 24 import batches; the characters never made that trip — they exist on the VM (and in the zips), not on the Mac. The 3.6 GB all-in-one zip's Drive upload is blocked on Ramaj's Drive Allow tap (goal-tracked); split-part storage links expired 2026-10-26; B3's device channel reads Mac→VM only. **A 56 MB hero-6 does not need the 3.6 GB route** — it needs any one working VM→Mac channel for six files (Ramaj's Drive tap covers it as a side effect; a B1/Mac-side pull or Ramaj re-downloading the six from his Mixamo account are equal alternatives). The dossier's plan (§3) sequences the decision, it does not pretend the files are already there.
- **License (from §5.4 of the B3-2 dossier):** Mixamo — commercial in-game use OK; raw files may not be redistributed as standalone/tradeable assets. Importing and animating these characters is use; nothing in this step redistributes anything.

## 3. MAP + PLAN

- **P1 · Folder decision (Ramaj, XS).** Recommended: `Assets/Concordia/Characters/`. *Done: decision recorded (feeds the B3-2/D2 line as precedent for the named set).*
- **P2 · Hero-6 ratification (Ramaj, XS).** Proposed six, chosen for coverage of what the roadmap needs first — the rig reference, Court life, and a hostile: **X_Bot** (1.7 MB — the character the 110 clips were authored on; the retarget reference), **Paladin_J_Nordstrom** (8.6 MB — armored Court/guard body), **Erika_Archer** (18.7 MB — ranged NPC; a With_Bow_Arrow variant exists for later), **Peasant_Girl** (4.7 MB) + **Peasant_Man** (3.5 MB) — townsfolk for F-19's job animations, **Mutant** (18.9 MB — Proving Ring hostile). Total ≈ 56 MB. Named alternates if Ramaj swaps: castle_guard_01/02 (guards), claire / kaya (named townsfolk), Brute (bigger hostile). *Done: the six are named of record.*
- **P3 · Transfer (channel per §2; hands = whoever holds the chosen channel).** The six FBX land in a Mac staging folder; checksums/sizes verified against the manifest's per-file sizes on arrival (X_Bot must read 1,750,032 B ± the manifest's rounding — the package will carry exact VM byte counts). *Done: 6/6 files present on the Mac, sizes matching.*
- **P4 · Import package (B3 writes it after release; Aura executes).** Descriptive steps in Package #1's format: pilot on X_Bot first (import → Rig Humanoid, Avatar Definition = Create From This Model → apply the 110-clip set's `Breathing_Idle` via a test controller state → screenshot: skinned, posed, textured or texture-missing *as found*), and only then the remaining five with the pilot's settled settings (incl. the materials finding: embedded vs extracted, matched to the project's existing FBX convention). *Done (the B3-1 done-state): 6 named FBX in-project under the P1 folder with `.meta`; one skinned + idle-animated in the hub scene; screenshot/log evidence filed in Aura's PROGRESS_LOG.*
- **Risks:** texture embedding unknown until the pilot (§5 — the pilot exists precisely to absorb it); per-file bone differences (community-authored Mixamo characters vary — the avatar validity check per file is in the package, failures reported per file, never massaged); Mac disk (56 MB is noise against the disk problem; the full-108 question is B3-5's, where 3.57 GiB is not noise).
- **Needs from others:** Ramaj — P1, P2, and the P3 channel. Aura — P4 execution + evidence.

## 4. Standing sections — B3-4

**Needs to operate.** The six files on the Mac (P3), a folder decision (P1), the Unity editor (Aura). Nothing else: no server, no key, no new accounts.

**What it can do.** The game gets its first real cast. Every system waiting on bodies unblocks in kind: F-19's NPC job animations get distinct people to play on (a peasant working, a guard watching — not one repeated soldier), the Proving Ring gets a hostile that reads as a creature, and the hero's own embodiment question (today: Xbot/Soldier stand-ins) gets its reference body — the same X Bot the entire clip library was authored on, which makes every retarget check in Packages #1+ honest.
- **JUICE:** this is the step where the Court stops being a diorama. Six bodies isn't a crowd, but it's the difference between a tech demo's mannequin and a place with *people in it* — a paladin at the gate, peasants doing F-19 jobs, something in the Ring you're actually meant to fight. Presence is the game's first impression, and presence is bodies.

**What's limited.**
- **(a) Not-yet-built-but-codeable:** the import itself (P4 package), the named-58 and generics (B3-5's dossier, sequenced after this one), any character-specific material polish (follows the pilot's findings).
- **(b) Genuinely external / ruling-gated:** the P3 transfer channel (a Ramaj-held tap or account — named in §2, not a code gap); the P1/P2 calls are Ramaj's product decisions; Mixamo's no-redistribution term bounds what these files may ever become as DTUs (§5.4) — it does not limit this step.

## 5. DOUBLE-CHECK LOG

1. **Counts by two sources:** tonight's folder listing (58 top-level FBX + 50 in Generic_Bodies/) vs the haul manifest's own census (58 named + Ch01–Ch50 complete) — agreement, 108 total.
2. **Size cross-check:** folder total 3.6 GB (du) vs manifest's stated 3.57 GiB on disk — agreement; generics 2.9 GB (du) vs the manifest's per-file sizes (13–136 MB × 50) — consistent.
3. **NOT PROVEN, and routed to the pilot instead of assumed:** whether the character FBXs embed their textures. Mixamo's FBX-for-Unity downloads commonly embed media, but "commonly" is not verification — P4's pilot establishes it on X_Bot before any batch step, and the package will carry the finding either way.
4. **"Imported nowhere" scope:** verified for git (all branches) and aura-wt on 2026-10-28 (B3-1/sweep); other Mac worktrees were not exhaustively searched (the concord-wt scan capped during the sweep) — stated as such; a stray copy in another worktree would be a bonus, not a contradiction of the import plan.

---

STANDARD CHECK
- Governing docs followed: Overseer dossier rule + amendments; Builder Quality Standard (rules 2b/8/9); B3-1 step plan (PR #1750) for the step's done-state; B3-2 dossier §5.4 for the license field
- Flows verified live or by behaviour tests: none run (dossier stage). Verification = folder re-listing, manifest read in full, size cross-checks (§5)
- NOT RUN / not proven: texture embedding (pilot's job, P4); avatar validity per character (import-time check); no editor session run by B3
- Fake data / stubs: none — the hero-6 is labeled a proposal for ratification, sizes are the manifest's + du's
- Constraints held: PR-only, no excluded files touched, DATA_DIR temp, mem-gate used: no builds/tests ran (docs-only dossier); aura-wt untouched; no Mac writes
- Queue check: latest Overseer directive checked 2026-10-28 20:37 ET (sweep note); START NOTICE sent: yes (in the report carrying this dossier); current assignment: B3-4 character dossier (hero set)
- Independent pass requested from: Overseer (dossier review); Ramaj for P1/P2 + the P3 channel

*Builder 3 — Concordia & Game. Coordination via Concord Overseer — Founder Office.*
