# Concord: AI that shows its receipts

**Concord gives engineers AI answers they can check.**

Ask an engineering question in plain English. Concord runs a real solver, puts the result next to the textbook hand calculation, and stores a reproducible record of the inputs, assumptions and solver used. The engineer stays in the loop and signs off; Concord makes the check fast and auditable.

**Live product:** [concord-os.org](https://concord-os.org) · [Try it in 5 minutes](#try-it-in-5-minutes) · [Proof](#proof) · [Where we are](#where-we-are) · [Contact](#contact)

```text
You:      A simply supported steel beam 20 ft long carries a 1000 lb point load
          at midspan. E = 29,000,000 psi, I = 200 in^4. What is the maximum deflection?

Concord:  Routed to the beam engine (not guessed by the language model).
          δ = 0.04966 in (1.261 mm)
          Hand check: PL³/48EI = 1000 × 240³ / (48 × 29,000,000 × 200) = 0.04966 in  ✓
```

That exact question and answer are pinned by a test on `main` ([`server/tests/engineering-question-extract.test.js`](server/tests/engineering-question-extract.test.js)).

**Why it's credible:** this is shipped software, not a deck. 7,632 commits, 3,463 test files, CI on every change, 441 backend domain modules and an MCP server that lets other AI agents call the same verified compute. One founder built it with AI coding agents, self-funded. Every number on this page can be re-measured from the repo ([commands below](#reproduce-the-numbers)).

---

## The problem and the first customer

Engineers can't sign off on a number they can't check, and general chat AIs produce numbers that look right and sometimes aren't. For a structural or mechanical engineer, an unverifiable answer is worth nothing.

Concord's rule: **where software can compute the answer exactly, it computes it.** The language model reads the question, picks the engine and explains the result. It never invents the number. Each computed answer comes with:

- the solver and version that produced it
- the inputs, units and stated assumptions (for example: Euler–Bernoulli beam theory, linear-static, small deflection)
- a closed-form hand check where one exists
- what is out of scope (for example: shell or solid elements, modal analysis, plasticity), so nobody over-reads the result
- a stored record that reproduces the same result from the same inputs

**First customer:** structural and mechanical engineers, and technical R&D teams, who already check calculations by hand and want that check done in seconds with a record they can file. Engineering comes first because the check is cleanest: a beam either matches PL³/48EI or it doesn't.

## Proof

**Live now**
- [concord-os.org](https://concord-os.org) is up (checked 2026-10-07, 3:40 PM ET). Sign-up is free.
- Chat routes written beam problems (simply supported, cantilever, fixed-fixed; imperial and SI) to the deterministic engine instead of the language model, and discloses assumed values such as steel's E. Tests assert the textbook PL³/48EI, PL³/3EI and PL³/192EI results.
- The Engineering lens is a frame/FEA and multi-discipline calc desk backed by a 2D/3D frame solver ([`server/lib/simulation/fea-solver.js`](server/lib/simulation/fea-solver.js)) and 36 engineering operations (FEA, structural, thermal, hydraulic, tolerance chains, transformer sizing and more).
- A new-user QA pass on 2026-09-27 checked parts, load cases, FEA and 7 calculators against hand calculations, and found and fixed a column-solver bug ([`docs/GO_TO_MARKET.md`](docs/GO_TO_MARKET.md)).

**Landing now (open pull requests; each one's own tests pass)**
- **Beam V&V corpus** ([#1015](https://github.com/ConcordDev/concord-cognitive-engine/pull/1015)): 12 closed-form textbook cases (cantilevers, simply supported and fixed-fixed midspan loads, an inclined member, a portal frame, bending stress) run through the solver in CI, gated at a maximum relative error of 1e-6. Result: 14 pass, 0 fail.
- **`analysisReceipt`** ([#1016](https://github.com/ConcordDev/concord-cognitive-engine/pull/1016)): every beam study carries a receipt with the solver id, a SHA-256 hash of the normalized inputs, units, assumptions and an explicit out-of-scope list. Change the span or the load and the hash changes.
- **ConKay engineering workspace** ([#1014](https://github.com/ConcordDev/concord-cognitive-engine/pull/1014)): a parametric I-beam you can edit in plain language ("cantilever, 50 kN, A36", "t_w = 8 mm and re-run"), with the FEA result and hand check side by side, parameter sweeps that name the lightest passing section, and results kept as reproducible records.
- **Euler column buckling check** ([#1017](https://github.com/ConcordDev/concord-cognitive-engine/pull/1017)): closed-form Pcr = π²EI/(KL)², always labeled as analytical so nobody mistakes it for an FEA eigenvalue result.

What these checks are: verification against published closed-form solutions, with the engineer making the call. What they are not: a certification, or a claim that software makes a structure safe on its own. Concord's value is a receipt a professional can check.

## Try it in 5 minutes

1. Create a free account at [concord-os.org/register](https://concord-os.org/register).
2. Open **Chat** and paste the beam question from the top of this page. Compare the answer with PL³/48EI on a calculator.
3. Open the **Engineering** lens ([concord-os.org/lenses/engineering](https://concord-os.org/lenses/engineering)) to build a frame and run the solver.
4. Developers can run the checks themselves. No install is needed for these tests:

```bash
git clone https://github.com/ConcordDev/concord-cognitive-engine.git
cd concord-cognitive-engine/server
node --test tests/engineering-question-extract.test.js tests/fea-frame-element.test.js tests/fea-reactions.test.js
```

## How the same engine reaches other fields

Engineering is the wedge. The engine behind it (compute where possible, check, keep the record) is general, and it already runs across **267 lenses in 13 categories**. A lens is a focused workspace on the same backend, for example:

- **Accounting:** the largest domain module (4,081 lines): trial balance, P&L, AP aging, invoices, payroll summaries and runway forecasts.
- **Science and technical:** symbolic math, physics, chemistry, materials, electrical systems and aviation weight-and-balance.
- **Trades and creative work:** construction and trades calculators, game design and music tools.

These show how far the engine reaches. They are not the first market.

**Concordia, the consumer funnel.** Concordia is a persistent Unity 6 world (63,703 lines of C#) running on the same backend: characters with memory, factions, quests and an economy. Its job is reach. Clips and play bring people in, and the same account lands in Concord, where the receipts are.

## How it's built

**One founder working with AI coding agents.** That is a strength investors can verify, not a gap to explain:

- **7,632 commits** on `main`, about 90% of them (6,830) since April 2026. The repo's first commit was December 2025; full-time building has run about 7 months.
- **3,463 test files** (754,477 lines), including **297 behavioral "depth" tests** that assert computed values rather than page shapes.
- **CI on every change:** 25 GitHub workflows, 21 of which run on pushes or pull requests: tests, CodeQL, SAST/SCA/secret scanning, OWASP ZAP DAST, visual regression and more.
- **Security work with regression tests:** fixes for an authenticated RCE, a wallet IDOR, SSRF gaps, privilege escalation and path traversal, each pinned by a test (see [`docs/STATE_OF_CONCORD.md`](docs/STATE_OF_CONCORD.md)).
- **Capital efficiency:** self-funded on about $20/month of tooling, with a $500–2,000/month GPU target for production. Concord runs local open models, so there are no per-token API fees.

| Measured on `main` (2026-10-07) | Count |
|---|---:|
| Commits | 7,632 |
| Test files / behavioral depth tests | 3,463 / 297 |
| Backend domain modules | 441 |
| Registered backend operations ("macros", graded) | 9,684 |
| Lenses (13 categories) | 267 |
| Database migrations | 452 |
| API route files | 136 |
| Frontend components / app pages | 3,429 / 333 |
| MCP tools (internal / public server) | 118 / 9 |
| Lines of code (tracked source, 10 languages) | ~3.1M |
| Unity C# (Concordia) | 63,703 lines |

## Where we are

**Stage, plainly:** pre-revenue with no paying users yet, and pre-entity (company formation is next). The product is live and free to try.

**What is live:** the web app at concord-os.org, chat with deterministic engineering compute, the Engineering lens and FEA solver, 267 lenses, and an MCP server (OAuth 2.1 + PKCE) that exposes verified tools such as `concord.verify` and `concord.math` to other agents.

**Design-partner plan (engineers):** recruit 5 practicing structural and mechanical engineers. Each brings calculations they already check by hand. We run them through Concord together every week and measure time to a checked answer, hand-check agreement and whether the receipt is good enough to file. Their feedback decides what gets verified next.

**Next 6 months: the engineering wedge**

| Months | Focus |
|---|---|
| 1–2 | Merge the V&V corpus, receipts, ConKay workspace and column check. Onboard design partners. Publish a 60-second receipt demo; launch on Show HN and engineering communities; list the MCP server in agent registries. |
| 3–4 | Grow the verified case library (columns, frames, connections) with partner problems. Exportable calc packages built from receipts. Shared team workspaces. First paid pilots. |
| 5–6 | Pricing in market: per-seat for engineering teams, usage-based for agents calling verified compute over MCP. Concordia as top of funnel: fresh browser build and short clips that route new users into Concord. |

Metrics we track (from [`docs/GO_TO_MARKET.md`](docs/GO_TO_MARKET.md)): share of new accounts that get a computed, receipted answer in their first session; time to that answer (target under 2 minutes); D1/D7 retention.

**Business model:** subscriptions for engineering teams and usage-based pricing for agent (MCP) calls first. Marketplace payments with creator royalties come later; details for crypto-focused funds are in [`docs/ECONOMY.md`](docs/ECONOMY.md).

## Architecture in one picture

```text
User question (plain English)
        │
        ▼
Intent routing ── exact solution exists? ──► Deterministic engine (FEA, CAS, physics …)
        │                                          │
        │ needs interpretation                     ▼
        ▼                                   Check (hand calc / closed form)
Language model reasons and explains                │
        │                                          ▼
        └──────────────────────────────►  Stored, reproducible record
```

The language model is one component. It is not the source of truth for arithmetic, physics or state. More detail: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Repository map

| Path | What it is |
|---|---|
| `server/` | Node.js backend: domain modules, solvers, MCP server, tests |
| `concord-frontend/` | Next.js web app: lenses, chat, the Engineering lens |
| `apps/concordia-living-world/` | Concordia, the Unity 6 world |
| `concord-mobile/` | Mobile app |
| `sdk/`, `concord-vscode/`, `concord-jetbrains/`, `concord-lsp/` | Developer SDK and editor integrations |
| `docs/` | Plans, specs and status documents |

Local development setup: [`docs/contributing/CONTRIBUTING.md`](docs/contributing/CONTRIBUTING.md).

## Reproduce the numbers

Every count above comes from git on `main` (commit `973e214`), so anyone can re-run it:

| Number | Command (run from the repo root) |
|---|---|
| Commits | `git rev-list --count origin/main` |
| Test files | `git ls-tree -r --name-only origin/main \| grep -cE '\.(test\|spec)\.(js\|mjs\|cjs\|ts\|tsx\|jsx)$'` |
| Depth tests | `git ls-tree -r --name-only origin/main \| grep -cE '^server/tests/depth/[^/]+\.test\.js$'` |
| Domain modules | `git ls-tree -r --name-only origin/main \| grep -cE '^server/domains/[^/]+\.js$'` |
| Migrations | `git ls-tree -r --name-only origin/main \| grep -cE '^server/migrations/[0-9][^/]*\.js$'` |
| Graded macros | `total` in `audit/macro-depth.json` |
| Lenses | entries in `LENS_REGISTRY` in `concord-frontend/lib/lens-registry.ts` |
| CI workflows | `git ls-tree -r --name-only origin/main \| grep -cE '^\.github/workflows/[^/]+\.ya?ml$'` |

## License

Source-available under the Concord Source License, Community Edition (CSL-CE 1.0): free for non-commercial personal, research and educational use. Commercial use requires a commercial license. See [`LICENSE.txt`](LICENSE.txt).

## Contact

**Dutch (Ramaj Duncan), founder**
- Email: [Dutchtropez@gmail.com](mailto:Dutchtropez@gmail.com)
- X: [@revie9858](https://x.com/revie9858)
- LinkedIn: [linkedin.com/in/dizzy-review-48979b176](https://www.linkedin.com/in/dizzy-review-48979b176)
