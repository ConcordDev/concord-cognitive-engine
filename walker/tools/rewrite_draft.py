#!/usr/bin/env python3
"""Drafting helper for the ULW rewrite pass: PROPOSES a rewrite record per ticket; a person reviews every batch and
EVERY record must still pass rewrites.agree() (tools/rewrite_check.py). It only emits ops/kinds the executor knows,
never invents a control name (a click target must be a literal of the original step that also resolves on the lens's
live labels), and leaves anything it cannot map precisely as `needs_human_step` / `needs_human`.

  python3 tools/rewrite_draft.py --batch 001 [--repo ..] [--labels PATH] [--write]      # prints digest; --write saves batch-NNN.jsonl
"""
import argparse, datetime, json, os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "tools"))
from concord_walker import repro, rewrites as R, labels as L, expected as X
from concord_walker.vocab import _LIGHTHOUSE
import rewrite_check as RC

AUTHOR = "sonnet"

_CODE_READ = re.compile(r"(?i)code read|reports/SCOPE|read (?:the )?(?:source|code)|grep (?:the )?(?:built |frontend |server |source |repo )|source inspection|source code|in the (?:source|repo|code)")
_CROSS = re.compile(r"(?i)(?:second|another|two|both) (?:test )?(?:account|accounts)|\b[a-z0-9]+(?:_[a-z0-9]+)*_t2\b|another user'?s (?:profile|private|data|record)|other user'?s (?:profile|private|data|record)|signed[- ]out|incognito|two (?:browser|session)s")
_VISUAL = re.compile(r"(?i)visual check|by eye|visually (?:inspect|check|compare|verify)|looks? (?:right|good|wrong|off|odd)|alignment|colou?r (?:taste|choice)|pixel")
_EVIDENCE_ONLY = re.compile(r"(?i)^\s*see evidence\b\S*\s*$|^\s*see evidence/\S+\s*$")
_SEG = re.compile(r"\s*(?:;|\.\s+|,\s*then\s+|\s+then\s+|\s>\s|\s→\s|\s->\s|,\s+(?=(?:open|click|press|reload|tab|select|type|set)\b))\s*", re.I)
_VP = re.compile(r"(?i)\b390\s*[x×]\s*844\b")
_THEME = re.compile(r"(?i)\b(dark|light)\s+(?:theme|mode)\b")
_ESC = re.compile(r"(?i)^(?:then\s+|and\s+)?(?:press|hit)\s+(?:the\s+)?esc(?:ape)?(?:\s*(?:x\s*(\d)|(once|twice)))?(?:\s+again)?[.]?$")
_RELOAD = re.compile(r"(?i)^(?:then\s+)?(?:hard\s+)?(?:reload|refresh)(?:\s+the\s+page)?[.]?$")
_TABTOP = re.compile(r"(?i)^tab\s+from\s+(?:the\s+)?top(?:\s+of\s+(?:the\s+)?page)?[.]?$")
_CLICK = re.compile(r"(?i)^(?:then\s+)?(?:click|open|tap)\s+(?:the\s+)?(?:[\"'‘“](?P<q>[^\"'’”]{1,60})[\"'’”]|(?P<u>[A-Z][A-Za-z0-9&'/\-]*(?:\s+[A-Za-z0-9&'/\-]+){0,3}?))(?:\s+(?:button|tab|link|menu|control|icon))?[.]?$")
_TYPE = re.compile(r"(?i)^(?:type|enter|put|input)\s+(?P<v>-?\d[\d.,]*|[\"'‘“][^\"'’”]{1,60}[\"'’”])\s+(?:in|into)\s+(?:the\s+)?(?P<f>[A-Za-z][A-Za-z ]{0,30}?)(?:\s+(?:field|input|box))?[.]?$")


def _lab(labels, lens):
    return (labels or {}).get(lens) or []


_PFX = re.compile(r"(?i)^(?:on\s+(?:/lenses/[a-z0-9\-/]+\s+)?(?:as\s+)?[a-z0-9]+(?:_[a-z0-9]+)*_t1(?:\s*\([^)]*\))?\s*,\s*|on\s+(?:the\s+)?/lenses/[a-z0-9\-/]+\s*(?:as\s+[a-z0-9]+(?:_[a-z0-9]+)*_t1\s*(?:\([^)]*\))?)?\s*,\s*)")
_OPENLENS = re.compile(r"(?i)^(?:then\s+)?open\s+(?:https?://[^/\s]+)?(?P<u>/lenses/[a-z0-9\-/]+)(?P<rest>.*)$")
_VPWORDS = re.compile(r"(?i)\b(?:in|with)?\s*(?:chrome\s+)?devtools\b|\bdevice\s+(?:toolbar|mode)\b|\bresponsive\b|\bset\b|\bat\b|\bdimensions:?|\bofficial\b|\bviewport\b|\b100%|\b390\s*[x×]\s*844\b|~|[(),.:]|\bmobile\b|\bwidth\b")
_ARROWS = re.compile(r"(?i)^press\s+(?P<k>(?:left|right|up|down)(?:\s*(?:/|,|and)\s*(?:left|right|up|down))*)\s+arrow(?:\s+keys?)?$")
_EXPORTFMT = re.compile(r"(?i)^(?:use\s+|click\s+|open\s+)?(?:the\s+)?(?:lens\s+|header\s+|row\s+)?export\s+(?P<f>json|csv|pdf|ics)(?:\s*(?:/|and|,)\s*(?P<g>json|csv|pdf|ics))?$")


def convert_step(raw, lens, labels):
    """An UNMAPPED original step -> a list of rewrite steps (no from_orig yet) or None (stays needs_human_step)."""
    raw = _PFX.sub("", raw.strip())
    segs = [s.strip() for s in _SEG.split(raw) if s and s.strip()]
    out = []
    for sg in segs:
        sg = sg.strip(" .")
        m0 = _OPENLENS.match(sg)
        if m0:
            if m0.group("u").split("/lenses/")[-1].split("/")[0] != lens.split("/")[0]:
                return None
            out.append({"op": "open", "target": m0.group("u"), "src": "text"})
            sg = m0.group("rest").strip(" .,")
            if not sg:
                continue
        if _VP.search(sg) and not _VPWORDS.sub(" ", sg).strip():
            out.append({"op": "viewport", "target": "390x844", "src": "text"})
        elif _ARROWS.match(sg):
            for k in re.findall(r"(?i)left|right|up|down", _ARROWS.match(sg).group("k")):
                out.append({"op": "press", "target": "Arrow" + k.capitalize(), "src": "text"})
        elif _EXPORTFMT.match(sg):
            m = _EXPORTFMT.match(sg)
            for f in (m.group("f"), m.group("g")):
                if f:
                    out.append({"op": "export", "target": f.upper(), "src": "text"})
        elif _THEME.fullmatch(sg) or re.fullmatch(r"(?i)(?:switch to |set |use )?(dark|light) (?:theme|mode)", sg):
            out.append({"op": "scheme", "target": _THEME.search(sg).group(1).lower(), "src": "text"})
        elif _ESC.match(sg):
            m = _ESC.match(sg)
            n = int(m.group(1)) if m.group(1) else (2 if (m.group(2) or "").lower() == "twice" else 1)
            out.append({"op": "press", "target": "Escape", "count": n, "src": "text"})
        elif _RELOAD.match(sg):
            out.append({"op": "reload", "src": "text"})
        elif re.fullmatch(r"(?i)(?:then\s+)?(?:(?:hard\s+)?reload\s+)?(?:with\s+|check\s+|open\s+)?(?:the\s+)?(?:devtools\s+)?console(?:\s+open)?", sg):
            out.append({"op": "console", "src": "text"})
        elif re.fullmatch(r"(?i)(?:then\s+)?(?:(?:hard\s+)?reload\s+)?(?:with\s+|check\s+|open\s+)?(?:the\s+)?(?:devtools\s+)?network(?:\s+(?:tab|panel|log))?(?:\s+open)?", sg):
            out.append({"op": "network", "src": "text"})
        elif _TABTOP.match(sg):
            out.append({"op": "tab_sweep", "src": "text"})
        elif _TYPE.match(sg):
            m = _TYPE.match(sg)
            out.append({"op": "type", "target": m.group("f").strip(), "value": m.group("v").strip("\"'‘“’”"), "src": "text"})
        elif _CLICK.match(sg):
            m = _CLICK.match(sg)
            name = (m.group("q") or m.group("u") or "").strip()
            res = L.resolve(name, _lab(labels, lens)) if name else None
            if not res or res["status"] not in (L.EXACT, L.ALIAS):
                return None            # a control we cannot find on the live lens is never invented
            out.append({"op": "click", "target": res["label"], "src": "live:%s" % lens})
        elif len(segs) > 1 and 1 <= len(sg) <= 40 and (L.resolve(sg, _lab(labels, lens))["status"] in (L.EXACT, L.ALIAS)):
            out.append({"op": "click", "target": L.resolve(sg, _lab(labels, lens))["label"], "src": "live:%s" % lens})   # a crumb: a live label, exactly
        else:
            return None
    return out or None


# whole-clause patterns -> (kind, args). The span is the WHOLE clause, so nothing in it is left unchecked.
_CLAUSE_RULES = [
    (re.compile(r"(?i)^(?:keyboard\s+)?focus\s+(?:remains|stays)\s+(?:inside|within|in)\s+(?:the\s+)?(?:open\s+)?(?:modal|dialog|popover|drawer|menu)$"), "focus_trap", {}),
    (re.compile(r"(?i)^focus\s+(?:is\s+)?trapped(?:\s+in\s+the\s+(?:dialog|modal|menu|popover|drawer))?$|^trapped$"), "focus_trap", {}),
    (re.compile(r"(?i)^when\s+the\s+tablist\s+is\s+focused,?\s+left\s+and\s+right\s+arrows\s+move\s+(?:focus\s+)?between\s+tabs$"), "arrow_moves", {}),
    (re.compile(r"(?i)^(?:>=|≥)\s*4\.5\s*:\s*1$"), "contrast", {}),
    (re.compile(r"(?i)^(?:no|zero)\s+(?:new\s+)?console\s+errors?$"), "no_console_error", {}),
    (re.compile(r"(?i)^(?:the\s+)?(?:field|item|row|entry|record|task|event|note)\s+(?:is\s+)?listed\s+(?:immediately|right away)$|^(?:field|item|row|entry|record|task|event|note)\s+listed\s+immediately$"), "appears_in_list", {}),
    (re.compile(r"(?i)^(?:the\s+)?(?:new\s+)?(?:item|row|entry|record|task|event|note|project|reminder)\s+(?:is\s+)?(?:created|added)$"), "item_created", {}),
]


def convert_clause(text):
    t = text.strip(" .")
    for rx, kind, args in _CLAUSE_RULES:
        if rx.match(t):
            return [{"kind": kind, "args": dict(args), "orig_span": text.strip(" .")}]
    return None


def human_only(ticket, raws, clauses):
    blob = " ".join(raws + clauses)
    if any(_EVIDENCE_ONLY.match(r) for r in raws) and len(raws) == len([r for r in raws if _EVIDENCE_ONLY.match(r)]):
        return "other_with_note", "repro_steps is only a pointer to an evidence file; there is no step text to map"
    if _LIGHTHOUSE.search(blob):
        return "lighthouse", None
    if _CODE_READ.search(blob):
        return "code_read", None
    if _CROSS.search(blob):
        return "cross_account", None
    if _VISUAL.search(blob):
        return "visual", None
    return None, None


def draft(ticket, labels, date):
    raws = repro.split_steps(ticket)
    clauses = X.split_clauses(ticket.get("expected"))
    rec = {"ticket_id": ticket["id"], "lens": ticket["lens"], "fold_sha": R.FOLD_SHA, "orig_hash": R.orig_hash(ticket),
           "author": AUTHOR, "date": date, "schema": R.SCHEMA}
    reason, note = human_only(ticket, raws, clauses)
    if reason:
        rec.update(status="human_only", human_only_reason=reason)
        if note:
            rec["note"] = note
        return rec
    steps = []
    for i, raw in enumerate(raws):
        e = repro.expand_step(raw, ticket["lens"])
        if e["mapped"]:
            steps.append({"op": "keep", "src": "text", "from_orig": [i]})
            continue
        conv = convert_step(raw, ticket["lens"], labels)
        if conv:
            for c in conv:
                steps.append(dict(c, from_orig=[i]))
        else:
            steps.append({"op": "needs_human_step", "src": "text", "from_orig": [i]})
    exp = []
    for j, c in enumerate(clauses):
        if X.classify_clause(c, repro._check_legacy) is not None:
            exp.append({"kind": "keep", "args": {}, "from_orig_clause": [j], "orig_span": c})
            continue
        conv = convert_clause(c)
        if conv:
            for k in conv:
                exp.append(dict(k, from_orig_clause=[j]))
        else:
            exp.append({"kind": "needs_human", "args": {}, "from_orig_clause": [j], "orig_span": c})
    rec.update(status="rewritten", steps=steps, dropped=[], expected=exp)
    return rec


def finalize(ticket, rec, labels):
    """Run agree(); any disagreement -> downgrade each bad converted step/clause to the verbatim form, then re-check."""
    if rec["status"] == "human_only":
        return rec, R.check_schema(rec) is None, []
    ok, why = R.agree(ticket, rec, labels)
    if ok:
        return rec, ok, why
    # fall back to the all-verbatim rewrite (keep / needs_human_step / keep / needs_human): always faithful
    raws = repro.split_steps(ticket)
    clauses = X.split_clauses(ticket.get("expected"))
    rec["steps"] = [{"op": "keep" if repro.expand_step(r, ticket["lens"])["mapped"] else "needs_human_step", "src": "text", "from_orig": [i]} for i, r in enumerate(raws)]
    rec["expected"] = [{"kind": "keep" if X.classify_clause(c, repro._check_legacy) is not None else "needs_human", "args": {}, "from_orig_clause": [j], "orig_span": c} for j, c in enumerate(clauses)]
    ok2, why2 = R.agree(ticket, rec, labels)
    return rec, ok2, why + ["(fell back to verbatim)"] + why2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", type=int, required=True)
    ap.add_argument("--repo", default="..")
    ap.add_argument("--sha", default=R.FOLD_SHA)
    ap.add_argument("--labels", default=RC.DEFAULT_LABELS)
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    pool = RC.pool_of(a.repo, a.sha)
    labels = RC.load_labels(a.labels)
    out, conv_steps, conv_clauses, fell = [], 0, 0, 0
    for t in RC.batch_tickets(pool, a.batch):
        rec, ok, why = finalize(t, draft(t, labels, a.date), labels)
        if not ok:
            print("UNRESOLVED", t["id"], why[:3])
        if any("fell back" in w for w in why):
            fell += 1
            print("  fallback", t["id"], why[0][:200])
        conv_steps += sum(1 for s in rec.get("steps", []) if s["op"] not in ("keep", "needs_human_step"))
        conv_clauses += sum(1 for c in rec.get("expected", []) if c["kind"] not in R.VERBATIM_KINDS)
        out.append(rec)
    print("batch %03d: %d records, human_only=%d, converted steps=%d, converted clauses=%d, fallbacks=%d" % (
        a.batch, len(out), sum(1 for r in out if r["status"] == "human_only"), conv_steps, conv_clauses, fell))
    if a.write:
        os.makedirs(R.DEFAULT_DIR, exist_ok=True)
        with open(os.path.join(R.DEFAULT_DIR, "batch-%03d.jsonl" % a.batch), "w", encoding="utf-8") as f:
            for r in out:
                f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
        pp = os.path.join(R.DEFAULT_DIR, "PROGRESS.json")
        prog = json.load(open(pp)) if os.path.exists(pp) else {}
        prog["%03d" % a.batch] = {"tickets": len(out), "rewritten": sum(1 for r in out if r["status"] == "rewritten"),
                                  "human_only": sum(1 for r in out if r["status"] == "human_only"), "committed_sha": None}
        json.dump(prog, open(pp, "w"), indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
