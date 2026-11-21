"""ULW v3 (GB-1576 W5a): core-verb truth — the per-lens core-verb spec
layer and its verdict logic.

The W1 redesign study's recurring shape (GB-1576's founding critique):
in nearly every redesigned lens the defining feature was hollow under a
working-looking UI — Board's sharing was a name nobody could use, Graph
let you write to other people's DTUs, Tasks lived in two stores that
never met. The walker's checks measured surfaces; nobody measured
whether the lens's ONE defining verb actually works end to end, persists,
and is visible to exactly the accounts it should be.

This module is the pure layer of that measurement:

  SPEC     walker/specs/core_verbs.json — per lens: the defining verb,
           the lens action that performs it (domain + name, or null when
           unpinned), a minimal args template, the expected persisted
           result, who should / shouldn't see it (visibility), a cleanup
           action where the domain exposes one, human repro steps, and a
           status: confirmed (grounded in the W1 study record) or draft
           (derived mechanically from the registerLensAction registry
           scan; unreviewed by construction).
  VERDICT  CORE_VERB_PASS / CORE_VERB_FAIL / CORE_VERB_UNSPECIFIED from
           the driving leg's observations. The discipline: FAIL means the
           verb was genuinely exercised and the truth failed (the call
           broke, the result did not persist, the visibility was wrong).
           Anything the probe itself could not establish — no spec, no
           pinned action, a validation refusal to the probe's minimal
           args, an unavailable read-back surface — is UNSPECIFIED with
           the reason named, never a PASS and never a FAIL.

The driving leg lives in checks.LensWalk.core_verb_phase, beside the
trust probes; it drives the verb through POST /api/lens/run as the
shard's write account, reads back as writer and observer, and cleans up
via the write account. Money-class actions are never driven.
"""
import json
import os
import re

VERDICTS = ("CORE_VERB_PASS", "CORE_VERB_FAIL", "CORE_VERB_UNSPECIFIED")
VISIBILITIES = ("private", "shared", "public")
SPEC_STATUSES = ("draft", "confirmed")
WRITE_METHODS = ("POST", "PUT", "PATCH")

# Money-class path/action vocabulary: a verb whose performance moves
# money is never driven by the walker (the C24 / privacy_checks deny-list
# discipline). It verdicts UNSPECIFIED with this reason named.
MONEY_RX = re.compile(
    r"buy|purchase|checkout|transfer|escrow|withdraw|deposit|tender|"
    r"refund|billing|payment|pay[-_]|charge|redeem|stake|wager", re.I)

SPEC_PATH = os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "specs", "core_verbs.json")

_doc_cache = None


def load_spec_doc(path=None):
    """The parsed core_verbs.json document (cached per process)."""
    global _doc_cache
    if path is None and _doc_cache is not None:
        return _doc_cache
    try:
        with open(path or SPEC_PATH) as f:
            doc = json.load(f)
    except Exception:
        doc = None
    if path is None:
        _doc_cache = doc
    return doc


def spec_for(doc, slug):
    if not isinstance(doc, dict):
        return None
    return (doc.get("lenses") or {}).get(slug)


def validate_spec(slug, spec):
    """Schema problems with one spec entry (empty list = valid)."""
    out = []
    if not isinstance(spec, dict):
        return ["%s: spec is not an object" % slug]
    if not spec.get("verb"):
        out.append("%s: missing verb" % slug)
    if spec.get("visibility") not in VISIBILITIES:
        out.append("%s: visibility %r not in %s" % (slug, spec.get("visibility"), VISIBILITIES))
    if spec.get("status") not in SPEC_STATUSES:
        out.append("%s: status %r not in %s" % (slug, spec.get("status"), SPEC_STATUSES))
    steps = spec.get("steps")
    if not isinstance(steps, list) or not steps:
        out.append("%s: steps missing or empty" % slug)
    act = spec.get("action")
    if act is not None:
        if not isinstance(act, dict) or not act.get("domain") or not act.get("name"):
            out.append("%s: action must be null or {domain, name}" % slug)
    for key in ("cleanup_action",):
        ca = spec.get(key)
        if ca is not None and (not isinstance(ca, dict) or not ca.get("domain") or not ca.get("name")):
            out.append("%s: %s must be null or {domain, name}" % (slug, key))
    if spec.get("args") is not None and not isinstance(spec.get("args"), dict):
        out.append("%s: args must be null or an object" % slug)
    return out


def validate_doc(doc, slugs=None):
    """Schema problems with the whole document (empty list = valid).
    When slugs (the inventory spine) are given, coverage must be exact:
    every lens present, no extras."""
    out = []
    if not isinstance(doc, dict) or not isinstance(doc.get("lenses"), dict):
        return ["document has no lenses object"]
    lenses = doc["lenses"]
    for slug, spec in lenses.items():
        out += validate_spec(slug, spec)
    if slugs is not None:
        want, have = set(slugs), set(lenses)
        for s in sorted(want - have):
            out.append("missing lens spec: %s" % s)
        for s in sorted(have - want):
            out.append("spec for unknown lens: %s" % s)
    return out


def is_money_action(spec):
    act = (spec or {}).get("action") or {}
    return bool(MONEY_RX.search(act.get("name") or ""))


def build_args(spec, label):
    """The args object for the drive: the spec's template with {label}
    substituted, or the default title/name template. Returns a dict."""
    tpl = (spec or {}).get("args")
    if tpl is None:
        tpl = {"title": "{label}", "name": "{label}"}
    out = {}
    for k, v in tpl.items():
        out[k] = v.replace("{label}", label) if isinstance(v, str) else v
    return out


def verb_body(spec, label):
    """The POST /api/lens/run body performing the spec's verb."""
    act = spec["action"]
    return {"domain": act["domain"], "action": act["name"],
            "args": build_args(spec, label)}


def cleanup_body(spec, object_id):
    """The POST /api/lens/run body deleting the created object via the
    spec's cleanup action, or None when none is pinned."""
    ca = (spec or {}).get("cleanup_action")
    if not ca or object_id is None:
        return None
    return {"domain": ca["domain"], "action": ca["name"],
            "args": {"id": object_id}}


def extract_object_id(body):
    """An object id from a lens/run response body, when one is plainly
    there: a scalar id/_id/uuid on the body or its data/result object."""
    if not isinstance(body, dict):
        return None
    for holder in (body, body.get("data"), body.get("result"), body.get("item")):
        if isinstance(holder, dict):
            for key in ("id", "_id", "uuid"):
                v = holder.get(key)
                if isinstance(v, (str, int)) and v not in ("", None):
                    return v
    return None


def refused_body(body):
    return isinstance(body, dict) and (body.get("ok") is False or "error" in body)


_ID_TOKEN = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    r"|[0-9a-fA-F]{16,}|\d{4,}|[A-Za-z0-9_.\-]{24,}")


def error_reason(body):
    """A scrubbed one-line reason from a lens/run response body (GB-1579):
    the error text — the error key's string, an error object's message /
    code, or the message key of a refused body — with id-shaped tokens and
    long values replaced, whitespace collapsed, capped at 120 chars. The
    stored block keeps the reason's meaning only: no values, no ids. None
    when the body carries no error text."""
    if not isinstance(body, dict):
        return None
    raw = None
    e = body.get("error")
    if isinstance(e, str) and e.strip():
        raw = e
    elif isinstance(e, dict):
        for k in ("message", "code", "name"):
            if isinstance(e.get(k), str) and e[k].strip():
                raw = e[k]
                break
    if raw is None and isinstance(body.get("message"), str) and body["message"].strip() \
            and (body.get("ok") is False or "error" in body):
        raw = body["message"]
    if raw is None:
        return None
    text = _ID_TOKEN.sub("…", " ".join(str(raw).split()))
    return text[:120] or None


def validation_refusal(status, body):
    """A 4xx refusal whose body reads as argument validation (missing /
    invalid / required fields) — the probe's minimal args were not
    enough, which judges the probe, not the verb."""
    if status is None or not (400 <= status < 500) or status in (401, 403, 404):
        return False
    if not isinstance(body, dict):
        return False
    text = json.dumps(body).lower()
    return any(w in text for w in ("required", "missing", "invalid", "must be",
                                   "expected", "validation", "bad request"))


def classify_drive(status, body):
    """What the verb call itself established:
    performed   the call succeeded (2xx, non-refused) — judge the result.
    failed      the verb is broken for its own user (5xx, or 401/403 on
                the writer's own verb) — a FAIL-grade observation.
    inconclusive the drive could not judge (validation refusal to the
                probe's args, 404 on the action route, transport error).
    """
    if status is None:
        return "inconclusive"
    if 200 <= status < 300 and not refused_body(body):
        return "performed"
    if status in (401, 403) or status >= 500:
        return "failed"
    if validation_refusal(status, body):
        return "inconclusive"
    if status == 404:
        return "inconclusive"
    if refused_body(body):
        return "failed"
    return "inconclusive"


def verdict(spec, *, drive, persisted, observer_sees):
    """The core-verb verdict from the leg's observations.
    drive: classify_drive's word. persisted / observer_sees: True, False,
    or None (the read-back could not establish it)."""
    if spec is None:
        return "CORE_VERB_UNSPECIFIED", "no core-verb spec for this lens"
    if not spec.get("action"):
        return ("CORE_VERB_UNSPECIFIED",
                "spec carries no pinned action — the verb is unpinned (see the spec's note)")
    if drive == "inconclusive":
        return ("CORE_VERB_UNSPECIFIED",
                "the drive could not judge the verb (validation refusal, missing route, or transport error)")
    if drive == "failed":
        return ("CORE_VERB_FAIL",
                "the verb call itself failed for the writer (refused or server error)")
    # drive == performed
    if persisted is False:
        return ("CORE_VERB_FAIL",
                "the verb reported success but the result was not there on a fresh read-back (reload)")
    if persisted is None:
        return ("CORE_VERB_UNSPECIFIED",
                "the verb ran but no read-back surface could establish persistence")
    should_see = spec.get("visibility") in ("shared", "public")
    if observer_sees is None:
        return ("CORE_VERB_UNSPECIFIED",
                "persistence held, but the observer read-back could not establish visibility")
    if bool(observer_sees) != should_see:
        return ("CORE_VERB_FAIL",
                "visibility wrong: spec says %s (observer should %ssee the result) but the observer %s" % (
                    spec.get("visibility"), "" if should_see else "not ",
                    "saw it" if observer_sees else "could not see it"))
    return "CORE_VERB_PASS", "verb performed, persisted on read-back, visibility per spec"


def repro_steps(spec, verdict_word, reason):
    """The human repro for a verdict: the spec's own steps, closed with
    the observed outcome."""
    steps = list((spec or {}).get("steps") or [])
    steps.append("Observed: %s — %s" % (verdict_word, reason))
    return steps


def core_verb_block(spec, verdict_word, reason, *, drive=None, persisted=None,
                    observer_sees=None, cleanup=None, steps=None,
                    http_status=None, error=None):
    """The per-lens core-verb block written into the walk result, beside
    the isolation and trust blocks. Carries the verdict + repro, the
    spec's identity (status / verb / action / visibility), the step
    outcomes, and the cleanup state. GB-1579: every block also carries
    the drive's http_status and a scrubbed error reason (error_reason —
    no values, no ids), so an UNSPECIFIED verdict is diagnosable from
    the record alone. No bodies, no ids of real objects: the created
    object was the walk's own labelled fixture."""
    act = (spec or {}).get("action") or {}
    return {
        "verdict": verdict_word,
        "reason": reason,
        "spec_status": (spec or {}).get("status"),
        "verb": (spec or {}).get("verb"),
        "action": ("%s.%s" % (act["domain"], act["name"])) if act else None,
        "visibility": (spec or {}).get("visibility"),
        "drive": drive,
        "http_status": http_status,
        "error": error,
        "persisted": persisted,
        "observer_sees": observer_sees,
        "cleanup": cleanup,
        "repro": steps or repro_steps(spec, verdict_word, reason),
    }


def plan(spec, *, has_observer):
    """Should the drive run, and if not, why not — a leg that cannot run
    still emits its UNSPECIFIED block with the reason named."""
    if spec is None:
        return {"run": False, "reason": "no core-verb spec for this lens"}
    if not spec.get("action"):
        return {"run": False, "reason": "spec carries no pinned action — the verb is unpinned"}
    if is_money_action(spec):
        return {"run": False, "reason": "the verb action is money-class; the walker never drives money"}
    if not has_observer:
        return {"run": False, "reason": "no observer session for the visibility read-back"}
    return {"run": True, "reason": "spec pinned, writer + observer available"}
