"""Write-mode vocabulary (ULW pass 2, scopes b + c): typed test values, create / fill / submit, delete of the
walker's OWN fixture, and generic "open a <thing>" targets.

map_part() routes ONE segment of a step to a sub-step, exactly like vocab.map_part (NOT_MINE when it is not
this vocabulary). Mapping only says "this segment is a typed value / create / delete / open-first"; whether it
may RUN is decided at execution time in repro.run_repro, with the same policy as every other write:

  * type_value / fill_label / submit_form / delete_own need --allow-write, a non-admin account and a lens that
    is not write-skip; otherwise the step is mapped-but-refused (NEEDS_HUMAN, reason named);
  * type_value goes only into a field of a form the walker opened in this ticket (a create opener it clicked) or
    of its own created fixture, and never into auth / password / payment / billing / role / admin / account
    / publish / share fields (FIELD_NEVER, which extends safety.WRITE_NEVER);
  * a boundary value is the ticket's own literal ("-1", "0", a quoted string) or a generated string of the
    stated length ("300-char name"); a multi-value ("0 or -1") is a bounded fan-out, each value recorded;
  * delete_own only deletes a fixture THIS ticket/run created (row-scoped), never anything else.
"""
import re

NOT_MINE = object()
MAX_VALUES = 4
MAX_LEN = 5000

# Fields the walker never types into, even on its own form (auth / money / identity / outward-facing / authority).
FIELD_NEVER = re.compile(r"(?i)\b(pass(?:word|code|phrase)?|pin|otp|2fa|mfa|secret|token|api[\s_-]*key|private[\s_-]*key|seed phrase|credential\w*|"
                         r"card|cvv|cvc|iban|routing|account(?:\s+number)?|billing|payment|pay|price id|invoice|payout|wallet|"
                         r"user\s*name|e-?mail|phone|address|role|permission|admin\w*|sudo|owner|"
                         r"publish\w*|share|public|visibility|invite|recipient|send to|to:|dm)\b")

_NUM = r"[-+]?\d[\d,]*(?:\.\d+)?%?"
_QSTR = r"[\"'‘“`][^\"'’”`]{0,200}[\"'’”`]"
_LIT = r"(?:" + _NUM + r"|" + _QSTR + r"|\d{2,5}\s*-?\s*char(?:acter)?s?(?:\s*-?\s*long)?(?:\s+(?:name|title|label|text|description|message|note|comment|value|string))?)"
_LITLIST = r"(?P<lits>" + _LIT + r"(?:\s*(?:/|,|\bor\b|\band\b)\s*" + _LIT + r")*)"
_FIELDS = r"(?P<f>[A-Za-z][A-Za-z0-9 /\-+%]{0,40}?)"
_TYPE_IN = re.compile(r"(?i)^(?:type|enter|put|input|set|paste|write|fill(?:\s+in)?)\s+(?:an?\s+)?" + _LITLIST + r"\s+(?:in|into|to|for|as)\s+(?:the\s+)?" + _FIELDS + r"(?:\s+(?:field|input|box))?$")
_TYPE_BARE = re.compile(r"(?i)^(?:type|enter|put|input|paste|write)\s+(?:an?\s+)?" + _LITLIST + r"$")
_CLEAR = re.compile(r"(?i)^clear\s+(?:the\s+)?(?P<f>[A-Za-z][A-Za-z0-9 /\-+%]{0,30}?)(?:\s+(?:field|input|box))?$")
_CLEAR_NOT = re.compile(r"(?i)\b(all|filters?|history|cache|data|everything|selection|list|board|canvas|chat|log|search|results?|completed|notifications?|cart|queue)\b")
_LEAVE = re.compile(r"(?i)^leave\s+(?:the\s+)?(?P<f>[A-Za-z][A-Za-z0-9 /\-+%]{0,30}?)\s+(?:blank|empty)$")
_SUBMIT_WITH_EMPTY = re.compile(r"(?i)^(?P<v>submit|save|add|create|post)\s+with\s+(?:an?\s+)?(?:empty|blank)\s+(?P<f>[A-Za-z][A-Za-z0-9 /\-]{0,30})$")
_FILL = re.compile(r"(?i)^(?:fill(?:\s+(?:in|out))?|complete)(?:\s+(?:the|a|all|required))?(?:\s+(?:form|fields?|required fields?|details|dialog))?$|^(?:enter|type)\s+(?:a\s+|the\s+)?(?:title|name)$")
_SUBMIT = re.compile(r"(?i)^(?:then\s+)?(?:click\s+|press\s+|tap\s+|hit\s+)?(?P<v>submit|save|add|create|post|schedule|apply|done|confirm)(?:\s+(?:form|it|the form|the new \w+))?$")
_CREATE_OPENER = re.compile(r"(?i)^(?:click\s+|tap\s+|open\s+)?(?:\+\s*)?(?P<v>new|create|add)\s+(?:an?\s+|the\s+)?(?P<thing>[A-Za-z][A-Za-z\-]*(?:\s+[A-Za-z\-]+){0,2})$")
_CREATE_OPENER_NOT = re.compile(r"(?i)\b(with|and|or|in|on|for|to|from|at|of|that|then|which|when|if|a|an|the|all|each|every|dated|named|called|using|over)\b")
_JOINLEAVE = re.compile(r"(?i)^(?P<v>join|leave)(?:\s+(?:an?\s+|the\s+)?(?P<thing>[A-Za-z][A-Za-z0-9\-]*))?$")
_DELETE = re.compile(r"(?i)^(?:click\s+|tap\s+|press\s+|use\s+)?(?:the\s+)?(?:row\s+)?(?P<v>delete|remove|trash)(?:\s+(?:icon|button|control))?"
                     r"(?:\s+(?:on|for|the|a|an|that|this|own|my|qa|created|new|test))*(?:\s+(?P<thing>[A-Za-z][A-Za-z0-9\-]*(?:\s+[A-Za-z0-9\-]+){0,2}?))?"
                     r"(?:\s+(?:once|when done|afterwards?|at the end|to clean up))?$")
_DELETE_NOT = re.compile(r"(?i)\b(all|every|each|and|or|then|with|without|key|account|data|everything|workspace|org|group|user|member|role|permission|plan|subscription|drop|relations?)\b")
_OPEN_FIRST = re.compile(r"(?i)^(?:open|select|click|pick|choose|view|expand)\s+(?:on\s+)?(?:(?:an?|any|one|another|the first|first)\s+(?:existing\s+)?)(?P<thing>[a-z][a-z0-9\-]*(?:\s+[a-z0-9\-]+){0,2})$")
_OPEN_FIRST_THINGS = re.compile(r"(?i)\b(task|row|item|card|entry|record|project|proposal|debate|goal|thread|reply|post|listing|artwork|work|spot|detail|session|case|event|note|chain|node|experiment|dataset|track|engagement|job|vehicle|scene|story|document|doc)s?\b")
_OPEN_FIRST_NOT = re.compile(r"(?i)\b(tab|menu|link|button|setting|settings|setting|profile|user|account|admin|payment|plan|billing|share|publish|another user)\b")


_FIELD_LIT = re.compile(r"(?i)^(?:set\s+)?(?P<f>(?!(?:open|click|select|go|view|tab|press|run|add|create|new|log|pledge|enter|type|use|toggle|switch|choose|pick|save|submit|delete|remove|reload|focus|expand)\b)[A-Za-z][A-Za-z ]{0,25}?)\s+" + _LITLIST + r"$")
_FIELD_TO = re.compile(r"(?i)^set\s+(?:the\s+)?(?P<f>[A-Za-z][A-Za-z ]{0,25}?)\s+(?:to|=)\s+" + _LITLIST + r"$")
_COMPOUND_SPLIT = re.compile(r"(?i)\s*(?:;|,|\s+then\s|\s+and\s)\s*(?=(?:type|enter|paste|set|leave|clear|submit|save|create|add|post|new)\b|[A-Za-z][A-Za-z ]{0,25}?\s+[-+]?\d|[-+]?\d)")
_SUBMIT_OR = re.compile(r"(?i)^(submit|save|create|add|post)\s+or\s+[a-z]+$")
_SUBMIT_EMPTY = re.compile(r"(?i)^submit\s+(?:with\s+)?(?:empty|blank)(?:\s+(?:fields?|form|values?))?$")
_ADD_WITH = re.compile(r"(?i)^(?P<v>add|create|new)\s+(?:an?\s+)?(?P<thing>[A-Za-z][A-Za-z\-]*(?:\s+[A-Za-z\-]+)?)\s+with\s+(?:an?\s+)?(?:(?P<n>\d{2,5})\s*-?\s*char(?:acter)?s?\s+(?P<fn>name|title|label|description)|(?:empty|blank)\s+(?P<fe>name|title|label))$")


def _boundary(spec):
    if spec["kind"] == "length":
        return True
    v = spec["value"]
    return bool(re.match(r"^[-+]", v) or re.match(r"^0+(?:\.0+)?%?$", v) or re.match(r"^\d{6,}", v) or re.search(r"[A-Za-z]", v))


def _split_fields(f):
    """'Qty / Price' -> ['Qty', 'Price']. A shorthand like 'plot x/z' (a bare letter that is not itself a field name)
    is ambiguous: [] is returned so the caller leaves the step unmapped (fail closed) instead of typing into a guessed 'z'."""
    out = [x.strip() for x in re.split(r"\s*(?:/|,|\band\b)\s*", f) if x and x.strip()]
    if len(out) > 1 and any(len(x) < 2 for x in out):
        return []
    return out


def literal_values(lits):
    """'0 or -1' / "'bad'" / '300-char name' -> [{'kind': 'literal'|'length', 'value'|'n'}] (bounded)."""
    out = []
    for tok in re.split(r"\s*(?:/|,|\bor\b|\band\b)\s*(?=" + _LIT + r")", lits.strip()):
        t = tok.strip()
        if not t:
            continue
        m = re.match(r"(?i)^(\d{2,5})\s*-?\s*char", t)
        if m:
            n = int(m.group(1))
            out.append({"kind": "length", "n": min(n, MAX_LEN)})
            continue
        q = re.match(r"^[\"'‘“`]([^\"'’”`]*)[\"'’”`]$", t)
        out.append({"kind": "literal", "value": q.group(1) if q else t})
    return out[:MAX_VALUES]


def field_refusal(name):
    """Reason string when `name` is a field the walker never types into, else None."""
    m = FIELD_NEVER.search(name or "")
    if m:
        return "field %r is an auth/payment/billing/role/admin/account/publish/share field (writevocab.FIELD_NEVER: %r) - never typed into" % (name, m.group(1))
    return None


def build_value(spec, label_base):
    """spec -> the literal string typed. A 'length' spec is the walker's own label padded to exactly n chars."""
    if spec["kind"] == "length":
        n = min(int(spec["n"]), MAX_LEN)
        base = (label_base or "qa-walker") + "-"
        return (base + "x" * n)[:n] if n >= len(base) else "x" * n
    return spec["value"]


def _tv(fields, specs, raw, **extra):
    return [dict({"action": "type_value", "name": f, "specs": specs, "raw": raw}, **extra) for f in fields]


def map_part(seg, raw, lens_names, prev=None, _depth=0):
    """-> list[sub-step] | (None, reason) | NOT_MINE."""
    s = seg.strip().rstrip(".").strip()
    if not s:
        return NOT_MINE
    got = _map_single(s, raw, lens_names, prev)
    if got is not NOT_MINE or _depth:
        return got
    return _compound(s, raw, lens_names, prev)


def _compound(s, raw, lens_names, prev):
    """Pass 3: 'type -1 into Qty, submit' / 'Create form, leave note blank' / 'Duration -1, Quorum -1; Create'.
    Split into clauses and map EACH through the single-clause grammar; the whole step maps only if EVERY clause does
    (one unmapped clause -> NOT_MINE, the step stays unmapped: fail closed, never a partial guess)."""
    parts = [x for x in _COMPOUND_SPLIT.split(s) if x and x.strip()]
    if len(parts) < 2 or len(parts) > 6:
        return NOT_MINE
    out, cur = [], prev
    for part in parts:
        part = part.strip().rstrip(".").strip()
        if _SUBMIT_EMPTY.match(part):
            return NOT_MINE   # an empty submit needs the executor to NOT auto-label; unsupported -> stays unmapped
        mo = _SUBMIT_OR.match(part)
        if mo:
            part = mo.group(1)
        got = _map_single(part, raw, lens_names, cur)
        if got is NOT_MINE or isinstance(got, tuple) or not got:
            return NOT_MINE
        out += got
        cur = got[-1]
    return out


_MAKE_LEN = re.compile(r"(?i)^(?:create|add|make|new)\s+(?:an?\s+)?(?P<n>\d{2,5})\s*-?\s*char(?:acter)?s?\s+(?:long\s+)?(?P<f>name|title|label|description|text|note)$")
_BARE_LIT = re.compile(r"^" + _LITLIST + r"$")


_WITH_FIELDS = re.compile(r"(?i)^(?:[A-Z][A-Za-z ]{0,20}:\s+)?(?P<v>add|create|new|register)\s+(?:an?\s+)?(?:(?P<thing>[A-Za-z][A-Za-z\-]*(?:\s+[A-Za-z\-]+)?)\s+)?with\s+(?P<rest>.+)$")
_WITH_ITEM_LEN = re.compile(r"(?i)^(?:an?\s+)?(?P<n>\d{2,5})\s*-?\s*char(?:acter)?s?\s+(?P<f>[A-Za-z][A-Za-z ]{0,20})$")
_WITH_ITEM_EMPTY = re.compile(r"(?i)^(?:an?\s+)?(?:empty|blank)\s+(?P<f>[A-Za-z][A-Za-z ]{0,20})$")
_WITH_ITEM_VAL = re.compile(r"(?i)^(?P<f>[A-Za-z][A-Za-z ]{0,20}?)\s+(?P<lit>[-+]?\d[\d,]*(?:\.\d+)?)$")


def _with_fields(m, raw):
    items = [x.strip() for x in re.split(r"\s*(?:/|,(?!\d))\s*", m.group("rest").rstrip(". ")) if x and x.strip()]
    if not items or len(items) > 4:
        return NOT_MINE
    steps = []
    for it in items:
        mm = _WITH_ITEM_LEN.match(it)
        if mm:
            steps.append((mm.group("f").lower().strip(), {"kind": "length", "n": min(int(mm.group("n")), MAX_LEN)}))
            continue
        mm = _WITH_ITEM_EMPTY.match(it)
        if mm:
            steps.append((mm.group("f").lower().strip(), {"kind": "literal", "value": ""}))
            continue
        mm = _WITH_ITEM_VAL.match(it)
        if mm:
            sp = {"kind": "literal", "value": mm.group("lit")}
            if _boundary(sp):
                steps.append((mm.group("f").strip(), sp))
                continue
        return NOT_MINE          # any item that is not a recognised typed value -> the whole step stays unmapped
    thing = (m.group("thing") or "").strip()
    if _OPEN_FIRST_NOT.search(thing) or _CLEAR_NOT.search(thing):
        return NOT_MINE
    out = [{"action": "click", "name": ("%s %s" % (m.group("v").title(), thing)).strip(), "raw": raw, "create_opener": True}]
    for f, sp in steps:
        out += _tv([f], [sp], raw, hint=True, clear=(sp["kind"] == "literal" and sp["value"] == ""))
    return out


def _map_single(s, raw, lens_names, prev=None):
    m = _WITH_FIELDS.match(s)
    if m:
        got = _with_fields(m, raw)
        if got is not NOT_MINE:
            return got
    m = _MAKE_LEN.match(s)
    if m:
        return _tv([m.group("f").lower()], [{"kind": "length", "n": min(int(m.group("n")), MAX_LEN)}], raw, hint=True)
    m = _BARE_LIT.match(s)     # 'Set tempo to 0, then 999': the next bare value goes into the SAME field as the previous typed value
    if m and prev and prev.get("action") == "type_value" and prev.get("name"):
        specs = literal_values(m.group("lits"))
        if specs:
            return _tv([prev["name"]], specs, raw)
    m = _FIELD_TO.match(s)
    if m and not _CLEAR_NOT.search(m.group("f")):
        specs = literal_values(m.group("lits"))
        if specs and all(_boundary(x) for x in specs) and len(m.group("f").split()) <= 3:
            return _tv([m.group("f").strip()], specs, raw)
    m = _TYPE_IN.match(s)
    if m:
        specs = literal_values(m.group("lits"))
        fields = _split_fields(m.group("f"))
        if specs and fields and len(fields) <= 3 and not re.search(r"(?i)\b(?:and|then|press|click)\b", m.group("f")):
            return _tv(fields, specs, raw)
    m = _TYPE_BARE.match(s)
    if m:
        specs = literal_values(m.group("lits"))
        spec_len = any(x["kind"] == "length" for x in specs)
        if (len(specs) == 1 and specs[0]["kind"] == "literal" and prev and prev.get("name") and re.search(r"(?i)search|filter|find|query", prev["name"])
                and re.match(r"^[\"'‘“]", m.group("lits").strip())):
            return NOT_MINE        # a quoted literal into a search/filter field stays the pass-1 read-only 'fill'
        if specs and prev and prev.get("action") in ("type_value", "click", "open_tab", "fill") and prev.get("name"):
            return _tv([prev["name"]], specs, raw)
        if specs and spec_len:
            nm = re.search(r"(?i)\b(name|title|label|text|description|message|note|comment|value|string)\b", m.group("lits"))
            if nm:
                return _tv([nm.group(1).lower()], specs, raw, hint=True)
        return (None, "typed value %r has no field the step names" % s[:40]) if specs else NOT_MINE
    m = _ADD_WITH.match(s)
    if m and not _OPEN_FIRST_NOT.search(m.group("thing")):
        fld = (m.group("fn") or m.group("fe")).lower()
        spec = ({"kind": "length", "n": min(int(m.group("n")), MAX_LEN)} if m.group("n") else {"kind": "literal", "value": ""})
        return [{"action": "click", "name": "%s %s" % (m.group("v").title(), m.group("thing").strip()), "raw": raw, "create_opener": True},
                dict(_tv([fld], [spec], raw, hint=True, clear=not m.group("n"))[0])]
    m = _FIELD_LIT.match(s)
    if m and not _CLEAR_NOT.search(m.group("f")):
        specs = literal_values(m.group("lits"))
        if specs and all(_boundary(x) for x in specs) and len(m.group("f").split()) <= 3:
            return _tv([m.group("f").strip()], specs, raw)
    m = _CLEAR.match(s)
    if m and not _CLEAR_NOT.search(m.group("f")):
        fl = _split_fields(m.group("f"))
        return _tv(fl[:3], [{"kind": "literal", "value": ""}], raw, clear=True) if fl else NOT_MINE
    m = _LEAVE.match(s)
    if m:
        fl = _split_fields(m.group("f"))
        return _tv(fl[:3], [{"kind": "literal", "value": ""}], raw, clear=True) if fl else NOT_MINE
    m = _SUBMIT_WITH_EMPTY.match(s)
    if m and not _split_fields(m.group("f")):
        return NOT_MINE
    if m:
        return _tv(_split_fields(m.group("f"))[:2], [{"kind": "literal", "value": ""}], raw, clear=True) + [{"action": "submit_form", "verb": m.group("v").lower(), "raw": raw}]
    if _FILL.match(s):
        return [{"action": "fill_label", "raw": raw}]
    m = _SUBMIT.match(s)
    if m:
        return [{"action": "submit_form", "verb": m.group("v").lower(), "raw": raw}]
    m = _DELETE.match(s)
    if m and not _DELETE_NOT.search(s):
        thing = (m.group("thing") or "").strip()
        if not re.match(r"(?i)^(?:and|or|when|once|to)\b", thing):
            return [{"action": "delete_own", "verb": m.group("v").lower(), "thing": thing or None, "raw": raw}]
    m = _CREATE_OPENER.match(s)
    if m and not _CREATE_OPENER_NOT.search(m.group("thing")) and not _OPEN_FIRST_NOT.search(m.group("thing")):
        nm = "%s %s" % (m.group("v").title(), m.group("thing").strip())
        return [{"action": "click", "name": nm, "raw": raw, "create_opener": True}]
    m = _JOINLEAVE.match(s)
    if m:
        nm = m.group("v").title() + ((" " + m.group("thing")) if m.group("thing") else "")
        return [{"action": "click", "name": nm, "raw": raw}]
    m = _OPEN_FIRST.match(s)
    if m and _OPEN_FIRST_THINGS.search(m.group("thing")) and not _OPEN_FIRST_NOT.search(m.group("thing")):
        return [{"action": "open_first", "thing": m.group("thing").strip(), "raw": raw}]
    return NOT_MINE


def expand_fanout(flat):
    """type_value with several values -> one typed run per value; the rest of the SAME ticket step (e.g. 'save')
    is replayed after each value so each value is judged on its own. Bounded (MAX_VALUES values)."""
    out, i = [], 0
    while i < len(flat):
        x = flat[i]
        if x.get("action") == "type_value" and len(x.get("specs") or []) > 1:
            tail = []
            j = i + 1
            while j < len(flat) and flat[j].get("step") == x.get("step") and flat[j].get("action") != "type_value":
                tail.append(flat[j])
                j += 1
            for k, sp in enumerate(x["specs"]):
                out.append(dict(x, specs=[sp], fan=k + 1, fan_of=len(x["specs"])))
                out += [dict(t, repeated=True) if k else t for t in tail]
            i = j
            continue
        out.append(x)
        i += 1
    return out
