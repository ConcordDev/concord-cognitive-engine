"""Wiring capture: a per-lens CONTROL -> ENDPOINT -> HANDLER map built from a walk's netledger output.

Pure and offline (no browser, no checkout): it takes the control rows + the request rows the NetLedger already
attributed per control window, a backend registry snapshot (tools/action_registry.py, read with git show at the
FOLD SHA), and produces
  * wiring-<lens>.json     per-lens wiring (labels, requests with SHAPES, backend join, flows, errors)
  * wiring-index.json(.gz) combined index + reverse index endpoint -> controls (shared endpoints)
  * live_labels.json       exactly the live_labels_index.json format (source/lenses) + run provenance,
                           so rewrites.py can cite `live:<lens>`.
Rules (binding):
  * request/response SHAPE only: keys and JSON type names, recursively, arrays as one merged element shape.
    VALUES are never stored. A key that names a secret (token/secret/password/cookie/authorization/session/
    apikey/key/...) is kept as a key name but its type is replaced by "redacted"; a key that LOOKS like a value
    (uuid, jwt, long mixed token, email) is collapsed to "<dyn>". Headers are never stored except content-type.
  * a final defensive scrub runs over every serialized document; anything it still catches is replaced and counted.
  * unresolved joins are `unresolved:<reason>`, never guessed.
  * deterministic: same input -> byte-identical output (sorted keys, no timestamps other than the supplied ones).
"""
import gzip, json, os, re
from collections import OrderedDict

from . import routematch as RM

SCHEMA = 1
MAX_DEPTH, MAX_KEYS, MAX_ELEMS = 6, 40, 20
GZIP_OVER = 64 * 1024

SECRET_KEY = re.compile(r"(?i)token|secret|passw|passcode|cookie|authorization|\bauth\b|auth[_-]?header|session|api[_-]?key|apikey|(?:^|[_.\-])key$|^key$|"
                        r"credential|bearer|jwt|signature|private|otp|csrf|salt|seed|mnemonic|cvv|card[_-]?number|ssn|refresh")
_VALUELIKE_KEY = re.compile(r"^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{12,}|"
                            r"\d{6,}|eyJ[\w-]+\.[\w-]+\.[\w-]*|[^@\s]+@[^@\s]+\.[^@\s]+|(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_.~%+/=-]{20,})$")
_PLAIN_KEY = re.compile(r"^[A-Za-z_$][\w$.:\-/ ]{0,60}$")

# --- text scrub (free text: error messages, labels) ---
_SCRUBS = (
    (re.compile(r"eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]*"), "<jwt>"),
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}"), "bearer <redacted>"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "<email>"),
    (re.compile(r"(?i)\b(token|secret|password|passwd|cookie|authorization|session|api[_-]?key|apikey|key)\b\s*[:=]\s*[^\s,;'\"&]+"), r"\1=<redacted>"),
    (re.compile(r"\b(?:sk|pk|rk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{10,}"), "<secret>"),
    (re.compile(r"\b[0-9a-fA-F]{32,}\b"), "<hex>"),
    (re.compile(r"(?=[A-Za-z0-9_+/=-]*[A-Za-z])(?=[A-Za-z0-9_+/=-]*\d)[A-Za-z0-9_+/=-]{28,}"), "<tok>"),
)


def scrub_text(s, limit=160):
    s = ((s or "").splitlines() or [""])[0]
    s = re.sub(r"\?[^\s'\"]*", "?…", s)
    for rx, rep in _SCRUBS:
        s = rx.sub(rep, s)
    return s[:limit]


# ------------------------------------------------------------------ shapes
def _tname(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "string"
    return "object" if isinstance(v, dict) else "array"


def safe_key(k):
    k = str(k)
    if _VALUELIKE_KEY.match(k) or not _PLAIN_KEY.match(k):
        return "<dyn>"
    return k


def _merge(a, b):
    """Merge two shapes (array elements): objects union their keys, differing scalar types join with '|'."""
    if a == b:
        return a
    if isinstance(a, dict) and isinstance(b, dict):
        out = dict(a)
        for k, v in b.items():
            out[k] = _merge(out[k], v) if k in out else v
        return OrderedDict(sorted(out.items()))
    if isinstance(a, list) and isinstance(b, list):
        return [_merge(a[0], b[0])] if a and b else (a or b)
    sa = a if isinstance(a, str) else ("object" if isinstance(a, dict) else "array")
    sb = b if isinstance(b, str) else ("object" if isinstance(b, dict) else "array")
    if "redacted" in (sa, sb):
        return "redacted"
    return "|".join(sorted(set(sa.split("|")) | set(sb.split("|"))))


def shape(obj, depth=0):
    """JSON value -> type shape. Values are never kept. Objects: {key: shape}; arrays: [merged element shape] (or [] when empty)."""
    if depth >= MAX_DEPTH:
        return "…"
    if isinstance(obj, dict):
        out = OrderedDict()
        for k in sorted(obj, key=str)[:MAX_KEYS]:
            sk = safe_key(k)
            if sk == "<dyn>" and sk in out:
                out[sk] = _merge(out[sk], shape(obj[k], depth + 1))
            elif SECRET_KEY.search(str(k)):
                out[sk] = "redacted"
            else:
                out[sk] = shape(obj[k], depth + 1)
        return out
    if isinstance(obj, list):
        el = None
        for x in obj[:MAX_ELEMS]:
            s = shape(x, depth + 1)
            el = s if el is None else _merge(el, s)
        return [] if el is None else [el]
    return _tname(obj)


# ------------------------------------------------------------------ backend join
def _classify_chain(mw, global_mw):
    kinds = [k for _n, k in mw]
    out = OrderedDict()
    for k in ("auth", "ownership", "rate_limit", "validation", "other"):
        out[k] = [n for n, kk in mw if kk == k]
    if not out["auth"] and any(k == "auth" for _n, k, *_ in global_mw):
        out["auth"] = ["global:" + next(n for n, k, *_ in global_mw if k == "auth")]
    out["has_auth"] = bool(out["auth"])
    out["has_ownership"] = bool(out["ownership"])
    out["has_rate_limit"] = bool(out["rate_limit"])
    out["has_validation"] = bool(out["validation"])
    return out, kinds


def join_route(reg, method, path):
    """Observed (method, templated path) -> {pattern, file, line, middleware[], chain{}} | 'unresolved:<reason>'."""
    if not reg or not reg.get("routes"):
        return "unresolved:no_registry"
    routes = [r for r in reg.get("routes", []) if r["method"] in (method, "ALL") and r.get("source") in ("express", "express-router")]
    hits = [r for r in routes if RM.pattern_match(r["pattern"], path, runtime=r.get("mount") == "runtime")]
    if not hits:
        nxt = [r for r in reg.get("routes", []) if r.get("source") == "next-api" and r["method"] == method and RM.pattern_match(r["pattern"], path)]
        if nxt:
            r = sorted(nxt, key=RM._specificity, reverse=True)[0]
            return OrderedDict([("pattern", r["pattern"]), ("file", r["file"]), ("line", r["line"]), ("source", r["source"]),
                                ("middleware", []), ("chain", None), ("note", "next api route handler; middleware not statically listed")])
        same = [r for r in reg.get("routes", []) if RM.pattern_match(r["pattern"], path, runtime=r.get("mount") == "runtime")]
        return "unresolved:method_not_declared" if same else "unresolved:no_route_match"
    r = sorted(hits, key=RM._specificity, reverse=True)[0]
    mw = [tuple(x) for x in r.get("mw", [])]
    gm = [tuple(x) for x in reg.get("global_mw", [])]
    chain, _ = _classify_chain(mw, gm)
    return OrderedDict([("pattern", r["pattern"]), ("file", r["file"]), ("line", r["line"]), ("source", r["source"]),
                        ("middleware", [{"name": n, "kind": k} for n, k in mw]), ("chain", chain)])


def join_action(reg, la):
    """Observed lens_action {domain, action|op} -> registry row + solver join, or unresolved:<reason>."""
    if not la:
        return None
    if not reg or not reg.get("actions"):
        return OrderedDict([("domain", la.get("domain")), ("action", la.get("action")), ("op", la.get("op")),
                            ("registered", "unresolved:no_registry"), ("solver", "unresolved:no_registry")])
    if "action" not in la:
        return OrderedDict([("domain", la.get("domain")), ("op", la.get("op")), ("registered", "unresolved:generic_lens_op_not_an_action"),
                            ("solver", "unresolved:no_action")])
    row = next((a for a in reg.get("actions", []) if a["domain"] == la["domain"] and a["action"] == la["action"]), None)
    solver = next((s for s in reg.get("solvers", []) if s["id"] == la["action"] or s["id"] == "%s.%s" % (la["domain"], la["action"])), None)
    return OrderedDict([("domain", la["domain"]), ("action", la["action"]),
                        ("registered", OrderedDict([("file", row["file"]), ("line", row["line"]), ("receipt_class", row.get("receipt_class"))])
                         if row else "unresolved:action_not_registered_at_fold_sha"),
                        ("solver", OrderedDict([("id", solver["id"]), ("file", solver["file"]), ("line", solver["line"])]) if solver
                         else "unresolved:no_static_solver_link")])


# ------------------------------------------------------------------ flows (create -> list -> read back -> delete)
_DYN_SEG = re.compile(r"^:(?:n|uuid|hex|id|long|p)$")


def _split_resource(path):
    segs = [s for s in path.split("/") if s]
    item = bool(segs) and bool(_DYN_SEG.match(segs[-1]))
    coll = segs[:-1] if item else segs
    return "/" + "/".join(coll), item


def _kind(method, item):
    if method == "POST":
        return "create" if not item else "update"
    if method == "GET":
        return "read" if item else "list"
    if method in ("PUT", "PATCH"):
        return "update"
    if method == "DELETE":
        return "delete"
    return None


def infer_flows(controls):
    """Flows of controls+endpoints that work on the SAME resource path (ids are templated by the ledger, so the
    path with its trailing id segment stripped is the resource key). A flow needs a mutation (create/update/delete)
    plus at least one other kind; steps keep the order the controls were exercised in."""
    by = OrderedDict()
    for c in controls:
        for q in c.get("requests", []):
            if q.get("telemetry") or q.get("background") or q["path"].startswith("/api/lens/run"):
                continue
            coll, item = _split_resource(q["path"])
            k = _kind(q["method"], item)
            if k:
                by.setdefault(coll, []).append({"kind": k, "control": c["sid"], "method": q["method"], "path": q["path"], "status": q.get("status")})
    flows = []
    for coll, steps in by.items():
        kinds = {s["kind"] for s in steps}
        if kinds & {"create", "update", "delete"} and len(kinds) >= 2:
            seen, uniq = set(), []
            for s in steps:
                key = (s["kind"], s["control"], s["method"], s["path"])
                if key not in seen:
                    seen.add(key)
                    uniq.append(s)
            flows.append(OrderedDict([("resource", coll), ("kinds", sorted(kinds)), ("steps", uniq[:12]),
                                      ("complete_crud", {"create", "list", "read", "delete"} <= kinds)]))
    return sorted(flows, key=lambda f: f["resource"])


# ------------------------------------------------------------------ per-lens build
INPUT_ROLES = ("textbox", "searchbox", "combobox", "spinbutton", "slider", "checkbox", "switch", "radio")


def label_data(c, extra=None):
    """Label data for a control: visible text, aria-label, title, role, tab name, submenu path, stable selector (sid).
    `extra` is what the driver annotated (aria_label/title/submenu_path/selector); absent fields are None, never invented."""
    ex = dict(c.get("label_data") or {})
    ex.update(extra or {})
    name = scrub_text(c.get("name") or "", 120)
    role = c.get("role") or None
    return OrderedDict([
        ("text", name if name != "-" else None),
        ("aria_label", scrub_text(ex["aria_label"], 120) if ex.get("aria_label") else None),
        ("title", scrub_text(ex["title"], 120) if ex.get("title") else None),
        ("role", role),
        ("tab", name if role == "tab" else (scrub_text(ex["tab"], 80) if ex.get("tab") else None)),
        ("submenu_path", [scrub_text(x, 60) for x in ex.get("submenu_path", [])][:6] or None),
        ("selector", ex.get("selector") or c.get("sid")),
        ("phase", c.get("phase")),
    ])


def build_lens(lens, controls, reg, run_id, fold_sha, extras=None):
    """controls: NetLedger.build() control rows (dicts). extras: {sid: driver-annotated label data}."""
    extras = extras or {}
    out_controls = []
    for c in controls:
        reqs = []
        for q in c.get("requests", []):
            r = OrderedDict([("method", q["method"]), ("path", q["path"]), ("status", q.get("status")), ("n", q.get("n", 1)),
                             ("write", bool(q.get("write")))])
            if q.get("content_type"):
                r["content_type"] = q["content_type"]
            for src, dst in (("req_shape", "request_shape"), ("resp_shape", "response_shape")):
                if q.get(src) is not None:
                    r[dst] = q[src]
            if q.get("query_keys"):
                r["query_keys"] = sorted(safe_key(k) for k in q["query_keys"])
            if q.get("error"):
                r["error"] = scrub_text(str(q["error"]), 60)
            if q.get("background"):
                r["background"] = True
            if q.get("telemetry"):
                r["telemetry"] = True
            r["route"] = join_route(reg, q["method"], q["path"])
            a = join_action(reg, q.get("lens_action"))
            if a:
                r["action"] = a
            reqs.append(r)
        row = OrderedDict([("sid", c["sid"]), ("control_id", c.get("control_id")), ("label", label_data(c, extras.get(c["sid"]))),
                           ("exercised", bool(c.get("exercised"))), ("effect", c.get("effect")), ("requests", reqs),
                           ("errors", OrderedDict([("console", int(c.get("console_errors") or 0)),
                                                   ("http_4xx", [scrub_text(x, 120) for x in c.get("http_4xx", [])]),
                                                   ("http_5xx", [scrub_text(x, 120) for x in c.get("http_5xx", [])]),
                                                   ("samples", [scrub_text(x) for x in c.get("error_samples", [])][:3]),
                                                   ("request_failed", sorted({scrub_text(str(q["error"]), 40) for q in c.get("requests", [])
                                                                              if q.get("error") and q["error"] not in ("pending", "aborted")}))]))])
        out_controls.append(row)
    flows = infer_flows([{"sid": r["sid"], "requests": r["requests"]} for r in out_controls])
    return OrderedDict([("schema", SCHEMA), ("lens", lens), ("run_id", run_id), ("fold_sha", fold_sha), ("controls", out_controls), ("flows", flows)])


# ------------------------------------------------------------------ cross-lens indexes
def reverse_index(lens_wirings):
    """'METHOD path' -> controls that fire it, across lenses; `shared` when more than one control or lens fires it."""
    ix = OrderedDict()
    for lw in lens_wirings:
        for c in lw["controls"]:
            for q in c["requests"]:
                if q.get("telemetry"):
                    continue
                e = ix.setdefault("%s %s" % (q["method"], q["path"]), {"lenses": set(), "controls": set(),
                                                                       "route": q.get("route") if isinstance(q.get("route"), dict) else None})
                e["lenses"].add(lw["lens"])
                e["controls"].add("%s#%s" % (lw["lens"], c["sid"]))
    out = OrderedDict()
    for k in sorted(ix):
        e = ix[k]
        out[k] = OrderedDict([("lenses", sorted(e["lenses"])), ("controls", sorted(e["controls"])),
                              ("shared", len(e["controls"]) > 1 or len(e["lenses"]) > 1),
                              ("handler", "%s:%s" % (e["route"]["file"], e["route"]["line"]) if e["route"] else "unresolved")])
    return out


def live_labels(lens_wirings, run_id, fold_sha, backend_sha=None):
    """Exactly live_labels_index.json's format ({source, lenses:{lens:{labels,tabs,inputs,runs,backend_sha}}}) plus provenance."""
    lenses = OrderedDict()
    for lw in sorted(lens_wirings, key=lambda x: x["lens"]):
        labels, tabs, inputs = set(), set(), set()
        for c in lw["controls"]:
            lb = c["label"]
            name = lb["text"]
            if not name or name.startswith("-"):
                continue
            if lb["role"] == "tab":
                tabs.add(name)
            elif lb["role"] in INPUT_ROLES:
                inputs.add(name)
            else:
                labels.add(name)
            if lb.get("aria_label"):
                labels.add(lb["aria_label"])
        lenses[lw["lens"]] = OrderedDict([("labels", sorted(labels)), ("tabs", sorted(tabs)), ("inputs", sorted(inputs)),
                                          ("runs", [run_id]), ("backend_sha", backend_sha or fold_sha)])
    return OrderedDict([("source", "wiring-capture run %s at fold %s; read-only, shapes and control names only, no creds" % (run_id, fold_sha)),
                        ("provenance", OrderedDict([("run_id", run_id), ("fold_sha", fold_sha), ("schema", SCHEMA)])),
                        ("lenses", lenses)])


# ------------------------------------------------------------------ output
def final_scrub(text):
    """Defensive last pass over a serialized document; returns (text, n_replaced). Shapes hold no values, so n should be 0."""
    n = 0
    for rx, rep in ((_SCRUBS[0]), (_SCRUBS[1]), (_SCRUBS[4]), (_SCRUBS[5])):
        text, k = rx.subn(rep, text)
        n += k
    return text, n


def dumps(obj):
    return json.dumps(obj, sort_keys=True, indent=1, ensure_ascii=False) + "\n"


def write_all(out_dir, lens_wirings, run_id, fold_sha, backend_sha=None):
    """Writes wiring-<lens>.json, wiring-index.json[.gz] and live_labels.json. Deterministic. Returns {path: scrubbed_replacements}."""
    os.makedirs(out_dir, exist_ok=True)
    report = {}
    lens_wirings = sorted(lens_wirings, key=lambda x: x["lens"])
    docs = [("wiring-%s.json" % re.sub(r"[^a-z0-9_-]", "_", lw["lens"].lower()), lw) for lw in lens_wirings]
    index = OrderedDict([("schema", SCHEMA), ("run_id", run_id), ("fold_sha", fold_sha),
                         ("lenses", OrderedDict((lw["lens"], OrderedDict([("controls", len(lw["controls"])),
                                                                          ("requests", sum(len(c["requests"]) for c in lw["controls"])),
                                                                          ("flows", len(lw["flows"]))])) for lw in lens_wirings)),
                         ("endpoints", reverse_index(lens_wirings))])
    docs.append(("wiring-index.json", index))
    docs.append(("live_labels.json", live_labels(lens_wirings, run_id, fold_sha, backend_sha)))
    for name, doc in docs:
        text, n = final_scrub(dumps(doc))
        data = text.encode("utf-8")
        path = os.path.join(out_dir, name)
        if name == "wiring-index.json" and len(data) > GZIP_OVER:
            path += ".gz"
            data = gzip.compress(data, compresslevel=9, mtime=0)
        with open(path, "wb") as f:
            f.write(data)
        report[os.path.basename(path)] = n
    return report


# ------------------------------------------------------------------ registry + collector (the walk's --capture-wiring mode)
def load_registry(path=None, repo=None, sha=None, log=None):
    """The backend registry at the fold sha: a saved actions-<sha>.json.gz, else built with git show/ls-tree from `repo`@`sha`
    (no checkout), else {} (every backend join then reads unresolved:no_registry)."""
    log = log or (lambda *_a: None)
    if path:
        op = gzip.open if path.endswith(".gz") else open
        with op(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    if repo and sha:
        import sys
        tools = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools")
        if tools not in sys.path:
            sys.path.insert(0, tools)
        import action_registry as AR
        log("wiring: building backend registry at %s (git show, no checkout) - slow, prefer --wiring-registry" % sha[:12])
        return AR.build(AR.GitTree(repo, sha), sha)
    return {}


class Collector:
    def __init__(self, out_dir, run_id, fold_sha, registry=None):
        self.reg = registry or {}
        # the fold sha is the sha the backend registry was read at; with neither it is 'unpinned', which load_live_index refuses
        # (provenance needs a hex sha), so an unpinned capture can never back a rewrite.
        fold_sha = fold_sha if fold_sha else (self.reg.get("sha") if self.reg.get("sha") else "unpinned")
        self.out_dir, self.run_id, self.fold_sha = out_dir, run_id, fold_sha
        self.registry_desc = ("%s (%d actions, %d routes)" % (self.reg.get("sha", "?")[:12], len(self.reg.get("actions", [])), len(self.reg.get("routes", [])))
                              if self.reg else "none -> backend joins are unresolved:no_registry")
        self.lenses, self.backend_sha = [], None

    def add(self, lens, controls, backend_sha=None, extras=None):
        """controls: NetLedger.build() rows. extras: {control_id: label_data} the driver annotated."""
        by_sid = {c["control_id"]: c["sid"] for c in controls if c.get("control_id") in (extras or {})}
        ex = {by_sid[cid]: v for cid, v in (extras or {}).items() if cid in by_sid}
        self.lenses.append(build_lens(lens, controls, self.reg, self.run_id, self.fold_sha, ex))
        self.backend_sha = self.backend_sha or backend_sha

    def flush(self):
        return write_all(self.out_dir, self.lenses, self.run_id, self.fold_sha, self.backend_sha)
