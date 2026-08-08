class_name TestAppearanceArchetype
extends RefCounted
## Pure-logic tests for avatar/appearance_archetype.gd — Character archetype
## signal (2026-08-08). No engine/scene-tree dependency (pure static
## functions), same split as test_lock_on_state.gd.

const AppearanceArchetype := preload("res://avatar/appearance_archetype.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_legend_shortcut_overrides_clothing(t)
	_test_robe_mystic_by_hairstyle(t)
	_test_robe_scholar_default(t)
	_test_coat_is_scholar(t)
	_test_vest_is_guard(t)
	_test_apron_is_trader(t)
	_test_shirt_default_by_bodytype(t)
	_test_unrecognized_top_falls_to_default(t)
	_test_extended_kinds_mirror_ts_covered_bucket(t)
	_test_resolve_from_dict_honest_empty_on_missing(t)
	_test_resolve_from_dict_full_shape(t)
	_test_resolve_from_dict_partial_shape_uses_defaults(t)
	_test_resolve_from_dict_non_dictionary_clothing_is_ignored(t)
	return t


## Mirrors AvatarSystem3D.tsx#archetypeForPlayerAppearance's own first
## check: bodyType 'legend' short-circuits everything else, regardless of
## clothing.
static func _test_legend_shortcut_overrides_clothing(t: TestUtils) -> void:
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("legend", "apron", "short"), "legend",
		"a 'legend' bodyArchetype always resolves to 'legend', regardless of clothing.top.kind")


static func _test_robe_mystic_by_hairstyle(t: TestUtils) -> void:
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "robe", "bun"), "mystic",
		"robe + bun hairStyle resolves to mystic, matching the TS reference's tie-break")
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "robe", "long"), "mystic",
		"robe + long hairStyle also resolves to mystic")


static func _test_robe_scholar_default(t: TestUtils) -> void:
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "robe", "short"), "scholar",
		"robe + any other hairStyle resolves to scholar (the TS reference's default arm)")


static func _test_coat_is_scholar(t: TestUtils) -> void:
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "coat", "short"), "scholar",
		"coat always resolves to scholar, matching the TS reference")


static func _test_vest_is_guard(t: TestUtils) -> void:
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "vest", "short"), "guard",
		"vest always resolves to guard, matching the TS reference")


static func _test_apron_is_trader(t: TestUtils) -> void:
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "apron", "short"), "trader",
		"apron always resolves to trader, matching the TS reference")


static func _test_shirt_default_by_bodytype(t: TestUtils) -> void:
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("stocky", "shirt", "short"), "warrior",
		"shirt + stocky bodyArchetype resolves to warrior, matching the TS reference")
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "shirt", "short"), "hunter",
		"shirt + non-stocky bodyArchetype resolves to hunter, matching the TS reference")


static func _test_unrecognized_top_falls_to_default(t: TestUtils) -> void:
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "not-a-real-kind", "short"), "hunter",
		"an unrecognized top kind falls to the same default bucket 'shirt' uses, never a fabricated archetype")


## The 9 real ClothingTopKind values with no TS-reference mapping — this
## file's own extension (see appearance_archetype.gd's own class doc for the
## full reasoning). Pinned so the grouping is deliberate and stays put.
static func _test_extended_kinds_mirror_ts_covered_bucket(t: TestUtils) -> void:
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "tunic", "short"), "hunter",
		"tunic groups into the shirt/default bucket")
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("stocky", "jacket", "short"), "warrior",
		"jacket groups into the shirt/default bucket (bodyType still applies)")
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "trench", "short"), "scholar",
		"trench groups into the coat/scholar bucket")
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "duster", "short"), "scholar",
		"duster groups into the coat/scholar bucket")
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "breastplate", "short"), "guard",
		"breastplate groups into the vest/guard bucket")
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "cassock", "bun"), "mystic",
		"cassock groups into the robe bucket, same hairStyle tie-break applies")
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "kanga", "short"), "trader",
		"kanga groups into the apron/trader bucket")
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "synth-jacket", "short"), "hunter",
		"synth-jacket groups into the shirt/default bucket")
	t.check_eq(
		AppearanceArchetype.archetype_for_appearance("average", "cape", "short"), "hunter",
		"cape (no clear garment family) falls to the shirt/default bucket")


static func _test_resolve_from_dict_honest_empty_on_missing(t: TestUtils) -> void:
	t.check_eq(
		AppearanceArchetype.resolve_from_dict(null), "",
		"a null appearance (brand-new player, never saved) returns an honest empty string, never a fabricated archetype")
	t.check_eq(
		AppearanceArchetype.resolve_from_dict("not-a-dict"), "",
		"a non-Dictionary appearance value is treated the same as missing")


static func _test_resolve_from_dict_full_shape(t: TestUtils) -> void:
	var appearance := {
		"bodyArchetype": "stocky",
		"hairStyle": "short",
		"clothing": {"top": {"kind": "vest", "color": "#888"}, "bottom": {"kind": "pants", "color": "#444"}},
	}
	t.check_eq(
		AppearanceArchetype.resolve_from_dict(appearance), "guard",
		"a real, full RichAppearanceConfig-shaped dict resolves via the real fields, not defaults")


static func _test_resolve_from_dict_partial_shape_uses_defaults(t: TestUtils) -> void:
	# Only bodyArchetype saved (e.g. an in-progress customizer edit) — the
	# missing hairStyle/clothing degrade to the same defaults character-
	# schema.ts's own generator uses ('short'/'shirt'), not a fabricated
	# guess, and a real archetype is still resolved rather than "".
	var appearance := {"bodyArchetype": "stocky"}
	t.check_eq(
		AppearanceArchetype.resolve_from_dict(appearance), "warrior",
		"a partially-saved appearance still resolves a real archetype from what IS present")


static func _test_resolve_from_dict_non_dictionary_clothing_is_ignored(t: TestUtils) -> void:
	var appearance := {"bodyArchetype": "average", "clothing": "not-a-dict"}
	t.check_eq(
		AppearanceArchetype.resolve_from_dict(appearance), "hunter",
		"a malformed clothing field degrades to the shirt default rather than crashing")
