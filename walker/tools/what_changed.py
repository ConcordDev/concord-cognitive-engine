#!/usr/bin/env python3
"""ULW C33: what-changed report between two registry snapshots (Gate s.16).

  what_changed.py --before actions-<shaA>.json.gz --after actions-<shaB>.json.gz
                  [--out-json F] [--out-md F]

Gate section 16: "a what-changed report -- actions/routes added, removed,
or re-wired between the f4f1f77ff registry (8,335 actions / 4,203 routes)
and the post-fix registry -- generated from the two packet sets."
The packet sets are action_registry.py snapshots.

Diff semantics (pinned in B10's C33 premise, office-accepted):
  actions keyed (domain, action); routes keyed (method, pattern, mount).
  added / removed = the key exists in one snapshot only.
  RE-WIRED = the key exists in both and its WIRING changed:
    actions -- receipt_class changed, or the fe_callers set changed;
    routes  -- the serving file or the source kind changed.
  File/line movement alone is NOT re-wiring (noise control), and an
  fe_callers REORDER is not re-wiring (set semantics).
Read-only.
"""
import argparse, gzip, json, sys


def load_snapshot(path):
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def _action_key(a):
    return (a.get("domain"), a.get("action"))


def _route_key(r):
    return (r.get("method"), r.get("pattern"), r.get("mount"))


def _fmt_key(k):
    return " ".join(str(x) for x in k)


def diff_snapshots(before, after):
    b_act = {_action_key(a): a for a in before.get("actions", [])}
    a_act = {_action_key(a): a for a in after.get("actions", [])}
    b_rt = {_route_key(r): r for r in before.get("routes", [])}
    a_rt = {_route_key(r): r for r in after.get("routes", [])}

    act_added = sorted(_fmt_key(k) for k in a_act.keys() - b_act.keys())
    act_removed = sorted(_fmt_key(k) for k in b_act.keys() - a_act.keys())
    act_rewired = []
    for k in sorted(b_act.keys() & a_act.keys()):
        b, a = b_act[k], a_act[k]
        changes = []
        if b.get("receipt_class") != a.get("receipt_class"):
            changes.append("receipt_class %s -> %s"
                           % (b.get("receipt_class"), a.get("receipt_class")))
        if set(b.get("fe_callers") or []) != set(a.get("fe_callers") or []):
            changes.append("fe_callers changed")
        if changes:
            act_rewired.append({"action": _fmt_key(k), "changes": changes})

    rt_added = sorted(_fmt_key(k) for k in a_rt.keys() - b_rt.keys())
    rt_removed = sorted(_fmt_key(k) for k in b_rt.keys() - a_rt.keys())
    rt_rewired = []
    for k in sorted(b_rt.keys() & a_rt.keys()):
        b, a = b_rt[k], a_rt[k]
        changes = []
        if b.get("file") != a.get("file"):
            changes.append("file %s -> %s" % (b.get("file"), a.get("file")))
        if b.get("source") != a.get("source"):
            changes.append("source %s -> %s" % (b.get("source"), a.get("source")))
        if changes:
            rt_rewired.append({"route": _fmt_key(k), "changes": changes})

    return {
        "before_sha": before.get("sha"), "after_sha": after.get("sha"),
        "actions": {"before": len(b_act), "after": len(a_act),
                    "added": act_added, "removed": act_removed,
                    "rewired": act_rewired},
        "routes": {"before": len(b_rt), "after": len(a_rt),
                   "added": rt_added, "removed": rt_removed,
                   "rewired": rt_rewired},
    }


def render_md(d):
    def block(title, sec, kind):
        lines = ["- %s: %d -> %d; added %d, removed %d, re-wired %d."
                 % (title, sec["before"], sec["after"], len(sec["added"]),
                    len(sec["removed"]), len(sec["rewired"]))]
        for x in sec["added"]:
            lines.append("  - added: %s" % x)
        for x in sec["removed"]:
            lines.append("  - removed: %s" % x)
        for x in sec["rewired"]:
            lines.append("  - re-wired: %s (%s)"
                         % (x[kind], "; ".join(x["changes"])))
        return lines
    out = ["## What changed (Gate section 16, ULW C33)", "",
           "Registry %s -> %s." % (d["before_sha"], d["after_sha"]), ""]
    out += block("Actions", d["actions"], "action")
    out += block("Routes", d["routes"], "route")
    out.append("")
    return "\n".join(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--before", required=True)
    ap.add_argument("--after", required=True)
    ap.add_argument("--out-json", default=None)
    ap.add_argument("--out-md", default=None)
    args = ap.parse_args(argv)
    d = diff_snapshots(load_snapshot(args.before), load_snapshot(args.after))
    text = json.dumps(d, indent=2, sort_keys=True)
    if args.out_json:
        with open(args.out_json, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
    if args.out_md:
        with open(args.out_md, "w", encoding="utf-8") as fh:
            fh.write(render_md(d))
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
