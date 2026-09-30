# CLAUDE HANDOFF — Concord Concurrency Refactor (entire map)

**Date:** 2026-09-08  
**Author:** Zuko 2 (Grok Bot) for Dutch Tropez  
**Audience:** Claude RC (VS Code on Mac.lan) — execute this plan; do not soft-defer driveable work  
**Repo:** `/Users/dutch/concord vs code/concord-cognitive-engine` · branch `handoff-cherry-pick`  
**Runtime data/logs/db:** `/Users/dutch/concord/` (NOT a second git tree)  
**Kitchen:** `~/.zuko/`

> **PROGRESS (2026-09-08, Claude RC — branch `concurrency-refactor`):**
> Phases 0–2 **LIVE** (Go audio/sandbox sidecar + warm OCC daemon, launchd, fail-soft).
> Phase 3 **LIVE (opt-in, enabled on this box)** — migration 442 gave `dtu_store` the
> visibility columns the filter needs (+ fixed a latent `data`-vs-`body` rehydrate bug);
> Rust sidecar (rusqlite, RO, in-memory cache) filters `dtu.list`/`dtu.get` off-thread;
> differential proof: 9/9 scenarios + 4/4 get-checks vs the live macro. `CONCORD_DTU_SIDECAR`.
> Phase 4 **built + proven + running**; opt-in now covers every brain call, streaming
> verified; live cutover + dead-tunnel validation A40-gated (NEED_DUTCH).
> Phase 5 **recommend closing** — no bottleneck (Rust toolchain installed anyway).
> Phase 6 **done** (audited; 1 log-spam fix). Phase 7 **documented** (NEED_DUTCH).
> Phase 8 **owned by another session**. Rolling status + per-phase proofs:
> `~/.zuko/remaining-work/CONCURRENCY_REFACTOR_STATUS.md`.

### Companion evidence (read first)
| File | What |
|------|------|
| `~/.zuko/remaining-work/CONCORD_CONCURRENCY_AUDIT-2026-09-08.md` | Full concurrency audit |
| `~/.zuko/remaining-work/concord-concurrency-audit.json` | Structured findings (11) + sidecar map |
| `~/.zuko/remaining-work/a40-lockup-log-extract-2026-09-07.md` | Sep 7–8 A40 lockup timeline |
| `~/.zuko/remaining-work/LEFTOVERS-2026-09-08.md` | Broader leftovers / NEED_DUTCH |
| `~/.zuko/BRAIN_4LANE.md` | Mac-copy vs A40 restore |

---

## 0. Mission (one sentence)

**Keep Node as the Concord orchestrator (Express, auth, llm-queue, ConKay UI).** Extract CPU/sync/blocking work into **Go + Rust (+ long-lived Python OCC daemon)** sidecars so the event loop stops choking — then Concord can truly fan out.

Do **not** rewrite Concord in another language. Do **not** big-bang replace `server.js` / `dtus.js`.

---

## 1. F0 / hard rules (Claude must obey)

1. **No Coinbase** — Dila owns; ask-first forever.  
2. **No second Polymarket/Kalshi trader** — Hermes minute cycle only.  
3. **No secrets in chat / commits / this file** — never paste CF tokens, `.env`, credentials.  
4. **No `pm2 stop` / `pm2 delete`** — use `launchctl bootout` + `bootstrap` + `kickstart -k` for `com.concord.backend` / `com.concord.frontend`.  
5. **Disk ~20GB free** — stay lean; no huge caches.  
6. **A40 pod** — do not create a new billable RunPod without Dutch confirm. Pod currently DOWN; Mac-copy brains on `:11434`.  
7. **Honesty** — designed ≠ LIVE. Prove with kitchen JSON under `~/.zuko/remaining-work/`.  
8. **Claude RC permissions** — leave `permissions.defaultMode=auto` (Dutch preference). Soft denys still block pm2 stop/delete.

---

## 2. What yesterday’s lockups actually were (context)

**Primary (Sep 7–8):** A40 SSH tunnel death — first clear `FAIL tunnel :11435` **14:42 ET Sep 7**, then backend/frontend health flaps, overnight **disk 95%+**, hard `FAIL a40 ssh` / `Operation timed out` by ~08:06 Sep 8. Mac-copy failover ~06:06 ET.

**Not evidenced as root:** dense SQLITE_BUSY / event-loop lag / heap OOM traces (logs thin / rotated).

**Code still makes Concord fragile under that flap:** sync better-sqlite3 + spawnSync + OCC execFile on one Node loop.

---

## 3. Current size / sync surface (measured)

| Metric | Count |
|--------|------:|
| `server/server.js` | ~87,635 lines |
| `server/dtus.js` | ~145,466 lines |
| `readFileSync` (server first-party) | ~637 |
| `writeFileSync` | ~256 |
| `spawnSync` / `execSync` / `execFileSync` | ~34 / ~37 / ~110 |
| better-sqlite3 refs | ~1,098 |
| `.prepare(` | ~10,251 |

**Already good (keep):** `llm-queue.js`, `chat-parallel-brains.js` (`Promise.allSettled` conscious∥subconscious). They cannot unblock sync SQLite/spawnSync or a dead tunnel.

---

## 4. Target architecture (map)

```
┌─────────────────────────────────────────────────────────────┐
│  Next :3000 (ConKay UI)  ──auth cookies──►  Express :5050    │
│                      Node stays here                         │
│  llm-queue · brain-router · /api/dtus · /api/conkay · MCP    │
└───────────────┬───────────────────┬──────────────────────────┘
                │ HTTP/UDS          │ HTTP/UDS
        ┌───────▼──────┐    ┌───────▼────────┐
        │ Go sidecar   │    │ Rust sidecar   │
        │ :7879 (new)  │    │ :7880 (new)    │
        │ Whisper      │    │ DTU/SQLite hot │
        │ Piper TTS    │    │ DHTP match     │
        │ sandbox exec │    │ (later)        │
        └──────────────┘    └───────┬────────┘
                                    │
                            ┌───────▼────────┐
                            │ OCC daemon     │
                            │ Python/Rust    │
                            │ long-lived OCP │
                            │ (replace       │
                            │  execFile 60s) │
                            └────────────────┘
                │
        ┌───────▼────────┐
        │ Go ollama-proxy│  optional after A40 back
        │ circuit-break  │  :11435 tunnel hygiene
        └────────────────┘
```

Ports above are **proposals** — pick free ports; document in kitchen. Hermes fleet already uses `:7878` — **do not collide**.

---

## 5. Ordered work plan (the entire thing)

### Phase 0 — Prep (1 session)
- [ ] Re-read companion audit files above  
- [ ] Confirm free disk ≥15GB  
- [ ] Add kitchen doc pointer from `~/.zuko/STANDING_INSTRUCTIONS.md` → this handoff  
- [ ] Create branch or continue `handoff-cherry-pick` (no force-push)  
- [ ] Inventory exact `spawnSync` call sites in `server.js` (Whisper ~57149, Piper ~15190/15224, sandbox ~14881)

### Phase 1 — Go audio/sandbox sidecar (**FIRST — highest event-loop win**)
**Goal:** Node never `spawnSync`s Whisper/Piper/sandbox on the request path.

- [ ] New tree e.g. `engines/concord-go-sidecar/` (or `~/.zuko/engines/go-sidecar/`)  
- [ ] HTTP or Unix socket API:  
  - `POST /v1/whisper` {audio path or bytes} → transcript  
  - `POST /v1/piper` {text, voice} → wav path/bytes  
  - `POST /v1/sandbox` {cmd allowlist, timeout} → stdout/stderr/exit  
- [ ] Long-lived process; launchd plist `com.concord.go-sidecar` (bootout/bootstrap — not pm2)  
- [ ] Node adapter: replace spawnSync sites with `fetch`/`undici` to sidecar; **fail soft** if sidecar down  
- [ ] Proof: `~/.zuko/remaining-work/concord-go-sidecar-proof.json` — before/after: event-loop blocked ms OR latency under parallel load  
- [ ] Commit + push  

**Done when:** 3 parallel Whisper/Piper requests do not stall `/api/system/health` / ConKay.

### Phase 2 — OCC long-lived daemon (kill per-request `execFile` 60s)
**Goal:** `occ-bridge.js` talks to a warm OCP process, not cold `python conkay_occ_cli.py` each call.

- [ ] Prefer **extend** `~/.zuko/venvs/cad-occ` with a **stdio/HTTP daemon** wrapping existing CLI commands (`feature-rebuild`, `mate-solve-dof`, etc.)  
- [ ] Optional later: Rust wrapper that owns the Python child  
- [ ] Queue OCC jobs (concurrency 1–2 — OpenCascade often not fully reentrant)  
- [ ] Node: `occ-bridge.js` → daemon; keep 60s timeout per job but no process spawn storm  
- [ ] Proof: `conkay-occ-daemon-proof.json` — N feature rebuilds, no stacked cold starts  
- [ ] Re-run industrial / solid-world cert scripts still PASS  

### Phase 3 — Rust DTU / SQLite hot path
**Goal:** Move hottest sync `better-sqlite3` read/write off Node event loop for DTU locker + economy hot queries.

- [ ] Spike: Rust service reading `/Users/dutch/concord/concord.db` (WAL) **read-mostly** first  
- [ ] API: get DTU by id, list recent, search — mirror what ConKay mint/locker needs  
- [ ] Node `/api/dtus` GET path delegates; POST can stay Node initially  
- [ ] Careful with dual-writer: prefer Node writes + Rust reads **or** single writer protocol  
- [ ] Proof: parallel 50× GET DTU vs baseline; health stays green  
- [ ] **Do not** rewrite all 145k lines of `dtus.js` — carve interfaces  

### Phase 4 — Go ollama-proxy / circuit breaker (after or when A40 returns)
**Goal:** Brain calls fail fast when tunnel dead; no 45–120s queue pileups.

- [ ] Proxy in front of `:11435` / Mac `:11434`  
- [ ] Per-model queues; circuit open on SSH/tunnel fail  
- [ ] Node brain-router points at proxy  
- [ ] NEED_DUTCH: Dutch resumes RunPod A40 before claiming 27B/14B again (`BRAIN_4LANE.md`)  

### Phase 5 — Rust DHTP matcher / compression blocks (optional deepen)
- [ ] Only after Phases 1–3 prove LIVE  
- [ ] Port hot DHTP packetize/match loops; keep Node API  

### Phase 6 — Node hygiene (parallel anytime, no new lang)
- [ ] Split `server.js` / `dtus.js` into modules **without** behavior change (mechanical)  
- [ ] Convert AUTH/STATE `readFileSync` → `fs.promises` on hot paths  
- [ ] Cap backup `writeFileSync` multi-MB stringify (already moved interval — verify)  
- [ ] Postgres: either stand up local PG or stop logging ECONNREFUSED spam (honest SQLite-primary)  
- [ ] Frontend: code-split giant lens `manifest.ts` / registry (secondary)

### Phase 7 — Ops leftovers (NEED_DUTCH — Claude documents, Dutch acts)
- [ ] Resume A40 RunPod + restore tunnel (commands in `LEFTOVERS-2026-09-08.md`)  
- [ ] Rotate Cloudflare Workers AI tokens in dashboard (scrubbed under `~/.zuko/secrets/`; live `.env` still has tokens for process)  
- [ ] Physical CMM / FDA — out of software scope  
- [ ] Coinbase — do not touch  

### Phase 8 — Browser e2e (if still open)
- [ ] Finish `conkay-toolbar-browser-e2e` → `browserE2E: true` (Mol click → `dtu=` → locker GET)  
- [ ] Harness: `concord-frontend/scripts/conkay-toolbar-browser-e2e.mjs`  
- [ ] Prior: login OK, Mol reachable with unity iframe stub; mint id parse flaky under :3000 load  

---

## 6. Language cheat-sheet (decision lock)

| Module | Language | Why |
|--------|----------|-----|
| Whisper / Piper / sandbox | **Go** | Kill spawnSync; easy process supervision |
| OCC B-rep | **Python daemon** first, Rust wrapper optional | Already cadquery-ocp on Mac |
| DTU + hot SQLite | **Rust** | Sync better-sqlite3 off loop |
| DHTP heavy match | **Rust** | CPU-bound |
| Ollama proxy / CB | **Go** | Concurrent queues + fast fail |
| Express / llm-queue / ConKay | **stay Node** | Async I/O OK |
| Full rewrite | **NO** | Months of downtime |

---

## 7. Proof / definition of done (whole program)

Write rolling status to:  
`~/.zuko/remaining-work/CONCURRENCY_REFACTOR_STATUS.md`

Program is **DONE** when:
1. Go sidecar LIVE + Node spawnSync paths for audio/sandbox gone or dead-code  
2. OCC daemon LIVE + industrial-class cert still PASS  
3. Rust DTU read path LIVE for locker GET under load without health flaps  
4. Audit finding #3 (spawnSync) and #6 (OCC execFile stacking) marked CLOSED in status  
5. Honesty doc updated — no claim of “Concord rewritten in Rust”

---

## 8. Suggested first Claude session (copy-paste)

```
Read ~/.zuko/remaining-work/CLAUDE_HANDOFF_CONCURRENCY_REFACTOR-2026-09-08.md
and the companion audit files it lists.
Execute Phase 0 + Phase 1 only (Go Whisper/Piper/sandbox sidecar).
Obey F0. Prove with ~/.zuko/remaining-work/concord-go-sidecar-proof.json.
Commit on handoff-cherry-pick. Do not touch Coinbase or pm2 delete.
Leave Mac-copy brains alone unless A40 is back.
```

---

## 9. Tip / context at handoff write time

- Git tip around concurrency handoff: see `git log -5 --oneline` on Mac (industrial CAD + verticals + DTU mint already landed earlier today)  
- Brains: Mac-copy degraded `:11434` — not 27B/14B  
- ConKay industrial / solid-world / verticals certs: CERTIFIED (PROXY honesty where noted)  

---

*End of handoff. Update this file’s checkboxes as phases complete.*
