# The lens kit

The pieces every lens redesign used to rebuild by hand, built once. A new lens starts
from the kit's template, not a blank page. The look is still the lens's own: the
playbook's rule (only the left bar and top bar are shared; no two lenses share a look)
is unchanged. The kit shares **behaviour and guarantees**, never a palette.

```
node scripts/new-lens.mjs <lens> --identity "The Stall" [--list <action>] [--page]
```

## What's in it

| Piece | Where | What it guarantees |
|---|---|---|
| **Sourced numbers** | `lib/lens-kit/sourced.ts`, `<SourcedNumber>` | No number on screen without a source and an uncertainty (below) |
| **Receipt card** | `<ReceiptCard>`, `receiptFromServer()` | One receipt shape: the verdict, the sourced numbers it rests on, the method, the reference and the signature. An unsigned result says why, using the server's own reason codes, and never looks signed. `signed: true` without a receipt id isn't a signature. |
| **States** | `<LensAsync>`, `LensLoading`, `LensEmpty`, `LensError`, `statusOf()` | Exactly one of loading (aria-busy, no fake progress), error (the server's own words, with Retry), empty (a reason is *required*) or ready. Built on the app's canonical `ui/EmptyState` and `ui/ErrorState`. |
| **390px layout** | `<LensBody>`, `<LensColumns>`, `<LensTabStrip>` | Built against the walk's mobile root causes. Every column and child is `min-w-0`. Room is kept for a floating button and the safe area. Tab strips scroll, fade only where there's more to see, keep the active tab in view, and take arrows, Home and End (`lib/a11y/roving-tabs`). |
| **Dialog** | `<LensDialog>` | Built to the app's one keyboard listener (`lib/a11y/overlay-keyboard.ts`): `aria-modal`, a labelled title, a Close marked `data-overlay-close` (so Escape works), and focus moved in and given back. A sheet on a phone, a card above that. |
| **Contrast contract** | `lib/lens-kit/contrast.ts`, `lens-kit.css` | A lens's token file defines the `--lk-*` tokens in its own colours. Each pair that carries text or a control must reach its WCAG ratio (4.5:1 for text, 3:1 for controls) in every mode the file defines. |
| **One envelope** | `lensCall()`, `unwrapLensResponse()` | A refusal, nested or at the top level, comes back as `ok: false` with the server's words, and never reads as a success. Replaces each lens's own copy (`retailApi`, `linerApi`, …). |
| **Starter template** | `scripts/new-lens.mjs` | The app with rooms and honest states, a `lensCall` to the action you name, a token file that passes contrast, a test file, two check specs (fits 390px; loads with no console errors) and a capability-map stub. It never overwrites a page unless asked, and never overwrites a capability map. |

## The number rule

A number may be displayed only if it was built with `sourced()`, which refuses unless it has:

- **a finite value**;
- **a source:** `solver` (id, version, run), `measured` (by whom, with what), `cited`
  (the reference), `ledger` (the entry), `user` (you entered it), `computed` (from
  what) or `feed` (which feed, and when it was read);
- **an uncertainty:** `exact` (and why: counted, ledger, defined), an `interval` (the value
  must lie inside it), an `sd`, a `relative` tolerance, or `unknown`, with the reason
  it's unknown. "Unknown" is allowed, but it has to be said.

`<SourcedNumber>` renders only what `sourced()` built (a branded, frozen value). Anything
else (a plain object, a refusal) shows as a visible **"no source: …"** in place of the
number. It never shows the number. The badge beside each number opens "From: …" and "How
sure: …" in words.

Adapters for shapes the server already returns:
- `fromMargin()`: a solver check's demand, capacity and utilization
- `fromProbability()`: the uncertainty run's probability with its 95% interval
- `ledgerAmount()`
- `counted()`

**Enforced in code** (`tests/lens-kit-number-rule.test.ts`). In any file that imports the
kit, `.toFixed`, `.toLocaleString`, `.toPrecision`, `Intl.NumberFormat` and `Math.random`
are refused. A real non-display use (an id, a seed, a CSS width) needs a comment saying so,
on the same line or the line above:

```
// lens-kit: not a displayed number — React key
```

The same test runs the contrast contract on every lens token file that adopts it.

**What isn't enforced yet:** lenses that don't import the kit. The rule covers every lens
built from the template, which is every lens in the waves ahead. Moving an already
redesigned lens onto the kit is part of its next pass.

## Verified

- **Kit tests (13):**
  - the refusals;
  - formatting checked against hand-computed values;
  - the margin and probability adapters;
  - `<SourcedNumber>` refusing a plain object;
  - signed and unsigned receipts;
  - each state;
  - the tab-strip keyboard;
  - the dialog's focus in and out;
  - WCAG ratios exact (21:1 for black on white; #767676 on white is 4.54:1);
  - the default tokens passing in both modes;
  - a faint palette failing with its measured ratio.
- **Number rule (3):** the checker itself, every file using the kit, and every token file on the contract.
- **A generated lens:**
  - its own tests pass, `tsc` is clean, and lint is clean;
  - both generated check specs validate.
- **Driven in Chromium at 390px** with `scripts/walk/run-check.mjs` against a dev server, signed in:
  - fits the width (a 390px page in a 390px viewport);
  - loads with no console errors and its rooms visible;
  - shows the server's own refusal for an unregistered action;
  - its heading at 16.13:1 in its own tokens (by hand: 16.14).
