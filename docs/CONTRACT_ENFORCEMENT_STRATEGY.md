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

## Gate C — schema-vs-query scanner ✅ SHIPPED (highest bug-yield)

Round-2's Wave 13 proved the column-drift class is **mechanically gateable** — it
is NOT the "types can't cheaply catch this" case I first assumed.
`scripts/audit/gates/schema-drift.mjs`:

1. **Derives the REAL schema** by running every migration's `up(db)` on an
   in-memory `better-sqlite3` and `PRAGMA table_info`-ing the result (313/313
   apply cleanly). This is the playtester's actual method — and crucially it
   captures columns added via JS helpers (`addNpcCol(...)`), which a static SQL
   parse misses (that under-modelling caused thousands of false positives in the
   first cut: `world_npcs ✗ level`, etc.).
2. **Scans `db.prepare(\`…\`)` SQL** across `server/**/*.js`.
3. **High-precision shapes only** (near-zero FP): `INSERT INTO t (cols…)`,
   `UPDATE t SET col=…`, and **single-table** `SELECT/DELETE … WHERE col …` (any
   JOIN or `(SELECT …)` subquery is skipped — that's where alias ambiguity, hence
   FPs, live). String literals are stripped; interpolated columns (`SET ${c}=`)
   and the forge-template generators (they emit SQL for the *generated* app, not
   Concord's DB) are excluded.
4. **Ratchets** like `lens-reachability`: `DEFAULT_FLOOR = 49` (the measured
   pre-existing drift), `--ci` fails on a 50th, writes `audit/gate-schema-drift.json`.

Result: **49 real violations frozen** — every one of #30 + #R9–#R35 plus extras
the report didn't enumerate (`npc-gear dtus✗owner_type`, `lens-portals dtus✗domain`,
`npc-skill-author dtus✗kind/meta_json`). Zero false positives in the final set.
The whole `no such column` runtime-crash class is now caught at audit time; drive
the floor to 0 as the column refs are corrected (tracked in the playtest plan).

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
- ✅ Gate C (schema-drift scanner) — shipped; 49 real drifts frozen, ratchet to 0.
- 🔮 Gate D (param schema), HTTP-routed smoke, telemetry-derived allowlist — queued.
