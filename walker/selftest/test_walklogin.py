#!/usr/bin/env python3
"""WALKLOGIN selftests: the secrets-file login path, fully stubbed (no Chrome, no network, no real secrets).

Bug being pinned (2026-11-15): /login still showed the splash when page.goto returned. The fields were
already in the accessibility tree underneath it, so the walker clicked coordinates the splash covered, the
username never landed, only the password filled, Enter hit HTML5 validation, no POST /api/auth/login was made,
and /api/auth/me stayed 401 for the whole 600s session wait.

Legs:
  1. happy path        field exposed, username lands, Enter establishes the session -> session file, mode 0600
  2. sign-in fallback  Enter swallowed -> the Sign In button is clicked -> session file, mode 0600
  3. splash wait       splash clears after a few seconds -> login waits it out and then succeeds
  4. empty-username retry   first fill loses the username, second fill lands -> success
  5. username never lands   both fills lose it -> SystemExit "typed username did not land...", no session
  6. splash never clears    -> SystemExit about the splash/overlay, nothing typed, no session
  7. session-wait expiry    timeout_s expires -> SystemExit "login not completed (auth/me status 401)", no session
  8. username mismatch      signed in as someone else -> refuses to save

Fail-on-pristine: on the tree before this fix `auth._wait_login_form` / `_field_is_exposed` do not exist, so the
import guard below fails the whole file; and even past the guard, legs 3-6 cannot pass there because the old
code clicked and typed straight into a covered field with no hit test, no retry and no Sign In fallback.
On the fixed tree every leg passes.

Run: python3 selftest/test_walklogin.py [tree_root]
"""
import os, stat, sys, tempfile, types

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from concord_walker import auth, cdp as cdp_mod  # noqa: E402

PASS = []


def check(name, cond, detail=""):
    PASS.append((name, bool(cond)))
    print("%s %s %s" % ("PASS" if cond else "FAIL", name, detail if not cond else ""))


# Import guard: the pre-fix auth.py has none of these.
check("auth has the splash hit-test helpers",
      all(hasattr(auth, n) for n in ("_wait_login_form", "_field_is_exposed", "_login_fields")))

U_BACKEND, P_BACKEND, BTN_BACKEND, SPLASH = 11, 12, 13, 999
FAKE_PASSWORD = "stub-password-not-real"  # written to a tmp file only; never a real credential


class Clock:
    """Fake time: sleep() advances it, so waits and timeouts run instantly."""
    def __init__(self):
        self.t = 1000.0

    def time(self):
        return self.t

    def sleep(self, s):
        self.t += s


class World:
    """Shared state for one scenario."""
    def __init__(self, user, splash_until=0.0, lose_username_fills=0, enter_logs_in=True,
                 signin_logs_in=True, server_user=None, clock=None):
        self.user = user
        self.clock = clock
        self.splash_until = splash_until          # fake-seconds after start the splash covers the form
        self.t_start = clock.t
        self.lose_username_fills = lose_username_fills
        self.enter_logs_in = enter_logs_in
        self.signin_logs_in = signin_logs_in
        self.server_user = server_user or user
        self.logged_in = False
        self.focus = None
        self.values = {U_BACKEND: "", P_BACKEND: ""}
        self.fills_started = 0
        self.typed = []                            # (backend, text) — never contains the password text
        self.clicked_signin = 0
        self.saved_to = None

    def covered(self):
        return self.clock.t - self.t_start < self.splash_until


def _node(role, name, backend, value=""):
    return types.SimpleNamespace(role=role, name=name, backend=backend, value=value)


class FakeAX:
    def __init__(self, world):
        self.w = world

    def by_role(self, role):
        if role == "textbox":
            return [_node("textbox", "Username or Email", U_BACKEND, self.w.values[U_BACKEND]),
                    _node("textbox", "Password", P_BACKEND, "x" * len(self.w.values[P_BACKEND]))]
        if role == "button":
            return [_node("button", "Sign In", BTN_BACKEND)]
        return []


class FakeSession:
    def __init__(self, world):
        self.w = world

    def send(self, method, params=None):
        w = self.w
        if method == "DOM.getNodeForLocation":
            # center x encodes which element we are probing (see FakeCdp.box)
            x = params["x"]
            target = {5: U_BACKEND, 25: P_BACKEND, 45: BTN_BACKEND}[x]
            return {"backendNodeId": SPLASH if w.covered() else target}
        if method == "DOM.pushNodesByBackendIdsToFrontend":
            return {"nodeIds": [params["backendNodeIds"][0]]}
        if method == "DOM.describeNode":
            return {"node": {"backendNodeId": params["nodeId"], "parentId": 0}}
        return {}


class FakeCdp:
    world = None  # set per scenario

    def __init__(self, context, page):
        self.w = FakeCdp.world
        self.s = FakeSession(self.w)

    def ax(self):
        return FakeAX(self.w)

    def box(self, backend):
        # (x, y, w, h) with center x = 5 / 25 / 45 for user / password / button
        return {U_BACKEND: (0, 0, 10, 10), P_BACKEND: (20, 0, 10, 10), BTN_BACKEND: (40, 0, 10, 10)}.get(backend)

    def click(self, backend):
        w = self.w
        if backend == BTN_BACKEND:
            if not w.covered():
                w.clicked_signin += 1
                if w.signin_logs_in:
                    w.logged_in = True
            return True
        # a click on a covered field lands on the splash: focus goes nowhere
        w.focus = None if w.covered() else backend
        return True


class FakeKeyboard:
    def __init__(self, world):
        self.w = world

    def type(self, text, delay=0):
        w = self.w
        if w.focus == U_BACKEND:
            if w.focus == U_BACKEND and text == w.user:
                w.fills_started += 1
                if w.fills_started <= w.lose_username_fills:
                    return  # keystrokes lost (the live bug)
            w.values[U_BACKEND] += text
            w.typed.append((U_BACKEND, text))
        elif w.focus == P_BACKEND:
            w.values[P_BACKEND] += "x" * len(text)  # store length only; the password text is never kept

    def press(self, key):
        w = self.w
        if key == "Enter" and w.enter_logs_in and w.values[U_BACKEND] == w.user and w.values[P_BACKEND]:
            w.logged_in = True


class FakeCtx:
    def __init__(self, world):
        self.w = world

    def new_page(self):
        w = self.w
        return types.SimpleNamespace(goto=lambda *a, **k: None, keyboard=FakeKeyboard(w))

    def storage_state(self, path=None):
        with open(path, "w") as f:
            f.write("{}")
        self.w.saved_to = path

    def new_cdp_session(self, page):
        raise AssertionError("Cdp is stubbed; the real session must not be requested")


class FakeBrowser:
    def __init__(self, world):
        self.w = world

    def new_context(self, **kw):
        return FakeCtx(self.w)

    def close(self):
        pass


class FakePW:
    def __init__(self, world):
        self.chromium = types.SimpleNamespace(launch=lambda **k: FakeBrowser(world))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def run_login(world_kwargs, timeout_s=600, fixed_time=True):
    """Run auth.login() against the stubs. Returns (exit_message_or_None, world, session_path)."""
    clock = Clock()
    world = World(clock=clock, **world_kwargs)
    FakeCdp.world = world
    tmp = tempfile.mkdtemp(prefix="walklogin-")
    sec = os.path.join(tmp, "acct.env")
    with open(sec, "w") as f:
        f.write("username=%s\npassword=%s\n" % (world.user, FAKE_PASSWORD))
    os.chmod(sec, 0o600)
    cfg = {"base_url": "https://stub.invalid", "_walker_dir": tmp,
           "accounts": {"t1": {"username": world.user, "storage_state": "auth/t1.json", "secrets_file": sec}}}
    out = os.path.join(tmp, "auth", "t1.json")

    fake_pw_mod = types.ModuleType("playwright.sync_api")
    fake_pw_mod.sync_playwright = lambda: FakePW(world)
    fake_pw_pkg = types.ModuleType("playwright")
    fake_pw_pkg.sync_api = fake_pw_mod
    saved_mods = {k: sys.modules.get(k) for k in ("playwright", "playwright.sync_api")}
    sys.modules["playwright"], sys.modules["playwright.sync_api"] = fake_pw_pkg, fake_pw_mod
    real_cdp, real_whoami, real_time = cdp_mod.Cdp, auth.whoami, auth.time
    cdp_mod.Cdp = FakeCdp
    auth.whoami = lambda ctx, base: ({"ok": True, "status": 200, "username": world.server_user, "role": "member"}
                                     if world.logged_in else {"ok": False, "status": 401, "username": None, "role": None})
    auth.time = clock
    msg = None
    try:
        auth.login(cfg, "t1", "secrets-file", lambda m: None, timeout_s=timeout_s)
    except SystemExit as e:
        msg = str(e)
    finally:
        cdp_mod.Cdp, auth.whoami, auth.time = real_cdp, real_whoami, real_time
        for k, v in saved_mods.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v
    return msg, world, out


def session_written(out):
    return os.path.exists(out)


def mode_0600(out):
    return stat.S_IMODE(os.stat(out).st_mode) == 0o600


USER = "stub-user"

# 1. happy path ----------------------------------------------------------------------------------
msg, w, out = run_login(dict(user=USER))
check("happy: login returns without error", msg is None, msg)
check("happy: session file written", session_written(out))
check("happy: session file mode is 0600", session_written(out) and mode_0600(out))
check("happy: username landed once", w.typed == [(U_BACKEND, USER)], repr(w.typed))

# 2. Enter swallowed -> Sign In fallback ----------------------------------------------------------
msg, w, out = run_login(dict(user=USER, enter_logs_in=False, signin_logs_in=True))
check("fallback: login returns without error", msg is None, msg)
check("fallback: Sign In clicked exactly once", w.clicked_signin == 1, str(w.clicked_signin))
check("fallback: session file written, 0600", session_written(out) and mode_0600(out))

# 3. splash that clears after a few seconds is waited out ------------------------------------------
msg, w, out = run_login(dict(user=USER, splash_until=4.0))
check("splash wait: login succeeds once the splash clears", msg is None, msg)
check("splash wait: nothing typed while covered (username landed once)", w.typed == [(U_BACKEND, USER)], repr(w.typed))
check("splash wait: session file written, 0600", session_written(out) and mode_0600(out))

# 4. empty username after first fill is retried --------------------------------------------------
msg, w, out = run_login(dict(user=USER, lose_username_fills=1))
check("retry: second fill succeeds", msg is None, msg)
check("retry: exactly two fills happened", w.fills_started == 2, str(w.fills_started))
check("retry: session file written, 0600", session_written(out) and mode_0600(out))

# 5. username never lands --------------------------------------------------------------------------
msg, w, out = run_login(dict(user=USER, lose_username_fills=99))
check("lost username: SystemExit names the problem", msg is not None and "typed username did not land in the login field" in msg, str(msg))
check("lost username: no session saved", not session_written(out) and w.saved_to is None)
check("lost username: Enter never pressed into a half-filled form (not logged in)", not w.logged_in)
check("lost username: exactly two fills attempted", w.fills_started == 2, str(w.fills_started))

# 6. splash never clears ---------------------------------------------------------------------------
msg, w, out = run_login(dict(user=USER, splash_until=10 ** 6))
check("splash stuck: SystemExit mentions the splash/overlay",
      msg is not None and "covered by a splash/overlay" in msg, str(msg))
check("splash stuck: nothing typed, no session saved", w.typed == [] and not session_written(out))

# 7. session-wait timeout --------------------------------------------------------------------------
msg, w, out = run_login(dict(user=USER, enter_logs_in=False, signin_logs_in=False), timeout_s=5)
check("timeout: errors with 'login not completed (auth/me status 401)'",
      msg == "login not completed (auth/me status 401)", str(msg))
check("timeout: no session saved", not session_written(out) and w.saved_to is None)
check("timeout: the fake clock advanced no more than a bounded amount",
      w.clock.t - w.t_start < 60, str(w.clock.t - w.t_start))

# 8. wrong account signed in -----------------------------------------------------------------------
msg, w, out = run_login(dict(user=USER, server_user="someone-else"))
check("mismatch: refuses to save", msg is not None and "NOT saving session" in msg, str(msg))
check("mismatch: no session file", not session_written(out))

failed = [n for n, ok in PASS if not ok]
print("\n%d checks, %d failed" % (len(PASS), len(failed)))
sys.exit(1 if failed else 0)
