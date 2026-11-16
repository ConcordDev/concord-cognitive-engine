#!/usr/bin/env python3
"""Re-grade a finished or in-progress run's two-account verdicts against the intended-public
allowlist (config/intended_public.json) without re-walking.

Read-only over the run dir: it opens lens-*.json / findings.jsonl for reading and writes ONE new
file, audit/regraded-<run_id>.json (default: <run_dir>/../../audit/). Records stay untouched, so the
walk can keep running; re-run this any time for a fresh snapshot.

  tools/regrade_intended_public.py <run_dir> [--allowlist PATH] [--out PATH]
"""
import argparse, glob, hashlib, json, os, re, sys, time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from concord_walker import intended_public as ip  # noqa: E402

TITLE = re.compile(r"\b(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(/\S+)\s+->")


def regrade_lens(rec, entries):
    ta = rec.get("two_account")
    if not isinstance(ta, dict) or not ta.get("calls"):
        return None
    calls, changed = [], []
    for c in ta["calls"]:
        c2 = dict(c)
        if c.get("verdict") == "OWNERSHIP_FAIL":
            e = ip.match(entries, c.get("method"), c.get("path"))
            if e is not None:
                c2["verdict"], c2["intended_public"] = "PUBLIC_INTENDED", ip.tag(e)
                changed.append({"method": c["method"], "path": c["path"], "control_id": c.get("control_id"),
                                "from": "OWNERSHIP_FAIL", "to": "PUBLIC_INTENDED", "route": e["route"],
                                "decided_by": e["decided_by"], "date": e["date"]})
        calls.append(c2)
    suppressed = []
    for f in rec.get("premap_findings") or []:
        if f.get("class") != "ownership":
            continue
        m = TITLE.search(f.get("title") or "")
        if m and ip.match(entries, m.group(1), m.group(2)):
            suppressed.append({"class": "ownership", "control_id": f.get("control_id"), "sid": f.get("sid"), "title": f.get("title")})
    fails = sum(1 for c in calls if c.get("verdict") == "OWNERSHIP_FAIL")
    return {
        "status_before": ta.get("status"),
        "status_after": ("FAIL" if fails else "PASS") if ta.get("status") in ("FAIL", "PASS") else ta.get("status"),
        "ownership_failures_before": ta.get("ownership_failures"),
        "ownership_failures_after": fails,
        "public_intended": sum(1 for c in calls if c.get("verdict") == "PUBLIC_INTENDED"),
        "regraded_calls": changed,
        "suppressed_premap_findings": suppressed,
        "calls": calls,
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("--allowlist", default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)
    run_dir = os.path.abspath(a.run_dir)
    rid = os.path.basename(run_dir.rstrip("/"))
    allow = a.allowlist or ip.DEFAULT_PATH
    entries = ip.load(allow)
    with open(allow, "rb") as f:
        allow_sha = hashlib.sha256(f.read()).hexdigest()[:12]
    lenses, totals = {}, {"lenses_read": 0, "lenses_with_two_account": 0, "regraded_calls": 0,
                          "suppressed_premap_findings": 0, "lenses_fail_before": 0, "lenses_fail_after": 0}
    for p in sorted(glob.glob(os.path.join(run_dir, "lens-*.json"))):
        try:
            with open(p) as f:
                rec = json.load(f)
        except (ValueError, OSError):
            continue  # a record mid-write by the running walk; next snapshot picks it up
        totals["lenses_read"] += 1
        g = regrade_lens(rec, entries)
        if g is None:
            continue
        slug = rec.get("slug") or os.path.basename(p)[5:-5]
        totals["lenses_with_two_account"] += 1
        totals["regraded_calls"] += len(g["regraded_calls"])
        totals["suppressed_premap_findings"] += len(g["suppressed_premap_findings"])
        totals["lenses_fail_before"] += g["status_before"] == "FAIL"
        totals["lenses_fail_after"] += g["status_after"] == "FAIL"
        lenses[slug] = g
    # ownership lines already written to the run's findings.jsonl (listed, never edited)
    superseded = []
    fj = os.path.join(run_dir, "findings.jsonl")
    if os.path.exists(fj):
        with open(fj) as f:
            for line in f:
                try:
                    x = json.loads(line)
                except ValueError:
                    continue
                if x.get("class") == "ownership" or "ownership" in str(x.get("kind", "")):
                    m = TITLE.search(x.get("title") or "")
                    if m and ip.match(entries, m.group(1), m.group(2)):
                        superseded.append({k: x.get(k) for k in ("id", "slug", "lens", "title") if x.get(k) is not None})
    out = {
        "run_id": rid, "run_dir": run_dir,
        "regraded_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "allowlist": {"path": allow, "sha256_12": allow_sha,
                      "routes": [{k: e[k] for k in ("method", "route", "decided_by", "date")} for e in entries]},
        "note": "Snapshot; records are unchanged. PUBLIC_INTENDED calls are not bugs and must not reach packets as ownership findings.",
        "totals": totals,
        "superseded_findings_jsonl": superseded,
        "lenses": lenses,
    }
    dest = a.out or os.path.join(os.path.dirname(os.path.dirname(run_dir)), "audit", "regraded-%s.json" % rid)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, indent=1)
    os.replace(tmp, dest)
    print("%s: %d lens(es) read, %d with two-account; regraded %d call(s) to PUBLIC_INTENDED; suppressed %d ownership finding(s); FAIL lenses %d -> %d; wrote %s" % (
        rid, totals["lenses_read"], totals["lenses_with_two_account"], totals["regraded_calls"], totals["suppressed_premap_findings"],
        totals["lenses_fail_before"], totals["lenses_fail_after"], dest))
    return 0


if __name__ == "__main__":
    sys.exit(main())
