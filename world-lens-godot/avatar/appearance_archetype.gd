class_name AppearanceArchetype
extends RefCounted
## AppearanceArchetype — player RichAppearanceConfig -> hero-mesh archetype.
##
## Ports `archetypeForPlayerAppearance` (concord-frontend/components/
## world-lens/AvatarSystem3D.tsx:328-347) — the heuristic that maps a
## player's OWN character-customizer choices onto one of the 7 real
## hero-mesh archetypes (public/meshes/heroes/), the same vocabulary
## avatar_rig.gd's `archetype` export already resolves against.
##
## ── Why this reads the RICH shape, not the primitive one ────────────────
## The TS function above is typed against AvatarSystem3D.tsx's own LOCAL,
## narrower `AppearanceConfig` (clothing.top.type: 5 values, hairStyle: 6
## values, bodyType: 5 values) — but that is NOT what's actually persisted
## server-side. `server/domains/appearance.js#save`/`load_for_user`
## persists/returns the full `RichAppearanceConfig`
## (concord-frontend/lib/world-lens/character-schema.ts:271-309):
## `bodyArchetype` (7 values), `clothing.top.kind` (14 values — note `kind`,
## not `type`), `hairStyle` (13 values). Confirmed live and real by reading
## `app/onboarding/character/page.tsx`'s actual save call — the onboarding
## character creator genuinely persists this shape and re-loads it on
## return, this is not dead/unused code.
##
## A REAL, separate, pre-existing bug (found, NOT fixed here — it lives in
## the Three.js reference, out of this client's scope): the world page's
## own appearance-load effect (`concord-frontend/app/lenses/world/page.tsx`
## ~1982-2008) only merges `skinColor`/`hairColor`/clothing COLOR fields
## from the loaded RichAppearanceConfig — it never reads `bodyArchetype`/
## `clothing.top.kind`/`hairStyle` at all, and that file's own
## `playerAvatar` useState even TYPES those three fields as single-value
## string literals (`bodyType:'average'`, `clothing.top.type:'shirt'`,
## `hairStyle:'short'`), not the union types `AppearanceConfig` declares.
## `archetypeForPlayerAppearance` therefore always evaluates the SAME
## branch in the live web client today (shirt + non-stocky -> 'hunter'),
## regardless of what a player actually customized. Porting THAT
## degenerate behavior here would be fabricated precision dressed as
## personalization. Instead, `world/player_appearance_loader.gd` reads
## `appearance.load_for_user` DIRECTLY (bypassing the web client's lossy
## merge entirely), so this client's local-player archetype is MORE
## accurate than what currently ships in the browser reference today — an
## honest improvement, not a divergence for its own sake.
##
## ── Coverage beyond the TS reference ─────────────────────────────────────
## The 5 branches below (shirt/vest/coat/robe/apron) match
## `archetypeForPlayerAppearance` EXACTLY — same TS source, same cases. The
## remaining 9 real `ClothingTopKind` values (tunic/jacket/trench/
## breastplate/synth-jacket/cassock/kanga/duster/cape) have NO TS-reference
## mapping to port: the web client's own live state literally never
## produces any of them (see above). These are THIS FILE'S OWN, clearly-
## labeled extension — grouped onto the nearest matching TS bucket by
## real-world garment family (tunic/jacket/synth-jacket -> shirt's default
## bucket; trench/duster -> coat's scholar bucket; cassock -> robe's
## mystic/scholar bucket; breastplate -> vest's guard bucket; kanga ->
## apron's trader bucket; cape has no clear family and falls to the
## default bucket) — not a claim that this is what the TS reference "would"
## do if it saw these values.


## Pure. Mirrors AvatarSystem3D.tsx#archetypeForPlayerAppearance's exact
## branch structure for the 5 TS-covered kinds, extended per the class doc
## above for the other 9 real ClothingTopKind values.
static func archetype_for_appearance(body_archetype: String, top_kind: String, hair_style: String) -> String:
	if body_archetype == "legend":
		return "legend"
	match top_kind:
		"robe", "cassock":
			return "mystic" if (hair_style == "bun" or hair_style == "long") else "scholar"
		"coat", "trench", "duster":
			return "scholar"
		"vest", "breastplate":
			return "guard"
		"apron", "kanga":
			return "trader"
		_:
			# shirt/tunic/jacket/synth-jacket/cape, and any unrecognized kind —
			# the same default bucket the TS reference's own
			# `case 'shirt': default:` arm covers.
			return "warrior" if body_archetype == "stocky" else "hunter"


## Extracts bodyArchetype/clothing.top.kind/hairStyle out of a parsed
## RichAppearanceConfig-shaped Dictionary (the real `appearance.
## load_for_user` result) and resolves an archetype. Returns "" — an
## honest, real "no signal" answer, never a fabricated guess — when
## `appearance` itself is null/missing/non-Dictionary (a brand-new player
## who has never saved a character, or a load failure the caller already
## detected via its own envelope checks). When `appearance` IS a real
## Dictionary but individual fields are absent, missing sub-fields degrade
## to the same defaults character-schema.ts's own generator falls back to
## ('average'/'shirt'/'short') so a partially-saved profile still resolves
## to a real archetype instead of being discarded entirely.
static func resolve_from_dict(appearance: Variant) -> String:
	if typeof(appearance) != TYPE_DICTIONARY:
		return ""
	var body_archetype := String(appearance.get("bodyArchetype", "average"))
	var hair_style := String(appearance.get("hairStyle", "short"))
	var top_kind := "shirt"
	var clothing = appearance.get("clothing", {})
	if typeof(clothing) == TYPE_DICTIONARY:
		var top = clothing.get("top", {})
		if typeof(top) == TYPE_DICTIONARY:
			top_kind = String(top.get("kind", "shirt"))
	return archetype_for_appearance(body_archetype, top_kind, hair_style)
