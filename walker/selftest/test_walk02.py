#!/usr/bin/env python3
"""WALK-02 selftests (GB-1544): accounts/portability, config-relative dirs,
macOS memory guard, admin gate PASS, inventory. Unit legs only — no browser,
no live site, no real secrets (fixture values throughout).

Run: python3 selftest/test_walk02.py   (exit 0 = all legs pass)
On the pristine walker this suite fails: the old config carries the retired
account names and box paths, there is no vm_stat guard, no gate verdict, and
no shipped inventory.json.
"""
import builtins, json, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from concord_walker import util
from concord_walker.auth import expected_username, assert_account, AccountMismatch
from concord_walker.checks import gate_verdict, LensWalk

FAILS = []


def leg(name, fn):
    try:
        fn()
        print("PASS", name)
    except Exception as e:
        FAILS.append(name)
        print("FAIL", name, "->", repr(e)[:200])


def shipped_cfg():
    return util.load_config(os.path.join(ROOT, "config.json"))


# ---------------------------------------------------------------- accounts
def t_account_map():
    cfg = shipped_cfg()
    assert cfg["accounts"]["t1"]["username"] == "concord-zukoqa"
    assert cfg["accounts"]["t2"]["username"] == "zukoqb"
    assert cfg["accounts"]["admin"]["username"] == "zukoqadmin"
    assert cfg["accounts"]["t1"]["secrets_file"].endswith("concord-zukoqa.env")
    assert cfg["accounts"]["t2"]["secrets_file"].endswith("concord-zukoqb.env")
    assert cfg["accounts"]["admin"]["secrets_file"].endswith("concord-zukoqadmin.env")
    for acct in cfg["accounts"].values():
        assert "vault_login_id" not in acct


def t_admin_set():
    cfg = shipped_cfg()
    want = {"admin", "command-center", "debug", "ops", "system", "sentinel", "psyops", "repair-telemetry"}
    assert set(cfg["admin_lenses"]) == want, cfg["admin_lenses"]
    assert want <= set(cfg["write_skip_lenses"])


def t_no_stale_names():
    needles = ["zuko_qa", "/workspace/concord-live-audit", "/workspace/secrets"]
    files = [os.path.join(ROOT, "config.json"), os.path.join(ROOT, "README.md"), os.path.join(ROOT, "walker.py")]
    for d in ("concord_walker", "tools"):
        files += [os.path.join(ROOT, d, f) for f in os.listdir(os.path.join(ROOT, d)) if f.endswith(".py")]
    for path in files:
        text = open(path).read()
        for n in needles:
            assert n not in text, "%s still in %s" % (n, path)


# ------------------------------------------------------- config-relative dirs
def t_config_relative():
    tmp = tempfile.mkdtemp(prefix="walk02-cfg-")
    p = os.path.join(tmp, "config.json")
    json.dump({"audit_dir": "audit", "runs_dir": "runs", "queue_dir": "queue", "evidence_dir": "evidence",
               "accounts": {}}, open(p, "w"))
    cfg = util.load_config(p)
    for key in ("audit_dir", "runs_dir", "queue_dir", "evidence_dir"):
        assert os.path.isabs(cfg[key]) and cfg[key].startswith(util.WALKER_DIR), (key, cfg[key])
    json.dump({"audit_dir": "/abs/audit", "accounts": {}}, open(p, "w"))
    assert util.load_config(p)["audit_dir"] == "/abs/audit"  # absolute stands
    json.dump({"accounts": {}}, open(p, "w"))
    assert util.load_config(p)["audit_dir"] == os.path.join(util.WALKER_DIR, "audit")  # default


# ------------------------------------------------------------- memory guard
VM_STAT = """Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                10000.
Pages active:                             200000.
Pages inactive:                            50000.
Pages speculative:                         10000.
Pages wired down:                          80000.
"""


def t_vm_stat_parse():
    # (10000 free + 50000 inactive + 10000 speculative) * 16384 B = 1120 MB (floor)
    assert util.parse_vm_stat(VM_STAT) == (70000 * 16384) // (1024 * 1024)
    assert util.parse_vm_stat("not a vm_stat dump") is None
    assert util.parse_vm_stat("") is None


def t_mem_guard_macos_path():
    real_open = builtins.open

    def no_proc(path, *a, **k):
        if str(path) == "/proc/meminfo":
            raise OSError("no /proc on macOS")
        return real_open(path, *a, **k)

    builtins.open = no_proc
    try:
        mb = util.mem_available_mb(_vm_stat_text=VM_STAT)
    finally:
        builtins.open = real_open
    assert mb == (70000 * 16384) // (1024 * 1024) and mb < (1 << 30), mb


# ------------------------------------------------- expected username / guard
class _Resp:
    def __init__(self, status, body):
        self.status, self._body = status, body

    def json(self):
        return self._body


class _Ctx:
    def __init__(self, status, body):
        self.request = self
        self._r = _Resp(status, body)

    def get(self, url, timeout=None):
        return self._r


def _auth_cfg(tmp, with_file=True, file_user="walker-fixture-user"):
    env = os.path.join(tmp, "concord-zukoqa.env")
    if with_file:
        with open(env, "w") as f:
            f.write("username=%s\npassword=fixture-password-never-logged\nsite=https://fixture.invalid\n" % file_user)
    return {"_walker_dir": tmp, "base_url": "http://fixture.invalid",
            "forbidden_roles": ["owner", "founder", "sovereign", "superadmin", "root"],
            "accounts": {"t1": {"username": "concord-zukoqa", "expected_roles": ["member", "user"],
                                "secrets_file": env}}}


def t_expected_username_from_file():
    tmp = tempfile.mkdtemp(prefix="walk02-auth-")
    cfg = _auth_cfg(tmp)
    assert expected_username(cfg, "t1") == "walker-fixture-user"  # the file wins over the config name
    cfg2 = _auth_cfg(tempfile.mkdtemp(prefix="walk02-auth2-"), with_file=False)
    assert expected_username(cfg2, "t1") == "concord-zukoqa"  # no file -> config name


def t_assert_account():
    tmp = tempfile.mkdtemp(prefix="walk02-auth-")
    cfg = _auth_cfg(tmp)
    me = assert_account(_Ctx(200, {"ok": True, "user": {"username": "walker-fixture-user", "role": "member"}}),
                        cfg, "t1", "test")
    assert me["username"] == "walker-fixture-user"
    for status, body, why in (
        (200, {"ok": True, "user": {"username": "someone-else", "role": "member"}}, "username mismatch must abort"),
        (200, {"ok": True, "user": {"username": "walker-fixture-user", "role": "owner"}}, "forbidden role must abort"),
        (200, {"ok": True, "user": {"username": "walker-fixture-user", "role": "admin"}}, "unexpected role must abort"),
        (401, {}, "signed out must abort"),
    ):
        try:
            assert_account(_Ctx(status, body), cfg, "t1", "test")
        except AccountMismatch:
            continue
        raise AssertionError(why)


# ---------------------------------------------------------------- gate PASS
def t_gate_verdict():
    assert gate_verdict(403, [], False) == "PASS"
    assert gate_verdict(200, ["You have no access to this lens"], False) == "PASS"
    assert gate_verdict(200, ["Admin only"], False) == "PASS"
    assert gate_verdict(200, [], True) == "PASS"          # login redirect
    assert gate_verdict(500, [], False) is None           # a crash is not a gate pass
    assert gate_verdict(404, [], False) is None           # a missing lens is not a gate pass
    assert gate_verdict(200, ["Welcome back"], False) is None
    assert gate_verdict(None, [], False) is None


class _Rec:
    def evidence_dir(self, slug):
        return tempfile.mkdtemp(prefix="walk02-ev-")


def t_gate_check_derivation():
    cfg = shipped_cfg()
    cfg["audit_dir"] = tempfile.mkdtemp(prefix="walk02-audit-")
    lens_admin = {"slug": "debug", "url": "https://fixture.invalid/lenses/debug"}
    lens_plain = {"slug": "notes", "url": "https://fixture.invalid/lenses/notes"}
    w = LensWalk(None, cfg, _Rec(), lens_admin, "t1", lambda *a: None)
    assert w.gate_check is True
    w = LensWalk(None, cfg, _Rec(), lens_admin, "admin", lambda *a: None, admin=True)
    assert w.gate_check is False
    w = LensWalk(None, cfg, _Rec(), lens_plain, "t1", lambda *a: None)
    assert w.gate_check is False


# ---------------------------------------------------------------- inventory
FIXTURE_REGISTRY = """
export const LENS_REGISTRY: LensEntry[] = [
  { id: 'alpha', name: 'Alpha', category: 'core', path: '/lenses/alpha' },
  {
    id: 'beta',
    name: 'Beta',
    category: 'ai',
    path: '/lenses/beta/traces',
  },
  { id: 'global', name: 'Global', category: 'core', path: '/global' },
];
export const LENS_CATEGORIES = {};
"""


def t_inventory_generator():
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    from generate_inventory import build_inventory
    inv = build_inventory(FIXTURE_REGISTRY, "https://fixture.invalid/")
    assert [e["slug"] for e in inv] == ["alpha", "beta", "global"]
    assert inv[1]["url"] == "https://fixture.invalid/lenses/beta/traces"
    assert inv[2]["url"] == "https://fixture.invalid/global"
    assert all(set(e) == {"slug", "url", "category", "name"} for e in inv)


def t_inventory_shipped():
    # generated from lens-registry.ts at deploy sha 155ba2fcf: 270 registry entries
    inv = json.load(open(os.path.join(ROOT, "inventory.json")))
    assert len(inv) == 270, len(inv)
    slugs = [e["slug"] for e in inv]
    assert len(set(slugs)) == 270
    by = {e["slug"]: e for e in inv}
    assert by["reasoning-traces"]["url"].endswith("/lenses/reasoning/traces")
    assert by["world-creator/anomalies"]["url"].endswith("/lenses/world-creator/anomalies")
    assert by["global"]["url"].endswith("/global")
    for s in ("admin", "command-center", "debug", "ops", "system", "sentinel", "psyops", "repair-telemetry"):
        assert s in by, s


def t_load_inventory_fallback():
    import walker as walker_cli
    tmp = tempfile.mkdtemp(prefix="walk02-inv-")
    cfg = {"audit_dir": tmp, "_walker_dir": ROOT}
    inv = walker_cli.load_inventory(cfg)  # no audit copy -> walker-root inventory.json
    assert len(inv) == 270
    json.dump([{"slug": "only", "url": "http://x", "category": "t"}], open(os.path.join(tmp, "inventory.json"), "w"))
    assert walker_cli.load_inventory(cfg)[0]["slug"] == "only"  # audit copy wins
    cfg2 = {"audit_dir": tempfile.mkdtemp(prefix="walk02-inv2-"), "_walker_dir": tempfile.mkdtemp(prefix="walk02-inv3-")}
    try:
        walker_cli.load_inventory(cfg2)
    except SystemExit:
        pass
    else:
        raise AssertionError("missing inventory must fail clearly")


for name, fn in sorted({k: v for k, v in list(globals().items()) if k.startswith("t_")}.items()):
    leg(name, fn)
print("WALK-02 SELFTEST:", "PASS" if not FAILS else "FAIL (%s)" % ", ".join(FAILS))
sys.exit(1 if FAILS else 0)
