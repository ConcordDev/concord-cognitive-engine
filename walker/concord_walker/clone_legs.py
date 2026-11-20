"""Money-row verification legs on the SB-38 DB clone (ULW C42).

The 27 payments/money rows are excluded live — payments untouched, money
OFF, and safety.write_step_decision refuses payment-adjacent controls
unconditionally. The upgrade plan (§4) puts their purchase legs on the
SB-38 database clone, never prod. This module is that machinery:

  - is_money_row mirrors the payments_money category family from
    analysis/human_row_categories.py (money wins ties there; here it only
    selects rows for clone routing);
  - CloneGate issues a ClonePermit ONLY for the configured clone target:
    the run's base URL must equal cfg.clone.base_url exactly, must NOT
    equal the production cfg.base_url, and the target's /health payload
    must carry every configured clone marker. Any missing or ambiguous
    field refuses — fail closed, no permit object exists otherwise;
  - clone_step_decision is the ONLY path that can allow a purchase-family
    step, and only while holding a permit. Hard money-movement verbs
    (transfer, withdraw, payout, mint, stake, tip, gift, donate) stay
    denied even on the clone — they are not purchase legs. Every other
    step delegates to safety.write_step_decision unchanged;
  - clone_write_ctx builds the repro write context for a money row under
    a permit; fixture labels carry a -clone- marker so clone fixtures can
    never be mistaken for live-lane fixtures.

Machinery only: the legs fire clone-side in walk 2, at the walker desk.
Nothing in this module contacts a server.
"""

import re

from .safety import write_step_decision

# Mirrors analysis/human_row_categories.py "payments_money" — keep the two
# in step; the audit counts (27 rows: 0 auto / 8 partial / 19 human) were
# produced with this family.
MONEY_RE = re.compile(
    r"(?i)\b(stripe|checkout|purchase|buy(ing)?|payout|withdraw|wallet|sparks|"
    r"concord coin|royalt|refund|billing|subscription|payments?|pay)\b|\bcharged?\b")

# The purchase family a permit unlocks: buying flows only.
PURCHASE_RE = re.compile(
    r"(?i)\b(stripe|checkout|purchase|buy(ing)?|wallet|sparks|concord coin|"
    r"royalt|refund|billing|subscription|subscribe|payments?|pay)\b|\bcharged?\b")

# Never purchase legs — denied even under a permit, even on the clone.
HARD_MONEY_RE = re.compile(
    r"(?i)\b(transfer|withdraw|payout|mint|stake|tip|gift|donate)\b")


class CloneRefused(Exception):
    """The clone gate refused to issue a permit for this target."""


class ClonePermit:
    """Capability object: only CloneGate.permit() constructs one. Holding
    it is the proof the target passed the gate at issue time."""

    def __init__(self, base_url, marker):
        self.base_url = base_url
        self.marker = dict(marker or {})

    def __repr__(self):
        return "<ClonePermit %s>" % self.base_url


def _norm(url):
    return str(url or "").rstrip("/")


class CloneGate:
    """Issues ClonePermits for the configured SB-38 clone target only."""

    def __init__(self, cfg):
        clone = (cfg or {}).get("clone") or {}
        self.clone_url = _norm(clone.get("base_url"))
        self.marker = dict(clone.get("health_marker") or {})
        self.prod_url = _norm((cfg or {}).get("base_url"))

    def permit(self, base_url, health):
        """A ClonePermit for (base_url, health) or CloneRefused. Fail
        closed on every ambiguity: unconfigured gate, prod target, URL
        mismatch, non-dict health, or any marker key absent/different."""
        if not self.clone_url or not self.marker:
            raise CloneRefused("clone gate is not configured (cfg.clone.base_url + health_marker required)")
        url = _norm(base_url)
        if not url:
            raise CloneRefused("no target base_url given")
        if url == self.prod_url:
            raise CloneRefused("target %s is the PRODUCTION base_url — clone legs never run on prod" % url)
        if url != self.clone_url:
            raise CloneRefused("target %s is not the configured clone %s" % (url, self.clone_url))
        if not isinstance(health, dict):
            raise CloneRefused("target /health did not return an object — cannot prove clone identity")
        for k, v in self.marker.items():
            if health.get(k) != v:
                raise CloneRefused("clone marker mismatch: /health[%r] is %r, expected %r" % (k, health.get(k), v))
        return ClonePermit(url, self.marker)


def is_money_row(row):
    """True iff the row classifies payments_money under the audit's
    category family (title + actual + expected + repro text)."""
    text = " ".join(str(row.get(k) or "") for k in ("title", "actual", "expected", "repro", "id"))
    return bool(MONEY_RE.search(text))


def clone_step_decision(name, permit, *, admin=False, fixture_labels=()):
    """(allowed, reason, kind) for a step inside a clone leg. The permit is
    the whole authority: without one, purchase steps fall back to the base
    rule (which refuses them); with one, purchase-family steps are allowed
    as kind 'payment' — except the hard money-movement verbs, which stay
    denied everywhere. All other steps delegate to safety unchanged."""
    n = name or ""
    if permit is None:
        return write_step_decision(n, admin=admin, write_skip=False,
                                   allow_write=True, fixture_labels=fixture_labels)
    if admin:
        return False, "admin lens stays look-only (no clone leg)", "write"
    if HARD_MONEY_RE.search(n):
        return False, ("control %r is a money-movement action — denied even on the clone; "
                       "clone legs cover purchase flows only" % n), "payment"
    if PURCHASE_RE.search(n):
        return True, None, "payment"
    return write_step_decision(n, admin=admin, write_skip=False,
                               allow_write=True, fixture_labels=fixture_labels)


def clone_write_ctx(cfg, rec, t, permit):
    """repro.run_repro write context for a money row under a permit.
    Labels carry the -clone- marker; fixtures admitted are this lens's
    live clone-labelled fixtures only."""
    if permit is None:
        raise CloneRefused("clone_write_ctx requires a ClonePermit")
    lens, tid = t["lens"], str(t.get("id") or "x")
    prefix = cfg.get("fixture_prefix") or "qa-walker"
    stem = "%s-%s-clone-%s-%s" % (prefix, lens, str(rec.rid)[-6:],
                                  re.sub(r"[^a-z0-9]+", "", tid.lower())[-12:])

    def live_labels():
        return [f["label"] for f in (rec.fixtures or {}).values()
                if f.get("lens") == lens and f.get("state") not in ("deleted", "never_created")
                and "-clone-" in f.get("label", "")]

    return {"allow_write": True, "admin": False, "write_skip": False, "clone": True,
            "clone_permit": permit, "account": "t1", "label_base": stem,
            "fixtures": live_labels,
            "on_fixture": lambda label, state, note="": rec.fixture(label, lens, state, note)}


def plan_clone_legs(rows):
    """The leg plan: ids of the money rows in `rows`, in order. What a
    --clone-legs run would exercise once its gate passes."""
    return [str(r.get("id")) for r in rows if is_money_row(r)]
