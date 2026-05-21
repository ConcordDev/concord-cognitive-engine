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
- [ ] `[L]` Interactive chat preview — talk to the persona in-lens before/after install (Character.AI's core loop).
- [ ] `[M]` Persona marketplace browse — discover/search other users' published personas, not just your own.
- [ ] `[M]` Visual persona editor — author personality, voice, greeting, example dialogue from scratch (not only from an existing NPC).
- [ ] `[S]` Avatar/portrait — image upload or generation per persona.
- [ ] `[S]` Ratings + usage stats — popularity, install count, reviews.
- [ ] `[M]` Persona versioning — revise a published persona and notify installers.
- [ ] `[S]` Tags + categories for discovery.

## Parity
~35% of Character.AI's feature surface. It is a genuine persona packaging + monetization pipeline, but with no chat preview, no marketplace browse, and no from-scratch editor it serves authors of existing NPCs rather than the conversational-character experience the leader is built on.
