"""GB-1575 W2 — the per-lens redesign dossier (offline).

Emits, per lens, dossiers/<lens>@<build12>.json + .md from a FINISHED walk
run's output (lens records + wiring + walk-manifest + reverify.jsonl) plus a
read-only `git show` of the Concord repo at the walk build. Nothing here
walks, signs in, or touches a live run: it reads a completed run dir and a
git object store only, so it is usable the moment a walk ends.

Sections (GB-1575 §W2):
  1. inventory    controls by role from the record + live labels; duplicate
                  controls; components under components/<lens>/ at the walk
                  build split mounted vs orphaned by import-graph
                  reachability from the lens's app entry.
  2. backend      macros/routes the lens calls (record actions[] + wiring)
                  vs what its domain(s) expose at the walk build (the
                  action_registry build), so hidden/unmounted features show.
  3. code-scan    named, conservative pattern flags over the lens's domain
                  file(s) and frontend files at the walk build. A flag is a
                  scan hit for human review, never a verdict. Plus the W1
                  redesign-study checks (walker/analysis/
                  redesign_misses.jsonl) consumed at runtime when present.
  4. findings     the lens's walk findings grouped by root cause (the
                  finding `signature`), and replay verdicts for its tickets
                  (reverify.jsonl rows + the record's own replay block).
  5. gates        polished / stacking / wiring / security detector — each
                  PASS, FAIL or NOT_RUN with its inputs named (definitions
                  below; GB-1575 names the gates without defining them, so
                  these operational definitions are the dossier's own and
                  are printed in every dossier). Plus core_verb (GB-1576
                  W5a): the record's core-verb verdict, carried as a gate
                  so the polished rule below can read it.
  6. score        "distance to bar": 100 = at the bar. Deterministic
                  deductions, every input printed with the score:
                    security/money code-scan flag  -15 each (cap -45)
                    other code-scan flag            -8 each (cap -24)
                    orphaned component              -3 each (cap -15)
                    hidden backend feature          -2 each (cap -10)
                    open root cause, by its max severity:
                      critical -10 / high -6 / medium -3 / low -1 (cap -30)
                    replay REOPENED ticket          -5 each (cap -15)
                    gate FAIL                       -5 each
                    core verb FAIL                  -40 (GB-1576 W5a)
                    core verb UNSPECIFIED           -10 (a present verdict;
                    an absent core-verb block — the phase did not run —
                    deducts nothing)
                  Floor 0. A platform INDEX ranks all lenses by score.

Gate definitions (the dossier's, printed in the output):
  polished          FAIL when an open finding's signature/check is in the
                    contrast / overflow / a11y / unnamed-control class,
                    or when the lens's core verb verdicts CORE_VERB_FAIL
                    (GB-1576: a lens cannot be called polished if its
                    core verb fails).
  stacking          FAIL when an open finding is in the escape / overlay /
                    expand class (panels stacking or not dismissing).
  wiring            FAIL when the wiring capture is absent or its
                    provenance is not clean_happy_path (gate §12).
  security detector FAIL when the two-account check FAILs, an ownership
                    premap finding exists, or a security-class code-scan
                    flag fired.
  A gate is NOT_RUN when its deciding input was not produced (the manifest
  lists the check as not run, or the input file is absent).
"""
import json, os, re, subprocess, sys
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER_DIR = os.path.dirname(HERE)
sys.path.insert(0, WALKER_DIR)

SEV_POINTS = {"critical": 10, "high": 6, "medium": 3, "low": 1, "info": 0}
SEV_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}

SCORE_FORMULA = (
    "score = max(0, 100 - deductions); deductions: security/money scan flag "
    "-15 ea (cap 45) | other scan flag -8 ea (cap 24) | orphaned component "
    "-3 ea (cap 15) | hidden backend feature -2 ea (cap 10) | open root "
    "cause by max severity critical -10 / high -6 / medium -3 / low -1 "
    "(cap 30) | replay REOPENED -5 ea (cap 15) | gate FAIL -5 ea | core "
    "verb FAIL -40 / UNSPECIFIED -10 (absent block deducts nothing)")


# ------------------------------------------------------------------ git tree
class GitShow:
    """Read-only view of a repo at one sha (git ls-tree / git show only)."""

    def __init__(self, repo, sha):
        self.repo, self.sha = repo, sha

    def ls(self, prefix):
        out = subprocess.run(["git", "-C", self.repo, "ls-tree", "-r",
                              "--name-only", self.sha, "--", prefix],
                             capture_output=True, text=True, timeout=300)
        if out.returncode != 0:
            return []
        return [l for l in out.stdout.splitlines() if l]

    def read(self, path):
        out = subprocess.run(["git", "-C", self.repo, "show",
                              "%s:%s" % (self.sha, path)],
                             capture_output=True, timeout=300)
        return out.stdout.decode("utf-8", "replace") if out.returncode == 0 else ""


def _load_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def _load_jsonl(path):
    rows = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        rows.append(json.loads(line))
                    except Exception:
                        pass
    except Exception:
        pass
    return rows


# ------------------------------------------------------------------ run input
class RunData:
    def __init__(self, run_dir):
        self.run_dir = run_dir
        self.manifest = _load_json(os.path.join(run_dir, "walk-manifest.json")) or {}
        self.records = {}
        self.wiring = {}
        self.labels = {}
        for name in sorted(os.listdir(run_dir)) if os.path.isdir(run_dir) else []:
            p = os.path.join(run_dir, name)
            if name.startswith("lens-") and name.endswith(".json"):
                rec = _load_json(p)
                if rec is not None:
                    self.records[name[5:-5]] = rec
            elif name.startswith("wiring-") and name.endswith(".json"):
                doc = _load_json(p)
                if doc is not None:
                    self.wiring[name[7:-5]] = doc
            elif name == "live_labels.json":
                doc = _load_json(p) or {}
                self.labels = doc.get("lenses", {}) or {}
        self.reverify = _load_jsonl(os.path.join(run_dir, "reverify.jsonl"))
        m = {}
        for e in self.manifest.get("lenses", []) or []:
            if isinstance(e, dict) and e.get("slug"):
                m[e["slug"]] = e
        self.manifest_by_slug = m

    def slugs(self):
        return sorted(set(self.records) | set(self.manifest_by_slug))


# ------------------------------------------------------------------ inventory
def _inventory(rec, labels):
    controls = rec.get("controls", []) or []
    by_role = {}
    seen = {}
    exercised = 0
    for c in controls:
        role = c.get("role") or "unknown"
        name = (c.get("name") or "").strip()
        by_role.setdefault(role, [])
        if name and name not in by_role[role]:
            by_role[role].append(name)
        if name:
            key = (role, name)
            seen[key] = seen.get(key, 0) + 1
        if c.get("exercised"):
            exercised += 1
    dups = [{"role": r, "name": n, "count": k}
            for (r, n), k in sorted(seen.items()) if k > 1]
    lab = labels or {}
    return OrderedDict([
        ("controls_total", len(controls)),
        ("controls_exercised", exercised),
        ("by_role", OrderedDict((r, sorted(v)) for r, v in sorted(by_role.items()))),
        ("tabs", lab.get("tabs", [])),
        ("inputs", lab.get("inputs", [])),
        ("labels", lab.get("labels", [])),
        ("duplicates", dups),
    ])


_IMPORT_RE = re.compile(r"(?:from\s+|import\s*\(\s*|require\(\s*)[\"']([^\"']+)[\"']")


def _resolve_import(spec, from_dir, fe_root):
    """Resolve an import specifier to a repo path, or None when external."""
    if spec.startswith("@/"):
        base = fe_root + "/" + spec[2:]
    elif spec.startswith("."):
        base = os.path.normpath(os.path.join(from_dir, spec)).replace(os.sep, "/")
    else:
        return None
    cands = [base, base + ".tsx", base + ".ts", base + ".jsx", base + ".js",
             base + "/index.tsx", base + "/index.ts", base + "/index.jsx",
             base + "/index.js"]
    return cands


def _components(tree, slug):
    """Mounted vs orphaned components under components/<lens>/ at the build."""
    fe = "concord-frontend"
    comp_dir = "%s/components/%s" % (fe, slug)
    comp_files = [p for p in tree.ls(comp_dir)
                  if p.rsplit(".", 1)[-1] in ("tsx", "ts", "jsx", "js")]
    if not comp_files:
        return OrderedDict([("dir", None), ("files", []), ("mounted", []),
                            ("orphaned", []),
                            ("note", "no components/%s directory at the walk build" % slug)])
    entry_files = [p for p in tree.ls("%s/app/lenses/%s" % (fe, slug))
                   if p.rsplit(".", 1)[-1] in ("tsx", "ts", "jsx", "js")]
    existing = set(tree.ls(fe))
    reachable = set(entry_files)
    queue = list(entry_files)
    while queue:
        cur = queue.pop()
        text = tree.read(cur)
        for spec in _IMPORT_RE.findall(text):
            for cand in _resolve_import(spec, os.path.dirname(cur), fe) or []:
                if cand in existing and cand not in reachable:
                    reachable.add(cand)
                    queue.append(cand)
                    break
    mounted = sorted(p for p in comp_files if p in reachable)
    orphaned = sorted(p for p in comp_files if p not in reachable)
    return OrderedDict([("dir", comp_dir), ("files", sorted(comp_files)),
                        ("mounted", mounted), ("orphaned", orphaned),
                        ("note", None)])


# ------------------------------------------------------------------ backend reach
def _registry(tree):
    """The action registry at the walk build (tools/action_registry.build)."""
    import importlib.util
    path = os.path.join(WALKER_DIR, "tools", "action_registry.py")
    spec = importlib.util.spec_from_file_location("ulw_action_registry", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.build(mod.GitTree(tree.repo, tree.sha), tree.sha)


def _backend_reach(rec, wiring, registry, slug):
    called = {}
    for a in rec.get("actions", []) or []:
        if a.get("domain") and a.get("action"):
            called[(a["domain"], a["action"])] = {
                "domain": a["domain"], "action": a["action"],
                "statuses": a.get("statuses"), "source": "record"}
    routes = {}
    if wiring:
        for c in wiring.get("controls", []) or []:
            for q in c.get("requests", []) or []:
                key = "%s %s" % (q.get("method"), q.get("path"))
                r = routes.setdefault(key, {"method": q.get("method"),
                                            "path": q.get("path"), "n": 0,
                                            "route": q.get("route")})
                r["n"] += int(q.get("n", 1) or 1)
                act = q.get("action")
                if isinstance(act, dict) and act.get("domain") and act.get("action"):
                    called.setdefault((act["domain"], act["action"]),
                                      {"domain": act["domain"],
                                       "action": act["action"],
                                       "statuses": None, "source": "wiring"})
    domains = sorted({d for d, _ in called} | {slug})
    exposed, hidden = [], []
    if registry is not None:
        reg_domains = {a["domain"] for a in registry.get("actions", [])}
        domains = sorted({d for d, _ in called} |
                         ({slug} & reg_domains))
        for a in registry.get("actions", []):
            if a["domain"] in domains:
                row = {"domain": a["domain"], "action": a["action"],
                       "file": a["file"], "line": a["line"],
                       "receipt_class": a.get("receipt_class")}
                exposed.append(row)
                if (a["domain"], a["action"]) not in called:
                    hidden.append(row)
    return OrderedDict([
        ("domains", domains),
        ("called_actions", [called[k] for k in sorted(called)]),
        ("called_routes", [routes[k] for k in sorted(routes)]),
        ("exposed_actions", exposed),
        ("hidden_actions", hidden),
        ("registry", None if registry is None else registry.get("counts")),
    ])


# ------------------------------------------------------------------ code scan
# Named, conservative line patterns. A flag is a scan hit for human review.
_OWNER_TOKENS = re.compile(
    r"owner|actor\.userId|ctx\.userId|userId\s*===|requireAuth|guardAnon|"
    r"isOwner|ownership|createdBy\s*===|authorId\s*===", re.I)
_WRITE_NAME = re.compile(
    r"^(create|update|delete|remove|save|set|add|edit|write|post|submit|"
    r"rename|move|toggle|assign|upload|import|publish|archive|restore)", re.I)
_MONEY_NAME = re.compile(
    r"(tip|purchase|buy|sell|pay|charge|refund|transfer|withdraw|deposit|"
    r"mint|stake|bid|escrow|payout|price|coin|wallet|balance)", re.I)
_LEDGER_TOKENS = re.compile(
    r"ledger|tipContent|purchaseWithRoyalties|fees\.|recordFee|coinTx|"
    r"economy\.|applyFee", re.I)

SCAN_PATTERNS = [
    # (kind, flag class, regex over one line, applies to: domain|frontend|both)
    ("raw_fetch_user_url", "security",
     re.compile(r"\bfetch\(\s*(?!['\"`](/|https?://(localhost|127\.)))[A-Za-z_$]"),
     "domain"),
    ("fabricated_data", "data",
     re.compile(r"Math\.random\(\)|\bfabricat|\bsynthetic\s+(data|timestamp|value)|\bfake[-_ ]?data\b|\bmock[-_ ]?data\b", re.I),
     "both"),
    ("balance_mutation_outside_ledger", "money",
     re.compile(r"\b(balance|walletBalance|coinBalance)\s*(\+|-|\*|/)?="),
     "domain"),
    ("upload_via_json_endpoint", "upload",
     re.compile(r"['\"`]/api/media/upload['\"`](?!-raw)"),
     "both"),
    # GB-1576 W5c: durability risks — state held in a globalThis Map/Set is
    # lost on restart and invisible to other processes; a debounced save is
    # lost if the process dies inside the debounce window. Line-level
    # census (multi-line debounce bodies are a known miss, named in the
    # W5c premise); the runtime half of W5c is the durability phase.
    ("globalthis_state", "durability",
     re.compile(r"\bglobalThis\s*\.\s*[A-Za-z_$][\w$]*\s*=\s*new\s+(?:Map|Set)\b"
                r"|\bglobalThis\s*\["),
     "domain"),
    ("debounced_save", "durability",
     re.compile(r"(?i)\bdebounce\w*\s*\([^)]*(save|persist|flush|sync|write)"
                r"|(save|persist|flush)\w*\s*=\s*debounce"),
     "domain"),
]


def _action_spans(text):
    """Yield (action_name, start_line, span_text) per registerLensAction."""
    lines = text.splitlines()
    starts = []
    rx = re.compile(r"registerLensAction\(\s*[\"']([\w.-]+)[\"']\s*,\s*[\"']([\w.${}-]+)[\"']")
    for i, ln in enumerate(lines):
        m = rx.search(ln)
        if m:
            starts.append((i, m.group(2)))
    for j, (i, name) in enumerate(starts):
        end = starts[j + 1][0] if j + 1 < len(starts) else min(len(lines), i + 120)
        yield name, i + 1, "\n".join(lines[i:end])


def _code_scan(tree, slug, domains, misses):
    flags = []

    def add(kind, cls, file, line, pattern):
        flags.append(OrderedDict([("kind", kind), ("class", cls),
                                  ("file", file), ("line", line),
                                  ("pattern", pattern)]))

    scan_files = []  # (path, applies)
    for d in domains:
        p = "server/domains/%s.js" % d
        scan_files.append((p, "domain"))
    fe_dirs = ["concord-frontend/components/%s" % slug,
               "concord-frontend/app/lenses/%s" % slug]
    for d in fe_dirs:
        for p in tree.ls(d):
            if p.rsplit(".", 1)[-1] in ("tsx", "ts", "jsx", "js"):
                scan_files.append((p, "frontend"))
    for path, applies in scan_files:
        text = tree.read(path)
        if not text:
            continue
        lines = text.splitlines()
        for kind, cls, rx, want in SCAN_PATTERNS:
            if want not in (applies, "both"):
                continue
            for i, ln in enumerate(lines):
                if rx.search(ln):
                    add(kind, cls, path, i + 1, rx.pattern[:60])
        if applies == "domain":
            for name, line_no, span in _action_spans(text):
                if _WRITE_NAME.match(name) and not _OWNER_TOKENS.search(span):
                    add("write_without_owner_check", "security", path,
                        line_no, "action span lacks an owner token")
                if _MONEY_NAME.search(name) and not _LEDGER_TOKENS.search(span):
                    add("money_action_without_ledger_call", "money", path,
                        line_no, "money-named action span lacks a ledger token")
    # W1 study checks for this lens (consumed when the study file exists).
    study = []
    for row in misses or []:
        if row.get("lens") != slug:
            continue
        chk = row.get("check") or {}
        entry = OrderedDict([
            ("id", row.get("id")), ("title", row.get("title")),
            ("kind", chk.get("kind") or row.get("kind")),
            ("status", "study-named")])
        pat = chk.get("pattern") or row.get("pattern")
        if pat and (chk.get("kind") in ("code-scan", "code_scan", "scan")):
            try:
                rx = re.compile(pat)
            except Exception:
                rx = None
            if rx is not None:
                hits = 0
                for path, _a in scan_files:
                    text = tree.read(path)
                    for i, ln in enumerate(text.splitlines()):
                        if rx.search(ln):
                            add("w1_study:%s" % (row.get("id") or "unnamed"),
                                chk.get("class") or "study", path, i + 1,
                                pat[:60])
                            hits += 1
                entry["status"] = "executed (%d hit(s))" % hits
        study.append(entry)
    flags.sort(key=lambda f: (f["file"], f["line"], f["kind"]))
    return OrderedDict([("flags", flags), ("study_checks", study)])


# ------------------------------------------------------------------ findings + replay
def _findings_by_cause(rec, slug):
    groups = {}
    for f in rec.get("findings", []) or []:
        sig = f.get("signature") or f.get("check") or "unspecified"
        g = groups.setdefault(sig, {"signature": sig, "count": 0,
                                    "max_severity": "info", "checks": set(),
                                    "titles": []})
        g["count"] += 1
        sev = (f.get("severity") or "low").lower()
        if SEV_RANK.get(sev, 0) > SEV_RANK.get(g["max_severity"], 0):
            g["max_severity"] = sev
        if f.get("check"):
            g["checks"].add(f["check"])
        t = f.get("title")
        if t and t not in g["titles"]:
            g["titles"].append(t)
    out = []
    for sig in sorted(groups, key=lambda s: (-SEV_RANK.get(groups[s]["max_severity"], 0),
                                             -groups[s]["count"], s)):
        g = groups[sig]
        label = sig[len(slug) + 1:] if sig.startswith(slug + ".") else sig
        out.append(OrderedDict([("signature", sig), ("cause", label),
                                ("count", g["count"]),
                                ("max_severity", g["max_severity"]),
                                ("checks", sorted(g["checks"])),
                                ("titles", g["titles"][:4])]))
    return out


def _replay(run, rec, slug):
    rows = []
    for r in run.reverify:
        tid = str(r.get("id") or "")
        if r.get("lens") == slug or tid.startswith("FIX-%s-" % slug):
            rows.append(OrderedDict([("id", tid),
                                     ("verdict", r.get("verdict")),
                                     ("method", r.get("method"))]))
    counts = {}
    for r in rows:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    in_record = None
    rep = rec.get("replay")
    if isinstance(rep, dict):
        in_record = OrderedDict(
            (k, (len(v) if isinstance(v, list) else v))
            for k, v in sorted(rep.items())
            if not isinstance(v, (dict,)))
    return OrderedDict([("verdicts", rows), ("counts", counts),
                        ("in_record_replay", in_record)])


# ------------------------------------------------------------------ gates + score
_POLISHED_RX = re.compile(r"contrast|overflow|a11y|unnamed|tap[_-]?target|text[_-]?size", re.I)
_STACKING_RX = re.compile(r"escape|overlay|expand|stacking|z[-_ ]?index|cover", re.I)


def _gates(rec, wiring, scan, manifest_entry):
    findings = rec.get("findings", []) or []
    not_run = set((manifest_entry or {}).get("checks_not_run") or [])

    def cls(rx):
        return [f for f in findings
                if rx.search(f.get("signature") or "") or rx.search(f.get("check") or "")]

    pol = cls(_POLISHED_RX)
    polished = ("NOT_RUN" if {"contrast", "mobile"} & not_run and not pol else
                "FAIL" if pol else "PASS")
    # GB-1576 W5a: a lens cannot be called polished if its core verb
    # fails. The verdict rides the lens record (result["core_verb"],
    # written by LensWalk.core_verb_phase); an absent block leaves the
    # gate exactly as the GB-1575 definition computes it.
    cv = rec.get("core_verb") or {}
    cv_verdict = cv.get("verdict")
    if cv_verdict == "CORE_VERB_FAIL":
        polished = "FAIL"
    cv_status = {"CORE_VERB_PASS": "PASS", "CORE_VERB_FAIL": "FAIL",
                 "CORE_VERB_UNSPECIFIED": "UNSPECIFIED"}.get(
                     cv_verdict, "NOT_RUN" if not cv else "UNSPECIFIED")
    stk = cls(_STACKING_RX)
    stacking = "FAIL" if stk else "PASS"
    if wiring is None:
        wiring_gate = "NOT_RUN"
    elif wiring.get("provenance") not in (None, "clean_happy_path"):
        wiring_gate = "FAIL"
    else:
        wiring_gate = "PASS"
    ta = rec.get("two_account") or {}
    premap_own = [p for p in rec.get("premap_findings", []) or []
                  if p.get("class") == "ownership"]
    sec_flags = [f for f in scan["flags"] if f["class"] == "security"]
    if ta.get("status") == "FAIL" or premap_own or sec_flags:
        security = "FAIL"
    elif not ta and not (rec.get("premap_findings") is not None):
        security = "NOT_RUN"
    else:
        security = "PASS"
    return OrderedDict([
        ("polished", OrderedDict([("status", polished),
                                  ("open_findings", len(pol))])),
        ("stacking", OrderedDict([("status", stacking),
                                  ("open_findings", len(stk))])),
        ("wiring", OrderedDict([("status", wiring_gate),
                                ("provenance", None if wiring is None
                                 else wiring.get("provenance"))])),
        ("security_detector", OrderedDict([
            ("status", security),
            ("two_account", ta.get("status")),
            ("ownership_premap_findings", len(premap_own)),
            ("security_scan_flags", len(sec_flags))])),
        ("core_verb", OrderedDict([
            ("status", cv_status),
            ("verdict", cv_verdict),
            ("spec_status", cv.get("spec_status")),
            ("verb", cv.get("verb"))])),
    ])


def _score(scan, components, backend, causes, replay, gates):
    sec_money = sum(1 for f in scan["flags"] if f["class"] in ("security", "money"))
    other = len(scan["flags"]) - sec_money
    orphans = len(components.get("orphaned") or [])
    hidden = len(backend.get("hidden_actions") or [])
    cause_pts = sum(SEV_POINTS.get(g["max_severity"], 0) for g in causes)
    reopened = replay["counts"].get("REOPENED", 0)
    gates_failed = sum(1 for g in gates.values() if g["status"] == "FAIL")
    # GB-1576 W5a: the core-verb result is weighted heavily. FAIL -40,
    # a present UNSPECIFIED -10, an absent block (phase not run) nothing.
    cv_verdict = (gates.get("core_verb") or {}).get("verdict")
    cv_pts = {"CORE_VERB_FAIL": 40, "CORE_VERB_UNSPECIFIED": 10}.get(cv_verdict, 0)
    ded = OrderedDict([
        ("security_money_flags", min(45, 15 * sec_money)),
        ("other_scan_flags", min(24, 8 * other)),
        ("orphaned_components", min(15, 3 * orphans)),
        ("hidden_backend_features", min(10, 2 * hidden)),
        ("open_root_causes", min(30, cause_pts)),
        ("replay_reopened", min(15, 5 * reopened)),
        ("gates_failed", 5 * gates_failed),
        ("core_verb", cv_pts),
    ])
    return OrderedDict([("score", max(0, 100 - sum(ded.values()))),
                        ("deductions", ded),
                        ("formula", SCORE_FORMULA)])


# ------------------------------------------------------------------ assembly
def _durability_section(rec):
    """GB-1576 W5c evidence, surfaced from the walk record's durability
    block (written by the durability phase). NOT_RUN when the phase did
    not run on this record — named, never silent."""
    blk = rec.get("durability")
    if not isinstance(blk, dict):
        return OrderedDict([("status", "NOT_RUN"), ("verdict", None),
                            ("probes", 0), ("failed", 0), ("unverified", 0),
                            ("rows", [])])
    return OrderedDict([
        ("status", blk.get("status")),
        ("verdict", blk.get("verdict")),
        ("probes", blk.get("probes", 0)),
        ("failed", blk.get("failed", 0)),
        ("unverified", blk.get("unverified", 0)),
        ("reason", blk.get("reason")),
        ("rows", blk.get("rows", [])),
    ])


def build_dossier(run, slug, tree=None, registry=None, misses=None):
    rec = run.records.get(slug)
    if rec is None:
        return None
    deploy = rec.get("deploy", {}) or {}
    build_sha = deploy.get("backend_sha") or ""
    wiring = run.wiring.get(slug)
    labels = run.labels.get(slug)
    inv = _inventory(rec, labels)
    components = (_components(tree, slug) if tree is not None else
                  OrderedDict([("dir", None), ("files", []), ("mounted", []),
                               ("orphaned", []),
                               ("note", "no repo supplied; component scan not run")]))
    called_domains = sorted({a.get("domain") for a in rec.get("actions", []) or []
                             if a.get("domain")} | {slug})
    backend = _backend_reach(rec, wiring, registry, slug)
    if tree is not None:
        scan = _code_scan(tree, slug, backend["domains"], misses)
    else:
        scan = OrderedDict([("flags", []), ("study_checks", []),
                            ("note", "no repo supplied; code scan not run")])
    causes = _findings_by_cause(rec, slug)
    replay = _replay(run, rec, slug)
    durability = _durability_section(rec)
    gates = _gates(rec, wiring, scan, run.manifest_by_slug.get(slug))
    score = _score(scan, components, backend, causes, replay, gates)
    return OrderedDict([
        ("lens", slug),
        ("packet_id", rec.get("packet_id")),
        ("build", build_sha),
        ("build12", build_sha[:12]),
        ("run_id", run.manifest.get("run_id")),
        ("walked_at", deploy.get("walked_at")),
        ("wiring_provenance", rec.get("wiring_provenance")),
        ("score", score),
        ("gates", gates),
        ("core_verb", rec.get("core_verb")),
        ("inventory", inv),
        ("components", components),
        ("backend_reach", backend),
        ("code_scan", scan),
        ("findings_by_root_cause", causes),
        ("replay", replay),
        ("durability", durability),
    ])


def render_md(d):
    s = d["score"]
    lines = ["# Dossier — %s @ %s" % (d["lens"], d["build12"]), "",
             "Packet: %s · run %s · walked %s" % (d["packet_id"], d["run_id"],
                                                  d["walked_at"]), "",
             "## Distance to bar: %d / 100" % s["score"], "",
             s["formula"], "",
             "| deduction | points |", "|---|---|"]
    for k, v in s["deductions"].items():
        lines.append("| %s | -%d |" % (k, v))
    lines += ["", "## Gates", "", "| gate | status | inputs |", "|---|---|---|"]
    for name, g in d["gates"].items():
        inputs = ", ".join("%s=%s" % (k, v) for k, v in g.items() if k != "status")
        lines.append("| %s | %s | %s |" % (name, g["status"], inputs))
    inv = d["inventory"]
    lines += ["", "## Inventory", "",
              "Controls: %d (%d exercised). Duplicates: %d." % (
                  inv["controls_total"], inv["controls_exercised"],
                  len(inv["duplicates"]))]
    for role, names in inv["by_role"].items():
        lines.append("- %s: %s" % (role, ", ".join(names[:12])))
    for dup in inv["duplicates"]:
        lines.append("- DUPLICATE %s %r x%d" % (dup["role"], dup["name"], dup["count"]))
    comp = d["components"]
    lines += ["", "Components (%s): %d files, %d mounted, %d orphaned." % (
        comp.get("dir"), len(comp["files"]), len(comp["mounted"]),
        len(comp["orphaned"]))]
    for p in comp["orphaned"]:
        lines.append("- ORPHANED %s" % p)
    if comp.get("note"):
        lines.append("- note: %s" % comp["note"])
    be = d["backend_reach"]
    lines += ["", "## Backend reach", "",
              "Domains: %s. Called actions: %d. Exposed: %d. Hidden/unmounted: %d." % (
                  ", ".join(be["domains"]), len(be["called_actions"]),
                  len(be["exposed_actions"]), len(be["hidden_actions"]))]
    for h in be["hidden_actions"]:
        lines.append("- HIDDEN %s.%s (%s:%s)" % (h["domain"], h["action"],
                                                 h["file"], h["line"]))
    lines += ["", "## Code-scan flags", ""]
    if d["code_scan"]["flags"]:
        for f in d["code_scan"]["flags"]:
            lines.append("- [%s/%s] %s:%d (%s)" % (
                f["class"], f["kind"], f["file"], f["line"], f["pattern"]))
    else:
        lines.append("None.")
    if d["code_scan"].get("note"):
        lines.append("- note: %s" % d["code_scan"]["note"])
    for st in d["code_scan"]["study_checks"]:
        lines.append("- W1 study check %s (%s): %s" % (st["id"], st["kind"],
                                                       st["status"]))
    lines += ["", "## Findings by root cause", ""]
    if d["findings_by_root_cause"]:
        for g in d["findings_by_root_cause"]:
            lines.append("- %s — %d finding(s), max %s (%s)" % (
                g["cause"], g["count"], g["max_severity"],
                ", ".join(g["checks"])))
    else:
        lines.append("None.")
    lines += ["", "## Replay verdicts", ""]
    if d["replay"]["counts"]:
        for v, n in sorted(d["replay"]["counts"].items()):
            lines.append("- %s: %d" % (v, n))
    else:
        lines.append("None recorded.")
    dur = d["durability"]
    lines += ["", "## Durability (GB-1576 W5c)", "",
              "Status: %s · verdict: %s · probes: %d · failed: %d · unverified: %d" % (
                  dur["status"], dur.get("verdict"), dur["probes"],
                  dur["failed"], dur["unverified"])]
    if dur.get("reason"):
        lines.append("- reason: %s" % dur["reason"])
    for r in dur["rows"]:
        lines.append("- %s -> %s (%s)" % (r.get("write"), r.get("verdict"),
                                          r.get("reason")))
    lines.append("")
    return "\n".join(lines)


def build_all(run_dir, repo=None, out_dir=None, lenses=None, misses_path=None):
    """Build dossiers for every walked lens in run_dir. Returns the index."""
    run = RunData(run_dir)
    out_dir = out_dir or os.path.join(run_dir, "dossiers")
    os.makedirs(out_dir, exist_ok=True)
    misses = None
    mp = misses_path or os.path.join(WALKER_DIR, "analysis",
                                     "redesign_misses.jsonl")
    if os.path.exists(mp):
        misses = _load_jsonl(mp)
    # One registry build per distinct build sha in the run.
    registries, trees = {}, {}
    for slug in run.slugs():
        rec = run.records.get(slug)
        if rec is None:
            continue
        sha = (rec.get("deploy", {}) or {}).get("backend_sha") or ""
        if repo and sha and sha not in trees:
            trees[sha] = GitShow(repo, sha)
            try:
                registries[sha] = _registry(trees[sha])
            except Exception:
                registries[sha] = None
    index = []
    for slug in lenses or run.slugs():
        rec = run.records.get(slug)
        if rec is None:
            continue
        sha = (rec.get("deploy", {}) or {}).get("backend_sha") or ""
        d = build_dossier(run, slug, tree=trees.get(sha),
                          registry=registries.get(sha), misses=misses)
        if d is None:
            continue
        _write_lens_files(out_dir, d)
        index.append(_index_row(d))
    return _write_index(out_dir, run.manifest.get("run_id"), index)



def _index_row(d):
    return OrderedDict([
        ("lens", d["lens"]), ("build12", d["build12"]),
        ("score", d["score"]["score"]),
        ("gates", {k: v["status"] for k, v in d["gates"].items()}),
        ("open_root_causes", len(d["findings_by_root_cause"])),
        ("scan_flags", len(d["code_scan"]["flags"])),
        ("orphaned_components", len(d["components"]["orphaned"])),
        ("hidden_actions", len(d["backend_reach"]["hidden_actions"])),
        ("durability", d["durability"].get("verdict")
         or d["durability"].get("status")),
        ("durability_risks", sum(1 for f in d["code_scan"]["flags"]
                                 if f["class"] == "durability")),
        ("durability_failed", d["durability"]["failed"]),
    ])


def _write_lens_files(out_dir, d):
    base = "%s@%s" % (d["lens"], d["build12"] or "unknownbuild")
    with open(os.path.join(out_dir, base + ".json"), "w") as f:
        json.dump(d, f, indent=1, sort_keys=True)
        f.write("\n")
    with open(os.path.join(out_dir, base + ".md"), "w") as f:
        f.write(render_md(d))


def _write_index(out_dir, run_id, rows):
    rows = sorted(rows, key=lambda r: (r["score"], r["lens"]))
    idx = OrderedDict([("run_id", run_id), ("formula", SCORE_FORMULA),
                       ("lenses", rows)])
    with open(os.path.join(out_dir, "INDEX.json"), "w") as f:
        json.dump(idx, f, indent=1, sort_keys=True)
        f.write("\n")
    md = ["# Dossier index — run %s" % run_id, "", SCORE_FORMULA, "",
          "| lens | score | polished | stacking | wiring | security | causes | flags | orphans | hidden | durability | durab risks |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        g = r["gates"]
        md.append("| %s | %d | %s | %s | %s | %s | %d | %d | %d | %d | %s | %d |" % (
            r["lens"], r["score"], g.get("polished"), g.get("stacking"),
            g.get("wiring"), g.get("security_detector"),
            r["open_root_causes"], r["scan_flags"], r["orphaned_components"],
            r["hidden_actions"], r.get("durability"),
            r.get("durability_risks", 0)))
    with open(os.path.join(out_dir, "INDEX.md"), "w") as f:
        f.write("\n".join(md) + "\n")
    return idx


def build_one(run_dir, slug, repo=None, out_dir=None, misses_path=None):
    """Post-lens hook form: build one lens's dossier from whatever run
    output exists so far, merging its row into the dossiers INDEX.
    Best-effort by contract — callers wrap this in try/except."""
    run = RunData(run_dir)
    out_dir = out_dir or os.path.join(run_dir, "dossiers")
    os.makedirs(out_dir, exist_ok=True)
    rec = run.records.get(slug)
    if rec is None:
        return None
    misses = None
    mp = misses_path or os.path.join(WALKER_DIR, "analysis",
                                     "redesign_misses.jsonl")
    if os.path.exists(mp):
        misses = _load_jsonl(mp)
    sha = (rec.get("deploy", {}) or {}).get("backend_sha") or ""
    tree = registry = None
    if repo and sha:
        tree = GitShow(repo, sha)
        try:
            registry = _registry(tree)
        except Exception:
            registry = None
    d = build_dossier(run, slug, tree=tree, registry=registry, misses=misses)
    if d is None:
        return None
    _write_lens_files(out_dir, d)
    rows = []
    idx_path = os.path.join(out_dir, "INDEX.json")
    old = _load_json(idx_path)
    if old:
        rows = [r for r in old.get("lenses", []) if r.get("lens") != slug]
    rows.append(_index_row(d))
    _write_index(out_dir, run.manifest.get("run_id"), rows)
    return d
