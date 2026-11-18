# The chain-level receipt (SX-CHAIN-RECEIPT)

Founder design rule (CB-0835, 2026-11-17): **a chain run signs
ONE artifact.** Module: `server/lib/conkay/chain/receipt.js`.

## The artifact

One object per chain run, carrying:

- **Per-link receipts** — for every step that ran: the solver
  id@version and a sha256 over the canonical form of its
  `{inputs, outputs}`. A link's hash changes if anything it
  consumed or produced changes.
- **Seam contracts** — for every interface between links: the
  quantities that cross it, their units, the assumptions each
  side carries, and the envelope intersection, computed by the
  runner from the links' actual outputs. Each seam carries a
  status: `HOLDS`, `VIOLATED`, `INCOMPLETE` (a value one side
  could not produce), or `NOT_APPLICABLE` (named why).
- **Skipped steps** — optional links not declared, or a step
  blocked on an open question, recorded with their reasons. A
  receipt that hides its holes is not a receipt.
- **The chain hash** — sha256 over the ordered link hashes and
  seam statuses.

Hashing reuses the iterate loop's canonical form and sha256
(`iterate/receipt.js`), so chain and loop receipts speak the
same language.

## The signing rule (implemented, not just stated)

The artifact's `status` is:

- `SIGNED` — only when **every link computed AND every seam
  HOLDS or is NOT_APPLICABLE**;
- `SEAM_VIOLATION` — any seam violated. **A seam mismatch fails
  the chain receipt even when every link passes.** Per-link
  success is not chain success: two roll-ups that each compute
  and disagree have produced a chain that must not sign;
- `INCOMPLETE` — a link stopped (NOT_COMPUTED, named with its
  reason) or a seam could not be fully evaluated.

`verifyChainReceipt(receipt, recomputedLinks)` re-derives every
link hash from a fresh run and the artifact's own hash from its
body; any mismatch is reported by name — never a bare false.

## Why one artifact

Per-step receipts prove each step computed what it claims. They
cannot prove the steps agree with each other — that the mass
the architecture budgeted is the mass the BOM rolled up, that
the integration verdict the report carries is the verdict the
checks produced. The seams are where chains actually fail, so
the seams are inside the signed artifact.
