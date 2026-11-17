"""Page readings derived ONLY from CDP DOMSnapshot / accessibility data - never page JavaScript.

The walker's driver layer drives pages through the CDP accessibility tree, DOMSnapshot, layout metrics and
Playwright input/emulation primitives. These pure functions turn those snapshots into the readings the
pre-capture checks need (theme, layout overflow, spinner, active widget item), so they are testable offline
with fake snapshots. Anything unreadable returns None / an empty reading - callers treat that as UNVERIFIED.
"""
import re

# style index order of Cdp.snapshot(): color, background-color, background-image, font-size, font-weight,
# opacity, visibility, display, position, overflow-x
_BG, _VIS, _DISP, _OVX = 1, 6, 7, 9


def _doc(snap):
    try:
        return snap["documents"][0], snap["strings"]
    except Exception:
        return None, None


def _attrs(d, S, ni):
    a = (d["nodes"].get("attributes") or [])
    if ni >= len(a):
        return {}
    raw = a[ni] or []
    return {S[raw[i]]: S[raw[i + 1]] for i in range(0, len(raw) - 1, 2) if raw[i] >= 0 and raw[i + 1] >= 0}


def _style(d, S, lay_of, ni):
    li = lay_of.get(ni)
    if li is None:
        return None
    st = d["layout"]["styles"][li]
    return [S[i] if i >= 0 else "" for i in st] if st else None


def _named(d, S, name):
    names = d["nodes"]["nodeName"]
    return [i for i, n in enumerate(names) if n >= 0 and S[n].upper() == name]


def page_scheme(snap):
    """'<data-theme or class of <html>>|<body background-color>' or None when unreadable."""
    d, S = _doc(snap)
    if d is None:
        return None
    lay_of = {ni: li for li, ni in enumerate(d["layout"]["nodeIndex"])}
    html, body = _named(d, S, "HTML"), _named(d, S, "BODY")
    if not html or not body:
        return None
    a = _attrs(d, S, html[0])
    st = _style(d, S, lay_of, body[0]) or []
    return (a.get("data-theme") or a.get("class") or "") + "|" + (st[_BG] if len(st) > _BG else "")


def layout(snap, vw, vh, tol=2):
    """Same shape the old in-page measurement returned: {vw, vh, scrollW, bodyScrollW, clipped[], textOverflow[]}."""
    d, S = _doc(snap)
    if d is None or not vw:
        return None
    nodes, lay = d["nodes"], d["layout"]
    lay_of = {ni: li for li, ni in enumerate(lay["nodeIndex"])}
    parent, names = nodes["parentIndex"], nodes["nodeName"]
    ntype = nodes["nodeType"]
    scroll_rects, client_rects = lay.get("scrollRects") or [], lay.get("clientRects") or []
    html, body = _named(d, S, "HTML"), _named(d, S, "BODY")

    def scroll_w(ni):
        li = lay_of.get(ni)
        r = scroll_rects[li] if li is not None and li < len(scroll_rects) else None
        return r[2] if r and len(r) == 4 else 0

    def scrolls(ni):
        cur = parent[ni]
        while cur is not None and cur >= 0 and (not body or cur != body[0]):
            st = _style(d, S, lay_of, cur)
            if st and len(st) > _OVX and st[_OVX] in ("auto", "scroll", "hidden"):
                return True
            cur = parent[cur]
        return False

    clipped, overflow = [], []
    non_leaf = has_child_elems(parent, ntype)
    for li, ni in enumerate(lay["nodeIndex"]):
        if ntype[ni] != 1:
            continue
        st = _style(d, S, lay_of, ni)
        if not st or st[_VIS] in ("hidden", "collapse") or st[_DISP] == "none":
            continue
        x, y, w, h = lay["bounds"][li]
        if w < 1 or h < 1:
            continue
        tag = S[names[ni]].lower() if names[ni] >= 0 else "?"
        if (x + w > vw + tol or x < -tol) and len(clipped) < 8 and not scrolls(ni):
            clipped.append({"sel": tag + ("#" + _attrs(d, S, ni).get("id") if _attrs(d, S, ni).get("id") else ""),
                            "left": round(x), "right": round(x + w), "w": round(w)})
        if ni not in non_leaf and li < len(client_rects):
            cr = client_rects[li]
            if cr and len(cr) == 4 and scroll_w(ni) > cr[2] + tol and len(st) > _OVX and st[_OVX] == "visible" and len(overflow) < 8:
                txt = _own_text(d, S, ni)
                if txt:
                    overflow.append("%s:%s" % (tag, txt[:30]))
    de = scroll_w(html[0]) if html else 0
    return {"vw": vw, "vh": vh, "scrollW": round(de), "bodyScrollW": round(scroll_w(body[0])) if body else 0,
            "clipped": clipped, "textOverflow": overflow}


def has_child_elems(parent, ntype):
    # element nodes that have at least one element child (so leaf elements are everything else)
    return {p for i, p in enumerate(parent) if p is not None and p >= 0 and ntype[i] == 1}


def _own_text(d, S, ni):
    nodes = d["nodes"]
    nv, par, nt = nodes.get("nodeValue") or [], nodes["parentIndex"], nodes["nodeType"]
    out = []
    for i, p in enumerate(par):
        if p == ni and nt[i] == 3 and i < len(nv) and nv[i] >= 0:
            out.append(S[nv[i]].strip())
    return " ".join(x for x in out if x)


_SPIN = re.compile(r"(?i)animate-spin|spinner|skeleton")


def spinner(snap):
    """A visible loading indicator: role=progressbar, aria-busy=true, or a spinner/skeleton-classed box with area."""
    d, S = _doc(snap)
    if d is None:
        return False
    lay = d["layout"]
    for li, ni in enumerate(lay["nodeIndex"]):
        a = _attrs(d, S, ni)
        if not a:
            continue
        hit = a.get("role") == "progressbar" or a.get("aria-busy") == "true" or bool(_SPIN.search(a.get("class", "")))
        if hit:
            x, y, w, h = lay["bounds"][li]
            if w > 0 and h > 0:
                return True
    return False


_WIDGETS = ("tablist", "listbox", "menu", "grid", "radiogroup", "toolbar")


def active_item(ax):
    """Active/selected item of the focused widget from the accessibility tree (selected/current/checked), else the focus name."""
    f = ax.focused()
    if f is None or f.role in ("RootWebArea", "WebArea"):
        return None
    d = lambda n: (n.name or "").strip()[:60] or None
    for anc in ax.ancestors(f):
        if anc.role in _WIDGETS:
            for n in ax.descendants(anc):
                if n.props.get("selected") or n.props.get("checked") in (True, "true") or n.props.get("current") not in (None, False, "false"):
                    return "%s#sel" % d(n)
            break
    return "%s#focus" % d(f)
