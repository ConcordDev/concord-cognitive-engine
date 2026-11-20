# Lens Redesign Playbook

How a lens gets rebuilt into its own product: the method used on the Retail
lens ("The Stall", 2026-11-18, branch `claude/modest-allen-u4breb`,
commits `f2b756286` → `992460ac2`, follow-ups in issue #2392). Follow it in
order. Each step has a gate, and a step isn't done until its gate passes.

Companion docs: `docs/LENS_CONSOLIDATION_PLAYBOOK.md` (un-stacking a welded
page; do it first if the lens scores heavy in `audit/lens-stacking-report.md`),
`docs/UI_QUALITY_RUBRIC.md` (the premium bar), CLAUDE.md "How we work here"
(honesty, compute-don't-guess, the anti-cheat guard).

---

## The two hard rules

1. **Shared: the left bar and the top bar. Nothing else.** The platform's
   left sidebar and the top bar (topbar plus the lens header row with
   destination tabs and share/export) stay exactly as they are on every lens.
   Everything below them, where the user actually works, belongs to the lens.
   No `NorthStarFrame`, `ShellPreview`, `RealtimeDataPanel`, generic action
   walls or shared hero banners inside the lens body.
2. **No two lenses share a theme or a look.** Each lens gets its own
   identity: its own concept, palette, type, textures, layout shape and
   signature interactions. Re-skinning another lens's identity with new
   colours doesn't count. Before designing, check the **Identity registry**
   at the bottom of this doc. When you ship, add your lens to it. If a
   proposed identity is close to a claimed one (same concept, same reference
   product, same palette family, same signature interaction), change it.

---

## 1. Audit the lens

- List every backend action the lens has
  (`grep -c 'registerLensAction("<domain>"' server/domains/<domain>.js`,
  plus any inline `register(...)`) and read the current page and its
  components.
- Find the stacking: duplicate surfaces (Retail had **two** registers),
  shared chrome, tab strips piled on tab strips, panels nobody reaches.
- Read `docs/lens-specs/<lens>-capability-map.md` if it exists. Trust the
  code over it.

**Gate:** you can name the user's core job, every surface that serves it,
and every duplicate or dead surface.

## 2. Agree the identity before writing code

- Name the **job** (Retail: ringing up sales and running a small shop) and
  **one reference product** (Retail: Shopify POS + admin). One, precise.
- Pitch **2–3 directions with distinct personalities** to the owner, each
  with its feel, palette, type and "what makes it fun to stay". The owner
  picks or mixes (Retail: the Market Stall's energy plus the Corner Shop's
  warmth became "The Stall").
- Define the **fun**, and tie every bit of it to a real event: the bell
  rings on the server's `goal_hit` stamp, a till-roll line inks in when the
  server confirms it, the cha-ching plays on a completed sale. Motion with no
  event behind it is fake and not allowed.
- Check the Identity registry (rule 2).

**Gate:** the owner approved a named direction, and it's unique in the
registry.

## 3. Backend first: close the gaps the design needs

- Every feature in the design gets a **real macro**. If the design needs it
  and the backend can't do it, build it; never fake it in the client.
  Retail added: line edit / parked sales / void / customer attach / gift-card
  split tender, then custom price tags, product photos, hourly day board +
  goal, customer insights, till sessions, milestone stamps.
- **Reuse platform paths**, never parallel ones: photos go through the real
  `POST /api/artifact/upload` (type sniffing, quota, owned DTU) and are only
  *linked* by the lens; ledgers mint via `ctx.macro.run("dtu", "create", …)`.
- **Validate hard:** `finiteOrNull` / bounds on every number, whole-number
  quantities, ownership on every cross-object reference, file type and size,
  control characters stripped from text, per-user state isolation.
- Atomic money: validate every tender before writing anything, then write
  the order and spend balances in the same handler.

**Gate:** `node --check` clean; no client-only feature anywhere in the
design.

## 4. Test every new macro two ways

- **Behavioural:** exact expected values, computed and hand-checked, not
  pasted from output (`server/tests/depth/<lens>-*-behavior.test.js` via
  `lensRun`).
- **Adversarial:** garbage numbers (`NaN`, `Infinity`, `"1e999"`,
  negatives, zero, booleans, out-of-range), someone else's data / another
  shop's ids, double actions (close twice, open twice), injection-shaped
  text, wrong or oversized files, and "refused calls write nothing".
- Make time-dependent tests deterministic (Retail's day-board test was
  flaky in the last minutes before UTC midnight until fixed).
- Run the **whole domain's suite**, not only the new file (Retail: 328).

**Gate:** all green. A pre-existing red test you touch gets fixed or named
with its blocker (CLAUDE.md §8).

## 5. Frontend: the lens owns its body

- `app/lenses/<lens>/page.tsx` is a **thin mount** (Retail: 25 lines):
  `LensShell` + the lens app. One navigation state for the whole lens.
- Put the identity in **one token file** (`components/<lens>/app/<name>.css`):
  colours as CSS variables, textures, motion keyframes, a
  `prefers-reduced-motion` / `data-reduced-motion` off-switch. **No inline
  hex** in TSX. The lens's own fonts go through `next/font/google` in one
  module.
- Every on-screen number is a macro result. **Optimistic UI** reconciles
  with the server or rolls back visibly with the server's reason.
- **Cover every section.** Rebuild the core surfaces bespoke; give the
  remaining views the identity through a scoped theme layer (e.g.
  `.stall-page`) plus a header per view. No view may read as generic.
  Never define components inside render (it remounts panels and drops their
  state); use helpers.
- Sounds, if any: synthesized, opt-in, played only on confirmed results.
- Accessible names on every control. Check that labels don't collide
  (Retail's "Price" field collided with "Hand-written price tag").

**Gate:** `tsc --noEmit` clean (give it heap:
`NODE_OPTIONS=--max-old-space-size=12288`, and confirm the exit code, since an
OOM looks like an empty error list); eslint 0 errors; vitest for the lens
green.

## 6. Verify in a real browser against a real backend

- Boot `server.js` and `next dev`, register a user from the browser (the
  backend blocks non-browser clients), seed real data through the macros.
- **Drive the whole user day** in Playwright (Retail: open the till → set a
  goal → upload photos → sell with a regular and a price tag → cross the
  goal → close the till), then **cross-check every number through the API**
  (e.g. $145.75 + 8.875% tax = $158.69; drawer 100 + 200 − 41.31 = 258.69).
- Screenshot **desktop and phone**, and look at them. Load **every section
  view** and check none crashed (a contact sheet makes this fast).
- This step finds what tests miss. On Retail: a double-cart race on fast
  taps, the till ledger silently refused as a duplicate DTU title, phone
  overlap, unreadable numerals in a display font, a stamp colliding with
  content.

**Gate:** the full day works, the numbers reconcile, and screenshots
reviewed with no defects left open.

## 7. Gate, commit, push

- Final run: tsc, lens vitest, eslint, the domain's backend suite,
  `node scripts/grade-ux-polish.mjs --honest` → the lens is `polished`, 0
  anti-patterns, 0 inline hex.
- Revert generated artifacts (`git checkout -- audit/`,
  `concord-frontend/next-env.d.ts`) and delete `concord-frontend/AGENTS.md`
  (written by `next dev`). Stage named files only.
- Commit by unit: backend + tests, then frontend. Messages state what was
  verified and with which numbers.
- Update `docs/lens-specs/<lens>-capability-map.md` with a dated note, add
  the lens to the **Identity registry** below, and log remaining limits as
  a follow-up issue.

---

## Identity registry

One row per redesigned lens. A new identity must differ from every row on
concept, reference product, palette family and signature interaction.

| Lens | Identity | Reference | Palette family | Type | Signature interactions | Tokens |
|---|---|---|---|---|---|---|
| `retail` | **The Stall**: a market stall at dusk | Shopify POS + admin | chalkboard green-black, wood, brass, receipt paper, tomato, leaf | Permanent Marker (sign), Caveat (chalk/hand, numerals), Courier Prime (till roll) | crates with stock fill + hanging price tags; till roll that inks lines in on server confirm; rubber-stamp milestones; goal bell; open/close the till | `components/retail/app/stall.css` (`--stall-*`) |
| `conkay` | **The Workshop**: late night in a private lab; one open wireframe over a dark glass table | Iron Man workshop FUI (Jayse Hansen) for feel, Fusion 360 for function | near-black void, arc-reactor cyan, amber warnings, red failures only, glass panes with HUD corner brackets | Chakra Petch (HUD labels), JetBrains Mono (numbers) | wireframe → materialise on a real solve; scan plane only while a solve is in flight; callouts anchored to the governing member; Kay as a ring of light driven by real mic level / speech / in-flight state; table · wall · under the hood | `components/conkay/workshop/workshop.css` (`--ws-*`, `.ws-tokens` for the ⌘J overlay) |
| `studio` | **The Booth**: a recording booth and control room; one song, three rooms (Write · Produce · Mix) | Ableton Live session/arrangement for workflow, an SSL/Neve console for feel | warm black walls, brushed-metal console, cream VU faces with amber backlight, tape-red record light, scribble-strip tape | Bebas Neue (engraved labels, room keys), Gochi Hand (scribble strips), Share Tech Mono (LED counters/readouts) | VU needles with real ballistics from analyser RMS; tuner needle from the live Pitch Correct worklet; record light lit only while recording; one-tap Tune vocal with measured before/after cents; MIDI learn from a real controller; song sections you jump and loop | `components/studio/booth/booth.css` (`--bo-*`) |
| `music` | **Liner Notes**: a bright, quiet gallery where independent artists release and sell their music | Apple Music (Listen Now, library, player) for clarity; Bandcamp for the artist storefront | paper white with ink, each page washed in its cover's measured colour, one red accent; warm ink in dark mode | Fraunces (serif headlines, the artist's note), Inter Tight (interface), IBM Plex Mono (durations, prices, BPM/key) | cover-tinted release and artist pages; the artist's liner note set like a printed sleeve with a drop cap; credits and a remix family tree that pays its sources; Buy that only turns to "In your library" on the server's word; equaliser bars only while audio plays | `components/music/liner/linernotes.css` (`--ln-*`) |
| `code` | **Proof**: a calm, keyboard-first editor where every change carries its evidence and GitHub opens only when that evidence is green | Zed and Linear for calm speed and keyboard-first flow; GitHub's pull-request review for reading a change | deep ink-graphite, hairline rules, no shadows; exactly one meaningful colour, lime "proved", used only where a check passed and on the push control when the whole proof is green | Geist (interface), Geist Mono (code, the ledger, every number) | the seal: a ring of five check segments, each in its check's state, that closes into a lime PROVED stamp only when the ledger is green (a mini seal rides the top bar); checks read as numbered ledger entries with dotted leaders to their verdict; the editor gutter marks exactly the lines the proved diff adds (lime) and where it removed lines (coral notch). The Proof Strip: types (TypeScript service), lint, tests and a run (in your browser, bound to a fingerprint of the code), and a per-file read diff, each proved or open with its reason; a check that turns proved lands visibly; push goes to a governed proposal on a new branch and only on approval; AI edits arrive as diffs to accept or discard, never silent writes; ⌘P / ⌘⇧P / ⌘↵ / ⌘⇧↵ / ⌥R | `components/code/proof/proof.css` (`--pf-*`) |
| `news` | **The Situation Room**: a night-shift operations room where the world map is the front page — where the world is reporting from, read from the stories' own words | A newsroom wall / ops-centre world board for the map-first layout; Ground News for comparing coverage across outlets | deep navy with a faint plotting grid; a violet → rose → coral heat ramp for reporting volume; coral only for live (last 3h, live lamp); periwinkle dashed rings for outlet-country-only placements | Barlow Condensed (labels, place names, big counts), Barlow (reading), Azeret Mono (UTC clock, timestamps, numbers) | countries heat by how many stories name them; pulses for the last 3h; great-circle arcs between places named in the same story; a 72/24/6h timeline you drag or replay; a dossier that says in words why every story sits where it does; the Desk drawer (briefing, alerts, library, analyst, delivery) | `components/news/room/room.css` (`--sr-*`) |
| `market` | **The Auction House**: an evening saleroom where people sell the DTUs they made for Concord Coin | Christie's / Sotheby's online catalogue and saleroom; Etsy-style filtering for browsing | oxblood band over warm cream catalogue paper, brass rules; oxblood is the house (navigation, buy), brass is the drawing, a red wax stamp marks sold | Cormorant Garamond (lot titles, italic; catalogue numbers in small caps), Jost (everything else) | lots as printed plates with an engraved catalogue number and cover; facet rail with real counts; two-step buy that shows the maker's net and your balance after; the front window drawn by lot every hour from a published seed the browser can redo; the commission pay board with escrowed rewards and server-run checks; consign with a live plate preview; keys 1–6 rooms, / search, esc close | `components/market/house/house.css` (`--ah-*`) |
| `art` | **The Atelier**: a north-lit painter's studio that opens straight onto the canvas | Procreate / Krita for the painting surface; a real studio's brush tray, mixing slab and pinned reference wall | raw linen and gesso white, charcoal ink, one cadmium-orange accent for what's in hand; ultramarine only for outside reference material | Young Serif (the piece's name, room titles), Work Sans (every control) | the canvas on an easel with north light; a brush tray with the tool in hand lifted and stained cadmium; a mixing slab (loaded colour, dabs, palette swatches that load the brush); the studio wall (layers, references + Met/AIC museums, colour, tools, notes); pieces as small stretched canvases; Put on sale renders the canvas and consigns it to the Auction House with the piece it came from; keys B/E/V/L/G/I/T/R/O/N, [ ], ⌘Z / ⇧⌘Z | `components/art/atelier/atelier.css` (`--at-*`) |
| `chat` | **The Notebook**: a working notebook on graph paper where every reply is a numbered entry and what backs it is pinned in the margin | Claude.ai / ChatGPT for the conversation; a lab notebook for the page (numbered entries, a ruled margin, evidence beside the claim) | warm paper with a faint blue plotting grid, pencil-grey ink, a red margin rule and red-ink entry numbers; highlighter yellow only for the current choice; blue ink for links | Newsreader (replies and headings, serif), Instrument Sans (interface), Kalam (the handwritten date, entry numbers and "you") | entries numbered in the margin; citations, tool runs and computed numbers pinned in the margin beside the entry that used them; one "Answer as" picker (your assistants, ways of answering, voices); starters as index cards that fill the composer, never send; signed in the server is the record (the list, thread, rename and Branch from here all live on the server; branching copies the saved rows into a new conversation); an honest note in place of a reply when no model is available | `components/chat/notebook/notebook.css` (`--nb-*`) |
