# Lens Audit Methodology — feature depth vs the category leaders

**Purpose.** Concord is ~259 app-shaped lenses on one substrate. Their feature
depth vs the category leaders is **highly variable, and the docs don't tell you
which is which** — you have to read code. This is the repeatable, code-first way
to find (a) which lenses genuinely rival their competitor (latent value to
surface) and (b) where a lens is *oversold* (UI that doesn't deliver — fixable
defects). It is the lens-level sibling of the depth-test multiplier.

**The finding that motivated it (all verified in code, 2026-06-03):**
- `accounting` ≈ **QuickBooks-core parity** — real double-entry, all 3 financial
  statements, bank reconciliation, payroll w/ withholding, multi-currency w/ live
  FX, IRS-format e-file. Genuinely competitive, and *under*-sold.
- `code` **beats VS Code** on CRDT-multiplayer, git richness, and an LLM multi-file
  agent; **loses** on real LSP / step-debugger / PTY / extensions. Deep but
  *different*, not a lite clone.
- `music` is a **facade with real oversell**: EQ/crossfade were stored but never
  applied to the audio graph; downloads faked a byte-size. (Fixed — see case study.)

So: do NOT assume "shallow vs specialists." Some lenses are at parity; some are
facades. Audit, don't guess.

## Two layers

### Layer 1 — deterministic scorecard (cheap, covers ALL lenses) — `npm run lens:audit`
`scripts/lens-audit.mjs` reads only code-grounded sources and writes
`audit/lens-audit.json` + a ranked table. Per lens it reports:
- **rival** (from `scripts/lens-rivals.json` — hand-maintained; see below),
- **macros** + **substantive** (production+utility+functional = real feature code)
  vs **stub** (placeholder), from `audit/macro-depth-honest.json`,
- **behaviorallyTested** (production+utility — the honest test-depth, for reference),
- **frontendFiles** (UI under `app/lenses/<lens>/` + `components/<lens>/`),
- a **band**: `parity-candidate` (≥60 substantive + ≥3 FE files) · `deep` · `moderate`
  · `thin` (mostly stub) · `facade-risk` (UI but thin backend, or backend but no UI).

Use it to TRIAGE: confirm/showcase the `parity-candidate`s, fix the `facade-risk`s,
ignore the long `thin` tail (small lenses, correctly small).

**Honest limitation (don't hide it):** the scorecard catches "backend deep / no UI"
and "UI / no backend" facades, but NOT the **music-style facade** — where both exist
yet the frontend never *applies* the backend output (the EQ-stored-but-unwired
pattern). The macro `eq-set` is substantive; the gap is in the wiring. That needs
Layer 2 (or a dedicated wiring detector). The scorecard triages; it does not certify.

### Layer 2 — LLM feature-parity deep-dive (expensive, per-lens, on demand)
For a chosen lens (prioritized by Layer 1), run an Explore agent with this template:

> Give an HONEST, code-grounded feature comparison of Concord's `<lens>` lens vs
> `<rival>`. **Read the actual code, not docs.**
> 1. BACKEND: read `server/domains/<lens>.js`. Enumerate feature areas; for EACH,
>    judge REAL implementation vs thin stub (quote 4–5 representative handler
>    bodies). Note anything gated on network egress.
> 2. FRONTEND: read `concord-frontend/app/lenses/<lens>/page.tsx` + its
>    `components/<lens>/*` (incl. the rival-shape shell). How deep is the UI?
>    Crucially: does the frontend actually CALL/APPLY the backend (not just store
>    settings)? — that's where facades hide.
> 3. COMPARE to `<rival>`'s CORE feature set. For each: present (cite `file:line`),
>    present-but-shallow, or absent.
> Be brutally specific — distinguish "macro/component exists" from "it actually does
> the thing." FLAG oversold features as fixable defects. Verdict on real depth.

### The honesty rules (carried from the depth multiplier)
- Distinguish **"exists"** from **"does it correctly."** A macro/component being
  present is not the feature working.
- **Flag oversell as a fixable defect**, never rubber-stamp (the music EQ-theater /
  faked-download pattern is the canonical example).
- Cite `file:line`. **Trust code over docs**, including CLAUDE.md.

## Runbook loop
```
npm run grade-macros:honest          # refresh the depth data the scorecard reads
npm run lens:audit                    # all-lens scorecard → audit/lens-audit.json
npm run lens:audit -- --band facade-risk    # the ones to fix first
#   → pick a lens; run the Layer-2 Explore deep-dive (template above)
#   → log defects; fix the oversold ones; surface the parity-candidates
#   → re-run lens:audit
```

## The lens→rival map
`scripts/lens-rivals.json`. There is **no structured `rival` field** in the
manifests — it lives in prose (empty-state captions) + the rival-shape shell names
(`VSCodeShell`, `WalletShell`, `KPIStrip`, …) in `concord-frontend/lib/lenses/manifest.ts`.
The map is seeded for the well-known lenses; `null` = unmapped. Extend it as you
audit — add `"<lens>": "<rival>"`.

## Worked case study — `music` (the first audit + fix, 2026-06-03)
- **Found:** EQ/crossfade/normalize settings stored server-side but `player.ts`'s
  audio graph was `source → analyser → out` — no EQ/gain nodes, so the sliders did
  nothing. `download-add` reported `sizeKb: durationSec*16` as if audio was stored.
  Karaoke vocal-cancel was a pref with no DSP. CLAUDE.md claimed an audio graph that
  didn't exist.
- **Fixed:** real 3-band BiquadFilter EQ + preamp gain wired into `player.ts`
  (`applyAudioSettings()`); `MusicParityPanel` applies it so sliders reach the sound;
  download de-faked to an honest offline metadata queue (`bytesStored:false`);
  CLAUDE.md corrected. **Flagged, not faked:** karaoke center-cancel + true
  track-to-track crossfade (needs a 2nd audio element); audible output needs device QA.
- **Lesson:** the scorecard rated `music` `parity-candidate` (deep both sides) — the
  facade was in the *wiring*, which only Layer 2 caught. Always deep-dive a
  parity-candidate before claiming it competes.
