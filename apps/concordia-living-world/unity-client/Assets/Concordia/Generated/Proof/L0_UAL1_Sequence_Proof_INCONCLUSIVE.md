# L0 UAL1 Visible Sequence Proof — Superseded

Status: SUPERSEDED BY PASS

The earlier inconclusive result was caused by two issues that are now fixed:

1. The proof camera/body sequence reached sprint with depleted `ConcordiaPlayer.stamina`, so the real `DodgeAction` rejected the queued X input.
2. The HubKit EditMode source-template issue caused order-dependent zero renderer bounds; this was fixed in `HubKit.cs` by keeping imported source hierarchies active and disabling source renderers instead.

Fresh PASS evidence:
- `Assets/Concordia/Generated/Proof/L0_UAL1_Sequence_Proof.md`
- Eight rendered beats: idle, walk, sprint, turn, stop, roll, sword, hit.
- Authored CX/Rocketbox body preserved.
- `Assets/Concordia/Anim/ConcordiaLocomotion.controller` observed in PlayMode.
