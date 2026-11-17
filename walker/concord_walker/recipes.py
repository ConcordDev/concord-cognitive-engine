"""Recipe registry (IMM-13 / MST-W1-13): the single authority on which tickets
hold hand-written verification recipes.

Until now the set of hand recipes lived as a hardcoded dict inside
reverify.Reverifier, with no record of who wrote a recipe, who reviewed it, or
whether it had gone stale — so nothing stopped a recipe authored (or reviewed)
by the very seat that fixed the ticket from verifying that fix, and nothing
retired a recipe written against an old build. The registry moves that set
into data: one JSON file per recipe under walker/recipes/ (schema:
walker/recipes/SCHEMA.md), loaded and enforced here.

Loader rules (MST-W1-13, founder answers folded into the claimable spec):
  * author != the ticket's fixer, and reviewer != the ticket's fixer — a
    fixer never grades its own fix, directly or by proxy.
  * reviewers are Dutch or the Zuko desk; any other reviewer is refused.
  * draft recipes are refused; stale recipes are refused — staleness is the
    recorded status OR computed: authored_on older than max_age_days, or a
    pinned verified_against that does not match the build under verification.
  * override_reason is usable by Dutch only: a recipe carrying an override
    signed by Dutch loads despite a refusal, and the override is REPORTED in
    the load result, never silent. An override signed by anyone else is
    itself a refusal.
Every refusal carries its reasons. A ticket whose recipe is refused (or has
no registry entry) is simply not in the dispatch set: it falls to the generic
checks and cap_verdict caps it at NEEDS_HUMAN — refusal always fails toward
the human queue, never toward a verification.

Pure stdlib; no browser, no page JavaScript. The registry only reads files.
"""
import json
import os
from datetime import date

from . import recipe_templates as _templates

# Reviewers of record for walker recipes (MST-W1-13): the founder and his desk.
REVIEWERS = ("dutch", "zuko-desk")
# Only Dutch may override a refusal (override_reason usable by Dutch only).
OVERRIDERS = ("dutch",)
STATUSES = ("active", "draft", "stale")
KINDS = ("code", "repro-steps", "template")
DEFAULT_MAX_AGE_DAYS = 90


def default_recipes_dir():
    """walker/recipes/ beside this package, resolved from this file so the
    registry is found wherever the walker tree lives."""
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "recipes")


def _parse_date(value):
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _check_expect_endpoints(value, reasons):
    if value is None:
        return
    if not isinstance(value, list):
        reasons.append("expect_endpoints must be a list")
        return
    for i, ep in enumerate(value):
        if not isinstance(ep, dict):
            reasons.append("expect_endpoints[%d] must be an object" % i)
            continue
        if not isinstance(ep.get("method"), str) or not ep.get("method"):
            reasons.append("expect_endpoints[%d].method is required" % i)
        if not isinstance(ep.get("path"), str) or not ep.get("path"):
            reasons.append("expect_endpoints[%d].path is required" % i)
        status = ep.get("expect_status")
        if status is not None and not isinstance(status, int):
            reasons.append("expect_endpoints[%d].expect_status must be an integer" % i)


def validate_recipe(raw, today=None, expect_sha=None):
    """Intrinsic validation of one parsed recipe object (schema + status +
    reviewer membership + staleness). Returns (recipe, reasons): recipe is the
    normalized dict when reasons is empty, else None. Authorship against a
    specific fixer is extrinsic — see check_authorship."""
    if not isinstance(raw, dict):
        return None, ["recipe file must contain one JSON object"]
    reasons = []
    _check_case_source(raw, reasons)
    rid = raw.get("id")
    if not isinstance(rid, str) or not rid:
        reasons.append("id is required (the ticket id this recipe verifies)")
    kind = raw.get("kind", "code")
    if kind not in KINDS:
        reasons.append("kind must be one of %s" % (", ".join(KINDS)))
    if kind == "code":
        handler = raw.get("handler")
        if not isinstance(handler, str) or not handler:
            reasons.append("handler is required for kind=code (the walker method name)")
    if kind == "template":
        # LC-06: a template instance binds one of the IMM-14 templates with
        # parameters from its declared list — nothing else is a recipe.
        if raw.get("handler"):
            reasons.append("handler must be omitted for kind=template")
        tname = raw.get("template")
        spec = _templates.TEMPLATES.get(tname) if isinstance(tname, str) else None
        if spec is None:
            reasons.append("template must be one of %s" % (", ".join(sorted(_templates.TEMPLATES))))
        else:
            params = raw.get("params") or {}
            if not isinstance(params, dict):
                reasons.append("params must be an object for kind=template")
            else:
                extra = sorted(set(params) - set(spec["params"]))
                if extra:
                    reasons.append("params %s are not %s template parameters (%s)"
                                   % (extra, tname, ", ".join(spec["params"])))
                if tname == "value-assert":
                    _check_declaration(params, reasons)
        # CB-0810 (documentation standard, amendment #2): an ACTIVE template
        # instance carries its priority tier and its discriminator — the
        # failure transcript from replaying the recipe against the pre-fix
        # shape, recorded in the file by the reviewer at acceptance. Drafts
        # are refused anyway; this binds the flip to active.
        if raw.get("status", "active") == "active":
            tier = raw.get("tier")
            if tier is not None and tier not in (1, 2, 3):
                reasons.append("tier must be 1, 2 or 3")
            if tier is None:
                reasons.append("active template instance requires a tier (CB-0810)")
            disc = raw.get("discriminator")
            if not isinstance(disc, str) or not disc.strip():
                reasons.append("active template instance requires a discriminator — "
                               "the pre-fix failure transcript recorded in the file (CB-0810)")
            if raw.get("case_source") not in ("observed", "extrapolated"):
                reasons.append("active template instance requires a case_source — "
                               "'observed' or 'extrapolated' (ruling #11)")
    author = raw.get("author")
    if not isinstance(author, str) or not author:
        reasons.append("author is required")
    reviewer = raw.get("reviewer")
    if not isinstance(reviewer, str) or not reviewer:
        reasons.append("reviewer is required")
    elif reviewer not in REVIEWERS:
        reasons.append("reviewer %r is not a reviewer of record (Dutch + Zuko desk)" % reviewer)
    status = raw.get("status", "active")
    if status not in STATUSES:
        reasons.append("status must be one of %s" % (", ".join(STATUSES)))
    elif status == "draft":
        reasons.append("draft recipe — drafts are never loaded")
    elif status == "stale":
        reasons.append("recipe is marked stale")
    authored = _parse_date(raw.get("authored_on"))
    if raw.get("authored_on") is not None and authored is None:
        reasons.append("authored_on must be an ISO date (YYYY-MM-DD)")
    max_age = raw.get("max_age_days", DEFAULT_MAX_AGE_DAYS)
    if not isinstance(max_age, int) or max_age < 0:
        reasons.append("max_age_days must be a non-negative integer")
        max_age = DEFAULT_MAX_AGE_DAYS
    if authored is not None and status == "active":
        today = today or date.today()
        age = (today - authored).days
        if age > max_age:
            reasons.append("stale: authored %s, %d days old (max %d)"
                           % (raw.get("authored_on"), age, max_age))
    pinned = raw.get("verified_against")
    if expect_sha and pinned and pinned != expect_sha:
        reasons.append("stale: verified against %s, current build is %s" % (pinned, expect_sha))
    _check_expect_endpoints(raw.get("expect_endpoints"), reasons)
    action = raw.get("expect_action")
    if action is not None and not isinstance(action, str):
        reasons.append("expect_action must be a string (domain.action)")
    if reasons:
        return None, reasons
    recipe = dict(raw)
    recipe.setdefault("kind", "code")
    recipe.setdefault("status", "active")
    recipe.setdefault("max_age_days", max_age)
    return recipe, []


def _check_declaration(params, reasons):
    """The value-assert declaration (corrections #8/#9): params must CARRY
    the declaration key — null files the action UNDECLARED in the open; an
    object must cite its reference, its validity range, and its review
    source (independent = correctness check; self-referenced = drift
    coverage only)."""
    if "declaration" not in params:
        reasons.append("value-assert params must carry a declaration "
                       "(an object, or null to file the action UNDECLARED)")
        return
    decl = params.get("declaration")
    if decl is None:
        return
    if not isinstance(decl, dict):
        reasons.append("declaration must be an object or null")
        return
    if not isinstance(decl.get("reference"), str) or not decl.get("reference"):
        reasons.append("declaration.reference is required (the cited source)")
    vr = decl.get("validity_range")
    if not (isinstance(vr, str) and vr) and not (isinstance(vr, list) and len(vr) == 2):
        reasons.append("declaration.validity_range is required (text or [lo, hi])")
    if decl.get("review_source") not in ("independent", "self-referenced"):
        reasons.append("declaration.review_source must be 'independent' or 'self-referenced'")


def _check_case_source(raw, reasons):
    """Case provenance (ruling #11): a generated case set's cases are tagged
    per case — OBSERVED (from route shape + fixture data of record;
    reachable, counts toward coverage) vs EXTRAPOLATED (enumerated from
    imagination; speculative coverage only). The counts stay separate in
    every report and are never summed."""
    cs = raw.get("case_source")
    if cs is not None and cs not in ("observed", "extrapolated"):
        reasons.append("case_source must be 'observed' or 'extrapolated'")


def check_authorship(recipe, fixer_id):
    """Extrinsic authorship gate: the recipe's author and reviewer must both
    differ from the seat that fixed the ticket. Returns refusal reasons
    (empty when the recipe may grade this ticket)."""
    if not fixer_id:
        return []
    reasons = []
    if recipe.get("author") == fixer_id:
        reasons.append("fixer-authored: author %r fixed this ticket" % fixer_id)
    if recipe.get("reviewer") == fixer_id:
        reasons.append("fixer-reviewed: reviewer %r fixed this ticket" % fixer_id)
    return reasons


def _override_for(raw):
    """(override_reason, override_by) when the raw recipe carries an override."""
    reason = raw.get("override_reason")
    if isinstance(reason, str) and reason.strip():
        return reason.strip(), raw.get("override_by")
    return None, None


def load_registry(recipes_dir=None, fixer_of=None, today=None, expect_sha=None):
    """Load walker/recipes/*.json. Returns (registry, refusals, overrides):
      registry  — {ticket_id: recipe} for recipes that may be dispatched;
      refusals  — [(source_name, ticket_id_or_None, [reasons])] for every file
                  that did not load, in filename order;
      overrides — [(ticket_id, override_by, override_reason)] for recipes that
                  loaded ONLY because Dutch overrode a refusal (reported,
                  never silent).
    fixer_of, when given, maps a ticket id to its fixer's id so authorship is
    enforced at load time as well as at dispatch."""
    recipes_dir = recipes_dir or default_recipes_dir()
    registry, refusals, overrides = {}, [], []
    if not os.path.isdir(recipes_dir):
        return registry, [("(registry)", None,
                           ["registry directory missing: %s" % recipes_dir])], overrides
    for name in sorted(os.listdir(recipes_dir)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(recipes_dir, name)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = json.load(fh)
        except Exception as exc:
            refusals.append((name, None, ["unreadable recipe file: %s" % exc]))
            continue
        rid = raw.get("id") if isinstance(raw, dict) else None
        recipe, reasons = validate_recipe(raw, today=today, expect_sha=expect_sha)
        if recipe is not None and fixer_of is not None:
            auth = check_authorship(recipe, fixer_of(recipe["id"]))
            if auth:
                recipe, reasons = None, auth
        if recipe is None:
            override_reason, override_by = _override_for(raw)
            if override_reason and override_by in OVERRIDERS and rid:
                # Dutch's override loads the recipe despite the refusal; the
                # refusal reasons stay on the record via the overrides list.
                recipe = dict(raw)
                recipe.setdefault("kind", "code")
                recipe.setdefault("status", "active")
                recipe.setdefault("max_age_days", DEFAULT_MAX_AGE_DAYS)
                overrides.append((rid, override_by, override_reason))
                reasons = []
            else:
                if override_reason and override_by not in OVERRIDERS:
                    reasons = reasons + ["override by %r refused — override_reason "
                                         "is usable by Dutch only" % (override_by,)]
                refusals.append((name, rid, reasons))
                continue
        if recipe["id"] in registry:
            refusals.append((name, recipe["id"],
                             ["duplicate recipe id %s — first file wins" % recipe["id"]]))
            continue
        registry[recipe["id"]] = recipe
    return registry, refusals, overrides


def build_dispatch(handlers, recipes_dir=None, fixer_of=None, today=None, expect_sha=None):
    """Compose the Reverifier's dispatch set: {ticket_id: handler} for every
    code handler whose ticket is registered and not refused. A handler with
    no registry entry is NOT dispatched (the registry is the authority), and
    a registered recipe with no handler is reported in the refusals so the
    gap is visible. Returns (dispatch, registry, refusals, overrides)."""
    registry, refusals, overrides = load_registry(
        recipes_dir, fixer_of=fixer_of, today=today, expect_sha=expect_sha)
    dispatch = {}
    for tid, handler in handlers.items():
        recipe = registry.get(tid)
        if recipe is None:
            refusals.append(("(dispatch)", tid,
                             ["no registered recipe — handler not dispatched"]))
        elif recipe.get("kind") != "code":
            refusals.append(("(dispatch)", tid,
                             ["registered kind is %s, no code dispatch" % recipe.get("kind")]))
        elif recipe.get("handler") and recipe["handler"] != getattr(handler, "__name__", None):
            refusals.append(("(dispatch)", tid,
                             ["registry handler %r does not match the walker's %r"
                              % (recipe["handler"], getattr(handler, "__name__", None))]))
        else:
            dispatch[tid] = handler
    for tid in registry:
        if tid not in handlers and registry[tid].get("kind") == "code":
            refusals.append(("(dispatch)", tid,
                             ["registered recipe has no code handler in the walker"]))
    return dispatch, registry, refusals, overrides


def template_instances(registry):
    """The kind=template entries of a loaded registry, as
    {ticket_id: {"template": name, "params": {...}}} — the Reverifier runs
    these through its generic template runner (LC-06). Draft and refused
    entries never reach a loaded registry, so they never appear here."""
    return {tid: {"template": r.get("template"), "params": dict(r.get("params") or {}),
                  "case_source": r.get("case_source")}
            for tid, r in registry.items() if r.get("kind") == "template"}


def case_counts(registry):
    """Per-case provenance counts (ruling #11): observed and extrapolated
    counted SEPARATELY — the two are never summed into one coverage number."""
    counts = {"observed": 0, "extrapolated": 0}
    for rec in registry.values():
        cs = rec.get("case_source")
        if cs in counts:
            counts[cs] += 1
    return counts
