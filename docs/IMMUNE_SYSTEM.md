# Concord Immune System — Doctrine

Status: doctrine of record for the detector / repair / reflex layer. Set by the
founder's autonomy doctrine (2026-10-21) and the approval-before-patches rule
(approved 2026-11-02). This doc supersedes any earlier language — in
DETECTOR_GOVERNANCE.md, A40_BRAIN_ROUTING.md, docs/INVARIANT_ENGINE.md, or
elsewhere — that describes the repair layer as fixing, applying, or healing
code on its own authority.

## What the immune system is

Concord's immune system watches the platform the way an immune system watches
a body: it detects, it diagnoses, and it raises a response for a human to
approve. It is a detection and proposal system. It is not a self-repair system.

Its three verbs are:

- **Detect.** Detectors, the invariant engine, and the walker find and record
  what is wrong, with evidence.
- **Diagnose.** The repair cortex and the surgeon analyse a finding and work
  out what a fix would look like.
- **Propose.** A diagnosis becomes a structured proposal in the remediation
  queue — a diff, a rationale, and the finding it answers — and stops there.

## What it never does

- **Never applies.** No runtime code path writes source files, applies a
  patch, or changes configuration on the system's own cycle. A proposal
  becomes a change only through the ordinary build pipeline — a builder's
  commit, review, a pull request, and a deploy — or the founder's recorded
  approval under the approval-before-patches rule.
- **Never hot-patches or hot-swaps.** There is no supported path by which a
  running process rewrites its own code or swaps a live executor for a
  model-supplied one. (Retirement of the remaining gated apply path is
  IMM-02; macro hot-swap removal is IMM-04.)
- **Never self-grades.** No endpoint or handler marks a repair successful on
  the system's own say-so. Success is established independently: tests before
  and after, and verification by someone or something other than the fixer.
- **Never authorizes by confidence.** A model's confidence in its own
  proposal is not an authorization signal and is not recorded as one.

## The human gate

The repair problem is authority, not patch quality. Concord is proactive and
always-on, and a repair layer that can apply its own fixes can, in the limit,
repair the users — or the founder's own access — away. So the gate is
structural, not procedural:

1. Every proposed change is small, inspectable, and reversible: a diff,
   against git history, with a rollback for anything staged.
2. Tests run before and after; a failing gate discards the proposal — it
   does not lower the gate.
3. Auth, economy and payment code, migrations, tests, and the verification
   machinery itself (walker, recipes, detectors, baselines) are third-rail:
   repair proposals never touch them, and the CI guard (IMM-09) refuses a
   repair change that tries.
4. Without the founder's recorded approval, a proposal sits staged and
   nothing changes.

## Verification independence

The seat or system that fixes a thing never grades it. VERIFIED is produced
only by the walker's replay against the deployed build, or by a human
reviewer who is not the fixer. Recipes are authored and approved by
non-fixers. (The recipe registry and the fold independence gate are IMM-13
and IMM-16.)

## How the pieces map

- Detectors and the invariant engine: detection only. They report; they do
  not dispatch repair execution. (Reflex dispatch is bounded by IMM-08.)
- Repair cortex and surgeon: diagnosis and proposal only. (IMM-03, IMM-05.)
- The remediation queue: where proposals wait for a human. It is a queue,
  not an executor.
- Frontend recovery reporting: a client may report that it recovered; it may
  not mark a repair successful. (IMM-06.)
- CI and local apply scripts: writes only on a repair/* branch, never to a
  protected branch. (IMM-07.)

## Reading older docs

Where an older doc says the repair layer auto-fixes, runs unattended, or
routes a finding straight to a fix, that language is superseded by this doc.
The code-retirement tickets of the v1 Immune P0 batch (IMM-02..IMM-10) bring
the code fully onto this doctrine; until each one lands, this doc states the
governing rule and the ticket states the remaining gap.
