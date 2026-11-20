#!/usr/bin/env python3
"""Concord ultimate lens walker - CLI. See README.md."""
import argparse, json, os, sys, signal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from concord_walker.util import load_config, run_id, Log, mem_available_mb, human_et, append_text, lens_result_path
from concord_walker.auth import AccountMismatch, has_session, login, whoami, new_context
from concord_walker.records import RunRecorder
from concord_walker.tickets import TicketStore
from concord_walker.root_causes import write_root_causes
from concord_walker.checks import LensWalk
from concord_walker.reverify import Reverifier, status_update
from concord_walker import sha_gate, coverage as cov
from concord_walker.runstate import RunLock  # WALK-05: stale-aware lock (runstate.py)

READ_PHASES = ["reach", "surface", "tabs", "keyboard", "openers", "export", "contrast", "mobile"]


def load_inventory(cfg):
    # A run-local inventory in the audit dir wins; otherwise the versioned one
    # at the walker root (generated from lens-registry.ts — tools/generate_inventory.py).
    for path in (os.path.join(cfg["audit_dir"], "inventory.json"),
                 os.path.join(cfg["_walker_dir"], "inventory.json")):
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)
    raise SystemExit("inventory.json not found in the audit dir or the walker root; "
                     "generate it with tools/generate_inventory.py")


def wait_for_memory(cfg, log):
    import time
    need = cfg["thresholds"]["min_mem_available_mb"]
    for _ in range(10):
        if mem_available_mb() >= need:
            return True
        log("low memory (%d MB < %d MB); waiting 30 s" % (mem_available_mb(), need))
        time.sleep(30)
    return False


def file_findings(store, rec, findings, dry, log, tester, filed=None):
    """filed (optional list) receives (finding, ticket_id, 'new'|'dup') for schema v2 findings[]."""
    new, dups, reserved = [], [], []
    filed = filed if filed is not None else []
    for f in findings:
        dup = store.find_duplicate(f)
        if dup:
            dups.append((f, dup))
            filed.append((f, dup, "dup"))
            st = store.status(dup)
            if st in ("VERIFIED",):
                rec.judgment(f["lens"], "possible_regression", "Walker finding '%s' matches %s which is VERIFIED; reopen?" % (f["title"], dup), f["evidence"], ticket_id=dup)
            continue
        tid = store.next_id(f["lens"], reserved)
        reserved.append(tid)
        new.append(store.to_ticket(f, tid, tester))
        filed.append((f, tid if not dry else "candidate:" + tid, "new" if not dry else "candidate"))
    with open(os.path.join(rec.run_dir, "dedup.jsonl"), "a") as fh:
        for f, d in dups:
            fh.write(json.dumps({"lens": f["lens"], "check": f["check"], "title": f["title"], "dup_of": d}) + "\n")
    with open(os.path.join(rec.run_dir, "new_tickets.jsonl"), "a") as fh:
        for t in new:
            fh.write(json.dumps(t) + "\n")
    if new and not dry:
        bak = store.append_tickets(new, rec.rid)
        log("  filed %d ticket(s) %s (backup %s); %d duplicate(s) of existing" % (len(new), [t["id"] for t in new], os.path.basename(bak), len(dups)))
    else:
        log("  %d new ticket candidate(s)%s; %d duplicate(s) of existing" % (len(new), " (dry-run, not filed)" if dry else "", len(dups)))
    return new, dups


def pick_lenses(inv, args):
    lenses = inv
    if getattr(args, "only", None):
        want = [s.strip() for s in args.only.split(",") if s.strip()]
        by = {l["slug"]: l for l in inv}
        missing = [s for s in want if s not in by]
        if missing:
            raise SystemExit("unknown lens slug(s): %s" % missing)
        lenses = [by[s] for s in want]
    if getattr(args, "category", None):
        lenses = [l for l in lenses if l.get("category") == args.category]
    if getattr(args, "shard", None):
        from concord_walker.shard import parse_shard, partition
        si, sn = parse_shard(args.shard)
        mine = set(partition([l["slug"] for l in inv], sn)[si])
        lenses = [l for l in lenses if l["slug"] in mine]
    if getattr(args, "start_from", None):
        slugs = [l["slug"] for l in lenses]
        lenses = lenses[slugs.index(args.start_from):]
    if getattr(args, "limit", None):
        lenses = lenses[: args.limit]
    return lenses


def _clone_permit(args, cfg, log):
    """ULW C42: build the clone permit for --clone-legs runs. Fetches the
    clone's /health and asks CloneGate to verify it against the configured
    clone identity; ANY failure aborts the run (WalkAborted) — a refused
    gate must never silently degrade into a prod run without the legs."""
    if not getattr(args, "clone_legs", False):
        return None
    import json as _json
    import urllib.request as _u
    from concord_walker.clone_legs import CloneGate, CloneRefused
    clone_cfg = (cfg.get("clone") or {})
    url = (clone_cfg.get("base_url") or "").rstrip("/")
    if not url:
        raise WalkAborted("clone legs requested but cfg.clone.base_url is not configured — refusing to run")
    try:
        req = _u.Request(url + "/health", headers={"User-Agent": "concord-walker-clone-gate"})
        with _u.urlopen(req, timeout=15) as resp:
            health = _json.loads(resp.read().decode("utf-8", "replace"))
    except Exception as e:
        raise WalkAborted("clone health fetch failed (%s) — refusing to run clone legs" % e)
    try:
        permit = CloneGate(cfg).permit(url, health)
    except CloneRefused as e:
        raise WalkAborted("clone gate refused: %s" % e)
    log("clone legs: permit granted for %s (health marker verified)" % url)
    return permit


class WalkAborted(SystemExit):
    pass


def _is_browser_crash(e):
    n = type(e).__name__
    t = str(e)
    return n in ("Error", "TargetClosedError") and any(k in t for k in (
        "Target closed", "Target page, context or browser has been closed", "Browser has been closed",
        "browser has disconnected", "Connection closed"))


def cmd_walk(args, cfg, log):
    from playwright.sync_api import sync_playwright
    from concord_walker.lensrecord import deploy_stamp, upgrade_record, Manifest, checks_not_run, load_lens_record
    from concord_walker.replay import ReplayRun
    from concord_walker.carryover import CarryoverQueue
    inv = load_inventory(cfg)
    lenses = pick_lenses(inv, args)
    all_slugs = [l["slug"] for l in inv]
    dry = args.dry_run or args.no_auth
    # ULW v3 W3: sharding — per-shard run id (hence run dir), account pair,
    # lock and ledger. Unsharded runs are untouched.
    shard = None
    reader_key = "t1"
    if getattr(args, "shard", None):
        from concord_walker.shard import parse_shard, shard_accounts, shard_run_id, shard_lock_name
        shard = parse_shard(args.shard)
        reader_key, writer_key = shard_accounts(cfg, shard[0])
        if writer_key:
            cfg = dict(cfg, write_account=writer_key)
    rid = getattr(args, "resume", None) or run_id()
    if shard and not getattr(args, "resume", None):
        rid = shard_run_id(rid, shard[0], shard[1])
    rec = RunRecorder(cfg, rid, dry=dry)
    if shard:
        log("shard %d of %d: run %s, %d lens(es), reader=%s writer=%s, ledger in run dir" % (
            shard[0], shard[1], rid, len(lenses), reader_key, cfg.get("write_account")))
    log.path = os.path.join(rec.run_dir, "walker.log")
    # Replay (replay-original-tickets): the sweep sits ON TOP of the original lens-walk tickets. A live
    # sweep loads the same pinned fold reverify --from-repo reads, and replays every OPEN /
    # FIXED_PENDING_VERIFY ticket per lens. Skipping that is an explicit, loudly-logged --no-replay.
    no_replay = bool(getattr(args, "no_replay", False))
    fold = None
    if no_replay:
        log("!!! --no-replay: this sweep does NOT replay the original lens-walk tickets (no fold loaded, no verdicts, every ticket gets a 'replay disabled' coverage row)")
    elif args.no_auth:
        no_replay = True
        log("replay off: --no-auth signed-out smoke cannot replay tickets")
    else:
        if not getattr(args, "from_repo", None) or not getattr(args, "deploy_sha", None):
            raise SystemExit("a live sweep replays the original tickets and needs --from-repo <checkout> --deploy-sha <sha> "
                             "(the fold is read at that pinned sha). Pass --no-replay to sweep without replay (logged loudly).")
        if not sha_gate.is_hex_sha(args.deploy_sha):
            raise SystemExit("--deploy-sha %r is not a hex git sha (>=7 chars)" % args.deploy_sha)
        from concord_walker.fold import extract_from_git
        fold = extract_from_git(args.from_repo, args.deploy_sha)
        log("fold @ %s: %s" % (args.deploy_sha, fold.counts()))
        with open(os.path.join(rec.run_dir, "canonical.jsonl"), "w") as f:
            f.write(fold.canonical_text())
    store = TicketStore(cfg["audit_dir"], fold=fold)
    premap = bool(getattr(args, "premap", False))
    wiring_col = None
    if getattr(args, "capture_wiring", False):
        from concord_walker import wiring as _wiring
        wiring_col = _wiring.Collector(os.path.join(rec.run_dir, "wiring"), rid, getattr(args, "deploy_sha", None),
                                       registry=_wiring.load_registry(getattr(args, "wiring_registry", None), getattr(args, "from_repo", None), getattr(args, "deploy_sha", None), log))
        log("wiring capture ON: shapes only (no values), registry %s" % (wiring_col.registry_desc,))
    phases = args.phases.split(",") if args.phases else READ_PHASES + (["write"] if args.allow_write else [])
    if premap and "sweep" not in phases:
        phases = phases + ["sweep"]
    if not args.no_auth and not has_session(cfg, reader_key):
        raise SystemExit("no saved session for %s (auth/%s.json). Run: walker.py login --account %s --headed  "
                         "(or use --no-auth for a signed-out smoke)" % (cfg["accounts"][reader_key]["username"], reader_key, reader_key))
    manifest = Manifest(rec.run_dir, rid, len(lenses))
    done_before = manifest.walked_slugs() if getattr(args, "resume", None) else set()
    if done_before:
        log("resume %s: %d lens(es) already walked, skipping them" % (rid, len(done_before)))
    expect = getattr(args, "expect_sha", None)
    run_deploy = deploy_stamp(cfg["base_url"], cfg["_walker_dir"], expect_sha=expect)
    log("build stamp: backend=%s frontend=%s walker=%s status=%s%s" % (
        (run_deploy["backend_sha"] or "NONE")[:12], run_deploy["frontend_build_id"], (run_deploy["walker_sha"] or "?")[:12],
        run_deploy["sha_status"], (" (%s)" % run_deploy["sha_note"]) if run_deploy["sha_note"] else ""))
    manifest.data["deploy"] = run_deploy
    # no-deploy guard: the build sha is polled at start and around every lens; a change mid-walk STOPS the sweep.
    from concord_walker import longwalk as _LW
    guard = _LW.DeployGuard(lambda: deploy_stamp(cfg["base_url"], None)["backend_sha"], log=log)
    g_ok, g_why = guard.start(prior_sha=manifest.prior_sha, known=run_deploy.get("backend_sha"))
    if not g_ok:
        append_text(os.path.join(rec.run_dir, "ABORTED.txt"), "%s %s: %s\n" % (human_et(), _LW.DEPLOY, g_why))
        manifest.finish("aborted", note="%s: %s" % (_LW.DEPLOY, g_why))
        log("WALK ABORTED run %s: %s: %s" % (rid, _LW.DEPLOY, g_why))
        raise WalkAborted(4)
    if guard.active and not manifest.prior_sha:
        manifest.data["build_sha"] = guard.sha
        manifest.save()
    log("run %s: %d lens(es), phases=%s, write=%s, dry=%s, premap=%s" % (rid, len(lenses), phases, args.allow_write, dry, premap))
    summary = []
    carryover = CarryoverQueue()  # ULW C7: every NOT_RUN check queues for a run-end revisit
    from concord_walker.runstate import LensBudget, ReplayBudget
    walk_budget = LensBudget(cfg["thresholds"]["lens_budget_s"])  # WALK-05 hook: one run-shared per-lens budget
    # replay's OWN per-lens budget (base + per_ticket x n_tickets, capped), on its own clock: never the sweep's spent time
    replay_budget = ReplayBudget.from_config(cfg, args)
    log("replay budget per lens: %s" % ("fixed %ss" % replay_budget.override_s if replay_budget.override_s is not None else
        "min(%ss cap, %ss base + %ss x tickets)" % (replay_budget.cap_s, replay_budget.base_s, replay_budget.per_ticket_s)))
    abort, abort_state, deploy_abort = None, None, False
    relaunches_left = int(getattr(args, "auto_resume", 2) or 0)
    replay = None
    if not no_replay:
        # sha gate: verdict rows are written only when /health's buildSha == --expect-sha; else dry.
        live = None
        if expect and sha_gate.is_hex_sha(expect):
            g = sha_gate.gate(expect, cfg["base_url"])
            log("sha gate: %s (live=%s via %s)" % (g["reason"], g["live"], g["source"]))
            live = g["live"] if g["ok"] else None
        else:
            log("replay verdicts will NOT be written: --expect-sha %r is missing/not a hex sha (replay still runs, dry)" % (expect,))
        from concord_walker.ledger import WalkerLedger
        ledger_path = (os.path.join(rec.run_dir, "ledger.jsonl") if shard else
                       os.path.join(cfg.get("records_dir") or os.path.join(cfg["_walker_dir"], "records"), "walker.jsonl"))
        ledger = WalkerLedger(ledger_path, dry=dry or live is None, expect_sha=expect)
    lock_name = shard_lock_name(shard[0], shard[1]) if shard else "run.lock"
    with RunLock(os.path.join(cfg.get("runs_dir") or cfg["_walker_dir"], lock_name)), sync_playwright() as pw:
        def launch():
            return pw.chromium.launch(channel="chrome", headless=True, args=["--disable-dev-shm-usage"])
        browser = launch()
        if not no_replay:
            rv = Reverifier(browser, cfg, rec, store, log, inv, allow_write=args.allow_write,
                            allow_write_own=getattr(args, "allow_write_own", False),
                            clone_permit=_clone_permit(args, cfg, log))
            replay = ReplayRun(rv, store, ledger, live_sha=live, run_id=rid, walker_version=run_deploy.get("walker_sha"),
                               run_dir=rec.run_dir, tester=cfg["tester_name"], log=log, budget=walk_budget, replay_budget=replay_budget)
        else:
            replay = ReplayRun(None, store, None, live_sha=None, run_id=rid, walker_version=None, run_dir=rec.run_dir,
                               tester=cfg["tester_name"], log=log, budget=walk_budget, no_replay=True, replay_budget=replay_budget)
        try:
            for lens in lenses:
                slug = lens["slug"]
                if slug in done_before:
                    continue
                if not wait_for_memory(cfg, log):
                    log("memory stayed low; stopping run before %s" % slug)
                    abort = (slug, "memory stayed low")
                    break
                acct, admin, lphases = (None if args.no_auth else reader_key), False, phases
                gate = False
                if slug in cfg["admin_lenses"]:
                    if args.admin and has_session(cfg, "admin") and not args.no_auth:
                        acct, admin = "admin", True
                        lphases = [p for p in phases if p != "write"]
                    else:
                        gate = True  # non-admin gate check: the gate holding is the PASS
                        lphases = ["reach"]
                # MST-W0-01: every record carries the build it ran against (re-read per lens:
                # a mid-run deploy shows as sha_status=drift, never silently as current)
                deploy = deploy_stamp(cfg["base_url"], cfg["_walker_dir"], expect_sha=expect, previous=run_deploy)
                if deploy["sha_status"] != "ok":
                    log("  build stamp %s: %s" % (deploy["sha_status"], deploy["sha_note"]))
                why = guard.check(slug, known=deploy.get("backend_sha"), phase="before")
                if why:
                    append_text(os.path.join(rec.run_dir, "ABORTED.txt"), "%s %s: %s %s\n" % (human_et(), slug, _LW.DEPLOY, why))
                    manifest.lens(slug, "aborted", reason="%s: %s" % (_LW.DEPLOY, why), deploy=deploy, state=_LW.DEPLOY)
                    abort, deploy_abort = (slug, "%s: %s" % (_LW.DEPLOY, why)), True
                    break
                lw, attempt = None, 0
                while True:
                    try:
                        lw = LensWalk(browser, cfg, rec, lens, acct, log, allow_write=args.allow_write, admin=admin,
                                      phases=lphases, inv_entry=lens, gate_check=gate, budget=walk_budget, deploy=deploy,
                                      premap=premap and not gate, capture_wiring=wiring_col is not None and not gate,
                                      premap_budget_s=getattr(args, "premap_budget_s", None),
                                      two_account=bool(getattr(args, "two_account", False)) and not gate and not admin)
                        res = lw.run()
                        break
                    except AccountMismatch as e:
                        log("ABORT: account check failed on %s: %s" % (slug, e))
                        append_text(os.path.join(rec.run_dir, "ABORTED.txt"), "%s %s: %s\n" % (human_et(), slug, e))
                        abort, abort_state = (slug, "account check failed: %s" % e), _LW.CRASHED
                        break
                    except Exception as e:
                        # WALKER-ISSUES auto-resume: a browser crash relaunches Chrome and retries the lens once
                        if _is_browser_crash(e) and relaunches_left > 0 and attempt == 0:
                            relaunches_left -= 1
                            attempt += 1
                            log("  browser crashed on %s (%s); relaunching and retrying once (%d relaunch(es) left)"
                                % (slug, type(e).__name__, relaunches_left))
                            try:
                                browser.close()
                            except Exception:
                                pass
                            browser = launch()
                            if replay is not None and replay.rv is not None:
                                replay.rv.b = browser
                            continue
                        log("ABORT: %s on %s: %s" % (type(e).__name__, slug, str(e)[:200]))
                        append_text(os.path.join(rec.run_dir, "ABORTED.txt"), "%s %s: %s %s\n" % (human_et(), slug, type(e).__name__, str(e)[:200]))
                        abort, abort_state = (slug, "%s: %s" % (type(e).__name__, str(e)[:120])), _LW.state_for_exception(e)
                        break
                if abort:
                    manifest.lens(slug, "aborted", reason=abort[1], deploy=deploy, state=abort_state or _LW.CRASHED)
                    break
                why = guard.check(slug, phase="after")
                if why:
                    # a lens that straddled a deploy mixes two builds: DISCARD it (no tickets filed, no record, not "walked")
                    log("DEPLOY_DETECTED: %s; discarding the %s result" % (why, slug))
                    append_text(os.path.join(rec.run_dir, "ABORTED.txt"), "%s %s: %s %s (lens result discarded)\n" % (human_et(), slug, _LW.DEPLOY, why))
                    manifest.lens(slug, "aborted", reason="%s: %s (result discarded)" % (_LW.DEPLOY, why), deploy=deploy, state=_LW.DEPLOY)
                    abort, deploy_abort = (slug, "%s: %s" % (_LW.DEPLOY, why)), True
                    break
                filed = []
                new, dups = file_findings(store, rec, lw.findings, dry, log, cfg["tester_name"], filed=filed)
                res["new_tickets"] = [t["id"] for t in new]
                res["duplicates"] = [{"title": f["title"], "dup_of": d} for f, d in dups]
                # replay the original tickets for this lens on the SAME walk (no second walk)
                res["replay"] = replay.replay_lens(slug, lw, admin_gate=gate)
                net_out = lw.net.build()
                prior_rec = None
                _prior_path = lens_result_path(rec.run_dir, slug)
                if os.path.exists(_prior_path):
                    try:
                        prior_rec = load_lens_record(_prior_path)
                    except Exception:
                        prior_rec = None
                upgrade_record(res, deploy, filed, all_slugs, lw.screens, net_out, premap_findings=lw.premap_findings,
                               prior=prior_rec)
                if wiring_col is not None and not gate:
                    wiring_col.add(slug, net_out[0], deploy.get("backend_sha"), {c: m.get("label_data") for c, m in lw.net.meta.items() if m.get("label_data")})
                res["state"] = _LW.lens_state(res, gate=gate)
                with open(lens_result_path(rec.run_dir, slug), "w") as f:
                    json.dump(res, f, indent=1)
                manifest.lens(slug, "walked", reason="gate check (reach only)" if gate else None,
                              checks_not_run=checks_not_run(res), deploy=deploy, state=res["state"])
                summary.append(res)
                carryover.add_from_result(res)
                write_root_causes(cfg["audit_dir"], log=log)
            # ULW C7: run-end revisit — every queued NOT_RUN check gets ONE
            # fresh single-phase walk; what is still NOT_RUN stays queued
            # with its outcome recorded in carryover.json. Never dropped.
            if carryover.pending() and not abort:
                log("carry-over: %d NOT_RUN check(s) queued; revisiting once at run end" % len(carryover.pending()))
                _phase_for = {"create_delete": "write", "mobile_390": "mobile"}
                _revisitable = ("reach", "surface", "tabs", "keyboard", "openers", "export", "contrast", "mobile", "write", "sweep")

                def _revisit(it):
                    ph = _phase_for.get(it["check"], it["check"])
                    if ph not in _revisitable:
                        return ("NOT_RUN", "no phase mapping for check %r; stays queued" % it["check"])
                    if it["slug"] in cfg["admin_lenses"]:
                        return ("NOT_RUN", "admin/gate lens: not revisited in this pass")
                    lens = next((l for l in lenses if l["slug"] == it["slug"]), None)
                    if lens is None:
                        return ("NOT_RUN", "lens not in this run")
                    lw2 = LensWalk(browser, cfg, rec, lens, None if args.no_auth else "t1", log,
                                   allow_write=args.allow_write, phases=[ph], inv_entry=lens,
                                   budget=walk_budget, deploy=run_deploy)
                    r2 = lw2.run()
                    d = (r2.get("checks") or {}).get(it["check"]) or {}
                    return (d.get("status", "NOT_RUN"), d.get("reason"))

                carryover.drain(_revisit)
                carryover.write(rec.run_dir)
                log("carry-over: %d check(s) still NOT_RUN after revisit (see carryover.json)" % len(carryover.remaining()))
        finally:
            try:
                browser.close()
            except Exception:
                pass
            left = rec.flush_leftovers()
            if wiring_col is not None:
                try:
                    log("wiring capture: wrote %s" % (wiring_col.flush(),))
                except Exception as e:  # capture must never break a walk
                    log("wiring capture FAILED to write: %s: %s" % (type(e).__name__, str(e)[:160]))
            write_summary(rec, summary, left, dry, manifest)
            write_root_causes(cfg["audit_dir"], log=log)
            if replay is not None:
                _inv_slugs = {l.get("slug") for l in inv}
                _rows = replay.coverage_rows(_inv_slugs, manifest.walked_slugs() - done_before, resumed=done_before)
                _dirs = [rec.run_dir] + ([] if dry else [cfg["audit_dir"]])
                cov.write(_dirs, _rows, {"run_id": rid, "live_sha": replay.live_sha, "dry": dry or (replay.ledger is None or replay.ledger.dry),
                                         "ts": human_et(), "no_replay": no_replay})
                _s = cov.summarize(_rows)
                log("replay coverage: %d row(s) %s -> %s" % (_s["total"], _s["by_verdict"], ", ".join(_dirs)))
                if replay.ledger is not None:
                    log("replay ledger: %d row(s) written, %d suppressed (dry/sha gate)" % (replay.ledger.written, replay.ledger.suppressed))
    walked, total = manifest.counts()
    if abort:
        manifest.finish("aborted", note="aborted at %s: %s" % abort)
        log("WALK ABORTED run %s at %s: walked %d/%d lenses (%s). Resume: walker.py sweep --resume %s"
            % (rid, abort[0], walked, total, abort[1], rid))
        if deploy_abort:
            log("DEPLOY_DETECTED: the build changed mid-walk; --resume is refused unless /health reports the original build again")
            raise WalkAborted(4)
        raise WalkAborted(3)
    manifest.finish("done")
    log("WALK DONE run %s: walked %d/%d lenses: %s" % (rid, walked, total, rec.run_dir))


def write_summary(rec, summary, left, dry, manifest=None):
    lines = ["# Lens walker run %s\n" % rec.rid, "Finished %s. %s\n\n" % (human_et(), "DRY-RUN (no tickets filed)" if dry else ""),
             "| lens | state | account | checks (status) | new tickets | dups | s |\n|---|---|---|---|---|---|---|\n"]
    for r in summary:
        cs = ", ".join("%s:%s" % (k, v.get("status")) for k, v in r["checks"].items())
        lines.append("| %s | %s | %s | %s | %s | %d | %s |\n" % (r["slug"], r.get("state") or "-", r["account"], cs, ", ".join(r.get("new_tickets", [])) or "-",
                                                         len(r.get("duplicates", [])), r.get("elapsed_s")))
    if manifest is not None:
        by = {}
        for l in manifest.data["lenses"]:
            by[l.get("state") or l["status"]] = by.get(l.get("state") or l["status"], 0) + 1
        lines.append("\nPer-lens states: %s\n" % (", ".join("%s=%d" % kv for kv in sorted(by.items())) or "none"))
        for l in manifest.data["lenses"]:
            if l["status"] == "aborted":
                lines.append("- %s: %s - %s\n" % (l["slug"], l.get("state") or "ABORTED", l.get("reason")))
    try:
        from concord_walker import isolation as _iso
        _counts = _iso.summarize([r.get("isolation") for r in summary])
        lines.append("\n%s\n" % _iso.summary_line(_counts))
    except Exception:
        pass
    lines.append("\nLeftover fixtures: %s\n" % (", ".join(f["label"] for f in left) if left else "none"))
    with open(os.path.join(rec.run_dir, "SUMMARY.md"), "w") as f:
        f.write("".join(lines))


def cmd_reverify(args, cfg, log):
    from concord_walker.sha_gate import is_hex_sha as _is_hex
    if getattr(args, "expect_sha", None) and not _is_hex(args.expect_sha):
        raise SystemExit("--expect-sha %r is not a hex git sha (>=7 chars)" % args.expect_sha)
    if args.apply_status and not getattr(args, "expect_sha", None):
        raise SystemExit("--apply-status needs --expect-sha <git sha>: status rows are written only when /health's buildSha matches it")
    from playwright.sync_api import sync_playwright
    from concord_walker import sha_gate
    from concord_walker.ledger import WalkerLedger
    from concord_walker.runstate import Journal, Heartbeat, LensBudget
    from concord_walker.crashretry import run_with_relaunch, CrashExhausted
    from concord_walker import results as results_mod
    inv = load_inventory(cfg)
    rid = args.resume if getattr(args, "resume", None) else run_id() + "-reverify"
    # WALK-01 sha gate: a mismatch (or an unreadable live sha) forces the run dry —
    # it continues and reports, but writes 0 status rows anywhere.
    gate_dry = False
    live = None
    if getattr(args, "expect_sha", None):
        if not sha_gate.is_hex_sha(args.expect_sha):
            raise SystemExit("--expect-sha %r is not a hex git sha (>=7 chars)" % args.expect_sha)
        g = sha_gate.gate(args.expect_sha, cfg["base_url"])
        log("sha gate: %s (live=%s via %s; frontend_build=%s)" % (g["reason"], g["live"], g["source"], g["frontend_build"]))
        if g["ok"]:
            live = g["live"]
        else:
            gate_dry = True
    dry = args.dry_run or gate_dry
    rec = RunRecorder(cfg, rid, dry=dry)
    log.path = os.path.join(rec.run_dir, "walker.log")
    # WALK-01 ingest: the fold at the pinned deploy sha when --from-repo is given;
    # the legacy single-file read otherwise.
    fold = None
    if getattr(args, "from_repo", None):
        from concord_walker.fold import extract_from_git
        if not getattr(args, "deploy_sha", None):
            raise SystemExit("--from-repo needs --deploy-sha (the fold is read at a pinned sha)")
        fold = extract_from_git(args.from_repo, args.deploy_sha)
        log("fold @ %s: %s" % (args.deploy_sha, fold.counts()))
        with open(os.path.join(rec.run_dir, "canonical.jsonl"), "w") as f:
            f.write(fold.canonical_text())
    store = TicketStore(cfg["audit_dir"], fold=fold)
    ledger = WalkerLedger(os.path.join(cfg.get("records_dir") or os.path.join(cfg["_walker_dir"], "records"),
                                       "walker.jsonl"), dry=dry, expect_sha=getattr(args, "expect_sha", None))
    if not has_session(cfg, "t1"):
        raise SystemExit("no saved session for %s; run walker.py login --account t1 --headed first" % cfg["accounts"]["t1"]["username"])
    ids = list(args.ids)
    if args.from_status:
        # comma list allowed, e.g. FIXED_PENDING_VERIFY,OPEN (the coverage scope)
        _st = {x.strip().upper() for x in args.from_status.split(",") if x.strip()}
        ids += [i for i in store.base if store.status(i) in _st]
    ids = list(dict.fromkeys(ids))
    # Coverage table (Dutch, Nov 15): every in-scope FIXED_PENDING_VERIFY/OPEN
    # ticket gets one row with a reason. Tickets that are not replayed are
    # decided here, before the loop, so they never sit pending silently.
    from concord_walker import coverage as cov
    scope = [(i, store.get(i)) for i in ids]
    cov_results, cov_skip = {}, {}
    walked = None
    if getattr(args, "walked_run", None):
        rdirs = []
        for w in args.walked_run:
            for part in [x.strip() for x in w.split(",") if x.strip()]:
                rdirs.append(part if os.path.isdir(part) else os.path.join(cfg.get("runs_dir") or os.path.join(cfg["_walker_dir"], "runs"), part))
        walked = cov.walked_lenses(rdirs)
        log("walked-run: %d lens(es) walked in %s" % (len(walked), rdirs))
    only_lens = set(x.strip() for x in (getattr(args, "only_lens", None) or "").split(",") if x.strip())
    inv_slugs = {l.get("slug") for l in inv}
    keep = []
    for i, t in scope:
        if t is None:
            keep.append(i)  # unknown id: Reverifier reports it; no coverage row (not in scope)
            continue
        lens = t.get("lens")
        ci = store.lane(i) == "ci"
        if only_lens and lens not in only_lens:
            cov_skip[i] = cov.R_FILTER + " (--only-lens)"
        elif not ci and lens not in inv_slugs:
            cov_skip[i] = cov.R_NOT_IN_INV + (" (%s)" % lens if lens else " (ticket has no lens)")
        elif walked is not None and not ci and lens not in walked:
            cov_skip[i] = cov.R_NOT_WALKED + " (%s)" % lens
        else:
            keep.append(i)
    ids = keep
    if cov_skip:
        log("coverage: %d ticket(s) not replayed (filter / inventory / not walked)" % len(cov_skip))
    # WALK-05: the run journal + heartbeat. On --resume the journal already holds
    # the prior attempt's lines; finished ids (done|skipped) are never re-run.
    journal = Journal(rec.run_dir)
    heartbeat = Heartbeat(rec.run_dir)
    if getattr(args, "resume", None):
        before = len(ids)
        _all = ids
        ids = journal.remaining(ids)
        for _i in _all:
            if _i not in ids:
                cov_skip.setdefault(_i, cov.R_RESUMED)
        log("resume %s: %d id(s) finished in the journal, %d remaining" % (args.resume, before - len(ids), len(ids)))
    budget = LensBudget(getattr(args, "lens_budget_s", None) or cfg.get("thresholds", {}).get("lens_budget_s", 900))
    results = []
    with RunLock(os.path.join(cfg.get("runs_dir") or cfg["_walker_dir"], "run.lock")), sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True, args=["--disable-dev-shm-usage"])
        try:
            rv = Reverifier(browser, cfg, rec, store, log, inv, allow_write=args.allow_write,
                            allow_write_own=getattr(args, "allow_write_own", False),
                            clone_permit=_clone_permit(args, cfg, log))
            # MST-W0-01: every verdict says which build it ran against and whether that
            # build contains the ticket's fix commit (git merge-base --is-ancestor; 'unknown' otherwise)
            from concord_walker.lensrecord import deploy_stamp, build_verdict, contains_commit
            rv_deploy = deploy_stamp(cfg["base_url"], cfg["_walker_dir"], expect_sha=getattr(args, "expect_sha", None))
            fix_map = dict(x.split("=", 1) for x in (getattr(args, "fix_commit", None) or []) if "=" in x)
            contain_repo = getattr(args, "containment_repo", None) or getattr(args, "from_repo", None)
            log("build stamp: %s (%s)" % ((rv_deploy["backend_sha"] or "NONE")[:12], rv_deploy["sha_status"]))
            for n_done, tid in enumerate(ids):
                if not wait_for_memory(cfg, log):
                    for rest in ids[n_done:]:
                        cov_skip.setdefault(rest, cov.R_LOW_MEM)
                    break
                heartbeat.beat("reverify %s" % tid)
                _lens = (store.get(tid) or {}).get("lens")
                if _lens:
                    budget.start(_lens)
                    if budget.over(_lens):
                        journal.record("reverify", tid, "failed", "time_budget: lens %s over %ds" % (_lens, budget.budget_s))
                        cov_skip[tid] = cov.R_BUDGET + " (%s over %ds)" % (_lens, budget.budget_s)
                        log("  => %s skipped: lens %s over its time budget" % (tid, _lens))
                        continue
                if store.lane(tid) == "ci":
                    # WALK-01 routing: non-lens code tickets verify via the WALK-06
                    # CI-evidence lane at the deploy sha — never walked as lens None.
                    res = {"id": tid, "verdict": "CI_LANE", "method": "ci-evidence",
                           "notes": "non-lens code ticket; routed to the WALK-06 CI lane"}
                    results.append(res)
                    journal.record("reverify", tid, "skipped", "ci-lane (WALK-06)")
                    cov_skip[tid] = cov.R_CI
                    log("  => %s CI_LANE (WALK-06)" % tid)
                    with open(os.path.join(rec.run_dir, "reverify.jsonl"), "a") as f:
                        f.write(json.dumps(res) + "\n")
                    continue
                def _relaunch():
                    nonlocal browser
                    try:
                        browser.close()
                    except Exception:
                        pass
                    browser = pw.chromium.launch(channel="chrome", headless=True, args=["--disable-dev-shm-usage"])
                    rv.b = browser

                try:
                    # ULW C9: a browser crash relaunches and re-runs THIS
                    # ticket; only a second crash fails the ticket (alone).
                    res, _relaunched = run_with_relaunch(tid, lambda: rv.run(tid), _relaunch,
                                                         _is_browser_crash, max_relaunches=1, log=log)
                    if _relaunched:
                        journal.record("reverify", tid, "relaunched", "browser crash; relaunched and re-ran")
                    _t = store.get(tid) or {}
                    _fix = fix_map.get(tid) or _t.get("fix_sha") or _t.get("fix_commit") or _t.get("merged_sha")
                    res["build"] = {"backend_sha": rv_deploy["backend_sha"], "sha_status": rv_deploy["sha_status"],
                                    "walked_at": rv_deploy["walked_at"], "fix_commit": _fix,
                                    "contains_fix": contains_commit(contain_repo, rv_deploy["backend_sha"], _fix) if _fix else "unknown",
                                    "line": build_verdict(contain_repo, rv_deploy, _fix)}
                    journal.record("reverify", tid, "done", res["verdict"])
                except CrashExhausted as ce:
                    # ULW C9: the ticket crashed again after its relaunch —
                    # it fails ALONE; the run continues with the next ticket.
                    journal.record("reverify", tid, "failed", "browser crash after relaunch: %s" % ce.last_error)
                    cov_skip[tid] = "crashed: browser crash after relaunch (%s)" % type(ce.last_error).__name__
                    log("  => %s CRASHED after relaunch; continuing with the next ticket" % tid)
                    continue
                except AccountMismatch as e:
                    journal.record("reverify", tid, "failed", "account mismatch: %s" % e)
                    log("ABORT: account check failed during %s: %s" % (tid, e))
                    cov_skip[tid] = "aborted: account mismatch (%s)" % str(e)[:120]
                    for rest in ids[n_done + 1:]:
                        cov_skip.setdefault(rest, cov.R_ABORT + " (account mismatch)")
                    break
                except Exception as e:
                    journal.record("reverify", tid, "failed", "%s: %s" % (type(e).__name__, e))
                    cov_skip[tid] = "aborted: %s: %s" % (type(e).__name__, str(e)[:120])
                    for rest in ids[n_done + 1:]:
                        cov_skip.setdefault(rest, cov.R_ABORT + " (%s)" % type(e).__name__)
                    raise
                results.append(res)
                cov_results[tid] = res
                log("  => %s %s (%s)" % (tid, res["verdict"], res.get("notes", "")[:140]))
                with open(os.path.join(rec.run_dir, "reverify.jsonl"), "a") as f:
                    f.write(json.dumps(res) + "\n")
                if args.apply_status:
                    upd = status_update(store, res, cfg["tester_name"])
                    if upd:
                        # WALK-01: verdicts land ONLY in records/walker.jsonl (union
                        # schema); fix_tickets.jsonl is never written by a verdict.
                        acct = "admin" if res.get("lens") in cfg.get("admin_lenses", []) else "t1"
                        row = ledger.write_verdict(res, upd, live_sha=live, run_id=rid, account=acct,
                                                   walker_version=rv_deploy.get("walker_sha"))
                        log("  ledger %s -> %s%s" % (tid, upd["status"], " (dry: not written)" if dry else ""))
                    elif res["verdict"] == "FIXED":
                        rec.judgment(res["lens"], "fixed_not_claimed", "%s no longer reproduces but no builder marked it FIXED_PENDING_VERIFY; close?" % tid,
                                     res.get("evidence"), ticket_id=tid)
            # smoke findings from the lenses walked
            for (lens, _w), lw in rv.walks.items():
                file_findings(store, rec, lw.findings, dry, log, cfg["tester_name"])
        finally:
            browser.close()
            rec.flush_leftovers()
            # Coverage table: always in the run dir; the shared audit copy only
            # when the run is not dry (same rule as tickets/queue).
            cov_rows = cov.build_rows(scope, cov_results, cov_skip)
            cov_dirs = [rec.run_dir] + ([] if dry else [cfg["audit_dir"]])
            cov.write(cov_dirs, cov_rows, {"run_id": rid, "live_sha": live, "dry": dry, "ts": human_et(),
                                           "walked_runs": getattr(args, "walked_run", None), "only_lens": sorted(only_lens)})
            _s = cov.summarize(cov_rows)
            log("coverage: %d row(s) %s -> %s" % (_s["total"], _s["by_verdict"], ", ".join(cov_dirs)))
    log("ledger: %d verdict row(s) written, %d suppressed (dry)" % (ledger.written, ledger.suppressed))
    # WALK-05: per-run RESULTS (md + csv) with the live sha stamped on every row.
    results_mod.write_results(rec.run_dir, results_mod.build_rows(rec.run_dir, live_sha=live or "unverified"), rid)
    with open(os.path.join(rec.run_dir, "REVERIFY.md"), "w") as f:
        f.write("# Re-verify %s (%s)\n\n| ticket | lens | prior | verdict | method | notes |\n|---|---|---|---|---|---|\n" % (rid, human_et()))
        for r in results:
            f.write("| %s | %s | %s | %s | %s | %s |\n" % (r["id"], r.get("lens"), r.get("prior_status"), r["verdict"], r.get("method"),
                                                     (r.get("notes") or "").replace("|", "/")[:200]))
    log("reverify done: %s" % rec.run_dir)


def cmd_reverify_ci(args, cfg, log):
    """WALK-06: the --from-ci lane — non-lens code tickets verified by CI + code
    evidence at the deploy sha. Offline by design: no browser, no session."""
    from concord_walker import ci_verify
    from concord_walker.fold import extract_from_git
    from concord_walker.ledger import WalkerLedger
    if not args.from_repo or not args.deploy_sha:
        raise SystemExit("--from-ci needs --from-repo <clone> --deploy-sha <sha> (fold + code evidence read at the pinned sha)")
    if not args.expect_sha:
        raise SystemExit("--from-ci needs --expect-sha <sha> (the CI payload must be for exactly this sha)")
    from concord_walker import sha_gate
    if not sha_gate.is_hex_sha(args.expect_sha) or not sha_gate.is_hex_sha(args.deploy_sha):
        raise SystemExit("--expect-sha and --deploy-sha must be hex git shas (>=7 chars)")
    if args.expect_sha != args.deploy_sha:
        raise SystemExit("--expect-sha must equal --deploy-sha for --from-ci (fold, code evidence and CI payload pin to one sha)")
    try:
        checks = ci_verify.load_checks(args.ci_checks)
    except ci_verify.CiError as e:
        raise SystemExit(str(e))
    fold = extract_from_git(args.from_repo, args.deploy_sha)
    log("fold @ %s: %s" % (args.deploy_sha, fold.counts()))
    store = TicketStore(cfg["audit_dir"], fold=fold)
    rid = run_id() + "-from-ci"
    rec = RunRecorder(cfg, rid, dry=args.dry_run)
    log.path = os.path.join(rec.run_dir, "walker.log")
    with open(os.path.join(rec.run_dir, "canonical.jsonl"), "w") as f:
        f.write(fold.canonical_text())
    ledger = WalkerLedger(os.path.join(cfg.get("records_dir") or os.path.join(cfg["_walker_dir"], "records"),
                                       "walker.jsonl"), dry=args.dry_run, expect_sha=args.expect_sha)
    ids = list(args.ids)
    if args.from_status:
        _st = {x.strip().upper() for x in args.from_status.split(",") if x.strip()}
        ids += [i for i in store.base if store.status(i) in _st]
    if not ids:
        ids = fold.ci_ids()
    results = ci_verify.run_ci_lane(store=store, repo=args.from_repo, deploy_sha=args.deploy_sha,
                                    expect_sha=args.expect_sha, checks=checks, ids=ids,
                                    ledger=ledger, run_id_str=rid)
    with open(os.path.join(rec.run_dir, "reverify.jsonl"), "w") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")
    with open(os.path.join(rec.run_dir, "REVERIFY.md"), "w") as f:
        f.write("# Re-verify (CI lane) %s (%s)\n\n| ticket | prior | verdict | reason |\n|---|---|---|---|\n" % (rid, human_et()))
        for r in results:
            f.write("| %s | %s | %s | %s |\n" % (r["id"], r.get("prior_status") or "-", r["verdict"],
                                                  (r.get("reason") or "").replace("|", "/")[:200]))
    n_ok = sum(1 for r in results if r["verdict"] == "VERIFIED")
    log("from-ci done: %d VERIFIED, %d unmoved/routed of %d; ledger %d written, %d suppressed (dry); run %s"
        % (n_ok, len(results) - n_ok, len(results), ledger.written, ledger.suppressed, rec.run_dir))
    return results


def cmd_preflight(args, cfg, log):
    """ULW C8: verify sessions + write-lane labelling, publish the write-skip
    list and the create/delete coverage number — before lens 1. The JSON
    report is written under the audit dir either way; exit 1 on problems."""
    from concord_walker import preflight as _pf
    inv_path = os.path.join(cfg["_walker_dir"], "inventory.json")
    inventory = json.load(open(inv_path)) if os.path.exists(inv_path) else []
    browser = None
    pw = None
    if not args.no_live:
        from playwright.sync_api import sync_playwright
        pw = sync_playwright().start()
        browser = pw.chromium.launch(channel="chrome", headless=True)
    try:
        report = _pf.run_preflight(cfg, inventory, browser=browser, log=log)
    finally:
        if browser is not None:
            browser.close()
        if pw is not None:
            pw.stop()
    report["checked_at"] = human_et()
    report["base_url"] = cfg["base_url"]
    out_dir = os.path.join(cfg["_walker_dir"], cfg.get("audit_dir", "audit"))
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "preflight-latest.json")
    with open(out_path, "w") as f:
        json.dump(report, f, indent=1, sort_keys=True)
    print(json.dumps({k: report[k] for k in ("ok", "problems", "coverage", "write_skip_lenses") if k in report}, indent=1))
    log("preflight report -> %s (ok=%s, %d problem(s))" % (out_path, report["ok"], len(report["problems"])))
    if not report["ok"]:
        raise SystemExit("preflight FAILED: " + "; ".join(report["problems"]))


def cmd_whoami(args, cfg, log):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome", headless=True)
        ctx = new_context(b, cfg, args.account if has_session(cfg, args.account) else None, (800, 600))
        me = whoami(ctx, cfg["base_url"])
        print(json.dumps({"account": args.account, "session_file": has_session(cfg, args.account), **me}))
        b.close()


def cmd_merge_runs(args, cfg, log):
    """ULW C14 (machinery only): merge two instances' record files by
    ticket ID with a conflict report. Activation of a second instance is
    not this command's act; a lens overlap is reported, not hidden."""
    from concord_walker.merge import merge_files
    la = [x.strip() for x in (args.lenses_a or "").split(",") if x.strip()]
    lb = [x.strip() for x in (args.lenses_b or "").split(",") if x.strip()]
    report = merge_files(args.a, args.b, args.out, args.report, lenses_a=la, lenses_b=lb)
    log("merge: %s -> %s (report %s)" % (report["stats"], args.out, args.report))
    if report["lens_overlap"]:
        log("merge: LENS OVERLAP %s — a second instance on these lenses is NOT activatable (Gate s.6)" % report["lens_overlap"])
    if report["conflicts"]:
        log("merge: %d conflict(s); contested ids are EXCLUDED from %s and listed in %s"
            % (len(report["conflicts"]), args.out, args.report))


def cmd_merge_shards(args, cfg, log):
    """ULW v3 W3: fold shard run dirs into one manifest + one ledger
    (walker.jsonl + walk-manifest.json + merge-report.json under --out).
    Lens overlap across shards is reported and blocks activation."""
    from concord_walker.shard import merge_shards
    runs = []
    for item in (args.runs or "").split(","):
        item = item.strip()
        if not item:
            continue
        if not os.path.isdir(item):
            cand = os.path.join(cfg.get("runs_dir") or os.path.join(cfg["_walker_dir"], "runs"), item)
            if os.path.isdir(cand):
                item = cand
        runs.append(item)
    if len(runs) < 2:
        raise SystemExit("merge-shards needs at least two shard run dirs (or run ids under runs_dir)")
    report = merge_shards(runs, args.out)
    log("merge-shards: %s -> %s" % (report["stats"], args.out))
    if report["lens_overlap"]:
        log("merge-shards: LENS OVERLAP %s — the shard partition was not disjoint; activation blocked" % report["lens_overlap"])
    if report["conflicts"]:
        log("merge-shards: %d conflict(s); contested ids are EXCLUDED from the merged ledger and listed in merge-report.json" % len(report["conflicts"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def walk_opts(p):
        p.add_argument("--allow-write", action="store_true", help="create+delete ONE own labelled fixture per lens (never admin/write-skip lenses)")
        p.add_argument("--allow-write-own", action="store_true", help="ULW C38: on write-skip lenses, replay write rows as t2 against t2's OWN labelled fixtures (WRITE-OWN profiles)")
        p.add_argument("--clone-legs", action="store_true", help="ULW C42: run money-row verification legs against the SB-38 DB clone (permit-gated; aborts if the clone identity cannot be verified)")
        p.add_argument("--admin", action="store_true", help="walk the admin lenses with the admin account (look-only) if auth/admin.json exists")
        p.add_argument("--dry-run", action="store_true", help="don't append tickets / queue / leftovers to the shared audit files")
        p.add_argument("--no-auth", action="store_true", help="signed-out smoke (implies --dry-run)")
        p.add_argument("--phases", help="comma list from: " + ",".join(READ_PHASES + ["write"]))
        p.add_argument("--base-url", help="override base url (selftest only)")
        p.add_argument("--capture-wiring", action="store_true", help="record per-lens CONTROL->ENDPOINT->HANDLER wiring (request/response SHAPES only, values never stored) + a live labels index under <run>/wiring/. Off by default (the v4 walk passes it)")
        p.add_argument("--wiring-registry", help="actions-<sha>.json.gz from tools/action_registry.py at the fold sha (default: built from --from-repo at --deploy-sha when given; else joins are 'unresolved:no_registry')")
        p.add_argument("--premap", action="store_true", help="MST-W0-03: add the control sweep (every named control: clicked once if sweep-safe, else a reason)")
        p.add_argument("--premap-budget-s", type=int, help="MST-W0-03: sweep budget per lens in seconds (default thresholds.premap_budget_s, else 600)")
        p.add_argument("--replay-budget-s", type=int, help="replay of original tickets: a FIXED per-lens budget in seconds on replay's own clock "
                       "(default: min(cap, base + per_ticket x n_tickets) = 60 + 25 x n, cap 900; thresholds.replay_budget_s in config)")
        p.add_argument("--replay-budget-base-s", type=int, help="replay budget base seconds (default 60)")
        p.add_argument("--replay-budget-per-ticket-s", type=int, help="replay budget seconds per ticket (default 25)")
        p.add_argument("--replay-budget-cap-s", type=int, help="replay budget cap seconds per lens (default 900)")
        p.add_argument("--expect-sha", help="MST-W0-01: flag every record whose /health buildSha differs (sha_status=mismatch); never gates a read walk")
        p.add_argument("--two-account", action="store_true", help="upgrade 3: replay t1's object calls (reads + non-DELETE writes) as t2 from its saved session; 2xx = ownership finding. Needs auth/t2.json; never deletes")
        p.add_argument("--resume", help="resume this run id: lenses already walked in its walk-manifest.json are skipped")
        p.add_argument("--from-repo", help="replay: read the ticket fold from this repo checkout at --deploy-sha (REQUIRED for a live sweep unless --no-replay)")
        p.add_argument("--deploy-sha", help="replay: the pinned sha the fold is read at (with --from-repo)")
        p.add_argument("--no-replay", action="store_true", help="sweep WITHOUT replaying the original lens-walk tickets (logged loudly; every ticket gets a 'replay disabled' coverage row)")
        p.add_argument("--auto-resume", type=int, default=2, help="browser crash relaunches per run (each retries the crashed lens once; default 2)")
        p.add_argument("--shard", help="ULW v3 W3: walk shard i of N ('i/N', 0-based i) of the inventory's stable partition; per-shard run dir, run lock, ledger and account pair (cfg shard_accounts). Merge afterwards with merge-shards")

    p = sub.add_parser("sweep", help="walk every lens in inventory.json (or a filtered subset)")
    walk_opts(p)
    p.add_argument("--only", help="comma list of slugs")
    p.add_argument("--category")
    p.add_argument("--start-from", help="resume from this slug")
    p.add_argument("--limit", type=int)
    p = sub.add_parser("lens", help="walk one lens")
    p.add_argument("slug")
    walk_opts(p)
    p = sub.add_parser("reverify", help="replay tickets by id")
    p.add_argument("ids", nargs="*")
    p.add_argument("--from-status", help="also take every ticket currently in this status (comma list ok), e.g. FIXED_PENDING_VERIFY or FIXED_PENDING_VERIFY,OPEN")
    p.add_argument("--from-repo", help="WALK-01: read the ticket fold from this repo clone at --deploy-sha (fix_tickets.jsonl + records/*.jsonl)")
    p.add_argument("--deploy-sha", help="WALK-01: the pinned sha the fold is read at (with --from-repo)")
    p.add_argument("--expect-sha", help="WALK-01: sha gate — hex git sha; REQUIRED with --apply-status. Rows are written only if /health buildSha matches; anything else runs dry")
    p.add_argument("--from-ci", action="store_true", help="WALK-06: verify non-lens code tickets by CI + code evidence at the deploy sha (offline; no browser, no session)")
    p.add_argument("--ci-checks", help="WALK-06: CI checks payload for the expect sha: {sha, runs[{name, status, conclusion, html_url}]}")
    p.add_argument("--resume", help="WALK-05: resume this run id — ids finished in its journal (done|skipped) are not re-run")
    p.add_argument("--lens-budget-s", type=int, help="WALK-05: per-lens time budget in seconds (default from config thresholds, else 900)")
    p.add_argument("--allow-write", action="store_true")
    p.add_argument("--allow-write-own", action="store_true", help="ULW C38: WRITE-OWN profiles for write rows on write-skip lenses (t2, own fixtures only)")
    p.add_argument("--clone-legs", action="store_true", help="ULW C42: money-row verification legs on the SB-38 DB clone (permit-gated)")
    p.add_argument("--walked-run", action="append", help="coverage: run dir (or run id under runs_dir) of the sweep(s) this reverify grades; repeatable / comma list. Tickets on lenses with no lens-*.json there are NOT_ATTEMPTED 'lens not walked this run' and are not replayed")
    p.add_argument("--only-lens", help="coverage: comma list of lens slugs to replay; other in-scope tickets are NOT_ATTEMPTED 'excluded by filter'")
    p.add_argument("--apply-status", action="store_true", help="write verdict rows (VERIFIED/REOPENED/OPEN) to records/walker.jsonl")
    p.add_argument("--fix-commit", action="append", help="MST-W0-01: TICKET=SHA (repeatable): say whether the live build contains that fix commit")
    p.add_argument("--containment-repo", help="MST-W0-01: git checkout used for merge-base --is-ancestor (defaults to --from-repo); without one the answer is 'unknown'")
    p.add_argument("--dry-run", action="store_true")
    p = sub.add_parser("merge-shards", help="ULW v3 W3: fold shard run dirs into one manifest + one ledger (per-shard ledger.jsonl + walk-manifest.json)")
    p.add_argument("--runs", required=True, help="comma list of shard run dirs (or run ids under runs_dir)")
    p.add_argument("--out", required=True, help="output dir for walker.jsonl + walk-manifest.json + merge-report.json")
    p = sub.add_parser("merge-runs", help="ULW C14: merge two walker instances' record files by ticket ID, with a conflict report (machinery only)")
    p.add_argument("--a", required=True, help="first instance's records file (walker.jsonl / human.jsonl union schema)")
    p.add_argument("--b", required=True, help="second instance's records file")
    p.add_argument("--out", required=True, help="merged records output path")
    p.add_argument("--report", required=True, help="conflict report output path (JSON)")
    p.add_argument("--lenses-a", help="comma list of lenses instance A walked (disjointness check)")
    p.add_argument("--lenses-b", help="comma list of lenses instance B walked (disjointness check)")
    p = sub.add_parser("preflight", help="ULW C8: verify sessions + write-lane labelling, publish write-skip list + create/delete coverage (before lens 1)")
    p.add_argument("--no-live", action="store_true", help="config/filesystem legs only (no browser session assertions)")
    p = sub.add_parser("login", help="save a session for a QA account")
    p.add_argument("--account", required=True, help="any account key in config (t1, t2, admin, tw, ...)")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--headed", action="store_true")
    g.add_argument("--secrets-file", action="store_true")
    p.add_argument("--login-timeout", type=int, default=600, help="seconds to wait for /api/auth/me to show a session after submit (default 600)")
    p = sub.add_parser("whoami", help="GET /api/auth/me with a saved session")
    p.add_argument("--account", default="t1", help="any account key in config")
    args = ap.parse_args()
    cfg = load_config(args.config)
    if getattr(args, "base_url", None):
        cfg["base_url"] = args.base_url
    log = Log()
    if args.cmd == "lens":
        args.only, args.category, args.start_from, args.limit = args.slug, None, None, None
        cmd_walk(args, cfg, log)
    elif args.cmd == "sweep":
        cmd_walk(args, cfg, log)
    elif args.cmd == "reverify":
        if getattr(args, "from_ci", False):
            cmd_reverify_ci(args, cfg, log)
        elif not args.ids and not args.from_status:
            raise SystemExit("give ticket ids (e.g. FIX-007 FIX-deities-002) or --from-status FIXED_PENDING_VERIFY")
        else:
            cmd_reverify(args, cfg, log)
    elif args.cmd == "merge-runs":
        cmd_merge_runs(args, cfg, log)
    elif args.cmd == "merge-shards":
        cmd_merge_shards(args, cfg, log)
    elif args.cmd == "preflight":
        cmd_preflight(args, cfg, log)
    elif args.cmd == "login":
        if args.account not in cfg.get("accounts", {}):
            raise SystemExit("account %r is not in config (have: %s)" % (args.account, ", ".join(sorted(cfg.get("accounts", {})))))
        login(cfg, args.account, "headed" if args.headed else "secrets-file", log, timeout_s=args.login_timeout)
    elif args.cmd == "whoami":
        if args.account not in cfg.get("accounts", {}):
            raise SystemExit("account %r is not in config (have: %s)" % (args.account, ", ".join(sorted(cfg.get("accounts", {})))))
        cmd_whoami(args, cfg, log)


if __name__ == "__main__":
    main()
