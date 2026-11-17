#!/usr/bin/env python3
"""MST-W0-04: observed (walk) vs registered (registry) diff, false-positive safe.

  unused_actions.py --registry actions-<sha>.json.gz (--run RUN_DIR | --runs DIR) [--out DIR]

Every recorded call gets a class (concord_walker/routematch.py):
  real_missing      no declared route AND non-2xx (404/405/5xx/network fail)   -> DEFECT
  matched_failing   declared route, non-2xx                                     -> DEFECT
  unmatched_but_ok  no declared route but 2xx (dynamic/runtime route)          -> noise, never a bug
  matched_ok        declared route, 2xx
  unused_route      declared, never observed in this run
Lens actions: observed {domain, action} vs registerLensAction (same classes), plus per lens
registered_not_observed, no_fe_caller (UNSURFACED) and caller_in_other_lens.
Each lens block is pinned to the record's build sha and the registry sha (build_match
same | differs | unknown -- a mismatch is flagged, never treated as current).
v1 records still diff: their console 4xx/5xx paths are classified (method unknown),
and they report 'v1 record: no endpoint data' for everything else.
Writes OUT/registry-diff.json + OUT/registry-diff.md. Read-only otherwise.
"""
import argparse, glob, json, os, re, sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from concord_walker.routematch import RouteIndex, classify, load_registry, CLASSES, status_ok  # noqa: E402
from concord_walker.netledger import template_path  # noqa: E402
from concord_walker.lensrecord import load_lens_record  # noqa: E402

DEFECT = ("real_missing", "matched_failing")


def newest_records(run_dirs):
    """slug -> (path, record): the newest record per slug across the run dirs (run ids sort by time)."""
    out = {}
    for rd in sorted(run_dirs):
        for p in sorted(glob.glob(os.path.join(rd, "lens-*.json"))):
            try:
                rec = load_lens_record(p)
            except Exception:
                continue
            slug = rec.get("slug") or os.path.basename(p)[5:-5]
            out[slug] = (p, rec)
    return out


def run_dirs_of(run=None, runs=None):
    if run:
        return [run]
    return sorted(d for d in glob.glob(os.path.join(runs, "*")) if os.path.isdir(d))


def _calls(rec):
    if rec.get("schema_version", 1) >= 2 and rec.get("controls") is not None:
        for c in rec["controls"]:
            for q in c.get("requests", []):
                st = q.get("status")
                if st is None:
                    st = q.get("error") or "failed"
                yield {"control_id": c["control_id"], "sid": c.get("sid"), "method": q["method"], "path": q["path"],
                       "status": st, "n": q.get("n", 1), "document": q.get("type") == "document",
                       "lens_action": q.get("lens_action")}
        return
    con = rec.get("console") or {}
    for s in (con.get("http_4xx") or []) + (con.get("http_5xx") or []):
        m = re.match(r"^(\d{3})\s+(\S+)", s or "")
        if m:
            yield {"control_id": "v1:console", "sid": None, "method": "?", "path": template_path(m.group(2))[0],
                   "status": int(m.group(1)), "n": 1, "document": False, "lens_action": None}


def build_match(reg_sha, rec):
    b = ((rec.get("deploy") or {}).get("backend_sha") or "")
    if not b:
        return "unknown"
    r = (reg_sha or "").lower()
    return "same" if (r.startswith(b.lower()[:12]) or b.lower().startswith(r[:12])) else "differs"


def diff(registry, records):
    idx = RouteIndex(registry["routes"])
    acts = {(a["domain"], a["action"]): a for a in registry["actions"]}
    by_domain = {}
    for a in registry["actions"]:
        by_domain.setdefault(a["domain"], []).append(a)
    observed_routes = set()
    lenses = OrderedDict()
    totals = Counter()
    for slug in sorted(records):
        path, rec = records[slug]
        dep = rec.get("deploy") or {}
        agg = OrderedDict()
        for c in _calls(rec):
            k = (c["control_id"], c["method"], c["path"])
            a = agg.setdefault(k, dict(c, statuses=[]))
            a["statuses"].append(c["status"])
        rows = []
        for (cid, method, p), c in agg.items():
            best, any_m = idx.find(method if method != "?" else "GET", p, document=c["document"])
            route = best if method != "?" else any_m
            method_note = None
            if route is None and any_m is not None and method != "?":
                method_note = "path declared for %s, not %s" % (any_m["method"], method)
            cls = classify(route is not None, c["statuses"])
            if route is not None:
                observed_routes.add((route["method"], route["pattern"], route.get("mount")))
            row = OrderedDict([("class", cls), ("control_id", cid), ("sid", c.get("sid")), ("method", method), ("path", p),
                               ("statuses", sorted({str(s) for s in c["statuses"]})),
                               ("route", ("%s %s" % (route["method"], route["pattern"])) if route else None),
                               ("route_src", ("%s:%s" % (route["file"], route["line"])) if route else None),
                               ("match", ("runtime-suffix" if route and route.get("mount") == "runtime" else ("pattern" if route else None)))])
            if method_note:
                row["note"] = method_note
            row["build_sha"] = (dep.get("backend_sha") or None) and dep["backend_sha"][:12]
            row["walked_at"] = dep.get("walked_at")
            rows.append(row)
        # lens actions
        obs_actions = OrderedDict()
        for c in _calls(rec):
            la = c.get("lens_action")
            if la and la.get("action"):
                obs_actions.setdefault((la["domain"], la["action"]), []).append(c["status"])
        act_rows = []
        for (d, a), sts in obs_actions.items():
            reg = acts.get((d, a))
            act_rows.append({"class": classify(reg is not None, sts), "domain": d, "action": a,
                             "statuses": sorted({str(s) for s in sts}),
                             "receipt_class": reg["receipt_class"] if reg else None,
                             "src": ("%s:%s" % (reg["file"], reg["line"])) if reg else None})
        reg_here = by_domain.get(slug, [])
        not_obs = [a for a in reg_here if (a["domain"], a["action"]) not in obs_actions]
        lens_dir = "concord-frontend/app/lenses/%s/" % slug
        no_fe = sorted(a["action"] for a in reg_here if not a.get("fe_callers"))
        other = sorted(a["action"] for a in reg_here if a.get("fe_callers") and not any(f.startswith(lens_dir) for f in a["fe_callers"]))
        counts = Counter(r["class"] for r in rows)
        counts.update(r["class"] for r in act_rows)
        totals.update(counts)
        lenses[slug] = OrderedDict([
            ("slug", slug), ("record", path), ("schema_version", rec.get("schema_version", 1)),
            ("build_sha", (dep.get("backend_sha") or None) and dep["backend_sha"][:12]), ("walked_at", dep.get("walked_at")),
            ("registry_sha", registry["sha"][:12]), ("build_match", build_match(registry["sha"], rec)),
            ("note", "v1 record: no endpoint data (only console 4xx/5xx paths classified)" if rec.get("schema_version", 1) < 2 else None),
            ("counts", OrderedDict((k, counts.get(k, 0)) for k in CLASSES if k != "unused_route")),
            ("defects", [r for r in rows if r["class"] in DEFECT] + [r for r in act_rows if r["class"] in DEFECT]),
            ("noise", [r for r in rows if r["class"] == "unmatched_but_ok"]),
            ("calls", rows), ("actions_observed", act_rows),
            ("registered_not_observed", {"count": len(not_obs), "actions": sorted(a["action"] for a in not_obs)[:60]}),
            ("no_fe_caller", {"count": len(no_fe), "actions": no_fe[:60]}),
            ("caller_in_other_lens", {"count": len(other), "actions": other[:60]}),
        ])
    api_routes = [r for r in registry["routes"] if r["source"] != "next-page"]
    unused = [r for r in api_routes if (r["method"], r["pattern"], r.get("mount")) not in observed_routes]
    totals["unused_route"] = len(unused)
    return OrderedDict([
        ("registry_sha", registry["sha"][:12]), ("registry_source", registry.get("source")),
        ("lenses_diffed", len(lenses)),
        ("totals", OrderedDict((k, totals.get(k, 0)) for k in CLASSES)),
        ("defects_total", sum(len(l["defects"]) for l in lenses.values())),
        ("build_mismatch_lenses", sorted(s for s, l in lenses.items() if l["build_match"] != "same")),
        ("unused_routes_sample", ["%s %s (%s:%s)" % (r["method"], r["pattern"], r["file"], r["line"]) for r in unused[:200]]),
        ("lenses", lenses)])


def render_md(d):
    L = ["# Registry diff (observed vs registered) — registry %s" % d["registry_sha"], "",
         "Source: `%s`. Lenses: %d. Defects (real_missing + matched_failing): **%d**. "
         "`unmatched_but_ok` is low-priority noise (dynamic/runtime routes), never a bug." % (d["registry_source"], d["lenses_diffed"], d["defects_total"]), "",
         "| class | count |", "|---|---:|"]
    for k, v in d["totals"].items():
        L.append("| %s | %d |" % (k, v))
    if d["build_mismatch_lenses"]:
        L += ["", "**Build stamp flag:** %d lens record(s) are not stamped with the registry sha (unknown or different build): %s"
              % (len(d["build_mismatch_lenses"]), ", ".join(d["build_mismatch_lenses"][:30]))]
    L += ["", "| lens | build | match | real_missing | matched_failing | unmatched_but_ok | matched_ok | reg-not-observed | no FE caller |",
          "|---|---|---|---:|---:|---:|---:|---:|---:|"]
    for s, l in d["lenses"].items():
        c = l["counts"]
        L.append("| %s | %s | %s | %d | %d | %d | %d | %d | %d |" % (s, l["build_sha"] or "-", l["build_match"], c["real_missing"], c["matched_failing"],
                                                                 c["unmatched_but_ok"], c["matched_ok"], l["registered_not_observed"]["count"], l["no_fe_caller"]["count"]))
    return "\n".join(L) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--registry", required=True)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--run")
    g.add_argument("--runs")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    reg = load_registry(a.registry)
    recs = newest_records(run_dirs_of(a.run, a.runs))
    d = diff(reg, recs)
    out = a.out or (a.run or a.runs)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "registry-diff.json"), "w") as f:
        json.dump(d, f, indent=1)
    with open(os.path.join(out, "registry-diff.md"), "w") as f:
        f.write(render_md(d))
    print("registry diff: %d lenses, totals %s -> %s" % (d["lenses_diffed"], dict(d["totals"]), out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
