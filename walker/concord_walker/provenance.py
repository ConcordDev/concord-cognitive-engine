"""C25: case provenance tagging (ULW upgrade audit section C; Gate S10, founder ruling #11).

Generated cases are tagged per case:

  OBSERVED     -- generated from the route shape and fixture data the fleet
                  already has; reachable, and they COUNT.
  EXTRAPOLATED -- enumerated from imagination; they test a workflow nobody
                  may run. Reported as speculative coverage, NEVER summed
                  into the coverage figure of record.

The two kinds are kept in SEPARATE COUNTS in every report: the coverage
figure of record is the observed count alone (provenance_counts below is
the only counting door -- it returns the kinds side by side and refuses
an unknown tag rather than silently summing it in).

Where generated cases live in this tree:
  * rewrite records (concord_walker/rewrites.py) -- a case is OBSERVED
    when its steps are grounded in observed artefacts: a control or value
    resolved against the live labels (src live:), the manifest
    (manifest:), or the frontend source at the fold sha (frontend:).
    A record resting on ticket text / alias alone was enumerated from
    prose, not from anything the fleet has observed: EXTRAPOLATED.
  * form-fuzz batteries (concord_walker/formfuzz.py) -- a case drawn
    from the ticket's own named values (ticket-value) is OBSERVED; the
    enumerated patterns (blank / whitespace / negative / huge /
    bad-chars) are EXTRAPOLATED.

The vocabulary matches the recipe corpus's case_source field (CB-0818):
"observed" | "extrapolated".
"""
import re

OBSERVED = "observed"
EXTRAPOLATED = "extrapolated"
CASE_SOURCES = (OBSERVED, EXTRAPOLATED)

# Step sources that ground a rewrite step in an observed artefact.
_GROUNDED_SRC = re.compile(r"^(?:live:|manifest:|frontend:)")

# Form-fuzz battery case names enumerated from imagination; anything the
# ticket itself named is observed (see classify_battery_case).
_ENUMERATED_BATTERY = frozenset({"blank", "whitespace", "negative", "huge", "bad-chars"})


def classify_rewrite(rw):
    """-> OBSERVED | EXTRAPOLATED for a rewrite record, from its own step
    grounding. OBSERVED iff at least one step is grounded in an observed
    artefact (live:/manifest:/frontend:) and every control-bearing step
    (click / open_tab) is grounded or an alias; a record with no grounded
    step at all was enumerated from prose alone -> EXTRAPOLATED."""
    steps = (rw or {}).get("steps") or []
    grounded = any(_GROUNDED_SRC.match(s.get("src") or "") for s in steps if isinstance(s, dict))
    if not grounded:
        return EXTRAPOLATED
    for s in steps:
        if not isinstance(s, dict):
            continue
        if s.get("op") in ("click", "open_tab"):
            src = s.get("src") or ""
            if not (_GROUNDED_SRC.match(src) or src == "alias"):
                return EXTRAPOLATED
    return OBSERVED


def classify_battery_case(case_name):
    """-> OBSERVED | EXTRAPOLATED for one form-fuzz battery case name.
    Ticket-named values are observed; the enumerated patterns are not."""
    if case_name == "ticket-value":
        return OBSERVED
    if case_name in _ENUMERATED_BATTERY:
        return EXTRAPOLATED
    return EXTRAPOLATED  # fail closed: an unknown case name is not coverage of record


def provenance_counts(tags):
    """The separate-counts door. Takes an iterable of case_source tags and
    returns {"observed": n, "extrapolated": m, "coverage_of_record": n}.
    There is deliberately NO total: the kinds are never summed. An unknown
    tag raises ValueError (fail closed) instead of being folded in."""
    obs = ext = 0
    for t in tags:
        if t == OBSERVED:
            obs += 1
        elif t == EXTRAPOLATED:
            ext += 1
        else:
            raise ValueError("unknown case_source tag: %r" % (t,))
    return {"observed": obs, "extrapolated": ext, "coverage_of_record": obs}
