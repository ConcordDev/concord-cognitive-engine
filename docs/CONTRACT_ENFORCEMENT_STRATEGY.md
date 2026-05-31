# Contract Enforcement Strategy

**Why this exists.** The macro bus wires ~9,300 macros through untyped
`(domain, name)` strings, and the monolith routes everything through string
table/column names and positional args. Those boundaries drift silently. Two
adversarial playtest sessions ("Vael's Expedition" I & II) found ~60 real bugs
that 1,056 green unit tests never saw — because **unit tests mock the glue, and
the glue is where the bug mass lives** in a system that is mostly glue.

**Thesis (from the Q3 discussion):** adversarial agent for *discovery*; cheap
ratcheted gates at the chokepoints for *prevention*. Each gate retires a whole
drift *class* the agent found, so the finding can't re-accrue without re-running
the agent. We stay lightweight — a typed registry / codegen would fight the
"monolith for IP protection" grain. The gates live at three chokepoints.

---

## The four drift classes (and the cheapest catch for each)

| Class | Playtest examples | Catch |
|---|---|---|
| **arg-shape** | `runMacro(ctx,"dtu","cluster",…)` — object as `domain` (#19/#20/#15) | **Gate A** — one string check at the dispatcher |
| **macro-id** | dead/never-imported (#2), async-race un-dispatched (#11), dup-shadow (#17) | **Gate B** — steady-state registry validator at boot |
| **column** | query refs a column the live table lacks (#30, #R9–#R35 — ~26 bugs) | **Gate C** — schema-vs-query static scanner |
| **param-key** | `speciesId` vs `species_id`, `world` vs `worldId` (#6/#31) | **Gate D** — opt-in per-macro param schema (future) |

---

## Gate A — arg-shape guard ✅ SHIPPED

`server/lib/macro-contract.js#checkMacroArgs(domain, name)` wired at the top of
`runMacro` (`server.js`). The signature is `(domain, name, input, ctx)`; the #1
recurring bug passes `ctx` first, so an object lands as `domain` and gets
dispatched/JSON-walked as garbage (this is what broke DTU self-consolidation,
#19/#20, and threw the circular-JSON #15). The guard fails **loud in dev**
(throws — surfaces the bug in any test that hits it) and returns a **clean
structured error in prod**. One assertion at one chokepoint retires the class.
Test: `tests/macro-contract.test.js`.

## Gate B — steady-state registry validator ✅ SHIPPED

`server/lib/macro-contract.js#validateRegistry(MACROS)` runs **after** the
ghost-fleet async registration completes (chained onto `initGhostFleet().then()`
in `server.js`). It checks structural drift (non-string keys, empty domains,
non-function handlers) AND **reachability**: every domain in `EXPECTED_BUS_DOMAINS`
must be present with ≥1 dispatchable macro. A regression that silently
un-registers `minigames`/`agents`/`quest`/… (the #2 never-imported or #11
async-race classes) is logged loudly at boot — `macro-contract: steady-state
registry violations` — instead of surfacing to a player as a masked "LLM
unavailable". Ratchet `EXPECTED_BUS_DOMAINS` UP as more domains are confirmed
load-bearing. Test: `tests/macro-contract.test.js`.

## Gate C — schema-vs-query gate ✅ SHIPPED (highest bug-yield)

`scripts/audit/gates/schema-drift.mjs`. The playtester's prescribed gate, built:
*"prepare() every statement against the live schema."* It turns the
~80–180-bug *estimate* into an **exact CI count** and covers BOTH the column-drift
(round-2) and ghost-table (round-3) classes in one pass.

1. **Builds the live schema in memory**: runs every migration's `up(db)` on an
   in-memory `better-sqlite3` (313/313 apply), then execs every non-interpolated
   `CREATE TABLE` from production source so **lazily-created** tables exist too.
   This is what makes it trustworthy — a static SQL parse under-models
   helper-added columns (`addNpcCol(...)`) and lazy tables, which caused thousands
   of false positives in the first cut (`world_npcs ✗ level`).
2. **PRIMARY check — `db.prepare(sql)` against that schema** for every
   non-interpolated `db.prepare(\`…\`)`. SQLite's own parser surfaces *every*
   `no such table` / `no such column` site, **including JOIN / multi-table /
   subquery queries** the conservative regex skips. Errors other than
   table/column (syntax from partial extraction) are ignored → no false positives.
3. **Fallback for interpolated SQL** (can't `prepare()`): the conservative regex
   ghost-table + high-precision column checks.
4. **Honest suppressions**: `schema_migrations` (runner-created), the forge
   template generators (emit SQL for the *generated* app), and
   `creative_artifact_listings` (optional v2 probed-with-v1-fallback — the
   playtester verified + excluded it). Test-only `CREATE TABLE`s are NOT counted,
   so `user_wallets`/`city_presence` (created only in tests) stay ghosts.
5. **Ratchets**: `DEFAULT_FLOOR = 105`, deterministic, `--ci` fails on a 106th,
   writes `audit/gate-schema-drift.json`.

Result: **exactly 105 real sites frozen — 43 wrong-column + 62 ghost-table —
zero false positives.** Covers every enumerated finding from rounds 1–3 (#30,
#R9–#R35, #V2/#V3/#V4, #V5–#V32) PLUS many the conservative report scans skipped
(JOIN-bearing column refs, complex-query ghosts). The entire `no such table` /
`no such column` runtime-crash class — the user's estimated ~70% of all remaining
bugs — is now an exact, ratcheted number caught at audit time, and the next one
can't merge. Drive the floor to 0 (work queue in the playtest plan).

## Gate D — per-macro param schema 🔮 FUTURE (opt-in, additive)

A few-line optional `paramSchema` on `register(domain, name, fn, { paramSchema })`;
`runMacro` validates `input` against it and returns a clean error (catches
`species_id` vs `speciesId` #6, missing-input #21). Opt-in and per-macro, so it's
additive to the monolith — no codegen, no registry rewrite. Build after Gate C.

---

## Harden the cheapest rung — the playtester as a gate

The behavior-smoke harness (`tests/behavior/lens-behavior-smoke.behavior.js`)
already derives a test per macro, but it runs **in-process** (calls `runMacro`),
so it never exercises the `/api/lens/run` HTTP dispatcher where the LLM-fallthrough
masking lives — which is why it missed #2/#11. Two cheap upgrades:
- Route a sample of the smoke harness **through the real HTTP dispatcher** and
  assert a registered macro never returns `isFallthroughMasking(result)` and never
  `200`-with-`ok:false`.
- Promote the **adversarial-agent probe to a ratcheted boot gate**: a scripted
  pass that hits each surface with conventional params and asserts no
  `macro_uncaught_throw`, no `no such column`, no `utility-brain` mask. Its yield
  will decay as seams harden — exactly the sign it's working.

---

## The `/api/lens/run` fallthrough — allowlist, not catch-all

The AI catch-all (`server.js` `:37915`) is *intentional* ("route unregistered
domain actions to utility brain"), so don't delete it — **convert it to an
allowlist**: (a) always bound `utilityCall` with a timeout (kills the 96s hang
#27, zero semantic change); (b) a small allowlist of domains that are *meant* to
be freeform-AI; everything else fails loud with `unknown_macro` + non-200. Derive
the allowlist **empirically** from `_macroTelemetry` (which `(domain, action)`
pairs hit the fallthrough in 30 days AND aren't dead macros) rather than guessing.

---

## Status
- ✅ Gate A (arg-shape) — shipped + tested.
- ✅ Gate B (registry validator) — shipped + tested.
- ✅ Gate C (schema-drift gate) — shipped; prepare()-based, exactly 105 sites (43 column + 62 ghost) frozen, ratchet to 0.
- 🔮 Gate D (param schema), HTTP-routed smoke, telemetry-derived allowlist — queued.
