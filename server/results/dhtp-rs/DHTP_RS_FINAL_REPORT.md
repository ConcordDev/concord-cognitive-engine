# DHTP-RS Final Report — DHTP-RS-MASTER-001

Generated: 2026-09-01T18:22:40.167Z
Claim level: **4** — Representation mechanism — ablations show selection/structure contribute

## Authorized claim

Concord's DHTP representation substantially reduces inference context and, in the current fleet-health benchmark, produces much higher task quality and reliability than full raw DTU context. Preliminary controls also indicate that task-directed structured representation can outperform naive same-budget representations.

## Not claimed

- universal superiority
- frontier-equivalent 2B models
- general intelligence improvement
- guaranteed hallucination reduction
- superiority across all model families
- superiority across all tasks

## Phase 2 — Task generalization

- **dhtp_packet**: 89.9% quality, ~275 tokens, 0% API fail
- **matched_budget_raw**: 87.0% quality, ~303 tokens, 0% API fail
- **random_budget_raw**: 84.9% quality, ~145 tokens, 0% API fail

### Paired deltas (DHTP minus control)

- dhtp_packet_minus_matched_budget_raw: mean Δ 2.9pp (n=120, 95% CI 1.0–4.7pp)
- dhtp_packet_minus_random_budget_raw: mean Δ 4.9pp (n=120, 95% CI 3.0–6.9pp)

## Phase 3 — Selection ablations

- **dhtp_full**: 94.8%
- **selection_only**: 95.4%
- **structure_only**: 93.1%
- **matched_budget_raw**: 93.8%
- **random_budget_raw**: 91.1%

## Agent execution state

- STEP_1_analyze_phase1: complete (rsb_c57a1d7b-6d5)
- STEP_2_phase2_generalization: complete (rsb_6055b7b1-d0e)
- STEP_3_selection_ablations: complete (rsb_a2e7e9ed-2a1)
- STEP_4_local_model_portability: complete
- STEP_5_full_raw_selective: complete (rsb_dbe4ab09-212)
- STEP_6_human_blind_validation: complete
- STEP_7_freeze_and_publish: pending

## Artifacts

- STEP_2_phase2_generalization: /Users/dutch/concord vs code/concord-cognitive-engine/server/results/dhtp-rs/rsb_6055b7b1-d0e.json
- STEP_3_selection_ablations: /Users/dutch/concord vs code/concord-cognitive-engine/server/results/dhtp-rs/rsb_a2e7e9ed-2a1.json
- STEP_5_full_raw_selective: /Users/dutch/concord vs code/concord-cognitive-engine/server/results/dhtp-rs/rsb_dbe4ab09-212_fullraw.json
- STEP_6_human_blind_validation: /Users/dutch/concord vs code/concord-cognitive-engine/server/results/dhtp-rs/human_validation_rsb_6055b7b1-d0e.json