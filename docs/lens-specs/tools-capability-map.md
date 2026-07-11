# Tools lens — capability map (Wave 3 verify-pass, 2026-07-11)

## What this lens actually is

A three-tool utility workspace (`app/lenses/tools/page.tsx`, 113 lines,
delegates entirely to bespoke tab components): a real web-research tool
(DuckDuckGo Instant Answer + Wikipedia OpenSearch, no API key required), a
lightweight in-browser TypeScript/JS compiler (esbuild), and a full
e-signature envelope workflow (HMAC-SHA256 tamper-evident signing,
create → sign → verify → void, with an audit trail). Plus `ToolsRepos.tsx`,
a live GitHub topic-search browser (client-side fetch to the public GitHub
search API — not a `tools.*` macro).

## Finding: already fully wired — no defect

Backend: `server/domains/tools.js` (530 LOC), exactly **12 macros**, all via
`registerLensAction`: `research`, `research-history`, `research-clear`,
`compile`, `compile-history`, `esign-create`, `esign-sign`, `esign-verify`,
`esign-verify-token`, `esign-list`, `esign-detail`, `esign-void` (confirmed
by direct grep — line count matches exactly).

Frontend: grepped every `'tools', '<macro>'` call site across
`WebResearchTool.tsx`, `CompileTool.tsx`, `ESignatureTool.tsx`, and
`page.tsx` — all 12 macros are called by the three tab components. Zero
dead backend capability, zero UI buttons calling nothing. (A stray
`'tools', 'github'` string found in `ToolsRepos.tsx` is a `extraTags` array
literal for `SaveAsDtuButton`, not a macro call — false positive, ruled out.)

No fabricated data: `tools.research` hits real external APIs; `tools.compile`
calls real `esbuild.transform` with an honest, UI-visible fallback note when
esbuild isn't installed (never a silent lie); `tools.esign-*` uses real
`crypto.createHmac`/sha256 for signatures. The only `Math.random()` in the
tree is inside a `uid()` id generator, not a render-path fabrication.

Field shapes match exactly between macro output and UI reads — checked
line-by-line for all three tools.

**Authz check (this wave's known failure pattern) — passes.** Every
`esign-*` macro scopes its lookup through a per-user `Map`
(`bucket(s.envelopes, aid(ctx))`), so a caller can never look up another
user's envelope by id, let alone void/sign/verify it. This is structurally
different from the psyops/admin/repair-telemetry/security pattern (a global
store with a missing ownership check) — there's no global store to leak
from here. Confirmed by an existing test:
`tools-domain-macros.test.js` → *"tools — per-user isolation" > "never
leaks one user's envelopes to another"*.

`tools.esign-verify-token` is intentionally stateless/unscoped — a caller
must already possess the full payload to verify against it, so it doesn't
leak anything.

The legacy `server.js:12464` `register("tools", "web_search", ...)` is a
separate, consent-gated agentic tool-calling macro, unrelated to this
lens's UI (which correctly uses the cleaner `tools.research` built for it).
Not a duplicate, not a defect.

No code changes made — this was a verify-pass.

## Verification (all run directly, 2026-07-11)

- `node --check server/domains/tools.js` — OK.
- `cd server && node --test tests/tools-domain-macros.test.js tests/tools-domain-parity.test.js` — **28/28 passing**.
- `cd server && npx eslint domains/tools.js` — clean, 0 issues.
- `cd concord-frontend && npx eslint app/lenses/tools/page.tsx components/tools/*.tsx` — clean, 0 issues.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged.
