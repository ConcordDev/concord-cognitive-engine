# User-Bug Taxonomy & Intake — what real users surface, and Concordia's exposure

Once the L0–L5 gates are green, the structural bug classes (crash / wiring / schema / shape) are
walled off. What remains is what **real users surface in production**. Concordia is the rare
thing that is **both a web platform *and* a live multiplayer game**, so it inherits *both* bug
ecosystems. The non-obvious gift: **Concordia's own audit findings already preview which user-bug
categories its design most exposes.** The gates catch the *structural* version of each class; a
user-bug intake + observability system catches the *emergent/runtime* version of the same class.
They're complementary halves (§4).

---

## 1. The common categories (documented baselines)

### Platform / SaaS user bugs
| Category | What users report |
|---|---|
| **Broken access control** (#1 web risk) | "I can see/do something I shouldn't" — IDOR, privilege escalation |
| **Sensitive info exposure** (#1 SaaS CWE) | verbose API returning unrendered fields, JWT carrying internal metadata |
| **Auth / session** | can't log in, session expires, OAuth loop |
| **Payment / billing** | double-charge, payment failed, wrong subscription |
| **Data loss / didn't save** | "my thing disappeared" (real or perceived) |
| **Performance / slowness / timeout** | page slow, request hangs |
| **Browser / device compat** | works on Chrome not Safari; broken on mobile |
| **Localization / TZ / currency** | wrong date/time, wrong currency, broken locale layout |
| **Notifications / email** | didn't arrive |
| **Regression from rapid releases** | "this worked yesterday" |

### Game / live-multiplayer user bugs
| Category | What players report |
|---|---|
| **Desync** (the dominant MP class) | teleport, phasing, invisible attacks, hitbox mismatch, rubber-banding |
| **Desync / state EXPLOITS** | invisible+invincible exploiter, fake-lag advantage (the security side) |
| **Progression / save loss** | lost items/levels/save — the #1 player-rage bug |
| **Economy exploits** | dupes, gold/item generation, market manipulation |
| **Soft-locks** | quest won't advance, stuck geometry, fell through world, match "hung" |
| **Crashes / disconnects** | client crash, can't reconnect (often client-env: VPN/AV) |
| **Matchmaking / party / social** | can't join, party breaks |
| **Reward not granted** | quest completed, no reward |
| **Balance complaints** | reported *as* bugs, aren't — but must be triaged |
| **Visual / animation glitches** | clipping, stuck animations |

---

## 2. Concordia's exposure ranking — where its DESIGN concentrates risk

Ranked by how much Concordia's specific architecture amplifies each class, with the audit
finding that previews it:

1. **🔴 Economy exploits (HIGHEST).** A *player-created* economy with perpetual royalties,
   marketplace, auctions, wagers, crafting-resolve = an *infinite* exploit surface. **Preview:
   the self-wager (#V1) — passed every crash gate, still an exploit.** Watch: dupes, royalty-
   cascade gaming, crafting-backfire abuse, wash trading (you have `detectWashTrading`), negative/
   overflow value. → **Track E2 economy-anomaly cycle + Track F3 anti-cartel** address this.
2. **🔴 Desync / multiplayer state (HIGH).** Real-time MMO, ~273 socket events, action combat,
   Phase-F world-shard write-ownership. Players report teleport/phasing/invisible-hit + desync
   *exploits*. You have server-authoritative anti-cheat (reach/damage caps); reconciliation is the
   runtime extension. → **Track E1 desync telemetry** is the measurement; the prediction layer
   (DESIGN_NORTH_STAR §2/§4) is the fix.
3. **🔴 Data-loss (real + perceived) (HIGH).** The DTU substrate + self-compressing memory +
   forgetting-engine + per-world inventory. **Preview: `dtu.create` non-persist (#32) + the
   consolidation crash (#15).** Plus *perceived* loss (tombstoning, MEGA/HYPER compaction,
   per-world inventory scoping — "my items vanished when I switched worlds").
4. **🟠 Soft-locks / progression (MED-HIGH).** Quest chains, prerequisite gates, run-modes,
   onboarding. **Preview: the dead quest macros (#11) → `/lenses/quests` soft-locks.** A quest
   that won't advance is a rage-quit.
5. **🟠 Broken access control / info exposure (MED).** The three-gate permission system. Privacy
   *held* in audit, but it's the #1 web risk. **Preview: auctions `sellerUserId` in a public
   response — the "verbose API returns unrendered fields" pattern.** Audit every public-read
   response for over-exposed fields.
6. **🟠 Localization / TZ (MED).** Global player base. **Preview: hydration date renders
   (`new Date().toLocaleDateString()`) — the exact TZ-mismatch class.**
7. **🟠 Streaming "broken" (MED).** **Preview: the SSE buffering — "chat hangs then dumps."**
   Fixed by the SSE spec (`SSE_STREAMING.md`).
8. **🟡 Browser/device compat (MED).** 253 lenses × browsers × the Expo mobile app.
9. **🟡 Performance at load (MED).** **Preview: event-loop-lag spikes** under real concurrency
   (the L5 load test catches pre-emptively).
10. **🟡 Client-environment false-bugs (LOW priority, HIGH volume).** VPN/antivirus disconnects
    reported as game bugs — needs triage filtering, not code fixes.

---

## 3. The intake + observability system

The blunt SaaS stat: **60% of bug reports never lead to a fix — vague repro, no context.** The
system matters as much as the code. Most pieces Concordia *already has*:

| Need | Tool | Concordia status |
|---|---|---|
| Frontend error capture | Sentry | **HAVE (dormant)** — `sentry.{client,server,edge}.config.js`; enable via `NEXT_PUBLIC_SENTRY_DSN` (Track E5 documented it) |
| Server error alerting | error-alerting + Prometheus | **HAVE** — `lib/error-alerting.js` + Grafana |
| In-app bug reporter (auto-context) | Gleap-style | **HAVE (no auto-context)** — `FeedbackWidget.tsx` + `/api/feedback*`; **Track E4** adds the auto-context envelope (the 60%-fix lever) |
| Economy anomaly detection | balance invariants + `detectWashTrading` | **PARTIAL → Track E2** (counter + alert) + **F3** (anti-cartel) |
| Desync reconciliation + telemetry | server-authoritative + desync metrics | **PARTIAL → Track E1** (counters + `ConcordDesyncSpike`) |
| Severity taxonomy + triage funnel | Critical/Major/Moderate/Minor | **Track E3** `lib/bug-triage.js` (Critical=data-loss/exploit/security → page) |
| Synthetic monitoring | the L5 journeys | **PLANNED** (Function-Assurance L5 / Track E6) |

---

## 4. The complementary-halves model

```
        STRUCTURAL bugs                         EMERGENT / RUNTIME bugs
   (enumerable, pre-deploy)                    (user-surfaced, post-deploy)
   ────────────────────────                    ───────────────────────────
   L0  schema gate          ──┐            ┌── economy-exploit monitors (E2/F3)
   L1  wiring/reachability    │            │   desync telemetry (E1)
   L2  runtime smoke          ├─ gates ───→├── Sentry (frontend errors, E5)
   L3  contract math          │  catch the │   error-alerting (server)
   L4  browser smoke          │  structural│   in-app reporter + context (E4)
   L5  synthetic + load     ──┘  version   └── severity triage funnel (E3)
                                            ↑ catch the emergent version
                                              of the SAME classes
```

The classes are *the same* (exploit, desync, data-loss, soft-lock, access-control, localization,
streaming, perf). The gates prove the structural form is absent; the user-bug system catches the
emergent form the gates can't enumerate (the self-wager that *passes* every crash gate). **You
need both halves** — and Concordia already owns most of the right half's infrastructure (Sentry,
Grafana, error-alerting, wash-trading detection, anti-cheat).

---

## 5. Verdict

After the gates are green, "user bugs" isn't a vague worry — it's a **known, ranked, instrumented
taxonomy** of ~10 categories where Concordia's design concentrates risk in **economy exploits,
desync, and data-loss**, and the audit findings already told you which to expect. The right half
of the diagram (Track E shipped E1/E2/E3/E5; E4/E6 remain) turns user bugs into a **triaged funnel
with auto-context** — the difference between a platform that *reacts* and one that *expects,
instruments, and triages*.
