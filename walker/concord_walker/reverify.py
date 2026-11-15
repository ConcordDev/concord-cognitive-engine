"""Re-verify mode: replay a ticket's repro (recipe or classified standard check), plus a
read-only nearby smoke of the same lens, and decide FIXED / STILL_FAILING / NEEDS_HUMAN.
Judgment calls are never auto-decided: they go to the needs-tester queue."""
import re, time
from .checks import LensWalk
from .formfuzz import run_validation_recipe
from .cdp import wait_until
from .auth import assert_account, AccountMismatch
from .tickets import CATEGORY_WORDS
from .util import scrub, ts_et, control_label
from .matching import fuzzy_match, match_any
from . import colors

try:
    from .vision import VisionJudge, wants_visual
except Exception:  # WALK-04d is additive; its absence never breaks the walker
    VisionJudge = None
    wants_visual = lambda t: False
from . import hiddentext

FIXED, STILL, HUMAN = "FIXED", "STILL_FAILING", "NEEDS_HUMAN"
ORDER = ["crash", "hotkey", "delete_confirm", "escape", "focus_return", "focus_trap", "focus_visible", "export",
         "contrast", "overflow390", "unnamed", "keyboard", "timing", "chat", "validation", "hidden_text", "tab_error", "reach", "pageerror", "http", "persistence"]
WRITE_CATS = {"hotkey", "delete_confirm", "persistence", "chat", "validation"}


def ticket_text(t):
    rs = t.get("repro_steps")
    rs = " ".join(rs) if isinstance(rs, list) else (rs or "")
    return " ".join(str(t.get(k) or "") for k in ("title", "actual", "expected")) + " " + rs


def classify(t):
    txt = ticket_text(t).lower()
    title = (t.get("title") or "").lower()
    # Title wins: first category whose words hit the title, else the whole text.
    for scope in (title, txt):
        for c in ORDER:
            if re.search(CATEGORY_WORDS[c], scope):
                return c
    return None


_UI_NOUN = r"(?:dialog|modal|tab|panel|menu|drawer|popup|picker|editor|window|sheet|popover|button|field|input|toggle|switch|link)"


def _unquoted_names(txt):
    """Element names written in prose, without quotes: the span of words right
    before a UI noun ("... New Proposal or Schedule Meeting dialogs" -> both
    names), split on "or"/"and" and cleaned to the trailing capitalised phrase."""
    out = []
    for m in re.finditer(r"([A-Za-z][A-Za-z0-9'&.-]*(?: [A-Za-z][A-Za-z0-9'&.-]*){0,5}?) " + _UI_NOUN + r"s?\b", txt or ""):
        for piece in re.split(r" or | and ", m.group(1)):
            keep = []
            for w in reversed([w.strip("'\"\u2018\u2019\u201c\u201d") for w in piece.split()]):
                if w[:1].isupper() or w.lower() in ("of", "&", "the"):
                    keep.append(w)
                else:
                    break
            keep.reverse()
            while keep and keep[0].lower() in ("the", "of", "&"):
                keep.pop(0)
            if keep and any(w[:1].isupper() for w in keep):
                out.append(" ".join(keep))
    return out


def elements(t):
    txt = (t.get("title") or "") + " " + (t.get("actual") or "")
    names = re.findall(r"(?<![A-Za-z])'([^']{2,40})'(?![A-Za-z])|\"([^\"]{2,40})\"|\u2018([^\u2019]{2,40})\u2019|\u201c([^\u201d]{2,40})\u201d", txt)
    quoted = [next(x for x in g if x) for g in names]
    out = list(quoted)
    for n in _unquoted_names(ticket_text(t)):
        if n not in out:
            out.append(n)
    return out


def ticket_path(t):
    """The path a ticket's own repro names (/lenses/<slug>[/...]), or None.
    WALK-03: reach must load this path, not just the lens root."""
    m = re.search(r"(?:https?://[^\s\"'<>]+)?(/lenses/[a-z0-9\-]+(?:/[a-z0-9\-]+)*)", ticket_text(t))
    return m.group(1) if m else None


def wants_mobile(t):
    return bool(re.search(r"390|mobile|phone|narrow", ticket_text(t), re.I))


class Reverifier:
    def __init__(self, browser, cfg, rec, store, log, inventory, allow_write=False):
        self.b, self.cfg, self.rec, self.store, self.log = browser, cfg, rec, store, log
        self.inv = {l["slug"]: l for l in inventory}
        self.allow_write = allow_write
        self.walks = {}
        self.recipes = {"FIX-007": self.r_fix007, "FIX-deities-002": self.r_deities_002,
                        # WALK-04g prod rows — POST-DEPLOY ONLY (GB-1544):
                        # recipes exist; no live run until the deploy lands.
                        "FIX-chem-003": self._prod_scan, "FIX-docs-015": self._prod_scan,
                        "FIX-global-016": self._prod_scan, "FIX-metalearning-014": self._prod_scan,
                        "FIX-repos-002": self._prod_reload, "FIX-ingest-001": self._prod_compare}
        self.vision = VisionJudge(cfg, rec, log) if VisionJudge else None
        from .chatcheck import SendBudget
        self.chat_budget = SendBudget(cfg)

    def account_for(self, lens):
        if lens in self.cfg["admin_lenses"]:
            from .auth import has_session
            return ("admin", True) if has_session(self.cfg, "admin") else ("t1", False)
        return ("t1", False)

    def smoke(self, lens, write=False):
        key = (lens, write)
        if key not in self.walks:
            acct, admin = self.account_for(lens)
            lw = LensWalk(self.b, self.cfg, self.rec, self.inv[lens], acct, self.log, allow_write=write, admin=admin,
                          inv_entry=self.inv[lens],
                          phases=["reach", "surface", "tabs", "keyboard", "openers", "export", "contrast", "mobile"] + (["write"] if write else []))
            lw.run()
            self.walks[key] = lw
        return self.walks[key]

    @staticmethod
    def _row(r):
        return ", ".join("%s=%s" % (k, v) for k, v in r.items() if k != "evidence")

    def run(self, tid):
        t = self.store.get(tid)
        if not t:
            return {"id": tid, "verdict": HUMAN, "method": "none", "notes": "ticket id not found in fix_tickets.jsonl"}
        lens = t.get("lens")
        if lens not in self.inv:
            return {"id": tid, "lens": lens, "verdict": HUMAN, "method": "none", "notes": "lens not in inventory"}
        self.log("reverify %s (%s, status %s)" % (tid, lens, t.get("status")))
        if tid in self.recipes:
            res = self.recipes[tid](t)
        else:
            res = self.generic(t)
        lw = self.smoke(lens)
        res.update(id=tid, lens=lens, prior_status=t.get("status") or "OPEN",
                   smoke={"findings": len(lw.findings), "checks": {k: v.get("status") for k, v in lw.result["checks"].items()}})
        res["evidence"] = list(dict.fromkeys(e for e in (res.get("evidence") or []) if e))
        if res["verdict"] == HUMAN:
            self.rec.judgment(lens, "reverify", "%s: %s" % (tid, res.get("notes", "")), res.get("evidence"), ticket_id=tid)
        return res

    # ------------------------------------------------------------ generic
    def _vision_or_human(self, t, cat, method, ev, notes):
        """WALK-04d: a visual row the deterministic checks cannot decide goes
        to the vision judge when it is enabled; whenever the judge declines
        (disabled, no pair, demoted category handled inside), the pre-upgrade
        NEEDS_HUMAN return stands byte for byte."""
        if self.vision is not None:
            res = self.vision.judge_ticket(self, t, cat, mobile=wants_mobile(t))
            if res is not None:
                return res
        return {"verdict": HUMAN, "method": method, "category": cat, "evidence": ev, "notes": notes}

    def generic(self, t):
        cat = classify(t)
        elems = elements(t)
        if cat is None:
            if wants_visual(t) and self.vision is not None:
                res = self.vision.judge_ticket(self, t, "visual", mobile=wants_mobile(t))
                if res is not None:
                    return res
            lw = self.smoke(t["lens"])
            return {"verdict": HUMAN, "method": "smoke-only", "category": None, "evidence": [lw.result.get("initial_evidence")],
                    "notes": "repro not automatable (no standard check matches); screenshot + smoke attached"}
        if cat in WRITE_CATS and not self.allow_write:
            lw = self.smoke(t["lens"])
            return {"verdict": HUMAN, "method": "needs-write", "category": cat, "evidence": [lw.result.get("initial_evidence")],
                    "notes": "repro needs a create/delete; rerun with --allow-write (own labelled fixture) or a tester"}
        if cat == "chat":
            # WALK-04h: the chat recipe drives its own walk (send budget on self).
            from .chatcheck import run_chat_check
            return run_chat_check(self, t)
        if cat == "validation":
            # WALK-04a: the form bad-input recipe drives its own walk.
            return run_validation_recipe(self, t)
        lw = self.smoke(t["lens"], write=(cat in WRITE_CATS))
        same = [f for f in lw.findings if f["check"] == cat or (cat in ("escape", "focus_return", "focus_trap") and f["check"] in ("escape", "focus_return", "focus_trap"))]
        ev = [e for f in same for e in f["evidence"]][:4] or [lw.result.get("initial_evidence")]
        chk = lw.result["checks"]

        def elem_hit(f):
            el = f.get("element") or ""
            return bool(el) and any(fuzzy_match(e, [el]) for e in elems if e)

        if cat == "crash":
            return self._crash_loop(t, mobile=wants_mobile(t))
        if cat == "hidden_text":
            return self._hidden_text(t)
        if cat == "contrast":
            hexes = set(h.lower() for h in re.findall(r"#[0-9a-fA-F]{6}", ticket_text(t)))
            groups = (chk.get("contrast") or {}).get("groups") or []
            if hexes:
                hit = [g for g in groups if g["fg"] in hexes or g["bg"] in hexes]
                return {"verdict": STILL if hit else FIXED, "method": "contrast pairs from DOMSnapshot", "category": cat, "evidence": ev,
                        "notes": "ticket colours %s %s" % (sorted(hexes), "still fail" if hit else "no longer fail AA")}
            # WALK-03: no colours named — a clean main view can no longer verify
            # the ticket. The ticket's tab or element must be walked and the
            # failing pairs attributed (or the scoped view found clean).
            if not elems:
                return self._vision_or_human(t, cat, "contrast", ev,
                        "ticket names no colours and no tab/element to walk; main-view contrast alone cannot verify it")
            chkc = chk.get("contrast") or {}
            groups = chkc.get("groups") or []
            examples = chkc.get("examples") or []
            hit = match_any(elems, [ex.get("text") or "" for ex in examples]) if examples else None
            if hit:
                return {"verdict": STILL, "method": "contrast pairs from DOMSnapshot", "category": cat, "evidence": ev,
                        "notes": "a failing pair sits on text matching the ticket's element ('%s')" % hit}
            scoped = self._contrast_scoped(t, elems)
            if scoped:
                return scoped
            if groups:
                return self._vision_or_human(t, cat, "contrast", ev,
                        "pairs still fail on the walked views but none is attributable to the ticket's element (%s); tester to match element" % (elems,))
            return {"verdict": HUMAN, "method": "contrast", "category": cat, "evidence": ev,
                    "notes": "the ticket's element (%s) was not reached on any walked view" % (elems,)}
        if cat in ("escape", "focus_return", "focus_trap"):
            rows = (chk.get("escape_focus") or {}).get("openers") or []
            tested = [r for r in rows if match_any(elems, [r["opener"]])]
            if not elems or not tested:
                return {"verdict": HUMAN, "method": "openers", "category": cat, "evidence": ev,
                        "notes": "ticket's overlay (%s) not among the safe openers walked (%s)" % (elems or "unnamed", [r["opener"] for r in rows][:6])}
            bad = [f for f in same if elem_hit(f)]
            return {"verdict": STILL if bad else FIXED, "method": "Escape/focus on '%s'" % tested[0]["opener"], "category": cat,
                    "evidence": ev if bad else [tested[0].get("evidence")], "notes": self._row(tested[0])}
        if cat == "export":
            ex = chk.get("export") or {}
            if ex.get("status") == "PASS":
                # WALK-03: a download alone no longer verifies. The file's content
                # must match what the lens shows (checks.py compares per attempt).
                contents = [a.get("content") for a in ex.get("attempts", [])]
                if "wrong" in contents:
                    return {"verdict": STILL, "method": "export content", "category": cat, "evidence": [a.get("file") for a in ex.get("attempts", [])] + ev[:1],
                            "notes": "export downloads, but its content does not match what the lens shows (wrong scope / wrong rows)"}
                if "match" in contents:
                    return {"verdict": FIXED, "method": "export download + content", "category": cat, "evidence": [a.get("file") for a in ex.get("attempts", [])] + ev[:1],
                            "notes": scrub(str(ex.get("attempts")), 200)}
                return {"verdict": HUMAN, "method": "export content", "category": cat, "evidence": ev,
                        "notes": "export downloaded but its content could not be compared with the lens's rows (contents: %s)" % (contents,)}
            if ex.get("status") == "FAIL":
                return {"verdict": STILL, "method": "export download", "category": cat, "evidence": ev, "notes": scrub(str(ex.get("attempts")), 200)}
            return {"verdict": HUMAN, "method": "export", "category": cat, "evidence": ev, "notes": "export status %s (empty/nothing/no control)" % ex.get("status")}
        if cat == "overflow390":
            m = chk.get("mobile_390") or {}
            if elems:
                off = m.get("offscreen") or []
                hit = [o for o in off if match_any(elems, [o])]
                if hit:
                    return {"verdict": STILL, "method": "390 off-screen controls", "category": cat, "evidence": m.get("evidence"), "notes": "still off-screen: %s" % hit}
                return self._vision_or_human(t, cat, "390 layout", m.get("evidence"),
                        "named element not flagged off-screen; tester confirm layout from screenshot")
            if re.search(r"horizontal|sideways|scrolls? (left|right)|overflow", ticket_text(t), re.I):
                over = (m.get("layout") or {}).get("content_w", 0) - (m.get("layout") or {}).get("viewport_w", 390)
                return {"verdict": STILL if over > 2 else FIXED, "method": "390 content width", "category": cat, "evidence": m.get("evidence"),
                        "notes": "content overflow %dpx" % over}
            return self._vision_or_human(t, cat, "390 layout", m.get("evidence"),
                    "visual layout issue; compare 390 screenshot to ticket")
        if cat in ("unnamed", "keyboard", "focus_visible"):
            if same:
                hit = [f for f in same if not elems or elem_hit(f)]
                if hit:
                    return {"verdict": STILL, "method": cat, "category": cat, "evidence": ev, "notes": scrub(hit[0]["actual"], 200)}
            # WALK-03: a clean main view no longer verifies these categories.
            # The ticket's own element must be individually confirmed on the
            # live surface (present with a name / focusable / focus-visible).
            if not elems:
                return {"verdict": HUMAN, "method": cat, "category": cat, "evidence": ev,
                        "notes": "ticket names no element; a clean main view cannot verify a %s ticket" % cat}
            conf = self._elem_confirmed(cat, elems, chk)
            if conf:
                return {"verdict": FIXED, "method": cat + " (element confirmed)", "category": cat, "evidence": ev,
                        "notes": "the ticket's element ('%s') is individually confirmed on the live surface" % conf}
            return {"verdict": HUMAN, "method": cat, "category": cat, "evidence": ev,
                    "notes": "the ticket's element (%s) was not individually confirmed on the live surface" % (elems,)}
        if cat == "timing":
            tm = lw.result.get("timing_desktop") or {}
            slow = [f for f in same if not elems or elem_hit(f)]
            if re.search(r"load", ticket_text(t), re.I) and not elems:
                return {"verdict": STILL if slow else FIXED, "method": "load timing", "category": cat, "evidence": ev,
                        "notes": "load %s ms, settle %s ms" % (tm.get("load_ms"), tm.get("settle_ms"))}
            if slow:
                return {"verdict": STILL, "method": "timing", "category": cat, "evidence": ev, "notes": scrub(slow[0]["actual"], 160)}
            return {"verdict": HUMAN, "method": "timing", "category": cat, "evidence": ev, "notes": "interaction timing not reproducible by standard checks"}
        if cat == "tab_error":
            rows = (chk.get("tabs_reachable") or {}).get("tabs") or []
            tested = [r for r in rows if match_any(elems, [r["tab"]])]
            if tested:
                bad = [r for r in tested if r.get("status") == "FAIL"]
                return {"verdict": STILL if bad else FIXED, "method": "tab click", "category": cat,
                        "evidence": [r.get("evidence") for r in tested], "notes": "; ".join(self._row(r) for r in tested)[:200]}
            return {"verdict": HUMAN, "method": "tab click", "category": cat, "evidence": ev, "notes": "named tab not found among %d tabs" % len(rows)}
        if cat == "reach":
            path = ticket_path(t)
            root = "/" + "/".join([seg for seg in (self.inv[t["lens"]].get("url") or "").split("/") if seg][-2:])
            if path and path.rstrip("/") != root.rstrip("/"):
                # WALK-03: the ticket names its own path — walk THAT, not the root.
                acct, admin = self.account_for(t["lens"])
                phases = ["reach"] + (["mobile"] if wants_mobile(t) else [])
                lw2 = LensWalk(self.b, self.cfg, self.rec, self.inv[t["lens"]], acct, self.log, admin=admin,
                               inv_entry=self.inv[t["lens"]], phases=phases,
                               url_override=self.cfg["base_url"].rstrip("/") + path)
                lw2.run()
                chk2 = lw2.result["checks"]
                okd = (chk2.get("reach_desktop") or {}).get("status") == "PASS"
                okm = (chk2.get("mobile_390") or {}).get("status") != "FAIL" or not wants_mobile(t)
                return {"verdict": FIXED if okd and okm else STILL, "method": "reach at ticket path", "category": cat,
                        "evidence": [lw2.result.get("initial_evidence")] + ev[:1],
                        "notes": "ticket path %s: desktop %s, 390 %s" % (path, (chk2.get("reach_desktop") or {}).get("status"), (chk2.get("mobile_390") or {}).get("status"))}
            okd = (chk.get("reach_desktop") or {}).get("status") == "PASS"
            okm = (chk.get("mobile_390") or {}).get("status") != "FAIL" or not wants_mobile(t)
            return {"verdict": FIXED if okd and okm else STILL, "method": "reach desktop+390", "category": cat, "evidence": ev,
                    "notes": "desktop %s, 390 %s" % ((chk.get("reach_desktop") or {}).get("status"), (chk.get("mobile_390") or {}).get("status"))}
        if cat in ("pageerror", "http"):
            return {"verdict": STILL if same else HUMAN, "method": "console/network", "category": cat, "evidence": ev,
                    "notes": "errors still present" if same else "none seen on walked paths; ticket path may differ"}
        if cat in WRITE_CATS:
            st = (chk.get("create_delete") or {})
            hit = [f for f in lw.findings if f["check"] == cat]
            if st.get("status") == "PASS" and not hit:
                return {"verdict": FIXED, "method": "own fixture create/delete", "category": cat, "evidence": ev, "notes": scrub(str(st), 200)}
            if hit:
                return {"verdict": STILL, "method": "own fixture create/delete", "category": cat, "evidence": ev, "notes": scrub(hit[0]["actual"], 200)}
            return {"verdict": HUMAN, "method": "own fixture create/delete", "category": cat, "evidence": ev, "notes": scrub(str(st), 200)}
        return {"verdict": HUMAN, "method": cat, "category": cat, "evidence": ev, "notes": "no decision rule"}

    @staticmethod
    def _elem_confirmed(cat, elems, chk):
        """WALK-03: the ticket's element, individually confirmed in the surface
        data the smoke walk recorded (checks.py now records control names).
        Returns the matched live name, or None — a walk that predates the
        name lists confirms nothing."""
        surf = chk.get("surface_inventory") or {}
        buttons = surf.get("button_names") or []
        tabs = surf.get("tab_names") or []
        if cat == "unnamed":
            # the control was nameless; it is confirmed when it now HAS a name
            return match_any(elems, buttons + tabs)
        if cat == "keyboard":
            bad = set(surf.get("non_focusable_names") or [])
            return match_any(elems, [n for n in buttons + tabs if n not in bad])
        if cat == "focus_visible":
            kf = chk.get("keyboard_focus") or {}
            if not kf:
                return None
            bad = set(kf.get("no_visible_names") or [])
            return match_any(elems, [n for n in buttons + tabs if n not in bad])
        return None

    def _contrast_scoped(self, t, elems):
        """WALK-03: walk the ticket's own tab (fuzzy-resolved) and measure THAT
        view's contrast; without a tab match, measure the main view and require
        the element itself to be on it. Returns a verdict dict or None when no
        scoped view could be measured / attributed."""
        lens = t["lens"]
        acct, admin = self.account_for(lens)
        lw = LensWalk(self.b, self.cfg, self.rec, self.inv[lens], acct, self.log, admin=admin,
                      inv_entry=self.inv[lens], phases=[])
        ctx, page, cdp = lw.open()
        try:
            if acct:
                assert_account(ctx, self.cfg, acct, "contrast scope", self.log)
            lw.nav(page, cdp)
            tab = match_any(elems, [n.name for n in cdp.ax().by_role("tab") if n.name])
            res = lw.contrast_view(page, cdp, tab_name=tab)
            if res is None:
                return None
            fails = res["failing_groups"]
            hit = match_any(elems, [e.get("text") or "" for e in res["examples"]]) if res["examples"] else None
            ev = [lw.shot(page, "contrast-scoped")]
            where = ("tab '%s'" % tab) if tab else "main view"
            if hit:
                return {"verdict": STILL, "method": "contrast scoped view", "category": "contrast", "evidence": ev,
                        "notes": "a failing pair sits on text matching the ticket's element ('%s') in the %s view" % (hit, where)}
            if not fails:
                if tab or match_any(elems, lw.visible_texts(page, cdp)):
                    return {"verdict": FIXED, "method": "contrast scoped view", "category": "contrast", "evidence": ev,
                            "notes": "no failing pair on the %s view (the ticket's scope), %d pairs checked" % (where, res["checked"])}
                return None  # clean view, but the element is not on it: wrong scope
            return None  # failures on the scoped view, none attributable
        finally:
            lw._close(ctx)

    def _crash_loop(self, t, mobile=True, n=10):
        lens = t["lens"]
        acct, admin = self.account_for(lens)
        lw = LensWalk(self.b, self.cfg, self.rec, self.inv[lens], acct, self.log, admin=admin, inv_entry=self.inv[lens])
        crashes, evid, loads = 0, [], []
        for i in range(n):
            ctx, page, cdp = lw.open(mobile=mobile)
            try:
                if acct:
                    assert_account(ctx, self.cfg, acct, "crash loop", self.log)
                c0 = lw.crashes
                tm = lw.nav(page, cdp)
                try:
                    page.reload(wait_until="load", timeout=self.cfg["thresholds"]["nav_timeout_ms"])
                except Exception:
                    pass
                time.sleep(1.0)
                alive = True
                try:
                    cdp.ax()
                except Exception:
                    alive = False
                loads.append(tm["load_ms"])
                if lw.crashes > c0 or not alive:
                    crashes += 1
                    evid.append(lw.shot(page, "crash-iter-%d" % i))
                elif i == n - 1:
                    evid.append(lw.shot(page, "crash-loop-final"))
            finally:
                lw._close(ctx)
        return {"verdict": STILL if crashes else FIXED, "method": "%d cold loads + reload at %s" % (n, "390x844" if mobile else "1280x900"),
                "category": "crash", "evidence": [e for e in evid if e],
                "notes": "%d/%d crashed; load ms %s%s" % (crashes, n, loads, "" if crashes else " (intermittent bug: 'not reproduced in %d tries')" % n)}

    # ------------------------------------------------ hidden text (WALK-04g)
    def _hidden_text(self, t, reloads=1):
        """DOMSnapshot hidden-vs-visible scan for AI-directed phrasing
        and harness strings (concord_walker/hiddentext.py). Hidden
        findings or visible harness text -> STILL; a clean scan ->
        FIXED; no snapshot -> NEEDS_HUMAN, never a pass."""
        lens = t["lens"]
        acct, admin = self.account_for(lens)
        lw = LensWalk(self.b, self.cfg, self.rec, self.inv[lens], acct, self.log, admin=admin, inv_entry=self.inv[lens])
        ctx, page, cdp = lw.open()
        try:
            if acct:
                assert_account(ctx, self.cfg, acct, "hidden-text scan", self.log)
            lw.nav(page, cdp)
            targets = hiddentext.targets_from_ticket(t, quoted=elements(t))
            if reloads > 1:
                def provider(i):
                    if i:
                        try:
                            page.reload(wait_until="load", timeout=self.cfg["thresholds"]["nav_timeout_ms"])
                        except Exception:
                            return None
                    try:
                        return hiddentext.capture(cdp.s)
                    except Exception:
                        return None
                res = hiddentext.reload_capture(provider, targets, n=reloads)
                if res["loads_ok"] == 0:
                    return {"verdict": HUMAN, "method": "hidden-text reload capture", "category": "hidden_text",
                            "evidence": [], "notes": "no snapshot could be captured in %d loads" % reloads}
                findings = res["findings"]
                ev = [lw.shot(page, "hidden-text-reload")]
                scope = "%d loads (%d ok), per-load findings %s" % (reloads, res["loads_ok"], res["per_load"])
            else:
                res = hiddentext.scan_cdp(cdp, targets)
                if res is None:
                    return {"verdict": HUMAN, "method": "hidden-text scan", "category": "hidden_text",
                            "evidence": [], "notes": "DOMSnapshot capture failed; unscannable lens"}
                findings = res["findings"]
                ev = [lw.shot(page, "hidden-text-scan")]
                scope = "%d text nodes checked, %d visible" % (res["checked"], res["visible"])
            hid = [f for f in findings if f["kind"] == "hidden"]
            vis = [f for f in findings if f["kind"] == "visible_harness"]
            if hid or vis:
                first = (hid or vis)[0]
                return {"verdict": STILL, "method": "DOMSnapshot hidden-text scan", "category": "hidden_text",
                        "evidence": ev,
                        "notes": "%s; %d hidden + %d visible-harness findings; first: %s at %s (%s)" % (
                            scope, len(hid), len(vis), scrub(first["text"], 120), first["path"],
                            ",".join(first["classes"]) or "visible")}
            return {"verdict": FIXED, "method": "DOMSnapshot hidden-text scan", "category": "hidden_text",
                    "evidence": ev, "notes": "%s; no hidden or harness text found" % scope}
        finally:
            lw._close(ctx)

    # WALK-04g prod rows — POST-DEPLOY ONLY (GB-1544): the recipes
    # exist so the post-deploy run can execute them; nothing here runs
    # live before the combined deploy lands (GB-1542).
    def _prod_scan(self, t):
        return self._hidden_text(t)

    def _prod_reload(self, t):
        # repos-002: the injection is intermittent — capture 10 loads.
        return self._hidden_text(t, reloads=10)

    def _prod_compare(self, t):
        # ingest-001: one DTU id in global search but not in the lens's
        # own list (or the reverse). The list side is gathered here; the
        # global-search side is a live shell walk that does not exist in
        # the walker's route set yet, so the recipe returns the gathered
        # half + NEEDS_HUMAN naming the missing leg, never a verdict
        # from half the evidence.
        elems = elements(t)
        if not elems:
            return {"verdict": HUMAN, "method": "search/list compare", "category": "hidden_text",
                    "evidence": [], "notes": "ticket names no DTU id to compare"}
        needle = elems[0]
        lens = t["lens"]
        acct, admin = self.account_for(lens)
        lw = LensWalk(self.b, self.cfg, self.rec, self.inv[lens], acct, self.log, admin=admin, inv_entry=self.inv[lens])
        ctx, page, cdp = lw.open()
        try:
            if acct:
                assert_account(ctx, self.cfg, acct, "search/list compare", self.log)
            lw.nav(page, cdp)
            list_texts = cdp.ax().texts()
            cmp = hiddentext.search_compare([], list_texts, needle)
            return {"verdict": HUMAN, "method": "search/list compare", "category": "hidden_text",
                    "evidence": [lw.shot(page, "ingest-compare-list")],
                    "notes": "list side gathered: needle %r %s in the lens list; global-search side not walkable in this build — tester completes the compare" % (
                        needle, "present" if cmp["in_list"] else "absent")}
        finally:
            lw._close(ctx)

    # ------------------------------------------------------------ recipes
    def r_deities_002(self, t):
        # Ticket: first 390x844 reload crashed the tab ('Aw, Snap!' code 9); second reload OK.
        return self._crash_loop(t, mobile=True, n=10)

    def r_fix007(self, t):
        # Ticket: mobile chat composer fill/click timeouts at 390x844; expected composer accepts input and send works.
        lens = t["lens"]
        lw = LensWalk(self.b, self.cfg, self.rec, self.inv[lens], "t1", self.log, inv_entry=self.inv[lens])
        ctx, page, cdp = lw.open(mobile=True)
        try:
            assert_account(ctx, self.cfg, "t1", "chat composer check", self.log)
            lw.nav(page, cdp)
            ax = cdp.ax()
            boxes = [n for n in ax.by_role("textbox") if n.backend and not n.disabled]
            comp = next((n for n in boxes if re.search(r"(?i)message|ask|chat|type|prompt|say", n.name)), boxes[-1] if boxes else None)
            if not comp:
                ev = lw.shot(page, "fix007-no-composer")
                return {"verdict": STILL, "method": "390 composer", "evidence": [ev], "notes": "no composer textbox found at 390x844"}
            probe = "qa-walker composer check"
            t0 = time.time()
            clicked = cdp.click(comp.backend)
            page.keyboard.type(probe, delay=20)
            fill_s = time.time() - t0
            ax2 = cdp.ax()
            c2 = next((n for n in ax2.live() if n.backend == comp.backend), None)
            filled = bool(c2 and probe in (c2.value or c2.name or ""))
            send = next((n for n in ax2.by_role("button") if re.search(r"(?i)\bsend\b|submit", n.name)), None)
            send_ok = bool(send and not send.disabled)
            ev = [lw.shot(page, "fix007-composer-filled")]
            note = "click %s, typed in %.1fs, value set %s, Send %s" % (clicked, fill_s, filled, "enabled" if send_ok else "missing/disabled")
            if not (clicked and filled and fill_s < 8):
                page.keyboard.press("Control+A"); page.keyboard.press("Backspace")
                return {"verdict": STILL, "method": "390 composer fill", "evidence": ev, "notes": note}
            if not self.allow_write:
                page.keyboard.press("Control+A"); page.keyboard.press("Backspace")
                return {"verdict": HUMAN, "method": "390 composer fill (send not exercised: read-only)", "evidence": ev,
                        "notes": note + ". Fill/click timeout NOT reproduced; Send needs --allow-write or a tester."}
            # write: send own labelled message once, then log it as a fixture
            label = "%s-chat-%s" % (self.cfg["fixture_prefix"], self.rec.rid)
            page.keyboard.press("Control+A"); page.keyboard.press("Backspace")
            page.keyboard.type(label, delay=20)
            assert_account(ctx, self.cfg, "t1", "chat send (create)", self.log)
            self.rec.fixture(label, lens, "create_clicked", "FIX-007 composer send at 390")
            if send_ok:
                cdp.click(send.backend)
            else:
                page.keyboard.press("Enter")
            shown, dt = wait_until(
                lambda: any(label in (n.name or "") for n in cdp.ax().live() if n.role in ("StaticText", "paragraph", "article", "listitem")), timeout=15)
            ev.append(lw.shot(page, "fix007-after-send"))
            self.rec.fixture(label, lens, "leftover", "Chat message/thread from FIX-007 send check; delete the thread by its label.")
            return {"verdict": FIXED if shown else STILL, "method": "390 composer fill + send", "evidence": ev,
                    "notes": note + "; sent message %s in transcript after %.1fs" % ("appeared" if shown else "did NOT appear", dt)}
        finally:
            lw._close(ctx)


def status_update(store, res, tester):
    """Build a retest_update record in the existing format, or None (NEEDS_HUMAN goes to the queue)."""
    prior = (res.get("prior_status") or "OPEN").upper()
    if res["verdict"] == STILL:
        status = "REOPENED" if prior in ("FIXED_PENDING_VERIFY", "VERIFIED") else "OPEN"
        verdict = "still reproduces (lens walker)"
    elif res["verdict"] == FIXED:
        if prior != "FIXED_PENDING_VERIFY":
            return None  # not claimed fixed by a builder: tester decides
        status, verdict = "VERIFIED", "fixed: repro passes + nearby smoke (lens walker)"
    else:
        return None
    ev = [e for e in (res.get("evidence") or []) if e]
    return {"type": "retest_update", "id": res["id"], "lens": res["lens"], "verdict": verdict,
            "note": scrub("%s. Method: %s. Smoke: %d new finding(s)." % (res.get("notes", ""), res.get("method"), res.get("smoke", {}).get("findings", 0)), 400),
            "evidence": ev, "evidence_path": "; ".join(ev), "status": status, "tester": tester, "ts": ts_et()}
