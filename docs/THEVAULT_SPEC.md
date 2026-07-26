# TheVault — founding specification

**Status:** design-locked, unbuilt. Zero lines of TheVault code exist at the time of writing.
There is no `server/domains/thevault.js`, no `concord-frontend/app/lenses/thevault/`, and no
prior `docs/*VAULT*` document — verified by direct `ls`. Everything below is a specification
to build against, not a description of something running.

**Provenance of this document.** Sections 1–6 record decisions made by the collaborator who
designed TheVault. They are **locked inputs**: recorded faithfully, not re-litigated and not
"improved." Sections 7–9 are the engineering ground truth this build lands on; every claim in
them carries a `file:line` citation verified against the working tree, and several of them
**correct** what was believed going in. Section 10 surfaces the places where her brief and the
platform's real constraints genuinely conflict — those are named, not smoothed over.

---

## 1. The reframe — what the product actually is

The phrase "Timeless Preservation" describes the **philosophy**, not the product.

> **The product is Recognition. Curated Legacy.**

What someone receives from TheVault is not preservation — it is *acknowledgment that their work
has earned a place inside it*. Preservation is what TheVault **does**. Recognition is what
creators **experience**. Those are different things, and confusing them produces the wrong
product: an archive optimized for storage rather than for the moment of admission.

**The moment of admission is the product.** Every design decision downstream — the record shape,
the rubric, the state machine, the typography, the stillness — exists to make that moment feel
earned, legible, and permanent. If a decision does not serve the moment of admission or the
credibility of the gate that produces it, it is out of scope.

---

## 2. The one-page design brief

*This is the collaborator's brief, kept at its original length. It was written to fit on one page,
and that constraint is part of the document — it is not a summary of something longer.*

---

### TheVault

**What it is.** A curated archive that discovers, preserves and celebrates creative work
deserving to outlive trends — music, fashion, film, photography, design, art.

**How it reads.** Like a museum wall label. Quiet, authoritative, contextual. Not a social
platform. Not a magazine. Not an auction catalogue. A museum doesn't ask "will this go viral" —
it asks "why does this belong here." Every object carries provenance, historical context, curator
notes, significance, date, creator, relationships.

**How things get in.** Open submission, closed admission. 100% curated. People may recommend,
nominate, or submit themselves. TheVault decides. *The gate is the product. If everyone gets in,
TheVault stops meaning anything.* The reference points are the Grammys, the Rock & Roll Hall of
Fame, the Criterion Collection, the Smithsonian.

**What it judges on.** Evidence, not popularity. Six axes: **Originality** — did this contribute
something new. **Craft** — is there clear evidence of skill. **Influence** — has this impacted
people, even a small community. **Cultural relevance** — does it document an important story.
**Longevity potential** — will this still matter years from now. **Documentation** — can we
explain why it belongs. *If we can't explain it, it shouldn't be admitted.*

**Who decides.** Curators. Not AI. *AI helps organize evidence. Humans preserve culture.*

**What launches first.** Music. The architecture expands naturally to concerts, dance, fashion,
photography, film, visual design. Music is already an archive-driven culture, and you shouldn't
ask people to understand six brands at once.

**The core object.** A **Vault Record**. Not a card — that's social media. Not a tile — that's
Pinterest. Not a slab — too cold. Imagine opening a safety deposit box. Inside is one object. One
creator. One story. One preservation record. Fields: Creator, Work, Acceptance date, Curator
statement, Supporting evidence, Timeline, Relationships, Media, Preservation status. Thousands of
them should feel like walking through endless museum drawers — not an infinite feed.

**How it looks.** Exactly two typefaces: one serif for permanence and authority, one sans for
clarity. *You should be able to print it on paper in 2050 and it still feels appropriate.* Almost
entirely grayscale — white, black, warm gray. One accent: **Vault Gold** — not shiny, not
metallic, almost archival, a muted brass — used sparingly, because *if everything is gold, nothing
feels important*. Light, not dark: *museums aren't black, archives aren't black, paper is light*.
Black is reserved as ceremonial. Texture: yes — subtle paper grain, letterpress, embossing, cotton
paper, certificate stock. Everything should feel physical.

**How it moves.** Still. Very still. Nothing bounces, spins, or slides dramatically. A drawer
opens. A cabinet reveals. A page turns. A vault unlocks. *Like walking through a museum after
closing. Silence is part of the experience.*

---

## 3. Operating decisions

Made by the owner; also locked.

**Curation model.** A **founding curator** plus **invited guest curators**. A guest curator's
inductions are attributed to **the guest**, not to the founder. Attribution is per-admission and
permanent — it is part of the record, not a display preference.

**Launch state.** TheVault **opens empty, honestly.** Zero entries at launch. An open submission
queue. The first admission is a real public event.

There will be **no placeholder entries, no fabricated "featured creators," and no invented
counts.** This is not a launch-tactics preference — it is the platform's hard zero-demo-content
invariant, mechanically enforced by `server/lib/detectors/frontend-fake-data-detector.js` (which
flags hardcoded arrays rendered as live data, `Math.random()` in render paths, and placeholder
content, per its rule list at `server/lib/detectors/frontend-fake-data-detector.js:18-30`). An
empty vault with an honest empty state is the correct launch surface. A seeded one is a defect.

---

## 4. The Vault Record

The atomic object. One record = one work = one admission decision.

It is not a card, a tile, or a slab. The interaction metaphor is a **safety deposit box**: you
open one, and inside is one object, one creator, one story, one preservation record.

### 4.1 Fields

| Field | Shape | Required | Notes |
|---|---|---|---|
| `creator` | structured identity | yes | Name plus optional disambiguators (period, region, collective). Not a platform user id — most admitted creators will have no Concord account, and the schema must not imply otherwise. |
| `work` | structured | yes | Title, form, date or date-range, and the discipline it is admitted under. |
| `acceptedAt` | date | yes | The admission date. Distinct from the work's own date and from the submission date. This is the timestamp the *recognition* happened. |
| `curatorStatement` | prose | yes | Why this belongs. Written by a human curator, attributed to that curator by name. **See §7.2 — no equivalent field exists anywhere in the codebase today.** |
| `admittedBy` | curator identity | yes | Founding curator or a named guest curator. Permanent, per-record. |
| `evidence` | array of typed citations | yes | The supporting record behind the six-axis judgment. Each item is a source: publication, recording, credit, interview, archival reference. Evidence is what the rubric is scored against; a record with no evidence cannot be admitted (Documentation axis). |
| `timeline` | ordered events | no | Dated events situating the work — release, reissue, reception, influence. Empty is honest; an invented timeline is not. |
| `relationships` | typed edges to other records | no | Influenced-by, contemporary-of, reissued-as, sampled-by. Edges only to records that exist. |
| `media` | **optional, typed** | **no** | See §4.2 and §8. Optional is a hard schema requirement, not a convenience. |
| `preservationStatus` | enum + provenance | yes | What TheVault actually holds and can vouch for. See §4.3. |

### 4.2 `media` is optional and typed — from day one

Three of the six named disciplines cannot carry media through their existing lens surfaces today
(§8). If `media` were required, or untyped-and-assumed-present, the schema would force either a
fabricated asset or a broken record for those disciplines. Both are disallowed.

`media` therefore carries an explicit type discriminator and an explicit absence case:

- `{ kind: "none", reason: <string> }` — the honest default. The reason is displayed, not hidden.
- `{ kind: "external_reference", url, rightsBasis }` — a pointer to a source TheVault does not
  host. This is a **reference**, and the record must read as one; it is not evidence that TheVault
  holds the artifact.
- `{ kind: "held", artifactRef, mime, sha256 }` — TheVault holds bytes. Only this variant may
  make a preservation claim.

The generic blob substrate for the `held` case **already exists and is real**: `storeArtifact()`
at `server/lib/artifact-store.js:101` (writes under `ARTIFACT_ROOT`, `server/lib/artifact-store.js:34`)
with a streaming read at `server/lib/artifact-store.js:307`, plus transcoding and budget hooks.
The media gaps in §8 are therefore **lens-level, not substrate-level** — the disciplines that
cannot carry media are ones whose lenses never wired up to this store, not ones the platform is
incapable of storing.

### 4.3 `preservationStatus`

A record must never imply more custody than TheVault has. The enum is deliberately unflattering
at the low end:

- `referenced` — TheVault holds metadata and citations only. No bytes.
- `held` — TheVault holds the bytes, with a content hash.
- `at_risk` — held or referenced, with a documented degradation or access risk.

`preservationStatus: held` carries an integrity obligation. **The runtime DTU hash cannot satisfy
it** — see §7.4. Use `computeContentHash` from `server/lib/dtu-protocol.js:82`.

### 4.4 The wall-label reading order

The record renders in the order a museum label reads, and this order is part of the spec:
**Work → Creator → Date → Curator statement → Evidence → Timeline → Relationships → Preservation
status.** The curator statement sits above the evidence, not below it: the label tells you why it
belongs before it shows you its work.

### 4.5 Nearest existing shape in the codebase

`server/domains/gallery.js:545` (`gallery.exhibit-add-panel`) already models "one artwork plus
curatorial wall text," with fields `title` / `artist` / `date` / `image` / `museum` / `wallText`.
It is the closest precedent in the tree and worth reading before building. It is **not** a
substitute: those panels are self-authored by the viewing user into in-memory lens state, with no
admission gate, no curator attribution, and no persistence beyond the state snapshot. TheVault's
record is the same *reading experience* with an entirely different *authority model*.

---

## 5. The admission rubric — six axes

Every admission is judged on evidence, not popularity.

| Axis | The question |
|---|---|
| **Originality** | Did this contribute something new? |
| **Craft** | Is there clear evidence of skill? |
| **Influence** | Has this impacted people — even a small community? |
| **Cultural relevance** | Does it document an important story? |
| **Longevity potential** | Will this still matter in years? |
| **Documentation** | Can we explain why it belongs? |

**Documentation is a gate, not a score.** *If we can't explain it, it shouldn't be admitted.* A
submission that scores well on the other five and cannot be documented is declined. This is the
one axis that can veto on its own.

**Influence is explicitly not popularity.** "Even a small community" is load-bearing: a work that
changed the practice of forty people scores higher on this axis than one with large passive reach
and no traceable effect. Any implementation that reaches for a count as a proxy for this axis has
misread it.

**Who scores.** Curators. Humans.

> **AI helps organize evidence. Humans preserve culture.**

This is a build constraint, not a slogan. It defines exactly where the platform's LLM and macro
layer may and may not be used:

- **Permitted:** clustering submissions, surfacing prior art, retrieving and de-duplicating
  evidence, drafting a *timeline* from cited sources, flagging a submission as similar to an
  existing record, translating source material.
- **Forbidden:** producing an axis score, producing an admission or decline decision, and
  **authoring or ghost-writing the curator statement**. The statement is the human artifact that
  the entire gate's credibility rests on. A generated statement voids the record.

An implementation must make the forbidden set structurally impossible, not merely discouraged —
the curator statement field should have no machine-write path at all.

---

## 6. The curation state machine

```
                    ┌──────────────────┐
   submission ─────►│    submitted     │
   (open to all)    └────────┬─────────┘
                             │  curator picks it up
                             ▼
                    ┌──────────────────┐
                    │  under_review    │◄──── evidence gathering
                    └────┬────────┬────┘      (AI-assisted, §5)
                         │        │
              admitted   │        │   declined
                         ▼        ▼
              ┌──────────────┐  ┌──────────────┐
              │   admitted   │  │   declined   │
              │   (public)   │  │  (private)   │
              └──────────────┘  └──────────────┘
```

**Three entry paths, one gate.** Self-submission, third-party nomination, and curator discovery
all land in `submitted`. They are distinguished by a `submissionOrigin` field for provenance, and
by nothing else — a curator-discovered work receives no procedural advantage over a
self-submission. *Open submission, closed admission.*

**`under_review` is not public.** A queue position is not a signal, and exposing one would turn
the queue into the leaderboard the whole design rejects. Submitters can see the status of their
own submission and nothing else.

**Admission is attributed and permanent.** `admittedBy` names the founding curator or the guest
curator who made the call. Guest inductions are attributed to the guest. The attribution is
written once at admission and is not editable — reassigning credit for an admission would
undermine the only thing that makes the gate meaningful.

**Declines are private, permanent, and reasoned.** A decline is visible to the submitter and the
curators, never publicly. It carries a written reason. Nothing about a decline is published,
counted, or aggregated — there is no public reject rate, because a published decline is a
punishment and TheVault is not in that business.

**A decline is not a permanent bar.** Re-submission is allowed when new evidence exists; the prior
decline and its reason are attached to the new submission as context for the curator.

**There is no "featured," "trending," or "editors' pick" state.** Admission is the only
distinction TheVault confers. Adding a second tier of recognition on top of it would dilute the
first.

---

## 7. Engineering ground truth

Every claim in this section was verified by opening the cited file at the cited line. Where the
belief going in was wrong, the correction is marked **CORRECTED** and the actual behavior stated.

### 7.1 Two DTU stores, three column shapes — pick correctly or the record is invisible

Concord has **two distinct DTU stores**, and this is the single most consequential fact for
TheVault:

- `STATE.dtus` — an **in-memory `Map`** (`server/server.js:5415`), snapshotted whole to
  `concord_state.json` or a single `state_snapshots` row (§7.3). This is the cognitive-substrate
  and chat-grounding store.
- The SQL `dtus` **table** — the store that cross-lens discovery, the royalty cascade, the
  creative marketplace, and world-prop placement actually read. `server/lib/dtu-props.js:27-36`
  documents this split explicitly.

**CORRECTED — the `dtus` table has three write conventions, not two.** They are enumerated in the
header of `server/lib/dtu-shadow-hydrate.js:33-48`:

1. **`body_json` shape** — `owner_user_id` / `title` / `body_json` / `tags_json` / `visibility` /
   `tier`, the original schema at `server/migrations/001_core_tables.js:75-88`.
2. **`data` shape** — `type` / `creator_id` / `data`, added by
   `server/migrations/087_dtus_type_creator_data.js:16,29,44`.
3. **`content` shape** — `content` / `content_type` / `metadata_json` / `status`, added by
   `server/migrations/295_dtus_pipeline_reconcile.js:33-36`.

A row only ever populates the columns its writer used.

**Vault Records must use the `data` shape plus `world_id`** (`type` / `creator_id` / `data` /
`world_id`, the last from `server/migrations/225_dtu_world_id.js:13`). Anything else is invisible
to:

- `searchDtus` in `server/lib/cross-lens-discovery.js:107`, which filters on `d.data`
  (`:132`), `d.type` (`:136`), `d.lens_id` (`:145`) and `d.creator_id` (`:151`); and
- 3D prop placement, which writes and reads exactly this shape at `server/lib/dtu-props.js:370`.

A record written in the `body_json` shape is durable and completely undiscoverable.

### 7.2 "Accepted because…" does not exist anywhere — the curator statement is genuinely new

Verified by search across all `.js`/`.ts` in the repo (excluding `node_modules`) for
`accepted_because` / `acceptance_note` / `accept_note` / `admission_note` / `curator_statement` /
`why_admitted` / `accept_rationale`, and across `server/migrations/*.js` for any
`approval_reason` / `acceptance_reason` / `*_rationale` column: **zero hits in both cases.**

Every governance table in Concord carries a **reject** reason and no accept rationale:

- `server/migrations/126_skill_evolution.js:45` — `reject_reason TEXT`
- `server/migrations/385_conkay_authored_tools.js:66` — `reject_reason TEXT`
- `server/migrations/013_federation_marketplace_dedup.js:42` — `rejection_reason TEXT`

This is a real and interesting asymmetry: the platform has always recorded why something was
turned away and never why something was let in. TheVault's `curatorStatement` inverts that, and
there is no existing field to reuse or extend. It must be built.

### 7.3 Permanence is not free — the substrate is designed to forget

TheVault's core promise runs against the grain of the DTU substrate. Four specific mechanisms:

**(a) `evolution.dedupe` is a hard delete with no protection check.**
`server/server.js:29704` registers it. It merges any two DTUs whose Jaccard similarity over
`title + tags` (computed at `server/server.js:29715` and `:29719`) meets a threshold defaulting to
**0.86** (`server/server.js:29707`), and the loser is removed outright by
`STATE.dtus.delete(b.id)` at `server/server.js:29725`. **No protection flag of any kind is
consulted.** Two Vault Records with similar titles and overlapping tags — exactly what a
well-tagged archive of one discipline produces — are a plausible collision.

*Partial mitigation, verified:* this macro is **not on any heartbeat**. A maintenance-queue item
with `kind:'dedupe'` is pushed at `server/server.js:21971`, but nothing drains that queue — the
only other reference to `STATE.queues.maintenance` is a length check and another push at
`server/server.js:22343-22344`. So the macro is operator- and API-reachable but not scheduled.
That is a weaker guarantee than a protection check, and it can change without anyone noticing.

**(b) The forgetting engine's pin is not reliably durable.**
`protectDTU()` at `server/emergent/forgetting-engine.js:502-509` sets `dtu._pinned = true` by
direct mutation. It calls neither `STATE.dtus.set()` nor a state save.

**`STATE.dtus.set()` IS the real persistence path**, so a bare mutation like `protectDTU`'s does
not persist. `server/lib/dtu-store.js`'s `set(id, dtu)` (~`:163`) calls `persistToSQLite(dtu)`
**first** and only then updates the memory cache; its own doc comment reads *"Write-through:
SQLite first, then memory"* and *"Write to SQLite first (source of truth)"*.

> **A retracted correction, kept deliberately as a worked example.** An earlier draft of this
> section claimed `set()` does *not* write SQLite, citing two "overrides." Both citations were
> wrong, and the way they were wrong is instructive:
> - `server/server.js:37845` is a **search-index TF-IDF scoring function**, not a `set` override
>   at all — a misread of nearby code.
> - `server/lib/xp-hooks.js:34` *does* genuinely wrap `STATE.dtus.set` — but it is guarded by
>   `if (originalDtusSet && STATE.dtus instanceof Map)`, and `createDTUStore` returns a **plain
>   Object**, not a Map (measured directly: `store instanceof Map === false`). So the wrapper
>   **never installs**. Even if it did, it delegates to the real persisting `set`.
>
> This matters beyond the correction: `xp-hooks.js` is dead for the *same* reason the forgetting
> engine is dead (§10.1a) — the `instanceof Map` assumption broke platform-wide when `STATE.dtus`
> was replaced by the write-through store object. Two unrelated subsystems silently stopped, and
> a static read of either looks perfectly healthy. Check `STATE.dtus` shape at runtime before
> trusting any claim about it.

The practical consequence for TheVault is unchanged, and it is the reason this section exists:
**`protectDTU` mutates in place and never calls `set()`, so the pin is not written to SQLite and
does not survive a restart.** Admission must persist protection through `set()` /
`pipelineCommitDTU`, not by assignment.

**(c) There are two mutually-incompatible protection flag families, and neither reads the other.**

- `dtu._pinned` — read **only** by the forgetting engine, at
  `server/emergent/forgetting-engine.js:72` (in `PROTECTION_RULES`).
- `dtu.protected` / `dtu.immutable` / `dtu.seedOrigin` — read **only** by server.js guards:
  `demoteToArchive` at `server/server.js:15821`, the DTU delete path at `server/server.js:23194`,
  and seed-lineage auditing at `server/server.js:11910`.

Setting one does not protect against the other's path, and neither protects against (a).

**(d) Consequence for TheVault.** An admitted Vault Record needs a protection guarantee that does
not exist today. Building TheVault on the current substrate without addressing this means the
archive's central promise — that admission is permanent — is unbacked. The honest options are: set
**all** flags in both families and add an explicit `isProtected` check to `evolution.dedupe`; or
store admitted records in a dedicated table where none of these paths reach. Either is a real
engineering task that must be scoped before the first admission, not after.

*One point in the substrate's favor:* the forgetting engine's normal path **tombstones** rather
than hard-deletes (`server/emergent/forgetting-engine.js:279-280`), preserving lineage. It is
`evolution.dedupe` that is genuinely destructive.

### 7.4 The runtime DTU hash cannot support an integrity claim

`server/server.js:22961` computes `dtu.hash` as:

```
sha256(title + "\n" + cretiHuman).slice(0, 16)
```

Two independent problems, both verified:

1. **Truncated to 64 bits.** 16 hex characters. That is a fingerprint, not a tamper-evidence
   anchor. The same shape appears at `server/server.js:11861` and is re-derived by the verifier at
   `server/server.js:38725`.
2. **It covers almost nothing.** Only `title` and the rendered human summary. Neither `core`, nor
   `machine`, nor `tags` are in the preimage — the structured claims that constitute the record's
   actual content can be rewritten without changing the hash.

**Use `computeContentHash` instead**, at `server/lib/dtu-protocol.js:82`: a full-length SHA-256 over
a correct recursive key-sorting canonical stringify (`server/lib/dtu-protocol.js:72-79`). It is
already exposed for external-envelope validation via the `dtu.protocol_validate` macro, and
`verify()` at `server/lib/dtu-protocol.js:576` performs real tamper detection against a stamped
provenance hash.

Any `preservationStatus: held` claim must be anchored on this hash, never on `dtu.hash`.

### 7.5 Use `input.lineage`, never `input.parents`

When a Vault Record cites a source, it is a derivative and must register real lineage. The
`dtu.create` macro accepts two similarly-named fields that behave completely differently:

- `input.lineage` is captured at `server/server.js:22672` into a local `const lineage`. **That
  local is what everything downstream uses:** the usage-rights consent gate loops over it at
  `server/server.js:22701` (rejecting with `usage_rights_denied` at `:22757` when the parent is
  neither public, nor consented, nor licensed), and the royalty auto-citation block loops over it
  to call `registerCitation` and write the `royalty_lineage` edge.
- `input.parents` is handled separately at `server/server.js:22919-22927`, and only decorates
  `dtu.lineage.parents` on the created object — **after** the local `const` was already computed
  from `input.lineage` at `:22672`.

**Consequence, verified:** passing `parents` alone registers **zero royalties**, creates **no
`royalty_lineage` edge**, and **bypasses the usage-rights consent gate entirely**. The two fields
being non-overlapping is acknowledged in-tree as historical accident, not design — see the comment
at `server/server.js:29196-29211`.

For TheVault this is not a performance detail. Citing a creator's work without registering lineage
means the creator is neither credited in the citation graph nor paid, while the platform's own
consent gate — the thing that was supposed to ask permission — never runs.

---

## 8. Honest media scorecard

TheVault names six disciplines. **Their media pipelines are in wildly different states**, and the
spec states this plainly because it determines what `media` can be for each one at launch (§4.2)
and it complicates the music-first launch order (§10.3).

This scorecard **corrects four of six** entries from what was believed going in.

| Discipline | Status | Verified detail |
|---|---|---|
| **Photography** | **REAL but 404s on read** *(corrected)* | Upload is genuine: `File` → `arrayBuffer()` → `btoa()` → `POST /api/media/upload` at `concord-frontend/app/lenses/photography/page.tsx:232-243` (and the camera path at `:142-152`); handler at `server/routes/media.js:163` decodes base64 and calls `storeArtifact` at `:230-249`. Range-request streaming is genuine and correct — `server/routes/media.js:409` parses `req.headers.range` and returns a real `206` with `Content-Range` (`:429-447`). **The defect:** the route is `/api/media/:id/stream`, but all four read sites request `/api/media/stream/:id` — segments reversed — at `concord-frontend/app/lenses/photography/page.tsx:322`, `:493`, `:707` and `concord-frontend/components/photography/LightroomDarkroomPanel.tsx:319`. Neither `/:id` nor `/:id/stream` can match that, so every photo read 404s. The correct form exists at `server/routes/media.js:378` and `concord-frontend/hooks/useMediaUrl.ts:150`; the lens does not use that hook. **A one-line fix makes an otherwise-complete pipeline work.** |
| **Music** | **PARTIAL** *(verified)* | The playback engine is real and good: dual decks at `concord-frontend/lib/music/player.ts:61-62`, equal-power crossfade at `:290-345`, three-band `BiquadFilterNode` EQ at `:204-208`, and genuine OOPS L−R center-channel vocal cancellation via a channel splitter and inverted right channel at `:217-232`. **But `audioUrl` appears zero times in `server/domains/music.js`.** All three free-API ingestion paths write `previewUrl` and nothing else — iTunes at `server/domains/music.js:1026`, Jamendo at `:1094` (whose own comment calls it a "full streamable track"), Audius at `:1129` — and the shared persist fold at `:1062` carries `previewUrl` forward only. The player reads `audioUrl` exclusively (`concord-frontend/lib/music/player.ts:319`, `:384`); the two fields are distinct in the type at `concord-frontend/lib/music/types.ts:90-91`, and no `previewUrl → audioUrl` mapping exists anywhere. *Nuance:* `audioUrl` **is** populated on two non-ingestion paths — user uploads at `concord-frontend/app/lenses/music/page.tsx:725` (using the correct URL form) and beat-marketplace previews at `:1746` — so the engine is not entirely starved, it just gets nothing from the ingested catalog. |
| **Art** | **REAL, both external *and* owned** *(corrected twice)* | External is real but narrower than believed: **Met and Art Institute of Chicago only** — `server/domains/art.js:503`, `:528`, `:566`, with the true IIIF URL built at `:583`. **There is no Cleveland Museum integration**; grep for `cleveland` across `server/domains/art.js` returns zero hits. And **owned-artwork blob storage does exist**, on two paths: `art.publish-as-texture` at `server/domains/art.js:884` decodes a data URL, writes real bytes to disk with `fsp.writeFile` at `:920-926`, and registers an `evo_assets` row at `:933` with rollback on failure at `:944-946`; separately the art canvas posts to the same real media pipeline photography uses, at `concord-frontend/app/lenses/art/page.tsx:469-479`. |
| **Fashion** | **NO BLOB PATH — but bytes land in state** *(corrected)* | No upload endpoint and no blob storage, confirmed: `server/domains/fashion.js` has zero occurrences of `storeArtifact` / `writeFile` / `registerAsset` / `artifactRef`, and the lens page has no file input and no `/api/media` call. **But "metadata-only" overstates it** — real image bytes are persisted inline as base64 data URLs into lens state at `server/domains/fashion.js:577-579` (a background-removal result) and accepted as pin records at `:1343-1355`. That is worse than metadata-only for preservation purposes, not better: binary payloads inside a whole-state JSON snapshot. |
| **Design** | **THE LENS DOES NOT EXIST** *(corrected)* | There is no `design` discipline to evaluate. No `server/domains/design.js`, no `concord-frontend/app/lenses/design/`, and zero `registerLensAction("design"` hits server-wide — all verified by direct `ls` and grep. The nearest real lens is **game-design** (`server/domains/gamedesign.js:5`), which does have zero media references and *is* metadata-only. If TheVault intends a visual-design discipline, it is a new build, not an integration. |
| **Film** | **METADATA ONLY** *(verified)* | `server/domains/filmstudios.js` has zero occurrences of `storeArtifact` / `writeFile` / `registerAsset` / `artifactRef`. `media-register` at `:1480` stores `sourceUrl` / `proxyUrl` and explicitly rejects anything that is not `http(s)` at `:1487-1490`, so data URLs cannot enter at all; the stored record at `:1491-1503` is pure metadata. *Caveat that reinforces the finding:* `concord-frontend/app/lenses/film-studios/page.tsx:603-612` renders an "Upload Video" file input whose handler only calls `URL.createObjectURL` into local state for a preview at `:615` — it is upload UI with no upload behind it. |

**What this means for the spec.** `media` must be optional and typed (§4.2) because two of the six
named disciplines genuinely cannot hold bytes today, one does not exist, one holds bytes in the
wrong place, and the one launching first has a working player with an empty catalog. Only
photography (after a one-line fix) and art can honestly produce `media: { kind: "held" }` right
now.

---

## 9. Non-goals

Stated as prohibitions because each one is a thing a normal product would drift toward.

**No vanity metrics.** No view counts, like counts, follower counts, or play counts on a Vault
Record or anywhere in TheVault's surface. The Influence axis is judged on documented effect (§5);
a counter is not evidence of influence, and displaying one would quietly replace the rubric.

**No popularity ranking.** No trending, no charts, no "most viewed," no algorithmic ordering.
Records are ordered by archival logic — chronology, discipline, relationship — never by
engagement.

**No infinite feed.** Thousands of records should feel like walking through endless museum
drawers, not scrolling. Browsing is navigation through an ordered collection with a sense of
place, not consumption of a stream. If a user cannot tell where they are in the archive, the
browse surface is wrong.

**No fabricated content, ever.** No placeholder records, no invented creators, no sample
admissions, no seeded counts, no "example" entries shipped behind a flag. TheVault opens empty and
says so. This is enforced mechanically (§3).

**No AI-authored curation.** No generated curator statements, no machine axis scores, no automated
admissions (§5). AI organizes evidence; humans preserve culture.

**No public decline data.** No reject rates, no queue positions, no "considered but not admitted"
lists (§6).

**No second tier of recognition.** No featured, no editors' picks, no spotlight. Admission is the
only distinction (§6).

**Not a marketplace.** Admission is not a sale and confers no listing. Whatever economic
consequences follow from a record's citations are downstream of the archive, never a criterion for
entry into it.

---

## 10. Where the brief and the platform genuinely conflict

Surfaced, not resolved. Each of these is a real decision someone has to make.

### 10.1 "Preservation" vs. a substrate designed to forget — **the hardest one**

The brief's central promise is permanence. Concord's DTU substrate is architecturally the opposite:
it compresses, consolidates, tombstones, forgets, and — in the case of `evolution.dedupe` — hard
deletes with no protection check at all (§7.3a). The protection mechanisms that do exist are split
across two flag families that do not read each other (§7.3c), and the one designed for pinning is
not reliably persisted (§7.3b).

There is no existing "this DTU is permanent" guarantee to switch on. Building TheVault on the DTU
substrate as-is means shipping an archive whose central claim is unbacked by the storage layer
underneath it. **This must be scoped before the first admission**, because the first admission is a
public event and the promise is made at that moment.

### 10.2 Curated third-party admission vs. the citation-consent gate

The brief is explicit that TheVault decides, and that curators may induct work by anyone — the
Grammys and the Hall of Fame do not require nominees to opt in. Concord's `dtu.create` enforces the
opposite default: deriving from another creator's DTU is **refused** with `usage_rights_denied`
unless the parent is public, its creator consented, or the caller holds a purchased license
(`server/server.js:22701-22758`).

For works with no Concord DTU parent this never fires — most admitted creators will have no account
(§4.1). But the moment TheVault admits a work that *is* already a DTU in the platform, curatorial
authority and creator consent are in direct tension. Which wins is a governance decision, not an
implementation detail, and it interacts with the money: §7.5's lineage rule exists precisely so
cited creators are credited and paid.

### 10.3 Music-first launch vs. music being the weakest media discipline

The brief's reasoning for launching with music is sound and stands on its own: music is already an
archive-driven culture, and asking people to understand six brands at once is a mistake.

But §8 shows music is the discipline with the largest gap between a real engine and real content —
a genuinely good playback engine with essentially nothing in the ingested catalog to play, because
the ingestion paths write `previewUrl` and the player reads `audioUrl`. Photography, by contrast,
has a complete upload-and-stream pipeline blocked only by a reversed URL.

Three honest ways forward, in preference order: **(a)** fix the one-line `previewUrl → audioUrl`
mapping at `server/domains/music.js:1062`, which lights up all three providers at once and makes
the brief's launch order work as written; **(b)** launch music with `media: { kind: "none" }` or
`external_reference` records — legitimate under §4.2, and arguably correct for a music archive
whose value is documentation rather than streaming; **(c)** change the launch discipline, which
means overriding a locked decision and should not be done casually. **(a) is strongly preferred.**

### 10.4 "Still. Very still." vs. the platform's motion and interaction rubric

`docs/UI_QUALITY_RUBRIC.md` §2 requires 3–5+ real micro-interactions per lens tied to actual state
changes, and the fluidity invariant requires sub-100ms perceived response with optimistic UI. The
brief requires stillness — nothing bounces, spins, or slides; silence is part of the experience.

These are reconcilable but not automatically: a drawer opening, a cabinet revealing, a page
turning, and a vault unlocking are all real, state-tied micro-interactions. The resolution is that
TheVault satisfies the rubric with *slow, weighted, physical* motion rather than *no* motion —
stillness of character, not absence of response. Anyone reviewing TheVault against the standard
lens rubric needs to know this is a deliberate interpretation, or they will read a compliant
surface as an under-built one.

### 10.5 "Light, not dark" vs. a theme-aware platform shell

The brief is unambiguous: museums are not black, archives are not black, paper is light. Black is
reserved as ceremonial. The surrounding platform shell is theme-aware and dark-dominant.

TheVault should be the one destination that does not follow the shell's theme — the visual
commitment is load-bearing, and a dark-mode Vault is a different product. This needs an explicit
exemption rather than a silent divergence, or the next theming pass will "fix" it.

### 10.6 Recognition vs. an economy built on sales

§1 establishes the product as recognition. Concord's creative layer is built around listings,
purchases, and royalty cascades. Admission to TheVault must confer **no** listing, price, or sale —
and the record must not render as purchasable, because an auction catalogue is one of the three
things the brief explicitly says TheVault is not.

The tension is subtler than "don't add a buy button": the royalty cascade fires on *citation*, so a
Vault Record citing a source may generate real payouts as a side effect of correct lineage
registration (§7.5). That is defensible — creators being paid when their work is cited is good —
but it must never become a criterion for admission, a signal displayed on a record, or a thing
curators can see while judging.

---

## 11. Build order (proposed, not locked)

1. Resolve §10.1 — decide where admitted records live and what actually guarantees their
   permanence. Nothing else matters until this is answered.
2. Resolve §10.2 — the governance call on curatorial authority vs. creator consent.
3. Build the Vault Record schema (§4) on the `data` + `world_id` column shape (§7.1), with
   `curatorStatement` as a new human-write-only field (§7.2) and `media` optional and typed (§4.2).
4. Build the curation state machine (§6), including private declines and permanent per-admission
   attribution.
5. Fix `server/domains/music.js:1062` (§10.3a) so the music launch has a real catalog.
6. Build the archival visual identity (§2, §10.4, §10.5).
7. Open empty. First admission is a real event.

---

*Nothing in this document describes a shipped feature. Section 8's scorecard describes the state of
other lenses that TheVault will need, not TheVault itself. TheVault opens empty, and until it does,
its entry count is zero.*
