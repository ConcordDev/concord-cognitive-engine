"""Standard per-lens checks. All DOM reads go through DevTools protocol (cdp.py); all
interaction is native mouse/keyboard on controls that safety.py allows."""
import json, os, re, time, csv, io
from . import safety, colors, readback as _readback  # ULW C26: DevTools read-back evidence rows
from . import defectclasses  # ULW C35: the frozen defect-class vocabulary of record
from .cdp import Cdp, wait_until
from .auth import new_context, assert_account, AccountMismatch, whoami, expected_username, write_account_key
from .util import control_label, scrub, human_et
from .runstate import LensBudget  # WALK-05 budget hook: the run-shared per-lens tracker
from .netledger import NetLedger, LOAD_CONTROL, stable_id, a11y_path, template_path, lens_action, WRITE_METHODS  # MST-W0-02
from .lensrecord import shot_kind, row_stamp  # MST-W0-01 screenshots[] kinds + build stamp

ERROR_TEXT = re.compile(r"(?i)^\s*(something went wrong|application error|unhandled runtime error|"
                        r"this page could not be found|page not found|failed to load( lens)?|error loading|"
                        r"chunkloaderror|internal server error|an unexpected error occurred|oops)\b")
# A bare status number is content, not an error: achievements/wallet render a
# "500" figure and staking a "404.5" figure, and the unscoped 404|500
# alternatives filed those lenses as failing to load (H2/H3/H4, capture run
# 20261117-080754). A status code counts as error text only with error
# vocabulary adjacent in the same text ("404 not found", "500 internal server
# error", "error 500"); a purely numeric text never matches.
STATUS_TEXT = re.compile(r"(?i)\b(404|500)\b[^a-z0-9]{0,4}(not found|internal server error|server error|error|failed)(?![\w-])"
                         r"|\b(error|status|http)\b[^a-z0-9]{0,4}(404|500)\b")
NOTHING_TO_EXPORT = re.compile(r"(?i)nothing to export|no data to export|nothing selected")
# The platform gate card's own wording belongs in the vocabulary: the card
# reads "Admin access required" / "This operator surface needs one of:
# <roles>", and neither phrase matched, so five held gates (admin, ops,
# psyops, repair-telemetry, system) filed as "gate did not hold" failures
# in the capture walk (H1, run 20261117-080754; CB-0872 item 2). The added
# alternatives are the card's exact phrases, scoped to its shape: a benign
# "needs one of" elsewhere in content does not match.
NO_ACCESS_TEXT = re.compile(r"(?i)no access|access denied|not authorized|not authorised|forbidden|"
                            r"admin(s|istrator)? only|requires admin|permission denied|insufficient permission|"
                            r"admin access required|operator surface needs one of")


def gate_verdict(status, texts, signed_out):
    """Admin-gate outcome for a NON-admin account on an admin lens (WALK-02).
    The gate holding IS the pass: a login redirect, a 403, or a no-access page
    all mean the lens refused the member account as designed. Returns "PASS"
    for those, else None (the caller falls through to the normal reach logic,
    so a 500 or a crash page on an admin lens still files as a failure)."""
    if signed_out:
        return "PASS"
    if status == 403:
        return "PASS"
    if any(NO_ACCESS_TEXT.search(t or "") for t in (texts or [])):
        return "PASS"
    return None



# Template strings that carry no data of their own: "0", "0.0", "0%", "0/50", "0/N", "n/a", "-".
_TEMPLATE_STR = re.compile(r"(?i)^\s*(0+(\.0+)?\s*(%|/\s*(\d+|n))?|n/?a|none|null|-+|\u2014)?\s*$")
_FLAG_KEYS = ("ok", "success")


def _payload_shape(body, echoes=()):
    """(leaf_count, nonempty_leaf_count) of a JSON payload. A leaf is empty when it is
    0/false/null/"", an empty list or dict, a template string like '0/N', or an echo of a
    value the caller itself sent in the URL path. ok/success flags are not counted.
    Only these two numbers ever leave this function (no values are stored)."""
    leaves = nonempty = 0
    stack = [(None, body)]
    while stack:
        k, v = stack.pop()
        if k in _FLAG_KEYS:
            continue
        if isinstance(v, dict) and v:
            stack.extend(v.items())
            continue
        if isinstance(v, list) and v:
            stack.extend((None, x) for x in v)
            continue
        leaves += 1
        if v is None or v is False or v == 0 or v in ([], {}):
            continue
        if isinstance(v, str) and (_TEMPLATE_STR.match(v) or v in echoes):
            continue
        nonempty += 1
    return leaves, nonempty


def _contentless(body, echoes=()):
    """True when a JSON payload holds no data: every leaf empty/zero/template (see _payload_shape).
    Non-JSON (None) is never contentless — the conservative side."""
    if body is None:
        return False
    return _payload_shape(body, echoes)[1] == 0


def _empty_payload(body):
    return _contentless(body)

class LensResult(dict):
    pass


class LensWalk:
    """One lens, one account. Call run(); then .findings / .result."""

    def __init__(self, browser, cfg, rec, lens, account_key, log, allow_write=False, admin=False,
                 phases=None, inv_entry=None, url_override=None, gate_check=None, budget=None, deploy=None,
                 premap=False, premap_budget_s=None, two_account=False, capture_wiring=False):
        self.b, self.cfg, self.rec, self.lens, self.acct, self.log = browser, cfg, rec, lens, account_key, log
        self.slug, self.url = lens["slug"], lens["url"]
        # A gate check = a non-admin account opening an admin lens: the gate
        # holding (login redirect / 403 / no-access page) is the PASS (WALK-02).
        self.gate_check = (self.slug in cfg.get("admin_lenses", []) and not admin) if gate_check is None else gate_check
        if cfg["base_url"] != "https://concord-os.org":
            self.url = cfg["base_url"].rstrip("/") + "/lenses/" + self.slug
        if url_override:
            # WALK-03: a ticket that names its own path is walked at that path,
            # not just the lens root (reach rule in reverify.py).
            self.url = url_override
        self.allow_write = allow_write and not admin and self.slug not in cfg.get("write_skip_lenses", [])
        # ULW C28: write work (the create/delete exercise) acts as the dedicated write
        # account when one is configured — never as the account whose reads are evidence.
        self.write_acct = write_account_key(cfg) or account_key
        self.admin = admin
        self.th = cfg["thresholds"]
        self.phases = phases or ["reach", "surface", "tabs", "keyboard", "openers", "export", "contrast", "mobile", "write"]
        self.inv = inv_entry or {}
        self.ev = rec.evidence_dir(self.slug)
        self.findings, self.result = [], LensResult(slug=self.slug, url=self.url, account=account_key,
                                                    admin=admin, started=human_et(), checks={})
        # WALK-05 budget hook: `budget` is the run-shared LensBudget (or None
        # for the per-walk cap alone, the pre-hook behaviour).
        self.budget = budget
        self._budget_noted = False
        self.console_errors, self.page_errors, self.bad_responses, self.crashes = [], [], [], 0
        self.dialog_mode = "dismiss"
        self.native_dialogs = []
        self.t_start = time.time()
        self.shot_n = 0
        # MST-W0-01/02: build stamp, screenshots[], per-control endpoint ledger
        self.deploy = deploy
        self.screens = []
        self.net = NetLedger(cfg["base_url"], stamp=row_stamp(deploy), slow_ms=self.th.get("slow_call_ms", 3000),
                             long_task_ms=self.th.get("long_task_ms", 1000), shapes=capture_wiring)
        self.premap_findings = []  # recorded in the lens record only; never filed as tickets in Wave 0
        self.two_account = two_account
        self._nav_cid = LOAD_CONTROL
        # MST-W0-03: premap sweep (opt-in) with its own budget
        self.premap = premap
        self.premap_budget_s = premap_budget_s or self.th.get("premap_budget_s", 600)
        # ULW C5: per-lens SETTLE cap + per-CHECK budgets. Settle time (the
        # networkidle waits in _nav) accumulates across every navigation of
        # this walk; once the lens's settle budget is spent, later navs skip
        # the idle wait instead of burning up to settle_ms_judgment apiece —
        # the ~727s settle burn the ULW audit cites. Per-check budgets give
        # every phase its own slice (thresholds.check_budgets_s per phase,
        # thresholds.check_budget_s the default): loop-level phases stop
        # early on their own slice and every phase's spend is stamped on its
        # check row, so a slow early phase's cost is accounted to THAT check
        # instead of silently starving the later ones.
        self.settle_budget_s = float(self.th.get("settle_budget_s", 30))
        self.settle_spent_s = 0.0
        self.settle_capped = False
        self.check_budgets_s = dict(self.th.get("check_budgets_s", {}) or {})
        self.check_budget_default_s = float(self.th.get("check_budget_s", 45))
        self.check_spent_s = {}
        self._phase_t0 = None
        self._phase_name = None

    # ---------------------------------------------------------------- infra
    def over_budget(self):
        # WALK-05 hook: the per-walk cap (as landed) OR the run-shared per-lens
        # budget — cumulative across every walk of this lens in the run,
        # counting this walk's elapsed time. run() notes each finished walk
        # into the tracker (see _note_budget), so a lens re-walked for many
        # tickets cannot spend a fresh full budget on every ticket.
        if time.time() - self.t_start > self.th["lens_budget_s"]:
            return True
        if self.budget is not None:
            return self.budget.spent(self.slug) + (time.time() - self.t_start) > self.budget.budget_s
        return False

    def _note_budget(self):
        """WALK-05 hook, called once at walk end: fold this walk's elapsed
        time into the run-shared tracker and stamp the result for the
        journal / RESULTS layer — budget_aborted lists the phases the budget
        stopped, so a budget-cut walk never reads as a clean pass downstream."""
        elapsed = time.time() - self.t_start
        if self.budget is not None and not self._budget_noted:
            self.budget.note(self.slug, elapsed)
            self._budget_noted = True
        aborted = [ph for ph, d in self.result["checks"].items()
                   if d.get("status") == "NOT_RUN" and d.get("reason") == "lens time budget exceeded"]
        self.result["budget"] = {"lens": self.slug, "elapsed_s": int(elapsed),
                                  "budget_s": self.budget.budget_s if self.budget is not None else self.th["lens_budget_s"],
                                  "spent_s": int(self.budget.spent(self.slug)) if self.budget is not None else int(elapsed)}
        if aborted:
            self.result["budget_aborted"] = aborted

    # ------------------------------------------------------------ ULW C5
    def settle_allowance_ms(self):
        """Milliseconds this navigation may spend waiting for network idle:
        the judgment timeout bounded by the lens's remaining settle budget
        (0 once the budget is spent — the wait is skipped, never negative)."""
        remaining = self.settle_budget_s - self.settle_spent_s
        if remaining <= 0:
            return 0
        return int(min(float(self.th["settle_ms_judgment"]), remaining * 1000))

    def _note_settle(self, seconds):
        self.settle_spent_s += max(0.0, float(seconds))
        if self.settle_spent_s >= self.settle_budget_s:
            self.settle_capped = True

    def check_budget_for(self, phase):
        return float(self.check_budgets_s.get(phase, self.check_budget_default_s))

    def phase_over(self, phase=None):
        """True when the CURRENT phase has spent past its own per-check budget."""
        ph = phase or self._phase_name
        if ph is None or self._phase_t0 is None:
            return False
        return (time.time() - self._phase_t0) > self.check_budget_for(ph)

    _CHECK_KEY = {"write": "create_delete", "mobile": "mobile_390"}

    def _begin_phase(self, phase):
        self._phase_name, self._phase_t0 = phase, time.time()

    def _end_phase(self, phase):
        if self._phase_t0 is None:
            return
        elapsed = time.time() - self._phase_t0
        self._phase_name, self._phase_t0 = None, None
        self.check_spent_s[phase] = self.check_spent_s.get(phase, 0.0) + elapsed
        d = self.result["checks"].get(self._CHECK_KEY.get(phase, phase))
        if isinstance(d, dict):
            d["elapsed_s"] = int(elapsed)
            d["budget_s"] = int(self.check_budget_for(phase))
            if elapsed > self.check_budget_for(phase):
                d["over_check_budget"] = True

    def attach(self, page):
        def on_console(m):
            if m.type == "error":
                self.console_errors.append(scrub(m.text, 200))
        def on_resp(r):
            try:
                if r.status >= 400 and self.cfg["base_url"].split("//")[1].split("/")[0] in r.url:
                    path = r.url.split("//", 1)[1].split("/", 1)[-1].split("?")[0]
                    self.bad_responses.append((r.status, "/" + path[:80]))
            except Exception:
                pass
        def on_dialog(d):
            self.native_dialogs.append({"type": d.type, "msg": scrub(d.message, 120), "t": time.time()})
            try:
                (d.accept() if self.dialog_mode == "accept" else d.dismiss())
            except Exception:
                pass
        def on_crash(_):
            self.crashes += 1
        page.on("console", on_console)
        page.on("pageerror", lambda e: self.page_errors.append(scrub(str(e), 200)))
        page.on("response", on_resp)
        page.on("dialog", on_dialog)
        page.on("crash", on_crash)

    def open(self, mobile=False, account=None):
        vp = self.cfg["viewport_mobile"] if mobile else self.cfg["viewport_desktop"]
        ctx = new_context(self.b, self.cfg, account if account is not None else self.acct, vp, mobile=mobile)
        page = ctx.new_page()
        self.attach(page)
        self.net.attach(page, account=account if account is not None else self.acct)
        cdp = Cdp(ctx, page)
        self.net.watch_initiators(cdp.s)
        return ctx, page, cdp

    def _close(self, ctx):
        """Persist refreshed session cookies (token rotation) back to auth/<acct>.json, then close.
        Only saved when auth/me still shows the expected account."""
        try:
            self.net.flush()  # resolve this page's requests before the context goes away
        except Exception:
            pass
        try:
            if self.acct:
                from .auth import storage_path
                me = whoami(ctx, self.cfg["base_url"])
                if me.get("ok") and me.get("username") == expected_username(self.cfg, self.acct):
                    path = storage_path(self.cfg, self.acct)
                    old = os.umask(0o077)
                    try:
                        ctx.storage_state(path=path)
                    finally:
                        os.umask(old)
        except Exception:
            pass
        try:
            ctx.close()
        except Exception:
            pass

    def shot(self, page, name, clip=None, full=False, jpeg=False):
        self.shot_n += 1
        ext = "jpg" if jpeg else "png"
        safe = re.sub(r"[^a-zA-Z0-9_.-]+", "-", name)[:60]
        path = os.path.join(self.ev, "walker-%02d-%s.%s" % (self.shot_n, safe, ext))
        try:
            kw = dict(path=path, full_page=full, timeout=15000)
            if clip:
                kw["clip"] = clip
            if jpeg:
                kw.update(type="jpeg", quality=60)
            page.screenshot(**kw)
            rel = self.rec.rel(path)
            self.screens.append({"path": rel, "kind": shot_kind(safe)})
            return rel
        except Exception as e:
            self.log("  screenshot failed", name, type(e).__name__)
            return None

    def finding(self, check, severity, title, steps, expected, actual, evidence, element=None, root_cause=None, area=None, defect_class=None):
        ev = [e for e in (evidence or []) if e]
        if not ev:
            # every finding must carry screenshot evidence; refuse silently-evidenced findings
            self.rec.judgment(self.slug, "finding_without_evidence", "Walker saw '%s' but could not capture a screenshot; verify by hand." % title)
            return
        if defect_class is not None:
            # ULW C35: a finding may carry only a FROZEN defect class
            # (defectclasses.py, the vocabulary of record). An unknown,
            # excluded, or Table-3-candidate tag is refused loudly, in
            # the same shape as the evidence refusal above — it is never
            # recorded under a class the frozen vocabulary does not hold.
            ok, why = defectclasses.validate_defect_class(defect_class)
            if not ok:
                self.rec.judgment(self.slug, "finding_with_invalid_defect_class", "Walker saw '%s' but its defect class '%s' is %s under the frozen vocabulary (C35); the finding was refused — tag it with a frozen class, or file the instance for the amendment path." % (title, defect_class, why))
                return
        f = {"check": check, "lens": self.slug, "severity": severity, "title": title,
             "repro_steps": steps, "expected": expected, "actual": actual, "evidence": ev,
             "element": element, "root_cause": root_cause, "defect_class": defect_class,
             "suspected_area": area or "%s/%s" % (self.slug, check), "account": self.cfg["accounts"][self.acct]["username"] if self.acct else None}
        self.findings.append(f)
        self.rec.finding(dict(f, run=self.rec.rid))
        self.log("  FINDING [%s/%s] %s" % (check, severity, title))

    def judge(self, kind, q, ev=None):
        self.rec.judgment(self.slug, kind, q, [e for e in (ev or []) if e],
                          account=self.cfg["accounts"][self.acct]["username"] if self.acct else "signed-out")

    def mark(self, check, st, **details):
        d = dict(details)
        if "status" in d:
            d["http_status"] = d.pop("status")
        d["status"] = st
        self.result["checks"][check] = d

    GATEWAY = (502, 503, 504)

    def nav(self, page, cdp, label="load"):
        # MST-W0-02: a navigation is the page-load control (sticky window until settled)
        self.net.open_window("load", "page", "-", sticky=True, cid=self._nav_cid)
        try:
            return self._nav(page, cdp)
        finally:
            self.net.close_window()

    def _nav(self, page, cdp):
        t0 = time.time()
        resp, err = None, None
        retries = self.th.get("gateway_retries", 2)
        for attempt in range(retries + 1):
            resp, err = None, None
            try:
                resp = page.goto(self.url, wait_until="domcontentloaded", timeout=self.th["nav_timeout_ms"])
                t_dcl = time.time() - t0
                page.wait_for_load_state("load", timeout=self.th["nav_timeout_ms"])
                t_load = time.time() - t0
            except Exception as e:
                err = type(e).__name__
                t_dcl = t_load = time.time() - t0
            # WALKER-ISSUES: a 502/503/504 from the edge is a blip, not a lens bug —
            # back off and retry the navigation before judging the lens.
            if resp is not None and resp.status in self.GATEWAY and attempt < retries:
                self.log("  gateway %d on %s; retry %d/%d" % (resp.status, self.slug, attempt + 1, retries))
                self.gateway_retries = getattr(self, "gateway_retries", 0) + 1
                time.sleep(self.th.get("gateway_backoff_s", 5) * (attempt + 1))
                continue
            break
        # ULW C5 settle cap: the idle wait is bounded by the lens's remaining
        # settle budget; once spent, the wait is skipped (settled=False,
        # settle_capped=True) instead of burning the full judgment timeout
        # on every navigation.
        allowance = self.settle_allowance_ms()
        settle_capped = allowance <= 0
        if allowance > 0:
            try:
                page.wait_for_load_state("networkidle", timeout=allowance)
                settled = True
            except Exception:
                settled = False
            settle_capped = allowance < int(self.th["settle_ms_judgment"])
        else:
            settled = False
        t_settle = time.time() - t0
        self._note_settle(max(0.0, t_settle - t_load))
        # Visual readiness: Concord shows an animated splash for a few seconds after load. Wait until two
        # consecutive low-res screenshots are identical (or 15 s), so checks run on the real UI.
        last, same, stable = None, 0, False
        t_ready = time.time()
        while time.time() - t0 < t_settle + 15:
            try:
                shot = page.screenshot(type="jpeg", quality=30, timeout=5000)
            except Exception:
                break
            same = same + 1 if shot == last else 0
            if same >= 2:
                stable = True
                break
            last = shot
            time.sleep(0.5)
        t_ready = time.time() - t0
        return {"status": resp.status if resp else None, "dcl_ms": int(t_dcl * 1000), "load_ms": int(t_load * 1000),
                "settle_ms": int(t_settle * 1000), "settled": settled, "ready_ms": int(t_ready * 1000),
                "settle_capped": settle_capped, "visually_stable": stable, "error": err, "final_url": page.url}

    def error_texts(self, ax):
        return [t for t in ax.texts() if len(t) < 90 and (ERROR_TEXT.search(t) or STATUS_TEXT.search(t))]

    def signed_out(self, page):
        return "/login" in page.url

    # ---------------------------------------------------------------- run
    def run(self):
        self.log("lens %s as %s%s%s" % (self.slug, self.acct or "signed-out", " [ADMIN look-only]" if self.admin else "",
                                         " [write]" if self.allow_write else ""))
        ctx, page, cdp = self.open()
        try:
            if self.acct:
                assert_account(ctx, self.cfg, self.acct, "lens start", self.log)
            ok = self.reach(page, cdp)
            if ok:
                for ph, fn in (("surface", self.surface), ("tabs", self.tabs), ("keyboard", self.keyboard),
                               ("openers", self.openers), ("export", self.export), ("contrast", self.contrast),
                               ("sweep", self.sweep)):
                    if ph == "sweep":
                        # MST-W0-03: opt-in (--premap), its own budget, never NOT_RUN by the lens budget
                        if not (self.premap or "sweep" in self.phases):
                            continue
                        try:
                            self.reset_page(page, cdp)
                            self.sweep(page, cdp)
                        except AccountMismatch:
                            raise
                        except Exception as e:
                            self.log("  phase sweep error: %s" % scrub(repr(e), 200))
                            self.mark("premap_sweep", "ERROR", error=scrub(repr(e), 200))
                        continue
                    if ph not in self.phases:
                        self.mark(ph, "NOT_RUN", reason="phase not selected")
                        continue
                    if self.over_budget():
                        self.mark(ph, "NOT_RUN", reason="lens time budget exceeded")
                        continue
                    if self.crashes:
                        self.mark(ph, "NOT_RUN", reason="renderer crashed")
                        break
                    try:
                        self.reset_page(page, cdp)
                        self._begin_phase(ph)
                        fn(page, cdp)
                    except AccountMismatch:
                        self._end_phase(ph)
                        raise
                    except Exception as e:
                        self._end_phase(ph)
                        self.log("  phase %s error: %s" % (ph, scrub(repr(e), 200)))
                        self.mark(ph, "ERROR", error=scrub(repr(e), 200))
                    self._end_phase(ph)
        finally:
            self._close(ctx)
        if "mobile" in self.phases and not self.over_budget():
            try:
                self._begin_phase("mobile")
                self.mobile()
                self._end_phase("mobile")
            except AccountMismatch:
                self._end_phase("mobile")
                raise
            except Exception as e:
                self._end_phase("mobile")
                self.mark("mobile_390", "ERROR", error=scrub(repr(e), 200))
        if "write" in self.phases:
            if self.allow_write and self.acct and not self.over_budget():
                try:
                    self._begin_phase("write")
                    self.write_flow()
                    self._end_phase("write")
                except AccountMismatch:
                    self._end_phase("write")
                    raise
                except Exception as e:
                    self._end_phase("write")
                    self.mark("create_delete", "ERROR", error=scrub(repr(e), 200))
            else:
                self.mark("create_delete", "NOT_RUN", reason="read-only run" if not self.allow_write else "write-skip lens / admin / no session")
        # ULW v3 (GB-1576 W5c): DURABILITY rides the write phase — after the
        # lens's writes, before isolation. Best-effort; never fails the lens.
        if "write" in self.phases and self.allow_write and self.acct:
            if not self.over_budget():
                try:
                    self._begin_phase("durability")
                    self.durability_phase()
                    self._end_phase("durability")
                except AccountMismatch:
                    self._end_phase("durability")
                    raise
                except Exception as e:
                    self._end_phase("durability")
                    self.log("  phase durability error: %s" % scrub(repr(e), 200))
                    self.result["durability"] = {"status": "ERROR",
                                                 "reason": scrub(repr(e), 160),
                                                 "probes": 0, "failed": 0,
                                                 "unverified": 0, "rows": []}
            else:
                self.result["durability"] = {"status": "SKIPPED",
                                             "reason": "lens time budget exceeded",
                                             "probes": 0, "failed": 0,
                                             "unverified": 0, "rows": []}
        self.console_network()
        try:
            self.isolation_phase()
        except AccountMismatch as e:
            self.result["isolation"] = {"status": "SKIPPED", "reason": "t2 account check failed: %s" % scrub(str(e), 120),
                                        "checks": 0, "findings": 0, "leaks": []}
        except Exception as e:
            self.result["isolation"] = {"status": "ERROR", "reason": scrub(repr(e), 160),
                                        "checks": 0, "findings": 0, "leaks": []}
        self.result["finished"] = human_et()
        self.result["elapsed_s"] = int(time.time() - self.t_start)
        # ULW C5 stamps: settle spend vs its cap + per-check spend vs budgets.
        self.result["settle"] = {"spent_s": int(self.settle_spent_s), "budget_s": int(self.settle_budget_s),
                                 "capped": self.settle_capped}
        if self.check_spent_s:
            self.result["check_budgets"] = {ph: {"spent_s": int(s), "budget_s": int(self.check_budget_for(ph)),
                                                 "over": s > self.check_budget_for(ph)}
                                            for ph, s in sorted(self.check_spent_s.items())}
        self._note_budget()
        return self.result

    # ---------------------------------------------------------------- MST-W0-03 sweep
    SWEEP_ROLES = ("button", "tab", "menuitem")
    REUSE_PHASES = ("tab", "opener", "export", "write")

    @staticmethod
    def _ax_sig(ax):
        return frozenset((n.role, n.name) for n in ax.live() if n.name)

    def sweep(self, page, cdp):
        """Every named button/tab/menuitem gets one controls[] row: exercised (clicked
        once here, or reused from the phase that already clicked it) or a reason.
        Records only; files nothing (DEAD-BUTTON filing is MST-W2-19)."""
        from .netledger import control_id
        t0 = time.time()
        read_only = self.slug in self.cfg.get("write_skip_lenses", [])
        ax = cdp.ax()
        # GB-1580 item 4: the sweep covers the lens MAIN-CONTENT region only.
        # Shell chrome (app sidebar Expand/Collapse, nav, top bar, global
        # search) is noted once per control as shell_chrome — auditable in
        # the record, never clicked, never counted as a lens control.
        scope = region_scope(ax)
        cands, seen = [], set()
        counts = {"clicked": 0, "reused": 0, "skipped": 0, "shell": 0}
        for n in ax.by_role(*self.SWEEP_ROLES):
            if not (n.name or "").strip():
                continue
            key = (n.role, control_label(n.name))
            if key in seen:
                continue
            seen.add(key)
            if not in_main_region(ax, n, scope):
                self.net.note_control("sweep", n.role, control_label(n.name), False, reason="shell_chrome",
                                      cid=control_id("sweep", n.role, control_label(n.name)))
                counts["shell"] += 1
                continue
            cands.append((n.role, control_label(n.name), n.name, n.disabled))
        prior = {}
        for cid, m in self.net.meta.items():
            if m["phase"] in self.REUSE_PHASES and m.get("exercised"):
                prior.setdefault(m["name"], cid)
        cap = self.th.get("max_sweep_controls", 120)
        for i, (role, label, raw, disabled) in enumerate(cands):
            cid = control_id("sweep", role, label)
            if i >= cap:
                self.net.note_control("sweep", role, label, False, reason="not_in_premap", cid=cid); counts["skipped"] += 1
                continue
            if label in prior:
                self.net.note_control("sweep", role, label, True, cid=cid, reused_from=prior[label]); counts["reused"] += 1
                continue
            if disabled:
                self.net.note_control("sweep", role, label, False, reason="disabled", cid=cid); counts["skipped"] += 1
                continue
            ok, why = safety.sweep_decision(raw, admin=self.admin, read_only=read_only)
            if not ok:
                self.net.note_control("sweep", role, label, False, reason=why, cid=cid); counts["skipped"] += 1
                continue
            if time.time() - t0 > self.premap_budget_s or self.crashes:
                self.net.note_control("sweep", role, label, False, reason="budget" if not self.crashes else "renderer_crashed",
                                      cid=cid); counts["skipped"] += 1
                continue
            ax = cdp.ax()
            node = next((x for x in ax.by_role(role) if x.name == raw and x.backend and not x.disabled), None)
            if not node:
                self.net.note_control("sweep", role, label, False, reason="not_found_after_reset", cid=cid); counts["skipped"] += 1
                continue
            url0, sig0 = page.url, self._ax_sig(ax)
            texts0 = set(ax.texts())
            sid = stable_id(role, raw, a11y_path(ax, node))
            t_click = time.time()
            self.net.open_window("sweep", role, label, cid=cid, sid=sid)
            tc = time.time()
            if not cdp.click(node.backend):
                self.net.meta[cid].update(exercised=False, reason="not_visible"); counts["skipped"] += 1
                continue
            click_ms = int((time.time() - tc) * 1000)
            counts["clicked"] += 1
            # upgrade 4: freeze probe -- the input ack and an AX read both need the
            # renderer main thread; either one blocking >= freeze_ms is a freeze
            ta = time.time()
            cdp.ax()
            ax_ms = max(int((time.time() - ta) * 1000), click_ms - 250)
            if ax_ms >= self.th.get("freeze_ms", 1000):
                self.net.note_freeze(ax_ms, t=tc)
                self.net.annotate(cid, ax_ms=ax_ms)
            try:
                page.wait_for_timeout(int(self.th.get("sweep_settle_ms", 1200)))
            except Exception:
                pass
            ax1 = cdp.ax()
            why, writes = self.net.quick_broken(t_click - 0.05)
            if ax_ms >= self.th.get("freeze_ms", 1000):
                why.add("freeze")
            self._premap_checks(page, cdp, cid, sid, label, why, writes, texts0, ax1)
            if page.url.split("#")[0] != url0.split("#")[0]:
                eff = "nav"
            elif self._ax_sig(ax1) != sig0:
                eff = "ax_change"
            else:
                eff = "none"
            self.net.set_effect(cid, eff)
            self.net.close_window()
            if ax1.popups():
                page.keyboard.press("Escape")
            self.reset_page(page, cdp)
        self.net.close_window()
        self.mark("premap_sweep", "PASS", controls=len(cands), region=scope[0], controls_seen=len(cands) + counts["shell"],
                  budget_s=self.premap_budget_s, elapsed_s=int(time.time() - t0), **counts)

    def isolation_phase(self):
        """C16 (ULW-43, Gate section 14): the two-account isolation phase as a
        STANDARD per-lens phase, not an opt-in. The plan (concord_walker.
        isolation.phase_plan) runs it for every write-capable t1 member walk:
        the write phase created under A; here the walk verifies under B —
        cross_account replays A's object calls as t2, and when this walk's
        write phase left a live labelled fixture, the WALK-04c foreign-row
        probe (privacy_checks.probe_foreign_rows) checks the label's
        invisibility to t2 + signed-out over the lens's recorded API paths.
        The counted block lands in result["isolation"] (the packet) and the
        run roll-up aggregates it. A phase that cannot run is SKIPPED with
        its reason — reported, never silent."""
        from . import isolation as _iso
        from .auth import has_session, isolation_pair
        owner, observer = isolation_pair(self.cfg, self.acct)
        plan = _iso.phase_plan(acct=self.acct, admin=self.admin,
                               allow_write=self.allow_write,
                               has_t2=has_session(self.cfg, observer),
                               two_account_flag=self.two_account, observer=observer,
                               reader=self.cfg.get("reader_account") or "t1")
        if not plan["run"]:
            self.result["isolation"] = {"status": "SKIPPED", "reason": plan["reason"],
                                        "checks": 0, "findings": 0, "leaks": []}
            return
        self.cross_account()
        label = None
        for f in (self.rec.fixtures or {}).values():
            if f.get("lens") == self.slug and f.get("state") not in ("deleted", "never_created"):
                label = f.get("label")
        paths = list(dict.fromkeys(r["path"] for r in self.net.replay if r.get("path")))
        pp = _iso.probe_plan(fixture_label=label, api_paths=paths)
        probe_row, probe_skip = None, None
        if pp["run"] and owner == observer:
            pp = {"run": False, "reason": "fixture owner %s is the isolation observer" % owner}
        if pp["run"] and not self.over_budget():
            from . import privacy_checks as _pc
            # ULW C28: the owner context is the account that created the fixture (write account)
            ctx, _page, _cdp = self.open(account=owner)
            try:
                probe_row = _pc.probe_foreign_rows(self, ctx, label, paths, self.log,
                                                   owner_acct=owner, foreign_acct=observer)
            finally:
                self._close(ctx)
        else:
            probe_skip = pp["reason"] if not pp["run"] else "lens time budget exceeded"
        # ULW v3 trust probes (GB-1575 scope addition): OWNER-MUTATION +
        # ACTOR-SPOOF ride the isolation phase as standard legs.
        if not self.over_budget():
            self.trust_phase(owner, observer)
        # ULW v3 (GB-1576 W5a): the core-verb drive rides the same phase.
        if not self.over_budget():
            self.core_verb_phase(owner, observer)
        self.result["isolation"] = _iso.packet_block(self.result.get("two_account"),
                                                      probe_row, probe_skip)

    def trust_phase(self, owner, observer):
        """ULW v3 (GB-1575 scope addition): the trust probes as standard legs
        of the isolation phase — OWNER-MUTATION (the observer re-issues the
        owner's recorded object-writes with its own identity correct, plus
        DELETE attempts on the objects this walk created) and ACTOR-SPOOF
        (the observer re-issues recorded writes with an actor-shaped field
        set to the owner's id, plus the route-variant leg). Planning and
        verdicts live in concord_walker.trust_probes (pure); this method
        only drives contexts. A landed attempt files an ownership finding
        through the standing machinery; a landed update/spoof is restored
        best-effort by re-issuing the owner's original recorded call as the
        owner. Bodies and ids live only in memory; stored rows keep field
        names and verdicts only."""
        from . import trust_probes as _tp
        from urllib.parse import urlsplit, urlunsplit
        import json as _json
        cap = self.th.get("trust_probe_max_calls", 12)
        _leg = getattr(self.net, "leg_calls", None)
        calls = _leg() if _leg else list(self.net.replay or [])
        own_writes = [r for r in calls if (r.get("method") or "") in _tp.WRITE_METHODS
                      and (r.get("acct") or self.acct) in (owner, self.acct)]
        actor_hits = sum(len(_tp.actor_fields_in(r.get("post"))) for r in own_writes)
        m_attempts = _tp.mutation_plan(calls, owner_acct=owner, walk_acct=self.acct, cap=cap)
        s_attempts = _tp.spoof_plan(calls, owner_acct=owner, walk_acct=self.acct, cap=cap)
        created = sum(1 for a in m_attempts if a["kind"] == "delete")
        m_plan = _tp.leg_plan("mutation", write_calls=len(own_writes), created_objects=created)
        s_plan = _tp.leg_plan("spoof", write_calls=len(own_writes), actor_fields=actor_hits)
        if not m_attempts:
            m_plan = {"run": False, "reason": m_plan["reason"] if not m_plan["run"] else "no mutation attempts derivable from the recorded calls"}
        if not s_attempts:
            s_plan = {"run": False, "reason": s_plan["reason"] if not s_plan["run"] else "no spoof attempts derivable from the recorded calls"}
        # W5b: the private-broadcast leg's inputs — a live labelled fixture
        # (the private object) and a recorded owner write that can carry the
        # run's marker in a string field.
        b_label = None
        for f in (self.rec.fixtures or {}).values():
            if f.get("lens") == self.slug and f.get("state") not in ("deleted", "never_created"):
                b_label = f.get("label")
        b_candidates = []
        for r in own_writes:
            obj = _tp.body_obj(r.get("post"))
            if obj and any(isinstance(v, str) and v for v in obj.values()):
                b_candidates.append(r)
        if not b_label:
            b_skip = "no live labelled fixture for this lens in this run"
        elif not b_candidates:
            b_skip = "no recorded owner write can carry the marker"
        else:
            b_skip = None
        if not (m_plan["run"] or s_plan["run"] or b_skip is None):
            self.result["trust"] = _tp.trust_block(None, None, m_plan["reason"], s_plan["reason"],
                                                   broadcast_skip=b_skip)
            return
        vp = self.cfg["viewport_desktop"]
        base_host = urlsplit(self.cfg["base_url"]).netloc
        octx, _opage, _ocdp = self.open(account=owner)
        fctx = new_context(self.b, self.cfg, observer, vp)
        try:
            assert_account(fctx, self.cfg, observer, "trust probes", self.log)

            def owner_read(url):
                try:
                    resp = octx.request.get(url, timeout=15000)
                    try:
                        body = resp.json()
                    except Exception:
                        body = None
                    return resp.status, (_json.dumps(body, sort_keys=True, default=str) if body is not None else None)
                except Exception:
                    return None, None

            def fire(attempt, post):
                kw = {"timeout": 15000}
                if post is not None:
                    kw["data"] = post
                    kw["headers"] = {"Content-Type": "application/json"}
                try:
                    resp = fctx.request.fetch(attempt["url"], method=attempt["method"], **kw)
                    try:
                        body = resp.json()
                    except Exception:
                        body = None
                    return resp.status, body
                except Exception:
                    return None, None

            def restore(attempt):
                """Best-effort: re-issue the owner's original recorded call as
                the owner, undoing a landed update/spoof. Deletes cannot be
                restored (the object was this walk's own creation)."""
                if attempt["kind"] == "delete" or attempt.get("orig_post") is None:
                    return "not_restorable"
                kw = {"timeout": 15000, "data": attempt["orig_post"],
                      "headers": {"Content-Type": "application/json"}}
                try:
                    resp = octx.request.fetch(attempt.get("orig_url") or attempt["url"],
                                              method=attempt["method"], **kw)
                    return "restored" if 200 <= resp.status < 300 else "restore_failed_%d" % resp.status
                except Exception:
                    return "restore_error"

            def run_attempts(attempts, leg):
                rows = []
                for a in attempts:
                    if urlsplit(a["url"]).netloc != base_host:
                        continue
                    post = _tp.strip_actor_fields(a.get("post")) if leg == "mutation" else a.get("post")
                    before = owner_read(a["url"])
                    st, body = fire(a, post)
                    after = owner_read(a["url"])
                    if a["kind"] == "delete":
                        changed = (after[0] in (404, 410)) or (before[1] is not None and after[1] != before[1])
                    elif before[1] is not None and after[1] is not None:
                        changed = before[1] != after[1]
                    else:
                        changed = None
                    verdict = _tp.attempt_verdict(st, body, changed)
                    row = {"kind": a["kind"], "method": a["method"], "path": a["path"],
                           "status": st, "verdict": verdict}
                    if a.get("field"):
                        row["field"] = a["field"]
                    if a.get("variant"):
                        row["variant"] = True
                    if verdict == "LANDED":
                        row["restore"] = restore(a)
                        cid = self.net._cid_at(a["t"]) if a.get("t") is not None else None
                        sid = (self.net.meta.get(cid) or {}).get("sid") if cid else None
                        if cid:
                            self.net.annotate(cid, ownership=["%s %s %s %s -> %s (trust probe: %s)" % (
                                observer, leg, a["method"], a["path"], st, a["kind"])])
                        self._premap_finding("ownership", cid, sid,
                                             "Second account can %s the first account's object: %s %s -> %s (trust probe %s)" % (
                                                 "mutate" if leg == "mutation" else "spoof-write to",
                                                 a["method"], a["path"], st, a["kind"]),
                                             [self.result.get("initial_evidence")], severity="high")
                    rows.append(row)
                return rows

            m_rows = run_attempts(m_attempts, "mutation") if m_plan["run"] else None
            s_rows = None
            if s_plan["run"]:
                s_rows = run_attempts(s_attempts, "spoof")
                # ACTOR-SPOOF-VARIANTS: each spoof repeats against the route's
                # case-variant and trailing-slash forms (X-02's bypass shape).
                variant_attempts = []
                for a in s_attempts:
                    for vpath in _tp.variant_paths(a["path"]):
                        parts = urlsplit(a["url"])
                        va = dict(a)
                        va["url"] = urlunsplit((parts.scheme, parts.netloc, vpath, parts.query, ""))
                        va["path"] = vpath
                        va["variant"] = True
                        variant_attempts.append(va)
                if variant_attempts and not self.over_budget():
                    s_rows += run_attempts(variant_attempts[:cap], "spoof")
            b_outcome = None
            if b_skip is None and not self.over_budget():
                b_outcome, b_skip = self._broadcast_leg(owner, observer, octx, b_label, b_candidates)
            self.result["trust"] = _tp.trust_block(
                m_rows if m_plan["run"] else None,
                s_rows if s_plan["run"] else None,
                None if m_plan["run"] else m_plan["reason"],
                None if s_plan["run"] else s_plan["reason"],
                broadcast=b_outcome, broadcast_skip=b_skip)
            tb = self.result["trust"]
            self.log("  trust probes %s: %d attempt(s), %d landed (mutation %s / spoof %s)" % (
                self.slug, tb["checks"], tb["findings"],
                (tb["legs"].get("mutation") or {}).get("attempts", tb["legs"].get("mutation", {}).get("skip", "-")),
                (tb["legs"].get("spoof") or {}).get("attempts", tb["legs"].get("spoof", {}).get("skip", "-"))))
        finally:
            try:
                fctx.close()
            except Exception:
                pass
            self._close(octx)

    def core_verb_phase(self, owner, observer):
        """ULW v3 (GB-1576 W5a): the core-verb drive — the lens's ONE
        defining verb, exercised end to end with the phase's two accounts.
        The spec (walker/specs/core_verbs.json, via concord_walker.
        core_verbs) names the verb and its lens action; this leg performs
        it through POST /api/lens/run as the writer (owner) with the
        walk's labelled marker in the args, verifies the result persisted
        by a fresh read-back (the reload witness: object GET when the
        response carried an id, else the domain list), checks the
        observer's visibility both ways against the spec, and cleans the
        created data up via the write account. Planning and verdicts live
        in core_verbs (pure); this method only drives contexts. A FAIL
        files a finding; anything the probe itself could not establish
        verdicts UNSPECIFIED with the reason named — never a silent skip,
        never a PASS. Money-class actions are never driven."""
        from . import core_verbs as _cv
        from .auth import has_session
        import json as _json
        doc = _cv.load_spec_doc()
        spec = _cv.spec_for(doc, self.slug)
        p = _cv.plan(spec, has_observer=has_session(self.cfg, observer))
        if not p["run"]:
            # No log call here: the trust legs' not-run paths are silent
            # for the same reason — a harness may drive the phase with
            # log=None (the C28 runtime suite does), and the block in the
            # result is the report.
            self.result["core_verb"] = _cv.core_verb_block(
                spec, "CORE_VERB_UNSPECIFIED", p["reason"])
            return
        base = self.cfg["base_url"].rstrip("/")
        run_url = base + "/api/lens/run"
        domain = spec["action"]["domain"]
        label = "%s-cv-%s-%s" % (self.cfg["fixture_prefix"], self.slug, self.rec.rid[-6:])
        vp = self.cfg["viewport_desktop"]
        wctx, _wp, _wc = self.open(account=owner)
        fctx = new_context(self.b, self.cfg, observer, vp)
        try:
            assert_account(fctx, self.cfg, observer, "core verb", self.log)

            def run_as(ctx, body):
                try:
                    resp = ctx.request.post(run_url, data=_json.dumps(body),
                                            headers={"Content-Type": "application/json"},
                                            timeout=20000)
                    try:
                        rbody = resp.json()
                    except Exception:
                        rbody = None
                    return resp.status, rbody, None
                except Exception as e:
                    return None, None, type(e).__name__

            def read_as(ctx):
                """(object_seen, list_seen): object_seen is True/False when
                an object GET answered, None when unavailable; list_seen
                likewise for the domain list search."""
                obj_seen = None
                if oid is not None:
                    try:
                        resp = ctx.request.get("%s/api/lens/%s/%s" % (base, domain, oid),
                                               timeout=15000)
                        if 200 <= resp.status < 300:
                            obj_seen = True
                        elif resp.status in (401, 403, 404):
                            obj_seen = False
                    except Exception:
                        obj_seen = None
                list_seen = None
                try:
                    resp = ctx.request.get("%s/api/lens/%s" % (base, domain), timeout=15000)
                    if 200 <= resp.status < 300:
                        try:
                            text = resp.text() or ""
                        except Exception:
                            text = ""
                        list_seen = (label in text) or (oid is not None and str(oid) in text)
                    elif resp.status in (401, 403, 404):
                        list_seen = False
                except Exception:
                    list_seen = None
                return obj_seen, list_seen

            st, rbody, terr = run_as(wctx, _cv.verb_body(spec, label))
            drive = _cv.classify_drive(st, rbody)
            # GB-1579: the block carries the drive's HTTP status + a scrubbed
            # error reason, so an UNSPECIFIED verdict is diagnosable.
            derr = _cv.error_reason(rbody) if drive != "performed" else None
            if derr is None and st is None and terr:
                derr = "transport error: %s" % terr
            oid = _cv.extract_object_id(rbody)
            persisted = observer_sees = None
            cleanup = "not_attempted"
            if drive == "performed":
                wo, wl = read_as(wctx)
                persisted = wo if wo is not None else wl
                fo, fl = read_as(fctx)
                observer_sees = fo if fo is not None else fl
                cbody = _cv.cleanup_body(spec, oid)
                if cbody is not None:
                    cst, _cb, _cterr = run_as(wctx, cbody)
                    cleanup = "deleted" if (cst is not None and 200 <= cst < 300) \
                        else "delete_failed_%s" % (cst,)
                else:
                    cleanup = "not_derived (created data carries the walk label %s)" % label
            word, reason = _cv.verdict(spec, drive=drive, persisted=persisted,
                                       observer_sees=observer_sees)
            self.result["core_verb"] = _cv.core_verb_block(
                spec, word, reason, drive=drive, persisted=persisted,
                observer_sees=observer_sees, cleanup=cleanup,
                http_status=st, error=derr)
            if word == "CORE_VERB_FAIL":
                self.finding("core_verb", "high",
                             "Core verb fails end to end: %s" % spec.get("verb"),
                             _cv.repro_steps(spec, word, reason),
                             "The lens's defining verb works for its own user, persists on reload, and is visible per spec (%s)" % spec.get("visibility"),
                             reason, [self.result.get("initial_evidence")],
                             defect_class="greeting-dead-surfaces")
            self.log("  core verb %s: %s (%s)" % (self.slug, word, reason))
        finally:
            try:
                fctx.close()
            except Exception:
                pass
            self._close(wctx)
    def durability_phase(self):
        """ULW v3 (GB-1576 W5c): DURABILITY — re-issue up to
        thresholds.durability_max_probes of the lens's recorded creates as
        the write account, each with a unique planted marker; wait past the
        save debounce (thresholds.durability_wait_s, one wait for the
        batch); then verify each marker via a FRESH session (new context,
        reload, durable texts) and a BACKEND READ (the created object's
        URL, else the lens's recorded read route for the collection).
        Planning and verdicts live in concord_walker.durability (pure);
        this method only drives contexts. A DURABLE_FAIL files a walk
        finding; probe objects are deleted best-effort when their object
        URL is known, else left carrying the run's marker (the labelled-
        fixture discipline). No server restarts, ever."""
        from . import durability as _dur
        import json as _json
        wait_s = self.th.get("durability_wait_s", 8)
        cap = self.th.get("durability_max_probes", 3)
        _leg = getattr(self.net, "leg_calls", None)
        calls = _leg() if _leg else list(self.net.replay or [])
        label = None
        for f in (self.rec.fixtures or {}).values():
            if f.get("lens") == self.slug and f.get("label"):
                label = f.get("label")
        candidates = _dur.pick_write_calls(calls, cap=cap, fixture_label=label)
        plan = _dur.probe_plan(candidates)
        if not plan["run"]:
            self.result["durability"] = _dur.durability_block(None, plan["reason"])
            return
        wctx, _wpage, _wcdp = self.open(account=self.write_acct)
        fired = []
        try:
            assert_account(wctx, self.cfg, self.write_acct, "durability probes", self.log)
            for i, cand in enumerate(candidates):
                marker = "%s-DUR-%s-%s-%d" % (self.cfg["fixture_prefix"], self.slug,
                                              (self.rec.rid or "run")[-4:], i)
                body, field = _dur.plant_marker(cand["post"], marker, label)
                if body is None:
                    continue
                status, resp_obj = None, None
                try:
                    resp = wctx.request.fetch(cand["url"], method=cand["method"],
                                              data=body, timeout=15000,
                                              headers={"Content-Type": "application/json"})
                    status = resp.status
                    try:
                        resp_obj = resp.json()
                    except Exception:
                        resp_obj = None
                except Exception:
                    status = None
                fired.append({"cand": cand, "marker": marker, "field": field,
                              "status": status, "resp_obj": resp_obj,
                              "obj_url": _dur.object_url(cand, resp_obj)})
        finally:
            self._close(wctx)
        if fired:
            time.sleep(wait_s)
        rows = []
        fctx = fpage = fcdp = None
        try:
            fctx, fpage, fcdp = self.open(account=self.write_acct)
            assert_account(fctx, self.cfg, self.write_acct, "durability verify", self.log)
            self.nav(fpage, fcdp)
            texts = fcdp.ax().durable_texts()

            def backend_read(probe):
                urls = []
                if probe["obj_url"]:
                    urls.append(probe["obj_url"])
                for rc in _dur.pick_read_calls(calls, probe["cand"]):
                    if rc.get("url") and rc["url"] not in urls:
                        urls.append(rc["url"])
                if not urls:
                    return None, None
                last_status = None
                for u in urls:
                    try:
                        resp = fctx.request.get(u, timeout=15000)
                        last_status = resp.status
                        if not (200 <= resp.status < 300):
                            continue
                        try:
                            text = resp.text()
                        except Exception:
                            text = None
                        if text is None:
                            try:
                                text = _json.dumps(resp.json(), default=str)
                            except Exception:
                                text = ""
                        return probe["marker"] in (text or ""), resp.status
                    except Exception:
                        continue
                return False, last_status

            for probe in fired:
                fresh = any(probe["marker"] in t for t in texts)
                backend, backend_status = backend_read(probe)
                verdict, reason = _dur.probe_verdict(probe["status"], fresh,
                                                     backend, backend_status)
                row = {"write": "%s %s" % (probe["cand"]["method"],
                                           probe["cand"]["path"]),
                       "field": probe["field"], "wait_s": wait_s,
                       "fresh": fresh, "backend": backend,
                       "verdict": verdict, "reason": reason}
                if probe["obj_url"]:
                    try:
                        resp = fctx.request.fetch(probe["obj_url"], method="DELETE",
                                                  timeout=15000)
                        row["cleanup"] = ("deleted" if resp.status in (200, 204, 404)
                                          else "delete_status_%s" % resp.status)
                    except Exception:
                        row["cleanup"] = "delete_error"
                else:
                    row["cleanup"] = "left_labelled"
                if verdict == "DURABLE_FAIL":
                    ev = self.shot(fpage, "durability-fail")
                    self.finding("durability", "high",
                                 "Write did not persist past the save debounce: %s" % row["write"],
                                 ["Open %s" % self.url,
                                  "Write via the lens (%s, marker in field '%s')" % (row["write"], probe["field"]),
                                  "Wait %ss (past the save debounce)" % wait_s,
                                  "Reload in a fresh session and re-read the backend"],
                                 "The written object is readable from the backend and visible in a fresh session",
                                 reason, [ev], root_cause="RCA-durability",
                                 area="%s/durability" % self.slug)
                rows.append(row)
        finally:
            if fctx is not None:
                self._close(fctx)
        self.result["durability"] = _dur.durability_block(rows)
        db = self.result["durability"]
        self.log("  durability %s: %d probe(s), %d failed, %d unverified (wait %ss)" % (
            self.slug, db["probes"], db["failed"], db["unverified"], wait_s))
    def _broadcast_leg(self, owner, observer, octx, label, candidates):
        """W5b private-broadcast leg: the foreign context listens on this
        lens's socket while the owner performs a private write on its own
        labelled fixture carrying the run's unique marker. The marker in
        the foreign frames is a LEAK. Returns (outcome, skip_reason)."""
        from . import trust_probes as _tp
        from .privacy_checks import FrameCapture, SOCKET_WINDOW_S
        act_row = candidates[0]
        obj = dict(_tp.body_obj(act_row.get("post")) or {})
        marker = "%s-bc-%s" % (label, str(self.rec.rid)[-6:])
        for k, v in obj.items():
            if isinstance(v, str) and v:
                obj[k] = marker
                break
        ctx2 = None
        try:
            ctx2 = new_context(self.b, self.cfg, observer, self.vp)
            try:
                assert_account(ctx2, self.cfg, observer, "broadcast leg", self.log)
            except Exception:
                return None, "observer guard failed for the broadcast leg"
            page = ctx2.new_page()
            page.goto(self.url, wait_until="load", timeout=45000)
            cap = FrameCapture(ctx2.new_cdp_session(page))
            try:
                octx.request.fetch(act_row["url"], method=act_row["method"],
                                   data=json.dumps(obj),
                                   headers={"content-type": "application/json"},
                                   timeout=15000)
            except Exception:
                return None, "the owner's marker act failed to fire"
            frame = cap.wait_for(needle=marker, timeout=SOCKET_WINDOW_S)
            verdict = _tp.broadcast_verdict(len(cap.frames), bool(frame))
            if verdict == "LEAK":
                cid = self.net._cid_at(act_row.get("t")) if act_row.get("t") is not None else None
                sid = (self.net.meta.get(cid) or {}).get("sid") if cid else None
                if cid:
                    self.net.annotate(cid, ownership=[
                        "%s broadcast %s %s -> marker in foreign frames (W5b private-broadcast)" % (
                            observer, act_row["method"], act_row["path"])])
                self._premap_finding("ownership", cid, sid,
                                     "Private broadcast leak: this lens pushed the owner's private "
                                     "fixture content to a foreign account's socket (W5b)",
                                     ["the run's fixture marker arrived in the foreign context's "
                                      "websocket frames after a private owner write"], severity="high")
            try:
                octx.request.fetch(act_row["url"], method=act_row["method"],
                                   data=act_row.get("post"),
                                   headers={"content-type": "application/json"},
                                   timeout=15000)
            except Exception:
                pass
            return {"verdict": verdict, "frames": len(cap.frames)}, None
        except Exception:
            return None, "broadcast leg errored before a verdict"
        finally:
            if ctx2 is not None:
                try:
                    ctx2.close()
                except Exception:
                    pass

    def cross_account(self):
        """Upgrade 3 (opt-in --two-account): replay t1's object calls (reads, and non-DELETE
        writes) as t2 in t2's OWN isolated context. t2 getting 2xx with a non-error body on
        t1's object = ownership finding. Raw URLs/bodies live only in memory for this
        replay and are never written. Never deletes; t2 credentials are never read here
        (the saved auth/t2.json session is used)."""
        from .auth import has_session, isolation_pair
        from urllib.parse import urlsplit
        cap = self.th.get("two_account_max_calls", 12)
        _owner, foreign = isolation_pair(self.cfg, self.acct)
        if self.admin or not self.acct or self.acct != (self.cfg.get("reader_account") or "t1"):
            self.result["two_account"] = {"status": "SKIPPED", "reason": "t1 member walks only"}
            return
        if not has_session(self.cfg, foreign):
            self.result["two_account"] = {"status": "SKIPPED", "reason": "no saved %s session (auth/%s.json)" % (foreign, foreign)}
            return
        from . import intended_public as _ip
        ip_entries = _ip.load(self.cfg.get("intended_public_file"))
        seen, todo = set(), []
        # prefer the call a named control made over the same call made by a page load
        for r in sorted(self.net.replay, key=lambda x: (x["method"] != "GET", self.net._cid_at(x["t"]).endswith(":page:-"), x["t"])):
            k = (r["method"], r["path"])
            if k in seen or r["method"] == "DELETE":
                continue
            # ULW C28: never replay an account's own calls as itself (untagged rows = the walk account)
            if (r.get("acct") or self.acct) == foreign:
                continue
            if r["method"] != "GET" and not self.th.get("two_account_writes", True):
                continue
            seen.add(k)
            todo.append(r)
        todo = todo[:cap]
        rows = []
        if not todo:
            self.result["two_account"] = {"status": "NA", "reason": "no object calls recorded", "replayed": 0}
            return
        vp = self.cfg["viewport_desktop"]
        ctx = new_context(self.b, self.cfg, foreign, vp)
        try:
            assert_account(ctx, self.cfg, foreign, "two-account replay", self.log)
            for r in todo:
                if urlsplit(r["url"]).netloc != urlsplit(self.cfg["base_url"]).netloc:
                    continue
                kw = {"timeout": 15000}
                if r["post"] is not None:
                    kw["data"] = r["post"]
                    kw["headers"] = {"Content-Type": "application/json"}
                try:
                    resp = ctx.request.fetch(r["url"], method=r["method"], **kw)
                    st = resp.status
                    try:
                        body = resp.json()
                    except Exception:
                        body = None
                except Exception as e:
                    rows.append({"method": r["method"], "path": r["path"], "status": None, "verdict": "error", "error": type(e).__name__})
                    continue
                refused = isinstance(body, dict) and (body.get("ok") is False or "error" in body)
                leak = 200 <= st < 300 and not refused
                cid = self.net._cid_at(r["t"])
                row = {"method": r["method"], "path": r["path"], "status": st, "control_id": cid,
                       "verdict": "OWNERSHIP_FAIL" if leak else "PASS",
                       "owner": r.get("acct") or self.acct, "foreign": foreign}
                if leak and r["method"] == "GET":
                    # false-positive control: a resource a signed-out visitor can also read is
                    # public, not an ownership leak (live run 2026-11-16). GET only; anon never writes.
                    anon_st = self._anon_get(r["url"])
                    row["anon_status"] = anon_st
                    if anon_st is not None and 200 <= anon_st < 300:
                        row["verdict"] = "PUBLIC"
                        leak = False
                    else:
                        # false-positive control 2: many routes ignore the path id and answer with the
                        # CALLER's own data (or an empty shell). Only t2 receiving the same non-empty
                        # payload t1 receives is a leak. Payloads are compared in memory only; just
                        # the verdict is stored (live run 2026-11-16, /api/chat/memory/:id).
                        same, b1 = self._same_as_t1(r["url"], body, vp, owner=r.get("acct") or self.acct)
                        echoes = tuple(x for x in urlsplit(r["url"]).path.split("/") if x)
                        row["same_as_t1"] = same
                        # shape stats only (leaf counts, never values) so a later reader can tell a
                        # zeroed shell from real data; t1_contentless covers 'identical zero bodies'
                        # (e.g. chat-memory {counts 0, topics [], windowUtilization '0/N'}).
                        row["t2_shape"] = dict(zip(("leaves", "nonempty"), _payload_shape(body, echoes))) if body is not None else None
                        row["t1_shape"] = dict(zip(("leaves", "nonempty"), _payload_shape(b1, echoes))) if b1 is not None else None
                        row["t1_contentless"] = _contentless(b1, echoes) if b1 is not None else None
                        if _contentless(body, echoes):
                            row["verdict"], leak = "EMPTY", False
                        elif same is False:
                            row["verdict"], leak = "SCOPED", False
                if leak:
                    # product decision: route intended to be readable by any member (config/intended_public.json)
                    ip = _ip.match(ip_entries, r["method"], r["path"])
                    if ip is not None:
                        row["verdict"], leak = "PUBLIC_INTENDED", False
                        row["intended_public"] = _ip.tag(ip)
                rows.append(row)
                if leak:
                    kind = "read" if r["method"] == "GET" else "write"
                    self.net.annotate(cid, ownership=["%s %s %s %s -> %d" % (foreign, kind, r["method"], r["path"], st)])
                    if not (self.net.meta.get(cid) or {}).get("evidence") and self.result.get("initial_evidence"):
                        self.net.annotate(cid, evidence=[self.result["initial_evidence"]])
                    sid = (self.net.meta.get(cid) or {}).get("sid")
                    self._premap_finding("ownership", cid, sid,
                                         "Second account can %s the first account's object: %s %s -> %d" % (kind, r["method"], r["path"], st),
                                         [self.result.get("initial_evidence")], severity="high")
        finally:
            try:
                ctx.close()
            except Exception:
                pass
        fails = sum(1 for x in rows if x["verdict"] == "OWNERSHIP_FAIL")
        self.result["two_account"] = {"status": "FAIL" if fails else "PASS", "replayed": len(rows),
                                      "ownership_failures": fails, "public": sum(1 for x in rows if x["verdict"] == "PUBLIC"),
                                      "scoped": sum(1 for x in rows if x["verdict"] in ("SCOPED", "EMPTY")),
                                      "public_intended": sum(1 for x in rows if x["verdict"] == "PUBLIC_INTENDED"),
                                      "calls": rows}

    def _same_as_t1(self, url, t2_body, vp, owner="t1"):
        """(same, t1_payload): does t1 get the identical JSON payload for this GET? same is None
        if unknown. The payload stays in memory; callers store only derived booleans/counts."""
        import json as _json
        if t2_body is None:
            return None, None
        ctx = None
        try:
            ctx = new_context(self.b, self.cfg, owner, vp)  # ULW C28: the row's OWNER account
            resp = ctx.request.get(url, timeout=15000)
            try:
                b1 = resp.json()
            except Exception:
                return None, None
            canon = lambda x: _json.dumps(x, sort_keys=True, default=str)
            return canon(b1) == canon(t2_body), b1
        except Exception:
            return None, None
        finally:
            try:
                if ctx is not None:
                    ctx.close()
            except Exception:
                pass

    def _anon_get(self, url):
        """Status of the same GET with no session at all (fresh context, no cookies)."""
        ctx = None
        try:
            ctx = self.b.new_context()
            resp = ctx.request.get(url, timeout=15000)
            try:
                body = resp.json()
            except Exception:
                body = None
            if 200 <= resp.status < 300 and isinstance(body, dict) and (body.get("ok") is False or "error" in body):
                return 403  # a 2xx refusal body counts as not readable
            return resp.status
        except Exception:
            return None
        finally:
            try:
                if ctx is not None:
                    ctx.close()
            except Exception:
                pass

    SAVE_ACTION = re.compile(r"(?i)^(save|create|add|update|set|store|record|log|upsert|put|edit|pin|star|rename)")

    def _persisting_writes(self, writes):
        """Writes whose effect should survive a reload: PUT/PATCH/DELETE, or a POST that is
        not a pure lens compute (POST /api/lens/run only counts for a known save action)."""
        out = []
        for r in writes:
            try:
                from urllib.parse import urlsplit
                path_t = template_path(urlsplit(r.url).path)[0]
            except Exception:
                continue
            if r.method in ("PUT", "PATCH", "DELETE"):
                out.append((r.method, path_t))
            elif r.method == "POST":
                if path_t.rstrip("/") == "/api/lens/run":
                    try:
                        a = lens_action("POST", path_t, json.loads(r.post_data or "{}"))
                    except Exception:
                        a = None
                    if a and self.SAVE_ACTION.search(a.get("action", "")):
                        out.append((r.method, path_t))
                else:
                    out.append((r.method, path_t))
        return out

    def _premap_finding(self, cls, cid, sid, title, evidence, **extra):
        f = {"class": cls, "control_id": cid, "sid": sid, "title": title, "evidence": [e for e in evidence if e]}
        f.update(extra)
        f.update(row_stamp(self.deploy))
        self.premap_findings.append(f)
        return f

    def _premap_checks(self, page, cdp, cid, sid, label, why, writes, texts0, ax1):
        """Upgrades 2 + 7: write-then-read-back on persisting 2xx writes, and one
        screenshot per broken control (failure only)."""
        ev = None
        pw = self._persisting_writes(writes)
        if pw and not why:
            new = {t for t in ax1.durable_texts() if t not in texts0 and len(t.strip()) >= 3}
            if not new:
                self.net.annotate(cid, readback="unverifiable: no new durable text after the write (menus/dialogs/toasts ignored)")
            else:
                ev_after = self.shot(page, "fail-" + label[:30])
                self.nav(page, cdp)
                after = set(cdp.ax().texts())
                kept = new & after
                if kept:
                    self.net.annotate(cid, readback="persisted")
                    if ev_after:  # not a failure: drop the provisional image
                        self._drop_shot(ev_after)
                else:
                    # one image per broken control: the screen that claimed success
                    self.net.annotate(cid, readback="lost after reload", fake_success=True,
                                      evidence=[ev_after] if ev_after else [])
                    self._premap_finding("fake_success", cid, sid,
                                         "'%s' reports success (%s) but the change is gone after reload: %s" % (
                                             label, ", ".join("%s %s" % w for w in pw[:2]), "; ".join(sorted(new))[:80]),
                                         [ev_after], writes=["%s %s" % w for w in pw[:3]])
                    return
        if why:
            ev = self.shot(page, "fail-" + label[:30])
            self.net.annotate(cid, evidence=[ev] if ev else [])
            for w in sorted(why):
                self._premap_finding(w, cid, sid, "'%s': %s after click" % (label, w.replace("_", " ")), [ev])

    def _drop_shot(self, rel):
        try:
            os.remove(os.path.join(self.cfg["audit_dir"], rel))
        except Exception:
            pass
        self.screens = [s for s in self.screens if s["path"] != rel]

    def reset_page(self, page, cdp):
        """Return to a clean lens state between phases (close popups by reload)."""
        if cdp.ax().popups() or self.url.split("?")[0] not in page.url:
            self.nav(page, cdp)

    # ---------------------------------------------------------------- phases
    def reach(self, page, cdp):
        t = self.nav(page, cdp)
        self.result["timing_desktop"] = t
        if self.signed_out(page):
            ev = self.shot(page, "signed-out")
            if self.gate_check:
                # an admin lens bouncing a member account to /login is the gate holding
                self.mark("reach_desktop", "PASS", gate="admin", reason="redirected to /login", final_url=page.url, evidence=ev)
                return False
            if self.acct:
                raise AccountMismatch("session redirected to /login on %s" % self.slug)
            self.mark("reach_desktop", "AUTH_GATE", final_url=page.url, evidence=ev)
            return True  # still run read-only checks on what renders (signed-out smoke)
        ax = cdp.ax()
        errs = self.error_texts(ax)
        ev = self.shot(page, "desktop-initial")
        self.result["initial_evidence"] = ev
        if self.gate_check and gate_verdict(t["status"], ax.texts(), False) == "PASS":
            self.mark("reach_desktop", "PASS", gate="admin", reason="403 / no-access page", evidence=ev, **t)
            return False  # gate held; there is no member surface to check behind it
        if t["error"] or (t["status"] and t["status"] >= 400) or errs:
            self.finding("reach", "high", "Lens fails to load on desktop (%s)" % (errs[0] if errs else t["status"] or t["error"]),
                         ["Open %s at 1280x900 as %s" % (self.url, self.cfg["accounts"][self.acct]["username"] if self.acct else "signed-out"), "Wait for load"],
                         "Lens renders its main view", "Navigation status %s, error %s, error text: %s" % (t["status"], t["error"], "; ".join(errs[:2]) or "none"),
                         [ev], area="%s/route" % self.slug)
            self.mark("reach_desktop", "FAIL", **t)
            return not errs or len(ax.by_role("button")) > 3
        if self.gate_check:
            # the gate did NOT hold: a member account can load an admin lens
            self.finding("reach", "high", "Admin lens loads for a non-admin account (gate did not hold)",
                         ["Open %s at 1280x900 as %s" % (self.url, self.cfg["accounts"][self.acct]["username"] if self.acct else "signed-out"), "Wait for load"],
                         "The admin lens refuses non-admin accounts (403 / no-access / login redirect)",
                         "The lens rendered its surface for a non-admin account", [ev], area="%s/route" % self.slug)
            self.mark("reach_desktop", "FAIL", gate="admin", reason="gate did not hold", **t)
            return True
        self.mark("reach_desktop", "PASS", **t)
        # load timing
        if t["load_ms"] > self.th["load_ms_low"]:
            sev = "medium" if t["load_ms"] > self.th["load_ms_medium"] else "low"
            self.finding("timing", sev, "Lens load takes %.1f s on desktop" % (t["load_ms"] / 1000),
                         ["Open %s at 1280x900 (cold context)" % self.url, "Measure navigation to load event"],
                         "Load event under %.0f s" % (self.th["load_ms_low"] / 1000),
                         "Load %d ms, DOMContentLoaded %d ms, network settled %s at %d ms, visually ready at %d ms" % (t["load_ms"], t["dcl_ms"], t["settled"], t["settle_ms"], t["ready_ms"]),
                         [ev], area="%s/perf" % self.slug)
        if not t["settled"]:
            if t.get("settle_capped"):
                self.judge("timing", "Network idle wait stopped by the per-lens settle cap (ULW C5: %ds budget, %ds spent) — settle not observed, not a lens judgment" % (int(self.settle_budget_s), int(self.settle_spent_s)), [ev])
            else:
                self.judge("timing", "Network never went idle within %d s (polling or stuck request?)" % (self.th["settle_ms_judgment"] / 1000), [ev])
        self.result["perf_metrics"] = {k: v for k, v in cdp.perf_metrics().items()
                                       if k in ("JSHeapUsedSize", "Nodes", "LayoutCount", "RecalcStyleCount", "ScriptDuration", "TaskDuration")}
        return True

    def surface(self, page, cdp):
        ax = cdp.ax()
        tabs = ax.by_role("tab")
        buttons = [n for n in ax.by_role("button") if n.backend]
        links = ax.by_role("link")
        inputs = ax.by_role("textbox", "searchbox", "combobox", "spinbutton")
        unnamed = [n for n in buttons if not n.name.strip()]
        unfocus = [n for n in buttons + tabs if not n.disabled and not n.focusable and n.name.strip()]
        # GB-1580 item 4: the inventory also reports the lens MAIN-CONTENT
        # region (shell chrome excluded) — the page-wide counts stay for
        # comparability, the *_main fields are the lens's own inventory.
        _scope = region_scope(ax)

        def _in(n):
            return in_main_region(ax, n, _scope)

        self.result["surface"] = {"tabs": [control_label(n.name) for n in tabs][:60], "buttons": len(buttons), "links": len(links),
                                  "inputs": len(inputs), "unnamed_buttons": len(unnamed), "non_focusable": len(unfocus),
                                  "region": _scope[0],
                                  "buttons_main": sum(1 for n in buttons if _in(n)), "links_main": sum(1 for n in links if _in(n)),
                                  "inputs_main": sum(1 for n in inputs if _in(n)), "tabs_main": sum(1 for n in tabs if _in(n)),
                                  "button_names_main": [control_label(n.name) for n in buttons if n.name.strip() and _in(n)][:80],
                                  "disabled_buttons": sum(1 for n in buttons if n.disabled),
                                  # WALK-03: names, so reverify can confirm the ticket's own control
                                  # individually instead of judging the whole surface.
                                  "button_names": [control_label(n.name) for n in buttons if n.name.strip()][:80],
                                  "tab_names": [control_label(n.name) for n in tabs if n.name.strip()][:60],
                                  "non_focusable_names": sorted({control_label(n.name) for n in unfocus})[:40]}
        status = "PASS"
        if unnamed:
            shots = []
            for n in unnamed[:3]:
                b = cdp.box(n.backend)
                if b and b[1] + b[3] <= self.cfg["viewport_desktop"][1]:
                    shots.append(self.shot(page, "unnamed-button", clip=self._pad(b)))
            shots.append(self.result.get("initial_evidence"))
            self.finding("unnamed", "low", "%d button(s) have no accessible name" % len(unnamed),
                         ["Open %s at 1280x900" % self.url, "Inspect the Accessibility tree (DevTools) for role=button nodes"],
                         "Every button exposes an accessible name (text or aria-label)",
                         "%d of %d buttons have an empty accessible name (icon-only)" % (len(unnamed), len(buttons)), shots,
                         area="%s/a11y labels" % self.slug)
            status = "FAIL"
        if unfocus:
            names = ", ".join(sorted({control_label(n.name) for n in unfocus})[:8])
            self.finding("keyboard", "medium", "%d control(s) can't be reached by keyboard" % len(unfocus),
                         ["Open %s at 1280x900" % self.url, "Press Tab through the page", "Check the Accessibility tree 'focusable' state of each button/tab"],
                         "Every enabled button and tab is keyboard-focusable",
                         "Not focusable: %s" % names, [self.result.get("initial_evidence")], element=names.split(",")[0],
                         area="%s/a11y keyboard" % self.slug)
            status = "FAIL"
        self.mark("surface_inventory", status, **self.result["surface"])

    def tabs(self, page, cdp):
        ax = cdp.ax()
        tabs = [n for n in ax.by_role("tab") if n.backend and safety.is_tab_safe(n.name, self.admin)]
        skipped = [control_label(n.name) for n in ax.by_role("tab") if not safety.is_tab_safe(n.name, self.admin)]
        tabs = tabs[: self.th["max_tabs_per_lens"]]
        out, status = [], "PASS" if tabs else "NA"
        names = [n.name for n in tabs]
        for name in names:
            if self.over_budget() or self.crashes or self.phase_over():
                break
            ax = cdp.ax()
            node = next((n for n in ax.by_role("tab") if n.name == name and n.backend), None)
            if not node:
                out.append({"tab": control_label(name), "status": "NOT_FOUND"})
                continue
            pe0 = len(self.page_errors)
            t0 = time.time()
            tcid = self.net.open_window("tab", "tab", control_label(name))
            if not cdp.click(node.backend):
                self.net.note_control("tab", "tab", control_label(name), False, reason="not_visible", cid=tcid)
                self.net.meta[tcid].update(exercised=False, reason="not_visible")
                out.append({"tab": control_label(name), "status": "NOT_VISIBLE"})
                continue
            sel, dt = wait_until(lambda: next((n for n in cdp.ax().by_role("tab") if n.name == name and n.props.get("selected")), None),
                                 timeout=self.th["tab_switch_ms_judgment"] / 1000)
            ms = int((time.time() - t0) * 1000)
            try:
                page.wait_for_load_state("networkidle", timeout=4000)
            except Exception:
                pass
            ax2 = cdp.ax()
            errs = self.error_texts(ax2)
            ev = self.shot(page, "tab-" + control_label(name, 24), jpeg=True)
            self.net.set_effect(tcid, "ax_change" if sel else "none")
            row = {"tab": control_label(name), "selected": bool(sel), "switch_ms": ms if sel else None, "evidence": ev}
            if errs or len(self.page_errors) > pe0 or self.crashes:
                row["status"] = "FAIL"; status = "FAIL"
                self.finding("tab_error", "high" if self.crashes else "medium",
                             "'%s' tab shows an error" % control_label(name),
                             ["Open %s at 1280x900" % self.url, "Click the '%s' tab" % control_label(name)],
                             "Tab content renders without errors",
                             "Error text: %s; new uncaught page errors: %d%s" % ("; ".join(errs[:2]) or "none", len(self.page_errors) - pe0,
                                                                                 "; renderer crashed" if self.crashes else ""),
                             [ev], element=name, area="%s/tab %s" % (self.slug, control_label(name)))
            elif not sel:
                row["status"] = "UNKNOWN"
                self.judge("tab_selection", "Clicked tab '%s' but it never reported aria-selected; did the view change?" % control_label(name), [ev])
            else:
                row["status"] = "PASS"
                if ms > self.th["tab_switch_ms_low"]:
                    self.finding("timing", "low", "Switching to the '%s' tab takes %.1f s" % (control_label(name), ms / 1000),
                                 ["Open %s at 1280x900" % self.url, "Click the '%s' tab and time until it is selected" % control_label(name)],
                                 "Tab switch under %.1f s" % (self.th["tab_switch_ms_low"] / 1000), "Took %d ms" % ms, [ev],
                                 element=name, area="%s/perf" % self.slug)
            out.append(row)
        self.mark("tabs_reachable", status, tabs=out, skipped_for_safety=skipped)

    def keyboard(self, page, cdp):
        """Tab sweep: sample focus stops; flag stops with no visible focus change (pixel-identical)."""
        seen, samples, no_visible, prev = [], 0, [], None
        page.mouse.click(2, 2)
        for i in range(self.th["tab_key_presses"]):
            page.keyboard.press("Tab")
            time.sleep(0.4 if (prev is not None or samples < 12) else 0.12)  # let focus-ring transitions finish
            f = cdp.ax().focused()
            if prev is not None:
                # re-capture previous stop now that it is unfocused
                pnode, pclip, pbytes = prev
                try:
                    after = page.screenshot(clip=pclip, timeout=5000)
                    if after == pbytes:
                        no_visible.append(pnode)
                except Exception:
                    pass
                prev = None
            if not f or not f.backend:
                continue
            if seen and f.backend == seen[0]:
                break  # wrapped
            seen.append(f.backend)
            if samples < 12 and f.role in ("button", "tab", "link", "textbox", "checkbox", "menuitem", "combobox", "switch"):
                b = cdp.box(f.backend)
                if b and 0 <= b[1] and b[1] + b[3] <= self.cfg["viewport_desktop"][1]:
                    clip = self._pad(b, 6)
                    try:
                        prev = (f, clip, page.screenshot(clip=clip, timeout=5000))
                        samples += 1
                    except Exception:
                        pass
        status = "PASS"
        if no_visible:
            names = sorted({control_label(n.name) for n in no_visible})
            ev = []
            for n in no_visible[:2]:
                cdp.focus(n.backend)
                b = cdp.box(n.backend)
                if b:
                    ev.append(self.shot(page, "focus-not-visible", clip=self._pad(b, 6)))
            ev.append(self.shot(page, "focus-not-visible-page"))
            self.finding("focus_visible", "low", "No visible focus indicator on %d of %d sampled controls" % (len(no_visible), samples),
                         ["Open %s at 1280x900" % self.url, "Press Tab repeatedly", "Compare each control focused vs unfocused"],
                         "Focused controls show a visible focus ring", "Pixel-identical focused/unfocused rendering for: %s" % ", ".join(names[:8]),
                         ev, area="%s/a11y focus" % self.slug)
            status = "FAIL"
        self.mark("keyboard_focus", status, stops=len(seen), sampled=samples, no_visible=len(no_visible),
                  # WALK-03: names for individual confirmation in reverify.
                  no_visible_names=sorted({control_label(n.name) for n in no_visible})[:20])

    def _popup_new(self, cdp, before, opener_backend):
        ax = cdp.ax()
        new = [p for p in ax.popups() if p.backend not in before]
        op = next((n for n in ax.live() if n.backend == opener_backend), None)
        if new:
            return ax, new[0]
        if op is not None and op.props.get("expanded"):
            return ax, None
        return None

    def openers(self, page, cdp):
        ax = cdp.ax()
        # GB-1581 item 3a: open-only candidates (Share / Publish / Export /
        # Download openers) join the Escape check — opened, never submitted.
        cands = [n for n in ax.by_role("button", "menuitem") if n.backend and not n.disabled
                 and (safety.is_opener_safe(n.name, self.admin) or safety.is_open_only_safe(n.name, self.admin))]
        seen, rows, status = set(), [], "NA"
        for n in cands:
            if len(rows) >= self.th["max_openers_per_lens"] or self.over_budget() or self.phase_over():
                break
            key = control_label(n.name)
            if key in seen:
                continue
            seen.add(key)
            self.reset_page(page, cdp)
            ax = cdp.ax()
            node = next((x for x in ax.by_role("button", "menuitem") if x.name == n.name and x.backend and not x.disabled), None)
            if not node:
                continue
            before = {p.backend for p in ax.popups()}
            ocid = self.net.open_window("opener", node.role, key)
            if not cdp.click(node.backend):
                self.net.meta[ocid].update(exercised=False, reason="not_visible")
                continue
            got, _ = wait_until(lambda: self._popup_new(cdp, before, node.backend), timeout=2.0)
            self.net.set_effect(ocid, "ax_change" if got or self._ax_sig(cdp.ax()) != self._ax_sig(ax) else "none")
            if not got:
                rows.append({"opener": key, "status": "NO_POPUP"})
                continue
            ax, pop = got
            kind = pop.role if pop else "expanded"
            ev_open = self.shot(page, "open-" + key[:20])
            row = {"opener": key, "popup": kind, "evidence": ev_open}
            if not safety.is_opener_safe(node.name, self.admin):
                row["open_only"] = True  # GB-1581 3a: opened for the Escape check; nothing inside was activated
            status = "PASS" if status == "NA" else status
            # focus trap (dialogs only)
            if pop is not None and pop.role in ("dialog", "alertdialog"):
                escaped = 0
                for _ in range(10):
                    page.keyboard.press("Tab"); time.sleep(0.08)
                    ax3 = cdp.ax(); f = ax3.focused(); p3 = next((p for p in ax3.popups() if p.backend == pop.backend), None)
                    if f and p3 and not ax3.is_inside(f, p3) and f.backend != p3.backend:
                        escaped += 1
                if escaped:
                    ev = self.shot(page, "focus-escapes-" + key[:20])
                    self.finding("focus_trap", "low", "Focus leaves the '%s' dialog on Tab" % key,
                                 ["Open %s at 1280x900" % self.url, "Click '%s'" % key, "Press Tab 10 times"],
                                 "Focus stays inside the open dialog", "Focus moved behind the dialog on %d of 10 Tab presses" % escaped,
                                 [ev_open, ev], element=key, area="%s/dialog focus trap" % self.slug)
                    row["trap"] = "FAIL"; status = "FAIL"
            # Escape
            self.net.open_window("escape", "key", key)
            page.keyboard.press("Escape")
            closed, _ = wait_until(lambda: (pop is None and not any(x.props.get("expanded") for x in cdp.ax().live() if x.backend == node.backend))
                                   or (pop is not None and not any(p.backend == pop.backend for p in cdp.ax().popups())), timeout=2.0)
            ev_after = self.shot(page, "after-escape-" + key[:20])
            if not closed:
                row["escape"] = "FAIL"; status = "FAIL"
                self.finding("escape", "medium" if kind in ("dialog", "alertdialog") else "low",
                             "Escape doesn't close the '%s' %s" % (key, "dialog" if kind in ("dialog", "alertdialog") else "menu/panel"),
                             ["Open %s at 1280x900" % self.url, "Click '%s'" % key, "Press Escape"],
                             "Escape closes the overlay and returns focus to '%s'" % key, "Overlay still open after Escape",
                             [ev_open, ev_after], element=key, area="%s/overlay keyboard" % self.slug)
                self._force_close(page, cdp)
            else:
                row["escape"] = "PASS"
                f = cdp.ax().focused()
                if not f or f.backend != node.backend:
                    row["focus_return"] = "FAIL"; status = "FAIL"
                    self.finding("focus_return", "low", "Focus doesn't return to '%s' after Escape" % key,
                                 ["Open %s at 1280x900" % self.url, "Click '%s'" % key, "Press Escape", "Check which element has focus"],
                                 "Focus returns to the control that opened the overlay",
                                 "Focus went to %s" % (("'%s' (%s)" % (control_label(f.name), f.role)) if f else "the document body"),
                                 [ev_open, ev_after], element=key, area="%s/overlay focus" % self.slug)
                else:
                    row["focus_return"] = "PASS"
            rows.append(row)
        self.mark("escape_focus", status, openers=rows, candidates=len(cands))

    def _force_close(self, page, cdp):
        ax = cdp.ax()
        for p in ax.popups():
            for d in ax.descendants(p):
                if d.role == "button" and d.backend and safety.is_close_safe(d.name):
                    cdp.click(d.backend); time.sleep(0.4)
                    return
        self.nav(page, cdp)

    # WALK-03: strings that identify the rows this lens is showing right now —
    # the yardstick an export's content is compared against. Chrome words are
    # excluded; a file full of other rows is the wrong-content genus.
    _CHROME_WORDS = {"export", "download", "search", "menu", "close", "settings", "home", "back",
                     "next", "previous", "submit", "cancel", "save", "delete", "edit", "create",
                     "new", "add", "filter", "sort", "help", "profile", "notifications",
                     "sign out", "log out", "select all", "actions"}

    def _visible_identifiers(self, cdp):
        out = []
        for t in cdp.ax().texts():
            t = " ".join((t or "").split())
            if len(t) >= 4 and t.lower() not in self._CHROME_WORDS and t not in out:
                out.append(t)
        return out[:60]

    def export(self, page, cdp):
        if self.admin:
            self.mark("export", "NOT_RUN", reason="admin lens: look-only")
            return
        visible_ids = self._visible_identifiers(cdp)
        ax = cdp.ax()
        cands = [n for n in ax.by_role("button", "link", "menuitem") if n.backend and not n.disabled and safety.is_export_safe(n.name)]
        if not cands:
            prev = str((self.inv.get("checks") or {}).get("export", ""))
            self.mark("export", "NO_CONTROL", previous=prev[:80])
            if prev.upper().startswith("PASS"):
                self.judge("export_missing", "Export was PASS in the human walk but the walker found no Export/Download control on the main view. Moved behind a menu or removed?",
                           [self.result.get("initial_evidence")])
            return
        rows, status = [], "PASS"
        for n in cands[:2]:
            key = control_label(n.name)
            self.reset_page(page, cdp)
            node = next((x for x in cdp.ax().live() if x.name == n.name and x.backend and not x.disabled), None)
            if not node:
                continue
            before = {p.backend for p in cdp.ax().popups()}
            self.net.open_window("export", node.role, key)
            dl = self._try_download(page, lambda: cdp.click(node.backend), 6000)
            path_via = "direct"
            ev = []
            if not dl:
                got = self._popup_new(cdp, before, node.backend)
                if got:
                    ev.append(self.shot(page, "export-menu-" + key[:16]))
                    ax2, pop = got
                    scope = ax2.descendants(pop) if pop else ax2.live()
                    opts = [d for d in scope if d.role in ("menuitem", "button", "option", "link", "menuitemradio")
                            and d.backend and not d.disabled and d.backend != node.backend and safety.is_menu_format_safe(d.name)]
                    for o in opts[:1]:
                        path_via = "menu:" + control_label(o.name)
                        self.net.open_window("export", o.role, control_label(o.name))
                        dl = self._try_download(page, lambda: cdp.click(o.backend), 8000)
            texts = " | ".join(cdp.ax().texts())
            if dl:
                fpath = os.path.join(self.ev, "walker-export-" + re.sub(r"[^\w.-]", "_", dl.suggested_filename)[:60])
                dl.save_as(fpath)
                size = os.path.getsize(fpath)
                verdict, note, content = self._validate_export(fpath, visible=visible_ids)
                ev.append(self.rec.rel(fpath))
                row = {"control": key, "via": path_via, "file": self.rec.rel(fpath), "bytes": size, "verdict": verdict, "note": note,
                       "content": content}
                if content == "wrong":
                    status = "FAIL"
                    ev.append(self.shot(page, "export-wrong-content"))
                    self.finding("export", "medium", "Export via '%s' downloads content that does not match this lens" % key,
                                 ["Open %s at 1280x900" % self.url, "Click '%s'%s" % (key, (" then " + path_via[5:]) if path_via.startswith("menu:") else "")],
                                 "The exported file contains the rows the lens shows", note, ev, element=key, area="%s/export" % self.slug)
                elif verdict == "FAIL":
                    status = "FAIL"
                    ev.append(self.shot(page, "export-bad-file"))
                    self.finding("export", "medium", "Export via '%s' downloads an unusable file" % key,
                                 ["Open %s at 1280x900" % self.url, "Click '%s'%s" % (key, (" then " + path_via[5:]) if path_via.startswith("menu:") else "")],
                                 "A non-empty, parseable export file", note, ev, element=key, area="%s/export" % self.slug)
                elif verdict == "EMPTY":
                    self.judge("export_empty", "Export via '%s' produced an empty dataset (%s). Expected if %s has no data in this lens?" % (key, note, self.cfg["accounts"][self.acct]["username"] if self.acct else "this account"), ev)
            elif NOTHING_TO_EXPORT.search(texts):
                ev.append(self.shot(page, "export-nothing"))
                row = {"control": key, "via": path_via, "verdict": "NOTHING_TO_EXPORT"}
                self.judge("export_nothing", "'%s' says nothing to export. Is that right for this account's data in the lens?" % key, ev)
            else:
                ev.append(self.shot(page, "export-no-file"))
                row = {"control": key, "via": path_via, "verdict": "NO_FILE"}
                if re.search(r"(?i)copied|clipboard", texts):
                    self.judge("export_clipboard", "'%s' appears to copy to clipboard instead of downloading; acceptable?" % key, ev)
                else:
                    status = "FAIL"
                    self.finding("export", "medium", "'%s' produces no file" % key,
                                 ["Open %s at 1280x900" % self.url, "Click '%s'" % key, "Wait 8 s for a download or a format menu"],
                                 "A download starts (or a format menu leads to one)", "No download, no format menu, no message", ev,
                                 element=key, area="%s/export" % self.slug)
            rows.append(row)
        self.mark("export", status, attempts=rows)

    def _try_download(self, page, click, timeout):
        try:
            with page.expect_download(timeout=timeout) as info:
                if click() is False:
                    raise TimeoutError
            return info.value
        except Exception:
            return None

    def _validate_export(self, fpath, visible=None, fixture_label=None):
        """(verdict, note, content). Verdict is the file's own shape, as before.
        Content (WALK-03) compares the file against what the lens shows:
        "match" (a visible identifier — or the own-fixture label — is in the
        file), "wrong" (records exist, >=2 visible identifiers known, zero
        overlap: the wrong-scope/empty-set genus), "empty", "uncomparable"
        (format or page state gives nothing honest to compare)."""
        size = os.path.getsize(fpath)
        if size == 0:
            return "FAIL", "0-byte file", "empty"
        low = fpath.lower()
        file_strings = []
        try:
            if low.endswith(".json"):
                with open(fpath) as f:
                    d = json.load(f)
                def empty(x):
                    if isinstance(x, (list, dict)) and not x:
                        return True
                    if isinstance(x, dict):
                        vals = [v for v in x.values() if isinstance(v, (list, dict))]
                        return bool(vals) and all(empty(v) for v in vals)
                    return False
                if empty(d):
                    return "EMPTY", "JSON has no records", "empty"
                stack = [d]
                while stack and len(file_strings) < 500:
                    x = stack.pop()
                    if isinstance(x, str):
                        file_strings.append(x)
                    elif isinstance(x, dict):
                        stack.extend(x.values())
                    elif isinstance(x, list):
                        stack.extend(x)
                verdict, note = "PASS", "valid JSON, %d bytes" % size
            elif low.endswith(".csv"):
                with open(fpath, newline="") as f:
                    rows = list(csv.reader(io.StringIO(f.read())))
                if len(rows) <= 1:
                    return "EMPTY", "CSV has header only" if rows else "CSV empty", "empty"
                file_strings = [c for r in rows[1:] for c in r if c]
                verdict, note = "PASS", "CSV %d rows" % (len(rows) - 1)
            else:
                verdict, note = "PASS", "%d bytes" % size
        except Exception as e:
            return "FAIL", "file does not parse (%s)" % type(e).__name__, "uncomparable"
        return verdict, note, self._content_verdict(fpath, file_strings, visible, fixture_label)

    @staticmethod
    def _content_verdict(fpath, file_strings, visible, fixture_label):
        if fixture_label:
            try:
                raw = open(fpath, errors="ignore").read()
            except Exception:
                return "uncomparable"
            return "match" if fixture_label in raw else "wrong"
        if not file_strings or not visible:
            return "uncomparable"
        def norm(x):
            return re.sub(r"\s+", " ", str(x).lower()).strip()
        fstrings = [norm(x) for x in file_strings if norm(x)]
        for v in visible:
            nv = norm(v)
            if nv and any(nv in fs or (fs and fs in nv) for fs in fstrings):
                return "match"
        return "wrong" if len(visible) >= 2 else "uncomparable"

    def contrast(self, page, cdp):
        snap = cdp.snapshot()
        res = contrast_from_snapshot(snap, self.th, self.cfg["viewport_desktop"])
        # WALK-03: examples (with text) stay in the result — reverify attributes
        # failing pairs to the ticket's named element from them.
        self.result["contrast"] = dict(res)
        if not res["failing_groups"]:
            self.mark("contrast", "PASS", checked=res["checked"], unknown=res["unknown"], groups=[], examples=res["examples"])
            return
        ev = [self.shot(page, "contrast-page")]
        for ex in res["examples"][:3]:
            ev.append(self.shot(page, "contrast-%s-on-%s" % (ex["fg"][1:], ex["bg"][1:]), clip=self._pad(ex["box"], 4)))
        worst = res["failing_groups"][0]
        sev = "medium" if worst["ratio"] < self.th["contrast_medium_sev"] and not worst["large"] else "low"
        desc = "; ".join("%s on %s = %.2f:1 (%s, %d nodes)" % (g["fg"], g["bg"], g["ratio"], "large" if g["large"] else "normal", g["count"])
                         for g in res["failing_groups"][:5])
        self.finding("contrast", sev, "%d text colour pair(s) fail WCAG AA contrast" % len(res["failing_groups"]),
                     ["Open %s at 1280x900 (dark scheme)" % self.url, "Inspect text colour vs effective background in DevTools"],
                     "Normal text >= 4.5:1, large text >= 3:1", desc, ev, area="%s/theme tokens" % self.slug,
                     root_cause="RCA-contrast-theme-tokens" if any(g["ratio"] < 2.0 for g in res["failing_groups"]) else None)
        if res["unknown"]:
            self.result["contrast"]["note"] = "%d text nodes over images/gradients not judged" % res["unknown"]
        self.mark("contrast", "FAIL", groups=res["failing_groups"][:8], examples=res["examples"], checked=res["checked"])

    def visible_texts(self, page, cdp):
        return cdp.ax().texts()

    def contrast_view(self, page, cdp, tab_name=None):
        """WALK-03: contrast of ONE view — the current view, or the view behind a
        named tab (the caller fuzzy-resolves the name against the live tabs and
        passes the exact AX name). Returns contrast_from_snapshot's dict or None
        when the tab cannot be opened / no snapshot is available."""
        if tab_name:
            node = next((n for n in cdp.ax().by_role("tab") if n.name == tab_name and n.backend), None)
            if not node or not cdp.click(node.backend):
                return None
            try:
                page.wait_for_load_state("networkidle", timeout=4000)
            except Exception:
                pass
            time.sleep(0.6)
        snap = cdp.snapshot()
        if not snap:
            return None
        return contrast_from_snapshot(snap, self.th, self.cfg["viewport_desktop"])

    def mobile(self):
        ctx, page, cdp = self.open(mobile=True)
        self._nav_cid = "m390:page:-"
        try:
            t = self.nav(page, cdp)
            if self.signed_out(page) and self.acct:
                raise AccountMismatch("signed out at 390")
            lm = cdp.layout_metrics()
            ev_full = self.shot(page, "m390-full", full=True)
            ev_vp = self.shot(page, "m390-viewport")
            ax = cdp.ax()
            errs = self.error_texts(ax)
            row = {"timing": t, "layout": lm, "evidence": [ev_vp, ev_full]}
            status = "PASS"
            if errs or self.crashes:
                status = "FAIL"
                self.finding("reach", "high", "Lens fails to render at 390 px", ["Open %s at 390x844" % self.url],
                             "Lens renders at 390 px", "Error: %s%s" % ("; ".join(errs[:2]), " renderer crash" if self.crashes else ""),
                             [ev_vp], area="%s/mobile" % self.slug)
            dev_w = self.cfg["viewport_mobile"][0]
            # On a mobile-emulated page, content wider than the device makes Chrome widen the layout
            # viewport (zoom-out), so both content_w and viewport_w > 390 mean horizontal overflow.
            eff_w = max(lm["content_w"] or 0, lm["viewport_w"] or 0)
            overflow = eff_w - dev_w
            lm["content_w"], lm["viewport_w"] = eff_w, dev_w
            if overflow > 2:
                snap = cdp.snapshot()
                offenders = overflow_offenders(snap, dev_w)
                status = "FAIL"
                self.finding("overflow390", "medium" if overflow > 0.3 * 390 else "low",
                             "Page scrolls sideways at 390 px (content %dpx wide)" % lm["content_w"],
                             ["Open %s at 390x844" % self.url, "Scroll horizontally"],
                             "No horizontal page scroll at 390 px", "Content width %dpx vs viewport %dpx. Widest elements: %s"
                             % (lm["content_w"], lm["viewport_w"], ", ".join(offenders[:3]) or "n/a"),
                             [ev_vp, ev_full], area="%s/mobile layout" % self.slug)
            # off-screen tabs/buttons with no scroll container
            snap = cdp.snapshot()
            scrollers = scroll_container_backends(snap)
            off, small = [], 0
            for n in ax.by_role("tab", "button"):
                if not n.backend or n.disabled:
                    continue
                b = cdp.box(n.backend)
                if not b:
                    continue
                if (b[0] + b[2] > dev_w + 2 or b[0] < -2) and not (_ancestor_backends(snap, n.backend) & scrollers):
                    off.append(control_label(n.name))
                if b[2] < self.th["min_tap_px"] or b[3] < self.th["min_tap_px"]:
                    small += 1
            row.update(offscreen=off[:20], small_tap_targets=small)
            if off:
                status = "FAIL"
                self.finding("overflow390", "low", "%d control(s) off-screen at 390 px with no way to scroll to them" % len(off),
                             ["Open %s at 390x844" % self.url, "Look for tabs/buttons past the right edge"],
                             "All tabs and buttons reachable at 390 px", "Off-screen: %s" % ", ".join(off[:8]), [ev_vp, ev_full],
                             element=off[0], area="%s/mobile layout" % self.slug)
            # GB-1581 item 3b: FAB / bottom-nav overlap geometry at 390 — a
            # floating action button whose box intersects the fixed bottom
            # nav's box is covered (or covers a nav target) where they meet.
            dev_h = self.cfg["viewport_mobile"][1]
            nav_boxes = []
            for n in ax.by_role("navigation"):
                if not n.backend:
                    continue
                b = cdp.box(n.backend)
                if b and b[1] + b[3] >= dev_h - 4 and b[2] >= 0.6 * dev_w:
                    nav_boxes.append((n.backend, b))
            fab_hits = []
            if nav_boxes:
                nav_backends = {be for be, _b in nav_boxes}
                fabs = []
                for n in ax.by_role("button"):
                    if not n.backend or n.disabled:
                        continue
                    if _ancestor_backends(snap, n.backend) & nav_backends:
                        continue  # a nav's own button is not a FAB
                    b = cdp.box(n.backend)
                    if b and b[3] <= 96 and b[1] + b[3] >= dev_h - 160:
                        fabs.append((control_label(n.name), b))
                fab_hits = fab_nav_overlaps(fabs, [b for _be, b in nav_boxes])
            row["fab_overlap"] = fab_hits
            if fab_hits:
                status = "FAIL"
                self.finding("fab_overlap", "low",
                             "Floating action button(s) overlap the bottom navigation at 390 px: %s"
                             % ", ".join("'%s' (%d px²)" % (h["control"], h["overlap_px"]) for h in fab_hits[:4]),
                             ["Open %s at 390x844" % self.url, "Look at the bottom-right action button against the bottom nav"],
                             "The floating action button sits clear of the bottom navigation",
                             "Bounding boxes intersect the fixed bottom nav", [ev_vp, ev_full],
                             element=fab_hits[0]["control"], area="%s/mobile layout" % self.slug)
            self.mark("mobile_390", status, **row)
        finally:
            self._nav_cid = LOAD_CONTROL
            self._close(ctx)

    # ---------------------------------------------------------------- write mode
    def write_flow(self):
        """Create one labelled fixture, reload-verify, delete it (checking for a confirm), log leftovers."""
        from .util import now_et
        label = "%s-%s-%s-%s" % (self.cfg["fixture_prefix"], self.slug, now_et().strftime("%Y-%m-%d"), self.rec.rid[-6:])
        # ULW C28: the exercise opens its OWN context as the write account (its fixtures
        # belong to that account, and the record names it) — never the walk's evidence
        # account. With no write account configured this is self.acct, as before.
        self.result["write_account"] = self.write_acct
        ctx, page, cdp = self.open(account=self.write_acct)
        try:
            self.nav(page, cdp)
            ax = cdp.ax()
            opener = next((n for n in ax.by_role("button") if n.backend and not n.disabled and safety.CREATE_OPENER.search(n.name)), None)
            if not opener:
                self.mark("create_delete", "NA", reason="no New/Create/Add control on main view")
                return
            texts_before = set(ax.texts())
            assert_account(ctx, self.cfg, self.write_acct, "create (open form)", self.log)
            before = {p.backend for p in ax.popups()}
            self.net.open_window("write", "button", control_label(opener.name))
            cdp.click(opener.backend)
            got, _ = wait_until(lambda: self._popup_new(cdp, before, opener.backend), timeout=2.5)
            ax = cdp.ax()
            dlg = got[1] if got else None
            if not dlg:
                newt = [t for t in set(ax.texts()) - texts_before if re.search(r"(?i)untitled|^new\b", t)]
                ev = self.shot(page, "create-no-dialog")
                if newt:
                    self.rec.fixture("(instant-create via '%s')" % control_label(opener.name), self.slug, "possible_instant_create",
                                     "Clicking '%s' may have created a blank item with no form." % control_label(opener.name))
                    self.judge("instant_create", "Clicking '%s' showed no form; it may have created a blank item instantly. Verify and clean up." % control_label(opener.name), [ev])
                self.mark("create_delete", "NOT_RUN", reason="opener showed no dialog/form", evidence=ev)
                return
            dtexts = " ".join(d.name for d in ax.descendants(dlg))
            if safety.PUBLIC_HINT.search(dtexts):
                self.shot(page, "create-public-abort")
                page.keyboard.press("Escape")
                self.mark("create_delete", "NOT_RUN", reason="create form mentions public/feed visibility; not written")
                return
            field = next((d for d in ax.descendants(dlg) if d.role in ("textbox",) and d.backend and not d.disabled), None)
            if not field:
                page.keyboard.press("Escape")
                self.mark("create_delete", "NOT_RUN", reason="create form has no text field")
                return
            cdp.click(field.backend)
            page.keyboard.type(label, delay=35)
            time.sleep(0.4)
            ax = cdp.ax()
            still = next((p for p in ax.popups() if p.backend == dlg.backend), None)
            if not still:
                ev = self.shot(page, "hotkey-steal")
                self.finding("hotkey", "high", "Create form closes while typing (keystrokes taken as hotkeys)",
                             ["Open %s" % self.url, "Click '%s'" % control_label(opener.name), "Type a title into the first field"],
                             "Form stays open and receives the typed text", "Form closed during typing", [ev],
                             root_cause="RCA-form-hotkey-steal", area="%s/hotkeys vs form input" % self.slug)
                self.rec.fixture(label, self.slug, "unknown", "Form closed mid-typing; check nothing half-created.")
                self.mark("create_delete", "FAIL", reason="hotkey steal")
                return
            submit = next((d for d in ax.descendants(still) if d.role == "button" and d.backend and not d.disabled
                           and safety.CREATE_SUBMIT.search(d.name)), None)
            if not submit:
                page.keyboard.press("Escape")
                self.mark("create_delete", "NOT_RUN", reason="no Create/Save button in form")
                return
            # WALK-04b (G2): re-scan the dialog NOW — a form may reveal
            # public/feed wording only after interaction (post-typing).
            dtexts_late = " ".join(d.name for d in ax.descendants(still))
            if safety.PUBLIC_HINT.search(dtexts_late):
                self.shot(page, "create-public-abort-late")
                page.keyboard.press("Escape")
                self.mark("create_delete", "NOT_RUN", reason="create form mentions public/feed visibility (revealed after interaction); not written")
                return
            assert_account(ctx, self.cfg, self.write_acct, "create (submit)", self.log)
            self.rec.fixture(label, self.slug, "create_clicked", "via '%s' > '%s'" % (control_label(opener.name), control_label(submit.name)))
            wcid = self.net.open_window("write", "button", control_label(submit.name))
            t_submit = time.time()
            cdp.click(submit.backend)
            time.sleep(1.5)
            _why, _writes = self.net.quick_broken(t_submit - 0.05)
            ev_created = self.shot(page, "created")
            self.nav(page, cdp)
            ax = cdp.ax()
            present = [n for n in ax.live() if label in (n.name or "")]
            if not present:
                ev = self.shot(page, "created-not-after-reload")
                self.judge("create_unverified", "Submitted fixture '%s' but it isn't visible after reload. Validation error, other view, or persistence bug?" % label, [ev_created, ev])
                if self._persisting_writes(_writes) and not _why:
                    # upgrade 2: the create call answered 2xx but nothing persisted
                    self.net.annotate(wcid, fake_success=True, readback="lost after reload", evidence=[e for e in (ev_created, ev) if e])
                    self._premap_finding("fake_success", wcid, (self.net.meta.get(wcid) or {}).get("sid"),
                                         "Create via '%s' answered 2xx but '%s' is not there after reload" % (control_label(submit.name), label),
                                         [ev_created, ev])
                self.rec.fixture(label, self.slug, "unknown", "Not visible after reload; may exist in another view.")
                self.mark("create_delete", "PARTIAL", reason="not visible after reload")
                return
            self.rec.fixture(label, self.slug, "created")
            self._delete_fixture(ctx, page, cdp, label)
        finally:
            self._close(ctx)

    def _delete_fixture(self, ctx, page, cdp, label):
        ax = cdp.ax()
        lab = next(n for n in ax.live() if label in (n.name or ""))
        target = None
        # 1) row-scoped: nearest ancestor (<=4 up) containing exactly one delete control and exactly one fixture label
        for anc in ax.ancestors(lab)[:4]:
            desc = ax.descendants(anc)
            dels = [d for d in desc if d.role in ("button", "menuitem") and d.backend and safety.DELETE_CTRL.search(d.name)]
            labs = [d for d in desc if label in (d.name or "")]
            others = [d for d in desc if d.role in ("listitem", "row", "article") ]
            if len(dels) == 1 and len(labs) >= 1 and len(others) <= 1:
                target = dels[0]; break
            if len(dels) > 1:
                break
        # 2) open its detail and look for a single delete control in a dialog that shows the label
        if not target and lab.backend:
            before = {p.backend for p in ax.popups()}
            cdp.click(lab.backend); time.sleep(1.0)
            ax = cdp.ax()
            for p in ax.popups():
                desc = ax.descendants(p)
                if any(label in (d.name or "") for d in desc):
                    dels = [d for d in desc if d.role in ("button", "menuitem") and d.backend and safety.DELETE_CTRL.search(d.name)]
                    if len(dels) == 1:
                        target = dels[0]
        if not target:
            ev = self.shot(page, "delete-ambiguous")
            self.rec.fixture(label, self.slug, "leftover", "No unambiguous delete control tied to the fixture label.")
            self.judge("delete_ambiguous", "Could not find a delete control tied unambiguously to fixture '%s'; delete by hand." % label, [ev])
            self.mark("create_delete", "PARTIAL", reason="delete control ambiguous")
            return
        assert_account(ctx, self.cfg, self.write_acct, "delete", self.log)
        ev_before = self.shot(page, "delete-before")
        self.native_dialogs.clear()
        self.dialog_mode = "accept"
        before = {p.backend for p in cdp.ax().popups()}
        self.net.open_window("write", target.role, control_label(target.name))
        cdp.click(target.backend)  # exactly once
        time.sleep(1.0)
        confirm_seen = bool(self.native_dialogs)
        ax = cdp.ax()
        if not confirm_seen:
            for p in ax.popups():
                if p.backend in before:
                    continue
                txt = " ".join(d.name for d in ax.descendants(p))
                if safety.CONFIRM_TEXT.search(txt) or p.role == "alertdialog":
                    confirm_seen = True
                    btn = next((d for d in ax.descendants(p) if d.role == "button" and d.backend and safety.CONFIRM_DELETE.search(d.name)), None)
                    ev_confirm = self.shot(page, "delete-confirm")
                    if btn:
                        assert_account(ctx, self.cfg, self.write_acct, "delete (confirm)", self.log)
                        self.net.open_window("write", btn.role, control_label(btn.name))
                        cdp.click(btn.backend); time.sleep(1.0)
                    break
        self.dialog_mode = "dismiss"
        self.nav(page, cdp)
        gone = not any(label in (n.name or "") for n in cdp.ax().live())
        ev_after = self.shot(page, "delete-after")
        if gone:
            self.rec.fixture(label, self.slug, "deleted")
        else:
            self.rec.fixture(label, self.slug, "leftover", "Delete clicked once; still present after reload.")
        if not confirm_seen and gone:
            self.finding("delete_confirm", "medium", "Delete removes an item instantly with no confirmation",
                         ["Open %s" % self.url, "Create a labelled QA item", "Click its '%s' control once" % control_label(target.name)],
                         "A confirm step (or undo) before the item is removed", "Item removed immediately; no confirm or undo",
                         [ev_before, ev_after], element=control_label(target.name), area="%s/delete" % self.slug)
            self.mark("create_delete", "FAIL", confirm=False, deleted=True)
        elif not gone:
            self.finding("persistence", "medium", "Deleting an own item doesn't remove it",
                         ["Open %s" % self.url, "Create a labelled QA item", "Delete it (confirm if asked)", "Reload"],
                         "Item gone after reload", "Item still present after one delete attempt and reload", [ev_before, ev_after],
                         area="%s/delete" % self.slug)
            self.mark("create_delete", "FAIL", confirm=confirm_seen, deleted=False)
        else:
            self.mark("create_delete", "PASS", confirm=True, deleted=True)

    # ---------------------------------------------------------------- aggregate
    def console_network(self):
        five = [r for r in self.bad_responses if r[0] >= 500]
        four = [r for r in self.bad_responses if 400 <= r[0] < 500]
        self.result["console"] = {"console_errors": len(self.console_errors), "page_errors": len(self.page_errors),
                                  "http_5xx": sorted(set("%d %s" % r for r in five))[:10],
                                  "http_4xx": sorted(set("%d %s" % r for r in four))[:10]}
        # ULW C26 (Gate §10 #12): the same captured streams as first-class read-back
        # evidence rows — deduped by (type, route, message) with occurrences, failed
        # requests weighted high and filed first — beside the counts above.
        self.result["readback"] = _readback.build_readback(self.console_errors, self.page_errors, self.bad_responses)
        ev = self.result.get("initial_evidence")
        if self.page_errors and ev:
            self.finding("pageerror", "medium", "%d uncaught JavaScript error(s) while walking the lens" % len(self.page_errors),
                         ["Open %s with DevTools console open" % self.url, "Click through the tabs"],
                         "No uncaught exceptions", "First: %s" % scrub(self.page_errors[0], 140), [ev], area="%s/runtime" % self.slug)
        if five and ev:
            self.finding("http", "medium", "API returns 5xx while loading the lens",
                         ["Open %s with DevTools Network open" % self.url],
                         "No server errors on lens load", "; ".join(sorted(set("%d %s" % r for r in five))[:4]), [ev], area="%s/api" % self.slug)
        self.mark("console_network", "FAIL" if (self.page_errors or five) else "PASS", **self.result["console"])

    @staticmethod
    def _pad(b, p=4):
        x, y, w, h = b
        return {"x": max(0, x - p), "y": max(0, y - p), "width": max(1, w + 2 * p), "height": max(1, h + 2 * p)}


# -------------------------------------------------------------------- snapshot analysis
def _snap_doc(snap):
    d = snap["documents"][0]
    return d, snap["strings"]


def contrast_from_snapshot(snap, th, viewport):
    d, S = _snap_doc(snap)
    nodes, lay = d["nodes"], d["layout"]
    parent = nodes["parentIndex"]; ntype = nodes["nodeType"]; nval = nodes.get("nodeValue", [])
    lay_of = {ni: li for li, ni in enumerate(lay["nodeIndex"])}
    # style index order matches computedStyles request
    COLOR, BG, BGIMG, FS, FW, OP, VIS, DISP = range(8)

    def style(ni):
        li = lay_of.get(ni)
        if li is None:
            return None
        st = lay["styles"][li]
        return [S[i] if i >= 0 else "" for i in st] if st else None

    groups, checked, unknown, examples = {}, 0, 0, {}
    for li, ni in enumerate(lay["nodeIndex"]):
        if ntype[ni] != 3:
            continue
        txt = S[nval[ni]] if nval and nval[ni] >= 0 else ""
        if len(txt.strip()) < 2:
            continue
        x, y, w, h = lay["bounds"][li]
        if w < 1 or h < 1 or x > viewport[0] or x + w < 0:
            continue
        pe = parent[ni]
        if _disabled_ancestor(nodes, S, pe):
            continue  # WCAG 1.4.3 exempts inactive controls
        st = style(ni) or style(pe)
        if not st or st[VIS] in ("hidden", "collapse") or st[DISP] == "none":
            continue
        fg = colors.parse(st[COLOR])
        if not fg or fg[3] == 0:
            continue
        # walk ancestors for background
        layers, cur, img = [], pe, False
        hidden = False
        while cur is not None and cur >= 0:
            s2 = style(cur)
            if s2:
                if s2[OP] and s2[OP] not in ("", "1") and float(s2[OP] or 1) < 0.05:
                    hidden = True; break
                if s2[BGIMG] and s2[BGIMG] != "none":
                    img = True; break
                bg = colors.parse(s2[BG])
                if bg and bg[3] > 0:
                    layers.append(bg)
                    if bg[3] >= 0.999:
                        break
            cur = parent[cur]
        if hidden:
            continue
        if img:
            unknown += 1
            continue
        base = (255, 255, 255, 1.0)
        for lyr in reversed(layers):
            base = colors.blend(lyr, base)
        fgc = colors.blend(fg, base) if fg[3] < 1 else fg
        r = colors.ratio(fgc, base)
        try:
            fs = float(st[FS].replace("px", "")) if st[FS] else 16
        except ValueError:
            fs = 16
        fwv = st[FW]
        bold = (fwv == "bold") or (fwv.isdigit() and int(fwv) >= 700)
        large = fs >= 24 or (fs >= 18.66 and bold)
        need = th["contrast_large"] if large else th["contrast_normal"]
        checked += 1
        if r + 1e-6 < need:
            k = (colors.hexify(fgc), colors.hexify(base), large)
            g = groups.setdefault(k, {"fg": k[0], "bg": k[1], "large": large, "ratio": round(r, 2), "count": 0})
            g["count"] += 1
            if k not in examples and y + h <= viewport[1] and y >= 0:
                examples[k] = {"fg": k[0], "bg": k[1], "box": (x, y, w, h), "text": txt.strip()[:48]}
    fail = sorted(groups.values(), key=lambda g: (g["ratio"], -g["count"]))
    ex = [dict(examples[(g["fg"], g["bg"], g["large"])], fg=g["fg"], bg=g["bg"]) for g in fail if (g["fg"], g["bg"], g["large"]) in examples]
    return {"checked": checked, "unknown": unknown, "failing_groups": fail, "examples": ex}


def _disabled_ancestor(nodes, S, ni, depth=4):
    parent = nodes["parentIndex"]
    while ni is not None and ni >= 0 and depth > 0:
        at = _attrs(nodes, S, ni)
        if "disabled" in at or at.get("aria-disabled") == "true":
            return True
        ni = parent[ni]; depth -= 1
    return False


def _attrs(nodes, S, ni):
    a = (nodes.get("attributes") or [[]])[ni] if nodes.get("attributes") else []
    return {S[a[i]]: S[a[i + 1]] for i in range(0, len(a) - 1, 2)}


SHELL_LANDMARKS = ("navigation", "banner", "complementary", "contentinfo", "search")


def region_scope(ax):
    """GB-1580 item 4: the lens MAIN-CONTENT region. Returns (scope, inside_ids):
    scope 'main' with the id set of every <main> landmark plus its descendants,
    or scope 'page' with inside None (no main landmark on the page — the whole
    page is in scope and the record says so; nothing is silently excluded)."""
    mains = ax.by_role("main")
    if not mains:
        return "page", None
    inside = set()
    for m in mains:
        inside.add(m.id)
        inside.update(d.id for d in ax.descendants(m))
    return "main", inside


def is_shell_chrome(ax, node, mains=None):
    """True when the node rides in an app-shell landmark (sidebar navigation /
    complementary, top banner, global search, footer) that is neither inside
    the lens <main> nor wrapping it — a landmark inside main is the lens's own
    chrome and stays in scope."""
    if mains is None:
        mains = ax.by_role("main")
    for a in [node] + ax.ancestors(node):
        if a.role in SHELL_LANDMARKS:
            if any(a.id == m.id or ax.is_inside(a, m) or ax.is_inside(m, a) for m in mains):
                return False
            return True
    return False


def in_main_region(ax, node, scope):
    """scope is a region_scope() pair. In scope = inside a main landmark (when
    the page has one) and not shell chrome riding outside/above it."""
    name, inside = scope
    if inside is None:
        return True
    if node.id not in inside:
        return False
    return not is_shell_chrome(ax, node)


def rects_overlap(a, b):
    """Positive-area intersection of two (x, y, w, h) boxes (GB-1581 3b)."""
    x = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
    y = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    return x > 0 and y > 0


def fab_nav_overlaps(fabs, navs):
    """[{'control': label, 'overlap_px': area}] for each (label, box) FAB
    whose box intersects any bottom-nav box (GB-1581 item 3b)."""
    out = []
    for label, b in fabs:
        for nb in navs:
            if rects_overlap(b, nb):
                x = min(b[0] + b[2], nb[0] + nb[2]) - max(b[0], nb[0])
                y = min(b[1] + b[3], nb[1] + nb[3]) - max(b[1], nb[1])
                out.append({"control": label, "overlap_px": int(x * y)})
                break
    return out


def overflow_offenders(snap, vw):
    d, S = _snap_doc(snap)
    nodes, lay = d["nodes"], d["layout"]
    parent, ntype, nname = nodes["parentIndex"], nodes["nodeType"], nodes["nodeName"]
    off = set()
    for li, ni in enumerate(lay["nodeIndex"]):
        if ntype[ni] != 1:
            continue
        x, y, w, h = lay["bounds"][li]
        if x + w > vw + 2 and w > 0 and h > 0:
            off.add(ni)
    tops = [ni for ni in off if parent[ni] not in off]
    out = []
    for ni in tops[:6]:
        at = _attrs(nodes, S, ni)
        cls = (at.get("class") or "").split()
        out.append("%s%s" % (S[nname[ni]].lower(), ("." + ".".join(cls[:2])) if cls else ""))
    return out


def scroll_container_backends(snap):
    d, S = _snap_doc(snap)
    nodes, lay = d["nodes"], d["layout"]
    back = nodes["backendNodeId"]
    out = set()
    for li, ni in enumerate(lay["nodeIndex"]):
        st = lay["styles"][li]
        if st and len(st) > 9 and st[9] >= 0 and S[st[9]] in ("auto", "scroll"):
            out.add(back[ni])
    return out


def _ancestor_backends(snap, backend):
    d, S = _snap_doc(snap)
    nodes = d["nodes"]
    back, parent = nodes["backendNodeId"], nodes["parentIndex"]
    try:
        ni = back.index(backend)
    except ValueError:
        return set()
    out = set()
    while ni is not None and ni >= 0:
        out.add(back[ni])
        ni = parent[ni]
    return out
