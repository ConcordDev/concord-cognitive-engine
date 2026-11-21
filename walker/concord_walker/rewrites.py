"""Precise, machine-mappable repro REWRITES kept BESIDE the verbatim ticket text (ULW rewrite pass).

A ticket's `repro_steps` / `expected` are tester prose. A rewrite is a structured twin of that prose, written in
the walker's own vocabulary (the ops below = verbs expand_step already runs) and checkable predicate kinds
(expected.py's kinds). It lives in `walker/rewrites/batch-NNN.jsonl`; nothing is ever written to the ticket fold.

Fail closed. `agree(ticket, rw)` is the only door: a rewrite is used for replay only when it is bound to the
CURRENT original text (orig_hash), adds no step and no expectation the original does not contain, types only
values the original names, and names the same control the original names. Anything else -> NEEDS_HUMAN
`rewrite_disagrees:<reason>`; it never falls back to a looser reading. `human_only` records are never replayed.
A rewrite changes what gets MAPPED/CHECKED, never what counts as VERIFIED (ledger.assert_verifiable is untouched):
steps compile to the mapper's own step text, so every write/typed step still goes through run_repro's pass-2
safety (own fixture, --allow-write, non-admin, HARD_DENY, FIELD_NEVER) exactly as the original text would.

Record (schema 1):
  ticket_id, lens, fold_sha, orig_hash, author, date, schema, status: "rewritten"|"human_only",
  human_only_reason: lighthouse|code_read|cross_account|visual|other_with_note (+ note),
  steps:    [{op, target?, value?, count?, src, from_orig:[orig step idx,...]}],
  dropped:  [{orig: idx, reason: "observe_moved_to_expected"|"no_text"}],
  expected: [{kind, args, from_orig_clause:[clause idx | "s<step idx>",...], orig_span}]
"""
import glob
import hashlib
import json
import os
import re

from . import expected as _X
from . import labels as _L
from . import provenance as _P
from . import repro as _R
from . import writevocab as _W
from .safety import HARD_DENY, WRITE_NEVER

SCHEMA = 1
FOLD_SHA = "272e62f41"
DEFAULT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "rewrites")
HUMAN_REASONS = ("lighthouse", "code_read", "cross_account", "visual", "other_with_note")
DROP_REASONS = ("observe_moved_to_expected", "no_text")
SRC_RE = re.compile(r"^(?:text|live:[a-z0-9][a-z0-9/_\-]*(?:@[A-Za-z0-9._\-]+:[0-9a-f]{7,40})?|manifest:[a-z0-9][a-z0-9/_.\-]*|alias|frontend:[A-Za-z0-9_@\[\]()/.\-]+:\d+)$")
STATUSES = ("rewritten", "human_only", "original_sufficient")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_KEYS = {"Escape", "Enter", "Tab", "Shift+Tab", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Space", "Home", "End", "Backspace"}
_KEY_ANCHOR = {"Escape": r"esc", "Enter": r"enter|return", "Tab": r"\btab\b", "Shift+Tab": r"shift\s*\+?\s*tab", "ArrowDown": r"arrow\s*down|down arrow|\bdown\b",
               "ArrowUp": r"arrow\s*up|up arrow|\bup\b", "ArrowLeft": r"arrow\s*left|left arrow|\bleft\b", "ArrowRight": r"arrow\s*right|right arrow|\bright\b",
               "Space": r"space", "Home": r"\bhome\b", "End": r"\bend\b", "Backspace": r"backspace"}


# ------------------------------------------------------------------ frontend source check (src "frontend:<path>:<line>")
_FE_CACHE = {}


def frontend_label_at(path, line, label, repo=None, sha=FOLD_SHA):
    """True iff `path` exists at the fold sha, the pinned `line` exists in it, and `label` literally appears
    (case-insens., whitespace-normalised) SOMEWHERE in the file. GB-1581 item 5d: the pin's line is
    provenance, not the gate — all 22 Walk-2 'src_not_live' pins carried labels that ARE in the deployed
    source, just on other lines (the file shifted under the pin). Fails closed (False) when git/the sha
    is unavailable, the file/line does not exist, or the label is nowhere in the file."""
    import subprocess
    repo = repo or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    key = (repo, sha, path)
    if key not in _FE_CACHE:
        try:
            out = subprocess.run(["git", "-C", repo, "show", "%s:%s" % (sha, path)], capture_output=True, timeout=30)
            _FE_CACHE[key] = out.stdout.decode("utf-8", "replace").splitlines() if out.returncode == 0 else None
        except Exception:
            _FE_CACHE[key] = None
    lines = _FE_CACHE[key]
    if not lines or not (1 <= line <= len(lines)):
        return False
    norm = lambda x: re.sub(r"\s+", " ", _qn(x or "")).strip().lower()
    lab = norm(label)
    return bool(lab) and any(lab in norm(l) for l in lines)


def _fe_ok(src, label, repo=None):
    m = re.fullmatch(r"frontend:(.+):(\d+)", src or "")
    return bool(m) and m.group(1).startswith("concord-frontend/") and frontend_label_at(m.group(1), int(m.group(2)), label, repo)


# ------------------------------------------------------------------ provenance
def orig_hash(ticket):
    """sha256 of the ticket's ORIGINAL repro_steps + expected exactly as the fold returns them."""
    blob = json.dumps({"repro_steps": (ticket or {}).get("repro_steps"), "expected": (ticket or {}).get("expected")},
                      sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _n(x):
    return re.sub(r"[^a-z0-9]+", "", (x or "").lower())


def _qn(x):
    return (x or "").replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"')


# ------------------------------------------------------------------ steps: op -> canonical step text
# op -> (compiler(step)->text|None, allowed executor actions, anchor regex that the ORIGINAL step text must contain, literal field)
def _t_open(s):
    t = s.get("target") or ""
    return "Open %s" % t if re.fullmatch(r"/lenses/[a-z0-9\-/]+", t) else None


def _t_open_tab(s):
    return 'Open the "%s" tab' % s["target"] if _plain(s.get("target")) else None


def _t_click(s):
    return 'Click "%s"' % s["target"] if _plain(s.get("target")) else None


def _t_type(s):
    f, v = s.get("target"), s.get("value")
    if not _plain(f) or not isinstance(v, str) or not v or '"' in v or "\n" in v or len(v) > 200:
        return None
    m = re.fullmatch(r"(\d{2,4})-char", v)
    if m:
        return "Enter a %s-char name in %s" % (m.group(1), f)
    return 'Type "%s" in %s' % (v, f)


def _t_press(s):
    k, c = s.get("target"), int(s.get("count") or 1)
    return "Press %s%s" % (k, " %d times" % c if c > 1 else "") if k in _KEYS and 1 <= c <= 25 else None


def _t_viewport(s):
    return "Set viewport %s" % s["target"] if s.get("target") in ("390x844", "1280x900") else None


def _t_scheme(s):
    return "Switch to %s theme" % s["target"] if s.get("target") in ("dark", "light") else None


def _t_export(s):
    return "Use Export %s" % s["target"] if s.get("target") in ("JSON", "CSV", "PDF", "DTU", "ICS", "TXT", "XLSX") else None


def _t_wait(s):
    try:
        n = int(s.get("count"))
    except (TypeError, ValueError):
        return None
    return "Wait %d seconds" % n if 1 <= n <= 60 else None


def _t_delete(s):
    return "Delete the created %s" % s["target"] if _plain(s.get("target")) and re.fullmatch(r"[A-Za-z][A-Za-z ]{0,30}", s["target"]) else None


def _t_open_first(s):
    t = s.get("target") or ""
    return "Open an %s" % t if re.fullmatch(r"[a-z][a-z ]{0,30}", t) else None


def _plain(x):
    return isinstance(x, str) and 0 < len(x.strip()) <= 80 and not re.search(r'["\n\\]|>|;', x)


OPS = {
    "open": (_t_open, {"open"}, r"\blenses/|\bopen\b|\bgo to\b|\bnavigate\b|\bvisit\b|\bload\b|\bon\b"),
    "open_tab": (_t_open_tab, {"open_tab", "click"}, None),
    "click": (_t_click, {"click"}, None),
    "type": (_t_type, {"fill", "type_value"}, None),
    "press": (_t_press, {"press"}, None),
    "reload": (lambda s: "Reload the page", {"reload"}, r"reload|refresh|f5"),
    "viewport": (_t_viewport, {"set_viewport", "check_overflow"}, None),
    "scheme": (_t_scheme, {"set_scheme"}, None),
    "tab_sweep": (lambda s: "Tab from top", {"tab_sweep"}, r"\btab\b|keyboard"),
    "export": (_t_export, {"export_check"}, r"export|download"),
    "submit": (lambda s: "Submit", {"submit_form"}, r"submit|save|add|create|post|schedule|apply|confirm|done|log|record|run|send|join|start"),
    "fill_form": (lambda s: "Fill the form", {"fill_label"}, r"fill|enter|type|complete|set|input|write|name|title"),
    "delete_own": (_t_delete, {"delete_own"}, r"delet|remov|trash"),
    "open_first": (_t_open_first, {"open_first"}, r"open|select|click|pick|choose|view|expand"),
    "wait": (_t_wait, {"wait"}, r"wait|second|\d+\s*s\b|\bms\b|settle|load"),
}
OPS["console"] = (lambda s: "Load the lens with Console open", {"check_console"}, r"console")
OPS["network"] = (lambda s: "Load the lens with Network open", {"check_network"}, r"network")
OPS["ax"] = (lambda s: "Open the a11y tree", {"check_ax"}, r"a11y|accessibility|screen ?reader|aria")
OPS["keep"] = (None, None, None)              # the original step text, verbatim: it must map exactly as the original does
OPS["needs_human_step"] = (None, None, None)  # the original step text, verbatim: it must stay UNMAPPED (a person runs it)
_LITERAL_OPS = {"open_tab", "click", "type", "viewport", "scheme", "export", "press", "delete_own", "open_first"}


def compile_step(step, raws=None):
    """One rewrite step -> (canonical step text | None, reason). The text is what expand_step maps."""
    op = step.get("op")
    if op not in OPS:
        return None, "unknown op %r" % (op,)
    if op in ("keep", "needs_human_step"):
        fo = step.get("from_orig") or []
        if raws is None or len(fo) != 1 or not (0 <= fo[0] < len(raws)):
            return None, "op %s needs exactly one existing original step" % op
        return raws[fo[0]], None
    text = OPS[op][0](step)
    if not text:
        return None, "op %s: bad/missing target or value" % op
    return text, None


def _step_mapped(text, lens):
    return _R.expand_step(text, lens)


# ------------------------------------------------------------------ expected: kind -> canonical clause text
def _c_names(a):
    ns = a.get("names") or ([a["name"]] if a.get("name") else [])
    return [n for n in ns if _plain(n)]


KINDS = {
    "control_present": lambda a: "has a control matching: %s" % " | ".join(_c_names(a)) if _c_names(a) else None,
    "text_phrase": lambda a: "shows %s" % a["phrase"] if isinstance(a.get("phrase"), str) and len(re.findall(r"[a-z0-9]+", a["phrase"].lower())) >= 2 and re.fullmatch(r"[a-z][a-z0-9 \-/']{4,40}", a["phrase"]) else None,
    "text_absent": lambda a: 'no "%s"' % a["name"] if _plain(a.get("name")) else None,
    "no_console_error": lambda a: "No console errors",
    "net_class": lambda a: "no %sxx errors" % a.get("cls", "5") if a.get("cls") in ("4", "5") else None,
    "net_status": lambda a: ("no %d" % a["code"]) if isinstance(a.get("code"), int) and a.get("neg") and 400 <= a["code"] <= 599 else (("status %d" % a["code"]) if isinstance(a.get("code"), int) and not a.get("neg") and 200 <= a["code"] <= 599 else None),
    "esc_closes": lambda a: "Escape closes the dialog",
    "focus_opener": lambda a: "focus returns to the trigger",
    "focus_trap": lambda a: "focus is trapped in the dialog",
    "arrow_moves": lambda a: "arrow keys move focus",
    "tab_reaches": lambda a: 'Tab reaches "%s"' % a["name"] if _plain(a.get("name")) else None,
    "confirm_before_delete": lambda a: "delete asks for confirmation",
    "export_file": lambda a: "Export downloads a file",
    "ax_names": lambda a: "all controls have accessible names",
    "contrast": lambda a: "text meets WCAG AA contrast",
    "overflow_390": lambda a: "no horizontal scroll",
    "target_size": lambda a: "targets are at least %d px" % a["px"] if isinstance(a.get("px"), int) and 16 <= a["px"] <= 99 else None,
    "validation_block": lambda a: "rejects the invalid value",
    "persisted": lambda a: '"%s" persists after reload' % a["name"] if _plain(a.get("name")) else None,
    "value_saved": lambda a: "saved value persists after reload",
    "item_created": lambda a: "new item appears",
    "appears_in_list": lambda a: "it appears in the list",
    "popup_closed": lambda a: "dialog closes",
    # GB-1581 item 4: value / count / order compare kinds
    "value_equals": lambda a: ('%s shows "%s"' % (a["name"], a["value"])) if a.get("name") and _plain(a.get("name")) and isinstance(a.get("value"), str) and 0 < len(a["value"]) <= 60 else (('value is "%s"' % a["value"]) if isinstance(a.get("value"), str) and 0 < len(a["value"]) <= 60 else None),
    "count_equals": lambda a: ("shows %d %s" % (a["count"], a["of"])) if isinstance(a.get("count"), int) and 0 <= a["count"] <= 999 and isinstance(a.get("of"), str) and re.fullmatch(r"[a-z][a-z\-]{2,20}(?: [a-z][a-z\-]{2,20})?", a["of"]) else None,
    "order_matches": lambda a: ("in order %s" % ", ".join(a["names"])) if isinstance(a.get("names"), list) and 2 <= len(a["names"]) <= 8 and all(_plain(n) for n in a["names"]) else (("sorted alphabetically") if a.get("sorted") == "alpha" else None),
}
# anchor the ORIGINAL clause text must contain (case-insens.) for a literal-free kind to be a faithful reading of it
KIND_ANCHOR = {
    "no_console_error": r"console|error|crash|exception", "net_class": r"4xx|5xx|error|fail|request|network|\b[45]\d\d\b",
    "net_status": r"\b\d{3}\b|status|error|request|network|http", "esc_closes": r"esc", "focus_opener": r"focus",
    "focus_trap": r"focus|trap|contain|stay", "arrow_moves": r"arrow", "tab_reaches": r"\btab",
    "confirm_before_delete": r"confirm|are you sure|prompt|dialog|ask", "export_file": r"export|download|file|json|csv",
    "ax_names": r"accessible|aria|label|name", "contrast": r"contrast|wcag|:\s*1\b", "overflow_390": r"scroll|overflow|clip|fit|cut|wrap|off-?screen",
    "target_size": r"\d{2}\s*(?:px|pt)|target|tap", "validation_block": r"reject|block|prevent|validat|error|invalid|required|not (?:saved|accept|allowed)|clamp|refus|inline|message|never (?:saved|stored)",
    "persisted": r"persist|reload|survive|saved|remain|still", "value_saved": r"persist|reload|saved|survive|stored|kept|remain|there",
    "item_created": r"creat|add|appear|new|saved|listed|row", "appears_in_list": r"list|appear|row|show|table|card|feed|visible|history",
    "popup_closed": r"clos|dismiss|disappear|gone", "control_present": r"control|button|field|link|toggle|tab|menu|option|input|available|present|visible|shows?|has|label",
    "text_phrase": r"show|display|list|render|contain|read|say|text|label|heading", "text_absent": r"no |not |never|without|doesn|absent|gone",
    "value_equals": r"value|field|input|shows?|displays?|reads?", "count_equals": r"\d|count|shows?|there are|lists?",
    "order_matches": r"order|sorted|alphabet",
}
_NAME_KINDS = {"control_present": "names", "text_absent": "name", "tab_reaches": "name", "persisted": "name"}


KINDS["keep"] = None
KINDS["needs_human"] = None
VERBATIM_KINDS = ("keep", "needs_human")


def compile_clause(c, clauses=None):
    """One rewrite expected clause -> (canonical clause text | None, reason)."""
    k = c.get("kind")
    if k in VERBATIM_KINDS:
        fo = c.get("from_orig_clause") or []
        if clauses is None or len(fo) != 1 or not isinstance(fo[0], int) or not (0 <= fo[0] < len(clauses)):
            return None, "kind %s needs exactly one existing original clause" % k
        return clauses[fo[0]], None
    if k not in KINDS:
        return None, "unknown kind %r" % (k,)
    a = c.get("args") if isinstance(c.get("args"), dict) else {}
    try:
        text = KINDS[k](a)
    except (KeyError, TypeError, ValueError):
        text = None
    return (text, None) if text else (None, "kind %s: bad/missing args" % k)


def _clause_kinds(text):
    sp = _X.classify_clause(text, _R._check_legacy)
    return None if sp is None else [s["kind"] for s in sp]


# ------------------------------------------------------------------ validation + agreement
def _clauses_of(ticket):
    return _X.split_clauses((ticket or {}).get("expected"))


def check_schema(rw):
    """-> reason | None. Pure structure (no ticket)."""
    if not isinstance(rw, dict):
        return "schema: not an object"
    if rw.get("schema") != SCHEMA:
        return "schema: version != %d" % SCHEMA
    for f in ("ticket_id", "lens", "orig_hash", "fold_sha"):
        if not isinstance(rw.get(f), str) or not rw[f]:
            return "schema: missing %s" % f
    if not rw.get("author") or not isinstance(rw.get("author"), str):
        return "provenance: missing author"
    if not isinstance(rw.get("date"), str) or not DATE_RE.match(rw["date"]):
        return "provenance: missing/bad date"
    st = rw.get("status")
    if st == "human_only":
        if rw.get("human_only_reason") not in HUMAN_REASONS:
            return "schema: human_only_reason not in enum"
        if rw["human_only_reason"] == "other_with_note" and not (rw.get("note") or "").strip():
            return "schema: other_with_note needs a note"
        return None
    if st not in ("rewritten", "original_sufficient"):
        return "schema: status must be rewritten|human_only|original_sufficient"
    cs = rw.get("case_source")
    if cs is not None and cs not in _P.CASE_SOURCES:
        return "schema: case_source must be observed|extrapolated (C25)" 
    if not isinstance(rw.get("steps"), list) or not isinstance(rw.get("expected"), list):
        return "schema: steps/expected must be lists"
    if not rw["steps"] and not rw["expected"]:
        return "schema: empty rewrite"
    for s in rw["steps"]:
        if not isinstance(s, dict) or s.get("op") not in OPS:
            return "schema: bad step op"
        if not isinstance(s.get("from_orig"), list) or not s["from_orig"] or not all(isinstance(i, int) for i in s["from_orig"]):
            return "added_step: step has no from_orig"
        if not isinstance(s.get("src"), str) or not SRC_RE.match(s["src"]):
            return "schema: step src must be text|live:<lens>|manifest:<x>|alias|frontend:<path>:<line>"
        if s["op"] == "needs_human_step" and not (isinstance(s.get("why"), str) and len(s["why"].strip()) >= 8):
            return "schema: needs_human_step needs a one-line why naming the concrete blocker"
    for c in rw["expected"]:
        if not isinstance(c, dict) or c.get("kind") not in KINDS:
            return "schema: bad clause kind"
        if not isinstance(c.get("orig_span"), str) or not c["orig_span"].strip():
            return "added_clause: clause has no orig_span"
        if not isinstance(c.get("from_orig_clause"), list) or not c["from_orig_clause"]:
            return "added_clause: clause has no from_orig_clause"
        if c["kind"] == "needs_human" and not (isinstance(c.get("why"), str) and len(c["why"].strip()) >= 8):
            return "schema: needs_human clause needs a one-line why naming the concrete blocker"
    for d in rw.get("dropped") or []:
        if not isinstance(d, dict) or not isinstance(d.get("orig"), int) or d.get("reason") not in DROP_REASONS:
            return "schema: bad dropped entry"
    verb = {"keep", "needs_human_step"}
    converted = any(x["op"] not in verb for x in rw["steps"]) or any(c["kind"] not in VERBATIM_KINDS for c in rw["expected"])
    if st == "rewritten" and not converted:
        return "schema: a rewrite that converts nothing must be status original_sufficient"
    if st == "original_sufficient" and (converted or rw.get("dropped")):
        return "schema: original_sufficient may only hold keep / needs_human verbatim entries"
    return None


def _literal_in(text, orig):
    """The literal `text` is in `orig`: normalised substring, or every content token present, or a known alias."""
    nt, no = _n(text), _n(orig)
    if nt and nt in no:
        return True
    tk = _L.tokens(text)
    if tk and tk <= _L.tokens(orig):
        return True
    al = _L.ALIASES.get(_L._norm_key(text)) or ()
    return any(_n(a) in no for a in al) or any(_n(text) in {_n(x) for x in v} and _n(k) in no for k, v in _L.ALIASES.items())


def _same_control(target, orig, labels):
    """Rule 5: `target` and the original step name the same control (resolve both over the live labels when we have them)."""
    if _literal_in(target, orig):
        return True
    if labels:
        rt = _L.resolve(target, labels)
        if rt["status"] in (_L.EXACT, _L.ALIAS, _L.TOKEN):
            # the original names a control that resolves to the SAME live label
            for m in re.finditer(r"[\"'‘“]([^\"'’”]{1,60})[\"'’”]|\b([A-Z][A-Za-z0-9&'/\-]*(?:\s+[A-Za-z0-9&'/\-]+){0,3})", orig or ""):
                cand = (m.group(1) or m.group(2) or "").strip()
                ro = _L.resolve(cand, labels) if cand else None
                if ro and ro["status"] in (_L.EXACT, _L.ALIAS, _L.TOKEN) and _n(ro["label"]) == _n(rt["label"]):
                    return True
    return False


def _value_in(value, orig):
    ov = _qn(orig)
    if value in ov:
        return True
    m = re.fullmatch(r"(\d{2,4})-char", value)
    return bool(m and re.search(r"\b%s\s*-?\s*char" % m.group(1), ov, re.I))


def _step_literal_ok(s, orig, lens, labels):
    """Rules 3-5 for one step against the concatenated original step text it points at."""
    op, t = s["op"], s.get("target")
    if op in ("click", "open_tab"):
        return _same_control(t, orig, labels), "control %r is not the control the original names" % t
    if op == "type":
        if not _literal_in(t, orig) and not (labels and _same_control(t, orig, labels)):
            return False, "field %r is not the field the original names" % t
        if not _value_in(s.get("value"), orig):
            return False, "typed value %r does not appear in the original" % s.get("value")
        if FIELD_NEVER_RE.search(t or ""):
            return False, "safety: field %r is a never-type field" % t
        return True, None
    if op == "press":
        return bool(re.search(_KEY_ANCHOR.get(t, "$^"), orig, re.I)), "key %s is not in the original" % t
    if op == "viewport":
        w = t.split("x")[0]
        return bool(re.search(r"(?<!\d)%s(?!\d)|mobile|phone|narrow|small screen|desktop|wide" % w, orig, re.I)), "viewport %s is not in the original" % t
    if op == "scheme":
        return bool(re.search(r"\b%s\b" % t, orig, re.I)), "theme %s is not in the original" % t
    if op == "export":
        return bool(re.search(r"\b%s\b|export|download" % re.escape(t), orig, re.I)), "export format %s is not in the original" % t
    if op in ("delete_own", "open_first"):
        a = OPS[op][2]
        return bool(re.search(a, orig, re.I)) and (_literal_in(t, orig) or bool(re.search(r"\b%s" % re.escape((t or "").split()[-1]), orig, re.I))), "%s %r is not in the original" % (op, t)
    if op == "open":
        return (t or "").split("/lenses/")[-1].split("/")[0] == (lens or "").split("/")[0], "open target %r is not this ticket's lens" % t
    a = OPS[op][2]
    if a:
        return bool(re.search(a, orig, re.I)), "op %s has no anchor in the original step" % op
    return True, None


FIELD_NEVER_RE = _W.FIELD_NEVER


LIVE_PROV_RE = re.compile(r"^live:[a-z0-9][a-z0-9/_\-]*@(?P<run>[A-Za-z0-9._\-]+):(?P<sha>[0-9a-f]{7,40})$")


def load_live_index(path_or_dict):
    """A live labels index (the hand-captured live_labels_index.json OR a wiring-capture live_labels.json) ->
    (labels {lens: [names]}, meta). meta = {run_id, fold_sha} for a wiring-capture index (REQUIRED to carry both: a
    capture without provenance is refused, never trusted), None for a legacy hand index. Raises ValueError on a bad index."""
    d = path_or_dict
    if not isinstance(d, dict):
        with open(path_or_dict) as f:
            d = json.load(f)
    if not isinstance(d, dict) or not isinstance(d.get("lenses"), dict):
        raise ValueError("live index has no 'lenses' object")
    prov = d.get("provenance")
    meta = None
    if prov is not None or str(d.get("source", "")).startswith("wiring-capture"):
        if not (isinstance(prov, dict) and isinstance(prov.get("run_id"), str) and prov["run_id"]
                and isinstance(prov.get("fold_sha"), str) and re.match(r"^[0-9a-f]{7,40}$", prov["fold_sha"])):
            raise ValueError("wiring-capture live index needs provenance {run_id, fold_sha}")
        meta = {"run_id": prov["run_id"], "fold_sha": prov["fold_sha"]}
    labels = {}
    for lens, v in d["lenses"].items():
        if not isinstance(v, dict) or not all(isinstance(x, list) for x in (v.get("labels", []), v.get("tabs", []), v.get("inputs", []))):
            raise ValueError("live index lens %r is malformed" % lens)
        labels[lens] = sorted(set(v.get("labels", []) + v.get("tabs", []) + v.get("inputs", [])))
    return labels, meta


def stamp_case_source(rw):
    """C25: return a copy of a rewrite record carrying the case_source tag its
    own step grounding derives (provenance.classify_rewrite). The generator's
    door: new records are stamped here, and agree() re-derives and compares."""
    out = dict(rw)
    out["case_source"] = _P.classify_rewrite(rw)
    return out


def agree(ticket, rw, labels=None, manifest_text=None, frontend_repo=None, live_meta=None):
    """-> (ok, reasons). Deterministic, fail closed. `labels`: {lens: [live control names]} when available.
    `live_meta`: provenance {run_id, fold_sha} of the live index (load_live_index); a step citing `live:<lens>@<run>:<sha>`
    must match it exactly."""
    why = []
    bad = check_schema(rw)
    if bad:
        return False, [bad]
    if rw["ticket_id"] != (ticket or {}).get("id") or rw["lens"] != (ticket or {}).get("lens"):
        return False, ["identity: ticket_id/lens mismatch"]
    if rw["orig_hash"] != orig_hash(ticket):
        return False, ["stale: orig_hash differs from the current original text"]
    if rw["status"] == "human_only":
        return False, ["human_only:%s" % rw["human_only_reason"]]
    if rw["status"] == "original_sufficient":
        # nothing hand-converted: validate the verbatim entries still hold, but the ORIGINAL path is what replays
        pass
    # C25 (Gate S10 #11): a DECLARED case_source is checked against the record's own
    # step grounding, never trusted blind -- a mismatch fails closed here, before any
    # step is mapped. An absent tag is legacy (pre-C25 records) and is not failed;
    # generators stamp new records via stamp_case_source().
    declared = rw.get("case_source")
    if declared is not None:
        derived = _P.classify_rewrite(rw)
        if declared != derived:
            return False, ["case_source_mismatch: declared %r but the record's step grounding derives %r (C25)" % (declared, derived)]
    raws = _R.split_steps(ticket)
    clauses = _clauses_of(ticket)
    lens = ticket.get("lens")
    covered = set()
    lab = (labels or {}).get(lens) if isinstance(labels, dict) else labels
    for k, s in enumerate(rw["steps"]):
        if any(i < 0 or i >= len(raws) for i in s["from_orig"]):
            why.append("added_step: step %d points at a nonexistent original step" % k)
            continue
        covered.update(s["from_orig"])
        text, r = compile_step(s, raws)
        if not text:
            why.append("schema: step %d %s" % (k, r))
            continue
        e = _step_mapped(text, lens)
        acts = {x.get("action") for x in e["substeps"]}
        if s["op"] == "keep":
            if not e["mapped"]:
                why.append("unmappable: step %d is marked keep but the original does not map" % k)
            continue
        if s["op"] == "needs_human_step":
            if e["mapped"]:
                why.append("unmappable: step %d is marked needs_human_step but the original maps (use keep)" % k)
            continue
        if not e["mapped"] or not acts or not acts <= (OPS[s["op"]][1] | {"noop"}):
            why.append("unmappable: step %d (%s) compiles to %r which the executor does not map as %s" % (k, s["op"], text, s["op"]))
            continue
        orig_txt = " ".join(raws[i] for i in s["from_orig"])
        ok, msg = _step_literal_ok(s, orig_txt, lens, lab)
        if not ok:
            why.append(("typed_value_not_in_original: " if "typed value" in (msg or "") else "literal_not_in_original: ") + "step %d %s" % (k, msg))
            continue
        if s["op"] in ("click", "open_tab", "type") and s["src"].startswith("frontend:") and not _fe_ok(s["src"], s.get("target"), frontend_repo):
            why.append("src_not_live: step %d %r is not literally at %s (fold %s)" % (k, s.get("target"), s["src"], FOLD_SHA))
        if s["op"] in ("click", "open_tab") and not re.match(r"^(?:live:|manifest:|alias$|frontend:)", s["src"]):
            why.append("src_not_live: step %d control %r has src %r; a control name must come from the live labels, the manifest or ALIASES" % (k, s.get("target"), s["src"]))
        pm = LIVE_PROV_RE.match(s["src"])
        if pm and not (live_meta and live_meta.get("run_id") == pm.group("run") and str(live_meta.get("fold_sha", "")).startswith(pm.group("sha")[:7])):
            why.append("src_not_live: step %d cites %s but the live index %s" % (k, s["src"], ("is run %s at %s" % (live_meta["run_id"], live_meta["fold_sha"])) if live_meta else "carries no provenance"))
        if s["op"] in ("click", "open_tab") and s["src"].startswith("manifest:") and manifest_text is not None and (s.get("target") or "").lower() not in manifest_text:
            why.append("src_not_live: step %d %r is not in the manifest" % (k, s.get("target")))
        tg = s.get("target") or ""
        # an own-fixture create opener ("New page", "Add model") is allowed exactly as the original-text path allows it
        # (writevocab._CREATE_OPENER); WRITE_NEVER (publish/share/auth/payment/admin/other users) is refused regardless.
        create_ok = s["op"] == "click" and bool(_W._CREATE_OPENER.match(tg)) and not _W._CREATE_OPENER_NOT.search(_W._CREATE_OPENER.match(tg).group("thing"))
        if s["op"] in ("click", "open_tab", "type", "delete_own") and (WRITE_NEVER.search(tg) or (HARD_DENY.search(tg) and not create_ok)):
            why.append("safety: step %d target %r is auth/payment/admin/publish territory" % (k, s.get("target")))
        if lab is not None and s["src"].startswith("live:") and s["op"] in ("click", "open_tab") and _n(s["target"]) not in {_n(x) for x in lab}:
            why.append("src_not_live: step %d %r is not a live label of %s" % (k, s["target"], lens))
    dropped = {d["orig"]: d["reason"] for d in rw.get("dropped") or []}
    for d in dropped:
        if d < 0 or d >= len(raws):
            why.append("dropped_step: %d is not an original step" % d)
    for i in range(len(raws)):
        if i not in covered and i not in dropped:
            why.append("dropped_step: original step %d is neither covered nor listed in dropped" % i)
    seen_spans = set()
    for j, c in enumerate(rw["expected"]):
        srcs = []
        okc = True
        for ref in c["from_orig_clause"]:
            if isinstance(ref, int) and 0 <= ref < len(clauses):
                srcs.append(clauses[ref])
            elif isinstance(ref, str) and re.fullmatch(r"s\d+", ref) and int(ref[1:]) < len(raws) and dropped.get(int(ref[1:])) == "observe_moved_to_expected":
                srcs.append(raws[int(ref[1:])])
            else:
                okc = False
        if not okc or not srcs:
            why.append("added_clause: clause %d points at nothing in the original" % j)
            continue
        src_txt = " ".join(srcs)
        span = c["orig_span"]
        if _n(span) not in _n(src_txt):
            why.append("added_clause: clause %d orig_span is not in the original clause it points at" % j)
            continue
        if (tuple(map(str, c["from_orig_clause"])), _n(span)) in seen_spans:
            why.append("added_clause: clause %d repeats an earlier span" % j)
            continue
        seen_spans.add((tuple(map(str, c["from_orig_clause"])), _n(span)))
        text, r = compile_clause(c, clauses)
        if not text:
            why.append("schema: clause %d %s" % (j, r))
            continue
        kinds = _clause_kinds(text)
        if c["kind"] == "keep":
            if kinds is None:
                why.append("unmappable: clause %d is marked keep but the original is not machine-checkable" % j)
            continue
        if c["kind"] == "needs_human":
            if kinds is not None:
                why.append("unmappable: clause %d is marked needs_human but the original is checkable (use keep)" % j)
            continue
        if kinds != [c["kind"]]:
            why.append("unmappable: clause %d compiles to %r which classifies as %s, not %s" % (j, text, kinds, c["kind"]))
            continue
        a = c["args"]
        nk = _NAME_KINDS.get(c["kind"])
        lits = [x for x in ((a.get(nk) if nk != "names" else a.get("names")) if nk else None) or []] if nk == "names" else ([a.get(nk)] if nk else [])
        if c["kind"] == "text_phrase":
            lits = [a.get("phrase")]
        for lit in lits:
            if lit and not _literal_in(lit, src_txt):
                why.append("literal_not_in_original: clause %d %r" % (j, lit))
        if c["kind"] == "net_status" and not re.search(r"\b%d\b" % a.get("code", 0), src_txt) and not (a.get("neg") and re.search(r"[45]xx|error|fail", src_txt, re.I)):
            why.append("literal_not_in_original: clause %d status %s" % (j, a.get("code")))
        if c["kind"] == "target_size" and not re.search(r"\b%d\b" % a.get("px", 0), src_txt):
            why.append("literal_not_in_original: clause %d size %s" % (j, a.get("px")))
        if c["kind"] == "net_class" and not re.search(r"%sxx|error|fail|request|network" % a.get("cls", "5"), src_txt, re.I):
            why.append("literal_not_in_original: clause %d class" % j)
        anc = KIND_ANCHOR.get(c["kind"])
        if anc and not re.search(anc, src_txt, re.I):
            why.append("literal_not_in_original: clause %d kind %s has no anchor in the original" % (j, c["kind"]))
    # an original expectation is never dropped: every original clause is covered (spans cover its whole text) by rewrite clauses
    _FILLER = {"and", "or", "the", "a", "an", "but", "also", "then", "both"}
    for ci, ctext in enumerate(clauses):
        spans = [c["orig_span"] for c in rw["expected"] if ci in c["from_orig_clause"]]
        left = _n_words(ctext)
        for sp in spans:
            left = _n_words(" ".join(left).replace(" ".join(_n_words(sp)), " ", 1)) if " ".join(_n_words(sp)) in " ".join(left) else left
        if [w for w in left if w not in _FILLER]:
            why.append("dropped_clause: original clause %d is not fully covered by the rewrite" % ci)
    for i, reason in dropped.items():
        if reason == "observe_moved_to_expected" and not any(("s%d" % i) in map(str, c["from_orig_clause"]) for c in rw["expected"]):
            why.append("dropped_step: observe step %d moved to expected but no clause carries it" % i)
    return (not why), why


def _n_words(x):
    return re.findall(r"[a-z0-9]+", (x or "").lower())


# ------------------------------------------------------------------ loading + effective ticket
def load_dir(path=None):
    """{ticket_id: record} from every batch-*.jsonl (a later batch/line wins; a torn line is ignored)."""
    path = path or DEFAULT_DIR
    out = {}
    for f in sorted(glob.glob(os.path.join(path, "batch-*.jsonl"))):
        with open(f, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(d, dict) and d.get("ticket_id"):
                    out[d["ticket_id"]] = d
    return out


def effective_ticket(ticket, rw):
    """A COPY of the ticket whose repro_steps/expected are the rewrite's compiled canonical text. The input is never mutated."""
    steps = [compile_step(s, _R.split_steps(ticket))[0] for s in rw["steps"]]
    clauses = [compile_clause(c, _clauses_of(ticket))[0] for c in rw["expected"]]
    t = dict(ticket)
    t["repro_steps"] = steps
    t["expected"] = "\n".join(clauses)
    t["_rewrite"] = {"source": "rewrite", "orig_hash": rw["orig_hash"], "author": rw["author"], "date": rw["date"], "schema": rw["schema"]}
    return t


def prepare(ticket, index, labels=None, live_meta=None):
    """-> (ticket_to_replay, info). info: {source: original|rewrite|human_only|rewrite_disagrees, reason?, orig_hash?, author?, date?}.
    No record -> the original ticket, unchanged. human_only / disagreeing record -> ticket=None (NEEDS_HUMAN, never replayed)."""
    rw = (index or {}).get((ticket or {}).get("id"))
    if rw is None:
        return ticket, {"source": "original"}
    ok, why = agree(ticket, rw, labels, live_meta=live_meta)
    base = {"orig_hash": rw.get("orig_hash"), "author": rw.get("author"), "date": rw.get("date")}
    if rw.get("status") == "human_only" and check_schema(rw) is None and rw.get("ticket_id") == ticket.get("id"):
        return None, dict(base, source="human_only", reason=rw["human_only_reason"])
    if ok and rw.get("status") == "original_sufficient":
        return ticket, dict(base, source="original_sufficient")
    if not ok:
        return None, dict(base, source="rewrite_disagrees", reason=why[0].split(":")[0], reasons=why[:6])
    return effective_ticket(ticket, rw), dict(base, source="rewrite")


def human_note(info):
    if info["source"] == "human_only":
        return "human_only:%s - the rewrite pass marked this ticket as needing a person; it is not replayed" % info["reason"]
    return "rewrite_disagrees:%s - %s" % (info.get("reason"), "; ".join(info.get("reasons") or [])[:300])
