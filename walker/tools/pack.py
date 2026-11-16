#!/usr/bin/env python3
"""MST-W0-05: builder packets -- one small, sufficient packet per master ticket and per lens.

  pack.py --index /workspace/walker-runs/index/<date>/            MASTER-TICKETS.jsonl, MASTER-V1-FULL.jsonl,
                                                                 MASTER-CHILD-MAP.jsonl, LENS-INDEX(.md|/)
          (--run RUN_DIR | --runs DIR)                           newest record per slug (v2 preferred)
          [--registry actions-<sha>.json.gz]                     W0-04 registry -> per-lens registry diff
          [--fix-tickets audit/fix_tickets.jsonl] [--fold canonical.jsonl]   open fix tickets (fold overrides status)
          [--root-causes audit/root_causes.md|.json]
          [--prev-run RUN_DIR | --prev-runs DIR]                 run-to-run diff (stable control ids)
          [--repo GIT_CHECKOUT] [--fix-commit TICKET=SHA ...]    "build X does/doesn't contain fix Y" (else 'unknown')
          [--check-live [--base-url URL]]                        STALE when deploy.backend_sha != live /health buildSha
          --out DIR (--ticket ID | --lens SLUG | --all) [--link-latest]

Writes packet-<id>.md/.json and lens-<slug>.md/.json plus INDEX.json (packet -> sha256 of every input).
Deterministic: sorted, no wall-clock fields; the same inputs give byte-identical packets.
Caps (WALKER-PREMAP-SPEC section 4): 12 KB per ticket packet, 24 KB per lens packet. Over the cap the lowest
sections are trimmed with an explicit '+N more (see <path>)'; still over after trimming -> exit 3.
Exit 2: a lens slug that is not under app/lenses at the registry sha (or unknown to the index and the run).
Never copies plan prose, request/response bodies, base64 or screenshots -- pointers only.
"""
import argparse, glob, hashlib, json, os, re, sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from concord_walker.lensrecord import load_lens_record, build_verdict, contains_commit  # noqa: E402
from concord_walker.routematch import load_registry, pattern_match, express_pattern  # noqa: E402
import unused_actions as UA  # noqa: E402
import run_diff as RD  # noqa: E402

TICKET_CAP = 12 * 1024
LENS_CAP = 24 * 1024
CAPS = {"findings": 15, "controls": 25, "endpoints": 30, "registry": 30, "shots": 6, "tickets": 40}
CLOSED = {"VERIFIED", "CLOSED", "WONTFIX", "DUPLICATE", "FIXED"}
APP_ROUTES = {"hub"}  # app routes (not lens dirs) that index tickets may name


class OverCap(Exception):
    pass


# ------------------------------------------------------------------ inputs
def sha256_file(p):
    if not p or not os.path.exists(p):
        return None
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 16), b""):
            h.update(b)
    return h.hexdigest()


def read_jsonl(p):
    out = []
    if not p or not os.path.exists(p):
        return out
    with open(p, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
    return out


def load_root_causes(p):
    """rows with signature/title/severity/count/lenses/suspected_area/evidence/ticket_ids."""
    if not p:
        return []
    js = p[:-3] + ".json" if p.endswith(".md") else p
    if js.endswith(".json") and os.path.exists(js):
        with open(js) as f:
            return json.load(f).get("rows", [])
    rows = []
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            m = re.match(r"^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$", line)
            if m:
                rows.append({"signature": m.group(1), "title": m.group(2), "severity": m.group(3), "count": int(m.group(4)),
                             "lenses": [x.strip() for x in m.group(5).split(",") if x.strip()], "suspected_area": m.group(6),
                             "evidence": [], "ticket_ids": []})
    return rows


def run_dirs(run=None, runs=None):
    if run:
        return [run]
    if runs:
        return sorted(d for d in glob.glob(os.path.join(runs, "*")) if os.path.isdir(d))
    return []


def newest_records(dirs):
    """slug -> (path, record): newest v2 record per slug; a v1 record only when no v2 exists."""
    best = {}
    for rd in sorted(dirs):
        for p in sorted(glob.glob(os.path.join(rd, "lens-*.json"))):
            try:
                rec = load_lens_record(p)
            except Exception:
                continue
            slug = rec.get("slug") or os.path.basename(p)[5:-5]
            v2 = rec.get("schema_version", 1) >= 2
            cur = best.get(slug)
            if cur is None or v2 or cur[1].get("schema_version", 1) < 2:
                best[slug] = (os.path.abspath(p), rec)
    return best


def lens_dirs(registry):
    if not registry:
        return None
    s = set()
    for r in registry.get("routes", []):
        parts = r["pattern"].split("/")
        if r.get("source") == "next-page" and r["pattern"].startswith("/lenses/") and len(parts) > 2 and not parts[2].startswith(":"):
            s.add(parts[2])
    return s


def slug_known(slug, dirs):
    if slug == "*" or slug in APP_ROUTES:
        return True
    if dirs is None:
        return True
    return slug.split("/")[0] in dirs


class Inputs:
    def __init__(self, a):
        self.a = a
        ix = a.index
        self.paths = OrderedDict()
        self.paths["master_tickets"] = os.path.join(ix, "MASTER-TICKETS.jsonl")
        self.paths["master_v1_full"] = os.path.join(ix, "MASTER-V1-FULL.jsonl")
        self.paths["child_map"] = os.path.join(ix, "MASTER-CHILD-MAP.jsonl")
        self.paths["lens_index"] = os.path.join(ix, "LENS-INDEX.md")
        if not os.path.exists(self.paths["master_tickets"]):
            raise SystemExit("index has no MASTER-TICKETS.jsonl: %s" % ix)
        self.tickets = OrderedDict((t["id"], t) for t in sorted(read_jsonl(self.paths["master_tickets"]), key=lambda t: t["id"]))
        self.steps = read_jsonl(self.paths["master_v1_full"])
        self.child = read_jsonl(self.paths["child_map"])
        self.records = newest_records(run_dirs(a.run, a.runs))
        self.prev = newest_records(run_dirs(a.prev_run, a.prev_runs)) if (a.prev_run or a.prev_runs) else None
        self.registry = load_registry(a.registry) if a.registry else None
        self.paths["registry"] = a.registry
        self.dirs = lens_dirs(self.registry)
        self.paths["fix_tickets"] = a.fix_tickets
        self.paths["fold"] = a.fold
        self.paths["root_causes"] = a.root_causes
        fix = OrderedDict()
        for t in read_jsonl(a.fix_tickets):
            fix[t["id"]] = t
        for r in read_jsonl(a.fold):
            if r.get("id") in fix and r.get("status"):
                fix[r["id"]] = dict(fix[r["id"]], status=r["status"])
        self.fix = fix
        self.rc = load_root_causes(a.root_causes)
        self.sig_of = {}
        for r in self.rc:
            for tid in r.get("ticket_ids") or []:
                self.sig_of.setdefault(tid, r["signature"])
        del EVIDENCE_ROOTS[:]
        EVIDENCE_ROOTS.extend(sorted({os.path.dirname(os.path.abspath(x)) for x in (a.fix_tickets, a.root_causes) if x}))
        self.fix_commits = dict(x.split("=", 1) for x in (a.fix_commit or []) if "=" in x)
        self.live_sha = None
        self.live_checked = False
        self._rd = {}

    def h(self, key):
        v = sha256_file(self.paths.get(key))
        return v[:16] if v else None

    def lens_md(self, slug):
        p = os.path.join(self.a.index, "LENS-INDEX", slug + ".md")
        return p if os.path.exists(p) else None

    def regdiff(self, slug):
        if slug in self._rd:
            return self._rd[slug]
        out = None
        if self.registry and slug in self.records:
            d = UA.diff(self.registry, {slug: self.records[slug]})
            out = d["lenses"].get(slug)
            if out is not None:
                out = dict(out, _totals=d["totals"])
        self._rd[slug] = out
        return out


# ------------------------------------------------------------------ helpers
def short(s, n):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def cell(s, n=60):
    return short(s, n).replace("|", "/")


EVIDENCE_ROOTS = []


def resolve_path(p, rec_path):
    """Evidence/screenshot pointer -> absolute box path when it exists (never the image itself).
    Bases: the record's run dir and its parents, then the audit dir (--fix-tickets / --root-causes)."""
    if not p:
        return p
    if os.path.isabs(p):
        return p
    rd = os.path.dirname(rec_path or "")
    for base in [rd, os.path.dirname(rd), os.path.dirname(os.path.dirname(rd))] + EVIDENCE_ROOTS:
        q = os.path.normpath(os.path.join(base, p))
        if os.path.exists(q):
            return q
    return p


def fix_tickets_for(inp, slug):
    rows = [t for t in inp.fix.values() if t.get("lens") == slug and (t.get("status") or "OPEN").upper() not in CLOSED]
    return sorted(rows, key=lambda t: t["id"])


def steps_for(inp, slug):
    return [s for s in inp.steps if slug in (s.get("lenses") or [])]


def tickets_for(inp, slug):
    return [t for t in inp.tickets.values() if slug in t.get("lenses", [])]


def deploy_of(rec):
    return (rec or {}).get("deploy") or {}


def run_id_of(path):
    return os.path.basename(os.path.dirname(path)) if path else None


def backend_tokens(t):
    toks = set()
    for b in t.get("backend") or []:
        for m in re.finditer(r"(/api/[\w/:.\-{}\[\]]+)", b):
            toks.add(("path", m.group(1).rstrip(".,)").lower()))
        for m in re.finditer(r"\b([a-z][\w-]*)\.([A-Za-z][\w-]+)\b", b):
            if m.group(2) not in ("js", "ts", "tsx", "jsx", "md", "json", "jsonl", "py"):
                toks.add(("action", (m.group(1) + "." + m.group(2)).lower()))
        for m in re.finditer(r"server/[\w/.-]+", b):
            toks.add(("file", m.group(0).lower()))
    return toks


# ------------------------------------------------------------------ lens section (data)
def lens_data(inp, slug, ticket=None):
    """Structured per-lens slot data (untrimmed, already capped per spec). ticket != None narrows relevance."""
    path, rec = inp.records.get(slug, (None, None))
    d = OrderedDict([("slug", slug)])
    if rec is None:
        d["walked"] = False
        d["coverage"] = "lens not walked this run"
        return d
    v2 = rec.get("schema_version", 1) >= 2
    dep = deploy_of(rec)
    d["walked"] = True
    d["record"] = path
    d["run_id"] = run_id_of(path)
    d["schema"] = "v2" if v2 else "v1"
    d["build_sha"] = (dep.get("backend_sha") or "")[:12] or None
    d["frontend_build"] = dep.get("frontend_build_id")
    d["walked_at"] = dep.get("walked_at") or rec.get("started") or rec.get("finished")
    flags = []
    if not dep.get("backend_sha"):
        flags.append("no build stamp (%s): cannot say which build this walk saw" % ("v1 record" if not v2 else dep.get("sha_status") or "missing"))
    elif dep.get("sha_status") not in (None, "ok"):
        flags.append("build stamp %s: %s" % (dep.get("sha_status"), dep.get("sha_note") or ""))
    reg_sha = (inp.registry or {}).get("sha", "")[:12] or None
    if reg_sha and d["build_sha"] and not reg_sha.startswith(d["build_sha"][:12]) and not d["build_sha"].startswith(reg_sha):
        flags.append("registry %s != walked build %s: route/action rows may be stale" % (reg_sha, d["build_sha"]))
    if inp.live_checked:
        if inp.live_sha is None:
            flags.append("STALE? live /health gave no buildSha")
        elif not dep.get("backend_sha"):
            flags.append("STALE? record has no build stamp; live is %s" % inp.live_sha[:12])
        elif not inp.live_sha.lower().startswith(dep["backend_sha"].lower()[:12]):
            flags.append("STALE: walked %s, live now %s" % (dep["backend_sha"][:12], inp.live_sha[:12]))
    d["flags"] = flags
    fix_sha = inp.fix_commits.get(ticket["id"]) if ticket else None
    d["build_verdict"] = build_verdict(inp.a.repo, dep, fix_sha)
    if fix_sha:
        d["contains_fix"] = contains_commit(inp.a.repo, dep.get("backend_sha"), fix_sha) if dep.get("backend_sha") else "unknown"
    # coverage
    checks = rec.get("checks") or {}
    d["coverage"] = OrderedDict([("attempted", True),
                                 ("checks", OrderedDict((k, (v or {}).get("status")) for k, v in sorted(checks.items()))),
                                 ("not_run", sorted(k for k, v in checks.items() if (v or {}).get("status") == "NOT_RUN")),
                                 ("budget_aborted", bool(rec.get("budget_aborted"))),
                                 ("elapsed_s", rec.get("elapsed_s"))])
    # findings: v2 findings + open fix tickets
    src = set((ticket or {}).get("source_ids") or [])
    btoks = backend_tokens(ticket) if ticket else set()
    fnd = []
    seen = set()
    for f in rec.get("findings") or []:
        fid = f.get("id")
        seen.add(fid)
        fnd.append({"id": fid, "signature": f.get("signature"), "severity": f.get("severity"), "check": f.get("check"),
                    "title": f.get("title"), "evidence": [resolve_path(e, path) for e in (f.get("evidence") or [])[:1]],
                    "area": f.get("area")})
    for t in fix_tickets_for(inp, slug):
        if t["id"] in seen:
            continue
        ev = [e.strip() for e in (t.get("evidence_path") or "").split(";") if e.strip()][:1]
        fnd.append({"id": t["id"], "signature": inp.sig_of.get(t["id"]), "severity": t.get("severity"), "check": None,
                    "title": t.get("title"), "evidence": [resolve_path(e, path) for e in ev], "area": t.get("suspected_area"),
                    "status": t.get("status")})

    def rel(f):
        return bool(ticket) and (f.get("id") in src or f.get("signature") in src or
                                 any(k == "file" and (f.get("area") or "").lower() in v for k, v in btoks if f.get("area")))
    for f in fnd:
        f["relevant"] = rel(f)
    fnd.sort(key=lambda f: (not f["relevant"], {"high": 0, "medium": 1, "low": 2}.get(f.get("severity"), 3), f.get("id") or ""))
    d["findings_total"] = len(fnd)
    d["findings"] = fnd[: CAPS["findings"]]
    # root causes on this lens
    d["root_causes"] = [OrderedDict([("signature", r["signature"]), ("severity", r.get("severity")), ("lenses", len(r.get("lenses") or [])),
                                     ("title", r.get("title")), ("area", r.get("suspected_area")),
                                     ("anchor", "root_causes.md#" + r["signature"])])
                        for r in sorted(inp.rc, key=lambda r: r["signature"]) if slug in (r.get("lenses") or [])]
    # premap / upgrade findings
    pf = list(rec.get("premap_findings") or [])
    ta = rec.get("two_account")
    d["two_account"] = (OrderedDict([("status", ta.get("status")), ("replayed", ta.get("replayed")),
                                     ("ownership_failures", ta.get("ownership_failures")),
                                     ("public_intended", ta.get("public_intended")), ("reason", ta.get("reason"))])
                        if isinstance(ta, dict) else None)
    d["premap_findings"] = [OrderedDict([("class", p.get("class")), ("control", p.get("control_id")), ("sid", p.get("sid")),
                                         ("title", p.get("title")),
                                         ("evidence", [resolve_path(e, path) for e in (p.get("evidence") or [])[:1]])])
                            for p in sorted(pf, key=lambda p: (p.get("class") or "", p.get("control_id") or ""))]
    d["premap_counts"] = OrderedDict(sorted(Counter(p.get("class") for p in pf).items()))
    if not v2:
        d["controls"] = None
        d["endpoints"] = None
        d["endpoint_note"] = "v1 record: no endpoint data"
    else:
        ctl = []
        for c in rec.get("controls") or []:
            reqs = c.get("requests") or []
            hit = False
            for q in reqs:
                pth = (q.get("path") or "").lower()
                act = (q.get("lens_action") or "")
                act = act.lower() if isinstance(act, str) else ""
                for k, v in btoks:
                    if (k == "path" and (pattern_match(express_pattern(v), pth) or pth.startswith(v.rstrip("/") + "/"))) or (k == "action" and act == v):
                        hit = True
            ctl.append((c, hit, sum(q.get("n", 1) for q in reqs)))
        if ticket and any(h for _c, h, _n in ctl):
            ctl = [x for x in ctl if x[1]]
            d["controls_match"] = "requests hitting a path/action named in ticket.backend"
        elif ticket:
            d["controls_match"] = "no request matches ticket.backend: top controls by request count"
        ctl.sort(key=lambda x: (not (x[0].get("broken")), -x[2], x[0]["control_id"]))
        rows = []
        for c, _h, _n in ctl:
            reqs = c.get("requests") or []
            q0 = reqs[0] if reqs else {}
            rows.append(OrderedDict([("control", c["control_id"]), ("sid", c.get("sid")), ("name", c.get("name")),
                                     ("exercised", c.get("exercised", True)), ("reason", c.get("reason")),
                                     ("effect", c.get("effect")),
                                     ("calls", ["%s %s %s" % (q.get("method"), q.get("path"), q.get("status") if q.get("status") is not None else (q.get("error") or "failed"))
                                                for q in reqs[:3]]),
                                     ("more_calls", max(0, len(reqs) - 3)),
                                     ("max_ms", max([q.get("ms") or 0 for q in reqs] or [0])),
                                     ("actions", sorted({"%s.%s" % (a.get("domain"), a.get("action")) if isinstance(a, dict) else str(a)
                                                         for a in (c.get("lens_actions") or [])})),
                                     ("broken", c.get("broken") or [])]))
        d["controls_total"] = len(rows)
        d["controls"] = rows[: CAPS["controls"]]
        eps = sorted(rec.get("endpoints") or [], key=lambda e: (all(str(k).startswith("2") for k in (e.get("statuses") or {})), -e.get("n", 0), e.get("path") or ""))
        d["endpoints_total"] = len(eps)
        d["endpoints"] = [OrderedDict([("method", e.get("method")), ("path", e.get("path")), ("statuses", e.get("statuses")),
                                       ("n", e.get("n")), ("write", e.get("write")), ("max_ms", e.get("max_ms"))]) for e in eps[: CAPS["endpoints"]]]
        d["actions"] = rec.get("actions") or []
    # registry diff (defects only; noise separate)
    rd = inp.regdiff(slug)
    if rd is not None:
        d["registry"] = OrderedDict([("registry_sha", rd.get("registry_sha")), ("source", inp.registry.get("source")),
                                     ("build_match", rd.get("build_match")), ("note", rd.get("note")),
                                     ("counts", rd.get("counts")), ("noise_unmatched_but_ok", rd.get("noise") if isinstance(rd.get("noise"), int) else len(rd.get("noise") or [])),
                                     ("defects", [OrderedDict([("class", x["class"]), ("call", "%s %s" % (x.get("method"), x.get("path"))),
                                                               ("statuses", x.get("statuses")), ("route", x.get("route")),
                                                               ("route_src", x.get("route_src")), ("control", x.get("control_id"))])
                                                  for x in (rd.get("defects") or [])][: CAPS["registry"]]),
                                     ("defects_total", len(rd.get("defects") or [])),
                                     ("registered_not_observed", (rd.get("registered_not_observed") or {}).get("count", 0)),
                                     ("no_fe_caller", (rd.get("no_fe_caller") or {}).get("actions", [])[:12]),
                                     ("no_fe_caller_total", (rd.get("no_fe_caller") or {}).get("count", 0))])
    else:
        d["registry"] = None
    # run diff
    if inp.prev is not None:
        prv = inp.prev.get(slug)
        if prv is None:
            d["run_diff"] = OrderedDict([("note", "lens not in the previous run")])
        else:
            cur_c, prv_c = RD.controls_of(rec), RD.controls_of(prv[1])
            cnt, rows = Counter(), []
            for sid, (label, br) in cur_c.items():
                b = prv_c.get(sid)
                cat = ("new_broken" if br else "unchanged_ok") if b is None else ("fixed" if b[1] and not br else "new_broken" if br and not b[1] else "unchanged_broken" if br else "unchanged_ok")
                cnt[cat] += 1
                if cat in ("new_broken", "fixed"):
                    rows.append("%s %s (%s)" % (cat, label, sid))
            for sid, (label, _br) in prv_c.items():
                if sid not in cur_c:
                    cnt["disappeared"] += 1
            d["run_diff"] = OrderedDict([("prev_run", run_id_of(prv[0])), ("prev_build", (deploy_of(prv[1]).get("backend_sha") or "")[:12] or None),
                                         ("cur_build", d["build_sha"]),
                                         ("counts", OrderedDict((k, cnt.get(k, 0)) for k in RD.CATS)), ("rows", sorted(rows)[:15])])
    # screenshots: failure first, then initial; pointers only
    shots = []
    for s in rec.get("screenshots") or []:
        if s.get("kind") == "failure":
            shots.append(resolve_path(s["path"], path))
    if rec.get("initial_evidence"):
        shots.append(resolve_path(rec["initial_evidence"], path))
    for f in fnd:
        shots.extend(f.get("evidence") or [])
    shots = list(dict.fromkeys(s for s in shots if s))
    d["screenshots_total"] = len(shots)
    d["screenshots"] = shots[: CAPS["shots"]]
    ot = [t["id"] for t in fix_tickets_for(inp, slug)]
    d["open_tickets_total"] = len(ot)
    d["open_tickets"] = ot[: CAPS["tickets"]]
    return d


# ------------------------------------------------------------------ markdown sections
class Section:
    def __init__(self, key, title, lines, trim_rank, more_path):
        self.key, self.title, self.lines, self.rank, self.more_path = key, title, list(lines), trim_rank, more_path
        self.cut = 0

    def render(self):
        out = ([self.title] if self.title else []) + self.lines
        if self.cut:
            out.append("+%d more (see %s)" % (self.cut, self.more_path))
        return out


def lens_sections(d, prefix, more, rank_base):
    """d = lens_data; prefix: heading prefix ('##' lens packet, '###' inside a ticket)."""
    S = []
    slug = d["slug"]
    if not d.get("walked"):
        S.append(Section(slug + ".cov", "%s %s" % (prefix, slug), ["coverage: lens not walked this run"], 0, more))
        return S
    hdr = ["build: %s" % d["build_verdict"],
           "run %s · walked %s · record schema %s%s" % (d["run_id"], d["walked_at"] or "?", d["schema"],
                                                        (" · frontend %s" % d["frontend_build"]) if d.get("frontend_build") else "")]
    hdr += ["⚠ %s" % f for f in d["flags"]]
    cov = d["coverage"]
    chk = ", ".join("%s %s" % (k, v) for k, v in cov["checks"].items())
    hdr.append("coverage: attempted · %s%s%s" % (chk, (" · not run: " + ", ".join(cov["not_run"])) if cov["not_run"] else "",
                                                 " · BUDGET ABORTED" if cov["budget_aborted"] else ""))
    S.append(Section(slug + ".hdr", "%s %s" % (prefix, slug), hdr, 0, more))
    f = ["- %s%s %s (%s) %s%s" % ("★ " if x.get("relevant") else "", x["id"], x.get("signature") or "-", x.get("severity") or "?",
                                   cell(x.get("title"), 90), (" · " + x["evidence"][0]) if x.get("evidence") else "")
         for x in d["findings"]]
    if d["findings_total"] > len(d["findings"]):
        f.append("(%d of %d findings shown)" % (len(d["findings"]), d["findings_total"]))
    S.append(Section(slug + ".findings", "findings (%d):" % d["findings_total"], f or ["- none open"], rank_base + 9, more))
    if d["premap_findings"]:
        pc = ", ".join("%s %d" % kv for kv in d["premap_counts"].items())
        if d.get("two_account"):
            ta = d["two_account"]
            S[0].lines.append("two-account check: %s · replayed %s · ownership failures %s%s" % (
                ta["status"], ta["replayed"] if ta["replayed"] is not None else "-", ta["ownership_failures"] if ta["ownership_failures"] is not None else "-",
                (" · " + cell(ta["reason"], 100)) if ta.get("reason") else ""))
        S.append(Section(slug + ".premap", "premap findings (%s):" % pc,
                         ["- %s %s [%s] %s%s" % (p["class"], p["control"], p["sid"] or "-", cell(p["title"], 90),
                                                 (" · " + p["evidence"][0]) if p["evidence"] else "") for p in d["premap_findings"][:15]],
                         rank_base + 7, more))
    if d.get("controls") is None:
        S.append(Section(slug + ".controls", "controls → endpoints → actions: v1 record: no endpoint data", [], 0, more))
    else:
        rows = ["| control | sid | effect | calls | ms | action | broken |", "|---|---|---|---|---:|---|---|"]
        for c in d["controls"]:
            calls = "; ".join(c["calls"]) + (" +%d" % c["more_calls"] if c["more_calls"] else "")
            rows.append("| %s | %s | %s | %s | %s | %s | %s |" % (
                cell(c["control"], 44), c["sid"] or "-", c["effect"] or ("skipped: " + str(c["reason"]) if not c["exercised"] else "-"),
                cell(calls or "no call", 110), c["max_ms"] or "", ", ".join(c["actions"]) or "–", ", ".join(c["broken"]) or ""))
        t = "controls → endpoints → actions (%d of %d%s):" % (len(d["controls"]), d["controls_total"],
                                                              ("; " + d["controls_match"]) if d.get("controls_match") else "")
        S.append(Section(slug + ".controls", t, rows, rank_base + 5, more))
        er = ["- %s %s %s ×%s%s%s" % (e["method"], e["path"], ",".join("%s:%s" % kv for kv in sorted((e["statuses"] or {}).items())),
                                      e["n"], " write" if e["write"] else "", (" max %sms" % e["max_ms"]) if e["max_ms"] else "")
              for e in d["endpoints"]]
        S.append(Section(slug + ".endpoints", "endpoints (%d of %d):" % (len(d["endpoints"]), d["endpoints_total"]), er or ["- none"], rank_base + 4, more))
    r = d.get("registry")
    if r is None:
        S.append(Section(slug + ".registry", "registry diff: no registry given", [], 0, more))
    else:
        c = r["counts"] or {}
        head = "registry diff @ %s (repo source; build_match %s): real_missing %d · matched_failing %d · noise unmatched_but_ok %d (not bugs) · registered_not_observed %d · no_fe_caller %d" % (
            r["registry_sha"], r["build_match"], c.get("real_missing", 0), c.get("matched_failing", 0), r["noise_unmatched_but_ok"] or 0,
            r["registered_not_observed"], r["no_fe_caller_total"])
        rows = ["- %s %s %s → %s (%s)" % (x["class"], x["call"], ",".join(map(str, x["statuses"] or [])), x["route"] or "no route", x["route_src"] or "-")
                for x in r["defects"]]
        if r["no_fe_caller"]:
            rows.append("- no FE caller: " + ", ".join(r["no_fe_caller"]) + (" +%d" % (r["no_fe_caller_total"] - len(r["no_fe_caller"])) if r["no_fe_caller_total"] > len(r["no_fe_caller"]) else ""))
        if r.get("note"):
            rows.append("- note: " + r["note"])
        S.append(Section(slug + ".registry", head, rows, rank_base + 3, more))
    if d.get("run_diff"):
        rd = d["run_diff"]
        if "counts" in rd:
            c = rd["counts"]
            S.append(Section(slug + ".rundiff", "run diff vs %s (%s → %s): %d fixed · %d new broken · %d still broken · %d gone" % (
                rd["prev_run"], rd["prev_build"] or "?", rd["cur_build"] or "?", c["fixed"], c["new_broken"], c["unchanged_broken"], c["disappeared"]),
                ["- " + x for x in rd["rows"]], rank_base + 2, more))
        else:
            S.append(Section(slug + ".rundiff", "run diff: " + rd["note"], [], 0, more))
    S.append(Section(slug + ".shots", "screenshots (%d of %d, paths only):" % (len(d["screenshots"]), d["screenshots_total"]),
                     ["- " + s for s in d["screenshots"]] or ["- none"], rank_base + 1, more))
    ot = d["open_tickets"]
    extra = d["open_tickets_total"] - len(ot)
    S.append(Section(slug + ".tickets", "open fix tickets (%d): %s%s" % (d["open_tickets_total"], ", ".join(ot) or "none", (" +%d" % extra) if extra else ""),
                     [], 0, more))
    return S


MAX_FULL_LENSES = 4


def compact_row(d):
    if not d.get("walked"):
        return "| %s | lens not walked this run | – | – | – | – | – |" % d["slug"]
    reg = d.get("registry") or {}
    return "| %s | %s %s | %s%s | %d | %s | %s | %d |" % (
        d["slug"], d["run_id"], d["schema"], d["build_sha"] or "UNKNOWN", " ⚠" if d["flags"] else "", d["findings_total"],
        ", ".join("%s %d" % kv for kv in d["premap_counts"].items()) or "–",
        reg.get("defects_total", "–") if reg else "–", d["open_tickets_total"])


def render(sections, footer):
    out = []
    for s in sections:
        out.extend(s.render())
        out.append("")
    out.extend(footer)
    return "\n".join(out).rstrip() + "\n"


def fit(sections, footer_fn, cap):
    """Trim the lowest-ranked trimmable sections first (rank 1 = trimmed first) until under cap."""
    text = render(sections, footer_fn(sections))
    order = sorted([s for s in sections if s.rank > 0], key=lambda s: (s.rank, -sections.index(s)))
    for s in order:
        while len(text.encode("utf-8")) > cap and len(s.lines) > 1:
            s.lines.pop()
            s.cut += 1
            text = render(sections, footer_fn(sections))
        if len(text.encode("utf-8")) <= cap:
            break
    if len(text.encode("utf-8")) > cap:
        raise OverCap("%d bytes > %d after trimming" % (len(text.encode("utf-8")), cap))
    return text


def footer(paths):
    def fn(sections):
        cut = ["%s: %d line(s)" % (s.key, s.cut) for s in sections if s.cut]
        lines = ["## Not in this packet",
                 "- request/response bodies, field values, screenshots themselves, plan prose (pointers only)"]
        if cut:
            lines.append("- trimmed to fit the size cap: " + "; ".join(cut))
        for p in paths:
            lines.append("- full record: %s" % p)
        return lines
    return fn


# ------------------------------------------------------------------ packets
def inputs_line(inp, hashes):
    return "inputs: " + " ".join("%s=%s" % (k, (v or "none")[:8]) for k, v in hashes.items())


def lens_packet(inp, slug):
    d = lens_data(inp, slug)
    path = d.get("record")
    hashes = OrderedDict([("tickets", inp.h("master_tickets")), ("steps", inp.h("master_v1_full")),
                          ("lens_md", (sha256_file(inp.lens_md(slug)) or "")[:16] or None),
                          ("record", (sha256_file(path) or "")[:16] or None), ("registry", inp.h("registry")),
                          ("fix_tickets", inp.h("fix_tickets")), ("fold", inp.h("fold")), ("root_causes", inp.h("root_causes"))])
    if inp.prev is not None and slug in inp.prev:
        hashes["prev_record"] = (sha256_file(inp.prev[slug][0]) or "")[:16]
    more = path or "(no record)"
    mts = tickets_for(inp, slug)
    star = [t["id"] for t in inp.tickets.values() if "*" in t.get("lenses", [])]
    steps = steps_for(inp, slug)
    star_steps = [s["id"] for s in inp.steps if "*" in (s.get("lenses") or [])]
    S = [Section("head", "# lens %s · packet lens-%s" % (slug, slug),
                 [inputs_line(inp, hashes), "stub: %s" % (inp.lens_md(slug) or "none in LENS-INDEX/")], 0, more)]
    S.append(Section("tickets", "## Master tickets (%d) + cross-cutting (%d)" % (len(mts), len(star)),
                     ["| id | wave | gate | title |", "|---|---|---|---|"] +
                     ["| %s | %s | %s | %s |" % (t["id"], t.get("wave"), t.get("gate"), cell(t.get("title"), 100)) for t in mts] +
                     ["cross-cutting (`*`): " + ", ".join(star)], 12, inp.paths["master_tickets"]))
    S.append(Section("steps", "## Master-plan V1 steps tagged `%s` (%d, all) + `*` steps (%d)" % (slug, len(steps), len(star_steps)),
                     ["- %s · w%s · %s · %s" % (s["id"], s.get("wave"), s.get("master_parent") or "-", cell(s.get("title"), 90)) for s in steps] +
                     ["- `*` step ids: " + ", ".join(star_steps)], 10, inp.paths["master_v1_full"]))
    if d.get("walked") and d["root_causes"]:
        S.append(Section("rc", "## Root causes touching `%s` (%d, pointers)" % (slug, len(d["root_causes"])),
                         ["- `%s` (%s, %d lenses) %s · %s · %s" % (r["signature"], r["severity"], r["lenses"], cell(r["title"], 70), r["area"], r["anchor"])
                          for r in d["root_causes"]], 8, inp.paths.get("root_causes") or "-"))
    S += lens_sections(d, "## Walk:", more, 0)
    text = fit(S, footer([more]), LENS_CAP)
    js = OrderedDict([("packet", "lens-" + slug), ("kind", "lens"), ("slug", slug), ("inputs", hashes),
                      ("master_tickets", [t["id"] for t in mts]), ("cross_cutting_tickets", star),
                      ("steps", [OrderedDict([("id", s["id"]), ("wave", s.get("wave")), ("parent", s.get("master_parent")), ("title", s.get("title"))]) for s in steps]),
                      ("star_steps", star_steps), ("walk", d), ("trimmed", OrderedDict((s.key, s.cut) for s in S if s.cut))])
    return text, js, hashes


def ticket_packet(inp, tid):
    t = inp.tickets[tid]
    lenses = [l for l in t.get("lenses", []) if l != "*"]
    star = "*" in t.get("lenses", [])
    hashes = OrderedDict([("tickets", inp.h("master_tickets")), ("steps", inp.h("master_v1_full")), ("child_map", inp.h("child_map")),
                          ("registry", inp.h("registry")), ("fix_tickets", inp.h("fix_tickets")), ("fold", inp.h("fold")),
                          ("root_causes", inp.h("root_causes"))])
    for l in lenses:
        p = inp.records.get(l, (None,))[0]
        hashes["record:" + l] = (sha256_file(p) or "")[:16] or None
    S = [Section("head", "# packet %s · %s · wave %s · %s" % (tid, cell(t.get("title"), 110), t.get("wave"), t.get("gate")),
                 [inputs_line(inp, hashes), "gate reason: " + cell(t.get("gate_reason"), 300)], 0, "-")]
    deps = []
    for dep in t.get("depends_on") or []:
        dt = inp.tickets.get(dep)
        deps.append("%s (%s)" % (dep, ("wave %s, %s; status not tracked in the index" % (dt.get("wave"), dt.get("gate"))) if dt else "not in MASTER-TICKETS"))
    S[0].lines.append("depends_on: " + ("; ".join(deps) if deps else "none"))
    if inp.fix_commits.get(tid):
        S[0].lines.append("fix commit: %s" % inp.fix_commits[tid][:12])
    ptr = sorted({"%s#%s" % (c["plan"], c["orig_id"]) for c in inp.child if c.get("master_id") == tid})
    steps = [s for s in inp.steps if s.get("master_parent") == tid]
    ptr += sorted({"%s#%s" % (p, s["id"]) for s in steps for p in (s.get("plans") or [])} - set(ptr))
    unmapped = [s for s in t.get("source_ids") or [] if not any(s in p for p in ptr)]
    S.append(Section("src", "## Sources (pointers only, %d)" % len(ptr), ["- " + p for p in ptr] + (["- source ids: " + ", ".join(unmapped)] if unmapped else []),
                     6, inp.paths["child_map"]))
    S.append(Section("done", "## Done", ["done: " + cell(t.get("done_criteria"), 600), "hook: " + cell(t.get("walker_recipe_hook"), 400),
                                         "backend: " + "; ".join(cell(b, 120) for b in t.get("backend") or [])], 0, "-"))
    if steps:
        S.append(Section("steps", "## V1 steps under this ticket (%d)" % len(steps),
                         ["- %s · w%s · %s" % (s["id"], s.get("wave"), cell(s.get("title"), 90)) for s in steps], 7, inp.paths["master_v1_full"]))
    datas = []
    if star:
        sigs = [r for r in inp.rc if r["signature"] in set(t.get("source_ids") or [])]
        lines = []
        for r in sigs:
            still = sorted(set(r.get("lenses") or []) & set(inp.records))
            lines.append("- `%s`: %d lens(es) still failing in this run · e.g. %s" % (r["signature"], len(still), ", ".join((r.get("evidence") or [])[:3]) or "-"))
        fails = Counter()
        for _s, (_p, rec) in inp.records.items():
            for k, v in (rec.get("checks") or {}).items():
                if (v or {}).get("status") in ("FAIL", "ERROR"):
                    fails[k] += 1
        lines.append("- walked lenses: %d · failing checks: %s" % (len(inp.records), ", ".join("%s %d" % kv for kv in sorted(fails.items())) or "none"))
        top = sorted(inp.rc, key=lambda r: (-r.get("count", 0), r["signature"]))[:5]
        lines += ["- top root cause `%s` (%s tickets, %d lenses)" % (r["signature"], r.get("count"), len(r.get("lenses") or [])) for r in top]
        S.append(Section("shell", "## `*` shell summary (not every lens; see lens-<slug>.md)", lines, 5, "packets/lens-*.md"))
    paths = []
    compact = len(lenses) > MAX_FULL_LENSES
    rows = []
    for i, l in enumerate(lenses):
        d = lens_data(inp, l, ticket=t)
        datas.append(d if not compact else OrderedDict(
            [("slug", l), ("walked", d.get("walked")), ("run_id", d.get("run_id")), ("schema", d.get("schema")),
             ("build_sha", d.get("build_sha")), ("flags", d.get("flags")), ("build_verdict", d.get("build_verdict")),
             ("findings_total", d.get("findings_total")), ("premap_counts", d.get("premap_counts")),
             ("registry_defects", (d.get("registry") or {}).get("defects_total")), ("open_tickets_total", d.get("open_tickets_total")),
             ("packet", "lens-%s" % l.replace("/", "__"))]))
        more = d.get("record") or "(no record)"
        paths.append(more)
        if compact:
            rows.append(compact_row(d))
        else:
            S += lens_sections(d, "## Lens:", more, 0)
        if not slug_known(l, inp.dirs):
            S.append(Section(l + ".unknown", "⚠ lens slug `%s` is not under app/lenses at the registry sha" % l, [], 0, "-"))
    if compact:
        S.append(Section("lenses", "## Lenses (%d; one row each -- the per-lens slots are in packets/lens-<slug>.md)" % len(lenses),
                         ["| lens | walked | build | findings | premap | registry defects | open tickets |", "|---|---|---|---:|---|---:|---:|"] + rows,
                         4, "packets/lens-<slug>.md"))
        paths = ["packets/lens-<slug>.md for each lens above"]
    text = fit(S, footer(paths or ["(no lens record: ticket has no lens)"]), TICKET_CAP)
    js = OrderedDict([("packet", "packet-" + tid), ("kind", "ticket"), ("id", tid), ("title", t.get("title")), ("wave", t.get("wave")),
                      ("gate", t.get("gate")), ("depends_on", t.get("depends_on")), ("inputs", hashes), ("sources", ptr),
                      ("steps", [s["id"] for s in steps]), ("lenses", datas), ("fix_commit", inp.fix_commits.get(tid)),
                      ("trimmed", OrderedDict((s.key, s.cut) for s in S if s.cut))])
    return text, js, hashes


def write(out, name, text, js, cap):
    os.makedirs(out, exist_ok=True)
    data = json.dumps(js, indent=1, sort_keys=False, ensure_ascii=False) + "\n"
    if len(data.encode("utf-8")) > 4 * cap:
        raise OverCap("%s.json is %d bytes > %d" % (name, len(data.encode("utf-8")), 4 * cap))
    with open(os.path.join(out, name + ".md"), "w", encoding="utf-8") as f:
        f.write(text)
    with open(os.path.join(out, name + ".json"), "w", encoding="utf-8") as f:
        f.write(data)
    return len(text.encode("utf-8"))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--index", required=True)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--run")
    g.add_argument("--runs")
    ap.add_argument("--registry")
    ap.add_argument("--fix-tickets")
    ap.add_argument("--fold")
    ap.add_argument("--root-causes")
    pg = ap.add_mutually_exclusive_group()
    pg.add_argument("--prev-run")
    pg.add_argument("--prev-runs")
    ap.add_argument("--repo")
    ap.add_argument("--fix-commit", action="append")
    ap.add_argument("--check-live", action="store_true")
    ap.add_argument("--base-url")
    ap.add_argument("--out", required=True)
    ap.add_argument("--ticket", action="append")
    ap.add_argument("--lens", action="append")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--link-latest", action="store_true")
    a = ap.parse_args(argv)
    if not (a.ticket or a.lens or a.all):
        ap.error("one of --ticket, --lens, --all is required")
    inp = Inputs(a)
    if a.check_live:
        from concord_walker.lensrecord import deploy_stamp
        base = a.base_url or next((deploy_of(r).get("base_url") for _p, r in inp.records.values() if deploy_of(r).get("base_url")), None)
        if not base:
            raise SystemExit("--check-live needs --base-url (no record carries deploy.base_url)")
        inp.live_sha = deploy_stamp(base, fetch=getattr(a, "_fetch", None)).get("backend_sha")
        inp.live_checked = True
    bad = []
    if a.all:
        tids = list(inp.tickets)
        slugs = sorted({l for t in inp.tickets.values() for l in t.get("lenses", []) if l != "*"})
    else:
        tids = a.ticket or []
        slugs = a.lens or []
    for tid in tids:
        if tid not in inp.tickets:
            print("unknown ticket %s" % tid, file=sys.stderr)
            return 2
    for s in slugs:
        if not slug_known(s, inp.dirs) or (inp.dirs is None and s not in inp.records and not inp.lens_md(s)
                                          and not any(s in t.get("lenses", []) for t in inp.tickets.values())
                                          and not steps_for(inp, s)):
            bad.append(s)
    for tid in tids:
        bad += [l for l in inp.tickets[tid].get("lenses", []) if not slug_known(l, inp.dirs)]
    if a.lens and bad:
        print("unknown lens slug(s): %s" % ", ".join(sorted(set(bad))), file=sys.stderr)
        return 2
    index = OrderedDict()
    over = []
    for tid in tids:
        try:
            text, js, h = ticket_packet(inp, tid)
            n = write(a.out, "packet-" + tid, text, js, TICKET_CAP)
            index["packet-" + tid] = OrderedDict([("bytes", n), ("sha256", hashlib.sha256(text.encode()).hexdigest()[:16]), ("inputs", h)])
        except OverCap as e:
            over.append("packet-%s: %s" % (tid, e))
    for s in sorted(set(slugs) - set(bad)):
        try:
            text, js, h = lens_packet(inp, s)
            n = write(a.out, "lens-" + s.replace("/", "__"), text, js, LENS_CAP)
            index["lens-" + s] = OrderedDict([("bytes", n), ("sha256", hashlib.sha256(text.encode()).hexdigest()[:16]), ("inputs", h)])
        except OverCap as e:
            over.append("lens-%s: %s" % (s, e))
    meta = OrderedDict([("index", os.path.abspath(a.index)), ("registry", a.registry and os.path.abspath(a.registry)),
                        ("unknown_slugs", sorted(set(bad))), ("over_cap", over), ("packets", index)])
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "INDEX.json"), "w") as f:
        json.dump(meta, f, indent=1)
        f.write("\n")
    if a.link_latest:
        link = os.path.join(os.path.dirname(os.path.abspath(a.out.rstrip("/"))), "..", "packets", "latest")
        link = os.path.normpath(link)
        os.makedirs(os.path.dirname(link), exist_ok=True)
        if os.path.islink(link):
            os.unlink(link)
        os.symlink(os.path.abspath(a.out), link)
    print("packed %d packet(s) -> %s%s%s" % (len(index), a.out, (" · OVER CAP: " + "; ".join(over)) if over else "",
                                            (" · unknown slugs: " + ", ".join(sorted(set(bad)))) if bad else ""))
    if over:
        return 3
    if bad:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
