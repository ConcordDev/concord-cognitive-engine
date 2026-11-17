"""Fixture driver for the IMM-14 recipe templates (offline, no browser).

A scriptable page satisfying the recipe_templates driver protocol. Every
template gets three variants, mirroring the done criteria:
  buggy   — the surface is present and the behaviour is wrong;
  fixed   — the behaviour is right;
  missing — the required element/capability is absent.
test_imm14_templates.py asserts STILL_FAILING / FIXED / NEEDS_HUMAN
respectively for each template against these variants.
"""


def _btn(name):
    return {"name": name, "role": "button"}


class FixtureDriver:
    def __init__(self, controls=None, texts=None, dialogs=None, layout=None,
                 styles=None, on_open=None, on_click=None, escape_closes=True,
                 overflow_shrinks=True):
        self.controls = list(controls or [])
        self.texts = list(texts or [])
        self.dialogs = list(dialogs or [])
        self._layout = layout
        self._styles = styles
        self._on_open = list(on_open or [])
        self._on_click = dict(on_click or {})
        self._escape_closes = escape_closes
        self._overflow_shrinks = overflow_shrinks
        self.responses = []
        self.calls = []

    # ---- protocol
    def open(self, target):
        self.calls.append(("open", target))
        self.responses.extend(self._on_open)

    def reload(self):
        self.calls.append(("reload",))
        self.responses.extend(self._on_open)

    def press(self, key):
        self.calls.append(("press", key))
        if key == "Escape" and self._escape_closes:
            self.dialogs = []
            self.controls = [c for c in self.controls if c["name"] != "Menu dialog"]

    def click(self, name, role=None):
        from concord_walker.matching import fuzzy_match
        pool = [c["name"] for c in self.controls if role is None or c.get("role") == role]
        hit = fuzzy_match(name, pool)
        self.calls.append(("click", name, hit))
        if hit is None:
            return None
        effect = self._on_click.get(hit) or {}
        self.responses.extend(effect.get("responses") or [])
        for d in effect.get("add_dialogs") or []:
            if d not in self.dialogs:
                self.dialogs.append(d)
        for c in effect.get("add_controls") or []:
            if c["name"] not in [x["name"] for x in self.controls]:
                self.controls.append(c)
        return hit

    def snapshot(self):
        return {"controls": [dict(c) for c in self.controls], "texts": list(self.texts),
                "dialogs": list(self.dialogs), "errors": 0, "url": "fixture://lens"}

    def obs_mark(self):
        return len(self.responses)

    def obs_since(self, mark):
        return {"console_new": [], "net": [dict(r) for r in self.responses[mark:]]}

    def measure_layout(self):
        return dict(self._layout) if self._layout is not None else None

    def text_styles(self):
        return list(self._styles) if self._styles is not None else None

    def set_viewport(self, width, height):
        self.calls.append(("set_viewport", width, height))
        if self._layout is not None:
            self._layout = dict(self._layout)
            self._layout["vw"] = width
            if self._overflow_shrinks:
                self._layout["scrollW"] = width
                self._layout["bodyScrollW"] = width
                self._layout["textOverflow"] = []


def driver_for(template, variant):
    """The fixture page for one template in one variant."""
    if template == "escape":
        if variant == "missing":
            return FixtureDriver(controls=[_btn("Home")], texts=["Welcome"])
        return FixtureDriver(
            controls=[_btn("Menu")], texts=["Welcome"],
            on_click={"Menu": {"add_dialogs": ["Menu dialog"],
                               "add_controls": [_btn("Menu dialog")]}},
            escape_closes=(variant == "fixed"))
    if template == "overflow-390":
        if variant == "missing":
            return FixtureDriver(controls=[_btn("Home")], layout=None)
        return FixtureDriver(
            controls=[_btn("Home")], texts=["Welcome"],
            layout={"vw": 1280, "scrollW": 720, "bodyScrollW": 720,
                    "clipped": [], "textOverflow": ["long-word"] if variant == "buggy" else []},
            overflow_shrinks=(variant == "fixed"))
    if template == "contrast":
        if variant == "missing":
            return FixtureDriver(controls=[_btn("Home")], styles=None)
        good = {"text": "Body text", "color": "#1a1a1a", "background": "#ffffff"}
        bad = {"text": "Faint hint", "color": "#9a9a9a", "background": "#ffffff"}
        return FixtureDriver(controls=[_btn("Home")], texts=["Body text"],
                             styles=[good] if variant == "fixed" else [good, bad])
    if template == "load-5xx":
        if variant == "missing":
            return FixtureDriver(controls=[], texts=[], on_open=[])
        rows = [{"method": "GET", "path": "/api/lens/list", "status": 200}]
        if variant == "buggy":
            rows.append({"method": "POST", "path": "/api/lens/run", "status": 503})
        return FixtureDriver(controls=[_btn("Home")], texts=["Welcome"], on_open=rows)
    if template == "export-file":
        if variant == "missing":
            return FixtureDriver(controls=[_btn("Home")], texts=["Welcome"])
        resp = [{"method": "GET", "path": "/api/lens/export",
                 "status": 200 if variant == "fixed" else 500}]
        return FixtureDriver(controls=[_btn("Export")], texts=["Welcome"],
                             on_click={"Export": {"responses": resp}})
    if template == "endpoint-hit":
        if variant == "missing":
            return FixtureDriver(controls=[_btn("Home")], texts=["Welcome"])
        resp = [{"method": "POST", "path": "/api/lens/run", "status": 200}] \
            if variant == "fixed" else []
        return FixtureDriver(controls=[_btn("Save")], texts=["Welcome"],
                             on_click={"Save": {"responses": resp}})
    raise ValueError("unknown template %r" % template)
