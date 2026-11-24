"""MST-W0-04 route normalization + pattern matching + false-positive-safe classes.

Both sides are normalized before matching (Dutch, Nov 16):
  * observed paths are already templated by netledger (:n :uuid :hex :id :long)
  * express: ':id' / ':id(\\d+)' -> ':p', ':id?' -> ':p?', '*' -> '*', '{param}' -> ':p', '${x}' -> ':p'
  * Next.js app dir: '[id]' -> ':p', '[...slug]' -> '*', '[[...slug]]' -> '**', route groups '(x)' and
    parallel slots '@x' dropped, intercepting markers '(.)' '(..)' '(...)' stripped
  * routers mounted at runtime with an unknown prefix match by suffix (mount == 'runtime')
Severity comes from the live response, never from the path match alone:
  matched_ok        declared route, every recorded response 2xx/3xx
  matched_failing   declared route, a recorded non-2xx (404/405/5xx/network fail)
  real_missing      no declared route AND a non-2xx response  (the only defect class)
  unmatched_but_ok  no declared route but 2xx (dynamic/runtime route) -> low-priority noise, never a bug
  unused_route      declared, never observed
"""
import re

DYN = (":n", ":uuid", ":hex", ":id", ":long")
CLASSES = ("real_missing", "matched_failing", "unmatched_but_ok", "matched_ok", "unused_route")
_GROUP = re.compile(r"^\([^.)][^)]*\)$")           # (marketing)
_INTERCEPT = re.compile(r"^(\(\.{1,3}\))+")         # (.)x (..)x (...)x (..)(..)x
_CATCH_ALL_ONLY = {"/*", "/**", "/api/*", "/api/**"}


def _segs(path):
    return [s for s in (path or "").split("/") if s != ""]


def express_pattern(raw):
    raw = re.sub(r"\$\{[^}]*\}", ":p", raw or "")
    out = []
    for s in [x for x in raw.split("/") if x]:
        if s.startswith(":"):
            out.append(":p?" if s.endswith("?") else ("**" if s.endswith("*") else ":p"))
        elif "*" in s:
            out.append("*")
        elif s.startswith("{") and s.endswith("}"):
            out.append(":p")
        else:
            out.append(s.lower())
    return "/" + "/".join(out)


def next_pattern(rel):
    out = []
    for s in _segs(rel):
        if s.startswith("@") or _GROUP.match(s):
            continue
        s = _INTERCEPT.sub("", s)
        if not s:
            continue
        if s.startswith("[[...") and s.endswith("]]"):
            out.append("**")
        elif s.startswith("[...") and s.endswith("]"):
            out.append("*")
        elif s.startswith("[") and s.endswith("]"):
            out.append(":p")
        else:
            out.append(s.lower())
    return "/" + "/".join(out)


def _match(pat, obs):
    if not pat:
        return not obs
    p = pat[0]
    if p == "**":
        return any(_match(pat[1:], obs[k:]) for k in range(len(obs) + 1))
    if p == "*":
        return any(_match(pat[1:], obs[k:]) for k in range(1, len(obs) + 1))
    if p == ":p?":
        return _match(pat[1:], obs) or (bool(obs) and _match(pat[1:], obs[1:]))
    if not obs:
        return False
    o = obs[0]
    if p == ":p":
        return _match(pat[1:], obs[1:])
    if o in DYN or o.startswith(":"):
        return False  # a templated id never equals a literal segment
    return p == o.lower() and _match(pat[1:], obs[1:])


def pattern_match(pattern, path, runtime=False):
    pat, obs = _segs(pattern), _segs(path)
    if _match(pat, obs):
        return True
    if runtime:
        # a runtime-mounted router's prefix is unknown, so match by suffix -- but only when the
        # route has a literal segment: a bare '/:id' would otherwise claim every path and hide
        # a real 404 behind somebody else's route.
        if not any(not s.startswith(":") and s not in ("*", "**") for s in pat):
            return False
        return any(_match(pat, obs[k:]) for k in range(1, len(obs)))
    return False


def _specificity(route):
    segs = _segs(route["pattern"])
    lit = sum(1 for s in segs if not s.startswith(":") and s not in ("*", "**"))
    return (route.get("mount") != "runtime", lit, len(segs))


class RouteIndex:
    def __init__(self, routes):
        self.routes = [r for r in routes if r["pattern"] not in _CATCH_ALL_ONLY]
        self.excluded = [r for r in routes if r["pattern"] in _CATCH_ALL_ONLY]

    def find(self, method, path, document=False):
        """Best route for (method, path) or None. method ALL matches any; GET matches HEAD."""
        best, best_any_method = None, None
        for r in self.routes:
            if document and r["source"] not in ("next-page", "express"):
                continue
            if not pattern_match(r["pattern"], path, runtime=r.get("mount") == "runtime"):
                continue
            ok_method = r["method"] in (method, "ALL") or (method == "HEAD" and r["method"] == "GET")
            if ok_method and (best is None or _specificity(r) > _specificity(best)):
                best = r
            if best_any_method is None or _specificity(r) > _specificity(best_any_method):
                best_any_method = r
        return best, best_any_method


def status_ok(st):
    """2xx/3xx are OK; an in-flight stream (pending) or a client-side cancel (aborted:
    Next.js prefetch / navigation) is not evidence of a failure."""
    if st in ("pending", "aborted") or (isinstance(st, str) and "ERR_ABORTED" in st):
        return True
    try:
        st = int(st)
    except (TypeError, ValueError):
        return False
    return 200 <= st < 400


def classify(matched, statuses):
    """statuses: iterable of recorded statuses (int or str; None/'failed' = network failure)."""
    ok = all(status_ok(s) for s in statuses) if statuses else True
    if matched:
        return "matched_ok" if ok else "matched_failing"
    return "unmatched_but_ok" if ok else "real_missing"


def load_registry(path):
    """actions-<sha>.json(.gz) -> dict."""
    import gzip, json
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as f:
        return json.load(f)
