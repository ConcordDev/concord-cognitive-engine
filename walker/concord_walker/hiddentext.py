"""Hidden-text scanner (WALK-04g, GB-1544 plan item U15).

Finds text that sits in the DOM but is not visible to a sighted user —
the shape of AI-directed prompt-injection strings planted in catalog /
feed data and of harness or seed text leaking into a live surface — and
separately reports harness-pattern text that IS visible (test data on
live). All reads are DevTools-protocol (DOMSnapshot); no page JavaScript,
per the walker's safe-mode rules.

Snapshot parsing mirrors checks.contrast_from_snapshot's idiom exactly
(same document/strings handling, same style-index order as
cdp.Cdp.snapshot's computedStyles request, same ancestor walks), so the
two analyses read a snapshot the same way.

Verdict vocabulary stays the walker's: callers map findings onto
FIXED / STILL_FAILING / NEEDS_HUMAN. This module never decides a ticket
on its own beyond returning findings; visible text is NEVER reported as
a hidden finding.
"""
import re

from . import colors

# Style order for THIS module's own capture (a superset of
# cdp.Cdp.snapshot's list: adds text-indent for the off-screen class).
STYLES = ["color", "background-color", "background-image", "font-size",
          "font-weight", "opacity", "visibility", "display", "position",
          "overflow-x", "text-indent"]
COLOR, BG, BGIMG, FS, FW, OP, VIS, DISP, POS, OVX, TIND = range(len(STYLES))

# When a snapshot arrives from cdp.Cdp.snapshot() (10 styles, no
# text-indent), style rows are shorter; indices beyond the row read "".
_FALLBACK_STYLES = 10

EXCLUDED_ANCESTORS = {"SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "HEAD",
                      "TITLE", "META", "LINK"}

# AI-directed phrasing + harness strings. Each entry: (name, regex).
# These are matched against HIDDEN text for the injection finding and
# against VISIBLE text for the test-data-on-live finding.
HARNESS_PATTERNS = [
    ("ai_directive", re.compile(
        r"(?i)\b(ignore|disregard|forget)\b[^.]{0,60}\b(instruction|prompt|above|previous)\b"
        r"|\b(dear|attention|note to)\b[^.]{0,30}\b(ai|assistant|model|llm|agent)\b"
        r"|\b(ai|assistant|language model|llm)\b[^.]{0,40}\b(should|must|please)\b[^.]{0,60}\b(recommend|say|output|respond|reply|promote|rank)\b"
        r"|\bsystem prompt\b|\bprompt injection\b")),
    ("harness_label", re.compile(
        r"(?i)\bqa[-_ ]?walker\b|\bharness (value|data|text|string|row|fixture)\b"
        r"|\btzl[0-9a-z]{6,}\b|\btest[-_ ]?harness\b|\bfixture (row|data|text)\b")),
    ("seed_placeholder", re.compile(
        r"(?i)\blorem ipsum\b|\b(sample|seed|demo) (data|content|record|entry)\b"
        r"|\bplaceholder (text|content)\b")),
]

# A colour pair whose WCAG ratio is this close to 1 is the same colour
# for reading purposes (ratio exactly 1 = identical).
SAME_COLOUR_MAX_RATIO = 1.05
# Opacity at or below this reads as invisible (house contrast walk uses
# the same 0.05 bound for its hidden test).
OPACITY_HIDDEN = 0.05
# text-indent at or beyond this (negative) is the classic off-screen
# text placement.
OFFSCREEN_INDENT_PX = -999.0


def _snap_doc(snap):
    d = snap["documents"][0]
    return d, snap["strings"]


def _attrs(nodes, S, ni):
    a = (nodes.get("attributes") or [[]])[ni] if nodes.get("attributes") else []
    return {S[a[i]]: S[a[i + 1]] for i in range(0, len(a) - 1, 2)}


def _style_get(st, idx):
    if st is None or idx >= len(st):
        return ""
    return st[idx] or ""


def parse_text_nodes(snap):
    """Yield one record per DOM text node (nodeType 3) outside the
    excluded subtrees (script/style/template/head/...).

    Record: {text, node_index, parent_index, backend, path, styles,
    bounds, aria_hidden, excluded} — styles/bounds are the node's own
    layout entry or None; callers resolve effective values by walking
    parents with the helpers below. `path` is a tag chain like
    BODY>DIV#catalog>SPAN.sr-only for evidence.
    """
    d, S = _snap_doc(snap)
    nodes, lay = d["nodes"], d["layout"]
    parent = nodes["parentIndex"]
    ntype = nodes["nodeType"]
    nname = nodes.get("nodeName", [])
    nval = nodes.get("nodeValue", [])
    backend = nodes.get("backendNodeId", [])
    lay_of = {ni: li for li, ni in enumerate(lay["nodeIndex"])}

    def style(ni):
        li = lay_of.get(ni)
        if li is None:
            return None
        st = lay["styles"][li]
        return [S[i] if i >= 0 else "" for i in st] if st else None

    def bounds(ni):
        li = lay_of.get(ni)
        if li is None:
            return None
        return lay["bounds"][li]

    def chain(ni):
        out, cur = [], ni
        while cur is not None and cur >= 0:
            out.append(cur)
            cur = parent[cur]
        return out  # self-first

    def name_of(a):
        v = nname[a] if a < len(nname) else ""
        if isinstance(v, int):
            return S[v] if 0 <= v < len(S) else ""
        return v or ""

    def path_of(ni):
        parts = []
        for a in reversed(chain(ni)):
            if ntype[a] != 1:
                continue
            name = (name_of(a) or "?").upper()
            at = _attrs(nodes, S, a)
            if at.get("id"):
                name += "#" + at["id"]
            elif at.get("class"):
                name += "." + at["class"].split()[0]
            parts.append(name)
        return ">".join(parts[-6:])

    records = []
    for ni in range(len(ntype)):
        if ntype[ni] != 3:
            continue
        txt = S[nval[ni]] if nval and ni < len(nval) and nval[ni] >= 0 else ""
        if not txt or not txt.strip():
            continue
        anc = chain(ni)
        if any(name_of(a).upper() in EXCLUDED_ANCESTORS for a in anc):
            continue
        aria = any(_attrs(nodes, S, a).get("aria-hidden") == "true" for a in anc)
        records.append({
            "text": txt, "node_index": ni, "parent_index": parent[ni],
            "backend": backend[ni] if ni < len(backend) else None,
            "path": path_of(parent[ni]) if parent[ni] >= 0 else "",
            "styles": style(ni) or style(parent[ni]),
            "bounds": bounds(ni),
            "aria_hidden": aria,
            "_ancestors": anc, "_style_of": style, "_bounds_of": bounds,
            "_parent": parent,
        })
    return records


def _effective(rec, idx):
    """First non-empty style value for idx walking self -> ancestors."""
    style_of = rec["_style_of"]
    for a in rec["_ancestors"]:
        st = style_of(a)
        v = _style_get(st, idx)
        if v:
            return v
    return ""


def _own_or_parent_style(rec, idx):
    st = rec["styles"]
    return _style_get(st, idx)


def effective_background(rec):
    """Mirror of the contrast walk's background resolution: blend
    ancestor background layers over a white base. Returns
    (colour, saw_image) — saw_image True means a background-image sits
    in the chain and the true backdrop is unknowable from the snapshot.
    """
    style_of = rec["_style_of"]
    layers, img = [], False
    for a in rec["_ancestors"][1:]:  # parents up
        st = style_of(a)
        if not st:
            continue
        if _style_get(st, BGIMG) and _style_get(st, BGIMG) != "none":
            img = True
            break
        bg = colors.parse(_style_get(st, BG))
        if bg and bg[3] > 0:
            layers.append(bg)
            if bg[3] >= 0.999:
                break
    base = (255, 255, 255, 1.0)
    for lyr in reversed(layers):
        base = colors.blend(lyr, base)
    return base, img


def hiding_classes(rec, viewport=None, content=None):
    """The hiding classes that apply to one text record. Empty list =
    visible. viewport/content are (w, h) in CSS px when known.
    """
    out = []
    if rec["aria_hidden"]:
        out.append("aria_hidden")
    # display:none on ANY ancestor removes the whole subtree; a child
    # cannot override it back.
    style_of = rec["_style_of"]
    if any(_style_get(style_of(a), DISP) == "none" for a in rec["_ancestors"]):
        out.append("display_none")
    # visibility inherits, but a descendant may override it back to
    # visible — the nearest value wins.
    vis = _effective(rec, VIS)
    if vis in ("hidden", "collapse"):
        out.append("visibility_hidden")
    # opacity multiplies down the tree.
    op_prod = 1.0
    for a in rec["_ancestors"]:
        v = _style_get(style_of(a), OP)
        if v:
            try:
                op_prod *= float(v)
            except ValueError:
                pass
    if op_prod <= OPACITY_HIDDEN:
        out.append("opacity_zero")
    fs = _own_or_parent_style(rec, FS)
    if fs in ("0px", "0", "0.0px"):
        out.append("font_zero")
    b = rec["bounds"]
    if b is None:
        # No layout entry at all for a body text node: it is not
        # rendered (display:none subtrees produce exactly this).
        if "display_none" not in out:
            out.append("no_layout")
    else:
        x, y, w, h = b
        if w < 1 or h < 1:
            out.append("zero_size")
        cw = content[0] if content else None
        ch = content[1] if content else None
        if (x + w <= 0 or y + h <= 0
                or (cw is not None and x >= cw)
                or (ch is not None and y >= ch)):
            out.append("off_screen")
    ti = _own_or_parent_style(rec, TIND)
    if ti.endswith("px"):
        try:
            if float(ti[:-2]) <= OFFSCREEN_INDENT_PX:
                out.append("off_screen")
        except ValueError:
            pass
    # Same colour as the effective background.
    fg = colors.parse(_own_or_parent_style(rec, COLOR))
    if fg and fg[3] > 0:
        base, img = effective_background(rec)
        if not img:
            fgc = colors.blend(fg, base) if fg[3] < 1 else fg
            if colors.ratio(fgc, base) <= SAME_COLOUR_MAX_RATIO:
                out.append("same_colour")
    return out


def match_targets(text, targets):
    """targets: list of (kind, value, name) where kind is 'phrase'
    (value = substring, case-insensitive) or 'pattern' (value = a
    compiled regex from HARNESS_PATTERNS, name = the pattern's name).
    Returns the list of matched (kind, name) pairs.
    """
    hits = []
    low = text.lower()
    for kind, val, name in targets:
        if kind == "phrase":
            if val.lower() in low:
                hits.append(("phrase", name))
        else:
            if val.search(text):
                hits.append(("pattern", name))
    return hits


def scan_snapshot(snap, targets, viewport=None, content=None):
    """Scan one DOMSnapshot. Returns {findings, checked, visible}.

    findings: [{text, path, backend, classes, matched, kind}] where
    kind is 'hidden' (target/harness text in a hidden node) or
    'visible_harness' (harness-pattern text in a visible node — test
    data on live; phrase targets are NOT matched against visible text,
    or every ticket's quoted UI strings would flag).
    """
    findings, checked, visible = [], 0, 0
    for rec in parse_text_nodes(snap):
        checked += 1
        classes = hiding_classes(rec, viewport=viewport, content=content)
        if classes:
            hits = match_targets(rec["text"], targets)
            if hits:
                findings.append({
                    "text": rec["text"].strip()[:160],
                    "path": rec["path"], "backend": rec["backend"],
                    "classes": classes, "matched": hits, "kind": "hidden",
                })
        else:
            visible += 1
            hits = match_targets(rec["text"],
                                 [t for t in targets if t[0] == "pattern"])
            if hits:
                findings.append({
                    "text": rec["text"].strip()[:160],
                    "path": rec["path"], "backend": rec["backend"],
                    "classes": [], "matched": hits, "kind": "visible_harness",
                })
    return {"findings": findings, "checked": checked, "visible": visible}


def targets_from_ticket(ticket, quoted=()):
    """Build the target list for a ticket: every quoted string in its
    text (the walker's elements() extraction, passed in) as a phrase
    target, plus the standing harness/AI-phrasing patterns.
    """
    targets = [("phrase", q, q) for q in quoted if q and len(q) >= 3]
    targets += [("pattern", rx, name) for name, rx in HARNESS_PATTERNS]
    return targets


def capture(session):
    """Issue this module's own DOMSnapshot capture through an existing
    CDP session (the superset style list). No page JavaScript.
    """
    return session.send("DOMSnapshot.captureSnapshot", {
        "computedStyles": STYLES, "includeDOMRects": True})


def scan_cdp(cdp, targets):
    """Scan the current page through a walker Cdp object. Falls back to
    Cdp.snapshot() (10-style rows) if the superset capture fails.
    Returns scan_snapshot's dict, or None when no snapshot could be
    taken at all (callers map that to NEEDS_HUMAN, never a pass).
    """
    snap = None
    try:
        snap = capture(cdp.s)
    except Exception:
        try:
            snap = cdp.snapshot()
        except Exception:
            return None
    try:
        lm = cdp.layout_metrics()
        viewport = (lm.get("viewport_w"), lm.get("viewport_h"))
        content = (lm.get("content_w"), lm.get("content_h"))
    except Exception:
        viewport, content = None, None
    try:
        return scan_snapshot(snap, targets, viewport=viewport, content=content)
    except Exception:
        return None


def reload_capture(providers, targets, n=10):
    """repos-002 shape: run the scan after each of n reloads and union
    the findings (an intermittent injection shows on some loads only).
    providers: a callable(i) -> snapshot dict (or None for a failed
    capture). Returns {findings (deduped by text+path), per_load: [counts],
    loads_ok}. A load that fails to capture counts as not-ok, never as
    clean.
    """
    seen, per_load, ok = {}, [], 0
    for i in range(n):
        snap = providers(i)
        if snap is None:
            per_load.append(None)
            continue
        ok += 1
        res = scan_snapshot(snap, targets)
        per_load.append(len(res["findings"]))
        for f in res["findings"]:
            seen[(f["text"], f["path"], f["kind"])] = f
    return {"findings": list(seen.values()), "per_load": per_load,
            "loads_ok": ok, "loads": n}


def search_compare(search_texts, list_texts, needle):
    """ingest-001 shape (read-only): one DTU id (needle) reachable via
    global search but absent from the lens's own list — or the reverse.
    Returns {in_search, in_list, divergent}. Pure over text lists so it
    is exercised offline; the live wiring supplies the texts.
    """
    in_search = any(needle in (t or "") for t in search_texts)
    in_list = any(needle in (t or "") for t in list_texts)
    return {"in_search": in_search, "in_list": in_list,
            "divergent": in_search != in_list}
