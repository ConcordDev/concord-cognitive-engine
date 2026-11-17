#!/usr/bin/env python3
"""Pass 3 typed test values: compound / shorthand value steps (writevocab._compound, _with_fields, _FIELD_TO, make-N-char,
same-field continuation). Offline. Reuses the pass-2 fake form driver. Every new mapping has a failure path:
a clause the grammar cannot read leaves the WHOLE step unmapped (never a partial guess), and execution is still refused on
non-owned data / auth-payment-role-publish-share fields / read-only lenses. VERIFIED only via ledger.assert_verifiable.
Run: python3 selftest/test_typed_values_pass3.py"""
import os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
SRC = open(os.path.join(HERE, "selftest", "test_write_flows_pass2.py")).read()
head = SRC[:SRC.index("# ====================================================================================== mapping")]
ns = {"__file__": os.path.join(HERE, "selftest", "test_write_flows_pass2.py"), "__name__": "pass2_fixtures"}
exec(compile(head, "pass2_fixtures", "exec"), ns)
repro, W, ledger_src = ns["repro"], ns["W"], None
T, WR, wr, run, FormDriver, FormDriver2 = ns["T"], ns["WR"], ns["wr"], ns["run"], ns["FormDriver"], ns["FormDriver2"]
FAILS = []
N = [0]


def check(name, cond, extra=""):
    N[0] += 1
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:400] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


def subs(step, lens="demo"):
    e = repro.expand_step(step, lens)
    return e["mapped"], e["substeps"], e


def tv(sub):
    return [x for x in sub if x["action"] == "type_value"]


# ---- each value form maps to typed fill actions
ok, s, e = subs("Type 600-char title, submit")
check("length + trailing submit -> type_value(length 600) + submit_form", ok and [x["action"] for x in s] == ["type_value", "submit_form"] and s[0]["specs"] == [{"kind": "length", "n": 600}], s)
ok, s, e = subs("Set tempo to 0, then 999")
check("'set X to 0, then 999' -> both values typed into the SAME field", ok and [x["name"] for x in tv(s)] == ["tempo", "tempo"] and [x["specs"][0]["value"] for x in tv(s)] == ["0", "999"], s)
ok, s, e = subs("Goals > create 323-char name")
check("'create 323-char name' -> length spec on a name field", ok and tv(s) and tv(s)[0]["specs"] == [{"kind": "length", "n": 323}] and tv(s)[0]["name"] == "name", s)
ok, s, e = subs("Studio: Create with empty Title")
check("'Create with empty Title' -> opener + cleared title", ok and tv(s) and tv(s)[0].get("clear") and tv(s)[0]["specs"][0]["value"] == "", s)
ok, s, e = subs("New Material with 300-char name / empty name")
check("two value forms on one field, both kept in order", ok and [x["specs"][0] for x in tv(s)] == [{"kind": "length", "n": 300}, {"kind": "literal", "value": ""}], s)
ok, s, e = subs("Add stand with 300-char name / acres -1 / empty")
check("an unreadable item ('empty' with no field) leaves the whole step unmapped", not ok, s)
ok, s, e = subs("Create with Max entrants 0")
check("negative/zero numeric boundary is typed as a literal", ok and tv(s)[0]["name"].lower() == "max entrants" and tv(s)[0]["specs"][0]["value"] == "0", s)
ok, s, e = subs("Create form, leave note blank")
check("'leave X blank' after an opener -> cleared field", ok and tv(s) and tv(s)[0].get("clear"), s)
ok, s, e = subs("Type -2 in Width/Depth")
check("slash field list still maps one typed run per field", ok and len(tv(s)) == 2, s)

# ---- failure paths: stays unmapped (fail closed, no partial guess)
for step in ["New Poll: Duration -1, Quorum -1, 2 options; Create",     # '2 options' is not a typed value
             "Open Claim, leave plot x/z blank, submit.",               # first clause names no specific control
             "New Job > submit empty",                                  # empty submit would be auto-labelled by the executor
             "See evidence/mail/mail-fulltest-20261109.md",
             "Enter empty/abc/-1/0 and 999999999; submit.",
             "Type -2 in Width and -3 in Depth",   # second clause names no field
             "TMS desk > Rate quoter > 10001 to 94105, -5 lb > Compare rates"]:
    check("still unmapped (fail closed): %s" % step[:55], not subs(step)[0])
check("a value step with no field at all is not guessed", not subs("-5")[0])

# ---- execution: allowed on an own form; refused elsewhere
d = FormDriver()
r, _ = run(T(["New item", "Set Amount to 0, then 999"], "Inline error message"), d)
check("compound typed steps run on a form the walker opened", ("type_value", "Amount", "0") in d.calls and ("type_value", "Amount", "999") in d.calls, d.calls)
d = FormDriver()
r, _ = run(T(["Set Amount to 0, then 999"], "Inline error message"), d)
check("REFUSED on non-owned data: no create form opened by this ticket", r["verdict"] == repro.HUMAN and not any(c[0] == "type_value" for c in d.calls), r["notes"])
d = FormDriver()
r, _ = run(T(["Set Amount to 0, then 999"], "x"), d, write=wr(allow_write=False))
check("REFUSED without --allow-write", r["verdict"] == repro.HUMAN and "--allow-write" in r["notes"] and not d.writes, r["notes"])
for field in ["Password", "Role", "Publish", "Share", "Card number", "Billing email", "Recipient", "Account"]:
    d = FormDriver()
    r, _ = run(T(["New item", "Set %s to -1, then 999" % field], "x"), d)
    check("REFUSED typing into %s (auth/payment/role/publish/share/account field)" % field, not any(c[0] == "type_value" for c in d.calls) and r["verdict"] == repro.HUMAN, (d.calls, r["notes"]))
d = FormDriver()
r, _ = run(T(["New item", "Type 600-char title, submit"], "x"), d, write=wr(write_skip=True))
check("REFUSED on a write-skip lens", r["verdict"] == repro.HUMAN and not d.writes, r["notes"])
# a prod user record is never targeted: delete of a foreign row stays refused even after typed steps
d = FormDriver()
r, _ = run(T(["New item", "Set Amount to -1", "Delete someone-elses-row"], "x"), d)
check("typed steps never widen delete: foreign row survives", "someone-elses-row" in d.rows, d.rows)
# VERIFIED stays behind the single ledger gate
lsrc = open(os.path.join(HERE, "concord_walker", "ledger.py")).read()
check("VERIFIED still only via ledger.assert_verifiable (no new VERIFIED write site)", lsrc.count('VERIFIED = "VERIFIED"') == 1 and "def assert_verifiable" in lsrc
      and "VERIFIED" not in open(os.path.join(HERE, "concord_walker", "writevocab.py")).read())

print("\n%d checks, %d failed" % (N[0], len(FAILS)))
sys.exit(1 if FAILS else 0)
