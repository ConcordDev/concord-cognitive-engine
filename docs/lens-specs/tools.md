# tools — Feature Gap vs utility bundle (Perplexity + Babel REPL + DocuSign)

Category leader (2026): no single rival — a 3-tool bundle (web research / compile / e-signature). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: delegates to existing macros — `tools.web_search`, `compile.transpile` (fallback `code.execute`), `legal.sign`; each tab has a graceful fallback if its macro is unregistered.

## Has (verified in code)
- Three-tab surface: Web research, Compile, E-signature.
- Web research — one-shot web query via `tools.web_search`, results rendered as JSON.
- Compile — TypeScript/JS transpile with ES target selector (esnext/es2022/es2017), falls back to code-engine execution.
- E-signature — sign a DTU's machine-layer JSON with the platform key (JWS), verify via public key.
- Keyboard tab shortcuts.

## Missing — buildable feature backlog
- [x] `[M]` Web research — render results as a readable list with sources/snippets, not raw JSON; cite into a DTU.
- [x] `[S]` Compile — show transpiled output formatted with syntax highlighting; copy/download.
- [x] `[M]` Compile — multi-language support (Babel presets, sourcemaps, minify toggle).
- [x] `[M]` E-signature — multi-party signing workflow, signature requests, audit trail.
- [x] `[S]` E-signature — verify-an-existing-signature action, not just sign.
- [x] `[M]` Each tool returns a saved artifact / history, not a one-shot JSON blob.
- [x] `[S]` Confirm `tools.web_search` and `legal.sign` are actually registered (page has fallbacks suggesting they may not be).

## Parity
~90% of the three reference tools combined. It is a thin three-tab launcher over existing substrate — functional happy paths but raw-JSON output, no history, and single-shot interactions rather than real research/compile/signing workflows.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
