# R0 UAL1 / Glide / Life Proof

Status: PARTIAL / UNVERIFIED
Date: 2026-09-22

## Evidence

- `Assets/Concordia/Anim/ConcordiaLocomotion.controller` and the Resources copy are UAL1-backed from prior work.
- `Assets/Concordia/Generated/UAL1_CLIP_INDEX.txt` records the extracted UAL1 clips.
- `Assets/Concordia/Scripts/Animation/AnimationLiveBindings.cs` contains explicit clip mappings and no recorded honesty traps.
- Prior focused EditMode animation suite: 8/8 passed.
- Prior coverage audit: 442 verbs, 0 honesty failures.
- `Assets/Concordia/Generated/Proof/L0_UAL1_Sequence_20260922_031125915_0_idle.png` is valid idle evidence.
- `Assets/Concordia/Generated/Proof/L0_UAL1_Sequence_Proof_INCONCLUSIVE.md` correctly records that the full visible sequence was not proven.
- `Assets/Concordia/Generated/AURA_LIFE_PROOF.txt` records the latest A–F life-loop PASS.

## Missing acceptance evidence

- Full visible idle → walk → sprint → turn → stop → roll → sword → hit sequence.
- 30-second glide benchmark with measured p95/p99 and GPU evidence.
- Fresh LIFE_PROOF re-smoke after the latest source edits.
- Unity TCP bridge on port 49382 was unavailable.

No PASS claim is made for the full R0 gate.
