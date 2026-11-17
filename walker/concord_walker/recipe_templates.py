"""Recipe template library (IMM-14 / MST-W1-15).

Seven parameterized verification shapes, derived from the IMM-13 recipe schema
(walker/recipes/SCHEMA.md): a template is NOT a recipe — it becomes one when a
per-ticket instance binds its parameters (control names, endpoints, expected
statuses) and the instance is registered through the IMM-13 registry with a
Dutch / Zuko-desk review. Only a reviewed instance can verify a ticket.

Each template takes a driver and returns the walker's verdict dict
{verdict, method, notes, evidence}:
  FIXED         — the behaviour the ticket wants is present;
  STILL_FAILING — the surface is there and the behaviour is wrong;
  NEEDS_HUMAN   — a required element or capability is missing, so no verdict
                  is honest (the walker's standing fail-toward-human rule).

Driver protocol (the repro driver's surface — PlaywrightDriver satisfies it,
and selftest/fixture_app_imm14.py satisfies it without a browser):
  open(target) / reload() / press(key)
  click(name, role=None) -> the matched control name, or None when absent
  snapshot() -> {controls: [{name, role}], texts: [str], dialogs: [str], errors: int}
  obs_mark() / obs_since(mark) -> {console_new: [...], net: [{method, path, status}]}
  measure_layout() -> {vw, scrollW, bodyScrollW, clipped, textOverflow} or None
  text_styles() -> [{text, color, background}] or None when the driver cannot
                   report styles (the contrast template then says NEEDS_HUMAN)
  set_viewport(width, height) — optional; the 390 template uses it when the
                   driver offers it and otherwise measures at the current width.

Templates only read and replay; the walker's own click policy and write
labelling are the driver's business, unchanged.
"""
import re

from . import colors

FIXED, STILL, HUMAN = "FIXED", "STILL_FAILING", "NEEDS_HUMAN"


def _res(verdict, method, notes, evidence=None):
    return {"verdict": verdict, "method": method, "notes": notes,
            "evidence": list(evidence or []), "coverage_basis": "recipe",
            "recipe_kind": "template"}


def _controls(driver):
    snap = driver.snapshot()
    return snap, [c.get("name") for c in snap.get("controls") or []]


def _present(driver, name):
    _snap, names = _controls(driver)
    return name in names


# ------------------------------------------------------------ Escape
def escape_closes(driver, opener=None, surface=None):
    """Open a surface (menu/dialog) and prove Escape closes it.
    opener: control that opens the surface (optional — the surface may
    already be open). surface: a control name or dialog label that is
    present while the surface is open and gone once it closes."""
    if opener:
        if driver.click(opener) is None:
            return _res(HUMAN, "template:escape", "opener %r not found" % opener)
    snap, names = _controls(driver)
    dialogs = snap.get("dialogs") or []
    if surface is None:
        surface = dialogs[0] if dialogs else None
    if surface is None:
        return _res(HUMAN, "template:escape",
                    "no open surface to close (no dialog, no surface named)")
    was_dialog = surface in dialogs
    if not was_dialog and surface not in names:
        return _res(HUMAN, "template:escape",
                    "surface %r is not open — nothing to close" % surface)
    driver.press("Escape")
    snap2, names2 = _controls(driver)
    gone = surface not in (snap2.get("dialogs") or []) and surface not in names2
    if gone:
        return _res(FIXED, "template:escape", "Escape closed %r" % surface,
                    ["escape: %r present before, absent after Escape" % surface])
    return _res(STILL, "template:escape", "Escape did not close %r" % surface,
                ["escape: %r still present after Escape" % surface])


# ------------------------------------------------------------ 390 overflow
def no_overflow_390(driver, width=390, tol=2):
    """At a 390px-wide viewport the page must not overflow horizontally:
    scroll width stays within the viewport and no text overflows its box."""
    if hasattr(driver, "set_viewport"):
        driver.set_viewport(width, 844)
    lay = driver.measure_layout()
    if not lay:
        return _res(HUMAN, "template:overflow-390", "driver cannot measure layout")
    vw = lay.get("vw") or 0
    if vw and abs(vw - width) > 8:
        return _res(HUMAN, "template:overflow-390",
                    "viewport is %spx, not %s — the 390 check did not run" % (vw, width))
    scroll_w = max(lay.get("scrollW") or 0, lay.get("bodyScrollW") or 0)
    text_over = lay.get("textOverflow") or []
    if scroll_w > (vw or width) + tol or text_over:
        return _res(STILL, "template:overflow-390",
                    "horizontal overflow at %spx: scrollW %s, %d text-overflow node(s)"
                    % (width, scroll_w, len(text_over)),
                    ["overflow: scrollW=%s vw=%s textOverflow=%d" % (scroll_w, vw, len(text_over))])
    return _res(FIXED, "template:overflow-390",
                "no horizontal overflow at %spx (scrollW %s within vw %s)" % (width, scroll_w, vw),
                ["overflow: scrollW=%s vw=%s" % (scroll_w, vw)])


# ------------------------------------------------------------ contrast
def contrast_ok(driver, min_ratio=4.5):
    """Every visible text's colour contrast against its background meets
    min_ratio (WCAG AA normal text = 4.5). Colours are judged with the
    walker's own colors.ratio."""
    styles = driver.text_styles() if hasattr(driver, "text_styles") else None
    if not styles:
        return _res(HUMAN, "template:contrast",
                    "driver cannot report text styles — contrast not judged")
    worst, judged, unjudged = None, 0, 0
    for entry in styles:
        fg, bg = colors.parse(entry.get("color") or ""), colors.parse(entry.get("background") or "")
        if fg is None or bg is None:
            unjudged += 1
            continue
        judged += 1
        r = colors.ratio(fg, bg)
        if worst is None or r < worst[0]:
            worst = (r, entry.get("text") or "")
    if not judged:
        return _res(HUMAN, "template:contrast",
                    "no parseable text colours (%d unparseable)" % unjudged)
    if worst[0] < min_ratio:
        return _res(STILL, "template:contrast",
                    "contrast %.2f < %.2f on %r" % (worst[0], min_ratio, worst[1][:40]),
                    ["contrast: worst %.2f on %r of %d judged" % (worst[0], worst[1][:40], judged)])
    return _res(FIXED, "template:contrast",
                "all %d texts meet %.2f (worst %.2f)" % (judged, min_ratio, worst[0]),
                ["contrast: worst %.2f of %d judged" % (worst[0], judged)])


# ------------------------------------------------------------ load / 5xx
def loads_clean(driver, target=None):
    """The surface loads with no 5xx response and renders something.
    A 5xx is STILL_FAILING naming the endpoint; a surface that renders
    nothing at all is NEEDS_HUMAN (missing surface, not a verdict)."""
    mark = driver.obs_mark()
    if target:
        driver.open(target)
    else:
        driver.reload()
    obs = driver.obs_since(mark)
    net = obs.get("net") or []
    bad = [r for r in net if (r.get("status") or 0) >= 500]
    snap, names = _controls(driver)
    rendered = bool(names or (snap.get("texts") or []))
    if bad:
        first = bad[0]
        return _res(STILL, "template:load-5xx",
                    "%d 5xx response(s) on load; first %s %s -> %s"
                    % (len(bad), first.get("method"), first.get("path"), first.get("status")),
                    ["load: %s %s -> %s" % (first.get("method"), first.get("path"), first.get("status"))])
    if not rendered:
        return _res(HUMAN, "template:load-5xx",
                    "surface rendered nothing (no controls, no text) — not judged")
    return _res(FIXED, "template:load-5xx",
                "loaded clean: %d response(s), no 5xx" % len(net),
                ["load: %d net rows, 0 5xx" % len(net)])


# ------------------------------------------------------------ export file
def export_produces_file(driver, control="Export", path_hint="/export", expect_status=None):
    """Clicking the export control produces the export response (a file
    download rides a 2xx response on the export path). Missing control is
    NEEDS_HUMAN; a click that produces no export response, or a non-2xx,
    is STILL_FAILING."""
    mark = driver.obs_mark()
    if driver.click(control) is None:
        return _res(HUMAN, "template:export-file", "export control %r not found" % control)
    obs = driver.obs_since(mark)
    hits = [r for r in (obs.get("net") or []) if path_hint in (r.get("path") or "")]
    if not hits:
        return _res(STILL, "template:export-file",
                    "clicked %r but no %r response followed" % (control, path_hint),
                    ["export: no response with path containing %r" % path_hint])
    hit = hits[-1]
    status = hit.get("status") or 0
    ok = (200 <= status < 300) if expect_status is None else status == expect_status
    if not ok:
        return _res(STILL, "template:export-file",
                    "export response %s %s -> %s" % (hit.get("method"), hit.get("path"), status),
                    ["export: %s -> %s" % (hit.get("path"), status)])
    return _res(FIXED, "template:export-file",
                "export produced %s %s -> %s" % (hit.get("method"), hit.get("path"), status),
                ["export: %s -> %s" % (hit.get("path"), status)])


# ------------------------------------------------------------ endpoint hit
def endpoint_hit(driver, control, method="POST", path="/api/lens/run",
                 expect_status=None, action=None):
    """Clicking a control hits the expected endpoint. Parameterized over the
    control id and the endpoint — an instance binds REAL control ids from the
    capture map when it is drafted (instances that need the map are not part
    of the template layer's build). The response SHAPE only is visible to the
    walker, so `action` (domain.action) is recorded as the instance's stated
    expectation in the evidence, not asserted from the wire."""
    mark = driver.obs_mark()
    if driver.click(control) is None:
        return _res(HUMAN, "template:endpoint-hit", "control %r not found" % control)
    obs = driver.obs_since(mark)
    hits = [r for r in (obs.get("net") or [])
            if (r.get("method") or "").upper() == method.upper() and path in (r.get("path") or "")]
    ev = ["endpoint: expect %s %s%s" % (method, path, (" action=%s" % action) if action else "")]
    if not hits:
        return _res(STILL, "template:endpoint-hit",
                    "clicked %r; %s %s was not hit" % (control, method, path), ev)
    hit = hits[-1]
    status = hit.get("status") or 0
    ok = (200 <= status < 300) if expect_status is None else status == expect_status
    ev.append("endpoint: %s %s -> %s" % (method, hit.get("path"), status))
    if not ok:
        return _res(STILL, "template:endpoint-hit",
                    "%s %s answered %s" % (method, hit.get("path"), status), ev)
    return _res(FIXED, "template:endpoint-hit",
                "%s %s hit with %s after clicking %r" % (method, hit.get("path"), status, control), ev)


# ------------------------------------------------------------ value assertion
def value_assert(driver, control="Compute", inputs=None, expected=None, tolerance=0.0,
                 result_pattern=None, declaration=None, action=None):
    """Assert a VALUE, not a rendering (founder correction #8: surface is not
    correctness). Where the action HAS a declaration — a cited reference plus
    a validity range — the recipe runs a declared reference case (known
    inputs -> expected value) and compares the rendered value against it.
    The declaration's review_source decides what a pass means, and the
    result says so everywhere: "independent" expected values make this a
    correctness check; "self-referenced" ones are drift coverage only
    (correction #9). Where NO declaration exists, the action is filed
    UNDECLARED in the open — NEEDS_HUMAN with the gap named, so the corpus
    itself maps where correctness is not yet checkable."""
    if declaration is None:
        return _res(HUMAN, "template:value-assert",
                    "UNDECLARED: no declaration for this action — correctness is "
                    "not checked; the gap is filed in the open",
                    ["undeclared: action=%s" % (action or control)])
    source = declaration.get("review_source")
    label = ("correctness check (independent declaration: %s)"
             % declaration.get("reference")) if source == "independent" else \
            ("DRIFT COVERAGE ONLY (self-referenced declaration: %s) — not a correctness check"
             % declaration.get("reference"))
    if not hasattr(driver, "type_into"):
        return _res(HUMAN, "template:value-assert", "driver cannot fill inputs")
    for field, value in (inputs or {}).items():
        if not driver.type_into(field, value):
            return _res(HUMAN, "template:value-assert", "input field %r not found" % field)
    if driver.click(control) is None:
        return _res(HUMAN, "template:value-assert", "compute control %r not found" % control)
    snap, _names = _controls(driver)
    texts = snap.get("texts") or []
    pat = result_pattern or r"(-?\d+(?:\.\d+)?)"
    actual = None
    for text in texts:
        found = re.findall(pat, text)
        if found:
            try:
                actual = float(found[-1])
            except (TypeError, ValueError):
                continue
    if actual is None:
        return _res(HUMAN, "template:value-assert",
                    "no result value rendered after %r — the case did not run" % control)
    if expected is None:
        return _res(HUMAN, "template:value-assert",
                    "declaration present but the instance binds no expected value")
    ev = ["value: inputs=%s expected=%s actual=%s tolerance=%s (%s)"
          % (inputs or {}, expected, actual, tolerance, label)]
    if abs(actual - float(expected)) <= float(tolerance):
        return _res(FIXED, "template:value-assert",
                    "value %s == expected %s within %s — %s" % (actual, expected, tolerance, label), ev)
    return _res(STILL, "template:value-assert",
                "value %s != expected %s (tolerance %s) — %s" % (actual, expected, tolerance, label), ev)


TEMPLATES = {
    "escape": {"fn": escape_closes, "params": ("opener", "surface"),
               "tier": 2, "discriminator": "fixture buggy variant: verdict STILL_FAILING — 'Escape did not close \'Menu dialog\'' (surface still present after Escape)",
               "proves": "a menu/dialog opened on the surface closes on Escape"},
    "overflow-390": {"fn": no_overflow_390, "params": ("width",),
               "tier": 2, "discriminator": "fixture buggy variant: verdict STILL_FAILING — 'horizontal overflow at 390px: scrollW 720, 1 text-overflow node(s)'",
                     "proves": "no horizontal overflow at a 390px viewport"},
    "contrast": {"fn": contrast_ok, "params": ("min_ratio",),
               "tier": 2, "discriminator": "fixture buggy variant: verdict STILL_FAILING — 'contrast 2.81 < 4.50 on \'Faint hint\''",
                 "proves": "all visible text meets the contrast floor"},
    "load-5xx": {"fn": loads_clean, "params": ("target",),
               "tier": 1, "discriminator": "fixture buggy variant: verdict STILL_FAILING — '1 5xx response(s) on load; first POST /api/lens/run -> 503'",
                 "proves": "the surface loads with no 5xx and renders"},
    "export-file": {"fn": export_produces_file, "params": ("control", "path_hint", "expect_status"),
               "tier": 1, "discriminator": "fixture buggy variant: verdict STILL_FAILING — 'export response GET /api/lens/export -> 500'",
                    "proves": "the export control produces the export file response"},
    "endpoint-hit": {"fn": endpoint_hit, "params": ("control", "method", "path", "expect_status", "action"),
               "tier": 1, "discriminator": "fixture buggy variant: verdict STILL_FAILING — 'clicked \'Save\'; POST /api/lens/run was not hit'",
                     "proves": "a named control hits its expected endpoint with the expected status"},
    "value-assert": {"fn": value_assert, "params": ("control", "inputs", "expected", "tolerance", "result_pattern", "declaration", "action"),
               "tier": 1, "discriminator": "fixture buggy variant: verdict STILL_FAILING — 'value 13.0 != expected 12 (tolerance 0.001)' on the declared reference case",
                     "proves": "a declared reference case renders its expected VALUE (correctness when the declaration is independent, drift coverage when self-referenced); no declaration files the action UNDECLARED"},
}


def make_instance(template_name, **params):
    """Bind a template into a recipe-shaped callable (driver -> verdict dict).
    The instance still has to be authored into a per-ticket recipe and
    registered (IMM-13) with a review before it can verify anything."""
    spec = TEMPLATES[template_name]
    fn = spec["fn"]

    def instance(driver):
        return fn(driver, **params)

    instance.template = template_name
    instance.params = dict(params)
    return instance
