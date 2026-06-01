# The Wire-Verify-Polish Pass — how to run a quality pass on Concordia (and instruct agents to)

> Concordia's problem is never "missing code" (1.36M lines, ~68 software categories). It's the gap
> between **built** and **wired / working / polished** — the ghost-fleet macros, the schema-drift,
> the dark flags, the headless backends. So the pass is **Wire → Verify → Polish**, not "build more."
> And because *agents* do the execution, the ask must be spec-driven and self-verifying.

## 0. The reframe — Concordia's Definition of Done is WIRED, not "works on my machine"

Industry best practice: "done" = not just functional, but **tested + documented + passes quality gates +
reviewed.** For Concordia specifically, "done" must *explicitly* include the wiring dimensions that are
exactly where it fails. **A system is DONE only when:**

1. **Dispatchable** — its macros resolve in `MACROS` (not ghost-fleet → LLM fallthrough).
2. **Schema-clean** — every `db.prepare` passes against the *live* schema (no ghost table/column).
3. **Reachable** — its lens hits a live backend (not a dead/headless one).
4. **On by default** — its kill-switch defaults on (not silently dark in prod — see the killswitch audit).
5. **Smoke-proven** — the auto-derived test exercises it and asserts *no throw / no "fetch failed"*.
6. **Polished** — loading/empty/error states present, no white-screen, juice on key actions, no a11y gaps.

If any of the six is false, it's *built*, not *done*. **This DoD is the whole game** — it turns "wired ≠
works" from a recurring surprise into a checklist.

## 1. Don't hunt the work — let the tooling generate the punch-list

Concordia already has the measurement layer most teams lack. **Run it; it produces the prioritized
worklist:**
- **`npm run cartograph:static`** → headless backends, dead tables, orphan lenses, universe coverage.
  (Last run: 26 headless backends · 28 dead tables · 2 orphan lenses.)
- **`npm run detectors:report`** → the 31 detectors, including the ones *built for exactly this pass*:
  `lens-health` · `macro-usage` · `dead-event-listener` · `stale-code` · `lens-decorative-state` ·
  `http-error` · `env-config-drift` · plus the **UX-quality** detectors for the polish half
  (`ux-loading-state-missing` · `ux-form-error-display` · `ux-modal-no-escape` · `ux-route-empty-render` ·
  `ux-a11y-button-no-label` · `ux-broken-link`).
- **`npm test`** → the wiring gate (currently RED on `seedRumor` = a build-but-unwired item).

The detector/cartographer counts ARE the debt ledger. The pass is **drive those numbers to zero.**

## 2. Remediate by leverage, incrementally (fixed capacity, not a big-bang)

Best practice: prioritize critical systems, allocate fixed capacity, drain the debt over time. Concordia's
leverage order (highest ROI first):

1. **🔴 Dark flags — *today*, zero code risk.** The killswitch audit's all-on env block. Pure config;
   lights up ~26 features that were off in prod. Cheapest win on the board.
2. **🔴 Schema-drift — build L0 (the SQL-schema gate).** One gate retires the biggest crash class
   (ghost tables/columns) *and* prints the exact remaining count.
3. **🟠 Headless backends (26) — wire each to a dispatchable macro + a lens.** Drive the cartographer
   count down.
4. **🟠 Ghost-fleet dispatch + orphan lenses (2)** — make registered macros resolve; wire the 2 orphans.
5. **🟡 Polish** — the UX-detector findings to zero + the game-feel layer (juice, the
   Bethesda/HoL/ARK feel notes, hydration sites, loading/error states).
6. **🔵 Security/edge** — the adversarial findings (#P1 prompt-injection whitelist, the self-wager guard,
   `WEBHOOK_ALLOW_OPEN` stays off).

## 3. How to ASK an agent to do it (the instruction template)

Research is unanimous: agents produce quality when the ask is **spec-driven + staged (Explore → Plan →
Implement → Verify) + self-verifying**, using the **CRTSE** frame (Context, Role, Task, Standards,
Examples). Concretely, scope **one system/lens at a time** with this shape:

> **Context:** [link the system's spec doc + the detector finding that flags it.]
> **Task:** Wire `<system X>` to DONE per the 6-point DoD — make its macros dispatchable, fix its
> `db.prepare` queries against the live schema, ensure its lens reaches a live backend, default its flag
> on, add it to the auto-derived smoke, and polish its loading/empty/error/juice states.
> **Standards:** behind kill-switch `CONCORD_X`; no new deps; matches the surrounding code's idiom; the
> 6-point DoD must all be true.
> **Verify:** prove it green — `npm test` (its smoke), `cartograph` (it leaves the headless list), the
> relevant UX detector clean. Show the before/after detector counts.
> **Scope:** this system only. Verify before moving to the next.

Key agent guardrails (from the research, sharpened for your case):
- **Small, verifiable increments** — one system per change, each provably green, not a 40-system mega-PR.
- **The agent must run the verifier, not assert** — "I wired it" means nothing; "the detector count
  dropped by N and the smoke is green" means it's done.
- **Edge/adversarial included** — every wired endpoint gets the no-throw + input-validation assertion
  (this is where #P1-class bugs hide).

## 4. The quality assurance IS the gates (don't bolt on a separate QA)

The Function-Assurance L0–L5 gates *are* the quality gates — each a CI checkpoint that blocks merge:
**L0** schema · **L1** wiring/dispatch (the wiring gate exists) · **L2** auto-derived runtime smoke ·
**L3** contract math · **L4** browser/Playwright (the polish + white-screen layer) · **L5** synthetic.
The pass isn't "done" globally until the gates are green, and because they **auto-derive from the live
system**, a newly-wired system is covered the moment it exists, and a regression can't silently return.

So "how do we ensure the quality?" has a precise answer: **encode the 6-point DoD into the gates, run the
detectors as the worklist, and require every agent change to drop a detector count and pass its
auto-derived smoke.** Quality stops being a vibe and becomes *a set of numbers going to zero that can't
go back up.*

## 5. The one-paragraph operating procedure

Run `cartograph` + `detectors:report` → that's the ledger. Fix in leverage order (dark-flags → L0-schema
→ headless → orphans → polish → security). Scope each item to one system, hand it to an agent with the
CRTSE/Explore-Plan-Implement-Verify spec + the 6-point DoD + the detector that proves it, require the
agent to *show the count drop*, and let the L0–L5 gates be the merge wall. Repeat until the cartographer
shows 0 headless / 0 dead / 0 orphan and the UX detectors are clean. **That is the polish-and-wires pass,
and it's measurable, agent-friendly, and self-defending against regression.**

**Sources:** [Definition of Done & tech debt (Scrum.org)](https://www.scrum.org/forum/scrum-forum/82393/technical-debt-quality-and-definition-done) ·
[quality gates](https://zetcode.com/terms-testing/quality-gate/) ·
[tech-debt management (Atlassian)](https://www.atlassian.com/agile/software-development/technical-debt) ·
[incremental remediation (SIG)](https://www.softwareimprovementgroup.com/blog/technical-debt-management-guide/) ·
[best practices for AI coding agents](https://zencoder.ai/blog/best-practices-for-coding-with-ai-agent-platforms) ·
[AI prompts for developers / CRTSE](https://dev.to/albertsalgueda/best-ai-prompts-for-developers-in-2026-the-complete-guide-to-ai-assisted-coding-38h0)
