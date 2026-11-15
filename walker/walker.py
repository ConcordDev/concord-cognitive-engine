#!/usr/bin/env python3
"""Concord ultimate lens walker - CLI. See README.md."""
import argparse, json, os, sys, signal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from concord_walker.util import load_config, run_id, Log, mem_available_mb, human_et, append_text
from concord_walker.auth import AccountMismatch, has_session, login, whoami, new_context
from concord_walker.records import RunRecorder
from concord_walker.tickets import TicketStore
from concord_walker.checks import LensWalk
from concord_walker.reverify import Reverifier, status_update
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


def file_findings(store, rec, findings, dry, log, tester):
    new, dups, reserved = [], [], []
    for f in findings:
        dup = store.find_duplicate(f)
        if dup:
            dups.append((f, dup))
            st = store.status(dup)
            if st in ("VERIFIED",):
                rec.judgment(f["lens"], "possible_regression", "Walker finding '%s' matches %s which is VERIFIED; reopen?" % (f["title"], dup), f["evidence"], ticket_id=dup)
            continue
        tid = store.next_id(f["lens"], reserved)
        reserved.append(tid)
        new.append(store.to_ticket(f, tid, tester))
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
    if getattr(args, "start_from", None):
        slugs = [l["slug"] for l in lenses]
        lenses = lenses[slugs.index(args.start_from):]
    if getattr(args, "limit", None):
        lenses = lenses[: args.limit]
    return lenses


def cmd_walk(args, cfg, log):
    from playwright.sync_api import sync_playwright
    inv = load_inventory(cfg)
    lenses = pick_lenses(inv, args)
    dry = args.dry_run or args.no_auth
    rid = run_id()
    rec = RunRecorder(cfg, rid, dry=dry)
    log.path = os.path.join(rec.run_dir, "walker.log")
    store = TicketStore(cfg["audit_dir"])
    phases = args.phases.split(",") if args.phases else READ_PHASES + (["write"] if args.allow_write else [])
    if not args.no_auth and not has_session(cfg, "t1"):
        raise SystemExit("no saved session for %s (auth/t1.json). Run: walker.py login --account t1 --headed  "
                         "(or use --no-auth for a signed-out smoke)" % cfg["accounts"]["t1"]["username"])
    log("run %s: %d lens(es), phases=%s, write=%s, dry=%s" % (rid, len(lenses), phases, args.allow_write, dry))
    summary = []
    from concord_walker.runstate import LensBudget
    walk_budget = LensBudget(cfg["thresholds"]["lens_budget_s"])  # WALK-05 hook: one run-shared per-lens budget
    with RunLock(os.path.join(cfg.get("runs_dir") or cfg["_walker_dir"], "run.lock")), sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True, args=["--disable-dev-shm-usage"])
        try:
            for lens in lenses:
                if not wait_for_memory(cfg, log):
                    log("memory stayed low; stopping run before %s" % lens["slug"])
                    break
                slug = lens["slug"]
                acct, admin, lphases = (None if args.no_auth else "t1"), False, phases
                gate = False
                if slug in cfg["admin_lenses"]:
                    if args.admin and has_session(cfg, "admin") and not args.no_auth:
                        acct, admin = "admin", True
                        lphases = [p for p in phases if p != "write"]
                    else:
                        gate = True  # non-admin gate check: the gate holding is the PASS
                        lphases = ["reach"]
                try:
                    lw = LensWalk(browser, cfg, rec, lens, acct, log, allow_write=args.allow_write, admin=admin,
                                  phases=lphases, inv_entry=lens, gate_check=gate, budget=walk_budget)
                    res = lw.run()
                except AccountMismatch as e:
                    log("ABORT: account check failed on %s: %s" % (slug, e))
                    append_text(os.path.join(rec.run_dir, "ABORTED.txt"), "%s %s: %s\n" % (human_et(), slug, e))
                    break
                new, dups = file_findings(store, rec, lw.findings, dry, log, cfg["tester_name"])
                res["new_tickets"] = [t["id"] for t in new]
                res["duplicates"] = [{"title": f["title"], "dup_of": d} for f, d in dups]
                with open(os.path.join(rec.run_dir, "lens-%s.json" % slug), "w") as f:
                    json.dump(res, f, indent=1)
                summary.append(res)
        finally:
            browser.close()
            left = rec.flush_leftovers()
            write_summary(rec, summary, left, dry)
    log("run %s done: %s" % (rid, rec.run_dir))


def write_summary(rec, summary, left, dry):
    lines = ["# Lens walker run %s\n" % rec.rid, "Finished %s. %s\n\n" % (human_et(), "DRY-RUN (no tickets filed)" if dry else ""),
             "| lens | account | checks (status) | new tickets | dups | s |\n|---|---|---|---|---|---|\n"]
    for r in summary:
        cs = ", ".join("%s:%s" % (k, v.get("status")) for k, v in r["checks"].items())
        lines.append("| %s | %s | %s | %s | %d | %s |\n" % (r["slug"], r["account"], cs, ", ".join(r.get("new_tickets", [])) or "-",
                                                         len(r.get("duplicates", [])), r.get("elapsed_s")))
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
                                       "walker.jsonl"), dry=dry)
    if not has_session(cfg, "t1"):
        raise SystemExit("no saved session for %s; run walker.py login --account t1 --headed first" % cfg["accounts"]["t1"]["username"])
    ids = list(args.ids)
    if args.from_status:
        ids += [i for i in store.base if store.status(i) == args.from_status.upper()]
    # WALK-05: the run journal + heartbeat. On --resume the journal already holds
    # the prior attempt's lines; finished ids (done|skipped) are never re-run.
    journal = Journal(rec.run_dir)
    heartbeat = Heartbeat(rec.run_dir)
    if getattr(args, "resume", None):
        before = len(ids)
        ids = journal.remaining(ids)
        log("resume %s: %d id(s) finished in the journal, %d remaining" % (args.resume, before - len(ids), len(ids)))
    budget = LensBudget(getattr(args, "lens_budget_s", None) or cfg.get("thresholds", {}).get("lens_budget_s", 900))
    results = []
    with RunLock(os.path.join(cfg.get("runs_dir") or cfg["_walker_dir"], "run.lock")), sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True, args=["--disable-dev-shm-usage"])
        try:
            rv = Reverifier(browser, cfg, rec, store, log, inv, allow_write=args.allow_write)
            for tid in ids:
                if not wait_for_memory(cfg, log):
                    break
                heartbeat.beat("reverify %s" % tid)
                _lens = (store.get(tid) or {}).get("lens")
                if _lens:
                    budget.start(_lens)
                    if budget.over(_lens):
                        journal.record("reverify", tid, "failed", "time_budget: lens %s over %ds" % (_lens, budget.budget_s))
                        log("  => %s skipped: lens %s over its time budget" % (tid, _lens))
                        continue
                if store.lane(tid) == "ci":
                    # WALK-01 routing: non-lens code tickets verify via the WALK-06
                    # CI-evidence lane at the deploy sha — never walked as lens None.
                    res = {"id": tid, "verdict": "CI_LANE", "method": "ci-evidence",
                           "notes": "non-lens code ticket; routed to the WALK-06 CI lane"}
                    results.append(res)
                    journal.record("reverify", tid, "skipped", "ci-lane (WALK-06)")
                    log("  => %s CI_LANE (WALK-06)" % tid)
                    with open(os.path.join(rec.run_dir, "reverify.jsonl"), "a") as f:
                        f.write(json.dumps(res) + "\n")
                    continue
                try:
                    res = rv.run(tid)
                    journal.record("reverify", tid, "done", res["verdict"])
                except AccountMismatch as e:
                    journal.record("reverify", tid, "failed", "account mismatch: %s" % e)
                    log("ABORT: account check failed during %s: %s" % (tid, e))
                    break
                except Exception as e:
                    journal.record("reverify", tid, "failed", "%s: %s" % (type(e).__name__, e))
                    raise
                results.append(res)
                log("  => %s %s (%s)" % (tid, res["verdict"], res.get("notes", "")[:140]))
                with open(os.path.join(rec.run_dir, "reverify.jsonl"), "a") as f:
                    f.write(json.dumps(res) + "\n")
                if args.apply_status:
                    upd = status_update(store, res, cfg["tester_name"])
                    if upd:
                        # WALK-01: verdicts land ONLY in records/walker.jsonl (union
                        # schema); fix_tickets.jsonl is never written by a verdict.
                        acct = "admin" if res.get("lens") in cfg.get("admin_lenses", []) else "t1"
                        row = ledger.write_verdict(res, upd, live_sha=live,
                                                   run_id=rid, account=acct)
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
                                       "walker.jsonl"), dry=args.dry_run)
    ids = list(args.ids)
    if args.from_status:
        ids += [i for i in store.base if store.status(i) == args.from_status.upper()]
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


def cmd_whoami(args, cfg, log):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome", headless=True)
        ctx = new_context(b, cfg, args.account if has_session(cfg, args.account) else None, (800, 600))
        me = whoami(ctx, cfg["base_url"])
        print(json.dumps({"account": args.account, "session_file": has_session(cfg, args.account), **me}))
        b.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def walk_opts(p):
        p.add_argument("--allow-write", action="store_true", help="create+delete ONE own labelled fixture per lens (never admin/write-skip lenses)")
        p.add_argument("--admin", action="store_true", help="walk the admin lenses with the admin account (look-only) if auth/admin.json exists")
        p.add_argument("--dry-run", action="store_true", help="don't append tickets / queue / leftovers to the shared audit files")
        p.add_argument("--no-auth", action="store_true", help="signed-out smoke (implies --dry-run)")
        p.add_argument("--phases", help="comma list from: " + ",".join(READ_PHASES + ["write"]))
        p.add_argument("--base-url", help="override base url (selftest only)")

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
    p.add_argument("--from-status", help="also take every ticket currently in this status, e.g. FIXED_PENDING_VERIFY")
    p.add_argument("--from-repo", help="WALK-01: read the ticket fold from this repo clone at --deploy-sha (fix_tickets.jsonl + records/*.jsonl)")
    p.add_argument("--deploy-sha", help="WALK-01: the pinned sha the fold is read at (with --from-repo)")
    p.add_argument("--expect-sha", help="WALK-01: sha gate — hex git sha; REQUIRED with --apply-status. Rows are written only if /health buildSha matches; anything else runs dry")
    p.add_argument("--from-ci", action="store_true", help="WALK-06: verify non-lens code tickets by CI + code evidence at the deploy sha (offline; no browser, no session)")
    p.add_argument("--ci-checks", help="WALK-06: CI checks payload for the expect sha: {sha, runs[{name, status, conclusion, html_url}]}")
    p.add_argument("--resume", help="WALK-05: resume this run id — ids finished in its journal (done|skipped) are not re-run")
    p.add_argument("--lens-budget-s", type=int, help="WALK-05: per-lens time budget in seconds (default from config thresholds, else 900)")
    p.add_argument("--allow-write", action="store_true")
    p.add_argument("--apply-status", action="store_true", help="write verdict rows (VERIFIED/REOPENED/OPEN) to records/walker.jsonl")
    p.add_argument("--dry-run", action="store_true")
    p = sub.add_parser("login", help="save a session for a QA account")
    p.add_argument("--account", choices=["t1", "t2", "admin"], required=True)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--headed", action="store_true")
    g.add_argument("--secrets-file", action="store_true")
    p = sub.add_parser("whoami", help="GET /api/auth/me with a saved session")
    p.add_argument("--account", choices=["t1", "t2", "admin"], default="t1")
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
    elif args.cmd == "login":
        login(cfg, args.account, "headed" if args.headed else "secrets-file", log)
    elif args.cmd == "whoami":
        cmd_whoami(args, cfg, log)


if __name__ == "__main__":
    main()
