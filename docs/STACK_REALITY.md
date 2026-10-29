# Concord Stack Reality (honesty SoT)

**Last verified:** 2026-09-05 ~15:40 ET (PARTIAL completion pass); counts, economy, and status entries refreshed 2026-10-29 against the 2026-10-20 claims audit and the public-surface corrections applied 2026-10-20/21.  
**Purpose:** Measured runtime beats marketing. Prefer this file over older SHIP / DEPLOYMENT claims when they conflict.

## Refresh — 2026-10-29 (claims-audit alignment)

Entry-by-entry alignment with the claims audit of 2026-10-20 (report: `audits/concord-claims-audit-2026-10-20`, all figures code- or live-verified there; public surfaces were corrected to match on 2026-10-20/21):

- **Counts:** backend domains 430 → **449**; migrations 441 → **477**; backend route files 132 → **142**; MCP tools restated as **131 named in code / 122 publicly listable** (2026-10-20). Lens directories stay **267** (standardized ruler: frontend lens directories, excl. `[parent]`; 268 total incl. it). Test files **3,760** and commits **8,494** added as measured 2026-10-20 (both grow; treat as dated floors).
- **Economy:** the fee schedule is now stated in full below (verified in `server/economy/fees.js` + `royalty-cascade.js`). The economy is live **code**; the platform is **pre-revenue** with no meaningful transaction volume — never state fees as revenue.
- **Pod cost:** **~$700/mo** all-in for the self-hosted A40 pod. The stale low tooling figure that used to sit in the README was removed from it on 2026-10-20 and appears nowhere in this ledger.
- **DTU provenance:** machinery complete and tested in code, **not switched on in production** (prod census 2026-10-14: 0 rows in `dtu_integrity` / `dtu_rights` / `dtu_citations`). Label BUILT, never LIVE.
- **Five brains:** promoted out of "claims to stop making" — the claims audit verified five self-hosted Ollama brains on one A40 (48GB), zero per-token spend, pod serving (2026-10-20).
- **Trading:** Kalshi live rounds were STOPPED by founder order 2026-10-26 (see Trading honesty below).
- The 2026-09-05 item scoreboard (~77 LIVE · ~116 PARTIAL · …) was **not** re-run in this refresh; it stands as dated below until the next full pass.

## Verdict
Large real monolith with many **PARTIAL** organs. Not a fully living 248-item organism. Dominant status shifting after completion pass; PARTIAL still large.

## Scoreboard (2026-09-05 ~15:40 ET)
~77 LIVE · ~116 PARTIAL · ~18 STUB · ~1 MISSING · ~19 OVERCLAIM  
(was ~50 LIVE · ~135 PARTIAL). No demotions — promotions with evidence only.
Source: `~/.zuko/remaining-work/partial-scoreboard.json`

## Live trees
- Canonical repo: this tree (`concord-cognitive-engine`).
- Mac kitchen often runs the VS Code worktree checkout; treat path differences as ops, not dual products.
- Local health often: `:5050` / `:3000` up; **postgres + redis may be in-memory-fallback**.
- Prod `concord-os.org`: **GREEN** via Cloudflare Tunnel as of 2026-09-05 afternoon (`remaining-work/prod.json`); re-check before claiming.

## Counts that match the filesystem (keep)
Rows marked † were refreshed 2026-10-29 from the 2026-10-20 claims audit / corrected README measure (main @349feac24d); unmarked rows are the 2026-09-05 measure.

| Metric | Measured |
|---|---:|
| Frontend components | 2,842 |
| Page routes | 331 |
| Lens directories | 267 |
| Backend domains † | 449 |
| Migrations † | 477 |
| Backend route files † | 142 |
| Emergent modules (top-level) | 236 |
| Library modules | ~1,270 |
| Heartbeats (`registerHeartbeat` unique) | **140** (claims 168/175/~180 are stale; exclude tests) |
| MCP tools † | 131 named in code / 122 publicly listable (2026-10-20) |
| Test files † | 3,760 (2026-10-20 measure; public phrasing "3,700+") |
| Commits † | 8,494 (2026-10-20 measure; grows daily) |
| JS/TS lines | ~3.1M |
| Pod run cost † | ~$700/mo (A40, all-in; zero per-token spend) |

## Claims to stop making as LIVE
| Claim | Reality |
|---|---|
| 33:1 / ~122.5× compression “confirmed live” | Live `dhtp_metrics` ~**1.2×**. Bench ~122× was `repetition_memorization_only`. |
| ~260 Concord applications | **267 lenses** in one Next app; `apps/` product dir ≈ Concordia only. |
| DTU provenance live in production | Machinery complete + tested in code (SHA-256 hash + signature chain in `dtu-integrity.js`; per-DTU rights in `dtu-rights.js`; `.dtu` export). Prod census 2026-10-14 found **0 rows** in `dtu_integrity` / `dtu_rights` / `dtu_citations` — **BUILT, not switched on in production**. |
| Worker fleet / 47 workers alive | Often **0 alive**. |
| 7/7 cognitive mission harness as current green | Not evidenced as current shipping proof. |
| 19/19 trading E2E / 64-pass as current green | Not current kitchen proof. |
| F0 “eight-gate” | Auth-gate composition has **~10** gate modules. |
| MEGA/HYPER every-30-ticks as live memory | DTU bodies densified 2026-09-05 (empty→0); still do not claim every-30-ticks MEGA cadence. |
| Concordia server-authoritative combat/travel | **TARGET**; Editor path still largely client-local. |
| Adaptive Field Compression | **LIVE** — `adaptive-field-compression.js`; 198 outcomes / 14 policies. |

## Economy — verified in code (claims audit, 2026-10-20)

Read directly from `server/economy/fees.js` + `server/economy/royalty-cascade.js`:

- Token purchase / transfer / withdrawal: **1.46% per leg**.
- Marketplace purchase: **5.46% total** (4% + 1.46% universal).
- Music / art distribution: **4%**.
- Royalty payout fee: **0%** (the 1.46% lands when the coin is next spent, moved, or withdrawn).
- Royalty cascade: **21%** of net price initially, halving per generation, **0.05% floor**, depth 50 (~42% of price recirculates to cited creators).
- Emergent split on Concord-produced DTU sales: Concord takes 30% royalty from the seller's share, passes **21%** of the sale to cited human creators, **keeps 9%**.
- Fee split: **80% reserves / 10% operating / 10% payroll**.
- Break-even vs the ~$700/mo burn: ~**$12.8K/mo** marketplace GMV, or ~**$48K/mo** raw coin movement.

Status: this is live, deployed **code** — and the platform is **pre-revenue** (no meaningful volume, no third-party economy audit yet). State the schedule as the model, never as earnings. Money movement switches on last, once the product surfaces pass their gates.

## What is actually LIVE (keep celebrating)
Engine + chat + auth + macros + artifacts APIs; MCP + F0 gating; Trace Fabric / Experience Learner organs; Atlas/Vault surfaces; marketplace/royalty economy **code** (see Economy above — pre-revenue); five self-hosted Ollama brains on one A40, ~$700/mo, zero per-token spend (claims-audit verified, 2026-10-20); Sentinel/incident agents; Concordia Editor hub + Kenney assets + gait presentation; keeper-v6 Ollama model when installed.

## Trading honesty (kitchen)
- Dila owns Coinbase live path (tiny equity possible); the Coinbase dust-scale stack was left running by founder's choice (2026-10-26) — do not touch without a new order.
- Kalshi live rounds: **STOPPED by founder order 2026-10-26** — entry points renamed `.STOPPED-20261026`, nothing deleted, never re-enable without a new founder order. Lifetime record at stop: 90 settled live trades, **−$32.50** (the 97c+ "sure thing" band did most of the damage); weather paper book −$14.34 (feed runs hotter than NOAA settlement stations). Grade systems in dollars, never win rate.
- Named strategies (Deadline Squeeze, OBI, Info-Asym, Cross-Arb, Mean-Rev): **LIVE_PAPER** executors in `trading/strategies/` wired to multi_strategy (no live Coinbase without Dutch ask).

## Rule for authors
If you cannot point at a health check, metric, or successful call from this week, write **PARTIAL / TARGET / DESIGNED**, not LIVE.


## DHTP / Adaptive Field (2026-09-05 ~15:10 ET)
- Live executive IR `dhtp_metrics` avg ratio **~1.20×** (n=15) — **not** 33:1 confirmed live.
- **33:1 / ~124×** = HASH-mode DTU ref design math in `server/lib/dhtp.js` when working-set >5; keep as target, not kitchen avg badge.
- **Adaptive Field Compression** named at `server/lib/runtime/adaptive-field-compression.js` (facade over policy-learner + governor). Wired `recordFieldOutcomes` into `dhtp-compiler.js`. Backfilled outcomes from metrics; learned policies populated. Proof: `~/.zuko/remaining-work/adaptive-field.json`.

## Remaining-work pass (2026-09-05)

Measured updates (kitchen + prod):

- **Prod** `https://concord-os.org/health`: **GREEN** via Cloudflare Tunnel (`com.concord.cloudflared` LaunchAgent). Brains on `concord-core-v6` (+ `qwen3.5:2b` multimodal). postgres/redis **connected**. Was 530/1033 when cloudflared was down.
- **Workers**: still **0/47** alive. `/tmp/llm-workers` empty. Honest blocker: fleet supervisor not running; restarting wr/cc/oc burns API $ — not faked. See `~/.zuko/remaining-work/workers.json`.
- **DTU densify** (sqlite `server/data/concord.db`): empty body **1618/1625 (99.6%) → 0/300 (0%)** after body-from-data fill + material mega consolidate (Wood/Stone/Fiber/…). 1315 archived. Disk-full during bak corrupted pages; recovered with `sqlite3 .recover` (lost ~10 rows). Proof: `~/.zuko/remaining-work/dtu-density.json`.
- **Organ macros** exercised (web_search/emergent/system live): `~/.zuko/remaining-work/organs/`.
- **Still TARGET / PARTIAL**: full wr/cc/oc fleet, Concordia server-authority, true multi-brain ports, answer-quality of 2B after tools (prompt grounding present; measure synth-e2e).

Do **not** claim ALL SYSTEMS GREEN without live `/health`. Do **not** claim workers alive or dense DTU corpus without re-measuring.

## Fleet wire-up (2026-09-05)

- **39** `llm-worker` processes / tmux sessions (wr+cc+oc names).
- Fresh OpenRouter key installed (old had ⚠ emoji corruption).
- Claude via OpenRouter: **402** — remapped to Grok/Gemini.
- CF Workers AI tokens still **401**.
- `opencode serve` on :4096.
- Claude Code CLI still logged out (native cc tooling not attached).

## Living kitchen certs (2026-09-05 ~15:16 ET)
- Cognitive mission **7/7 PASS** (full harness 13/13)
- Trading E2E **19/19 PASS** (fixed `get_open_orders` history leak)
- Trading audit **66/66 PASS** (historical “64-pass” claim; harness grew)
- Dila trading fleet workers **6/6 alive** on `:7878`

## PARTIAL completion pass (2026-09-05 ~15:40 ET)
- Scoreboard now **~77 LIVE · ~116 PARTIAL · ~18 STUB · ~1 MISSING · ~19 OVERCLAIM** (was ~50 LIVE · ~135 PARTIAL).
- **No demotions** (Dutch overruled STUB demote). Promotions only with measured evidence.
- Wave-1 LIVE: Adaptive Field, DHTP learner/IR/metrics, densified DTU, kitchen certs/E2E, trading workers 6/6, named strategies LIVE_PAPER executors, USB Frameworks, Lease System, prod deployment green, Mac cron-master.
- Proofs: `~/.zuko/remaining-work/{partial-complete-plan,partial-inventory,partial-scoreboard,usb-lease-proof,named-strats}.json|md`
- Remaining PARTIAL is the real work queue (Concordia server-authority, Five-Brain/RunPod NEED_DUTCH, research/repair loops, econ bridges).
