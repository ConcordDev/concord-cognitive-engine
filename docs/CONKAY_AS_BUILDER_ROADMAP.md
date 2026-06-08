# ConKay-as-Builder — Topping VS Code by Making the Agent Able to Actually *Do It*
*Strategy + roadmap · 2026-06-08 · grounded in a read-only audit of the `code` lens*

> **The thesis (one line):** *If a user asks ConKay to make something, ConKay has to actually be able
> to.* That single requirement forces every capability axis together — and it's how Concord tops VS
> Code **capability-wise** without trying to out-marketplace it. The IDE isn't the product; it's **one
> surface the agent operates.** The win is an agent that can genuinely *build* — **verifiably** — across
> the whole OS.

---

## Executive summary

- Concord's `code` lens is **category-complete already** — **81 macros** spanning every VS Code
  extension category (language intel, debug, git, files, AI, live-share), including its own
  `extensions-*` registry. The capabilities aren't missing; they're **scattered across macros.**
- The **only real gap to the frontier is the *semantic* layer** — the "understanding" macros are
  smart *lexical heuristics*, not language-server-grade. The "execution + AI" macros are genuinely real.
- Closing that gap is **wiring, not inventing**: the high-value capabilities (IntelliSense, debugging)
  are **open protocols** (LSP, DAP) you can speak to the Monaco editor you already ship.
- Topping VS Code is then **two stages**: (1) reach semantic table-stakes via LSP/DAP, then (2) the
  **overshoot VS Code structurally can't do** — because it's an editor on local files and Concord's
  code surface is a citizen of a *verifiable private OS*.
- **Non-negotiable:** "ConKay can do it" must always mean *"verifiably did it"* — built, run,
  lint-clean, and `reason.verify`-passed — never a claimed "done." That discipline is the moat.

---

## Audit ground truth (verified against code, not docs)

| Macro | Reality |
|---|---|
| `lsp-completions` | symbol + identifier **scan** (prefix filter, top 100) — real autocomplete, but **lexical, not type-aware** |
| `lsp-hover`, `symbols-outline` | `extractSymbols` lexical scan |
| `find-references` | regex `\bsymbol\b` across files — **scope-blind** (two unrelated `foo`s collide) |
| `diagnostics` | self-labeled "heuristic static analysis" |
| `debug-run` | **real** — instruments JS/TS, runs in `node:vm` with breakpoints + watch; but JS/TS-only, gated, not interactive DAP |
| `exec`, git suite, `github-pull`, `liveshare-*`, `codebase-chat` | **genuinely real** (`codebase-chat` = Cursor's `@file` context, for real) |
| `extensions-catalog/install/list/toggle/uninstall` | a real plugin-registry surface already exists |

**Read:** the "understanding" layer is heuristic; the "execution + AI" layer is real. The gap is precise
and narrow.

---

## The capability model — all four axes, unified under ConKay-as-builder

| Axis | What it gives ConKay | Substrate (mostly exists) |
|---|---|---|
| **Hands** | actually performs actions | macro registry (81 in `code`, ~9,600 total) + MCP |
| **Eyes** | understands code like the frontier | **semantic LSP** ← *the real gap* |
| **Run / debug** | executes + tests what it makes | `exec`/`debug-run` → **real DAP** |
| **No hallucinated builds** | declares "done" only when真 done | `reason.verify` + diagnostics/constraint gate |
| **Correct math** | no guessed numbers | `math.js` CAS in the loop |
| **Reach** | acts beyond the editor | cross-lens macros + MCP |
| **Self-extending** | composes new capability at runtime | Forge + `extensions-*` + macro registration |
| **Sovereign** | private / owned | local 5-brain, no telemetry |

---

## ⛔ Hard ordering constraint (non-negotiable)

**Phase 0 (the capability sandbox + abuse-prevention in `docs/CONKAY_SAFETY_MODEL.md`) GATES Phases
2–4.** No phase that lets ConKay author code that *runs untrusted*, lets *another user* install a lens,
or lets anything reach the *marketplace / global tier / social feed* may ship until the confined-ctx
sandbox, isolation, and publish-screening exist. Local/private use by the owner (Phase 1 semantic
intelligence on your own machine/data) is exempt — it's safe by design (blast radius = you). **The
floor ships before the keys. This ordering is not "optimizable away" for speed.**

### Usage red line (constitutional — see safety model)
Concord/ConKay shall not be built, licensed, or operated for **autonomous weapons, lethal targeting,
or mass surveillance** — the scaled-harm red lines. This is a deliberate market refusal (incl. defense
applications that cross it): the "Machine, not Samaritan" ethos is unsellable if the product also serves
the Samaritan use case. Treat as a governance invariant alongside the economy invariants.

## Phased roadmap

### Phase 1 — Semantic table-stakes (highest leverage; close the only real gap)
- **`server/lib/lsp-bridge.js`** — spawn a real language server (start **TypeScript** via
  `typescript-language-server`, then **Python** via `pyright`), speak LSP JSON-RPC, lifecycle-managed
  per workspace.
- Re-point the heuristic macros in **`server/domains/code.js`** to **proxy the language server**:
  `lsp-completions` / `lsp-hover` / `lsp-signature` / `find-references` / `symbols-outline` /
  `diagnostics` → thin LSP calls (type-aware, scope-correct, cross-module). Keep heuristic as fallback.
- **`components/code/MonacoWrapper.tsx`** — wire **`monaco-languageclient`** so Monaco gets real
  IntelliSense / diagnostics / go-to-def.
- `debug-run` → **real DAP** (Node `--inspect` first; `debugpy` for Python); keep `node:vm` as
  zero-setup fallback. `diagnostics` → real linters (`eslint`/`ruff`).

### Phase 2 — The ConKay build loop (the thesis, made real)
- *"make X"* → plan → call `code` macros (`files-write`, `multi-file-apply`) → **run/verify**
  (`debug-run`/`exec` + Phase-1 `diagnostics`) → **gate on `reason.verify`** → iterate → *then* report
  done.
- **Honesty invariant:** an artifact is *run + lint-clean + verify-passed* before "done." CAS-in-the-loop
  for any math.

### Phase 3 — Self-extending IDE (the structural overshoot vs `.vsix`)
- ConKay composes new macros / **Forge** apps at runtime and registers them; MCP exposes outward +
  pulls external tools in. "Extensions" = whatever the agent can compose, not a static marketplace.

### Phase 4 — OS-citizen overshoot (capability VS Code can't have)
- Code↔DTU links, cross-lens actions (code touching finance/health/world data), refactors checked
  against your invariants.

---

## First concrete step (build now)
**Phase 1 for TypeScript, end-to-end** — `lsp-bridge.js` + re-point the `code` macros + wire
`monaco-languageclient`. This flips the lens from *"looks like VS Code"* to *"is semantically as smart
as VS Code (for TS)"* — the single highest-leverage, fully-verifiable unlock, and the foundation Phase 2
stands on.

## Verification
- **LSP:** completions after `obj.` return only `obj`'s real members; `find-references` distinguishes
  two same-named bindings; hover shows inferred types.
- **DAP:** a breakpoint actually pauses; watch shows live values interactively.
- **ConKay loop:** "make a function that…" → it writes, runs, lints, verifies; the artifact is real, not
  a claimed success.
- **No regressions:** `cd server && npm test`; `cd concord-frontend && npm run type-check`.

## Honest caveats
- LSP is **per-language real work** (one server at a time); DAP needs sandbox/security care. This is a
  **multi-sprint roadmap, not a weekend.**
- **Marketplace breadth stays skipped by design** — depth in ~5 high-value categories + the agent/OS
  overshoot beats a 50k long tail you'll never match.
- "ConKay can do it" = **"verifiably did it,"** always.
- Small, unrelated cleanup from the audit: `fork` (off-by-1) + `parenting` (off-by-3) tests are real
  deterministic mismatches; the live Google Calendar connector still needs the connector-authorize
  callback + secrets.

---

> **Phase 0 — Capability Sandbox & Abuse Prevention (the gate before Phases 2-3):** before ConKay (or
> any user) can author code/lenses that run or ship, the trust boundary must exist. Full model in
> **`docs/CONKAY_SAFETY_MODEL.md`** — three boundaries (integrity / sovereignty / distribution),
> the legal hard-block list at the publish boundary, and the agentic-AI hardening (assume prompt
> injection succeeds; confine at the runtime). One-line policy: *"do anything on your own hardware
> against your own data; the moment you point it at someone else or ship it, that's the only thing we
> gate."*

*Companion docs: `docs/CONKAY_SAFETY_MODEL.md` (capability sandbox + abuse prevention — Phase 0),
`docs/SCIFI_FEASIBILITY_MAP.md` (capability vs code), `docs/MARKET_DEMAND_MAP.md` (market evidence).
This roadmap is grounded in a code-level audit of the `code` lens, not estimates.*
