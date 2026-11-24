"""WALK-04a: form bad-input recipes (GB-1544).

A validation ticket ("accepts blank form", "negative amounts save with no error")
is decided by exercising the lens's own create form with bad values and asserting
BOTH halves of the expected behaviour: an inline error or a disabled submit, AND
no create on the network. A bad submit that still creates is STILL_FAILING (the
ticket reopens); a form that silently swallows a bad submit with no error shown
is STILL_FAILING too (the error-surfacing half of the ticket is unmet). Anything
the recipe cannot cleanly decide -- no form, no applicable field, signed out,
wrong account, a 5xx in the submit window, ambiguous network evidence -- is
NEEDS_HUMAN, never a guessed verdict.

Discipline (standing walker safe-mode): runs only under --allow-write on
non-admin, non-write-skip lenses; the create form's public/feed/global wording
aborts before any typing (safety.PUBLIC_HINT); the account guard runs before
every submit and every cleanup delete; typing is CDP click + keyboard only (no
page JavaScript, none of the Playwright conveniences the selftest grep bans). A
record a bad submit created is deleted by its exact bad value; a creation that
cannot be tied to a deletable label (a blank-title record) is logged as a
leftover for a human -- never deleted by position.
"""
import re, time
from . import safety
from .cdp import wait_until
from .auth import assert_account, AccountMismatch, write_account_key
from .util import control_label, scrub

FIXED, STILL, HUMAN = "FIXED", "STILL_FAILING", "NEEDS_HUMAN"

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
# Mutating endpoints that never create a lens record (session, telemetry, presence).
NON_CREATE_PATH = re.compile(r"(?i)/api/(auth|telemetry|presence|heartbeat|analytics|metrics|logs?)\b")
ERROR_HINT = re.compile(r"(?i)(required|invalid|must be|must not|please enter|enter a valid|too (short|long|large|small)|"
                        r"at least|at most|between|not a valid|cannot be|can't be|out of range|greater than|less than|"
                        r"in the (past|future)|end (date )?(must|should|is)|start (date )?(must|should|is))")
NUMBER_NAME = re.compile(r"(?i)(amount|price|cost|count|qty|quantity|number|age|year|total|weight|score|percent|"
                         r"rate|fee|budget|salary|hours?|minutes?|days?|limit|size|length|depth|width|height)")
DATE_NAME = re.compile(r"(?i)(date|start|end|begin|from|until|due|deadline|when)")
START_NAME = re.compile(r"(?i)(start|begin|from|open)")
END_NAME = re.compile(r"(?i)(end|until|due|deadline|close|finish)")


def _wait_net(page, rec_net, mark, timeout=2.5):
    """Wait for a mutating response in the recorder window. The poll must go
    through page.wait_for_timeout: a bare time.sleep starves Playwright's
    event dispatch and page.on('response') callbacks never land."""
    waited = 0.0
    while waited < timeout:
        if any(e[1] in MUTATING for e in rec_net.window(mark)):
            return
        page.wait_for_timeout(100)
        waited += 0.1


class NetRecorder:
    """Same-origin request/response log for one page, sliced by marks.

    Uses the page's driver-level response events -- the same surface
    LensWalk.attach already listens on. No page JavaScript is involved."""

    def __init__(self, page, base_url):
        self.events = []  # (t, method, path, status)
        self._host = base_url.split("//")[-1].split("/")[0]

        def on_resp(r):
            try:
                if self._host not in r.url:
                    return
                path = "/" + r.url.split("//", 1)[1].split("/", 1)[-1].split("?")[0]
                self.events.append((time.time(), r.request.method, path[:90], r.status))
            except Exception:
                pass

        page.on("response", on_resp)

    def mark(self):
        return len(self.events)

    def window(self, mark):
        return self.events[mark:]

    @staticmethod
    def creates(win):
        return [e for e in win if e[1] in MUTATING and 200 <= e[3] < 300 and not NON_CREATE_PATH.search(e[2])]

    @staticmethod
    def server_errors(win):
        return [e for e in win if e[3] >= 500]


def field_kind(node):
    """Classify an AX field node as text / number / date / other from role + name."""
    name = node.name or ""
    if node.role == "spinbutton":
        return "other" if re.search(r"(?i)month|day|year", name) else "number"
    if node.role in ("combobox", "listbox"):
        return "other"
    if node.role != "textbox":
        return "other"
    if DATE_NAME.search(name):
        return "date"
    if NUMBER_NAME.search(name):
        return "number"
    return "text"


def ticket_values(text):
    """Bad values the ticket itself names: quoted strings and explicit numerals.
    Quoted CONTROL labels from repro steps ('New item', 'Create', 'Delete')
    name buttons, not field values -- they are filtered out."""
    quoted = re.findall(r"'([^']{1,30})'|\"([^\"]{1,30})\"", text)
    vals = [a or b for a, b in quoted]
    vals = [v for v in vals if not (safety.CREATE_OPENER.search(v) or safety.CREATE_SUBMIT.search(v)
                                    or safety.DELETE_BTN.search(v))]
    nums = re.findall(r"(?<![\w.])-?\d{2,}(?:\.\d+)?", text)
    return vals, nums


def battery_for(kind, tvals, tnums):
    """The canonical bad-input battery per field kind, plus ticket-named values."""
    if kind == "text":
        cases = [("blank", ""), ("whitespace", "   "), ("bad-chars", "{bad")]
        for v in tvals:
            if v and v not in [c[1] for c in cases] and len(v) <= 30:
                cases.append(("ticket-value", v))
        return cases
    if kind == "number":
        cases = [("blank", ""), ("negative", "-1"), ("huge", "99999"), ("bad-chars", "{bad")]
        for v in tnums:
            if v not in [c[1] for c in cases]:
                cases.append(("ticket-value", v))
        return cases
    if kind == "date":
        return [("blank", "")]
    return []


def battery_with_provenance(kind, tvals, tnums):
    """C25: battery_for() cases carrying their provenance tag, as
    (case_name, value, case_source). battery_for's own shape is unchanged
    (its runner unpacks pairs); this is the tagged door for reports and
    counts -- ticket-value cases are OBSERVED, the enumerated patterns
    EXTRAPOLATED (provenance.classify_battery_case)."""
    from . import provenance as _P
    return [(name, value, _P.classify_battery_case(name)) for name, value in battery_for(kind, tvals, tnums)]


def valid_value(kind, label):
    return {"text": label, "number": "1", "date": "2026-01-15"}.get(kind, label)


def scope_texts(ax, container):
    scope = ax.descendants(container) if container else ax.live()
    return {d.name for d in scope if d.role in ("StaticText", "text", "status") and d.name}


class FormFuzz:
    """One lens, one ticket: open the create form and run the battery."""

    def __init__(self, rv, t):
        from .checks import LensWalk
        self.rv, self.t = rv, t
        self.lens = t["lens"]
        # ULW C28: form fuzz is write work — it runs as the dedicated write account
        # when one is configured, never as the evidence account t1.
        self.lw = LensWalk(rv.b, rv.cfg, rv.rec, rv.inv[self.lens], write_account_key(rv.cfg) or "t1", rv.log,
                           allow_write=True, inv_entry=rv.inv[self.lens])
        self.label = "%s-%s-%s" % (rv.cfg["fixture_prefix"], self.lens, rv.rec.rid[-6:])
        self.evidence = []
        self.case_rows = []      # (field label, case, outcome, detail)
        self.created_cases = []  # (field label, case, bad value) that created

    # ------------------------------------------------------------ form access
    def _open_form(self, page, cdp):
        """Return (container_or_None, fields, submit). Container None = inline form.
        Raises PermissionError when the form carries public/feed/global wording."""
        ax = cdp.ax()
        opener = next((n for n in ax.by_role("button") if n.backend and not n.disabled
                       and safety.CREATE_OPENER.search(n.name)), None)
        container = None
        if opener:
            before = {p.backend for p in ax.popups()}
            cdp.click(opener.backend)
            got, _ = wait_until(lambda: self.lw._popup_new(cdp, before, opener.backend), timeout=2.5)
            ax = cdp.ax()
            if got:
                container = got[1]
        scope = ax.descendants(container) if container else ax.live()
        if container:
            texts = " ".join(d.name for d in scope)
            if safety.PUBLIC_HINT.search(texts):
                raise PermissionError("create form mentions public/feed/global visibility")
        fields = [d for d in scope if d.role in ("textbox", "spinbutton", "combobox")
                  and d.backend and not d.disabled]
        submit = next((d for d in scope if d.role == "button" and d.backend
                       and safety.CREATE_SUBMIT.search(d.name)), None)
        return container, fields, submit

    def _close_form(self, page):
        page.keyboard.press("Escape")
        time.sleep(0.4)

    def _type_into(self, page, cdp, node, value):
        cdp.click(node.backend)
        page.keyboard.press("ControlOrMeta+A")
        page.keyboard.press("Backspace")
        if value:
            page.keyboard.type(value, delay=25)
        time.sleep(0.35)

    def _submit_now(self, cdp, container):
        ax = cdp.ax()
        scope = ax.descendants(container) if container else ax.live()
        return next((d for d in scope if d.role == "button" and d.backend
                     and safety.CREATE_SUBMIT.search(d.name)), None), ax

    def _error_evidence(self, ax, container, open_texts):
        """Refusal evidence in the form now: an alert node or an invalid field
        (absolute), or error-hint text that was not there when the form opened."""
        scope = ax.descendants(container) if container else ax.live()
        alerts = [d for d in scope if d.role == "alert" and (d.name or "").strip()]
        invalid = [d for d in scope if d.props.get("invalid") in (True, "true")]
        texts = {d.name for d in scope if d.role in ("StaticText", "text", "status") and d.name}
        hints = [x for x in texts - open_texts if ERROR_HINT.search(x) and len(x) < 160]
        return alerts, invalid, hints

    def _verdict_after_submit(self, page, cdp, rec_net, container, open_texts, mark, what):
        win = rec_net.window(mark)
        if rec_net.server_errors(win):
            raise RuntimeError("5xx in submit window: %s" % (rec_net.server_errors(win),))
        creates = rec_net.creates(win)
        if creates:
            return ("created", "2xx %s %s after %s" % (creates[0][1], creates[0][2], what))
        ax = cdp.ax()
        alerts, invalid, hints = self._error_evidence(ax, container, open_texts)
        if alerts or invalid or hints:
            why = alerts[0].name if alerts else (hints[0] if hints else "field marked invalid")
            return ("refused", "inline error shown (%s)" % scrub(why, 90))
        still_open = True
        if container:
            still_open = any(p.backend == container.backend for p in ax.popups())
        return ("silent", "no create and no error surfaced after %s (form %s)"
                % (what, "still open" if still_open else "closed"))

    # ------------------------------------------------------------ cases
    def _run_case(self, page, cdp, rec_net, container, fields, target_idx, case_name, bad, open_texts):
        target = fields[target_idx]
        for i, f in enumerate(fields):
            if i != target_idx:
                self._type_into(page, cdp, f, valid_value(field_kind(f), self.label))
        self._type_into(page, cdp, target, bad)
        submit_now, _ax = self._submit_now(cdp, container)
        if submit_now is None or submit_now.disabled:
            return ("refused", "submit %s after bad input" % ("disabled" if submit_now else "absent"))
        assert_account(self._ctx, self.rv.cfg, self.lw.acct, "validation submit (%s)" % case_name, self.rv.log)
        mark = rec_net.mark()
        cdp.click(submit_now.backend)
        _wait_net(page, rec_net, mark)
        page.wait_for_timeout(500)
        return self._verdict_after_submit(page, cdp, rec_net, container, open_texts, mark,
                                          "bad submit (%s)" % case_name)

    def _run_date_pair(self, page, cdp, rec_net, container, fields, open_texts):
        dates = [f for f in fields if field_kind(f) == "date"]
        st = next((d for d in dates if START_NAME.search(d.name or "")), dates[0])
        en = next((d for d in dates if END_NAME.search(d.name or "") and d.backend != st.backend), None)
        if not en:
            return None
        for f in fields:
            if f.backend not in (st.backend, en.backend):
                self._type_into(page, cdp, f, valid_value(field_kind(f), self.label))
        self._type_into(page, cdp, st, "2026-06-01")
        self._type_into(page, cdp, en, "2026-01-01")
        submit_now, _ax = self._submit_now(cdp, container)
        if submit_now is None or submit_now.disabled:
            return ("refused", "submit disabled with end before start")
        assert_account(self._ctx, self.rv.cfg, self.lw.acct, "validation submit (reversed-dates)", self.rv.log)
        mark = rec_net.mark()
        cdp.click(submit_now.backend)
        _wait_net(page, rec_net, mark)
        page.wait_for_timeout(500)
        return self._verdict_after_submit(page, cdp, rec_net, container, open_texts, mark,
                                          "reversed-dates submit")

    # ------------------------------------------------------------ cleanup
    def _key_present(self, cdp, key):
        return any(key in (n.name or "") for n in cdp.ax().live())

    def _delete_until_gone(self, page, cdp, key, cap=6):
        """_delete_fixture removes ONE row per call and its own gone-check is a
        bare substring test, so a key carried by several records (or appearing
        inside other rows' text) reads 'leftover' after a successful delete.
        Repeat while the key's row count keeps falling; report the true end
        state. Returns True when no live node carries the key any more."""
        for _ in range(cap):
            if not self._key_present(cdp, key):
                return True
            before = sum(1 for n in cdp.ax().live() if key in (n.name or ""))
            try:
                self.lw._delete_fixture(self._ctx, page, cdp, key)
            except Exception:
                break
            after = sum(1 for n in cdp.ax().live() if key in (n.name or ""))
            if after >= before:
                break
        return not self._key_present(cdp, key)

    def _cleanup_created(self, page, cdp):
        """Delete what the bad submits created, by the most specific key the
        record carries: its bad value when it has one, else the walker's own
        label (the valid-filled title). A blank-titled record has neither --
        it is logged as a leftover, never deleted by position."""
        by_value, by_label, blank_title = [], 0, False
        for field, _case, bad in self.created_cases:
            if bad and bad.strip() and bad != self.label:
                if bad not in by_value:
                    by_value.append(bad)
            elif bad == self.label or not re.search(r"(?i)title|name", field):
                by_label += 1
            else:
                blank_title = True
        for v in by_value:
            self.rv.rec.fixture(v, self.lens, "created_by_bad_submit",
                                "WALK-04a: a bad-input submit created this record; deleting by its value.")
            if self._delete_until_gone(page, cdp, v):
                self.rv.rec.fixture(v, self.lens, "deleted",
                                    "every record carrying the bad value was deleted by its row control")
            else:
                self.rv.rec.fixture(v, self.lens, "leftover",
                                    "cleanup could not remove every record carrying this value")
        if by_label:
            if self._delete_until_gone(page, cdp, self.label):
                self.rv.rec.fixture(self.label, self.lens, "deleted",
                                    "label-titled records from bad submits were deleted by their row controls")
            else:
                self.rv.rec.fixture(self.label, self.lens, "leftover",
                                    "cleanup could not remove every label-titled record from bad submits")
        if blank_title:
            self.rv.rec.fixture("(blank-title create on %s)" % self.lens, self.lens, "leftover",
                                "A bad submit created a record with a blank title; it cannot be tied to "
                                "a delete control by label -- delete by hand.")

    # ------------------------------------------------------------ main
    def run(self):
        from .reverify import ticket_text
        rv, t = self.rv, self.t
        if not self.lw.allow_write:
            return {"verdict": HUMAN, "method": "form bad-input recipe", "category": "validation",
                    "notes": "lens is admin or write-skip; the bad-input recipe never writes there"}
        ctx, page, cdp = self.lw.open()
        self._ctx = ctx
        try:
            assert_account(ctx, rv.cfg, self.lw.acct, "validation recipe", rv.log)
            self.lw.nav(page, cdp)
            if self.lw.signed_out(page):
                return {"verdict": HUMAN, "method": "form bad-input recipe", "category": "validation",
                        "notes": "signed out on the lens; recipe not run"}
            rec_net = NetRecorder(page, rv.cfg["base_url"])
            tvals, tnums = ticket_values(ticket_text(t))
            try:
                container, fields, submit = self._open_form(page, cdp)
            except PermissionError as e:
                ev = self.lw.shot(page, "formfuzz-public-abort")
                return {"verdict": HUMAN, "method": "form bad-input recipe", "category": "validation",
                        "evidence": [ev], "notes": "%s; aborted before typing, per safe-mode" % e}
            if not fields or not submit:
                ev = self.lw.shot(page, "formfuzz-no-form")
                return {"verdict": HUMAN, "method": "form bad-input recipe", "category": "validation",
                        "evidence": [ev],
                        "notes": "no usable create form on the main view (fields=%d, submit=%s); recipe cannot run"
                                 % (len(fields), bool(submit))}
            self.evidence.append(self.lw.shot(page, "formfuzz-form-open"))
            open_texts = scope_texts(cdp.ax(), container)
            plan = []  # (field index, field label, case, bad value, field kind)
            for i, f in enumerate(fields):
                kind = field_kind(f)
                for case_name, bad in battery_for(kind, tvals, tnums):
                    plan.append((i, control_label(f.name), case_name, bad, kind))
            has_date_pair = len([f for f in fields if field_kind(f) == "date"]) >= 2
            if not plan and not has_date_pair:
                return {"verdict": HUMAN, "method": "form bad-input recipe", "category": "validation",
                        "evidence": self.evidence,
                        "notes": "form found but no bad-input case applies to its field types (%s)"
                                 % [field_kind(f) for f in fields]}
            ambiguous = []
            try:
                for idx, flabel, case_name, bad, kind in plan:
                    if idx >= len(fields):
                        ambiguous.append("field %s vanished on reopen" % flabel)
                        break
                    outcome, detail = self._run_case(page, cdp, rec_net, container, fields, idx,
                                                     case_name, bad, open_texts)
                    if outcome == "created" and kind == "text" and case_name == "bad-chars" and bad not in tvals:
                        # a free-text field may legitimately accept punctuation; only
                        # emptiness/range/date violations fail a text field
                        outcome, detail = "accepted", "free-text field accepted punctuation input; not a validation failure"
                    self.case_rows.append((flabel, case_name, outcome, detail))
                    rv.log("  formfuzz %s / %s -> %s (%s)" % (flabel, case_name, outcome, detail))
                    if outcome == "created":
                        self.created_cases.append((flabel, case_name, bad))
                    self._close_form(page)
                    try:
                        container, fields, submit = self._open_form(page, cdp)
                        if not fields or not submit:
                            ambiguous.append("form incomplete on reopen after case %s" % case_name)
                            break
                        open_texts = scope_texts(cdp.ax(), container)
                    except Exception as e:
                        ambiguous.append("form did not reopen after case %s (%s)" % (case_name, type(e).__name__))
                        break
                if has_date_pair and not ambiguous:
                    res = self._run_date_pair(page, cdp, rec_net, container, fields, open_texts)
                    if res:
                        outcome, detail = res
                        self.case_rows.append(("date pair", "reversed-dates", outcome, detail))
                        rv.log("  formfuzz date pair / reversed-dates -> %s (%s)" % (outcome, detail))
                        if outcome == "created":
                            self.created_cases.append(("date pair", "reversed-dates", self.label))
                        self._close_form(page)
            except AccountMismatch as e:
                return {"verdict": HUMAN, "method": "form bad-input recipe", "category": "validation",
                        "evidence": self.evidence, "notes": "account guard failed mid-recipe: %s" % scrub(str(e), 160)}
            except RuntimeError as e:
                return {"verdict": HUMAN, "method": "form bad-input recipe", "category": "validation",
                        "evidence": self.evidence, "notes": "failed cleanly: %s" % scrub(str(e), 160)}
            self.evidence.append(self.lw.shot(page, "formfuzz-after"))
            # cleanup runs on a fresh list view: rows behind an open modal are
            # inert in the AX tree and _delete_fixture cannot see them there
            try:
                page.keyboard.press("Escape")
            except Exception:
                pass
            self.lw.nav(page, cdp)
            if self.created_cases:
                self._cleanup_created(page, cdp)
            created = [r for r in self.case_rows if r[2] == "created"]
            silent = [r for r in self.case_rows if r[2] == "silent"]
            refused = [r for r in self.case_rows if r[2] == "refused"]
            summary = "; ".join("%s/%s: %s" % (r[0], r[1], r[2]) for r in self.case_rows)[:280]
            if created:
                return {"verdict": STILL, "method": "form bad-input recipe", "category": "validation",
                        "evidence": self.evidence,
                        "notes": "bad input still creates: %s. Cases: %s" % (created[0][3], summary)}
            if silent:
                return {"verdict": STILL, "method": "form bad-input recipe", "category": "validation",
                        "evidence": self.evidence,
                        "notes": "no record created, but no inline error or disabled submit either: %s. Cases: %s"
                                 % (silent[0][3], summary)}
            if ambiguous or not refused:
                return {"verdict": HUMAN, "method": "form bad-input recipe", "category": "validation",
                        "evidence": self.evidence,
                        "notes": "battery incomplete (%s). Cases: %s" % ("; ".join(ambiguous) or "no case ran", summary)}
            return {"verdict": FIXED, "method": "form bad-input recipe", "category": "validation",
                    "evidence": self.evidence,
                    "notes": "all %d bad-input case(s) refused with an error or a disabled submit and no create. Cases: %s"
                             % (len(refused), summary)}
        except AccountMismatch as e:
            # signed out / wrong account at the door: a clean NEEDS_HUMAN, never a run abort
            return {"verdict": HUMAN, "method": "form bad-input recipe", "category": "validation",
                    "evidence": self.evidence, "notes": "account guard: %s" % scrub(str(e), 160)}
        finally:
            self.lw._close(ctx)


def run_validation_recipe(rv, t):
    return FormFuzz(rv, t).run()
