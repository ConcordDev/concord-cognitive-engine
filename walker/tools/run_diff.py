#!/usr/bin/env python3
"""Upgrade 6: run-to-run diff keyed by stable control id (sid).

  run_diff.py --prev RUN_DIR --cur RUN_DIR [--out DIR]

Per lens walked in --cur, every control is compared with --prev by sid:
  new_broken        broken now, not broken before (or a new control that is broken)
  fixed             broken before, OK now
  unchanged_broken  broken in both
  unchanged_ok      OK in both (or new and OK)
  disappeared       present before, gone now (lens walked in both)
A lens in --prev that --cur did not walk is 'lens_not_walked' (never counted as disappeared
or fixed). v1 records have no controls: their checks are compared as pseudo-controls
(check:<name>, broken = FAIL/ERROR). Both runs' build shas are pinned on every lens row and
on the headline; a different or missing build is flagged.
Headline = the progress number: fixed / new_broken / unchanged_broken.
"""
import argparse, glob, json, os, sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from concord_walker.lensrecord import load_lens_record  # noqa: E402

CATS = ("new_broken", "fixed", "unchanged_broken", "unchanged_ok", "disappeared")


def load_run(rd):
    out = {}
    for p in sorted(glob.glob(os.path.join(rd, "lens-*.json"))):
        try:
            r = load_lens_record(p)
        except Exception:
            continue
        out[r.get("slug") or os.path.basename(p)[5:-5]] = r
    return out


def controls_of(rec):
    """sid -> (label, broken_reasons) for one lens record."""
    out = OrderedDict()
    if rec.get("schema_version", 1) >= 2 and rec.get("controls") is not None:
        for c in rec["controls"]:
            if not c.get("exercised", True):
                continue
            sid = c.get("sid") or c["control_id"]
            prev = out.get(sid)
            br = sorted(set(c.get("broken") or []) | (set(prev[1]) if prev else set()))
            out[sid] = (c.get("name") if c.get("name") not in (None, "-") else c["control_id"], br)
        return out
    for name, chk in sorted((rec.get("checks") or {}).items()):
        st = chk.get("status")
        if st in ("NOT_RUN", None):
            continue
        out["check:" + name] = (name, [st.lower()] if st in ("FAIL", "ERROR") else [])
    return out


def _sha(rec):
    return ((rec.get("deploy") or {}).get("backend_sha") or None)


def diff(prev_dir, cur_dir):
    P, C = load_run(prev_dir), load_run(cur_dir)
    lenses, head = OrderedDict(), Counter()
    for slug in sorted(set(P) | set(C)):
        if slug not in C:
            lenses[slug] = {"slug": slug, "status": "lens_not_walked", "prev_build": (_sha(P[slug]) or "")[:12] or None}
            head["lens_not_walked"] += 1
            continue
        cur = controls_of(C[slug])
        prv = controls_of(P[slug]) if slug in P else None
        rows = []
        cnt = Counter()
        for sid, (label, br) in cur.items():
            if prv is None:
                cat = "new_broken" if br else "unchanged_ok"
                before = None
            else:
                before = prv.get(sid)
                if before is None:
                    cat = "new_broken" if br else "unchanged_ok"
                elif before[1] and not br:
                    cat = "fixed"
                elif br and not before[1]:
                    cat = "new_broken"
                elif br:
                    cat = "unchanged_broken"
                else:
                    cat = "unchanged_ok"
            cnt[cat] += 1
            if cat != "unchanged_ok":
                rows.append({"sid": sid, "control": label, "category": cat, "now": br,
                             "before": (before[1] if before else None)})
        if prv is not None:
            for sid, (label, br) in prv.items():
                if sid not in cur:
                    cnt["disappeared"] += 1
                    rows.append({"sid": sid, "control": label, "category": "disappeared", "now": None, "before": br})
        pb, cb = _sha(P[slug]) if slug in P else None, _sha(C[slug])
        flag = None
        if not cb or (slug in P and not pb):
            flag = "build unknown on %s run" % ("cur" if not cb else "prev")
        lenses[slug] = OrderedDict([("slug", slug), ("status", "compared" if prv is not None else "new_lens"),
                                    ("prev_build", (pb or "")[:12] or None), ("cur_build", (cb or "")[:12] or None),
                                    ("build_changed", bool(pb and cb and pb[:12] != cb[:12])), ("build_flag", flag),
                                    ("schema", "v2" if C[slug].get("schema_version", 1) >= 2 else "v1 (checks as pseudo-controls)"),
                                    ("counts", OrderedDict((k, cnt.get(k, 0)) for k in CATS)),
                                    ("rows", sorted(rows, key=lambda r: (CATS.index(r["category"]), r["control"] or "")))])
        head.update(cnt)
    builds_prev = sorted({l["prev_build"] for l in lenses.values() if l.get("prev_build")})
    builds_cur = sorted({l["cur_build"] for l in lenses.values() if l.get("cur_build")})
    return OrderedDict([("prev_run", os.path.basename(os.path.normpath(prev_dir))), ("cur_run", os.path.basename(os.path.normpath(cur_dir))),
                        ("prev_builds", builds_prev), ("cur_builds", builds_cur),
                        ("headline", OrderedDict([(k, head.get(k, 0)) for k in CATS] + [("lens_not_walked", head.get("lens_not_walked", 0))])),
                        ("progress", "%d fixed, %d new broken, %d still broken" % (head.get("fixed", 0), head.get("new_broken", 0), head.get("unchanged_broken", 0))),
                        ("lenses", lenses)])


def render_md(d):
    h = d["headline"]
    L = ["# Run diff %s -> %s" % (d["prev_run"], d["cur_run"]), "",
         "Builds: prev %s -> cur %s." % (", ".join(d["prev_builds"]) or "UNKNOWN", ", ".join(d["cur_builds"]) or "UNKNOWN"), "",
         "**Progress: %s.**" % d["progress"], "",
         "| new_broken | fixed | unchanged_broken | unchanged_ok | disappeared | lens_not_walked |", "|---:|---:|---:|---:|---:|---:|",
         "| %d | %d | %d | %d | %d | %d |" % (h["new_broken"], h["fixed"], h["unchanged_broken"], h["unchanged_ok"], h["disappeared"], h["lens_not_walked"]), ""]
    for s, l in d["lenses"].items():
        if l["status"] == "lens_not_walked":
            L.append("- **%s**: lens not walked in the current run" % s)
            continue
        c = l["counts"]
        L.append("- **%s** (%s -> %s%s): +%d broken, %d fixed, %d still broken, %d gone" % (
            s, l["prev_build"] or "?", l["cur_build"] or "?", (" ⚠ " + l["build_flag"]) if l["build_flag"] else "",
            c["new_broken"], c["fixed"], c["unchanged_broken"], c["disappeared"]))
    return "\n".join(L) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prev", required=True)
    ap.add_argument("--cur", required=True)
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    for d in (a.prev, a.cur):
        if not os.path.isdir(d):
            raise SystemExit("not a run dir: %s" % d)
    d = diff(a.prev, a.cur)
    out = a.out or a.cur
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "run-diff.json"), "w") as f:
        json.dump(d, f, indent=1)
    with open(os.path.join(out, "run-diff.md"), "w") as f:
        f.write(render_md(d))
    print("run diff: %s -> %s" % (d["progress"], out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
