"""DevTools-protocol helpers. Nothing here evaluates JavaScript in the page."""
import time


class AXNode:
    __slots__ = ("id", "role", "name", "backend", "props", "parent", "children", "ignored", "value")

    def __init__(self, raw):
        self.id = raw.get("nodeId")
        self.role = (raw.get("role") or {}).get("value", "") or ""
        self.name = (raw.get("name") or {}).get("value", "") or ""
        self.value = (raw.get("value") or {}).get("value", "") if raw.get("value") else ""
        self.backend = raw.get("backendDOMNodeId")
        self.ignored = raw.get("ignored", False)
        self.parent = raw.get("parentId")
        self.children = raw.get("childIds", []) or []
        self.props = {}
        for p in raw.get("properties", []) or []:
            self.props[p.get("name")] = (p.get("value") or {}).get("value")

    @property
    def disabled(self):
        return bool(self.props.get("disabled"))

    @property
    def focusable(self):
        return bool(self.props.get("focusable"))

    @property
    def focused(self):
        return bool(self.props.get("focused"))

    def __repr__(self):
        return f"<{self.role} {self.name[:30]!r} b={self.backend}>"


class AXTree:
    def __init__(self, nodes):
        self.nodes = [AXNode(n) for n in nodes]
        self.by_id = {n.id: n for n in self.nodes}

    def live(self):
        return [n for n in self.nodes if not n.ignored]

    def by_role(self, *roles):
        return [n for n in self.live() if n.role in roles]

    def focused(self):
        f = [n for n in self.live() if n.focused]
        return f[-1] if f else None

    def ancestors(self, node):
        out, cur = [], node
        while cur is not None and cur.parent:
            cur = self.by_id.get(cur.parent)
            if cur is not None:
                out.append(cur)
        return out

    def descendants(self, node):
        out, stack = [], list(node.children)
        while stack:
            c = self.by_id.get(stack.pop())
            if c is None:
                continue
            out.append(c)
            stack.extend(c.children)
        return out

    def is_inside(self, node, container):
        return any(a.id == container.id for a in self.ancestors(node))

    def texts(self):
        return [n.name for n in self.live() if n.role in ("StaticText", "text", "heading", "status", "alert") and n.name]

    TRANSIENT_ROLES = ("dialog", "alertdialog", "menu", "menubar", "listbox", "tooltip", "status", "alert", "log", "timer", "marquee")

    def durable_texts(self):
        """Page text that a write could have changed durably: excludes text inside menus, dialogs,
        listboxes, tooltips and live regions (status/alert toasts). A menu opened by the click or a
        'Saved!' toast is gone after any reload and is not evidence of lost data (live 2026-11-16)."""
        tr = [n for n in self.live() if n.role in self.TRANSIENT_ROLES]
        out = []
        for n in self.live():
            if n.role in ("StaticText", "text", "heading") and n.name:
                if tr and any(a.role in self.TRANSIENT_ROLES for a in self.ancestors(n)):
                    continue
                out.append(n.name)
        return out

    def dialogs(self):
        return [n for n in self.live() if n.role in ("dialog", "alertdialog")]

    def popups(self):
        return [n for n in self.live() if n.role in ("dialog", "alertdialog", "menu", "listbox")]


class Cdp:
    def __init__(self, context, page):
        self.page = page
        self.s = context.new_cdp_session(page)
        for dom in ("DOM.enable", "Accessibility.enable", "Performance.enable"):
            try:
                self.s.send(dom)
            except Exception:
                pass

    def ax(self):
        try:
            self.s.send("DOM.getDocument", {"depth": 0})
        except Exception:
            pass
        return AXTree(self.s.send("Accessibility.getFullAXTree").get("nodes", []))

    def box(self, backend):
        """Return (x, y, w, h) in CSS px of the border box, or None if not rendered."""
        try:
            m = self.s.send("DOM.getBoxModel", {"backendNodeId": backend})["model"]
        except Exception:
            return None
        q = m["border"]
        xs, ys = q[0::2], q[1::2]
        x, y = min(xs), min(ys)
        w, h = max(xs) - x, max(ys) - y
        if w <= 0 or h <= 0:
            return None
        return (x, y, w, h)

    def scroll_into_view(self, backend):
        try:
            self.s.send("DOM.scrollIntoViewIfNeeded", {"backendNodeId": backend})
        except Exception:
            pass

    def focus(self, backend):
        try:
            self.s.send("DOM.focus", {"backendNodeId": backend})
            return True
        except Exception:
            return False

    def click(self, backend):
        self.scroll_into_view(backend)
        b = self.box(backend)
        if not b:
            return False
        x, y, w, h = b
        self.page.mouse.click(x + w / 2, y + h / 2)
        return True

    def layout_metrics(self):
        m = self.s.send("Page.getLayoutMetrics")
        lv = m.get("cssLayoutViewport") or m.get("layoutViewport")
        cs = m.get("cssContentSize") or m.get("contentSize")
        return {"viewport_w": lv.get("clientWidth"), "viewport_h": lv.get("clientHeight"),
                "content_w": cs.get("width"), "content_h": cs.get("height")}

    def perf_metrics(self):
        try:
            return {m["name"]: m["value"] for m in self.s.send("Performance.getMetrics")["metrics"]}
        except Exception:
            return {}

    def snapshot(self):
        return self.s.send("DOMSnapshot.captureSnapshot", {
            "computedStyles": ["color", "background-color", "background-image", "font-size", "font-weight",
                               "opacity", "visibility", "display", "position", "overflow-x"],
            "includeDOMRects": True})


def wait_until(fn, timeout=3.0, step=0.1):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            v = fn()
            if v:
                return v, time.time() - t0
        except Exception:
            pass
        time.sleep(step)
    return None, time.time() - t0
