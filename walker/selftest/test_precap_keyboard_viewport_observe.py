"""Pre-capture items 1-4: keyboard, viewport/theme/responsive, generic observe predicates, network-backed checks.
Offline (fake driver). Every guard has a failure path: unknown -> unmapped, missing evidence -> UNVERIFIED, refused -> refused."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pytest
from concord_walker import keyboard as K, viewport as V, observe as O, netcheck as N, precap as P, repro, expected as X


# ----------------------------------------------------------------- fake driver
class FD:
    def __init__(self, focus_seq=None, active_seq=None, popups=1, writes_on_enter=True, texts=None, url="https://x/lenses/a"):
        self.pressed, self.focus_seq, self.active_seq = [], list(focus_seq or []), list(active_seq or [])
        self.popups, self.writes_on_enter, self._writes, self.url = popups, writes_on_enter, [], url
        self.texts, self.viewport, self.scheme, self.offline_v, self.zoom, self.rm = texts or ["Home"], None, None, None, None, None
        self.controls, self.alerts, self.items, self.console, self.resp, self.layout = [{"name": "Save", "role": "button"}], [], [], [], [], None
        self._plat = "linux"
    def open(self, t): pass
    def reload(self): pass
    def platform(self): return self._plat
    def press(self, k):
        self.pressed.append(k)
        if k == "Enter" and self.writes_on_enter: self._writes.append("POST /api/x")
        if k == "Escape" and self.popups: self.popups -= 1
    def focused_name(self): return self.focus_seq.pop(0) if self.focus_seq else None
    def active_item(self): return self.active_seq.pop(0) if self.active_seq else None
    def focus_name(self, n): return n != "Missing"
    def popup_count(self): return self.popups
    def net_mark(self): return len(self._writes)
    def net_since(self, m): return self._writes[m:]
    def snapshot(self): return {"controls": self.controls, "texts": self.texts, "dialogs": [], "alerts": self.alerts, "list_items": self.items, "errors": 0, "url": self.url}
    def screenshot(self, n): return None
    def set_viewport(self, w, h): self.viewport = (w, h)
    def set_scheme(self, s): self.scheme = s
    def set_offline(self, o): self.offline_v = o
    def set_zoom(self, z): self.zoom = z
    def set_reduced_motion(self, on): self.rm = on
    def measure_layout(self): return self.layout
    def measure_overflow(self): return {"viewport_w": 390, "overflow_px": 0, "offscreen": 0}
    def click(self, name, role=None): return True
    def page_scheme(self): return "x"
    def obs_mark(self): return (len(self.console), len(self.resp))
    def obs_since(self, m): return {"console_new": self.console[m[0]:], "net": self.resp[m[1]:]}


def run(steps, driver, expected="", write=None):
    t = {"id": "T", "repro_steps": steps, "expected": expected, "lens": "a"}
    return repro.run_repro(t, driver, lens_slug="a", write=write)


# ----------------------------------------------------------------- 1. keyboard mapping
@pytest.mark.parametrize("txt,action", [("Tab x40", "tab_order"), ("Shift+Tab x3", "tab_order"), ("press Ctrl+/", "press_combo"), ("Cmd/Ctrl+K", "press_combo"),
                                        ("Press Left and Right arrow keys.", "arrow_nav"), ("ArrowRight / Enter on Entities", "arrow_nav"),
                                        ("press Esc while open", "close_with_escape"), ("press Enter in the title field to submit", "enter_submit")])
def test_keyboard_maps(txt, action):
    r = K.map_part(txt, txt)
    assert isinstance(r, list) and r[-1]["action"] == action, r


def test_unknown_key_is_not_guessed():
    r = K.map_part("hit the Foo key", "x")
    assert r[0] is None and "not guessed" in r[1]
    assert K.parse_combo("Ctrl+Banana") is None
    assert K.map_part("Tab x500", "x")[0] is None


@pytest.mark.parametrize("txt", ["press Delete", "press Ctrl+Delete"])
def test_delete_shortcut_refused(txt):
    r = K.map_part(txt, txt)
    assert r[0] is None and "refused" in r[1]


def test_shortcut_described_as_publish_is_refused():
    assert "refused" in K.refusal(K.parse_combo("Ctrl+P"), "press Ctrl+P to publish the page")
    assert K.refusal(K.parse_combo("Ctrl+K"), "press Ctrl+K to open the palette") is None


def test_mod_is_platform_aware_at_execution():
    assert K.resolve("Mod+K", "darwin") == "Meta+K" and K.resolve("Mod+K", "linux") == "Control+K"
    d = FD(); d._plat = "darwin"
    run(["press Cmd/Ctrl+K"], d)
    assert "Meta+K" in d.pressed
    d2 = FD(); run(["press Cmd/Ctrl+K"], d2)
    assert "Control+K" in d2.pressed


def test_tab_order_passes_and_traps():
    d = FD(focus_seq=[chr(97 + i % 20) for i in range(40)])
    r = run(["Tab x40"], d)
    assert r["steps"][-1]["executed"] and "pass" in r["steps"][-1]["result"]
    d = FD(focus_seq=["a"] * 40)
    r = run(["Tab x40"], d)
    assert "fail" in r["steps"][-1]["result"] and "stuck" in r["steps"][-1]["result"]


def test_tab_order_unreadable_focus_is_unverified():
    r = run(["Tab x30"], FD(focus_seq=[None] * 30))
    assert not r["steps"][-1]["executed"] and r["verdict"] != "FIXED"


def test_focus_order_assertion():
    assert K.expect_focus_order(["Skip", "Home", "Search"], ["Skip", "Search"])[0] == "pass"
    assert K.expect_focus_order(["Skip", "Home", "Search"], ["Search", "Skip"])[0] == "fail"
    assert K.expect_focus_order([], ["x"])[0] == "unverified"


def test_arrow_nav_changed_unchanged_missing():
    assert "pass" in run(["ArrowRight / Enter on Entities"], FD(active_seq=["A#sel", "B#sel", "B#sel"]))["steps"][-1]["result"]
    assert "fail" in run(["ArrowRight / Enter on Entities"], FD(active_seq=["A#sel", "A#sel", "A#sel"]))["steps"][-1]["result"]
    r = run(["ArrowRight / Enter on Missing"], FD(active_seq=["A", "B"]))
    assert not r["steps"][-1]["executed"]
    r = run(["ArrowRight / Enter on Entities"], FD(active_seq=[None, None, None]))
    assert not r["steps"][-1]["executed"]


def test_enter_submit_needs_write_permission_and_evidence():
    r = run(["press Enter in the title field to submit"], FD())
    assert not r["steps"][-1]["executed"] and "allow-write" in r["steps"][-1]["result"]
    wr = {"allow_write": True}
    r = run(["press Enter in the title field to submit"], FD(), write=wr)
    assert r["steps"][-1]["executed"] and "submitted" in r["steps"][-1]["result"]
    r = run(["press Enter in the title field to submit"], FD(writes_on_enter=False), write=wr)
    assert not r["steps"][-1]["executed"] and "not confirmed" in r["steps"][-1]["result"]


def test_escape_closes_dialog_and_nothing_open_is_unverified():
    r = run(["press Esc while open"], FD(popups=1))
    assert "closed" in r["steps"][-1]["result"]
    r = run(["press Esc while open"], FD(popups=0))
    assert not r["steps"][-1]["executed"]


def test_comma_list_maps_each_piece_or_nothing():
    e = repro.expand_step("Tab x10, Esc", "a")
    assert e["mapped"] and [s["action"] for s in e["substeps"]] == ["press", "press"]
    e = repro.expand_step("Tab x10, ??? !!! the thing", "a")
    assert not e["mapped"]


# ----------------------------------------------------------------- 2. viewport / theme
@pytest.mark.parametrize("txt,w,h", [("390x844", 390, 844), ("tablet", 820, 1180), ("desktop", 1440, 900), ("1024×768", 1024, 768), ("at ~390px width", 390, 844)])
def test_viewport_presets(txt, w, h):
    r = V.map_part(txt, txt)
    assert r[0]["action"] == "set_viewport" and (r[0]["w"], r[0]["h"]) == (w, h)


def test_viewport_out_of_range_not_guessed():
    assert V.map_part("90000x10", "x") is V.NOT_MINE or V.map_part("90000x10", "x")[0] is None
    r = V.map_part("5000x5000", "x")
    assert isinstance(r, tuple) and r[0] is None


def test_theme_motion_zoom_offline_actions():
    assert V.map_part("dark theme", "x")[0]["scheme"] == "dark"
    assert V.map_part("reduced motion", "x")[0]["action"] == "set_reduced_motion"
    assert V.map_part("zoom 200%", "x")[0]["zoom"] == 2.0
    assert V.map_part("go back online", "x")[0] == {"action": "set_offline", "offline": False, "raw": "x"}
    d = FD()
    run(["dark theme", "reduced motion", "zoom 150%", "DevTools offline"], d)
    assert (d.scheme, d.rm, d.zoom, d.offline_v) == ("dark", True, 1.5, True)


def test_layout_analysis_pass_fail_unverified():
    ok = {"vw": 390, "vh": 844, "scrollW": 390, "bodyScrollW": 390, "clipped": [], "textOverflow": []}
    assert V.analyze_layout(ok)["state"] == "pass"
    bad = dict(ok, scrollW=520, clipped=[{"sel": "div#x", "left": 380, "right": 500}], textOverflow=["span:Very long"])
    r = V.analyze_layout(bad)
    assert r["state"] == "fail" and len(r["issues"]) == 3
    assert V.analyze_layout(None)["state"] == "unverified" and V.analyze_layout({})["state"] == "unverified"


def test_check_layout_step_uses_driver_and_fails_closed():
    d = FD(); d.layout = {"vw": 390, "vh": 844, "scrollW": 600, "bodyScrollW": 600, "clipped": [], "textOverflow": []}
    r = run(["390x844"], d, expected="No horizontal scroll or clipping.")
    assert r["verdict"] == repro.STILL and "horizontal scroll" in r["notes"]
    d.layout = {"vw": 390, "vh": 844, "scrollW": 390, "bodyScrollW": 390, "clipped": [], "textOverflow": []}
    assert run(["390x844"], d, expected="No horizontal scroll or clipping.")["verdict"] == repro.FIXED
    d2 = FD()   # layout unreadable -> never PASS
    assert run(["390x844"], d2, expected="No horizontal scroll or clipping.")["verdict"] != repro.FIXED


def test_app_theme_toggle_generic_or_pending_capture():
    assert V.find_theme_toggle([{"name": "Toggle dark mode", "role": "button"}]) == "Toggle dark mode"
    assert V.find_theme_toggle([{"name": "Save", "role": "button"}]) is None
    assert V.find_theme_toggle([{"name": "Theme", "role": "button"}, {"name": "Dark mode", "role": "switch"}]) is None   # ambiguous -> never guessed
    r = run(["click the theme toggle"], FD())
    assert not r["steps"][-1]["executed"] and "PENDING_CAPTURE" in r["steps"][-1]["result"]


# ----------------------------------------------------------------- 3. generic observe predicates
def W(**kw):
    base = {"n": 1, "console_new": [], "net": [], "url_before": "/lenses/a", "url_after": "/lenses/a", "alerts_before": [], "alerts_after": [],
            "rows_before": 2, "rows_after": 2, "spinner_before": False, "spinner_after": False, "blank": False, "boundary": False}
    base.update(kw)
    return base


def test_console_predicate():
    assert O.no_new_console_errors({"obs": [W()]})[0] == "pass"
    assert O.no_new_console_errors({"obs": [W(console_new=["TypeError x"])]})[0] == "fail"
    assert O.no_new_console_errors({})[0] == "unverified"


def test_http_error_predicate_and_allowlist():
    net = [{"method": "GET", "path": "/api/a", "status": 200}, {"method": "POST", "path": "/api/b", "status": 403}]
    assert O.no_http_errors({"obs": [W(net=net)]})[0] == "fail"
    assert O.no_http_errors({"obs": [W(net=net)]}, allow=[403])[0] == "pass"
    assert O.expected_http_error({"obs": [W(net=net)]}, [403])[0] == "pass"
    assert O.expected_http_error({"obs": [W(net=net[:1])]}, [403])[0] == "fail"
    tele = [{"method": "POST", "path": "/api/telemetry/vitals", "status": 500}]
    assert O.no_http_errors({"obs": [W(net=tele)]})[0] == "pass"


def test_toast_url_count_spinner_blank():
    assert O.toast_present({"obs": [W(alerts_after=["Saved!"])]}, "Saved")[0] == "pass"
    assert O.toast_present({"obs": [W(alerts_after=[])]}, "Saved")[0] == "fail"
    assert O.toast_present({"obs": [W(alerts_after=["Saved!"])]}, "Saved", present=False)[0] == "fail"
    assert O.url_changed({"obs": [W(url_after="/lenses/b")]})[0] == "pass"
    assert O.url_changed({"obs": [W()]})[0] == "fail"
    assert O.url_changed({"obs": [W()]}, changed=False)[0] == "pass"
    assert O.count_changed({"obs": [W(rows_after=3)]}, "more")[0] == "pass"
    assert O.count_changed({"obs": [W()]}, "more")[0] == "fail"
    assert O.count_changed({"obs": [W(rows_before=None)]})[0] == "unverified"
    assert O.spinner_resolved({"obs": [W(spinner_after=True)]})[0] == "fail"
    assert O.spinner_resolved({"obs": [W(spinner_after=None)]})[0] == "unverified"
    assert O.not_blank({"obs": [W(blank=True)]})[0] == "fail"
    assert O.not_blank({"obs": [W(boundary=True)]})[0] == "fail"
    assert O.not_blank({"obs": [W()]})[0] == "pass"


def test_window_from_snapshots_detects_boundary_and_blank():
    w = O.window_from({"url": "/a", "list_items": ["x"]}, {"url": "/a", "controls": [], "texts": ["Something went wrong"], "list_items": ["x", "y"]}, ["boom"], [])
    assert w["boundary"] is True and w["rows_after"] == 2 and w["console_new"] == ["boom"]
    w = O.window_from({}, {"controls": [], "texts": []})
    assert w["blank"] is True


def test_persistence_uses_walkers_own_value_only():
    ev = {"reloaded": True, "own_values": ["qa-walker 123"], "after_reload": {"texts": ["qa-walker 123 note"], "names": []}}
    assert O.persisted_after_reload(ev)[0] == "pass"
    ev["after_reload"] = {"texts": ["other"], "names": []}
    assert O.persisted_after_reload(ev)[0] == "fail"
    assert O.persisted_after_reload({"reloaded": True, "own_values": [], "after_reload": {"texts": [], "names": []}})[0] == "unverified"
    assert O.persisted_after_reload({"own_values": ["x"]})[0] == "unverified"


@pytest.mark.parametrize("clause,kind", [("No new console errors appear", "g_no_console_error"), ("The URL changes to /lenses/b", "g_url_changed"), ("A toast \"Saved\" appears", "g_toast_shown"),
                                         ("The page is not blank", "g_not_blank"), ("The spinner disappears", "g_spinner_resolves"), ("There are no 4xx/5xx responses", "net_class"),
                                         ("The request should return 403", "net_status"), ("The new item still appears after reload", "g_persists")])
def test_clause_classification(clause, kind):
    got = X.classify_clause(clause, repro._check_legacy)
    assert got and got[0]["kind"] == kind, got


def test_vague_clause_is_never_classified():
    assert X.classify_clause("It feels smooth and works properly", repro._check_legacy) is None
    assert X.classify_clause("Layout looks right", repro._check_legacy) is None


def test_end_to_end_generic_expected_pass_and_fail_closed():
    d = FD()
    d.resp = []
    r = run(["Tab x3"], FD(focus_seq=["a", "b", "c"]), expected="The page is not blank.")
    assert r["expected"]["state"] == "pass" and r["verdict"] == repro.FIXED
    d = FD(focus_seq=["a", "b", "c"]); d.texts, d.controls = [], []
    r = run(["Tab x3"], d, expected="The page is not blank.")
    assert r["expected"]["state"] == "fail" and r["verdict"] == repro.STILL
    class NoSnap(FD):
        obs_mark = None
    d = FD(focus_seq=["a", "b", "c"]); d.obs_mark = None
    r = run(["Tab x3"], d, expected="No new console errors in this step window and the URL changes to /lenses/zzz.")
    assert r["verdict"] != repro.FIXED


# ----------------------------------------------------------------- 4. network-backed
def R(method, path, status, leaf=(), ids=(), shape=None):
    return {"method": method, "path": path, "status": status, "leaf": [N.h(x) for x in leaf], "ids": [N.h(x) for x in ids], "shape": shape}


def test_status_class_and_shape_never_values():
    ev = {"obs": [W(net=[R("POST", "/api/items", 201, shape={"id": "string", "name": "string"})])]}
    assert N.status_class_check(ev, "2xx")[0] == "pass"
    assert N.status_class_check({"obs": [W(net=[R("POST", "/api/items", 500)])]}, "2xx")[0] == "fail"
    assert N.status_class_check({"obs": [W(net=[])]}, "2xx")[0] == "unverified"
    assert N.shape_check(ev, ["id:string", "name"])[0] == "pass"
    assert N.shape_check(ev, ["id:number"])[0] == "fail"
    assert N.shape_check(ev, ["missing"])[0] == "fail"
    assert N.shape_check({"obs": [W(net=[R("POST", "/api/items", 201)])]}, ["id"])[0] == "unverified"
    assert "value" not in str(N.shape_of({"name": "SECRET-VALUE-123"}))


def test_shape_of_redacts_secret_keys():
    assert N.shape_of({"token": "abc", "n": 1}) == {"n": "number", "token": "redacted"}


def test_readback_pass_fail_unverified():
    mine = "qa-walker-777"
    create = R("POST", "/api/items", 201, leaf=[mine, "id-1"], ids=["id-1"])
    list_ok = R("GET", "/api/items", 200, leaf=["id-1", "other"])
    list_missing = R("GET", "/api/items", 200, leaf=["other"])
    ev = lambda *rows: {"own_values": [mine], "obs": [W(net=[create]), W(net=list(rows))]}
    assert N.readback_check(ev(list_ok))[0] == "pass"
    assert N.readback_check(ev(list_missing))[0] == "fail"
    st, why = N.readback_check(ev())
    assert st == "unverified" and "PENDING_CAPTURE" in why
    assert N.readback_check({"own_values": [mine], "obs": [W(net=[R("POST", "/api/items", 500)])]})[0] == "unverified"
    st, why = N.readback_check({"own_values": [mine], "obs": [W(net=[R("POST", "/api/lens/run", 200, ids=["x"], leaf=["x"])])]})
    assert st == "unverified" and "PENDING_CAPTURE" in why
    st, _ = N.readback_check({"own_values": [mine], "obs": [W(net=[R("POST", "/api/items", 201)])]})
    assert st == "unverified"      # create returned no id and no echo: nothing to match by


def test_readback_composes_with_wiring_flows():
    create = R("POST", "/api/items", 201, leaf=["id-1"], ids=["id-1"])
    wiring = {"flows": [{"resource": "/api/items", "kinds": ["create", "list"]}]}
    st, why = N.readback_check({"obs": [W(net=[create])]}, own_values=["v"], wiring=wiring)
    assert st == "unverified" and "create" in why        # the flow hint is surfaced, still fail-closed


def test_netcheck_clause_kinds_end_to_end():
    assert X.classify_clause("The POST returns 2xx", repro._check_legacy)[0]["kind"] == "g_net_status_class"
    sp = X.classify_clause("The response includes `id` and `name`", repro._check_legacy)
    assert sp and sp[0]["kind"] == "g_net_shape" and sp[0]["keys"] == ["id", "name"]
    st, _ = N.check(sp[0], {"evidence": {}})
    assert st == "unchecked"
