#!/usr/bin/env python3
"""WALK-04e self-test (seat B10): click-sends-request + reload persistence.

Tier 1 (always runs, no browser): the pure decision tables, the computed-value
oracle, the PNG uniformity probe, the AX helpers, the CDP Network tap against a
fake session, and the no-page-JS grep over clickpersist.py.
Tier 2 (runs only where Playwright + Chromium exist): drives the buggy/fixed
fake-lens pairs in fixture_app_04e.py through the real recipes. Buggy must come
back STILL_FAILING, fixed FIXED, a missing element NEEDS_HUMAN — never the
reverse. What ran is printed; a skipped tier is declared, never implied.
"""
import json, os, re, struct, sys, tempfile, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, WALKER)
sys.path.insert(0, HERE)

from concord_walker import clickpersist as cp
from concord_walker.cdp import AXTree

results = {}


def check(name, cond):
    results[name] = bool(cond)
    print(("PASS " if cond else "FAIL ") + name, flush=True)


# ---------------------------------------------------------------- tier 1
def tier1():
    D = cp.decide_click
    check("t1 toast-only is STILL", D(element_found=True, has_box=True, statuses=[], any_request=False,
                                      toast="Saved!", ax_changed=True, record_after_reload=False)[0] == cp.STILL)
    check("t1 dead click (nothing happens) is STILL", D(element_found=True, has_box=True, statuses=[], any_request=False,
                                                        toast=None, ax_changed=False, record_after_reload=None)[0] == cp.STILL)
    check("t1 5xx is STILL", D(element_found=True, has_box=True, statuses=[500], any_request=True,
                               toast=None, ax_changed=True, record_after_reload=None)[0] == cp.STILL)
    check("t1 request + record after reload is FIXED", D(element_found=True, has_box=True, statuses=[200], any_request=True,
                                                         toast="Saved!", ax_changed=True, record_after_reload=True)[0] == cp.FIXED)
    check("t1 request but record lost on reload is STILL", D(element_found=True, has_box=True, statuses=[200], any_request=True,
                                                             toast=None, ax_changed=True, record_after_reload=False)[0] == cp.STILL)
    check("t1 missing element is HUMAN", D(element_found=False, has_box=False, statuses=[], any_request=False,
                                           toast=None, ax_changed=False, record_after_reload=None)[0] == cp.HUMAN)
    check("t1 unrendered control is STILL", D(element_found=True, has_box=False, statuses=[], any_request=False,
                                              toast=None, ax_changed=False, record_after_reload=None)[0] == cp.STILL)

    P = cp.decide_persistence
    check("t1 persistence full read-back is FIXED", P(seen_now=True, seen_after_reload=True, seen_new_context=True)[0] == cp.FIXED)
    check("t1 persistence lost on reload is STILL", P(seen_now=True, seen_after_reload=False, seen_new_context=False)[0] == cp.STILL)
    check("t1 persistence session-local is STILL", P(seen_now=True, seen_after_reload=True, seen_new_context=False)[0] == cp.STILL)
    check("t1 persistence nothing to test is HUMAN", P(seen_now=False, seen_after_reload=False, seen_new_context=False)[0] == cp.HUMAN)

    ticket = "Total is wrong: quantity 2 at $3.50 each, expected total $7.00 on the receipt"
    check("t1 oracle match is FIXED", cp.decide_computed(displayed_text="Quantity: 2 | Unit price: $3.50 | Total: $7.00",
                                                         ticket_text_value=ticket)[0] == cp.FIXED)
    check("t1 oracle mismatch is STILL", cp.decide_computed(displayed_text="Quantity: 2 | Unit price: $3.50 | Total: $7.50",
                                                            ticket_text_value=ticket)[0] == cp.STILL)
    check("t1 oracle absent is HUMAN", cp.decide_computed(displayed_text="Total: $7.00",
                                                          ticket_text_value="the total looks off somehow")[0] == cp.HUMAN)

    def make_png(pixels, w=8, h=8):
        raw = b""
        for y in range(h):
            raw += b"\x00" + bytes(pixels[y * w:(y + 1) * w] * 3 if isinstance(pixels[0], int) else b"".join(pixels))
        def chunk(typ, data):
            c = struct.pack(">I", len(data)) + typ + data
            return c + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
        ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
        return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

    solid = make_png([128] * 64)
    noise = make_png([(i * 37) % 256 for i in range(64)])
    check("t1 solid png reads uniform", cp.png_looks_uniform(solid) is True)
    check("t1 noisy png reads not uniform", cp.png_looks_uniform(noise) is False)
    check("t1 non-png reads None", cp.png_looks_uniform(b"not a png") is None)

    def ax_of(nodes):
        return AXTree([{"nodeId": str(i + 1), "role": {"value": r}, "name": {"value": n},
                        "backendDOMNodeId": 100 + i, "ignored": False,
                        "properties": [{"name": "disabled", "value": {"value": dis}}] if dis else []}
                       for i, (r, n, dis) in enumerate(nodes)])
    ax = ax_of([("button", "Save record", False), ("status", "Saved!", False), ("button", "Off", True)])
    check("t1 find_clickable finds enabled button", cp.find_clickable(ax, "Save record") is not None)
    check("t1 find_clickable skips disabled", cp.find_clickable(ax, "Off") is None)
    check("t1 toast_seen reads status", cp.toast_seen(ax) == "Saved!")
    check("t1 label_visible", cp.label_visible(ax, "Save") is True)

    class FakeSession:
        def __init__(self):
            self.handlers = {}
        def send(self, method, params=None):
            return {}
        def on(self, event, handler):
            self.handlers[event] = handler
    class FakeCdp:
        def __init__(self):
            self.s = FakeSession()
    tap = cp.NetworkTap(FakeCdp()).arm()
    tap.cdp.s.handlers["Network.requestWillBeSent"]({"requestId": "1", "request": {"url": "http://x/api/items", "method": "POST"}})
    tap.cdp.s.handlers["Network.responseReceived"]({"requestId": "1", "response": {"url": "http://x/api/items", "status": 201}})
    check("t1 tap records the write", len(tap.writes_since(0)) == 1)
    check("t1 tap records the status", tap.statuses_since(0) == [201])

    banned = re.compile(r"\.(evaluate|evaluate_handle|locator|query_selector|query_selector_all|add_init_script|add_script_tag|expose_function|expose_binding|fill|get_by_\w+|wait_for_selector|wait_for_function|route)\(|Runtime\.evaluate|Runtime\.callFunctionOn")
    src = open(os.path.join(WALKER, "concord_walker", "clickpersist.py")).read()
    hits = [i + 1 for i, line in enumerate(src.splitlines()) if banned.search(line)]
    check("t1 clickpersist has no page-JS calls", not hits)
    if hits:
        print("  banned-pattern lines:", hits)


# ---------------------------------------------------------------- tier 2
def tier2():
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        print("TIER 2 SKIPPED — playwright unavailable (%s). Tier 2 did NOT run." % e)
        results["tier2_ran"] = False
        return
    from fixture_app_04e import serve, SAVED, UPLOADS
    from concord_walker.cdp import Cdp

    srv = serve()
    base = "http://127.0.0.1:%d" % srv.server_address[1]
    tmp = tempfile.mkdtemp(prefix="walk04e-")
    label = "qa-walker-04e-item"

    png = os.path.join(tmp, "tiny.png")
    with open(png, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)

    class Shim:
        def shot(self, page, name):
            p = os.path.join(tmp, name + ".png")
            try:
                page.screenshot(path=p)
            except Exception:
                return None
            return p

    shim = Shim()
    outcomes = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        def open_page(url):
            ctx = browser.new_context()
            page = ctx.new_page()
            page.goto(url)
            return ctx, page, Cdp(ctx, page)
        def close_ctx(ctx):
            try:
                ctx.close()
            except Exception:
                pass

        # click: buggy (toast-only) / fixed / boom (5xx) / missing element
        for variant, want in (("buggy", cp.STILL), ("fixed", cp.FIXED), ("boom", cp.STILL)):
            SAVED.clear()
            ctx, page, cdp = open_page(base + "/lenses/click?v=%s&label=%s" % (variant, label))
            r = cp.click_recipe(shim, page, cdp, element_name="Save record", label=label)
            outcomes["click_" + variant] = (r["verdict"], want, r["notes"])
            close_ctx(ctx)
        ctx, page, cdp = open_page(base + "/lenses/click?v=fixed&label=%s" % label)
        r = cp.click_recipe(shim, page, cdp, element_name="No such button", label=label)
        outcomes["click_missing"] = (r["verdict"], cp.HUMAN, r["notes"])
        close_ctx(ctx)

        # persistence: buggy (session-local) / fixed
        for variant, want in (("buggy", cp.STILL), ("fixed", cp.FIXED)):
            SAVED.clear()
            url = base + "/lenses/persist?v=%s&label=%s" % (variant, label)
            ctx, page, cdp = open_page(url)
            node = cp.find_clickable(cdp.ax(), "Create record")
            cdp.click(node.backend)
            page.wait_for_timeout(700)
            def open_fresh(url=url):
                return open_page(url)
            r = cp.persistence_recipe(shim, page, cdp, label=label, open_fresh=open_fresh, close_ctx=close_ctx)
            outcomes["persist_" + variant] = (r["verdict"], want, r["notes"])
            close_ctx(ctx)

        # computed: buggy ($7.50) / fixed ($7.00)
        ticket = "Total is wrong: quantity 2 at $3.50 each, expected total $7.00"
        for variant, want in (("buggy", cp.STILL), ("fixed", cp.FIXED)):
            ctx, page, cdp = open_page(base + "/lenses/computed?v=%s" % variant)
            r = cp.computed_recipe(shim, page, cdp, ticket_text_value=ticket, display_pattern="Total")
            outcomes["computed_" + variant] = (r["verdict"], want, r["notes"])
            close_ctx(ctx)

        # upload: buggy (discards) / fixed
        for variant, want in (("buggy", cp.STILL), ("fixed", cp.FIXED)):
            UPLOADS.clear()
            ctx, page, cdp = open_page(base + "/lenses/upload?v=%s" % variant)
            r = cp.upload_recipe(shim, page, cdp, fixture_path=png, fixture_name="tiny.png")
            outcomes["upload_" + variant] = (r["verdict"], want, r["notes"])
            close_ctx(ctx)
        browser.close()
    srv.shutdown()
    results["tier2_ran"] = True
    for name, (got, want, notes) in sorted(outcomes.items()):
        check("t2 " + name, got == want)
        if got != want:
            print("   got %s want %s — %s" % (got, want, notes))


tier1()
tier2()
failed = [k for k, v in results.items() if v is False and k != "tier2_ran"]
print(json.dumps({k: v for k, v in results.items()}, indent=1))
print("WALK-04e SELFTEST", "FAIL: %s" % failed if failed else "PASS",
      "(tier2 ran: %s)" % results.get("tier2_ran"))
sys.exit(1 if failed else 0)
