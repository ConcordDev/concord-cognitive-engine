#!/usr/bin/env python3
"""ULW C28 self-test (seat B6): the write lane's real second account.

No browser: the pins are machinery pins —
  * auth.write_account_key resolves the configured write account (shipped
    config: "tw") and falls back to None when unconfigured or dangling;
  * auth.write_account_proof on the shipped config: configured, username
    distinct from BOTH t1 and t2, roles admissible — and exactly ONE
    problem, the not-yet-provisioned session (the desk's `walker.py login
    --account tw` is the firing act; the machinery reports it, by name);
  * a write account reusing t1's username is refused by the proof;
  * LensWalk resolves its write-phase account to the write account, and
    FormFuzz (write work) opens under it — never t1;
  * reverify's write context carries the write account in its label stem,
    so its fixtures can never be mistaken for t1's.

The pristine control is the pre-C28 tree: no write_account in config, no
write_account_key in auth, formfuzz hardcodes "t1", LensWalk has no
write_acct — every pin here fails there.
"""
import copy
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, WALKER)

from concord_walker import auth, util


def shipped_cfg():
    return util.load_config(os.path.join(WALKER, "config.json"))


class Rec:
    rid = "run-abcdef012345"

    def evidence_dir(self, slug):
        return tempfile.mkdtemp(prefix="c28-ev-")

    fixtures = {}


def log(*a):
    pass


def t_resolution():
    cfg = shipped_cfg()
    assert auth.write_account_key(cfg) == "tw"
    bare = copy.deepcopy(cfg)
    del bare["write_account"]
    assert auth.write_account_key(bare) is None
    dangling = copy.deepcopy(cfg)
    dangling["write_account"] = "nope"
    assert auth.write_account_key(dangling) is None


def t_proof_shipped():
    cfg = shipped_cfg()
    p = auth.write_account_proof(cfg)
    assert p["configured"] and p["key"] == "tw", p
    assert p["username"] == "zukoqw", p
    assert p["distinct_from_t1"] and p["distinct_from_t2"], p
    assert p["roles_ok"], p
    # the one honest problem on a fresh checkout: no session saved yet
    assert p["session_present"] is False, p
    assert len(p["problems"]) == 1 and "login --account tw" in p["problems"][0], p


def t_proof_rejects_t1_alias():
    cfg = shipped_cfg()
    cfg["accounts"]["tw"] = dict(cfg["accounts"]["tw"], username="concord-zukoqa")
    p = auth.write_account_proof(cfg)
    assert p["distinct_from_t1"] is False, p
    assert any("equals t1" in x for x in p["problems"]), p


def t_proof_unconfigured():
    cfg = shipped_cfg()
    del cfg["write_account"]
    p = auth.write_account_proof(cfg)
    assert p["configured"] is False and p["problems"], p


def t_lenswalk_write_account():
    from concord_walker.checks import LensWalk
    cfg = shipped_cfg()
    lens = {"slug": "goals", "url": cfg["base_url"] + "/lenses/goals"}
    lw = LensWalk(None, cfg, Rec(), lens, "t1", log, allow_write=True)
    assert lw.acct == "t1" and lw.write_acct == "tw", (lw.acct, lw.write_acct)
    bare = copy.deepcopy(cfg)
    del bare["write_account"]
    lw2 = LensWalk(None, bare, Rec(), lens, "t1", log, allow_write=True)
    assert lw2.write_acct == "t1", lw2.write_acct  # pre-C28 behaviour, named


def t_formfuzz_account():
    from concord_walker.formfuzz import FormFuzz

    class RV:
        b = None
        log = staticmethod(log)

    cfg = shipped_cfg()
    rv = RV()
    rv.cfg = cfg
    rv.rec = Rec()
    rv.inv = {"goals": {"slug": "goals", "url": cfg["base_url"] + "/lenses/goals"}}
    ff = FormFuzz(rv, {"lens": "goals", "id": "FIX-goals-000"})
    assert ff.lw.acct == "tw", ff.lw.acct
    # the fuzz asserts the account of the context it opened (lw.acct) — a
    # hardcoded "t1" assert against a tw context would abort every fuzz run
    src = open(os.path.join(WALKER, "concord_walker", "formfuzz.py")).read()
    assert 'assert_account(self._ctx, self.rv.cfg, "t1"' not in src
    assert 'assert_account(ctx, rv.cfg, "t1"' not in src
    assert "self.lw.acct" in src


def t_write_ctx_labelling():
    from concord_walker.reverify import Reverifier
    rv = Reverifier.__new__(Reverifier)
    rv.allow_write = True
    rv.cfg = shipped_cfg()
    rv.rec = Rec()
    t = {"lens": "goals", "id": "FIX-goals-001"}
    w = rv._write_ctx(t, "tw", False, False)
    assert w and w["account"] == "tw", w
    assert "-tw-" in w["label_base"], w["label_base"]
    w1 = rv._write_ctx(t, "t1", False, False)
    assert "-t1-" in w1["label_base"], w1["label_base"]
    assert w["label_base"] != w1["label_base"]


def main():
    tests = [t_resolution, t_proof_shipped, t_proof_rejects_t1_alias,
             t_proof_unconfigured, t_lenswalk_write_account,
             t_formfuzz_account, t_write_ctx_labelling]
    failed = 0
    for t in tests:
        try:
            t()
            print("PASS", t.__name__)
        except Exception as e:
            failed += 1
            print("FAIL", t.__name__, "->", repr(e)[:240])
    print("test_c28_write_account: %d/%d passed" % (len(tests) - failed, len(tests)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
