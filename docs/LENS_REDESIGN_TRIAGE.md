# Lens redesign triage — 2026-11-28

Every lens is a flagship: each is judged as its own product against its
category leader, and each goes through the full
`docs/LENS_REDESIGN_PLAYBOOK.md` pass. This triage does not decide which
lenses deserve less. It decides **order, grouping, and what each lens needs
before its build can start.**

State: 267 lens directories, 17 redesigned (the playbook Identity registry),
250 to go.

## How this was measured

Read-only. Every signal is reproducible:

```
node scripts/detect-lens-stacking.mjs          # → audit/lens-stacking.json
node scripts/grade-ux-polish.mjs --honest      # → audit/ux-polish.json
node scripts/grade-macro-depth.mjs --honest    # → audit/macro-depth-honest.json
node scripts/lens-triage-signals.mjs --out /tmp/lens-triage.json
git checkout -- audit/                          # regenerated artifacts are not committed
```

`scripts/lens-triage-signals.mjs` reads each lens's page and component tree,
finds its primary backend domain, and records: macros on that domain and how
many the lens names; honest backend depth; money and ledger references;
request-first identity; `Math.random` and mock-word counts; stacking score;
polish tier; capability-map state. Plus the four detectors
(`frontend-fake-data`, `fake-data`, `money-txn-hygiene`, `authz-coverage`)
and a live HTTP probe of the one security finding below.

Signals are leads, not verdicts. Each lens still gets its own step-1 audit.

### What the numbers say overall

- **Wiring is not the problem.** 266 of 267 lenses call their backend
  (`verify-lens-backends`), and most name nearly every macro on their primary
  domain somewhere in their files.
- **The polish grader cannot rank these lenses.** It rates 247 of the 250
  "polished" (the exceptions: `strategic-adds` raw, `aviation` and `world`
  functional). The playbook already notes it is blind to stacking and to
  identity. None of the 250 has a playbook identity, so by the playbook's bar
  every one of them still needs its pass.
- **The detectors find little fake data.** `frontend-fake-data` flags 3 weak
  placeholders. The `Math.random` and mock-word hits were checked by hand:
  procedural game content in the shared Concordia components, map tile
  sampling, graph layout jitter, physics bodies the person spawns, a shuffle,
  Monte Carlo sampling, and `sampleRate` in the EEG workbench. None is
  fabricated data shown as live. (One note: `components/sim/SimConsole.tsx`
  samples unseeded, so its runs cannot be repeated; fix in its pass.) The
  older audits found fake data by reading code, not by these scans, so every
  step-1 audit still reads.
- **What does separate the lenses** is risk (money, identity), backend depth,
  shared groundwork, and duplication. That is what the queue below is built on.

---

## P0 — before any lens: request-first identity in macros (security)

**Confirmed live 2026-11-28.** Many macros take the acting user from the
request first and fall back to the session:

```js
const userId = input.userId || ctx?.actor?.userId;
```

The 2026-11-19 guard (`server/lib/actor-identity.js`) pins identity on a list
of REST routes. It does not cover `POST /api/lens/run`, where these macros run.

Live proof on a fresh dev server, two real signed-up accounts, signed in as
the attacker, passing the victim's id:

- `conkay.affect_state` returned the victim's private emotional-state record
  (valence 0.338, arousal 0.534, dominance 0.608 — identical to what the victim
  reads).
- `conkay.observe` wrote to the victim's record (their turn count went from 1
  to 2 and their values moved).

The same shape (`input|params.(userId|ownerId|actorId|playerId) || ctx…`)
sits at 46 places in 15 domain files: `housing` (10), `video` (8), `conkay`
(5), `secrets` (3), `lfg` (3), `contrib` (3), `robolab`, `metacog`, `decomp`,
`combat-polish`, `beats` (2 each), `training-room`, `substrate-finish`,
`player-corpse`, `achievements` (1 each). Reproduce:

```
grep -cE "\b(input|params|body|data)\.(userId|ownerId|actorId|playerId)\s*(\|\||\?\?)\s*(ctx|aid|uid|actor)" server/domains/*.js | grep -v ":0$"
```

Worst: `video.upload-to-youtube`, `video.youtube-disconnect` and
`video.generate` would let a caller act on **another person's connected
YouTube account** with their stored token (same code shape; not run live —
it needs a real Google connection).

A wider scan (any of `sellerId`, `creatorId`, `payerId`… first) lists 27
files, but most of those name a *target* (who should pay a request, whose
public reviews to show), which is correct. Those are left for each lens's
step-1 audit.

**Fix (one place, like the REST guard):** in the `/api/lens/run` path, refuse
(403) any call whose actor fields (`userId`, `ownerId`, `actorId`, `playerId`)
differ from the signed-in user, then change the 46 sites to session-first.
Pin with a two-account test like the probe above. Needs the owner's go-ahead;
it touches shared server code.

---

## The queue

Families are the batching unit: lenses that share research, backend
primitives or a destination go together, so the second and third in a family
go faster. **Each lens still gets its own identity, reference product and
look.** Order within a family is by the signals.

### Wave 1 — money and identity (real defects hide here)

Lenses whose primary domain moves Concord Coin or holds someone's assets.
Money references on the primary domain, highest first: `crypto` 75,
`realestate` 75, `black-market` 26, `electrical` 23, `travel` 22, `finance`
21, `fashion` 18, `services` 17, `marketplace` 15, `markets` 14, `pharmacy`
14, `inheritance` 13, `dreams` 11, `events` 11, `crafting` 10, `trades` 10,
`plumbing` 9, `food` 8, `energy` 7, `accounting` 5, `diy` 5, `engineering` 5.

| Order | Family | Lenses | Why here |
|---|---|---|---|
| 1 | Property | `housing`, `realestate` | `housing` carries 10 of the P0 sites; `realestate` is the highest money count |
| 2 | Finance | `finance`, `wallet`, `markets`, `staking`, `billing`, `crypto`, `black-market` | the coin itself; deepest money paths |
| 3 | Marketplace | `marketplace`, `sponsorship`, `questmarket`, `marketing`, `auction` | buy/sell paths beside the shipped Auction House (`market`) |
| 4 | Cover | `insurance`, `death-insurance`, `inheritance` | payouts and estates; `insurance` and `death-insurance` share one backend |
| 5 | Ledger | `accounting`, `ledger` | the books; `accounting` is the deepest backend in the queue |

### Wave 2 — the big working families

| Order | Family (destination) | Lenses |
|---|---|---|
| 6 | Healthcare | `healthcare`, `pharmacy`, `mental-health`, `fitness`, `wellness`, `veterinary`, `organ`, `meditation` |
| 7 | Legal | `legal`, `law`, `disputes`, `ethics`, `audit`, `privacy` |
| 8 | Trades | `trades`, `carpentry`, `plumbing`, `electrical`, `hvac`, `welding`, `masonry`, `construction`, `home-improvement`, `diy` |
| 9 | Projects | `projects`, `consulting`, `careers`, `hr`, `services`, `supplychain`, `manufacturing`, `ops`, `logistics` |
| 10 | Time | `calendar`, `events`, `event-timeline`, `sessions`, `timeline` |
| 11 | Messages and people | `message`, `mail`, `thread`, `forum`, `social`, `feed`, `collab` |
| 12 | Council | `council`, `government`, `vote`, `alliance`, `federation`, `civic-bonds` |
| 13 | Analytics | `analytics`, `forecast`, `inference`, `ml`, `hypothesis`, `neuro` |
| 14 | Research | `research`, `paper`, `science`, `philosophy`, `linguistics`, `history`, `mentorship`, `debate`, `answers`, `reasoning`, `grounding`, `translation` |
| 15 | Lab | `lab`, `physics`, `chem`, `quantum`, `materials`, `math`, `engineering`, `robotics`, `astronomy`, `space`, `geology`, `ocean`, `environment`, `energy`, `aviation`, `mining`, `forestry`, `agriculture`, `landscaping`, `desert`, `telecommunications`, `bio` |
| 16 | Agents | `agents`, `personas`, `expert-mode` |

### Wave 3 — everyday life and making

| Order | Family | Lenses |
|---|---|---|
| 17 | Home and life | `food`, `cooking`, `household`, `parenting`, `pets`, `travel`, `automotive`, `garage`, `sports`, `goals`, `daily`, `productivity`, `nonprofit`, `legacy` |
| 18 | Making | `creator`, `fashion`, `photography`, `gallery`, `maker`, `artistry`, `creative`, `creative-writing`, `poetry`, `literary`, `voice`, `whiteboard`, `docs`, `ar`, `game-design`, `app-maker`, `game` |
| 19 | Learning | `srs`, `classroom` |
| 20 | Civic and safety | `urban-planning`, `emergency-services`, `law-enforcement`, `defense`, `crisis-ops`, `security` |

### Wave 4 — Concordia (the world lens is the canonical surface)

`world` first: it is the heaviest stacked lens in CLAUDE.md, the polish
grader rates it only "functional", and every game lens below mounts the same
world components. Then the modes and systems that live inside it:

`sandbox`, `self`, `society`, `fishing`, `creatures`, `courtship`, `kingdoms`,
`quests`, `crafting`, `tournaments`, `lfg`, `achievements`, `detective`,
`training-room`, `ghost-tracker`, `move-builder`, `spectate`, `codex`,
`deities`, `goddess`, `genesis`, `world-creator`, `sub-worlds`,
`concord-link-frontier`, `frontier`, `expedition-journal`, `announcements`,
`world-observatory`, `narrative-walk`.

Per the CLAUDE.md invariant, each of these must work from inside
`/lenses/world` first; its standalone page is redesigned second.

### Wave 5 — Concord's own mind and the platform

These have no outside category leader in the usual sense, so **the owner
names the reference for each** before its pass:

- **Cognition:** `cognition`, `metacognition`, `metalearning`,
  `understanding`, `attention`, `affect`, `reflection`, `suffering`, `dreams`,
  `resonance`, `cognitive-replay`, `worldmodel`, `commonsense`, `cri`,
  `temporal`, `fractal`, `lattice`, `invariant`, `psyops`, `observe`,
  `experience`, `eco`, `sim`, `entity`, `meta`.
- **Platform and operators:** `admin`, `ops-telemetry`, `debug`, `system`,
  `schema`, `queue`, `tick`, `sync`, `offline`, `import`, `export`,
  `integrations`, `byo-keys`, `settings`, `lock`, `root`, `repair-telemetry`,
  `code-quality`, `sentinel`, `platform`, `dx-platform`, `plugins`, `mesh`,
  `bridge`, `transfer`, `all`, `saved`, `custom`, `tools`, `ux-suite`,
  `strategic-adds`, `database`, `repos`, `ingest`, `command-center`,
  `global`, `fork`, `anon`, `vault`, `bounties`.

The order inside a wave can change. P0 and Wave 1 should not move.

---

## Before the build: what each lens needs first

### Backend first (honest depth below 0.55)

Build or deepen the engine before designing the screen:
`genesis` 0.244, `achievements` 0.28, `literary` 0.327, `home-improvement`
0.357, `concord-link-frontier` 0.4, `byo-keys` 0.406, `courtship` 0.438,
`command-center` 0.445, `detective` 0.45, `training-room` 0.45,
`event-timeline` 0.473, `emergency-services` 0.491, `law-enforcement` 0.503,
`personas` 0.52, `settings` 0.533, `expert-mode` 0.541, `root` 0.545.

### No macro domain of their own

`auction`, `civic-bonds`, `frontier`, `narrative-walk`, `ops-telemetry`,
`plugins`, `world-observatory`. Some use REST routes (`ops-telemetry` reads
the admin telemetry endpoints); `narrative-walk` is a reader by design. Each
step-1 audit says whether a backend is needed.

### Heavily stacked pages (stacking score 2 or more)

A consolidation pass (`docs/LENS_CONSOLIDATION_PLAYBOOK.md`) comes before the
redesign: `collab` 3.82, `careers` 3.5, `civic-bonds` 2.74, `personas` 2.5,
`world-observatory` 2.38, `quests` 2.34, `robotics` 2.17, `poetry` 2.16,
`mental-health` 2.08, `cognition` 2.03, `garage` 2.03, `crafting` 2.01.

### Capability map mentions a data source

Check whether the defining feature needs an outside feed (and which honest
free source exists) before the build: `creatures`, `grounding`, `ingest`,
`inheritance`, `insurance`, `integrations`, `landscaping`, `legal`,
`linguistics`, `literary`, `lock`, `marketplace`, `materials`, `message`,
`meta`, `organ`, `personas`, `plumbing`, `poetry`, `repos`, `resonance`,
`sub-worlds`, `sync`, `temporal`, `vote`. (A text match in the map, so some
are already closed; confirm in step 1.)

---

## Possible duplicates — the owner decides

Merging two half products into one full one is not lowering the bar. Each
pair is listed with what they share; nothing is merged without a decision.

| Candidates | What they share |
|---|---|
| `insurance` · `death-insurance` | the same backend domain (`insurance`) |
| `hr` · `strategic-adds` | `strategic-adds` resolves to the `hr` domain and is the only "raw" lens |
| `auction` · `market` (shipped Auction House) | `auction` has no backend; the Auction House already sells lots |
| `ledger` · `accounting` | a 3-macro ledger beside a 122-macro accounting engine |
| `mail` · `message` | `message` already absorbs `mail` |
| `law` · `legal` | `legal` already absorbs `law` |
| `calendar` · `events` · `event-timeline` · `timeline` · `sessions` | one time family, five pages |
| `photography` · `gallery` · `photos` (shipped Darkroom) | photo work beside a shipped photo editor |
| `creative` · `creative-writing` · `poetry` · `literary` | writing, four pages |
| `cognition` · `metacognition` · `metalearning` · `understanding` | introspection, four pages |
| `game` · `game-design` | game building |
| `goddess` · `deities` | the same world figures |
| `frontier` · `concord-link-frontier` | the same frontier |
| `self` · `society` · `sandbox` | all mount the world components |
| `thread` · `forum` · `feed` · `social` | discussion, four pages |

---

## Identity batches

Per the playbook, every lens gets 2–3 pitched directions and the owner picks.
To keep the line moving, pitch in batches of five and approve together. The
first batch, with a reference product to pitch against (not yet the
directions):

| Lens | Job | Reference to pitch against |
|---|---|---|
| `realestate` + `housing` | find, value and hold a home | Zillow / Redfin (comps-based valuation is the defining feature) |
| `finance` | see and move your money | Monarch / Copilot for the money view; Bloomberg for markets |
| `crypto` | hold and use coin and tokens | Coinbase + a wallet like Rainbow |
| `insurance` | cover, claims and payouts | Lemonade |
| `accounting` | keep the books | QuickBooks / Xero |

Each identity is checked against the registry so no two lenses share a
concept, reference, palette family or signature interaction.

---

## Running the line

1. **P0 identity fix first** (owner go-ahead).
2. **Audits in parallel, read-only:** the next 3–5 lenses' step-1 audits run
   while the current lens is built.
3. **Identities approved in batches of five.**
4. **Build and verify one lens at a time** through every playbook gate.
5. **After each family,** pull out the pieces built more than once into
   shared components (behaviour only; the look stays per lens).
6. **Re-run this triage** after each wave; the script makes it cheap.
