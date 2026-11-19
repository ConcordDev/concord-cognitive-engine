"""Pre-flight verification (ULW C8, WALK-2-READINESS-GATE §4).

Runs BEFORE lens 1 of a walk and answers, in one published report:

  * both sessions — every account the run will use (t1, t2, admin when an
    admin session exists, and the ULW C28 write account when configured) has
    a saved session and, on the live leg, passes assert_account;
  * write-lane labelling — the fixture prefix is set, and fixture labels
    carry the acting account, so a write account's fixtures are never
    mistaken for the evidence account's (the label stem format is
    reverify._write_ctx's: prefix-lens-account-run-ticket);
  * the write-skip lens list, published up front — carried IN the report,
    not left implicit in config;
  * create/delete coverage as a NUMBER on day one: of the inventory's
    lenses, how many the create_delete phase can actually run on
    (not write-skip, not admin), and how many it structurally cannot.

verify_config() is the browser-free leg (config + filesystem + inventory).
run_preflight(browser=...) adds the live session assertions. A report with
problems means the run must not start lens 1: `walker.py preflight` exits
non-zero, and its JSON report is written under the run's audit dir either
way — the failure is published, not whispered.
"""
import re

from .auth import expected_username, has_session, write_account_key, write_account_proof

PRIMARY_ACCOUNTS = ("t1", "t2")


def _slugs(inventory):
    out = []
    for e in inventory or []:
        slug = e.get("slug") if isinstance(e, dict) else None
        if slug:
            out.append(slug)
    return out


def coverage_numbers(cfg, inventory):
    """Create/delete coverage, as numbers (ULW C8): the create_delete phase
    runs only where a lens is neither write-skip nor admin (checks.LensWalk)."""
    slugs = _slugs(inventory)
    skip = set(cfg.get("write_skip_lenses", []))
    admin = set(cfg.get("admin_lenses", []))
    blocked = [s for s in slugs if s in skip or s in admin]
    covered = [s for s in slugs if s not in skip and s not in admin]
    return {"inventory_total": len(slugs),
            "create_delete_covered": len(covered),
            "create_delete_blocked": len(blocked),
            "blocked_write_skip": len([s for s in slugs if s in skip]),
            "blocked_admin": len([s for s in slugs if s in admin and s not in skip]),
            "covered_slugs": covered}


def labelling_proof(cfg):
    """Write-lane labelling legs (browser-free): the fixture prefix is set,
    and the label stem for the write account differs from the evidence
    account's stem for the same lens — the two accounts' fixtures can never
    share a label namespace."""
    prefix = cfg.get("fixture_prefix") or ""
    proof = {"fixture_prefix": prefix, "stems_differ": False, "problems": []}
    if not prefix:
        proof["problems"].append("config carries no fixture_prefix — write-lane fixtures would be unlabelled")
        return proof
    wkey = write_account_key(cfg)

    def stem(acct):
        return "%s-%s-%s-%s-%s" % (prefix, "lens", acct or "t1", "runid0", "ticket0")

    proof["stem_t1"] = stem("t1")
    proof["stem_write"] = stem(wkey) if wkey else None
    proof["stems_differ"] = bool(wkey) and proof["stem_write"] != proof["stem_t1"]
    if wkey and not proof["stems_differ"]:
        proof["problems"].append("write account label stem collides with t1's")
    return proof


def verify_config(cfg, inventory):
    """The browser-free pre-flight: sessions on disk, the write account's
    proof (ULW C28), labelling, the published write-skip list, coverage."""
    problems = []
    sessions = {}
    for key in PRIMARY_ACCOUNTS:
        if key not in (cfg.get("accounts") or {}):
            problems.append("account %r is not configured" % key)
            continue
        present = has_session(cfg, key)
        sessions[key] = {"configured": True, "session_present": present,
                         "username": expected_username(cfg, key)}
        if not present:
            problems.append("no saved session for %s (walker.py login --account %s)" % (key, key))
    if "admin" in (cfg.get("accounts") or {}):
        sessions["admin"] = {"configured": True, "session_present": has_session(cfg, "admin"),
                             "username": expected_username(cfg, "admin")}
    wproof = write_account_proof(cfg)
    if wproof["configured"]:
        sessions[wproof["key"]] = {"configured": True, "session_present": wproof["session_present"],
                                   "username": wproof["username"]}
        problems += ["write account: " + p for p in wproof["problems"]]
    lab = labelling_proof(cfg)
    problems += lab["problems"]
    cov = coverage_numbers(cfg, inventory)
    report = {"ok": not problems, "problems": problems, "sessions": sessions,
              "write_account": wproof, "labelling": lab,
              "write_skip_lenses": sorted(cfg.get("write_skip_lenses", [])),
              "admin_lenses": sorted(cfg.get("admin_lenses", [])),
              "coverage": {k: v for k, v in cov.items() if k != "covered_slugs"},
              "covered_slugs": cov["covered_slugs"]}
    return report


def verify_sessions_live(browser, cfg, log=None):
    """The live leg: open each required account's own context and assert the
    session is exactly that account. Returns a list of problem strings
    (empty = every session verified). Never raises: pre-flight REPORTS."""
    from .auth import assert_account, new_context, AccountMismatch
    problems = []
    keys = [k for k in PRIMARY_ACCOUNTS if k in (cfg.get("accounts") or {})]
    wkey = write_account_key(cfg)
    if wkey:
        keys.append(wkey)
    if "admin" in (cfg.get("accounts") or {}) and has_session(cfg, "admin"):
        keys.append("admin")
    vp = cfg.get("viewport_desktop") or (1280, 900)
    for key in keys:
        if not has_session(cfg, key):
            problems.append("no saved session for %s" % key)
            continue
        ctx = new_context(browser, cfg, key, vp)
        try:
            assert_account(ctx, cfg, key, "pre-flight", log)
        except AccountMismatch as e:
            problems.append("session for %s failed pre-flight: %s" % (key, e))
        except Exception as e:
            problems.append("session for %s could not be checked: %r" % (key, e))
        finally:
            try:
                ctx.close()
            except Exception:
                pass
    return problems


def run_preflight(cfg, inventory, browser=None, log=None):
    report = verify_config(cfg, inventory)
    if browser is not None:
        live = verify_sessions_live(browser, cfg, log)
        report["live_problems"] = live
        report["problems"] += live
        report["ok"] = not report["problems"]
    return report
