CONCORDIA ANIMATION COVERAGE
Generated 2026-09-22T01:25:54.2987530Z
Verbs 442

locomotion      █████░░░░░░░░░░░░░░░ 23%  real 4  proc 2  reused 0  missing 20
traversal       ███░░░░░░░░░░░░░░░░░ 17%  real 3  proc 1  reused 0  missing 20
combat          ██░░░░░░░░░░░░░░░░░░ 10%  real 3  proc 6  reused 0  missing 77
firearms        ░░░░░░░░░░░░░░░░░░░░ 0%  real 0  proc 0  reused 0  missing 30
magic           ░░░░░░░░░░░░░░░░░░░░ 0%  real 0  proc 0  reused 0  missing 10
reaction        █████████░░░░░░░░░░░ 45%  real 2  proc 3  reused 0  missing 6
interaction     ░░░░░░░░░░░░░░░░░░░░ 0%  real 0  proc 0  reused 0  missing 10
work            ░░░░░░░░░░░░░░░░░░░░ 0%  real 0  proc 0  reused 0  missing 13
creatures       ░░░░░░░░░░░░░░░░░░░░ 0%  real 0  proc 0  reused 0  missing 124
boss            ░░░░░░░░░░░░░░░░░░░░ 0%  real 0  proc 0  reused 0  missing 16
hybrid          ██████░░░░░░░░░░░░░░ 29%  real 0  proc 2  reused 0  missing 5
sports          ░░░░░░░░░░░░░░░░░░░░ 0%  real 0  proc 0  reused 0  missing 4
fauna_social    ░░░░░░░░░░░░░░░░░░░░ 0%  real 0  proc 0  reused 0  missing 17
crafting        ░░░░░░░░░░░░░░░░░░░░ 0%  real 0  proc 0  reused 0  missing 6
furniture       ███░░░░░░░░░░░░░░░░░ 14%  real 0  proc 1  reused 0  missing 6
social          ░░░░░░░░░░░░░░░░░░░░ 0%  real 0  proc 0  reused 0  missing 11
daily           ░░░░░░░░░░░░░░░░░░░░ 0%  real 0  proc 0  reused 0  missing 4
archetype       ░░░░░░░░░░░░░░░░░░░░ 0%  real 0  proc 0  reused 0  missing 9
gear            ████████████████░░░░ 80%  real 0  proc 4  reused 0  missing 1
facial          ████████████████████ 100%  real 0  proc 2  reused 0  missing 0
procedural      ████████████████████ 100%  real 0  proc 3  reused 0  missing 0
vehicle         █████░░░░░░░░░░░░░░░ 25%  real 0  proc 1  reused 0  missing 3
monsters        ░░░░░░░░░░░░░░░░░░░░ 0%  real 0  proc 0  reused 0  missing 3
environment     ████████████░░░░░░░░ 60%  real 0  proc 3  reused 0  missing 2
secondary       ████████████████████ 100%  real 0  proc 5  reused 0  missing 0

HONESTY FAILURES
(none)

IMMEDIATE PRIORITY
trav.dodge            Real
trav.dodge_roll       Missing
trav.dodge_forward    Missing
trav.dodge_left       Missing
trav.dodge_right      Missing
combat.light          Real
combat.heavy          Procedural
combat.light_2        Procedural
combat.light_3        Procedural
react.hit_front       Real
react.knockdown       Procedural
combat.sword.slash    Real

PIPELINE
- Humanoid retargeting requires Avatar.isHuman && Avatar.isValid.
- UAL1 Standard is imported as Humanoid and is bound through Mecanim sub-assets.
- Grok Imagine MP4 is motion reference, never a Mecanim clip.
- Gameplay timing remains authoritative; bound UAL1 clips provide the visible motion.
