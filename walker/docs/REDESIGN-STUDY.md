# REDESIGN STUDY — what thirteen lens redesigns teach the walker

**GB-1575 W1 · Seat B3 · 2026-11-20 · Branch walker/ulw-v3**

Ramaj's premise for this study: the thirteen lens redesigns reached the bar
through the `docs/LENS_REDESIGN_PLAYBOOK.md` process — an audit first, a real
browser drive last — and the walker should learn from what that process
caught. This document is the lesson set. Its companion file,
`walker/analysis/redesign_misses.jsonl`, carries every find as a machine-
readable row; each catchable miss names the concrete check that would catch
it, and those checks are W2's build list (GB-1575: "each catchable miss
becomes a new check in W2").

## Scope and sources

The thirteen of the founder's order (GB-1575, 2026-11-20 12:24 ET): PR #2396's
eight, live in Gate 2 on build 21303b4672 — Retail "The Stall", ConKay "The
Workshop", Studio "The Booth", Music "Liner Notes", Code "Proof", News "The
Situation Room", Market "The Auction House", Art "The Atelier" — and PR
#2398's five, open on base 21303b4672 — Podcast "The Transcript Page", DTUs
"The Binder", Film Studios "The Production Office", Animation "The Light
Table", Graph "The Star Chart". Two scope notes, flagged not silently
absorbed: the #2398 branch also carries Chat "The Notebook" (committed after
the Gate 2 freeze, in neither PR's thirteen) and Photos "The Darkroom"
(landed on the branch at 13:04 ET, after the order was posted). Photos is
included as flagged rows PH-01/PH-02 so the census is complete over the
branch as it stands; Chat is named here and not rowed, as it belongs to
neither PR as filed.

Every find below is grounded in a primary record, read entire for this
study: the two PR bodies; the full commit records of both branches (each
redesign's commits carry its audit finds in its own words); the desk review
of PR #2396 (Zuko 2, read-only, 2026-11-19); follow-up issues #2392–#2395;
the redesign playbook's identity registry; and B3's GB-1565 merge record
(the freeze assembly and its censuses). The ULW verdicts were determined by
keyword probes over the walk-1 ticket corpus (`audit/fix-list/fix_tickets.jsonl`,
3,526 tickets) for each find's signature — the probe terms are the defect's
own nouns (escrow, SSRF, BPM, runner, duplicate…), and each row quotes its
evidence. A "missed" verdict means: the lens was walked on a build carrying
the defect, and no ticket in the corpus names it.

## The headline: 62 finds — 1 caught, 2 partial, 59 missed

| ULW verdict | Count | What it means |
|---|---|---|
| Caught | 1 | FIX-animation-001: "GIF export downloads a .json file, not a GIF" — caught by reading downloaded bytes. |
| Partial | 2 | The symptom was filed, the mechanism wasn't: Studio's two-store divergence (FIX-011 saw mismatched track counts), Podcast's unusable upload (FIX-podcast-006; the 7.5 KB truncation is the audit's find). |
| Missed | 59 | Present on the walked build, named by no ticket. |

The misses are not random. They cluster into four families, and each family
is a place the walker's attention structurally does not go:

1. **Write-side trust (16 rows).** The walker's two-account machinery
   (`privacy_checks.py`) probes whether t1's private rows LEAK to t2 — a
   read-side probe. The redesigns' worst finds are the mirror image: t2's
   writes LANDING on t1 — coin theft by body-named identity (X-01), a map
   rewriting anyone's DTU (GR-01), podcast shows repointed by strangers
   (PC-02), collaborators added to projects the caller doesn't own (X-05).
   `isolation.py`'s own header records why: the machinery "fired only where
   a ticket or a flag asked for it — the second account appeared 7 times
   against 583 t1 checks." The probes exist; they are aimed at reads and
   fired on flags. The single highest-value change this study recommends:
   **the cross-account mutation probe (OWNER-MUTATION) and the actor-spoof
   probe (ACTOR-SPOOF) become standard per-lens phases, like C16 made
   isolation standard — not ticket-triggered options.**
2. **Fabrication and ground truth (9 rows).** Fake BPM/key/LUFS stamped on
   uploads (MU-01), invented transcript timestamps (PC-03), progress without
   playback (PC-04), exports that are JSON wearing a GIF's name (AN-01 —
   the one catch), durations rounded away (AN-04). The walker verifies
   that surfaces respond; the redesigns verified that what surfaces SAY is
   true, by holding an independently measured file or figure against them.
   `media_probes.py` already judges downloaded bytes — the probes below
   extend that discipline from exports to every claimed measurement.
3. **Census-shaped defects (14 rows).** Orphaned macros (52 caller-less
   actions at the Gate 2 merge; Animation's ~55; Studio's parity set),
   orphaned components, duplicate registers/players/tab systems, panels
   that never populate. No single screen shows these; they exist only in
   the join of the domain registry against the wiring capture — a join the
   walker already collects both sides of (`wiring.py`) and never inverts.
   MACRO-REACH and ORPHAN-CENSUS are arithmetic, not new machinery.
4. **No-signal defects (the rest).** Escrow asymmetry inside a service no
   route called (X-07), tests that test nothing (NW-01, GR-04), a wiring
   call the verifier couldn't see (NW-02), a case-only filename collision
   invisible to Linux (PL-01). A UI walk cannot reach these by
   construction; their catchers are code scans over `git show` at the walk
   build — exactly the dossier's section-3 flags in W2. The study's
   code-scan checks are written to run there.

A fifth, quieter lesson runs through the desk review's rows (X-02, X-03,
X-05, X-06): **a fix is itself a surface.** The actor-identity guard shipped
with a case-sensitivity bypass, an unlisted theft route, and a false 403
that broke an honest action. The walker replays fixes; these rows argue it
should replay them adversarially — the variant legs of ACTOR-SPOOF exist
because the desk review, not the build, thought to capitalise a letter.

## How to read the per-lens sections

Each row: **What** (the defect, in the record's own terms) · **How the
redesign found it** (which playbook step or review caught it — the pattern
is itself instructive: step 1 code audits found the trust family, step 6
browser drives found the races and persistence losses, the desk review
found the fix's own defects) · **ULW** (caught / partial / missed, with the
ticket or the empty probe as evidence) · **Catching check** (id, signal
class, one-line sketch; the full catalogue follows the lens sections) ·
**Defect class** (the frozen C35 vocabulary).


## Market — The Auction House

### X-01 — Coin theft through request-supplied identity

- **What:** Coin theft through request-supplied identity: POST /api/economic/marketplace/buy debited whatever account body.odId named (worked exploit of record: a fresh account 'bought' in a victim's name, victim 88 -> 83 CC). Same class on artistry purchases/listings (+ /api/creative-commerce alias), rights transfers, billing keys, frontier routes.
- **How the redesign found it:** Redesign audit (step 1) + live repro on a dev server during the build (commit 847cf80a8).
- **ULW:** MISSED — No ticket in the walk-1 corpus (probe: market x identity/theft/odId/buyerId = 0).
- **Catching check:** `ACTOR-SPOOF` (two-account) — As t2, submit t1's id in every actor-shaped field (odId, buyerId, ownerId, fromUserId, userId, hostId) on each write route the lens exposes; verdict requires 403/refusal AND t1's balance and objects byte-unchanged. Extends the foreign-row probe from reads to writes.
- **Defect class:** `ownerless-writes`

### X-02 — The shipped guard's own bypass

- **What:** The shipped guard's own bypass: actor-identity rules were case-sensitive regexes anchored with $ against req.path, while Express 5.3 routes case-insensitively and ignores trailing slashes — POST /api/Economic/marketplace/buy or a trailing slash reached the handler with the guard passed.
- **How the redesign found it:** Desk review of PR #2396 (Zuko 2, read-only), reproduced against express@5.3.0.
- **ULW:** MISSED — No ticket; the defect postdates walk 1 (it lives in the fix), recorded here because the catching check belongs to the same probe family.
- **Catching check:** `ACTOR-SPOOF-VARIANTS` (two-account) — The ACTOR-SPOOF probe repeats each spoofed write against case-variants and trailing-slash variants of the route; any variant that lands the write fails the lens.
- **Defect class:** `ownerless-writes`

### X-03 — Missed theft route

- **What:** Missed theft route: POST /api/lens-culture/purchase debited body.userId's ledger balance via purchaseArtifact and was not in the guard's ACTOR_RULES at all.
- **How the redesign found it:** Desk review of PR #2396 (route-by-route census of 183 write routes).
- **ULW:** MISSED — No ticket.
- **Catching check:** `ACTOR-CENSUS` (code-scan) — Static census over server routes: every write handler reading an actor-shaped field from body/query/params must either take the actor from the session or appear in the guard's rule set; an unlisted reader files. Runs over git show at the walk build.
- **Defect class:** `ownerless-writes`

### X-07 — Commission escrow over-release

- **What:** Commission escrow over-release: holdEscrow held agreed_price minus the 1.46% TRANSFER fee in __ESCROW__, but release/refund paid the full agreed_price — every approved commission drew the difference from other users' escrowed coin. Latent (no HTTP route called holdEscrow) and incomplete (the hold escrowed the caller-supplied amount, not agreed_price).
- **How the redesign found it:** Redesign audit of the Market backend (commit a59109f4b) + desk review (latent/incomplete halves).
- **ULW:** MISSED — No ticket (probe: market x escrow = 0). No UI or network signal existed pre-fix — the catching leg is the code-scan form.
- **Catching check:** `ESCROW-CONSERVE` (code-scan) — Code-scan over money services: hold and release/refund amounts must derive from ONE stored figure on the row (escrow_held), never recomputed from price or taken from the caller; where a hold route exists, the network form runs hold -> release and hold -> refund and asserts the shared account's balance returns exactly.
- **Defect class:** `silent-wrong-answers`

### PL-02 — Marketplace title counter read '/ 120' over an input whose cap (BOUNDS.TITLE) is 200

- **What:** Marketplace title counter read '/ 120' over an input whose cap (BOUNDS.TITLE) is 200 — the UI's stated limit contradicted the enforced one.
- **How the redesign found it:** Redesign build.
- **ULW:** MISSED — No ticket.
- **Catching check:** `LABEL-BOUND` (code-scan) — Rendered limit/counter text is compared against the enforced bound (maxlength attribute, BOUNDS constant, server validation); any disagreement files.
- **Defect class:** `silent-wrong-answers`

## Cross-cutting / platform

### X-04 — Path-param actors uncovered

- **What:** Path-param actors uncovered: /api/world/sim/progression/:userId/*, federation /users/:userId/location|preferences act on the named user without a self check; billing GET /keys/:userId and /usage/:userId let anyone read another user's data (the guard covers writes only).
- **How the redesign found it:** Desk review of PR #2396.
- **ULW:** MISSED — No ticket.
- **Catching check:** `PATHPARAM-ACTOR` (two-account) — For every route carrying a :userId-shaped param, t2 reads and writes t1's param value; any 2xx with t1's data or a landed write fails. Read routes included, not only writes.
- **Defect class:** `ownerless-writes`

### X-08 — Orphaned-action census

- **What:** Orphaned-action census: 25 lens actions lost their only frontend caller in PR #2396 by the desk review's count; B3's domain-qualified census at the freeze merge found 52 caller-less actions in the merged tree (studio x24, music x18, code x5, github x3, dtu.listByKind) — every backend macro verified still present. The Studio/Music parity question rides as an open founder call in issues #2393/#2394.
- **How the redesign found it:** Desk review census + B3's merge-time census (GB-1565).
- **ULW:** MISSED — No ticket; walk 1's wiring capture holds the raw material (controls exercised) but no census inverted it against the domain registry.
- **Catching check:** `MACRO-REACH` (code-scan) — Invert the wiring capture: domain macros (server/domains registry at the walk build) minus macros exercised by any control in the walk minus macros with a non-UI caller of record (agent/MCP) = the orphan list, filed per lens per walk. A macro that loses its last UI caller between walks files automatically.
- **Defect class:** `unwired-unreachable`

### PL-01 — Case-only filename collision

- **What:** Case-only filename collision: booth/MidiLearn.tsx and booth/midiLearn.ts differ only in case — APFS resolves the import to the wrong file on the Mac while Linux tsc is blind to it. Found by the desk's scratch build, invisible to every Linux-side check.
- **How the redesign found it:** Gate 2 desk scratch build (post-delivery), after B3's full Linux verification had passed the tree.
- **ULW:** MISSED — No ticket. Adopted the same night as a deploy-gate standing check (CB-0899) on B3's recommendation.
- **Catching check:** `CASE-COLLISION` (code-scan) — No two paths in the tree may differ only by case; the scan runs over the walk build's git ls-tree and files any colliding pair. (Already standing at the deploy gate per CB-0899; recorded here so the dossier carries it too.)
- **Defect class:** `silent-wrong-answers`

### PL-03 — 25 unreviewed SQL interpolation sites across 9 files sat under a red ratchet

- **What:** 25 unreviewed SQL interpolation sites across 9 files sat under a red ratchet — reviewed by hand in the redesign pass (all literal/constant/schema-derived) to turn the ratchet green.
- **How the redesign found it:** Redesign pass (ratchet read).
- **ULW:** MISSED — No ticket — the ratchet is a repo-side signal the walk never consumed.
- **Catching check:** `RATCHET-INPUT` (ci) — The walk's preflight reads the repo's ratchet states (SQL interpolation, security detector) at the walk build; a red ratchet on a walked lens's domain files as a finding with the sites named.
- **Defect class:** `silent-wrong-answers`

## Feed

### X-06 — False 403 introduced by the fix

- **What:** False 403 introduced by the fix: FeedTimelinePanel sent { userId: 'current-user' } to the collab join, which the new guard correctly refused — honest users would have hit a wall the redesign shipped.
- **How the redesign found it:** Desk review of PR #2396 (predicted, in writing, that 'the walker will log this as a regression on the Feed lens').
- **ULW:** MISSED — No ticket (the defect postdates walk 1).
- **Catching check:** `PLACEHOLDER-IDENTITY` (code-scan) — Code-scan: client code must never send literal identity placeholders ('current-user', 'me', 'self') in actor fields. Walker leg: every legitimate write a lens offers must complete for its owner — a 403 on an owner's own action files as a finding, not a pass.
- **Defect class:** `silent-wrong-answers`

## Retail — The Stall

### RT-01 — Duplicate primary surface

- **What:** Duplicate primary surface: a second register (RetailWorkbench) lived in a drawer beside LivePosTerminal and CommerceSuite, under two stacked tab strips and shared chrome panels (NorthStarFrame, ShellPreview, RealtimeDataPanel).
- **How the redesign found it:** Redesign audit step 1 (surface inventory) — the playbook's stacking census.
- **ULW:** MISSED — No ticket (probe: retail x duplicate/register = 0).
- **Catching check:** `DUP-SURFACE` (ui) — From the walk's DOM/control inventory: two distinct mounts offering the same primary verb on the same domain objects (two registers, two players, two tab systems for one lens) files as a stacking finding with both mounts named.
- **Defect class:** `unwired-unreachable`

### RT-02 — Double-cart race

- **What:** Double-cart race: two fast taps on an empty register opened two carts.
- **How the redesign found it:** Playbook step 6 — the full-day browser drive against a real backend.
- **ULW:** MISSED — No ticket.
- **Catching check:** `RAPID-REPEAT` (ui) — Fire the lens's primary create action twice in immediate succession (double-click timing); exactly one object may exist afterwards, verified by API read-back.
- **Defect class:** `silent-wrong-answers`

### RT-03 — Till-close ledger refused as duplicate_blocked whenever a previous close shared shop/date/figures

- **What:** Till-close ledger refused as duplicate_blocked whenever a previous close shared shop/date/figures — the DTU gate refuses exact-title repeats store-wide, so a legitimate repeated close could never mint.
- **How the redesign found it:** Playbook step 6 — browser drive (close twice with identical figures).
- **ULW:** MISSED — No ticket.
- **Catching check:** `REPEAT-IDENTICAL` (network) — Perform the same legitimate action twice with byte-identical payloads (close, publish, submit); the second must succeed or refuse with a reason the user can act on — a duplicate-content refusal on a distinct real event fails.
- **Defect class:** `silent-wrong-answers`

### RT-04 — A section page wrapper defined as a component inside render remounted every panel on any parent re-render, dro

- **What:** A section page wrapper defined as a component inside render remounted every panel on any parent re-render, dropping panel state.
- **How the redesign found it:** Redesign build (wiring the section views), playbook step 5's 'never define components inside render' rule.
- **ULW:** MISSED — No ticket.
- **Catching check:** `RENDER-DEF` (code-scan) — Static pattern over lens components: a component declared inside another component's render body files, with the state-drop consequence named.
- **Defect class:** `silent-wrong-answers`

### RT-05 — Discount desync on line edit

- **What:** Discount desync on line edit: editing a cart line did not re-sync the applied discount (fixed-amount codes kept their value as the subtotal moved; a code whose minimum stopped being met had to be dropped and reported — neither happened).
- **How the redesign found it:** Redesign backend build (register primitives, commit f2b756286) with adversarial tests.
- **ULW:** MISSED — No ticket.
- **Catching check:** `READBACK-RECONCILE` (network) — After any mutation sequence the walk performs (apply code -> edit line -> change qty), read the object back through the API and assert the domain invariants (totals = sum of lines - discount; code state consistent with its minimum) rather than trusting the UI's displayed figures.
- **Defect class:** `silent-wrong-answers`

## ConKay — The Workshop

### CK-01 — One product fragmented across four pages (lens, demo, designs, workbench), each mounting its own shell of the 

- **What:** One product fragmented across four pages (lens, demo, designs, workbench), each mounting its own shell of the same app.
- **How the redesign found it:** Redesign audit step 1.
- **ULW:** MISSED — No ticket.
- **Catching check:** `ROUTE-FRAGMENT` (code-scan) — Census: routes serving one domain that mount disjoint shells with duplicated navigation file as a fragmentation observation for the dossier (W2), ranked by duplicated control count.
- **Defect class:** `unwired-unreachable`

### CK-02 — React 'synchronously unmount a root while rendering' error on every load

- **What:** React 'synchronously unmount a root while rendering' error on every load: drei <Html> created one React root per beam label.
- **How the redesign found it:** Redesign build + browser verification (console read).
- **ULW:** MISSED — No ticket — the walk captures console output, but no zero-console-error gate turned it into a finding here.
- **Catching check:** `CONSOLE-CLEAN` (ui) — A lens load + primary-flow drive with any console error (framework errors named separately from network 4xx) files; the walk already captures the signal — the check is the gate that prices it.
- **Defect class:** `greeting-dead-surfaces`

### CK-03 — A newly designed object did not update the URL

- **What:** A newly designed object did not update the URL — reloading lost it.
- **How the redesign found it:** Redesign browser verification.
- **ULW:** MISSED — No ticket.
- **Catching check:** `RELOAD-PERSIST` (ui) — After creating/opening an object, reload the page: the object must still be addressable and open (URL or restored state); losing it files.
- **Defect class:** `silent-wrong-answers`

### CK-04 — The overlay backdrop was a clickable div

- **What:** The overlay backdrop was a clickable div — pointer-only, no keyboard path (Escape now the keyboard route).
- **How the redesign found it:** Redesign build (a11y pass).
- **ULW:** MISSED — No ticket.
- **Catching check:** `A11Y-SEMANTICS` (code-scan) — Clickable elements that are not buttons/links and carry no role/tabindex file per lens; the keyboard leg then drives the same overlays by keyboard alone.
- **Defect class:** `native-dialog-dead-controls`

## Studio — The Booth

### ST-01 — The Parity workbench edited a second copy of the song (project.tracks/clips/midiNotes) that the audio engine n

- **What:** The Parity workbench edited a second copy of the song (project.tracks/clips/midiNotes) that the audio engine never plays (it plays project.daw) — a whole surface of edits that silently did nothing audible. ~24 parity-store macros now have no Studio UI (issue #2393, founder call pending).
- **How the redesign found it:** Redesign audit (tracing which store the engine reads).
- **ULW:** PARTIAL — FIX-011 caught the symptom ('Demo vs Parity workbench track count mismatch') — the divergence was seen; the root cause (two stores, one never played) was the audit's find.
- **Catching check:** `DUAL-STORE` (network) — Where two surfaces present the same object, edit through one and read through the other AND through the engine's own read path; any divergence files with both stores named. Census form: two writable stores for one domain object file on sight.
- **Defect class:** `silent-wrong-answers`

### ST-02 — 48 dead or duplicate files removed, including ~18 pre-rebuild components sitting behind an unused barrel expor

- **What:** 48 dead or duplicate files removed, including ~18 pre-rebuild components sitting behind an unused barrel export — importable, plausible, and mounted nowhere.
- **How the redesign found it:** Redesign audit (import-graph census).
- **ULW:** MISSED — No ticket.
- **Catching check:** `ORPHAN-CENSUS` (code-scan) — Components under components/<lens>/ with no import path from the lens's mounted tree file per walk (the dossier's mounted-vs-orphaned inventory, W2 section 1, run as a check).
- **Defect class:** `unwired-unreachable`

### ST-03 — Input-validation gaps across markers/midi/fx-rack macros

- **What:** Input-validation gaps across markers/midi/fx-rack macros: NaN beat positions, unbounded section/map/chain counts, unvalidated colour strings, non-finite params — all accepted and stored.
- **How the redesign found it:** Redesign hardening build (commit 6606ffa57) under playbook step 3's validate-hard rule.
- **ULW:** MISSED — No ticket — formfuzz works the UI's forms; these are macro-level inputs behind them.
- **Catching check:** `MACRO-FUZZ` (network) — Extend formfuzz below the form: for each create/update macro the lens exposes, submit the adversarial value set (NaN, Infinity, '1e999', negatives, booleans, oversized counts, injection-shaped text) directly; acceptance of a value the domain cannot mean files, and refused calls must write nothing (read-back).
- **Defect class:** `silent-wrong-answers`

### ST-04 — Solo collab-edit with no session open returned { ok

- **What:** Solo collab-edit with no session open returned { ok:false, 'no active session' } — every solo publish logged a 400, training users to ignore real errors.
- **How the redesign found it:** Redesign build (console read during the drive).
- **ULW:** MISSED — No ticket.
- **Catching check:** `HAPPY-PATH-CLEAN` (network) — The lens's canonical happy path (create -> edit -> publish solo) must produce zero 4xx/5xx in the netledger; error noise on legitimate paths files.
- **Defect class:** `greeting-dead-surfaces`

## Music — Liner Notes

### MU-01 — The upload path stamped fabricated metadata on every track

- **What:** The upload path stamped fabricated metadata on every track: BPM 128, key Am, -14 LUFS, artist 'You' — invented analysis presented as measured fact.
- **How the redesign found it:** Redesign audit (comparing stored metadata against a known file).
- **ULW:** MISSED — No ticket (probe: music x bpm/fake/metadata = 0).
- **Catching check:** `MEDIA-GROUNDTRUTH` (media) — Upload a file whose true properties are measured independently first (duration, tempo, dimensions); every figure the lens stores or displays must equal the measurement or be honestly blank — a constant value across two different files files on sight.
- **Defect class:** `generation-as-execution`

### MU-02 — Two balances that never synced

- **What:** Two balances that never synced: economy_ledger (what the wallet shows; purchases land there) vs an in-memory wallet map that purchaseWithRoyalties checked — a fan holding 98.54 CC was refused every purchase with insufficient_balance, balance 0. The balance endpoint also read the raw map and showed 0.
- **How the redesign found it:** Playbook step 6 — driving the lens in a real browser with a funded account (commit f9bc69c61, owner-approved fix).
- **ULW:** MISSED — No ticket. Money routes are deny-listed out of the walker's two-account probes by design — the gap is a sanctioned money-probe lane, named in the study.
- **Catching check:** `BALANCE-COHERE` (network) — In the test-account lane (C24 ruling: test accounts only, money OFF in prod): fund through the real coin-purchase path, then read the balance at every surface (wallet, balance endpoint, purchase check) and spend; all readings must agree at every step.
- **Defect class:** `silent-wrong-answers`

### MU-03 — dtu.create returns a presentation copy over HTTP (_presentDtuPublic); licensing that copy never reached the st

- **What:** dtu.create returns a presentation copy over HTTP (_presentDtuPublic); licensing that copy never reached the stored DTU, so marketplace.list refused with license_scope_denied — publishing over HTTP was broken while internal callers worked. Issue #2394 flags the same latent bug in engineering.mint-and-list / asset-marketplace (ruled: fix after walk 2).
- **How the redesign found it:** Redesign build (publishing a release end to end over HTTP), pinned with an HTTP-shaped (non-internal) context.
- **ULW:** MISSED — No ticket.
- **Catching check:** `HTTP-ROUNDTRIP` (network) — Flows must be exercised over HTTP exactly as a client does them (create -> mutate -> list/read), never via internal calls; a step that only works internally files. The presentation-copy mutation pattern is the named genus: mutating a returned object must persist, or the API must refuse honestly.
- **Defect class:** `silent-wrong-answers`

### MU-04 — Publish state kept in memory only

- **What:** Publish state kept in memory only: a cover's public flip and a release DTU's scope/licence/listing evaporated on backend restart — fans got 404 no_artifact for covers of published releases.
- **How the redesign found it:** Redesign verification (restart the backend, re-read as a new fan).
- **ULW:** MISSED — No ticket.
- **Catching check:** `RESTART-PERSIST` (network) — Against a staging backend: publish through the lens, restart the backend, re-read every public surface as a second account; anything that 404s or reverts files. (Runs in the CI/staging lane, not against prod.)
- **Defect class:** `silent-wrong-answers`

### MU-05 — Macro families with no Liner Notes surface (issue #2394)

- **What:** Macro families with no Liner Notes surface (issue #2394): jam-*, dj-session, ai-playlist, device-*, download-*, share-card, concert-listings, friend-activity, scheduled-playlist-*, playlist-collab-edit, track-lyrics-*/lyrics-autofetch, stream-analytics, publish-as-stem, mb-* — all registered and agent-callable, none reachable by a person.
- **How the redesign found it:** Redesign audit (macro census vs the new surface).
- **ULW:** MISSED — No ticket.
- **Catching check:** `MACRO-REACH` (code-scan) — As X-08: the per-lens orphan list, with the agent/MCP-only set named separately so a deliberate agent-only macro is a decision, not a discovery.
- **Defect class:** `unwired-unreachable`

## Code — Proof

### CD-01 — Every in-browser run hung

- **What:** Every in-browser run hung: the PWA service worker answered web-worker scripts cache-first and the worker never started. Compounded in the runner: module workers could not load Turbopack's importScripts bootstrap, load time was counted as run time, files with export failed 'exports is not defined', and a silent runner was never replaced.
- **How the redesign found it:** Redesign build (running real code in the browser runner).
- **ULW:** MISSED — No ticket (probe: code x runner/hang/worker = 0).
- **Catching check:** `RUNNER-TRUTH` (ui) — In any lens offering run/execute: run a trivial program with known output and a deliberate error; the run must return the true output/error within a time budget, and reported run time must exclude load time. A hang files as a dead surface, not a slow one.
- **Defect class:** `greeting-dead-surfaces`

### CD-02 — The TypeScript language service resolved no relative imports between project files

- **What:** The TypeScript language service resolved no relative imports between project files — multi-file projects typechecked against a phantom.
- **How the redesign found it:** Redesign build.
- **ULW:** MISSED — No ticket.
- **Catching check:** `MULTIFILE-FIXTURE` (ui) — Seed a two-file project with a relative import (one correct, one deliberately broken); the lens's type check must pass the first and flag the second at the right file/line.
- **Defect class:** `silent-wrong-answers`

### CD-03 — Diff arithmetic

- **What:** Diff arithmetic: an empty base counted as one removed line, so a file added to an empty project showed a phantom removal.
- **How the redesign found it:** Redesign build (proof-diff), pinned by a behaviour test.
- **ULW:** MISSED — No ticket.
- **Catching check:** `DIFF-ARITH` (ui) — Add a file of N lines to an empty project: the diff must read +N / -0. Edit one line: +1 / -1. Counts are read from the UI and the API and must agree.
- **Defect class:** `silent-wrong-answers`

### CD-04 — The workbench collapsed to its 420px floor whenever a full-screen overlay sat at the bottom edge.

- **What:** The workbench collapsed to its 420px floor whenever a full-screen overlay sat at the bottom edge.
- **How the redesign found it:** Redesign build + browser drive.
- **ULW:** MISSED — No ticket.
- **Catching check:** `OVERLAY-GEOM` (ui) — Open each full-screen overlay the lens has; the underlying workbench's geometry must survive (height within tolerance of the no-overlay reading) — extends the overflow/offscreen family from horizontal to overlay states.
- **Defect class:** `silent-wrong-answers`

### CD-05 — A blank rename in the file pane vanished silently

- **What:** A blank rename in the file pane vanished silently — the user could not tell the rename was cancelled (the code-003 regression genus).
- **How the redesign found it:** Post-redesign fix pass on the #2398 branch; the genus test guarded it, the new UI had reintroduced it.
- **ULW:** MISSED — No ticket.
- **Catching check:** `CANCEL-ACK` (ui) — Blank or escape out of every inline edit (rename, title, name); the surface must show the cancellation (or keep the editor open) — a silent no-op files.
- **Defect class:** `silent-wrong-answers`

### NW-02 — Proof called lensRun('code', ...) through a non-literal domain expression, so the wiring verifier could not se

- **What:** Proof called lensRun('code', ...) through a non-literal domain expression, so the wiring verifier could not see the Code lens at all — a lens invisible to the platform's own reachability tooling.
- **How the redesign found it:** Redesign build (the wiring verifier's blind spot, found from the verifier's side).
- **ULW:** MISSED — No ticket.
- **Catching check:** `WIRING-LITERAL` (code-scan) — lensRun/macro invocations must name their domain as a string literal; a computed domain files, and any domain the verifier cannot see files as unreachable-by-tooling.
- **Defect class:** `unwired-unreachable`

## News — The Situation Room

### NW-01 — Five news tests failed wherever DNS was unavailable and tested nothing where it was

- **What:** Five news tests failed wherever DNS was unavailable and tested nothing where it was: the fetch stubs were bypassed by the SSRF-guarded fetch, so the suites exercised the live network or nothing.
- **How the redesign found it:** Redesign build (running the domain suite in a no-DNS environment).
- **ULW:** MISSED — No ticket — a test-integrity defect, invisible to a UI walk by construction; the catcher is a CI-lane check.
- **Catching check:** `STUB-TRANSPORT` (ci) — Domain suites must route fetches through the test transport: run the suite with egress disabled — it must stay green; a suite that only passes with live network, or whose stubs the SSRF chokepoint bypasses, files.
- **Defect class:** `silent-wrong-answers`

## Art — The Atelier

### X-05 — /api/artistry/collab/share

- **What:** /api/artistry/collab/share: the guard stops a spoofed ownerId, but the handler never checks the caller owns the project — anyone could add collaborators to any project by simply omitting ownerId. Identity-correct, ownership-absent.
- **How the redesign found it:** Desk review of PR #2396.
- **ULW:** MISSED — No ticket.
- **Catching check:** `OWNER-MUTATION` (two-account) — t2 attempts create/update/delete/share on t1's objects by id, sending t2's OWN identity correctly everywhere; any landed mutation fails. This is the general form of the podcast/graph/film ownership finds — run it on every lens's object verbs, not only where a ticket points.
- **Defect class:** `ownerless-writes`

### AR-01 — The pieces drawer crashed on art-dashboard's promptOfTheDay shape

- **What:** The pieces drawer crashed on art-dashboard's promptOfTheDay shape — the macro returns {category, text}, the drawer read it as a string.
- **How the redesign found it:** Redesign browser drive.
- **ULW:** MISSED — No ticket (probe: art x crash/prompt = 0).
- **Catching check:** `PANEL-SWEEP` (ui) — On a seeded account holding real data in the lens's own shapes, open every panel, drawer and tab; any error boundary or crash files with the panel named. (Walk 1 opened panels on largely empty accounts, where shape bugs hide.)
- **Defect class:** `silent-wrong-answers`

## Podcast — The Transcript Page

### PC-01 — SSRF

- **What:** SSRF: rss-refresh fetched any user-supplied URL with plain fetch — an open server-side request forgery on a creator surface.
- **How the redesign found it:** Redesign audit (code read of the refresh path), fixed to the SSRF-guarded fetchPublicUrl.
- **ULW:** MISSED — No ticket (probe: podcast x ssrf/fetch = 0). formfuzz submits bad input to forms; it does not aim URL-ingesting fields at internal targets.
- **Catching check:** `SSRF-PROBE` (network) — Network form: submit loopback/link-local/internal URLs to every URL-ingesting field; any fetched response files. Scan form: server code fetching a user-supplied URL outside fetchPublicUrl files on sight (W2 dossier flag).
- **Defect class:** `ownerless-writes`

### PC-02 — Missing ownership checks across the creator surface

- **What:** Missing ownership checks across the creator surface: anyone could repoint any show's feed URL, add episodes to any show, overwrite any transcript, and edit/delete RSS-imported episodes.
- **How the redesign found it:** Redesign audit (handler-by-handler ownership read).
- **ULW:** MISSED — The walk-1-era Product pass noted the unowned-show episode form as an untested §8 observation — seen, never exercised. No ULW ticket.
- **Catching check:** `OWNER-MUTATION` (two-account) — As X-05, aimed at creator surfaces: t2 attempts feed repoint, episode add, transcript overwrite, edit and delete on t1's show; every one must refuse and write nothing.
- **Defect class:** `ownerless-writes`

### PC-03 — Fabricated transcript timings

- **What:** Fabricated transcript timings: plain-text transcripts were given invented proportional timestamps, presented as real timings a read-along could follow.
- **How the redesign found it:** Redesign audit (comparing displayed timings against the source transcript).
- **ULW:** MISSED — No ticket.
- **Catching check:** `FABRICATION-PROBE` (media) — Supply input with NO timing/metadata (plain-text transcript, silent file, unmeasured track); any precise-looking derived figure the surface presents as fact (timestamps, BPM, durations) files — honest 'untimed/estimated' labelling passes.
- **Defect class:** `generation-as-execution`

### PC-04 — A 'Listen 5m' button added five minutes of listening progress without any audio playing

- **What:** A 'Listen 5m' button added five minutes of listening progress without any audio playing — progress as a button press, not a fact.
- **How the redesign found it:** Redesign audit.
- **ULW:** MISSED — No ticket. (The Product pass filed the playback-ledger family — plays unrecorded, positions unsaved — the opposite failure of the same ledger.)
- **Catching check:** `PROGRESS-TRUTH` (ui) — With media paused/never started, click every progress-shaped control; listening progress, play counts and positions must not move. Then play for a measured interval: progress must move by that interval, read back through the API.
- **Defect class:** `generation-as-execution`

### PC-05 — Uploads silently truncated at ~7.5 KB

- **What:** Uploads silently truncated at ~7.5 KB: the JSON /api/media/upload base64 field is cut by the request sanitizer (upload_truncated), so no real episode ever uploaded through it.
- **How the redesign found it:** Redesign audit (uploading a real file and comparing bytes).
- **ULW:** PARTIAL — FIX-podcast-006 caught the surface ('Episode audio upload unusable — click-to-browse and drag-drop never attach a file'); the truncation mechanism and the endpoint rule are the audit's find.
- **Catching check:** `UPLOAD-TRUTH` (network) — Upload files of ladder sizes (7 KB, 100 KB, 10 MB, 100 MB where the lens claims them) through the lens's own path; stored byte count and hash must equal the sent file at every rung, and the endpoint used must be the raw endpoint, never the JSON base64 one.
- **Defect class:** `silent-wrong-answers`

### PC-06 — Three separate players and two stacked tab systems in one lens; eleven panels removed in the redesign includin

- **What:** Three separate players and two stacked tab systems in one lens; eleven panels removed in the redesign including an orphaned ItunesPodcastPanel.
- **How the redesign found it:** Redesign audit step 1 (surface inventory).
- **ULW:** MISSED — No ticket.
- **Catching check:** `DUP-SURFACE` (ui) — As RT-01: duplicate players are the named genus — two live media players for one catalogue file in the census.
- **Defect class:** `unwired-unreachable`

## DTUs — The Binder

### DT-01 — Publishing ran no verification check at all

- **What:** Publishing ran no verification check at all: knowledge DTUs could be published (and listed on the marketplace) with no current, non-refuted receipt from the verification gate, and empirical claims needed no declared source — on every publish path (publishDTU and marketplace.list).
- **How the redesign found it:** Redesign audit (reading the publish paths end to end).
- **ULW:** MISSED — No ticket (probe: dtus x publish/verif = 0).
- **Catching check:** `PUBLISH-GATE` (network) — On test accounts: publish a knowledge DTU with no receipt, with a refuted receipt, and an empirical claim with no source, through EVERY publish path the platform exposes; each must refuse. Then publish a properly receipted DTU: it must succeed (the gate is a gate, not a wall).
- **Defect class:** `ownerless-writes`

### DT-02 — The old browse mixed machine rows into the public catalogue

- **What:** The old browse mixed machine rows into the public catalogue: error reports, chat memory, notes and till records sat beside works and knowledge, unlabelled.
- **How the redesign found it:** Redesign audit (catalogue census by DTU class).
- **ULW:** MISSED — No ticket for dtus (the class itself is of record from Timeline/Podcast instances).
- **Catching check:** `CATALOG-PURITY` (ui) — Public browse surfaces are censused by row class: personal-context and system rows (error reports, chat memory, internal consolidations) must never appear; hidden classes must be counted and labelled where a filter reveals them.
- **Defect class:** `test-content-on-prod`

### DT-03 — Published cards never reached the library while the DTU sat on the 'local' federation tier

- **What:** Published cards never reached the library while the DTU sat on the 'local' federation tier — published, and invisible where readers look.
- **How the redesign found it:** Redesign build (publish -> library round trip).
- **ULW:** MISSED — No ticket.
- **Catching check:** `PUBLISH-VISIBILITY` (two-account) — Publish as t1, then find the item in the public library/browse as t2 and signed out; a published item unreachable in the public surface files.
- **Defect class:** `unwired-unreachable`

## Film Studios — The Production Office

### FS-01 — Uploads over 10 MB were cut by the Next proxy (its body limit) while the backend's raw cap is 200 MB

- **What:** Uploads over 10 MB were cut by the Next proxy (its body limit) while the backend's raw cap is 200 MB — real footage could never arrive, with the failure surfacing far from its cause.
- **How the redesign found it:** Redesign build (uploading real footage).
- **ULW:** MISSED — No ticket (probe: film-studios x upload/proxy = 0).
- **Catching check:** `UPLOAD-TRUTH` (network) — As PC-05, with the size ladder run to the lens's claimed maximum and each rung's failure attributed to its layer (proxy vs backend vs sanitizer) in the finding.
- **Defect class:** `silent-wrong-answers`

### FS-02 — The stream access rule did not honour licences

- **What:** The stream access rule did not honour licences: buyers lost access to a film after the maker withdrew it — a purchase that evaporates on the seller's later action.
- **How the redesign found it:** Redesign backend build (release/shop work).
- **ULW:** MISSED — No ticket.
- **Catching check:** `LICENCE-PERSIST` (two-account) — t2 buys t1's priced release (test lane); t1 withdraws it; t2's access must stand, and a non-buyer's must not open. Withdrawal semantics are read from the served build, not assumed.
- **Defect class:** `silent-wrong-answers`

### FS-03 — Two never-mounted components shipped in the lens (removed in the redesign); the review and watch-party panels 

- **What:** Two never-mounted components shipped in the lens (removed in the redesign); the review and watch-party panels were replaced wholesale by the screening room.
- **How the redesign found it:** Redesign audit (import-graph census).
- **ULW:** MISSED — No ticket.
- **Catching check:** `ORPHAN-CENSUS` (code-scan) — As ST-02.
- **Defect class:** `unwired-unreachable`

## Animation — The Light Table

### AN-01 — Export was partly fake

- **What:** Export was partly fake: GIF and PNG 'exports' downloaded a JSON file, and MP4 fell back to the same JSON — the download succeeded, the artifact was a lie about its format.
- **How the redesign found it:** The walk itself: FIX-animation-001 ('GIF export downloads a .json file, not a GIF'). The redesign fixed the whole family (real WebCodecs/GIF/PNG-ZIP encoders).
- **ULW:** CAUGHT — FIX-animation-001 (walk-1 ticket corpus). The one clean catch in this study — and it came from reading downloaded bytes, the media_probes discipline.
- **Catching check:** `EXPORT-TRUTH` (media) — Every export/download a lens offers: the delivered bytes' magic numbers and container must match the claimed format (GIF89a, PNG, MP4 ftyp, WebM), and a media export must decode to the real content. Formalizes the FIX-animation-001 catch into a standing probe for every lens with an export.
- **Defect class:** `generation-as-execution`

### AN-02 — The soundtrack was never uploaded at all

- **What:** The soundtrack was never uploaded at all — a headline feature silently absent end to end (no upload, no playback, no export mix).
- **How the redesign found it:** Redesign audit (tracing the soundtrack feature's data path to its missing first step).
- **ULW:** MISSED — No ticket.
- **Catching check:** `ATTACH-ROUNDTRIP` (media) — For every attach/upload affordance: upload a real file, reload, and consume it at every surface that claims it (player, share page, export); absence at any surface files with the surface named.
- **Defect class:** `unwired-unreachable`

### AN-03 — Share pages could not play

- **What:** Share pages could not play: a shared animation opened but its media would not stream (and share tokens were weak — now 128-bit random).
- **How the redesign found it:** Redesign backend build (share-grant rework).
- **ULW:** MISSED — No ticket.
- **Catching check:** `SHARE-PROBE` (network) — Open every share link signed out: the shared media must play/stream; revoke the link: it must stop. Token form: share tokens are censused for entropy (>=128-bit random) in the code-scan leg (TOKEN-ENTROPY).
- **Defect class:** `permission-walls`

### AN-04 — Uploaded durations were rounded to whole seconds

- **What:** Uploaded durations were rounded to whole seconds — short renders lost their length everywhere duration is shown or enforced.
- **How the redesign found it:** Redesign build.
- **ULW:** MISSED — No ticket.
- **Catching check:** `DURATION-FIDELITY` (media) — Upload media of 1.4 s and 2.6 s true duration; stored/displayed durations must hold sub-second truth (within a frame), never whole-second rounding.
- **Defect class:** `silent-wrong-answers`

### AN-05 — setMediaSaleTerms stretched every preview to 15 s regardless of the caller's floor

- **What:** setMediaSaleTerms stretched every preview to 15 s regardless of the caller's floor — a priced animation could not have the shorter (or no) preview its maker set.
- **How the redesign found it:** Redesign build (media-sale terms path).
- **ULW:** MISSED — No ticket.
- **Catching check:** `PREVIEW-TERMS` (network) — Set preview terms (30 s, 5 s, none) on priced media in the test lane; stream enforcement as a non-buyer must match the set terms exactly, per the platform's 30 s signed-out rule where it applies.
- **Defect class:** `silent-wrong-answers`

### AN-06 — The lens was badged 'Simulated' although it is the animator's own real work (now REAL_WORKSPACE)

- **What:** The lens was badged 'Simulated' although it is the animator's own real work (now REAL_WORKSPACE) — a declaration lying about the surface's nature.
- **How the redesign found it:** Redesign audit (registry vs reality).
- **ULW:** MISSED — No ticket.
- **Catching check:** `BADGE-TRUTH` (code-scan) — A lens whose macros write real user data must not carry a Simulated badge, and a Simulated surface must not write; registry declarations are diffed against the domain's actual write set per walk.
- **Defect class:** `stale-vocabulary`

### AN-07 — ~55 macros exposed by the animation domain were mounted nowhere in the lens (GB-1575's figure from the redesig

- **What:** ~55 macros exposed by the animation domain were mounted nowhere in the lens (GB-1575's figure from the redesign audit).
- **How the redesign found it:** Redesign audit (macro census).
- **ULW:** MISSED — No ticket.
- **Catching check:** `MACRO-REACH` (code-scan) — As X-08/MU-05.
- **Defect class:** `unwired-unreachable`

## Graph — The Star Chart

### GR-01 — A graph map could rewrite anyone's DTU

- **What:** A graph map could rewrite anyone's DTU: link-node-dtu took any existing id, and node-update / sync-to-dtu then wrote the map node's label and notes into that DTU's title and content — someone else's published work, seed knowledge, anything.
- **How the redesign found it:** Redesign backend audit (security read of the map write path), commit 68d59d289.
- **ULW:** MISSED — No ticket (probe: graph x authorization/rewrite = 0). The walk's graph findings were load failures (FIX-graph-006) — the surface broke before its write path could be exercised.
- **Catching check:** `OWNER-MUTATION` (two-account) — As X-05 — graph is the canonical instance: link t1's DTU into t2's map, edit the node, sync; t1's DTU must be byte-unchanged.
- **Defect class:** `ownerless-writes`

### GR-02 — Lineage shape bug

- **What:** Lineage shape bug: dtu.create stores lineage as a bare array when given lineage: [], but the graph index only read lineage.parents — those children had no edges in any graph view. Lineage existed; the graph silently showed none.
- **How the redesign found it:** Redesign backend build (index read against the create shape).
- **ULW:** MISSED — No ticket.
- **Catching check:** `LINEAGE-ROUNDTRIP` (network) — Create a child DTU declaring lineage in each shape the API accepts; the edge must appear in graph reads (and the parent's 'built on by') for every accepted shape.
- **Defect class:** `silent-wrong-answers`

### GR-03 — The Genome view was always empty

- **What:** The Genome view was always empty — a live-looking surface rendering nothing for every user (folded into the catalogue card's lineage in the redesign).
- **How the redesign found it:** Redesign audit.
- **ULW:** MISSED — No ticket naming the Genome view (FIX-graph-006 covers Maps/Mind map load failures, a different surface).
- **Catching check:** `PANEL-POPULATION` (ui) — On a seeded account whose data must populate it, every panel must render its real content or an honest empty state that names why; a panel empty for every seed files as a dead surface.
- **Defect class:** `greeting-dead-surfaces`

### GR-04 — A server test that never ran

- **What:** A server test that never ran: dtu-lineage-link-union.test.js was written for vitest, which the server tree does not run — the lineage behaviour it pinned was unguarded while looking guarded.
- **How the redesign found it:** Redesign build (porting the test to node:test).
- **ULW:** MISSED — No ticket — CI-lane class.
- **Catching check:** `TEST-RUNNER-CENSUS` (ci) — Every test file in the tree must be collected by exactly one runner in CI; a file no runner collects files, and collected-count is diffed against file-count per walk.
- **Defect class:** `silent-wrong-answers`

## Photos — The Darkroom (14th, in-flight)

### PH-01 — A list fallback dropped the favourite flag

- **What:** A list fallback dropped the favourite flag — photos marked favourite read back unfavourited through the fallback path.
- **How the redesign found it:** Redesign backend build (commit dc1f0b89b).
- **ULW:** MISSED — No ticket. Flagged row: Photos postdates the founder's thirteen; included so the census is complete over the branch as it stands.
- **Catching check:** `FIELD-FIDELITY` (network) — Toggle each boolean/flag field on an object; read it back through EVERY list/get path (including fallbacks); any path dropping the field files.
- **Defect class:** `silent-wrong-answers`

### PH-02 — Photography's Lightroom catalog panels were unmounted dead weight inside the old lens.

- **What:** Photography's Lightroom catalog panels were unmounted dead weight inside the old lens.
- **How the redesign found it:** Redesign audit.
- **ULW:** MISSED — No ticket. Flagged row, as PH-01.
- **Catching check:** `ORPHAN-CENSUS` (code-scan) — As ST-02.
- **Defect class:** `unwired-unreachable`


# The new-check catalogue

Every check named by a row above, once, with its full sketch. W2 builds from this list; the JSONL rows carry the same ids.

### A11Y-SEMANTICS — Interactive-semantics scan

- **Signal:** code-scan · **Home:** `labels.py / keyboard.py` · **Filed by rows:** CK-04
- **Sketch:** Clickable elements that are not buttons/links and carry no role/tabindex file per lens; the keyboard leg then drives the same overlays by keyboard alone.

### ACTOR-CENSUS — Actor-field census

- **Signal:** code-scan · **Home:** `wiring.py (registry join)` · **Filed by rows:** X-03
- **Sketch:** Static census over server routes: every write handler reading an actor-shaped field from body/query/params must either take the actor from the session or appear in the guard's rule set; an unlisted reader files. Runs over git show at the walk build.

### ACTOR-SPOOF — Actor-spoof probe

- **Signal:** two-account · **Home:** `privacy_checks.py / isolation.py` · **Filed by rows:** X-01
- **Sketch:** As t2, submit t1's id in every actor-shaped field (odId, buyerId, ownerId, fromUserId, userId, hostId) on each write route the lens exposes; verdict requires 403/refusal AND t1's balance and objects byte-unchanged. Extends the foreign-row probe from reads to writes.

### ACTOR-SPOOF-VARIANTS — Actor-spoof route-variant leg

- **Signal:** two-account · **Home:** `privacy_checks.py` · **Filed by rows:** X-02
- **Sketch:** The ACTOR-SPOOF probe repeats each spoofed write against case-variants and trailing-slash variants of the route; any variant that lands the write fails the lens.

### ATTACH-ROUNDTRIP — Attachment round-trip probe

- **Signal:** media · **Home:** `media_probes.py` · **Filed by rows:** AN-02
- **Sketch:** For every attach/upload affordance: upload a real file, reload, and consume it at every surface that claims it (player, share page, export); absence at any surface files with the surface named.

### BADGE-TRUTH — Badge-truth scan

- **Signal:** code-scan · **Home:** `wiring.py` · **Filed by rows:** AN-06
- **Sketch:** A lens whose macros write real user data must not carry a Simulated badge, and a Simulated surface must not write; registry declarations are diffed against the domain's actual write set per walk.

### BALANCE-COHERE — Balance-coherence probe

- **Signal:** network · **Home:** `netledger.py` · **Filed by rows:** MU-02
- **Sketch:** In the test-account lane (C24 ruling: test accounts only, money OFF in prod): fund through the real coin-purchase path, then read the balance at every surface (wallet, balance endpoint, purchase check) and spend; all readings must agree at every step.

### CANCEL-ACK — Cancelled-edit acknowledgement leg

- **Signal:** ui · **Home:** `checks.py` · **Filed by rows:** CD-05
- **Sketch:** Blank or escape out of every inline edit (rename, title, name); the surface must show the cancellation (or keep the editor open) — a silent no-op files.

### CASE-COLLISION — Case-collision path scan

- **Signal:** code-scan · **Home:** `ci_verify.py` · **Filed by rows:** PL-01
- **Sketch:** No two paths in the tree may differ only by case; the scan runs over the walk build's git ls-tree and files any colliding pair. (Already standing at the deploy gate per CB-0899; recorded here so the dossier carries it too.)

### CATALOG-PURITY — Catalogue-purity probe

- **Signal:** ui · **Home:** `checks.py` · **Filed by rows:** DT-02
- **Sketch:** Public browse surfaces are censused by row class: personal-context and system rows (error reports, chat memory, internal consolidations) must never appear; hidden classes must be counted and labelled where a filter reveals them.

### CONSOLE-CLEAN — Zero-console-error load gate

- **Signal:** ui · **Home:** `observe.py / checks.py` · **Filed by rows:** CK-02
- **Sketch:** A lens load + primary-flow drive with any console error (framework errors named separately from network 4xx) files; the walk already captures the signal — the check is the gate that prices it.

### DIFF-ARITH — Diff-arithmetic probe

- **Signal:** ui · **Home:** `checks.py` · **Filed by rows:** CD-03
- **Sketch:** Add a file of N lines to an empty project: the diff must read +N / -0. Edit one line: +1 / -1. Counts are read from the UI and the API and must agree.

### DUAL-STORE — Dual-store divergence probe

- **Signal:** network · **Home:** `readback.py` · **Filed by rows:** ST-01
- **Sketch:** Where two surfaces present the same object, edit through one and read through the other AND through the engine's own read path; any divergence files with both stores named. Census form: two writable stores for one domain object file on sight.

### DUP-SURFACE — Duplicate-surface census

- **Signal:** ui · **Home:** `checks.py (snapshot census)` · **Filed by rows:** RT-01, PC-06
- **Sketch:** From the walk's DOM/control inventory: two distinct mounts offering the same primary verb on the same domain objects (two registers, two players, two tab systems for one lens) files as a stacking finding with both mounts named.

### DURATION-FIDELITY — Duration-fidelity probe

- **Signal:** media · **Home:** `media_probes.py` · **Filed by rows:** AN-04
- **Sketch:** Upload media of 1.4 s and 2.6 s true duration; stored/displayed durations must hold sub-second truth (within a frame), never whole-second rounding.

### ESCROW-CONSERVE — Escrow conservation check

- **Signal:** code-scan · **Home:** `wiring.py / dossier code-scan flags (W2)` · **Filed by rows:** X-07
- **Sketch:** Code-scan over money services: hold and release/refund amounts must derive from ONE stored figure on the row (escrow_held), never recomputed from price or taken from the caller; where a hold route exists, the network form runs hold -> release and hold -> refund and asserts the shared account's balance returns exactly.

### EXPORT-TRUTH — Export-truth probe

- **Signal:** media · **Home:** `media_probes.py` · **Filed by rows:** AN-01
- **Sketch:** Every export/download a lens offers: the delivered bytes' magic numbers and container must match the claimed format (GIF89a, PNG, MP4 ftyp, WebM), and a media export must decode to the real content. Formalizes the FIX-animation-001 catch into a standing probe for every lens with an export.

### FABRICATION-PROBE — Fabrication probe

- **Signal:** media · **Home:** `media_probes.py` · **Filed by rows:** PC-03
- **Sketch:** Supply input with NO timing/metadata (plain-text transcript, silent file, unmeasured track); any precise-looking derived figure the surface presents as fact (timestamps, BPM, durations) files — honest 'untimed/estimated' labelling passes.

### FIELD-FIDELITY — Field-fidelity read-back

- **Signal:** network · **Home:** `readback.py` · **Filed by rows:** PH-01
- **Sketch:** Toggle each boolean/flag field on an object; read it back through EVERY list/get path (including fallbacks); any path dropping the field files.

### HAPPY-PATH-CLEAN — Happy-path cleanliness leg

- **Signal:** network · **Home:** `netcheck.py` · **Filed by rows:** ST-04
- **Sketch:** The lens's canonical happy path (create -> edit -> publish solo) must produce zero 4xx/5xx in the netledger; error noise on legitimate paths files.

### HTTP-ROUNDTRIP — HTTP-shape round-trip leg

- **Signal:** network · **Home:** `netcheck.py` · **Filed by rows:** MU-03
- **Sketch:** Flows must be exercised over HTTP exactly as a client does them (create -> mutate -> list/read), never via internal calls; a step that only works internally files. The presentation-copy mutation pattern is the named genus: mutating a returned object must persist, or the API must refuse honestly.

### LABEL-BOUND — Label-vs-bound scan

- **Signal:** code-scan · **Home:** `wiring.py` · **Filed by rows:** PL-02
- **Sketch:** Rendered limit/counter text is compared against the enforced bound (maxlength attribute, BOUNDS constant, server validation); any disagreement files.

### LICENCE-PERSIST — Licence-persistence probe

- **Signal:** two-account · **Home:** `privacy_checks.py (test-account lane)` · **Filed by rows:** FS-02
- **Sketch:** t2 buys t1's priced release (test lane); t1 withdraws it; t2's access must stand, and a non-buyer's must not open. Withdrawal semantics are read from the served build, not assumed.

### LINEAGE-ROUNDTRIP — Lineage round-trip probe

- **Signal:** network · **Home:** `netcheck.py` · **Filed by rows:** GR-02
- **Sketch:** Create a child DTU declaring lineage in each shape the API accepts; the edge must appear in graph reads (and the parent's 'built on by') for every accepted shape.

### MACRO-FUZZ — Macro-level adversarial fuzz

- **Signal:** network · **Home:** `formfuzz.py` · **Filed by rows:** ST-03
- **Sketch:** Extend formfuzz below the form: for each create/update macro the lens exposes, submit the adversarial value set (NaN, Infinity, '1e999', negatives, booleans, oversized counts, injection-shaped text) directly; acceptance of a value the domain cannot mean files, and refused calls must write nothing (read-back).

### MACRO-REACH — Macro-reachability census

- **Signal:** code-scan · **Home:** `wiring.py` · **Filed by rows:** X-08, MU-05, AN-07
- **Sketch:** Invert the wiring capture: domain macros (server/domains registry at the walk build) minus macros exercised by any control in the walk minus macros with a non-UI caller of record (agent/MCP) = the orphan list, filed per lens per walk. A macro that loses its last UI caller between walks files automatically.

### MEDIA-GROUNDTRUTH — Media ground-truth probe

- **Signal:** media · **Home:** `media_probes.py` · **Filed by rows:** MU-01
- **Sketch:** Upload a file whose true properties are measured independently first (duration, tempo, dimensions); every figure the lens stores or displays must equal the measurement or be honestly blank — a constant value across two different files files on sight.

### MULTIFILE-FIXTURE — Multi-file fixture probe

- **Signal:** ui · **Home:** `checks.py` · **Filed by rows:** CD-02
- **Sketch:** Seed a two-file project with a relative import (one correct, one deliberately broken); the lens's type check must pass the first and flag the second at the right file/line.

### ORPHAN-CENSUS — Orphan-component census

- **Signal:** code-scan · **Home:** `wiring.py` · **Filed by rows:** ST-02, FS-03, PH-02
- **Sketch:** Components under components/<lens>/ with no import path from the lens's mounted tree file per walk (the dossier's mounted-vs-orphaned inventory, W2 section 1, run as a check).

### OVERLAY-GEOM — Overlay-geometry leg

- **Signal:** ui · **Home:** `checks.py (overflow family)` · **Filed by rows:** CD-04
- **Sketch:** Open each full-screen overlay the lens has; the underlying workbench's geometry must survive (height within tolerance of the no-overlay reading) — extends the overflow/offscreen family from horizontal to overlay states.

### OWNER-MUTATION — Cross-account object-mutation probe

- **Signal:** two-account · **Home:** `privacy_checks.py / isolation.py` · **Filed by rows:** X-05, PC-02, GR-01
- **Sketch:** t2 attempts create/update/delete/share on t1's objects by id, sending t2's OWN identity correctly everywhere; any landed mutation fails. This is the general form of the podcast/graph/film ownership finds — run it on every lens's object verbs, not only where a ticket points.

### PANEL-POPULATION — Panel-population probe

- **Signal:** ui · **Home:** `checks.py` · **Filed by rows:** GR-03
- **Sketch:** On a seeded account whose data must populate it, every panel must render its real content or an honest empty state that names why; a panel empty for every seed files as a dead surface.

### PANEL-SWEEP — Seeded panel sweep

- **Signal:** ui · **Home:** `checks.py` · **Filed by rows:** AR-01
- **Sketch:** On a seeded account holding real data in the lens's own shapes, open every panel, drawer and tab; any error boundary or crash files with the panel named. (Walk 1 opened panels on largely empty accounts, where shape bugs hide.)

### PATHPARAM-ACTOR — Path-param actor probe

- **Signal:** two-account · **Home:** `privacy_checks.py` · **Filed by rows:** X-04
- **Sketch:** For every route carrying a :userId-shaped param, t2 reads and writes t1's param value; any 2xx with t1's data or a landed write fails. Read routes included, not only writes.

### PLACEHOLDER-IDENTITY — Placeholder-identity scan + legitimate-action leg

- **Signal:** code-scan · **Home:** `wiring.py` · **Filed by rows:** X-06
- **Sketch:** Code-scan: client code must never send literal identity placeholders ('current-user', 'me', 'self') in actor fields. Walker leg: every legitimate write a lens offers must complete for its owner — a 403 on an owner's own action files as a finding, not a pass.

### PREVIEW-TERMS — Preview-terms probe

- **Signal:** network · **Home:** `netcheck.py` · **Filed by rows:** AN-05
- **Sketch:** Set preview terms (30 s, 5 s, none) on priced media in the test lane; stream enforcement as a non-buyer must match the set terms exactly, per the platform's 30 s signed-out rule where it applies.

### PROGRESS-TRUTH — Progress-truth probe

- **Signal:** ui · **Home:** `media_probes.py` · **Filed by rows:** PC-04
- **Sketch:** With media paused/never started, click every progress-shaped control; listening progress, play counts and positions must not move. Then play for a measured interval: progress must move by that interval, read back through the API.

### PUBLISH-GATE — Publish-gate probe

- **Signal:** network · **Home:** `privacy_checks.py (test-account lane)` · **Filed by rows:** DT-01
- **Sketch:** On test accounts: publish a knowledge DTU with no receipt, with a refuted receipt, and an empirical claim with no source, through EVERY publish path the platform exposes; each must refuse. Then publish a properly receipted DTU: it must succeed (the gate is a gate, not a wall).

### PUBLISH-VISIBILITY — Publish-visibility round trip

- **Signal:** two-account · **Home:** `netcheck.py` · **Filed by rows:** DT-03
- **Sketch:** Publish as t1, then find the item in the public library/browse as t2 and signed out; a published item unreachable in the public surface files.

### RAPID-REPEAT — Rapid-repeat action probe

- **Signal:** ui · **Home:** `formfuzz.py / clickpersist.py` · **Filed by rows:** RT-02
- **Sketch:** Fire the lens's primary create action twice in immediate succession (double-click timing); exactly one object may exist afterwards, verified by API read-back.

### RATCHET-INPUT — Ratchet-state walk input

- **Signal:** ci · **Home:** `ci_verify.py` · **Filed by rows:** PL-03
- **Sketch:** The walk's preflight reads the repo's ratchet states (SQL interpolation, security detector) at the walk build; a red ratchet on a walked lens's domain files as a finding with the sites named.

### READBACK-RECONCILE — Invariant read-back probe

- **Signal:** network · **Home:** `readback.py` · **Filed by rows:** RT-05
- **Sketch:** After any mutation sequence the walk performs (apply code -> edit line -> change qty), read the object back through the API and assert the domain invariants (totals = sum of lines - discount; code state consistent with its minimum) rather than trusting the UI's displayed figures.

### RELOAD-PERSIST — Reload-persistence leg

- **Signal:** ui · **Home:** `clickpersist.py` · **Filed by rows:** CK-03
- **Sketch:** After creating/opening an object, reload the page: the object must still be addressable and open (URL or restored state); losing it files.

### RENDER-DEF — Component-in-render scan

- **Signal:** code-scan · **Home:** `wiring.py` · **Filed by rows:** RT-04
- **Sketch:** Static pattern over lens components: a component declared inside another component's render body files, with the state-drop consequence named.

### REPEAT-IDENTICAL — Repeat-identical action leg

- **Signal:** network · **Home:** `clickpersist.py` · **Filed by rows:** RT-03
- **Sketch:** Perform the same legitimate action twice with byte-identical payloads (close, publish, submit); the second must succeed or refuse with a reason the user can act on — a duplicate-content refusal on a distinct real event fails.

### RESTART-PERSIST — Restart-persistence leg

- **Signal:** network · **Home:** `netcheck.py` · **Filed by rows:** MU-04
- **Sketch:** Against a staging backend: publish through the lens, restart the backend, re-read every public surface as a second account; anything that 404s or reverts files. (Runs in the CI/staging lane, not against prod.)

### ROUTE-FRAGMENT — Route-family fragmentation census

- **Signal:** code-scan · **Home:** `wiring.py` · **Filed by rows:** CK-01
- **Sketch:** Census: routes serving one domain that mount disjoint shells with duplicated navigation file as a fragmentation observation for the dossier (W2), ranked by duplicated control count.

### RUNNER-TRUTH — Runner-truth probe

- **Signal:** ui · **Home:** `media_probes.py / checks.py` · **Filed by rows:** CD-01
- **Sketch:** In any lens offering run/execute: run a trivial program with known output and a deliberate error; the run must return the true output/error within a time budget, and reported run time must exclude load time. A hang files as a dead surface, not a slow one.

### SHARE-PROBE — Signed-out share probe

- **Signal:** network · **Home:** `netcheck.py` · **Filed by rows:** AN-03
- **Sketch:** Open every share link signed out: the shared media must play/stream; revoke the link: it must stop. Token form: share tokens are censused for entropy (>=128-bit random) in the code-scan leg (TOKEN-ENTROPY).

### SSRF-PROBE — SSRF probe + raw-fetch scan

- **Signal:** network · **Home:** `formfuzz.py / wiring.py` · **Filed by rows:** PC-01
- **Sketch:** Network form: submit loopback/link-local/internal URLs to every URL-ingesting field; any fetched response files. Scan form: server code fetching a user-supplied URL outside fetchPublicUrl files on sight (W2 dossier flag).

### STUB-TRANSPORT — Stub-transport audit

- **Signal:** ci · **Home:** `ci_verify.py` · **Filed by rows:** NW-01
- **Sketch:** Domain suites must route fetches through the test transport: run the suite with egress disabled — it must stay green; a suite that only passes with live network, or whose stubs the SSRF chokepoint bypasses, files.

### TEST-RUNNER-CENSUS — Test-runner census

- **Signal:** ci · **Home:** `ci_verify.py` · **Filed by rows:** GR-04
- **Sketch:** Every test file in the tree must be collected by exactly one runner in CI; a file no runner collects files, and collected-count is diffed against file-count per walk.

### UPLOAD-TRUTH — Upload-truth probe

- **Signal:** network · **Home:** `media_probes.py` · **Filed by rows:** PC-05, FS-01
- **Sketch:** Upload files of ladder sizes (7 KB, 100 KB, 10 MB, 100 MB where the lens claims them) through the lens's own path; stored byte count and hash must equal the sent file at every rung, and the endpoint used must be the raw endpoint, never the JSON base64 one.

### WIRING-LITERAL — Wiring-literal scan

- **Signal:** code-scan · **Home:** `wiring.py` · **Filed by rows:** NW-02
- **Sketch:** lensRun/macro invocations must name their domain as a string literal; a computed domain files, and any domain the verifier cannot see files as unreachable-by-tooling.


# What this means for W2, and the limits of this study

## The check set, by home

The 54 checks in the catalogue group into four build shapes for W2:

- **Standard-phase probes (the trust family).** ACTOR-SPOOF (+VARIANTS),
  OWNER-MUTATION, PATHPARAM-ACTOR, PUBLISH-GATE, SSRF-PROBE,
  PUBLISH-VISIBILITY, LICENCE-PERSIST, SHARE-PROBE. These belong in
  `privacy_checks.py` / `isolation.py` as phases that run on every lens
  with the objects to exercise them — the C16 precedent (isolation became
  standard) applied to writes. Money-bearing legs (BALANCE-COHERE,
  ESCROW-CONSERVE's network form, PUBLISH-GATE, LICENCE-PERSIST) run in
  the test-account lane under the C24 ruling — test accounts only, money
  OFF in prod; the walker never touches a real balance.
- **Ground-truth probes.** EXPORT-TRUTH, MEDIA-GROUNDTRUTH,
  FABRICATION-PROBE, PROGRESS-TRUTH, UPLOAD-TRUTH, ATTACH-ROUNDTRIP,
  DURATION-FIDELITY, PREVIEW-TERMS. Home: `media_probes.py`, fed by a
  small library of independently measured fixture files (known duration,
  known tempo, known bytes at ladder sizes).
- **Censuses and scans (offline, over the walk build).** MACRO-REACH,
  ORPHAN-CENSUS, DUP-SURFACE, ACTOR-CENSUS, RENDER-DEF, WIRING-LITERAL,
  A11Y-SEMANTICS, BADGE-TRUTH, LABEL-BOUND, PLACEHOLDER-IDENTITY,
  CASE-COLLISION, ESCROW-CONSERVE (scan form), SSRF-PROBE (scan form),
  TOKEN-ENTROPY, ROUTE-FRAGMENT. These are the dossier's section-1/3
  inventories run as verdicts, and they need no browser at all — they run
  over walk 2's finished output plus `git show` at 21303b4672.
- **Drive legs (small, per-lens, in the existing harness).** RAPID-REPEAT,
  REPEAT-IDENTICAL, RELOAD-PERSIST, RESTART-PERSIST (staging lane),
  READBACK-RECONCILE, FIELD-FIDELITY, LINEAGE-ROUNDTRIP, DUAL-STORE,
  HTTP-ROUNDTRIP, MACRO-FUZZ, RUNNER-TRUTH, MULTIFILE-FIXTURE,
  DIFF-ARITH, OVERLAY-GEOM, CANCEL-ACK, PANEL-SWEEP, PANEL-POPULATION,
  CONSOLE-CLEAN, HAPPY-PATH-CLEAN, CATALOG-PURITY, plus the CI-lane trio
  STUB-TRANSPORT, TEST-RUNNER-CENSUS, RATCHET-INPUT.

## Priority, if W2 builds in order

1. OWNER-MUTATION + ACTOR-SPOOF as standard phases — the family with live
   theft in it, on machinery that already exists.
2. MACRO-REACH + ORPHAN-CENSUS — pure arithmetic over data the walk
   already holds; they also feed the dossier's distance-to-bar score.
3. EXPORT-TRUTH + UPLOAD-TRUTH — the ground-truth family's proven members
   (one caught find, one partial), cheap to generalise.
4. PUBLISH-GATE — the platform's core promise (verified knowledge) had no
   gate at all on its publish paths; the probe is small and the claim is
   central.
5. Everything else in catalogue order.

## Limits, stated plainly

- **Verdicts rest on ticket-corpus probes, quoted as probed.** A "missed"
  verdict means no ticket in `fix_tickets.jsonl` names the defect's
  signature terms; the corpus is the walk's filed output, and a defect the
  walk noticed but filed under unrelated words would read as missed here.
  The two partials and the one catch were read in full text, not just
  probed. The study claims the pattern (four families), not omniscience
  about any single row.
- **The redesign records are the finds' source of truth, and they are
  commit messages and PR bodies** — written by the builders of the
  redesigns. Where a second record exists (desk review, issues, the
  GB-1565 censuses) the study prefers it; the actor-identity rows rest on
  the desk review's reproduced evidence, not the PR's summary.
- **Photos is flagged, not ordered.** PH-01/PH-02 ride the #2398 branch
  but postdate GB-1575; if the office rules Photos out of the study, the
  two rows delete cleanly and the counts become 60 finds / 58 missed.
  Chat "The Notebook" is named in the scope note and not rowed.
- **Checks are sketches, not builds.** Each names its signal, its home
  module, and the assertion that files. W2 owns the implementations and
  their selftests; where a sketch and the dossier's section-3 flag list
  overlap (SSRF raw-fetch, owner checks, truncating uploads, money outside
  ledger paths, fabricated data), the dossier flag and the check are the
  same instrument seen from two sides, and W2 should build it once.
- **Nothing here touches walk 2.** The branch is walker/ulw-v3; the one PR
  opens after walk 2 ends, per GB-1575. The 76 standing selftests are
  untouched by this study's files (docs + analysis + one new selftest that
  validates the analysis file's own integrity).

*— B3, Concordia & Game lane. Sources and row data: `walker/analysis/redesign_misses.jsonl` (this branch); the study's working papers (PR bodies, commit records, desk review, issues #2392–#2395, corpus probes) were read entire on 2026-11-20.*
