"""Deterministic control-name resolution for replayed tickets (mapper-vocab, item 5).

A tester wrote the control name from memory ("Share & Publish", "JSON", "Export"); the live page
may carry a renamed label ("Publish or share this content") or a nested menu item ("Export as JSON").
resolve() maps the ticket's name onto the LIVE labels with explicit, ordered, logged rules:

  1. exact   - same normalised label                                   (alphanumerics only, case-folded)
  2. alias   - the in-repo ALIASES table names this exact live label   (a known rename, never a guess)
  3. token   - every content token of the ticket name is a token of exactly one live label
               ("JSON" -> "Export as JSON")

A rule that finds exactly ONE candidate resolves; a rule that finds 2+ is AMBIGUOUS and stops the search
(never falls through to a looser rule); no rule finding anything is ABSENT. Only a resolved, unique
control may be acted on - ambiguity and absence are NEEDS_HUMAN for the step. The result dict is
written into the step record (ticket name -> live label, rule, candidates), so an alias hit is visible
and auditable; it can never turn into a VERIFIED by itself - the control still has to be found,
unique, and clicked, and the ticket's `expected` still has to be machine-checked.
"""
import re

EXACT, ALIAS, TOKEN, AMBIGUOUS, ABSENT = "exact", "alias", "token", "ambiguous", "absent"

# known renames (ticket's remembered name -> the live label(s) it became). Keys and values are
# normalised with norm(); add an entry only for a rename SEEN on the live site.
ALIASES = {
    "share & publish": ("publish or share this content",),
    "share and publish": ("publish or share this content",),
    "share/publish": ("publish or share this content",),
}

_STOP = {"the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "with", "button", "tab", "menu", "link", "control"}


def norm(x):
    return re.sub(r"[^a-z0-9]+", "", (x or "").lower())


def _norm_key(x):
    return re.sub(r"\s+", " ", (x or "").lower().replace("&", " & ")).strip()


def tokens(x):
    t = [w for w in re.findall(r"[a-z0-9]+", (x or "").lower()) if w not in _STOP]
    return set(t)


def resolve(name, labels):
    """name (from the ticket), labels (live names) -> {ticket_name, status, label, rule, candidates}.
    status in exact|alias|token|ambiguous|absent; `label` is set only when status resolved."""
    # duplicates are kept ON PURPOSE: two live controls with the same name are two candidates (ambiguous)
    live = [l for l in (labels or []) if l]
    rec = {"ticket_name": name, "status": ABSENT, "label": None, "rule": None, "candidates": []}
    n = norm(name)
    if not n or not live:
        return rec

    def settle(status, rule, cands):
        rec["candidates"] = cands[:6]
        rec["rule"] = rule
        rec["status"] = status if len(cands) == 1 else AMBIGUOUS
        if len(cands) == 1:
            rec["label"] = cands[0]
        return rec

    hits = [l for l in live if norm(l) == n]
    if hits:
        return settle(EXACT, "exact:normalised-equal", hits)
    al = ALIASES.get(_norm_key(name)) or ()
    if al:
        targets = {norm(a) for a in al}
        hits = [l for l in live if norm(l) in targets]
        if hits:
            return settle(ALIAS, "alias:%s" % _norm_key(name), hits)
    tk = tokens(name)
    if tk:
        hits = [l for l in live if tk <= tokens(l)]
        if hits:
            return settle(TOKEN, "token:all-ticket-tokens-in-label", hits)
    return rec


def describe(res):
    """One-line human text for a step record / NEEDS_HUMAN note."""
    if res["status"] in (EXACT, ALIAS, TOKEN):
        return "%r -> %r (%s)" % (res["ticket_name"], res["label"], res["rule"])
    if res["status"] == AMBIGUOUS:
        return "%r is ambiguous: %d live controls match (%s) via %s - not clicked" % (
            res["ticket_name"], len(res["candidates"]), "; ".join(repr(c) for c in res["candidates"][:4]), res["rule"])
    return "%r matches no live control" % res["ticket_name"]
