"""Network-backed expected-result checks (precapture item 4). Pure over response rows the driver recorded:
   {method, path (templated), raw_path, status, shape, ids:[hash], leaf:[hash], t}
Only SHAPES (keys/types) and one-way HASHES of leaf values are kept - response values are never stored or printed.
Fail closed: anything the rows cannot answer is `unverified` (a `pending_capture` reason when the missing piece is an
endpoint/control name only the capture walk can supply). Composes with wiring.py (#2382): when a per-lens wiring
dict is supplied its `flows` name the list/read endpoint; absent, the check infers it from the traffic itself."""
import hashlib, re
from . import wiring as W

WRITE = ("POST", "PUT", "PATCH")
_ID_KEY = re.compile(r"(?i)^(?:id|_id|uuid|[a-z]+_?id)$")
_LENS_RUN = "/api/lens/run"
_TELEMETRY = re.compile(r"(?i)/(?:telemetry|analytics|metrics|vitals|beacon|events/track)\b")


def h(v):
    return hashlib.sha1(str(v).encode()).hexdigest()[:10]


def shape_of(obj):
    return W.shape(obj)


def leaf_hashes(obj, limit=400, _out=None, _d=0):
    out = _out if _out is not None else set()
    if len(out) >= limit or _d > 6:
        return out
    if isinstance(obj, dict):
        for v in list(obj.values())[:60]:
            leaf_hashes(v, limit, out, _d + 1)
    elif isinstance(obj, list):
        for v in obj[:60]:
            leaf_hashes(v, limit, out, _d + 1)
    elif isinstance(obj, (str, int)) and not isinstance(obj, bool) and len(str(obj)) <= 80:
        out.add(h(obj))
    return out


def ids_of(obj, _d=0, _out=None):
    out = _out if _out is not None else set()
    if _d > 3:
        return out
    if isinstance(obj, dict):
        for k, v in obj.items():
            if _ID_KEY.match(str(k)) and isinstance(v, (str, int)) and not isinstance(v, bool):
                out.add(h(v))
            elif isinstance(v, (dict, list)):
                ids_of(v, _d + 1, out)
    elif isinstance(obj, list):
        for v in obj[:5]:
            ids_of(v, _d + 1, out)
    return out


def string_values(_):   # kept for API compat: request VALUES are never stored
    return None


def status_class(code):
    return "%dxx" % (code // 100) if isinstance(code, int) else None


# ------------------------------------------------------------------ checks
def _rows(ev):
    out = []
    for w in (ev or {}).get("obs") or []:
        out += [r for r in (w.get("net") or []) if isinstance(r, dict) and not _TELEMETRY.search(r.get("path") or "")]
    return out


def status_class_check(ev, want, methods=WRITE):
    """Every matching request in the step windows has the wanted class ('2xx') or exact code."""
    rows = [r for r in _rows(ev) if r.get("method") in methods]
    if not (ev or {}).get("obs"):
        return "unverified", "no per-step network windows were captured"
    if not rows:
        return "unverified", "the steps fired no %s request (the control that sends it is not named - pending_capture)" % "/".join(methods)
    ok = lambda r: (status_class(r["status"]) == want) if isinstance(want, str) else r["status"] == want
    bad = [r for r in rows if not ok(r)]
    return ("fail", "%d request(s) not %s: %s" % (len(bad), want, ", ".join("%s %s -> %s" % (r["method"], r["path"], r["status"]) for r in bad[:3]))) if bad else ("pass", "%d request(s) all %s" % (len(rows), want))


def _is_type(v, t):
    return {"string": "string", "number": "number", "boolean": "boolean", "array": "array", "object": "object", "null": "null"}.get(t) == v if isinstance(v, str) else False


def shape_check(ev, keys, methods=WRITE):
    """The response of the matching request has the named keys (optionally key:type). Values are never compared."""
    rows = [r for r in _rows(ev) if r.get("method") in methods and 200 <= (r.get("status") or 0) < 300 and r.get("shape") is not None]
    if not rows:
        return "unverified", "no 2xx JSON response with a recorded shape (pending_capture if the request is not named)"
    r = rows[-1]
    sh = r["shape"] if isinstance(r["shape"], dict) else {}
    missing = []
    for k in keys:
        name, _, typ = k.partition(":")
        if name not in sh:
            missing.append(name)
        elif typ and not _shape_is(sh[name], typ):
            missing.append("%s(not %s)" % (name, typ))
    return ("fail", "response of %s %s lacks %s" % (r["method"], r["path"], missing)) if missing else ("pass", "response of %s %s has %s" % (r["method"], r["path"], list(keys)))


def _shape_is(s, typ):
    if typ == "array":
        return isinstance(s, list)
    if typ == "object":
        return isinstance(s, dict)
    return s == typ


def _coll(path):
    return W._split_resource(path)[0]


def readback_check(ev, own_values=None, wiring=None):
    """After a 2xx create whose response returns an id or echoes the walker's OWN unique value, a later GET on the same
    resource (the item, or the next list fetch) must contain it."""
    own = [v for v in (own_values if own_values is not None else (ev or {}).get("own_values") or []) if v]
    rows = _rows(ev)
    if not (ev or {}).get("obs"):
        return "unverified", "no per-step network windows were captured"
    for i, w in enumerate(rows):
        if w.get("method") not in WRITE or not (200 <= (w.get("status") or 0) < 300):
            continue
        if w["path"].startswith(_LENS_RUN):
            return "unverified", "PENDING_CAPTURE: the write is a lens-action call (/api/lens/run); the list macro to read it back comes from the capture walk's wiring flows"
        coll = _coll(w["path"])
        mine = {h(v) for v in own}
        wl = set(w.get("leaf") or [])
        ids = set(w.get("ids") or [])
        echoed = mine & wl
        if not ids and not echoed:
            return "unverified", "the create response returned neither an id nor the walker's own value - nothing to read back by"
        key = ids | echoed
        gets = [r for r in rows[i + 1:] if r.get("method") == "GET" and 200 <= (r.get("status") or 0) < 300 and _coll(r["path"]) == coll]
        hint = ""
        if wiring:
            fl = [f for f in wiring.get("flows") or [] if f.get("resource") == coll]
            hint = " (wiring flow kinds: %s)" % fl[0].get("kinds") if fl else ""
        if not gets:
            return "unverified", "PENDING_CAPTURE: no GET on %s fired after the create%s - needs the list/detail control to fetch it" % (coll, hint)
        hit = [r for r in gets if key & set(r.get("leaf") or [])]
        return (("pass", "created item read back by %d later GET(s) on %s" % (len(hit), coll)) if hit else
                ("fail", "create returned 2xx but %d later GET(s) on %s do not contain it" % (len(gets), coll)))
    return "unverified", "no 2xx create (POST/PUT/PATCH) in the step windows"


# ------------------------------------------------------------------ clause -> spec
_Q = "\"'‘’“”`"
_KEYS_IN = re.compile(r"[" + _Q + r"]([A-Za-z_][\w.]{0,30})(?::(string|number|boolean|array|object))?[" + _Q + r"]")
_RULES = [
    ("g_net_readback", re.compile(r"(?i)\b(?:created|new|added|saved)\s+(?:item|record|row|entry|value|\w+)\b[^.]{0,40}\b(?:read back|appears?\s+in\s+the\s+(?:list|table)|is\s+returned\s+(?:by|from)\s+(?:the\s+)?(?:list|get)|shows?\s+up\s+in\s+the\s+list|is\s+listed)\b|\bread[- ]back\b")),
    ("g_net_shape", re.compile(r"(?i)\b(?:response|payload|body)\s+(?:includes?|contains?|has|returns?)\b[^.]*" + r"[" + _Q + r"][A-Za-z_]")),
    ("g_net_status_class", re.compile(r"(?i)\b(?:(?:post|put|patch|request|save|create|submit)\w*\s+)?(?:returns?|responds?\s+with|succeeds?\s+with|gets?|is|with)\s+(?:an?\s+|http\s+)?(2\d\d|2xx|success(?:ful)?\s+status)\b|\b(?:request|save|create|submit)\w*\s+succeeds?\b|\bHTTP\s+(2\d\d)\b")),
]


def classify(f):
    t = (f or "").strip()
    for kind, rx in _RULES:
        m = rx.search(t)
        if not m:
            continue
        if re.search(r"(?i)\b(?:or|either|otherwise|else|unless|depending|if)\b", t):
            return None       # an alternative outcome rides along - never check just one branch
        sp = {"kind": kind, "text": t}
        if kind == "g_net_shape":
            sp["keys"] = ["%s%s" % (k, (":" + ty) if ty else "") for k, ty in _KEYS_IN.findall(t[m.start():])]
            if not sp["keys"]:
                return None
        elif kind == "g_net_status_class":
            code = re.search(r"\b(2\d\d)\b", t)
            sp["want"] = int(code.group(1)) if code else "2xx"
        return sp
    return None


KINDS = tuple(k for k, _ in _RULES)
EVIDENCE = {k: ("obs", "own_values") for k in KINDS}


def check(sp, snap):
    ev = (snap or {}).get("evidence") or {}
    k = sp["kind"]
    if k == "g_net_status_class":
        r = status_class_check(ev, sp["want"])
    elif k == "g_net_shape":
        r = shape_check(ev, sp["keys"])
    else:
        r = readback_check(ev, wiring=ev.get("wiring"))
    return ("unchecked" if r[0] == "unverified" else r[0]), r[1]
