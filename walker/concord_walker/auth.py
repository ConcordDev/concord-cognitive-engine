"""Accounts, session storage and the /api/auth/me guard.

Credentials are never printed or logged. Two ways to get a session:
  1. `walker.py login --account t1 --headed` opens a visible Chrome at /login on $DISPLAY;
     a human (or a computer-use agent) signs in as the account named in config.
     The walker polls /api/auth/me and saves Playwright storage state to auth/<account>.json (0600).
  2. `walker.py login --account t1 --secrets-file` reads username=/password= from the 0600
     saved-account file named in config (secrets/concord-zukoqa.env, zukoqb.env or
     zukoqadmin.env) and types them. Values never leave memory. The expected username
     for every account check comes from that file when it carries one (WALK-02) —
     the config names the account, the saved file is the identity of record.
"""
import json, os, time
from .util import load_config, resolve_config_path


class AccountMismatch(RuntimeError):
    pass


def _walk(d, key):
    if isinstance(d, dict):
        if key in d and isinstance(d[key], (str, int)):
            return d[key]
        for v in d.values():
            r = _walk(v, key)
            if r is not None:
                return r
    elif isinstance(d, list):
        for v in d:
            r = _walk(v, key)
            if r is not None:
                return r
    return None


def whoami(context, base_url):
    """GET /api/auth/me with the context's own cookies. Returns dict(username, role, ok, status)."""
    try:
        r = context.request.get(base_url.rstrip("/") + "/api/auth/me", timeout=15000)
        status = r.status
        try:
            body = r.json()
        except Exception:
            body = {}
    except Exception as e:
        return {"ok": False, "status": None, "username": None, "role": None, "error": type(e).__name__}
    user = _walk(body, "username")
    role = _walk(body, "role")
    ok = status == 200 and bool(user) and body.get("ok", True) is not False
    return {"ok": ok, "status": status, "username": user, "role": role}


def secrets_path(cfg, account_key):
    """The account's saved .env file (config-relative paths resolve to the walker dir)."""
    p = cfg["accounts"][account_key].get("secrets_file")
    return resolve_config_path(cfg["_walker_dir"], p) if p else None


def expected_username(cfg, account_key):
    """The username /api/auth/me must show for this account. The saved secrets
    file's username= line wins when the file exists and carries one (the saved
    test accounts' real usernames live only in those files); otherwise the
    config's account name. Only the username line is ever read here — the
    password is neither returned nor logged."""
    path = secrets_path(cfg, account_key)
    if path and os.path.exists(path):
        user = _read_secrets_file(path).get("username")
        if user:
            return user
    return cfg["accounts"][account_key]["username"]


AUTH_RETRY_BACKOFF_S = (2, 5, 15, 30)


def _transient(me):
    """No response at all, or a gateway/server error: a blip, not a signed-out session."""
    st = me.get("status")
    return st is None or st in (408, 429) or st >= 500


def whoami_with_retry(context, cfg, purpose="", log=None, sleep=time.sleep):
    """WALKER-ISSUES (Nov 16, 07:06 ET): auth/me returned no response once and the
    whole walk aborted. Retry transient failures (no response, 408/429/5xx) with
    backoff (thresholds.auth_retry_backoff_s, default 2,5,15,30 s). A real answer
    (200 wrong user, 401, 403) is returned at once: a signed-out or wrong account
    still aborts immediately."""
    backoff = (cfg.get("thresholds") or {}).get("auth_retry_backoff_s", AUTH_RETRY_BACKOFF_S)
    me = whoami(context, cfg["base_url"])
    for i, wait in enumerate(backoff):
        if me.get("ok") or not _transient(me):
            break
        if log:
            log("  auth/me transient failure before %s (status %s); retry %d/%d in %ss"
                % (purpose, me.get("status"), i + 1, len(backoff), wait))
        sleep(wait)
        me = whoami(context, cfg["base_url"])
    return me


def assert_account(context, cfg, account_key, purpose, log=None):
    """Abort (raise) unless the session is exactly the expected QA account with an allowed role."""
    acct = cfg["accounts"][account_key]
    me = whoami_with_retry(context, cfg, purpose, log)
    if log:
        log("auth/me before %s: user=%s role=%s status=%s" % (purpose, me.get("username"), me.get("role"), me.get("status")))
    if not me["ok"]:
        raise AccountMismatch("signed out or auth/me failed before %s (status %s)" % (purpose, me.get("status")))
    want = expected_username(cfg, account_key)
    if me["username"] != want:
        raise AccountMismatch("auth/me shows %r, expected %r before %s" % (me["username"], want, purpose))
    role = str(me.get("role") or "").lower()
    if role in [r.lower() for r in cfg.get("forbidden_roles", [])]:
        raise AccountMismatch("auth/me role %r is forbidden" % role)
    if acct.get("expected_roles") and role and role not in acct["expected_roles"]:
        raise AccountMismatch("auth/me role %r not in %r for %s" % (role, acct["expected_roles"], account_key))
    return me


def write_account_key(cfg):
    """ULW C28: the write lane's dedicated account key — cfg["write_account"] when it names a
    configured account, else None (write work then rides the walk's own account, the pre-C28
    behaviour). The write lane (create/delete exercise, form fuzz, repro write steps) runs as
    THIS account, never as the primary evidence account t1: walker-created content must not
    land on the account whose reads are the walk's evidence, and the isolation counterparty
    t2 keeps its single job."""
    key = cfg.get("write_account")
    if key and key in (cfg.get("accounts") or {}):
        return key
    return None


def isolation_pair(cfg, walk_acct):
    """ULW C28 runtime wiring (walk-2 ruling GB-1561 / t1362s16084): (owner, observer) for the
    isolation legs. owner = the account that CREATED the walk's fixtures / object calls under
    test (the write account when configured, else the walk's own account); observer = the
    configured isolation observer (default "t2"). Default configs (no write_account /
    isolation_observer) give (walk_acct, "t2") - the pre-C28 behaviour, unchanged."""
    owner = write_account_key(cfg) or walk_acct
    observer = isolation_observer_key(cfg) or "t2"
    return owner, observer


def isolation_observer_key(cfg):
    """ULW C28 (walk-2 ruling GB-1561): the account that OBSERVES the write account's content for the
    isolation legs - cfg["isolation_observer"] when it names a configured account, else "t2" (the
    pre-ruling default: t2 is the isolation counterparty). Walk 2 sets write_account "t2" and
    isolation_observer "t1"."""
    accounts = cfg.get("accounts") or {}
    key = cfg.get("isolation_observer")
    if key and key in accounts:
        return key
    return "t2" if "t2" in accounts else None


def write_account_proof(cfg):
    """Browser-free proof legs for the write account (ULW C28): configured, distinct from the
    primary (t1) evidence account and from the isolation observer (isolation_observer_key; "t2"
    unless configured) by expected username, a saved session present, and its expected roles
    admissible (none forbidden). The write account may itself be t2 when the observer is NOT t2
    (walk-2 ruling: t2 writes, t1 observes). Returns a dict with a `problems` list; empty
    problems = the machinery is ready to fire. The live leg - assert_account on a real context,
    which also compares LIVE usernames - is the pre-flight's job (concord_walker.preflight, ULW C8)."""
    key = write_account_key(cfg)
    observer = isolation_observer_key(cfg)
    proof = {"key": key, "configured": bool(key), "username": None, "session_present": False,
             "observer": observer, "distinct_from_t1": False, "distinct_from_t2": False,
             "distinct_from_observer": False, "roles_ok": False, "problems": []}
    if not key:
        proof["problems"].append("no write_account configured (write lane rides the walk account)")
        return proof
    proof["username"] = expected_username(cfg, key)
    proof["session_present"] = has_session(cfg, key)
    if not proof["session_present"]:
        proof["problems"].append("no saved session for write account %r (walker.py login --account %s)" % (key, key))
    accounts = cfg.get("accounts") or {}
    if observer and key == observer:
        proof["problems"].append("write account %r is the isolation observer - not a separate account" % key)
    for other, field in (("t1", "distinct_from_t1"), ("t2", "distinct_from_t2")):
        if other not in accounts:
            continue
        if other == key and other != "t1" and other != observer:
            proof[field] = None  # n/a: this IS the write account (allowed only when it is not the observer)
            continue
        proof[field] = proof["username"] != expected_username(cfg, other)
        if not proof[field]:
            proof["problems"].append("write account username equals %s's - not a separate account" % other)
    if observer and observer in accounts:
        proof["distinct_from_observer"] = key != observer and proof["username"] != expected_username(cfg, observer)
        if key != observer and not proof["distinct_from_observer"]:
            proof["problems"].append("write account username equals the isolation observer %s's - not a separate account" % observer)
    roles = [str(r).lower() for r in (cfg["accounts"][key].get("expected_roles") or [])]
    forbidden = [str(r).lower() for r in cfg.get("forbidden_roles", [])]
    proof["roles_ok"] = bool(roles) and not any(r in forbidden for r in roles)
    if not proof["roles_ok"]:
        proof["problems"].append("write account expected_roles missing or carries a forbidden role")
    return proof


def storage_path(cfg, account_key):
    return os.path.join(cfg["_walker_dir"], cfg["accounts"][account_key]["storage_state"])


def has_session(cfg, account_key):
    return os.path.exists(storage_path(cfg, account_key))


def new_context(browser, cfg, account_key, viewport, accept_downloads=True, mobile=False):
    """Every account gets its OWN isolated context (incognito-equivalent). t2/admin never share t1's."""
    kw = dict(viewport={"width": viewport[0], "height": viewport[1]}, accept_downloads=accept_downloads,
              locale="en-US", timezone_id="America/New_York", color_scheme="dark")
    if mobile:
        kw.update(device_scale_factor=2, is_mobile=True, has_touch=True,
                  user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
                             "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
    if account_key and has_session(cfg, account_key):
        kw["storage_state"] = storage_path(cfg, account_key)
    return browser.new_context(**kw)


def _read_secrets_file(path):
    vals = {}
    with open(path) as f:
        for line in f:
            if "=" in line:
                k, v = line.rstrip("\n").split("=", 1)
                vals[k.strip().lower()] = v
    return vals


def _backend_family(cdp, backend):
    """backendNodeId of this node and its ancestors. CDP only — no page JS."""
    ids = {backend}
    try:
        cdp.s.send("DOM.getDocument", {"depth": 0})
        pushed = cdp.s.send("DOM.pushNodesByBackendIdsToFrontend", {"backendNodeIds": [backend]})
        cur = (pushed.get("nodeIds") or [None])[0]
        seen = set()
        while cur and cur not in seen:
            seen.add(cur)
            desc = (cdp.s.send("DOM.describeNode", {"nodeId": cur}).get("node") or {})
            if desc.get("backendNodeId"):
                ids.add(desc["backendNodeId"])
            cur = desc.get("parentId")
    except Exception:
        pass
    return ids


def _field_is_exposed(cdp, backend):
    """True when a click at the field's center would hit it (or a child), not a splash overlay."""
    b = cdp.box(backend)
    if not b:
        return False
    x, y, w, h = b
    try:
        hit = cdp.s.send("DOM.getNodeForLocation", {"x": int(x + w / 2), "y": int(y + h / 2)})
    except Exception:
        return False
    hit_b = hit.get("backendNodeId")
    if not hit_b:
        return False
    if hit_b == backend:
        return True
    return hit_b in _backend_family(cdp, backend) or backend in _backend_family(cdp, hit_b)


def _login_fields(cdp):
    ax = cdp.ax()
    boxes = [n for n in ax.by_role("textbox") if n.backend]
    ufield = next((n for n in boxes if "user" in n.name.lower() or "email" in n.name.lower()), boxes[0] if boxes else None)
    pfield = next((n for n in boxes if "password" in n.name.lower()), None)
    return ufield, pfield


def _wait_login_form(cdp, timeout_s=30):
    """Wait until username+password exist and the username field is not covered by the splash."""
    t0 = time.time()
    last = (None, None)
    while time.time() - t0 < timeout_s:
        last = _login_fields(cdp)
        ufield, pfield = last
        if ufield and pfield and _field_is_exposed(cdp, ufield.backend):
            return ufield, pfield
        time.sleep(0.2)
    return last


def login(cfg, account_key, method, log, timeout_s=600):
    from playwright.sync_api import sync_playwright
    from .cdp import Cdp
    acct = cfg["accounts"][account_key]
    out = storage_path(cfg, account_key)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=(method != "headed"))
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        me = whoami(ctx, cfg["base_url"])
        page = ctx.new_page()
        page.goto(cfg["base_url"] + "/login", wait_until="load", timeout=45000)
        if method == "secrets-file":
            path = secrets_path(cfg, account_key)
            if not path or not os.path.exists(path):
                raise SystemExit("secrets file %s not found; create it (0600) with username= and password= lines, "
                                 "or use --headed" % path)
            vals = _read_secrets_file(path)
            user, pwd = vals.get("username") or acct["username"], vals.get("password")
            if not pwd:
                raise SystemExit("secrets file has no password= line")
            cdp = Cdp(ctx, page)
            wait_s = 30 if timeout_s is None else max(5, min(30, timeout_s))
            ufield, pfield = _wait_login_form(cdp, timeout_s=wait_s)
            if not (ufield and pfield):
                raise SystemExit("could not find username/password fields on /login")
            if not _field_is_exposed(cdp, ufield.backend):
                raise SystemExit("login form was still covered by a splash/overlay after %ss" % wait_s)

            def _fill():
                uf, pf = _login_fields(cdp)
                if not (uf and pf):
                    return 0
                cdp.click(uf.backend)
                page.keyboard.type(user, delay=20)
                cdp.click(pf.backend)
                page.keyboard.type(pwd, delay=20)
                ax = cdp.ax()
                for n in ax.by_role("textbox"):
                    if n.backend == uf.backend or "user" in n.name.lower() or "email" in n.name.lower():
                        return len(n.value or "")
                return 0

            typed = _fill()
            if typed < 1:
                time.sleep(0.5)
                typed = _fill()
            if typed < 1:
                pwd = None
                raise SystemExit("typed username did not land in the login field")
            pwd = None
            page.keyboard.press("Enter")
            # If Enter was swallowed (SPA form), click the Sign In button after a short pause.
            t_click = time.time()
            while time.time() - t_click < 3:
                me = whoami(ctx, cfg["base_url"])
                if me["ok"]:
                    break
                time.sleep(0.5)
            if not me["ok"]:
                submit = next((n for n in cdp.ax().by_role("button") if n.backend and "sign in" in (n.name or "").lower()), None)
                if submit and _field_is_exposed(cdp, submit.backend):
                    cdp.click(submit.backend)
                    log("clicked Sign In after Enter did not establish a session")
        else:
            log("Headed login window open on DISPLAY=%s. Sign in as %s. Waiting up to %ss..."
                % (os.environ.get("DISPLAY"), acct["username"], timeout_s))
        t0 = time.time()
        while time.time() - t0 < timeout_s:
            me = whoami(ctx, cfg["base_url"])
            if me["ok"]:
                break
            time.sleep(2)
        if not me["ok"]:
            raise SystemExit("login not completed (auth/me status %s)" % me.get("status"))
        want = expected_username(cfg, account_key)
        if me["username"] != want:
            raise SystemExit("signed in as %r, expected %r; NOT saving session" % (me["username"], want))
        old = os.umask(0o077)
        try:
            ctx.storage_state(path=out)
        finally:
            os.umask(old)
        os.chmod(out, 0o600)
        log("session saved for %s (role %s) -> %s" % (me["username"], me.get("role"), os.path.relpath(out, cfg["_walker_dir"])))
        browser.close()
