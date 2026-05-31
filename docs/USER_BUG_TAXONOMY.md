# User-Bug Taxonomy & Intake — what real users surface, and Concordia's exposure (research)

## 0. Why this is the right next target

Once the L0–L5 gates are green, the structural bug classes (crash / wiring / schema / shape) are walled
off. What remains is what **real users surface in production** — and Concordia is the rare thing that is
**both a web platform *and* a live multiplayer game**, so it inherits *both* bug ecosystems. The
non-obvious gift: **Concordia's own audit findings already preview which user-bug categories its design
most exposes.** The gates catch the *structural* version of each class; a user-bug intake + observability
system catches the *emergent/runtime* version of the same class. They're complementary halves.

---

## 1. The common categories (the documented baselines)

### Platform / SaaS user bugs
| Category | What users report |
|---|---|
| **Broken access control** (#1 web risk, ~100% of pentested apps) | "I can see/do something I shouldn't" / "I can't access what I should" — IDOR, privilege escalation |
| **Sensitive info exposure** (#1 SaaS CWE) | verbose API responses returning unrendered fields, JWT carrying internal metadata, admin endpoints leaking |
| **Auth / session** | can't log in, session expires, OAuth loop |
| **Payment / billing** | double-charge, payment failed, subscription wrong |
| **Data loss / didn't save** | "my thing disappeared" (real or perceived) |
| **Performance / slowness / timeout** | page slow, request hangs |
| **Browser / device compat** | works on Chrome not Safari; broken on mobile |
| **Localization / TZ / currency** | wrong date/time, wrong currency, layout in other locales |
| **Notifications / email** | didn't arrive |
| **Regression from rapid releases** | "this worked yesterday" (interrelated systems break on minor updates) |

### Game / live-multiplayer user bugs
| Category | What players report |
|---|---|
| **Desync** (the dominant MP class) | teleport, phasing through walls, invisible attacks, hitbox mismatch, jitter, rubber-banding, "items moved for everyone but the host" |
| **Desync / state EXPLOITS** | invisible+invincible exploiter, fake-lag advantage, the security side of desync |
| **Progression / save loss** | lost items / levels / save — the #1 player-rage bug |
| **Economy exploits** | dupes, gold/item generation, market manipulation |
| **Soft-locks** | quest won't advance, stuck geometry, fell through world, match "hung" |
| **Crashes / disconnects** | client crash, can't reconnect (often client-env: VPN/AV — reported as game bugs) |
| **Matchmaking / party / social** | can't join, party breaks |
| **Reward not granted** | quest completed, no reward |
| **Balance complaints** | reported *as* bugs, aren't (but must be triaged) |
| **Visual / animation glitches** | clipping, stuck animations |

---

## 2. Concordia's exposure ranking — where its DESIGN concentrates the risk

Ranked by how much Concordia's specific architecture amplifies each class, with the **audit finding that
previews it**:

1. **🔴 Economy exploits (HIGHEST).** Concordia is a *player-created* economy with perpetual royalties,
   marketplace, auctions, wagers, crafting-resolve. Player-authored content = an *infinite* exploit
   surface. **Preview: the self-wager (#V1) — passed every crash gate, still an exploit.** Watch: dupes,
   royalty-cascade gaming, crafting-backfire abuse, wash trading (you already have `detectWashTrading`),
   negative/overflow value (mostly defended). This is the #1 Concordia-specific user-bug risk.
2. **🔴 Desync / multiplayer state (HIGH).** Real-time MMO, ~273 socket events, presence, action combat,
   the Phase-F world-shard write-ownership. Players will report teleport/phasing/invisible-hit + desync
   *exploits* (invisible-invincible). You have server-authoritative anti-cheat (reach/damage caps — verified)
   — desync *reconciliation* is the runtime extension.
3. **🔴 Data-loss (real + perceived) (HIGH).** The DTU substrate + self-compressing memory + the
   forgetting-engine + per-world inventory. **Preview: `dtu.create` non-persist (#32) + the consolidation
   crash (#15) — literal data loss.** Plus *perceived* loss: the forgetting-engine tombstoning, MEGA/HYPER
   compaction, per-world inventory scoping ("my items vanished when I switched worlds").
4. **🟠 Soft-locks / progression (MED-HIGH).** Quest chains, prerequisite gates, the run-modes, the
   onboarding arc. **Preview: the dead quest macros (#11) → `/lenses/quests` soft-locks; the run-mode
   timeouts.** A quest that won't advance is a rage-quit.
5. **🟠 Broken access control / info exposure (MED).** The three-gate permission system. Privacy *held*
   in my audit (private DTUs scoped, cross-user delete blocked) — but it's the #1 web risk, so ongoing
   vigilance. **Preview: the auctions `sellerUserId` in a public response — the "verbose API returns
   unrendered fields" pattern.** Audit every public-read response for over-exposed fields.
6. **🟠 Localization / TZ (MED).** Global player base. **Preview: the hydration date renders (`new
   Date().toLocaleDateString()`) — the exact TZ-mismatch class.** Plus CC/Sparks currency display.
7. **🟠 Streaming "broken" (MED).** **Preview: the SSE buffering — "chat hangs then dumps."** Fixed by the
   SSE spec; users would otherwise report it as a hang.
8. **🟡 Browser/device compat (MED).** 253 lenses × browsers × the Expo mobile app.
9. **🟡 Performance at load (MED).** **Preview: the event-loop-lag spikes** — surface as "slow/laggy" under
   real concurrency (L5 load test catches pre-emptively).
10. **🟡 Client-environment false-bugs (LOW priority, HIGH volume).** VPN/antivirus disconnects reported
    as game bugs — needs triage filtering, not code fixes.

---

## 3. The intake + observability system (how to catch & handle them)

The SaaS research's blunt stat: **60% of bug reports never lead to a fix — vague repro, no context.** So
the system matters as much as the code. Most pieces Concordia *already has*:

| Need | Tool | Concordia status |
|---|---|---|
| **Frontend error capture** (white-screens, hydration, JS errors) | **Sentry** | **HAVE** — `next.config` already wires `NEXT_PUBLIC_SENTRY_DSN`; just enable in prod |
| **Server error alerting** (crashes, 500s) | error-alerting + Prometheus | **HAVE** — `error-alerting` module + Grafana deployed |
| **In-app bug reporter** (auto-captures screenshot + console + env + repro) | Gleap / BugHerd / Sentry user-feedback | **BUILD** — the fix-rate multiplier; auto-context solves the 60% problem |
| **Economy anomaly detection** (the #1 risk) | balance-invariant monitors + `detectWashTrading` | **PARTIAL** — extend: alert on impossible balances / dupe patterns / royalty anomalies |
| **Desync reconciliation + telemetry** | server-authoritative state + desync metrics | **PARTIAL** — anti-cheat exists; add desync-rate telemetry |
| **Severity taxonomy + triage funnel** | Critical / Major / Moderate / Minor | **BUILD** — route Critical (data-loss/exploit/security) to instant alert |
| **Synthetic monitoring (catch before users)** | the L5 journeys | **PLANNED** (Function-Assurance L5) |

---

## 4. The complementary-halves model

```
        STRUCTURAL bugs                         EMERGENT / RUNTIME bugs
   (enumerable, pre-deploy)                    (user-surfaced, post-deploy)
   ────────────────────────                    ───────────────────────────
   L0  schema gate          ──┐            ┌── economy-exploit monitors
   L1  wiring/reachability    │            │   desync telemetry
   L2  runtime smoke          ├─ gates ───→├── Sentry (frontend errors)
   L3  contract math          │  catch the │   error-alerting (server)
   L4  browser smoke          │  structural│   in-app reporter (+context)
   L5  synthetic + load     ──┘  version   └── severity triage funnel
                                            ↑ catch the emergent version
                                              of the SAME classes
```

The classes are *the same* (exploit, desync, data-loss, soft-lock, access-control, localization,
streaming, perf). The gates prove the structural form is absent; the user-bug system catches the
emergent form the gates can't enumerate (the self-wager that *passes* every crash gate). **You need both
halves** — and Concordia already owns most of the right half's infrastructure (Sentry, Grafana,
error-alerting, wash-trading detection, anti-cheat).

---

## 5. What we'd need (shopping list)

1. **Turn on Sentry in prod** (frontend DSN already wired) — instantly surfaces the hydration/white-screen
   class. ~1 hour.
2. **In-app bug reporter** with auto-captured context (screenshot + console + world/lens + last actions) —
   the single highest-leverage intake change (solves the 60%-vague-report problem). ~1–2 days.
3. **Economy anomaly monitors** — balance-invariant + dupe-pattern alerts on top of `detectWashTrading`
   (the #1 Concordia risk). ~2–3 days.
4. **Desync-rate telemetry** — server-authoritative reconciliation metrics into Grafana. ~2–3 days.
5. **Severity taxonomy + triage routing** — Critical (data-loss/exploit/security) → page; the rest → board.
   ~1 day.
6. **L5 synthetic journeys** (Function-Assurance) — catch the common categories before users do.

Total: ~1.5 weeks, and most of it is *wiring infrastructure you already deployed* (Sentry, Grafana,
error-alerting, wash-trading) rather than building from scratch.

## 6. Verdict

After the gates are green, "user bugs" isn't a vague worry — it's a **known, ranked, instrumented
taxonomy** of ~10 categories, where Concordia's design concentrates risk in **economy exploits, desync,
and data-loss**, and where the audit findings already told you which ones to expect. Build the right half
of the diagram (mostly enabling infra you have), and user bugs become a *triaged funnel with auto-context*
— not a stream of vague reports that 60%-never-get-fixed. That's the difference between a platform that
*reacts* to user bugs and one that *expects, instruments, and triages* them.

**Sources:** [common SaaS bugs](https://wpdev.saasrescue.com/common-saas-bugs-and-how-to-fix-them-quickly/) ·
[SaaS vulnerabilities / broken access control](https://www.blazeinfosec.com/post/common-saas-vulnerabilities/) ·
[bug report quality / 60% stat](https://birdeatsbug.com/blog/how-to-write-a-bug-report) ·
[in-app bug reporting for SaaS](https://www.gleap.io/blog/best-in-app-bug-reporting-tools-2026) ·
[multiplayer bug testing](https://snoopgame.com/blog/best-practices-for-bug-testing-in-multiplayer-games/) ·
[debugging desync](https://bugnet.io/blog/how-to-debug-multiplayer-desync-issues-in-games) ·
[desync exploits](https://devforum.roblox.com/t/desync-exploit-spreading-in-the-past-month/4011364)
