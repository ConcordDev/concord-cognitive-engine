# ConKay Tool-Authoring — Governed Design Spec (v0)

**Status: design only, nothing built.** This is the last greenfield item from
the V1.2 "Developer & Extensibility Surface" line of work that shipped this
session (`server/lib/plugin-sandbox.js` — worker+vm plugin isolation,
`server/lib/agent-marathon.js` — marathon governance envelope,
`server/lib/repair-remediation.js` — Repair Cortex maker-checker). The owner
was asked how to handle it and chose "design a governed spec first, not a
build," specifically because this item is qualitatively different from those
three: it expands **what ConKay can DO** (adds entries to the agent's own
tool-calling surface), not just what a static plugin or a bounded remediation
action can do. Every recommendation below is grounded in code actually read
this session — file:line citations throughout, no invented mechanisms where a
real one already exists.

## 0. The precise risk this design is about (read this before the sections below)

A user can, **today, with zero approval gate**, run arbitrary composed logic:
`POST /api/lens/run { domain:"code", action:"dsl", params:{ program, manifest } }`
executes any Concord DSL program the caller supplies, confined by whatever
capability manifest the caller passes in the same call
(`server/domains/code.js:2514-2530`, registered via `registerLensAction` —
see §3 below for exactly how that confinement works). That is not a new risk
this spec introduces or needs to gate — it is already live, self-limited (the
caller can only grant themselves capabilities they already had), and outside
this spec's scope.

**What genuinely changes with "tool-authoring"** is narrower and sharper: a
human names, saves, and (this is the new part) makes a piece of composed
logic something **ConKay's own agent loop can choose to invoke on its own
initiative** in a *later* turn or an unattended marathon tick — without the
human re-supplying or re-reading the source at the moment it runs. That is
the action-space expansion the owner flagged as higher-stakes than plugin
sandboxing (a plugin's code is static and human-reviewed once at load time;
an authored *tool* is a standing capability the agent can reach for
repeatedly, unattended, indefinitely). This spec's approval gate (§2) is
keyed specifically on that transition — from "a human ran this once" to
"ConKay can run this whenever it decides to" — not on composition vs. raw
code, which is a separate axis (§1).

## 1. Capability declaration format

**Recommendation: composition-first. A large class of useful ConKay tools
needs no raw executable code at all — only raw-code tools should touch
`plugin-sandbox.js`, and even those never get a second isolation mechanism.**

### 1a. What already exists and should be reused, not reinvented

Three real primitives already solve most of "what does a creator author":

- **`server/lib/dsl.js`** (ConKay-as-Builder Phase 7) — a small language
  (`let`, `if`, object/array literals, `domain.macro({...})` calls) that
  tree-walks to `runMacro` calls (`execute()`, `dsl.js:144-201`). It already
  enforces a call budget (`maxCalls`, default 100, `dsl.js:170`) and halts the
  whole program the instant one macro call is denied or fails
  (`dsl.js:175-179`) — a DSL program cannot partially succeed past a refusal.
  `runDsl()` (`dsl.js:208-218`) never throws; it returns a structured
  `{ok, result, trace, error}` envelope.
- **`server/lib/notebook.js`** (migration `384_cross_domain_notebooks.js`) —
  the cross-domain macro-composition-as-a-record pattern: a "cell" is a real
  `(domain, action, input)` macro call plus its real recorded output
  (`notebook.js:221-241`), with a `replayCell` primitive that re-invokes the
  exact same call and does an honest canonical-JSON diff against the
  original (`notebook.js:318-373`) — this is the right shape for "an authored
  tool is a **named, saved sequence of macro calls**," and its honesty
  discipline (never fabricate a match, never guess a DTU id — `extractDtuId`,
  `notebook.js:123-136`) is exactly the discipline a tool-authoring registry
  needs.
- **`server/lib/confined-ctx.js`** (Phase 2 — "the safety foundation that
  gates the ConKay build loop," per its own header) — the capability
  confinement every composition-based path above already runs through
  (`makeConfinedCtx`, `confined-ctx.js:75-149`). Two backstops matter here
  and hold **regardless of what manifest a tool declares**:
  - `AGENT_FORBIDDEN_DOMAINS = ["code", "repair", "admin", "config",
    "system", "detectors", "migrations"]` (`server/lib/agent-guardrails.js:47-49`)
    — a confined program can never reach these domains, full stop
    (`confined-ctx.js:99-101`, `FORBIDDEN.has(d) || !isAgentDomainAllowed(d)`).
    This means a DSL-authored tool structurally cannot call `code.build` or
    `code.dsl` itself — no recursive self-authoring, no privilege escalation
    into the very domain that runs code.
  - `NEVER_ALLOW = ["economy.mint", "economy.withdraw", "economy.transfer",
    "admin.*", "config.*"]` (`confined-ctx.js:26-33`) — hard-denied
    regardless of manifest.

  A DSL program is therefore **already a safe, general-purpose composition
  substrate** — no new sandbox is needed for "declare a tool as a sequence of
  already-vetted macro calls."

### 1b. What genuinely needs raw code, and where it must run

Some tools legitimately need imperative logic no macro composition
expresses cleanly (custom parsing, a bespoke transform over a tool's own
prior output, non-trivial control flow beyond the DSL's `let`/`if`). For
**that** narrow class only:

- The code MUST execute inside `server/lib/plugin-sandbox.js`'s
  `PluginSandbox` — the real worker_threads + `vm.SourceTextModule`
  isolation this session built (three stacked layers: a separate V8 isolate
  with `resourceLimits` + a hard `worker.terminate()` kill switch;
  `--experimental-permission` with zero `--allow-*` flags; a `vm` context
  created with `codeGeneration: { strings: false, wasm: false }` that
  structurally cannot compile `eval`/`new Function` at all —
  `plugin-sandbox.js:1-70`).
- The bridge into that sandbox MUST be `bridgeFromHostCtx(hostCtx)`
  (`plugin-sandbox.js:227-241`), fed a `hostCtx` built by the SAME
  `makeConfinedCtx(...)` call every composition-based tool uses
  (`server/plugins/loader.js:223`, `loadPluginFromSource`'s comment: "the
  host ctx already carries the FULL existing confinement... the sandbox
  reuses it verbatim rather than re-implementing (and risking divergence
  from) that policy" — `loader.js:218-222`). An authored tool's raw-code
  variant inherits this verbatim; it does not get a bespoke ctx shape.
- **Do not build a second `eval`/`vm`/`new Function` path anywhere in the
  tool-authoring stack.** `plugin-sandbox.js` is the one hardened isolation
  primitive this codebase has for untrusted executable text; every future
  consumer of "run some code a non-operator wrote" routes through it.

### 1c. The declared shape

An authored tool, regardless of `kind`, is one record:

```
{
  id, ownerUserId, ownerType: 'user'|'org', ownerOrgId?,
  name, description,
  inputSchema,            // JSON-schema-lite: {type, properties, required} —
                           // validated at invocation time before dispatch,
                           // same shape discipline as the existing TOOL_SCHEMA_BLOCK
                           // param docs in chat-agent.js:35-56 (informal today;
                           // this is where a real schema first appears)
  kind: 'dsl'|'sandboxed_code',
  source,                  // DSL program text OR plugin-shaped ESM source
  manifest,                // capability grants — SAME shape confined-ctx.js
                           // already accepts: ["domain.*", "domain.action"]
  status,                  // see §2
  ...governance columns (see §7)
}
```

`manifest` is declared **once, at authoring time**, and is never
caller-overridable at invocation time (see §3 — this is the one place this
design *diverges* from today's `code.dsl` macro, which trusts a
caller-supplied manifest on every call; an approved tool's manifest must be
fixed, or the approval gate approves nothing real).

## 2. Approval/review gate

### 2a. Shape: mirror repair-remediation.js's state machine, diverge on persistence

`server/lib/repair-remediation.js` is the closest real template: propose
(driven by real detector output, never fabricated — `listCandidates`,
`repair-remediation.js:74-95`) → approve (`approve`, :126-136, authorizes but
never runs anything) → reject (:139-150) → apply (:162-184, the only
function with a real side effect, stamping the real result — never a
fabricated success). Tool-authoring keeps this four-state shape:
`proposed → approved|rejected`, then `approved` tools are **invoked**
(analogous to `apply`, but repeatable, not one-shot) until `revoked` (§4).

**One deliberate divergence:** `repair-remediation.js`'s queue is an
in-memory `Map` (`_queue`, `repair-remediation.js:36`) — correct for its
scope, because a restart harmlessly re-derives the queue from the live
detector sweep (`listCandidates` reads `globalThis.__CONCORD_DETECTORS__`
fresh every time). An authored tool is not re-derivable from anything —
it's the one and only copy of a human's authored capability, invoked
repeatedly, indefinitely, across restarts. **This state machine must be
DB-backed** (see §7's migration), not in-memory, or a restart silently
erases every pending review and every approved tool's ability to be looked
up by name.

### 2b. The self-approval conflict-of-interest, and the risk-tier fix

The task correctly flags this: the author approving their own tool is a
real hole. But per §0, the risk that actually matters is **autonomous
invocability**, not existence. So the gate is tiered by what the approval
actually grants:

- **Tier 0 — manual-only, self-scoped.** A tool that stays `proposed` (or a
  lighter `draft` sub-state) is fully inert to ConKay's own agent loop — it
  is not listed in that user's effective tool set. The author can still
  test-invoke it directly (a distinct, explicit "try my draft" action, not
  the agent loop's autonomous tool-call path) — this is no more dangerous
  than what `code.dsl` already permits any user today (§0), so it needs no
  human-other-than-author gate.
- **Tier 1 — approved for autonomous use, self-scoped.** Moving a tool from
  `proposed` to `approved` is what makes it reachable by ConKay's own
  tool-calling loop (via `run_authored_tool`, §7) in that same user's future
  turns and marathon sessions. **This requires the SAME 4-gate static
  validator** (`server/plugins/validator.js` — shape / namespace /
  prohibited-patterns / dependency-check, `validator.js:1-27`) to run and
  pass BEFORE a human even sees the proposal, exactly as
  `loadPluginFromSource` already runs it as "layer 1" before spinning up a
  worker (`loader.js:201-214`) and "layer 2" again against the reflected
  shape (`loader.js:241-263`). The static-gate verdict is stamped onto the
  proposal row and shown to the reviewer — never silently skipped. For a
  tool an author approves for themselves, this static pass +
  (self-)acknowledgment is the acceptable bar, matching the existing trust
  boundary: the author already had raw `code.dsl` access to run this exact
  logic manually; the gate's job here is making the STATIC gates run, and
  making the "I am now trusting this to run without me watching" moment
  explicit and logged — not manufacturing a second human out of nothing.
- **Tier 2 — shared beyond the author (org-scoped or, later, marketplace).**
  The moment a tool's `ownerType` is `'org'` or it is installed for another
  user, self-approval by the original author is no longer sufficient — a
  DIFFERENT reviewer is required (an org officer other than the author, or
  an admin). This reuses the existing org role-predicate pattern from
  `world-organizations.js` (per CLAUDE.md's Belonging-sprint invariant:
  "Role gating in the new lib uses caller-supplied predicates (`isMember`,
  `isOfficer`, `isLeader`)") rather than inventing new reviewer roles.

### 2c. Optional pre-filter, not a replacement for human review

`server/lib/maker-checker.js` is a DIFFERENT existing pattern worth naming
so it isn't confused with the above: it's an **agent-proposes /
deterministic-council-verifies** loop (`runMakerChecker`,
`maker-checker.js:66+`, checked by the five-voice shadow council,
`councilChecker`) — fully automated, no human in the loop at all. It would
be a reasonable **pre-filter** ahead of Tier 1/2 human review (run the
shadow council over a tool's stated purpose + manifest before a human even
looks at it, the same way the static validator runs before human review),
but it must never SUBSTITUTE for the human approval step this spec
requires — it's a checker of proposal quality, not an authorizer of new
standing agent capability.

## 3. Sandboxing tie-in

At invocation time (an approved, non-revoked tool being called, either by a
human explicitly or by ConKay's own agent loop autonomously):

1. Build a `makeConfinedCtx` from the tool's **own stored `manifest`**
   (`confined-ctx.js:75`), never from anything the current caller supplies.
   This is the one point where authored-tool dispatch must NOT copy
   `code.dsl`'s existing behavior (`code.js:2523`, `const grants =
   Array.isArray(params.manifest) ? params.manifest : ...` — caller-supplied
   per call) — if invocation could accept a fresh manifest from ConKay's own
   tool-call arguments, the approval gate would be approving nothing, since
   the effective capability set would be whatever the live call declared.
2. Dispatch by `kind`:
   - `dsl` → `runDsl(tool.source, { runMacro: confined.runMacro })`
     (`dsl.js:208`), same as `code.dsl`'s existing execution path
     (`code.js:2525`) but with the fixed manifest from step 1.
   - `sandboxed_code` → a `PluginSandbox` constructed exactly as
     `loadPluginFromSource` does (`loader.js:225-231`): `bridge:
     bridgeFromHostCtx(hostCtx)` where `hostCtx =
     buildSandboxedContext(STATE, toolId, { runMacro, manifest: {macros:
     tool.manifest} })` (`loader.js:439-526` — the SAME function plugins
     use, inheriting the SAME capability-manifest-plus-forbidden-domain
     confinement, not a parallel one). Load once, call, tear down (or keep
     warm per the existing `PluginSandbox` lifecycle) — same timeouts
     (`PLUGIN_SANDBOX_CALL_TIMEOUT_MS`, `plugin-sandbox.js:77`).
3. Both paths inherit `confined-ctx.js`'s per-actor rate limiter
   (`makeActorActionCap`, `agent-guardrails.js:141-161`, keyed by the acting
   `userId`) automatically — no separate rate-limit policy to invent.

This is the whole point of §1's recommendation: there is exactly ONE
confinement policy (`confined-ctx.js` + its `AGENT_FORBIDDEN_DOMAINS`/
`NEVER_ALLOW` backstops) and exactly ONE code-isolation primitive
(`plugin-sandbox.js`) in this codebase; authored-tool invocation is a new
CALLER of both, never a new implementation of either.

## 4. Revocation

Add `revoked_at` / `revoke_reason` columns to the authored-tool row — the
exact shape migration `344_license_revocation.js` already added to
`creative_usage_licenses` (`migrations/344_license_revocation.js:11-13`).
Who can revoke: the author always; an org officer/admin for an org-scoped
tool; and — per CLAUDE.md's zero-demo-content / honest-by-construction
invariants — an automated detector finding that a tool systematically
violates its declared intent should also be able to flag it for revocation
(never auto-revoke silently; flag → queue → the same human-review gate as
§2, framed as a proposed revocation, not a fabricated automatic one).

**Enforcement must mirror `agent-marathon.js#createToolGate`'s
freshness discipline exactly**: that gate re-reads `revoked_at` from the DB
on **every single tool dispatch**, not once at session start
(`agent-marathon.js:212-218`, "Revocation always wins... so a revoke landing
mid-tick... stops the very next tool dispatch, not just the next tick"). An
authored tool's invocation path must do the same: check `revoked_at` fresh
immediately before every dispatch, never cache the approved/revoked
verdict across calls within a session.

**In-flight interaction:** a marathon session (`agent-marathon.js`) or an
ordinary `runAgentLoop` (`chat-agent.js:359`) turn currently mid-flight when
a tool is revoked must see the SAME two-tier refusal contract
`createToolGate` already defines (`agent-marathon.js:184-192`):
`{ok:false, halt:false, reason:'tool_revoked:<toolId>'}` — refuse just this
one call, the marathon/conversation keeps running and the brain sees an
honest, actionable refusal — never `halt:true` (a revoked tool is not a
governance-budget/session-level event; it's a per-call capability check,
same class as `domain_not_allowed` in `agent-marathon.js:228-232`, not same
class as `revoked`/`budget_exhausted` which legitimately halt the whole
tick). This is a deliberate, careful distinction: `agent-marathon.js`'s own
`revoked_at` halts the WHOLE session (the human pulled the whole marathon's
plug); a single revoked TOOL should not — the marathon may have other tools
it can still legitimately use.

## 5. Per-user / per-org scoping

Default: **private to the creator** (`ownerType:'user'`, `ownerOrgId:null`).
No sharing without an explicit act.

For org sharing, reuse the exact minimal-widening pattern migration
`381_creative_license_org_scope.js` already used for institutional
licensing: add `owner_type TEXT NOT NULL DEFAULT 'user' CHECK (owner_type IN
('user','org'))` + `owner_org_id TEXT` to the authored-tool table, mirroring
`creative_usage_licenses.licensee_type`/`licensee_org_id`
(`migrations/381_creative_license_org_scope.js:1-27` — "an officer's
personal wallet pays for a purchase, but the license grant attaches to the
org... no new billing/subscription system invented"). The equivalent
framing here: an officer authors/approves a tool on behalf of the org, and
the resulting **capability** grant attaches to the org (every member's
ConKay can invoke it, subject to the manifest), but there is still exactly
one author of record and exactly one approval event — no new
"organizational agent" concept, no new billing surface. `world-organizations.js`'s
existing in-memory `isOfficer`/`isLeader` predicates gate who can author/
approve on the org's behalf (§2's Tier 2), never a new role system.

This explicitly does NOT attempt a cross-org or public marketplace grant —
see §6.

## 6. Honest scope / non-goals

This design does **not** attempt, and a future reader should not assume it
decided:

- **A cross-user tool marketplace or discovery surface.** Org-scoped
  sharing (§5) is the only sharing primitive this spec defines. Browsing/
  installing another org's or another user's authored tool is a separate,
  larger item (parallel to `server/lib/forge-marketplace.js`'s existing
  DTU-marketplace pattern, which this spec deliberately does not extend).
- **A tool "SDK" with versioning/compatibility guarantees.** An approved
  tool's `source`/`manifest` are immutable once approved (§2's "the manifest
  is fixed at approval time" already implies this) — there is no "publish
  v2, keep v1 working for existing installs" story here. Editing an
  approved tool's source/manifest should require a fresh proposal +
  re-approval, not an in-place mutation of a live capability.
- **Tool-calling-tool composition.** In this design, an authored tool's DSL
  body cannot itself invoke another authored tool (only the base macro
  surface `confined-ctx.js` already grants). Allowing tools to compose
  recursively is a real future capability but needs its own approval-graph
  analysis (what happens when tool A's approval is revoked but tool B, also
  approved, depends on it?) that this pass does not attempt to resolve.
- **Metering/billing for tool invocation** beyond the existing per-actor
  rate cap (`makeActorActionCap`). No new spend/budget concept — if a
  budget is wanted later, `agent-marathon.js`'s existing `budget_cap`/
  `budget_spent` columns (`agent-marathon.js:198-247`) are the nearest real
  precedent to extend, not a new billing surface.
- **ConKay authoring and self-approving its own tools.** A human always
  originates the proposal (Tier 0/1/2 in §2 all start with a human hitting
  "propose"). ConKay MAY draft the DSL/code text as a convenience — the
  existing `code.build` generate/run/lint/verify loop
  (`server/lib/build-loop.js:41-154`) is the natural drafting assist — but
  the human still reviews and submits it; this spec does not create a path
  where ConKay proposes AND approves without a human step in between, at
  any tier.

## 7. Concrete minimal first-buildable slice

If a future build unit takes the smallest safe slice of this design next,
here is exactly what it touches (real paths; migration number verified
against the tree — `ls server/migrations/[0-9]*.js` currently tops out at
`384_cross_domain_notebooks.js`, so the next number is **385**):

1. **`server/migrations/385_conkay_authored_tools.js`** — one new table,
   `conkay_authored_tools`: `id`, `owner_user_id`, `owner_type` (`'user'|'org'`
   default `'user'`, same CHECK pattern as migration 381), `owner_org_id`
   (nullable), `name`, `description`, `kind` (`'dsl'|'sandboxed_code'`),
   `source`, `manifest_json`, `input_schema_json`, `status`
   (`'proposed'|'approved'|'rejected'|'revoked'`), `static_validation_json`
   (the validator.js gate results, stamped at propose time), `proposed_at`,
   `approved_at`, `approved_by`, `rejected_at`, `rejected_by`,
   `reject_reason`, `revoked_at`, `revoke_reason`. Columns modeled directly
   on the governance-column patterns already in migrations `344`, `379`
   (agent-marathon governance envelope), and `381`.
2. **`server/lib/conkay-tool-authoring.js`** (new) — `propose(db, ownerId,
   {name, description, kind, source, manifest, inputSchema})` (runs
   `validatePlugin`-equivalent static gates from `server/plugins/validator.js`
   up front, stamps the verdict, inserts `status:'proposed'`), `listPending`,
   `approve(db, toolId, approverId)`, `reject(db, toolId, approverId,
   reason)`, `revoke(db, toolId, actorId, reason)` — same four-state
   discipline as `repair-remediation.js` but DB-backed per §2a, plus the
   Tier 1/2 approver-identity check from §2b (reject `approve()` when
   `approverId === ownerUserId` for an `owner_type:'org'` row).
3. **`server/lib/conkay-tool-invoke.js`** (new) — `invokeAuthoredTool(db,
   toolId, input, {runMacro, llm, callerId})`: loads the row, checks
   `status==='approved' && !revoked_at` (fresh read, no cache — §4), builds
   `makeConfinedCtx` from the row's OWN `manifest_json`
   (`confined-ctx.js:75`), dispatches via `runDsl` (`dsl.js:208`) or a
   `PluginSandbox` + `bridgeFromHostCtx(buildSandboxedContext(...))`
   (`plugin-sandbox.js:245`, `loader.js:439`) depending on `kind`.
4. **`server/lib/chat-agent.js`** — add one new tool entry to
   `TOOL_SCHEMA_BLOCK` (currently `chat-agent.js:35-56`): `run_authored_tool:
   Params: {"toolId": "...", "input": {...}}`, and one new `case
   "run_authored_tool":` in `executeToolCall`'s switch
   (`chat-agent.js:93-308`) that calls `invokeAuthoredTool`, scoped so a
   caller can only reach a tool where `owner_user_id === ctx.actor.userId`
   OR (`owner_type==='org'` AND the caller is a member of `owner_org_id`) —
   never reachable by guessing another user's `toolId`. **Correction to
   note for whoever builds this:** do NOT wire this through the existing
   `run_lens_action` case (`chat-agent.js:153-178`, `lensActions.get(key)`)
   — that map (`LENS_ACTIONS`) is disjoint from `MACROS` (see the
   corrections note below); a dedicated tool keeps `invokeAuthoredTool`
   free to dispatch through whichever registry a tool's composed macro
   calls actually need, without inheriting that reachability gap.
5. **`agent-marathon.js`** — extend `domainForToolCall`
   (`agent-marathon.js:159-172`) with a `case "run_authored_tool": return
   "conkay_tool";` entry (or an equivalent synthetic domain tag) so a
   marathon session's `allowed_domains_json` allowlist can explicitly
   permit/deny authored-tool use per session, reusing the existing
   governance envelope rather than adding a parallel one.
6. **Tests** — `server/tests/conkay-tool-authoring.test.js`: propose→
   approve→invoke happy path (dsl kind); self-approval rejected for an
   `owner_type:'org'` row; a forbidden-domain manifest (`"code.*"`,
   `"admin.*"`) rejected at `propose()` time via the static gate, before any
   runtime call is attempted; revocation mid-session produces a
   `halt:false` per-call refusal (not a session-level halt), pinned against
   the same contract shape `server/tests/agent-marathon-governance.test.js`
   already exercises for `createToolGate`.

Explicitly NOT in this first slice: any UI (a pending-proposals review
surface can piggyback on wherever Repair Cortex's own remediation queue is
rendered today, or ship as a bare admin/creator API first); org-officer
predicate wiring beyond a stub check; the `sandboxed_code` kind's full
`PluginSandbox` path (the `dsl` kind alone covers the large majority of
useful compositions per §1 and is the safer, simpler slice to ship first).

---

## Corrections to the task's framing, found while reading the real code

- **The chat-agent tool loop is not one unified dispatch surface — it is
  two disjoint macro registries.** The task's framing ("wherever
  `run_lens_action`/`mcp_call`/`create_dtu`/`web_search` are dispatched from
  an agent turn") reads as if there's one macro-resolution path. There
  isn't: `chat-agent.js`'s `run_lens_action` tool
  (`chat-agent.js:153-178`) resolves ONLY against `LENS_ACTIONS`
  (`lensActions.get(key)`), while `create_dtu`/`web_search`/`expert_mode`/
  `generate_image` all call `runMacro(...)` directly, which resolves ONLY
  against `MACROS` (the `register()`-populated map,
  `server.js:12094`). These are genuinely different maps populated by
  genuinely different registration functions (`register` vs.
  `registerLensAction`, `server.js:12094` and `:42012`). A third function,
  `runMcpTool` (`server.js:42039-42047`, used by the MCP server and by
  `/api/lens/run`), is the only dispatcher that checks BOTH — "prefer
  LENS_ACTIONS, then MACROS" — and it is **not** what `chat-agent.js`'s
  `run_lens_action` tool uses. Concretely: plugins register their macros
  into `MACROS` via `register` (`server.js:32021-32024`,
  `loader.js:341-345`), which means **a loaded plugin's macro is currently
  unreachable through ConKay's own `run_lens_action` tool** — only through
  `runMcpTool`-based paths (MCP clients, `/api/lens/run` directly) or a
  dedicated `runMacro`-based tool. This is exactly why §7's first slice
  gives authored tools their OWN dedicated tool type + dispatcher rather
  than routing through the existing `run_lens_action` case — riding on that
  case would silently inherit its `LENS_ACTIONS`-only blind spot.
- **The "V1.2 roadmap" and its "Developer & Extensibility Surface" section
  named in the task prompt do not exist as a committed file this session
  could locate** (`docs/NEXT_ARC_PLAN.md` and every other `docs/*.md` file
  were grepped for that heading and for "V1.2" generally — no match). This
  spec is grounded entirely in the three real, already-shipped modules
  named in the task (`plugin-sandbox.js`, `agent-marathon.js`,
  `repair-remediation.js`) plus the pre-existing ConKay-as-Builder Phase
  1/2/3/7 modules (`ts-language-service.js`, `confined-ctx.js`,
  `build-loop.js`, `dsl.js`) discovered while reading for this task — not
  in a roadmap document, since none could be verified to exist on disk.
- **A real, already-built "ConKay-as-Builder" phase series exists and is
  directly load-bearing for this design** — the task prompt did not
  mention it, but it should have: `server/lib/confined-ctx.js` (Phase 2),
  `server/lib/build-loop.js` (Phase 3), and `server/lib/dsl.js` (Phase 7)
  already implement most of "declare a governed, composed capability."
  `build-loop.js`'s own header explicitly names the gap this session's
  `plugin-sandbox.js` incidentally fills: "Phase 4's microVM is required to
  safely enable autonomous running" (`build-loop.js:18-21`) — written
  before `plugin-sandbox.js` existed, about `code.exec`'s `node:vm` path
  (still gated off by `CONCORD_CODE_EXEC_ENABLED`, `code.js:118,602`).
  `plugin-sandbox.js` is real worker+vm isolation but is wired ONLY to the
  plugin loader today, not to `code.exec`/`build-loop.js`. Whether to also
  retrofit `code.exec` to use `plugin-sandbox.js` is a real, separate,
  valuable follow-on this spec surfaces but does not resolve (it's a
  question about hardening ConKay's existing ad hoc code execution, not
  about tool-authoring specifically).
