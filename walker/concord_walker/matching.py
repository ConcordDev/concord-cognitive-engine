"""Fuzzy element-name matching (WALK-03).

Resolve a name taken from a ticket's prose — quoted or not — to the live
AX / control names the walker actually sees. Pure functions over strings:
token overlap (Jaccard over normalised tokens) with a containment bonus
and a verb-hint bonus. No browser, no page JS.

The bar is deliberately asymmetric: a match lets the walker EXERCISE the
named element (click its tab, scope its contrast view); it never by
itself produces a verdict.
"""
import re

STOP = {"the", "a", "an", "of", "to", "in", "on", "for", "and", "or",
        "with", "without", "when", "while", "is", "are", "does", "not", "no"}
VERBS = {"open", "opens", "close", "closes", "create", "creates", "new",
         "edit", "edits", "delete", "deletes", "add", "adds", "save",
         "saves", "show", "shows", "hide", "hides", "schedule",
         "schedules", "start", "starts", "view", "views"}


def name_tokens(s):
    """Normalised content tokens of a name: lowercase alnum words, stopwords
    dropped. Single-character tokens are dropped unless nothing else remains."""
    toks = [t for t in re.findall(r"[a-z0-9]+", (s or "").lower()) if t not in STOP]
    long = {t for t in toks if len(t) > 1}
    return long or set(toks)


def _score(name, cand):
    a, b = name_tokens(name), name_tokens(cand)
    if not a or not b:
        return 0.0
    inter = a & b
    if not inter:
        return 0.0
    j = len(inter) / len(a | b)
    contain = len(inter) / min(len(a), len(b))
    score = max(j, 0.85 * contain) if contain >= 1.0 else j
    va, vb = a & VERBS, b & VERBS
    if va and va == vb:
        score += 0.05
    return min(score, 1.0)


def fuzzy_match(name, candidates, min_score=0.45):
    """Best candidate for `name`, or None when nothing clears the bar."""
    best, best_s = None, 0.0
    for c in candidates or []:
        if not c:
            continue
        s = _score(name, c)
        if s > best_s:
            best, best_s = c, s
    return best if best_s >= min_score else None


def match_any(names, candidates, min_score=0.45):
    """First ticket name (in order) that resolves to a live candidate."""
    for n in names or []:
        hit = fuzzy_match(n, candidates, min_score)
        if hit:
            return hit
    return None
