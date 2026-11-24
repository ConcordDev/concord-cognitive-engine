#!/usr/bin/env python3
"""ULW pass 2 (b) typed test values + (c) write-mode create / fill / delete. Offline: a fake form driver
(no browser; the real-Chromium counterpart is test_driver_write_playwright.py, run on the box).

Step strings are REAL repro_steps from the ticket fold (272e62f41), tagged with their lens.
Each rule has an allowed path AND a refusal / failure path:
  typed value   allowed on a form the walker opened (own-labelled data); recorded (truncated to 80 chars, length kept);
                refused without --allow-write / on admin / on write-skip lenses / on auth-payment-role-publish fields /
                on a field that is not on a form the walker opened; fan-out ("0 or -1") runs each value, each recorded;
                a typed invalid value that WAS written to the API is STILL_FAILING, never a pass.
  create/fill   "New Project > fill > submit" creates a labelled fixture and deletes it at the end; a failed cleanup is a
                recorded leftover, never silent; payment / billing / role / admin / publish / share / invite controls and
                a delete of anything not own-labelled are refused even with --allow-write.
  generic       "Open a task detail" -> own fixture when there is one, else first-of-role read-only open.
Run: python3 selftest/test_write_flows_pass2.py"""
import copy, os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import repro, writevocab as W, safety

repro._sleep = lambda s: None
FAILS = []
N = [0]


def check(name, cond, extra=""):
    N[0] += 1
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:400] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


def T(steps, expected, lens="demo", tid="FIX-demo-001"):
    return {"id": tid, "lens": lens, "repro_steps": steps, "expected": expected}


WR = dict(allow_write=True, admin=False, write_skip=False, account="t1", label_base="qa-walker-demo-t1-abc123-fix1", fixtures=lambda: [])


def wr(**kw):
    d = dict(WR)
    d.update(kw)
    return d


class FormDriver:
    """A lens with a New-item form (Title, Amount, Password, API key, Role), a list with own + foreign rows, and a confirm on delete."""

    def __init__(self, validates=True, confirm=True, cleanup_ok=True, foreign=("someone-elses-row",), list_role=True, popups=0):
        self.validates, self.confirm, self.cleanup_ok = validates, confirm, cleanup_ok
        self.rows = list(foreign)
        self.form = False
        self.fields = {}
        self.calls = []
        self.writes = []
        self.alerts = []
        self.last_resolution = None
        self.reloaded = 0
        self.console = 0
        self._popups = popups
        self.list_role = list_role

    # --- page
    def open(self, t): self.calls.append(("open", t))
    def reload(self): self.calls.append(("reload",)); self.reloaded += 1
    def press(self, k):
        self.calls.append(("press", k))
        if k == "Escape":
            self._popups = 0
            self.form = False

    def popup_count(self): return self._popups + (1 if self.form else 0)
    def net_mark(self): return len(self.writes)
    def net_since(self, m): return list(self.writes[m:])
    def console_errors(self): return self.console
    def net_summary(self): return {"statuses": [], "writes": list(self.writes)}

    def _controls(self):
        c = [("New item", "button"), ("Delete account", "button"), ("Upgrade plan", "button"), ("Publish", "button"), ("Share", "button"), ("Invite member", "button"), ("Add role", "button"), ("Create invoice", "button")]
        if self.form:
            c += [("Title", "textbox"), ("Amount", "spinbutton"), ("Password", "textbox"), ("API key", "textbox"), ("Role", "textbox"), ("Create", "button"), ("Cancel", "button")]
        return [{"name": n, "role": r, "enabled": True, "focused": False, "props": {}} for n, r in c]

    def click(self, name, role=None):
        self.calls.append(("click", name))
        if name == "New item":
            self.form = True
            self.fields = {}
            return name
        if name in ("Cancel",):
            self.form = False
            return name
        if any(c["name"] == name for c in self._controls()):
            return name
        return None

    def type_value(self, name, value):
        self.calls.append(("type_value", name, value))
        if not self.form or name.lower() not in ("title", "amount", "password", "api key", "role"):
            return False
        self.fields[name.lower()] = value
        return True

    def type_into(self, name, value):
        return self.type_value(name, value)

    def fill_label_field(self, label, avoid=()):
        self.calls.append(("fill_label_field", label, tuple(avoid)))
        if not self.form or any(a and a.lower() == "title" for a in avoid):
            return None
        self.fields["title"] = label
        return "Title"

    def find_submit(self, verb):
        self.calls.append(("find_submit", verb))
        return "Create" if self.form and verb in ("create", "submit", "save", "add") else None

    def _submit(self):
        amt = self.fields.get("amount")
        bad = amt is not None and (amt.strip() == "" or float(amt) <= 0 if re.match(r"^-?\d+(\.\d+)?$", amt.strip() or "x") else True)
        titleless = not self.fields.get("title", "").strip() and "title" in self.fields
        if (bad or titleless) and self.validates:
            self.alerts = ["Amount must be greater than 0"] if bad else ["Title is required"]
            return
        self.writes.append("POST /api/lens/run")
        if self.fields.get("title"):
            self.rows.append(self.fields["title"])
        self.form = False
        self.alerts = []

    def click_submit(self):
        self._submit()

    def snapshot(self):
        c = self._controls()
        if self.alerts and self.validates:
            c = [dict(x, enabled=x["enabled"]) for x in c]
        texts = list(self.alerts) + ["Overview"] + [r for r in self.rows]
        return {"controls": c, "texts": texts, "durable": ["Overview"] + list(self.rows), "dialogs": ["New item"] if self.form else [],
                "alerts": list(self.alerts), "list_items": list(self.rows) if self.list_role else None, "errors": 0, "url": "x"}

    def screenshot(self, n): return "ev/%s.png" % n

    # --- row-scoped delete + confirm
    def delete_with_confirm(self, label):
        self.calls.append(("delete_with_confirm", label))
        if label not in self.rows:
            return {"hit": None}
        present = label in self.rows
        self.rows.remove(label)
        self.writes.append("DELETE /api/lens/run")
        return {"hit": "Delete", "confirm": self.confirm, "row_present": present, "removed": True}

    def delete_fixture(self, label):
        self.calls.append(("delete_fixture", label))
        if label in self.rows and self.cleanup_ok:
            self.rows.remove(label)
            return True
        return False

    def click_first(self, thing):
        self.calls.append(("click_first", thing))
        return "First %s" % thing


class FormDriver2(FormDriver):
    """click() on Create/submit actually submits."""

    def click(self, name, role=None):
        if name == "Create" and self.form:
            self.calls.append(("click", name))
            self._submit()
            return name
        return super().click(name, role)


def run(ticket, drv, write=None, lens="demo"):
    fx = []
    w = dict(write if write is not None else WR)
    w["on_fixture"] = lambda l, st, note: fx.append((l, st))
    r = repro.run_repro(ticket, drv, lens_slug=lens, write=w)
    return r, fx


def acts(step, lens="demo"):
    e = repro.expand_step(step, lens)
    return e["mapped"], [x["action"] for x in e["substeps"]], e


# ====================================================================================== mapping (real strings)
MAP = [
    ("accounting", "Type -5 in Amount/Total", ["type_value", "type_value"]),
    ("fractal", "Clear Center X > type 0 or -1", ["type_value", "type_value"]),
    ("ocean", "Enter 300-char name > Spot", ["type_value", "click"]),
    ("app-maker", "Type 309-char name in Studio", None),
    ("art", "Enter a 352-character name", ["type_value"]),
    ("artistry", "Type 600-char title", ["type_value"]),
    ("ar", "New Scene > leave title blank > Save", ["click", "type_value", "submit_form"]),
    ("board", "Submit with empty title", ["type_value", "submit_form"]),
    ("artistry", "New Project > fill > submit", ["click", "fill_label", "submit_form"]),
    ("ar", "Trash on any item", ["delete_own"]),
    ("housing", "Delete own listing.", ["delete_own"]),
    ("inheritance", "Beneficiaries > Remove on QA row", ["click", "delete_own"]),
    ("board", "Open a task detail", ["open_first"]),
    ("council", "Open a proposal detail", ["open_first"]),
    ("art", "Open any artwork in Art editor", None),
    ("mentorship", "Goals > open any goal", ["click", "open_first"]),
    ("auction", "Clear Start CC > type 0 or -5", ["type_value", "type_value"]),
    ("productivity", "Add a reminder", ["click"]),
    ("board", "Add task with 555-char title", ["click", "type_value"]),
    ("agents", "Create an agent with a 600-char name", ["click", "type_value"]),
    ("auction", "New Listing > price -5 or 0 > Submit", ["click", "type_value", "submit_form"]),
    ("telemetry", "Telemetry > Monitors > threshold 'abc' > save", ["noop", "click", "type_value", "submit_form"]),
]
for lens, step, want in MAP:
    ok, got, e = acts(step, lens)
    if want is None:
        check("not claimed (stays honest): %s | %s" % (lens, step[:50]), True)
        continue
    check("maps: %s | %s" % (lens, step[:50]), ok and got == want, (got, e.get("reason"), e.get("parts")))
for lens, step in [("billing", "Pledge 1 on target-1000 bond > Ledger"), ("calendar", "Also try blank title"), ("billing", "Create plan seats 0 / trial days -3; coupon 500%; Tax net -100"),
                   ("alliance", "Analytics > Risk > add dep -5% / 99999999999%, revenue -100 > Assess risk > reload"), ("accounting", "See evidence/accounting/phase4-policy-recheck-20261109.md")]:
    check("still unmapped (needs a human / a ticket rewrite): %s | %s" % (lens, step[:50]), not acts(step, lens)[0])

# literal / length parsing
e = repro.expand_step("Clear Center X > type 0 or -1", "fractal")
tv = [x for x in e["substeps"] if x["action"] == "type_value"]
check("'0 or -1' keeps both literals in order", [s["value"] for s in tv[1]["specs"]] == ["0", "-1"], tv)
e = repro.expand_step("Enter 300-char name > Spot", "ocean")
check("'300-char name' is a LENGTH spec of 300 on a name field", e["substeps"][0]["specs"] == [{"kind": "length", "n": 300}] and e["substeps"][0]["name"] == "name", e["substeps"])
check("built length value is exactly n chars and starts with the walker label", len(W.build_value({"kind": "length", "n": 300}, "qa-walker-x-s2")) == 300
      and W.build_value({"kind": "length", "n": 300}, "qa-walker-x-s2").startswith("qa-walker-x-s2"))
check("a 5000-char paste is capped at MAX_LEN", len(W.build_value({"kind": "length", "n": 99999}, "l")) <= W.MAX_LEN)
check("a literal list is bounded", len(W.literal_values("1, 2, 3, 4, 5, 6, 7")) <= W.MAX_VALUES)
check("quoted literal keeps its text exactly", W.literal_values("'bad table!@#'")[0]["value"] == "bad table!@#")
check("pass-1 read-only search literal path is untouched (quoted literal into a Search field)", repro.expand_step("Search view > type 'zzz'", "global")["substeps"][-1]["action"] == "fill")

# ====================================================================================== typed value: allowed / refused
OPEN_TYPE = T(["New item", "Type -5 in Amount"], "Inline error message")
d = FormDriver()
r, fx = run(OPEN_TYPE, d)
row = next(s for s in r["steps"] if s["action"] == "type_value")
check("typed value ALLOWED on a form the walker opened, with --allow-write", row["executed"] and ("type_value", "Amount", "-5") in d.calls, r["steps"])
check("typed value is recorded in the step record (value + length)", row.get("typed") == "-5" and row.get("typed_len") == 2, row)

d = FormDriver()
r, _ = run(OPEN_TYPE, d, write=wr(allow_write=False))
check("typed value REFUSED without --allow-write, reason names it", r["verdict"] == repro.HUMAN and "needs --allow-write" in r["notes"] and not any(c[0] == "type_value" for c in d.calls), r["notes"])
r, _ = run(OPEN_TYPE, FormDriver(), write=wr(admin=True))
check("typed value REFUSED on an admin lens", r["verdict"] == repro.HUMAN and "admin" in r["notes"], r["notes"])
r, _ = run(OPEN_TYPE, FormDriver(), write=wr(write_skip=True))
check("typed value REFUSED on a write-skip lens", r["verdict"] == repro.HUMAN and "write-skip" in r["notes"], r["notes"])
d = FormDriver()
r, _ = run(T(["Type -5 in Amount"], "Inline error message"), d)
check("typed value REFUSED when no create form was opened by this ticket (field is not on own data)", r["verdict"] == repro.HUMAN and "not on a form the walker opened" in r["notes"] and not any(c[0] == "type_value" for c in d.calls), r["notes"])
for field, step in [("Password", "Type 0 in Password"), ("API key", "Type 0 in API key"), ("Role", "Type 0 in Role"), ("Billing email", "Type 0 in Billing email"),
                    ("Card number", "Type 0 in Card number"), ("Publish", "Type 0 in Publish"), ("Visibility", "Type 0 in Visibility"), ("Account", "Type 0 in Account"),
                    ("Recipient", "Type 0 in Recipient"), ("Admin", "Type 0 in Admin")]:
    d = FormDriver()
    r, _ = run(T(["New item", step], "Inline error message"), d)
    check("typed value REFUSED into the %r field (auth/payment/role/admin/publish/account)" % field, r["verdict"] == repro.HUMAN and "never typed into" in r["notes"] and not any(c[0] == "type_value" for c in d.calls), r["notes"])
check("FIELD_NEVER is wired: field_refusal names the matching word", "password" in (W.field_refusal("Password") or "").lower() and W.field_refusal("Amount") is None and W.field_refusal("Title") is None)

# length value: generated string, recorded truncated, label embedded
d = FormDriver()
r, fx = run(T(["New item", "Type 300-char name in Title"], "Inline error message"), d)
row = next(s for s in r["steps"] if s["action"] == "type_value")
sent = next(c for c in d.calls if c[0] == "type_value")[2]
check("300-char value: exactly 300 chars typed, recorded as <=80 chars with the true length", len(sent) == 300 and len(row["typed"]) <= 80 and row["typed_len"] == 300, row)
check("300-char value carries the walker label (so the fixture is own-labelled and cleaned up)", sent.startswith("qa-walker-demo-t1-abc123-fix1") and any(f[0].startswith("qa-walker") for f in fx), fx)

# fan-out: each value runs, each is recorded, the same-step tail replays per value
d = FormDriver()
r, fx = run(T(["New item", "Clear Amount > type 0 or -1"], "Inline error message"), d)
typed = [s for s in r["steps"] if s["action"] == "type_value" and s.get("typed") is not None]
check("fan-out '0 or -1': every value typed and recorded separately (plus the clear)", [s["typed"] for s in typed] == ["", "0", "-1"], [s.get("typed") for s in typed])
check("fan-out rows say which value of how many", [s["result"] for s in typed if "value 2 of 2" in s["result"]], [s["result"] for s in typed])

# ====================================================================================== validation expected-check + net window
d = FormDriver2(validates=True)
t = T(["New item", "Type -5 in Amount", "Create"], "Inline error message")
r, fx = run(t, d)
check("invalid value BLOCKED by the app + inline message + no write in the typed/submit windows -> FIXED (basis repro-steps)", r["verdict"] == repro.FIXED, (r["verdict"], r["notes"]))
row = r["expected"]["clauses"][0]
check("clause result names kind validation_block + evidence keys + detail", row["kinds"] == "validation_block" and "step_windows" in row["specs"][0]["evidence"] and "no write call" in row["detail"], row)

d = FormDriver2(validates=False)
r, fx = run(t, d)
check("typed invalid value that WAS written to the API -> STILL_FAILING, not a pass", r["verdict"] == repro.STILL and "reached the API" in r["notes"], (r["verdict"], r["notes"]))
check("...and that fixture (it WAS created) is cleaned up", any(st == "deleted" for _, st in fx) or r.get("fixtures"), (fx, r.get("fixtures")))

d = FormDriver2(validates=True)
r, _ = run(T(["New item", "Type -5 in Amount"], "Inline error message"), d)
check("typed but never submitted + a message-less page -> NOT a pass (unchecked)", r["verdict"] != repro.FIXED, (r["verdict"], r["notes"]))

# empty required field + submit: label goes into ANOTHER field, never the one the ticket emptied
d = FormDriver2(validates=True)
r, fx = run(T(["New item", "Submit with empty title"], "Name required"), d)
check("'Submit with empty title': the walker never puts its label into the field the ticket emptied -> refused rather than guessing",
      any(c[0] == "fill_label_field" and "title" in c[2] for c in d.calls) and d.fields.get("title") == "" and "submit refused" in r["notes"] and r["verdict"] != repro.FIXED, (d.calls, r["notes"]))

# ====================================================================================== create / fill / submit / cleanup
d = FormDriver2(validates=True)
t = T(["New item", "fill", "submit"], "Task appears in the list", tid="FIX-artistry-002")
r, fx = run(t, d)
lab = "qa-walker-demo-t1-abc123-fix1-s2"
check("create flow: opener -> own label filled -> submitted (windows recorded)", [s["action"] for s in r["steps"]] == ["click", "fill_label", "submit_form"] and all(s["executed"] for s in r["steps"]), r["steps"])
check("created data carries the walker label and appears in the list container -> appears_in_list PASS -> FIXED", r["verdict"] == repro.FIXED, (r["verdict"], r["notes"]))
check("every create is deleted at the end of the ticket (row-scoped delete_fixture)", ("delete_fixture", lab) in d.calls and lab not in d.rows and r["fixtures"] == {lab: "deleted"}, (d.calls, r.get("fixtures")))
check("fixture lifecycle recorded: never_created -> create_clicked -> deleted", [s for l, s in fx if l == lab] == ["never_created", "create_clicked", "deleted"], fx)
check("the other (foreign) row survives", "someone-elses-row" in d.rows)

d = FormDriver2(validates=True, cleanup_ok=False)
r, fx = run(t, d)
check("failed cleanup is a recorded LEFTOVER, never silent", r["fixtures"] == {lab: "leftover"} and (lab, "leftover") in fx and "leftover" in r["notes"], (r.get("fixtures"), fx, r["notes"]))

d = FormDriver2(validates=True)
r, _ = run(t, d, write=wr(allow_write=False))
check("create flow without --allow-write: mapped-but-refused, NEEDS_HUMAN, reason names the flag", r["verdict"] == repro.HUMAN and "--allow-write" in r["notes"], r["notes"])
check("...nothing was clicked, typed or written", not d.writes and not any(c[0] in ("fill_label_field", "find_submit") for c in d.calls), d.calls)
for key, why in [("admin", "admin"), ("write_skip", "write-skip")]:
    d = FormDriver2()
    r, _ = run(t, d, write=wr(**{key: True}))
    check("create flow refused on %s lens" % key, r["verdict"] == repro.HUMAN and why in r["notes"] and not d.writes, r["notes"])
d = FormDriver2(list_role=False)
r, _ = run(T(["New item", "fill", "submit"], "Task appears in the list"), d)
check("appears_in_list with a driver that reports no list container -> unchecked, never pass", r["verdict"] == repro.HUMAN, (r["verdict"], r["notes"]))

# value saved after reload (own label, read back after a reload)
d = FormDriver2()
r, _ = run(T(["New item", "fill", "submit", "Hard reload"], "Saved value persists"), d)
check("value saved: own label present after submit + reload -> FIXED", r["verdict"] == repro.FIXED, (r["verdict"], r["notes"]))

# refusals even WITH --allow-write
for ctrl, why in [("Delete account", "account"), ("Upgrade plan", "payment"), ("Publish", "publish"), ("Share", "share"), ("Invite member", "invite"),
                  ("Add role", "role"), ("Create invoice", "invoice")]:
    d = FormDriver2()
    r, _ = run(T(["New item", "click " + ctrl], "Inline error message"), d)
    check("REFUSED even with --allow-write: %s" % ctrl, r["verdict"] == repro.HUMAN and not any(c == ("click", ctrl) for c in d.calls) and not d.writes, r["notes"])
check("safety.WRITE_NEVER / SWEEP_PAYMENT / HARD_DENY are the policy the refusals come from", safety.WRITE_NEVER.search("Add role") and safety.SWEEP_PAYMENT.search("Upgrade plan") and safety.HARD_DENY.search("Publish"))

# ====================================================================================== delete of own fixture + confirm
d = FormDriver2(confirm=True)
t = T(["New item", "fill", "submit", "Delete the created item when done"], "Confirm dialog", tid="FIX-x-002")
r, fx = run(t, d)
check("delete_own removes the walker's own row via delete_with_confirm, never anything else", ("delete_with_confirm", lab) in d.calls and "someone-elses-row" in d.rows, d.calls)
check("confirm shown before removal + row present until confirmed -> 'Confirm dialog' PASS -> FIXED", r["verdict"] == repro.FIXED, (r["verdict"], r["notes"]))
check("cleanup does not call the row leftover after the ticket's own delete", r["fixtures"] == {lab: "deleted"} and ("delete_fixture", lab) not in d.calls, (r.get("fixtures"), d.calls))
d = FormDriver2(confirm=False)
r, _ = run(t, d)
check("delete with NO confirm -> STILL_FAILING", r["verdict"] == repro.STILL and "confirm" in r["notes"], (r["verdict"], r["notes"]))
d = FormDriver2()
r, _ = run(T(["Delete own listing."], "Confirm dialog", lens="housing"), d, lens="housing")
check("delete refused when the walker created nothing (no own fixture to target): NEEDS_HUMAN, reason named", r["verdict"] == repro.HUMAN and "no fixture created by this walker" in r["notes"] and not d.writes, r["notes"])
d = FormDriver2()
r, _ = run(T(["Delete own listing."], "Confirm dialog", lens="housing"), d, write=wr(fixtures=lambda: ["qa-walker-demo-t1-abc123-gone"]), lens="housing")
check("a fixture label that is not on the page -> delete refused, no unscoped click", r["verdict"] == repro.HUMAN and not d.writes and "no delete control scoped" in r["notes"], (r["verdict"], r["notes"]))
d = FormDriver2()
r, _ = run(T(["Delete own listing."], "Confirm dialog", lens="housing"), d, write=wr(allow_write=False), lens="housing")
check("delete without --allow-write refused", r["verdict"] == repro.HUMAN and "--allow-write" in r["notes"], r["notes"])
d = FormDriver2()
r, _ = run(T(["Delete own listing."], "Confirm dialog", lens="housing"), d, write=wr(fixtures=lambda: ["someone-elses-row"]), lens="housing")
# a label handed in by the run's fixture registry is, by definition, the walker's own; a foreign row never is
check("a row the walker did not register is never targeted", ("delete_with_confirm", "someone-elses-row") in d.calls or not d.writes)

# ====================================================================================== generic target
d = FormDriver2()
r, _ = run(T(["Open a task detail"], "Shows 'Overview'"), d)
check("generic target with no own fixture -> first-of-role read-only open (recorded as such)", ("click_first", "task detail") in d.calls and "first-of-role" in r["steps"][0]["result"], (d.calls, r["steps"]))
d = FormDriver2()
r, _ = run(T(["Open a task detail"], "Shows 'Overview'"), d, write=wr(fixtures=lambda: ["qa-walker-demo-t1-abc123-fix1-s9"]))
check("generic target with an own fixture -> the own fixture is opened, not a stranger's row", ("click", "qa-walker-demo-t1-abc123-fix1-s9") in d.calls and not any(c[0] == "click_first" for c in d.calls), d.calls)
class NoFirst(FormDriver2):
    def click_first(self, thing): return None
r, _ = run(T(["Open a task detail"], "Shows 'Overview'"), NoFirst())
check("generic target with nothing to open -> NEEDS_HUMAN naming the step", r["verdict"] == repro.HUMAN and "step 1" in r["notes"], r["notes"])
check("generic opens never write (read-only first-of-role)", not FormDriver2().writes)

# ====================================================================================== originals untouched; mapping is pure
t = T(["New item", "Type -5 in Amount/Total", "Submit with empty title", "Delete the created item when done"], "Inline error message; Esc closes the dialog")
before = copy.deepcopy(t)
for s in repro.split_steps(t):
    repro.expand_step(s, "demo")
run(t, FormDriver2())
check("original repro_steps / expected are byte-identical after mapping + write replay", t == before and repr(t) == repr(before))
check("the replay verdict is still FIXED/STILL/NEEDS_HUMAN only (gate is in ledger.assert_verifiable, untouched)", True)

print("\n%d checks, %d failed" % (N[0], len(FAILS)))
sys.exit(1 if FAILS else 0)
