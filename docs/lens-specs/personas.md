# personas — Feature Gap vs Character.AI

Category leader (2026): Character.AI (persona authoring + sharing). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `npc_persona` domain macros (`list_for_user`, `package`, `install`) — package an NPC's grudges/schemes/schedule/opinions as a sellable DTU; install imports persona rows into a world. Royalty cascade pays the author. Page also mounts `CharacterStudio`.

## Has (verified in code)
- Package an existing NPC (id + summary) into a content-hashed DTU persona pack.
- Install a persona DTU into a target world (reports imported NPC id + row count).
- List your authored persona packages with DTU id + sha256 + date.
- Royalty cascade integration — CC paid to author on each downstream purchase.
- `CharacterStudio` component for character authoring.

## Missing — buildable feature backlog
- [x] `[L]` Interactive chat preview — talk to the persona in-lens before/after install (Character.AI's core loop). `personas.chat_open` / `chat_send` / `chat_history`; `PersonaChat` component.
- [x] `[M]` Persona marketplace browse — discover/search other users' published personas, not just your own. `personas.browse` + `PersonaMarketplace` component.
- [x] `[M]` Visual persona editor — author personality, voice, greeting, example dialogue from scratch (not only from an existing NPC). `personas.create` / `update` / `PersonaEditor` component.
- [x] `[S]` Avatar/portrait — image upload or generation per persona. `personas.regenerate_portrait` (deterministic SVG generation + data-URI upload).
- [x] `[S]` Ratings + usage stats — popularity, install count, reviews. `personas.rate` / `stats` / `install`; stats tab with rating-distribution chart.
- [x] `[M]` Persona versioning — revise a published persona and notify installers. `personas.revise` / `versions` (snapshots history, returns installersNotified).
- [x] `[S]` Tags + categories for discovery. `personas.facets`; normalised tags + category filtering in the marketplace.

## Parity
~90% parity. Full conversational-character surface shipped: from-scratch visual editor, in-lens chat preview, browseable marketplace with tag/category facets, ratings + usage stats, versioning with installer notification, and per-persona portraits. The legacy `npc_persona` packaging + royalty pipeline is retained alongside.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
