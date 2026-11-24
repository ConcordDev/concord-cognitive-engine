"""ULW C35: the defect-class vocabulary of record, frozen in the walker tree.

This module is the ONE named act the office seated as C35 (GB-1560's
five-item desk diff, 2026-11-19): the walker's defect-class vocabulary,
written down here, with the checks machinery (checks.py finding())
pointed at it.

Source of record: the Walker Freeze Constitution
(ultimate-walker-freeze-constitution-2026-11-06.md) — Tables 1 + 2
FROZEN by the Freeze Act (2026-11-06), Amendment 1 (2026-11-07: six
classes enter as Table 2 additions 11-16), Amendment 2 (2026-11-07:
absent-exit-path, carried provisional under absent-lifecycle, is
FROZEN AS A CLASS under that family). Definitions below are the
constitution's / registry's words verbatim (B2's calibration
registry, ~/workspace/walker/contracts/registry.mjs, carries the
same 25 with their per-check contracts: hunt, applicability,
evidence, verdict).

The frozen vocabulary stands at 25 classes: Table 1's standing
eight + Table 2's seventeen.

AMENDMENT PATH (the Freeze Act's own growth rule, carried entire):
a new class enters ONLY by hand-verified instance, filed as a dated
amendment to the constitution — never by a check's or a contract's
convenience. This module changes only in step with such an
amendment. Table 3 candidates stand in POSTURE below: recorded,
hunted, pricing NOTHING — a candidate tag is refused by the
machinery exactly like an unknown one, with its posture named.
dialog-self-dismissal is EXCLUDED by name: a CLOSED candidate,
expressly not a class, so no finding can key on it by accident.

PROVISIONAL sub-classes: currently none. The one provisional of
record (absent-exit-path under absent-lifecycle) graduated to a
frozen class by Amendment 2 and stands in CLASSES.
"""

# Each entry: tag (the join key), table (1 | 2), name (as tabled),
# definition (the class's definition in the constitution's words),
# entered_by (only for classes that entered after the Freeze Act).
CLASSES = (
    # -- Table 1: the standing eight (of record since 2026-10-28) --
    {"tag": "silent-wrong-answers", "table": 1,
     "name": "silent wrong answers",
     "definition": "Success/number reported; the value is wrong, fabricated, or stored as NULL."},
    {"tag": "generation-as-execution", "table": 1,
     "name": "generation-as-execution",
     "definition": "Generated/simulated output presented in an execution slot."},
    {"tag": "unwired-unreachable", "table": 1,
     "name": "unwired / unreachable surfaces",
     "definition": "Real backend or live-looking surface the user cannot reach or operate."},
    {"tag": "shortcut-keystroke-eating", "table": 1,
     "name": "shortcut keystroke-eating",
     "definition": "Bare-key shortcuts or input handling consume/corrupt typed input. Three named mechanisms: #1 aggregate composition (one global command exposes every command in the instance inside form fields), #2 nested-remount focus drop, #3 bare-letter interception (including its in-modal form)."},
    {"tag": "ownerless-writes", "table": 1,
     "name": "ownerless writes",
     "definition": "Mutations accepted without existence/ownership checks."},
    {"tag": "greeting-dead-surfaces", "table": 1,
     "name": "greeting / dead surfaces",
     "definition": "Chrome performs welcome/success while substance is absent — or real success goes unacknowledged."},
    {"tag": "permission-walls", "table": 1,
     "name": "permission walls",
     "definition": "A normal account is walled out of a lens's core (the wall presented as product is the defect)."},
    {"tag": "native-dialog-dead-controls", "table": 1,
     "name": "native-dialog dead controls",
     "definition": "Controls that exist, accept clicks, and do nothing (incl. native-dialog paths). Mechanism of record: a window.confirm/prompt/alert gate in the frontend handler never resolves in Concord's embedded browser, so the handler returns before the macro call ever fires — any control gated behind a native dialog in the embedded browser is dead by construction. Census of record: 292 native-dialog call sites in 139 files; a fix closes an instance, not a lens."},

    # -- Table 2: hand-verified additions (Freeze Act items 9-18) --
    {"tag": "test-content-on-prod", "table": 2,
     "name": "test-content-on-prod",
     "definition": "Test/harness fixture content persists into a lens's public surface — content authored under test identities or harnesses (zk-/tz-/zukotest-shaped authors, 'harness value' strings, timestamped run titles, mass-identical rows) presented as ordinary public content. Mechanism: fixture content is authored into the same stores public surfaces read, and no fence separates test-authored content from production content. COUNT-CONTAMINATING instances (residue inside a headline figure) grade at the class's top."},
    {"tag": "envelope-read", "table": 2,
     "name": "envelope-read",
     "definition": "A consumer reads payload fields off the { ok, result } envelope, or off values delivered by the unwrapping clients. Ten convictions of record, two shapes."},
    {"tag": "stale-vocabulary", "table": 2,
     "name": "stale-vocabulary",
     "definition": "Handler-layer validation gated on a vocabulary the surface never sends. Parity is read at the handler layer."},
    {"tag": "unconfirmed-destructive", "table": 2,
     "name": "unconfirmed-destructive",
     "definition": "Delete/overwrite executes instantly — no confirmation, undo, or reference warning. The protected property is confirmation before an irreversible effect, and irreversible PUBLICATION is inside the class's centre, not its edge. Two forms: raw (no confirmation wired) and wired-without-confirmation; the wired-and-confirming pole is the standard met, not a defect."},
    {"tag": "null-figure", "table": 2,
     "name": "null-figure",
     "definition": "An absent value formatted as a number. Forms: figure · propagation · dashboard · board. Priced once at the platform formatting layer."},
    {"tag": "amount-field-rewriting", "table": 2,
     "name": "amount-field rewriting",
     "definition": "Fields reject, never rewrite — including the accept-and-clamp form and the silent sign-drop form."},
    {"tag": "feed-migration-staleness", "table": 2,
     "name": "feed-migration staleness",
     "definition": "An external feed's version drift breaking a surface in place."},
    {"tag": "lens-crashing-compute", "table": 2,
     "name": "lens-crashing compute",
     "definition": "A tool throws instead of returning its result or declining in words. Five members of record."},
    {"tag": "namesake-figure", "table": 2,
     "name": "namesake figure",
     "definition": "A printed figure naming a thing it does not measure. Seven instances of record."},
    {"tag": "dedupe-without-reason", "table": 2,
     "name": "dedupe-without-reason",
     "definition": "A dedupe verdict that names no reason. Two instances: wrong at Physics, right at Crisis-Ops, silent in both; priced diagnosis-first."},

    # -- Table 2 additions 11-16: Amendment 1 (2026-11-07) --
    {"tag": "simulated-tier-surfaces", "table": 2,
     "name": "simulated-tier-surfaces",
     "definition": "Lens serves schema-shaped simulated data on prod. Founder doctrine (Ramaj, 2026-10-28): 'There's never intentional staging — make it live like everything else should be.' A non-Live tier is a gate failure by definition: no reviewer judgement call, in any doc; the defect files P0 against the lens.",
     "entered_by": "Amendment 1 (2026-11-07), Table 2 addition 11"},
    {"tag": "split-store-persistence", "table": 2,
     "name": "split-store-persistence",
     "definition": "Two surfaces of one lens hold different data; or saved state doesn't survive/reach/re-read.",
     "entered_by": "Amendment 1 (2026-11-07), Table 2 addition 12"},
    {"tag": "raw-identifiers-as-identity", "table": 2,
     "name": "raw-identifiers-as-identity",
     "definition": "People/objects render as UUIDs or raw internal IDs in user chrome.",
     "entered_by": "Amendment 1 (2026-11-07), Table 2 addition 13"},
    {"tag": "absent-lifecycle", "table": 2,
     "name": "absent-lifecycle",
     "definition": "A created object lacks lifecycle verbs — some of rename/edit/archive/restore/delete/duplicate missing or one-way. The DELETE-pole of this family is tagged absent-exit-path (frozen as a class by Amendment 2, 2026-11-07): when the missing verb is the exit, the finding files under the exit tag, NOT here — no double-tagging.",
     "entered_by": "Amendment 1 (2026-11-07), Table 2 addition 14"},
    {"tag": "vocabulary-misleading", "table": 2,
     "name": "vocabulary-misleading",
     "definition": "Chrome/labels claim a substrate, scope, or semantics the surface doesn't have — names, palettes, buttons labelled for a broader or different function than the one wired. Included forms: a compound claim half true (the true half lending the false half its credibility) and a real computation wearing a borrowed instrument's name, authority, or unit. Boundary rule (of record): if the LABEL claims a capability/substrate that isn't there, it is this class; if the system PRODUCES OUTPUT presented as the result of an execution that didn't happen, it is generation-as-execution. A surface can carry both; tag each finding by which it is.",
     "entered_by": "Amendment 1 (2026-11-07), Table 2 addition 15"},
    {"tag": "status-sign-inconsistency", "table": 2,
     "name": "status-sign-inconsistency",
     "definition": "Status/tier signs are absent, misplaced, flickering, or contradict each other or the surface's actual state, so no single sign can be trusted. Three mechanisms, one class: (a) missing-on-landing; (b) contradictory-concurrent — two signs on one surface disagree at the same moment, including the independent-LIVE-badge sub-pattern (a chrome element painting LIVE from a source independent of the tier derivation; in the compilation this is ONE platform check — badge-vs-banner agreement on every lens's landing — not per-lens findings); (c) settling-flicker — the sign paints a false state on first paint before settling, and the false sign can be a VALUE (metric cards painting 0 before resolving), not only chrome.",
     "entered_by": "Amendment 1 (2026-11-07), Table 2 addition 16"},

    # -- Amendment 2 (2026-11-07): frozen as a class --
    {"tag": "absent-exit-path", "table": 2,
     "name": "absent-exit-path",
     "definition": "A created object the user cannot get rid of — creation succeeds and persists, but no working exit (delete/remove) exists for it. The owner's OWN object, properly owned and persisted, that the owner cannot undo. Three named shapes: (i) NO-CONTROL exit — no delete/remove control exists anywhere on the surface; (ii) DEAD-CONTROL exit — the control exists, accepts clicks, and does nothing (if a native-dialog gate is found upstream, the instance cross-references native-dialog-dead-controls, but the TAG stays here, the user's position being identical); (iii) OBJECT-MODEL absence — the no-control shape repeated across the lens's other object kinds, showing the absence sits at the object-model layer. NOT ownerless-writes (a sibling, not a parent: that class is a mutation accepted without existence/ownership checks; this is the owner's own object they cannot undo). Under absent-lifecycle's family by Amendment 2: the exit tag when the missing verb is the exit; no double-tagging with the parent.",
     "entered_by": "Amendment 2 (2026-11-07) — frozen as a class, graduated from PROVISIONAL under absent-lifecycle"},
)

# The frozen tag set, in table order — the vocabulary's integrity anchor.
FROZEN_TAGS = tuple(c["tag"] for c in CLASSES)

_BY_TAG = {c["tag"]: c for c in CLASSES}

# CLOSED and excluded by name (Freeze Act, 2026-11-06): never a class,
# never a valid tag.
EXCLUDED = (
    {"tag": "dialog-self-dismissal",
     "reason": "CLOSED candidate, expressly not a class (freeze act, 2026-11-06): sole instance HVAC S1 closed by that lens's own fix; the class was never promoted and holds no live instance. No contract prices against it."},
)
_EXCLUDED_TAGS = frozenset(e["tag"] for e in EXCLUDED)

# Table 3 candidates, recorded in their true posture: they freeze
# nothing and price nothing. A candidate enters only by the growth
# rule (hand-verified instance -> dated amendment to the constitution).
POSTURE = (
    {"tag": "generation-applied-without-review", "posture": "candidate, hunt-only — one instance (Cooking F4)"},
    {"tag": "empty-state-promises-vs-the-registry", "posture": "candidate (Society)"},
    {"tag": "unscoped-shared-store-rendering", "posture": "candidate — IMPORT and EXPORT poles named (Creative · Maker)"},
    {"tag": "nested-control-dismissal", "posture": "candidate, one instance (Artistry F5); mechanism expressly a code-read question"},
    {"tag": "spinner-unmount", "posture": "candidate, hunt-only — one instance (Space F9); a distinct mechanism from shortcut keystroke-eating"},
    {"tag": "pre-filled-values-not-registered-until-re-typed", "posture": "pattern candidate, hunt-only (Masonry O3)"},
)
_POSTURE_TAGS = frozenset(p["tag"] for p in POSTURE)


def class_for(tag):
    """The frozen class entry for a tag, or None."""
    return _BY_TAG.get(tag)


def is_frozen(tag):
    return tag in _BY_TAG


def validate_defect_class(tag):
    """(ok, reason) for a proposed finding tag.

    ok=True only for a frozen class. Otherwise reason names the
    refusal precisely: "excluded" (a closed candidate, never a
    class), "candidate" (Table 3 posture — recorded, pricing
    nothing), or "unknown" (not in the vocabulary at all). New
    classes enter only by the amendment path in this module's
    header; there is no fourth outcome.
    """
    if tag in _BY_TAG:
        return (True, None)
    if tag in _EXCLUDED_TAGS:
        return (False, "excluded")
    if tag in _POSTURE_TAGS:
        return (False, "candidate")
    return (False, "unknown")
