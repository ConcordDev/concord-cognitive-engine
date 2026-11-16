#!/usr/bin/env python3
"""MST-W0-04: action + route registry snapshot of the backend/frontend source at one sha.

  action_registry.py --repo <git checkout> --sha <backend sha> --out DIR     (git show / ls-tree only:
                                                                             no checkout, worktree or clone)
  action_registry.py --src <exported tree> --sha <sha> --out DIR             (a `git archive` of that sha)

Writes DIR/actions-<sha12>.json.gz (gzip, deterministic, <= 200 KB):
  actions[]: {domain, action, file, line, receipt_class, fe_callers[]}
     receipt_class: PRODUCT (registerDeclaration certifiable) | LLM (analyze/generate/suggest) |
                    NEAR (undeclared action in a domain that has a PRODUCT declaration) | NONE
  routes[]:  {method, pattern, file, line, source: express|express-router|next-api|next-page, mount}
     pattern is normalized (see routematch.py): params -> :p, catch-alls -> *, Next route
     groups / parallel / intercepting segments stripped; routers mounted at runtime with an
     unknown prefix get mount "runtime" and match by suffix.
Read-only. Never runs code from the tree.
"""
import argparse, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from concord_walker.routematch import express_pattern, next_pattern  # noqa: E402

ACTION_RE = re.compile(r"registerLensAction\(\s*([\"'`])([\w.-]+)\1\s*,\s*([\"'`])([\w.${}-]+)\3")
HELPER_RE = re.compile(r"(?:const|let|var)\s+(\w+)\s*=\s*\(\s*(\w+)[^)]*\)\s*=>\s*registerLensAction\(\s*([\"'])([\w.-]+)\3\s*,\s*\2\b")
DECL_RE = re.compile(r"registerDeclaration\(\s*([\"'])([\w.-]+)\1\s*,\s*([\"'])([\w.-]+)\3\s*,\s*\{")
LLM_RE = re.compile(r"^(analy[sz]e|generate|suggest)", re.I)
ROUTE_RE = re.compile(r"\b(\w+)\.(get|post|put|patch|delete|all)\(\s*([\"'`])(/[^\"'`]*)\3")
MOUNT_RE = re.compile(r"\bapp\.use\(\s*([\"'`])(/[^\"'`]*)\1\s*,\s*(?:\w+\.)?(\w+)\s*\(?")
IMPORT_RE = re.compile(r"import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*[\"'](\./[^\"']+)[\"']")
DYN_IMPORT_RE = re.compile(r"\{\s*([^}]*)\}\s*=\s*await\s+import\(\s*[\"'](\./[^\"']+)[\"']")
REGISTER_CALL_RE = re.compile(r"^\s*(?:await\s+)?(\w+)\(\s*app\b", re.M)
FE_CALL_RE = re.compile(r"lensRun(?:<.*?>)?\(\s*([\"'])([\w.-]+)\1\s*,\s*([\"'`])([\w.${}-]+)\3")
FE_OBJ_RE = re.compile(r"domain:\s*([\"'])([\w.-]+)\1\s*,\s*action:\s*([\"'`])([\w.${}-]+)\3")
NEXT_METHODS_RE = re.compile(r"export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b")


class GitTree:
    def __init__(self, repo, sha):
        self.repo, self.sha = repo, sha
        self.desc = "git:%s@%s" % (repo, sha[:12])

    def ls(self, prefix):
        out = subprocess.run(["git", "-C", self.repo, "ls-tree", "-r", "--name-only", self.sha, "--", prefix],
                             capture_output=True, text=True, timeout=300)
        if out.returncode != 0:
            raise SystemExit("git ls-tree failed at %s: %s" % (self.sha, out.stderr.strip()[:200]))
        return [l for l in out.stdout.splitlines() if l]

    def read(self, path):
        out = subprocess.run(["git", "-C", self.repo, "show", "%s:%s" % (self.sha, path)], capture_output=True, timeout=300)
        return out.stdout.decode("utf-8", "replace") if out.returncode == 0 else ""


class DirTree:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        self.desc = "dir:%s" % self.root

    def ls(self, prefix):
        base = os.path.join(self.root, prefix)
        if os.path.isfile(base):
            return [prefix]
        out = []
        for dp, _dn, fn in os.walk(base):
            for f in fn:
                out.append(os.path.relpath(os.path.join(dp, f), self.root))
        return sorted(out)

    def read(self, path):
        try:
            with open(os.path.join(self.root, path), encoding="utf-8", errors="replace") as f:
                return f.read()
        except OSError:
            return ""


def _line(text, pos):
    return text.count("\n", 0, pos) + 1


SKIP_DIRS = re.compile(r"^server/(tests|migrations|scripts|data|seeds|results)/|(__tests__|\.test\.|\.spec\.)")


def server_files(tree):
    """Every server .js that can register a route or action (tests/migrations/scripts excluded).
    Scanning only server.js + routes/ missed registrars such as registerGuidanceEndpoints(app)
    in server/guidance.js and produced false real_missing rows (see WALKER-ISSUES)."""
    return sorted(p for p in tree.ls("server") if p.endswith((".js", ".mjs")) and not SKIP_DIRS.search(p))


def scan_actions(tree, files=None):
    files = files if files is not None else server_files(tree)
    acts = {}
    for path in files:
        text = tree.read(path)
        if "registerLensAction" not in text:
            continue
        for m in ACTION_RE.finditer(text):
            acts.setdefault((m.group(2), m.group(4)), (path, _line(text, m.start())))
        for h in HELPER_RE.finditer(text):
            name, dom = h.group(1), h.group(4)
            for m in re.finditer(r"\b%s\(\s*([\"'`])([\w.${}-]+)\1" % re.escape(name), text):
                if m.start() == h.start() + h.group(0).index(name):
                    continue
                acts.setdefault((dom, m.group(2)), (path, _line(text, m.start())))
    return acts


def scan_declarations(tree):
    text = tree.read("server/lib/receipts/declarations.js")
    out = {}
    for m in DECL_RE.finditer(text):
        body = text[m.end(): m.end() + 400]
        out[(m.group(2), m.group(4))] = bool(re.search(r"certifiable\s*:\s*true", body))
    return out


def scan_fe_callers(tree):
    out = {}
    for prefix in ("concord-frontend/app", "concord-frontend/components", "concord-frontend/lib", "concord-frontend/hooks"):
        for path in tree.ls(prefix):
            if not path.endswith((".ts", ".tsx", ".js", ".jsx")) or re.search(r"(__tests__|\.test\.|\.spec\.|/e2e/)", path):
                continue
            text = tree.read(path)
            if "lensRun" not in text and "action:" not in text:
                continue
            for rx in (FE_CALL_RE, FE_OBJ_RE):
                for m in rx.finditer(text):
                    out.setdefault((m.group(2), m.group(4)), []).append("%s:%d" % (path, _line(text, m.start())))
    return out


def receipt_class(domain, action, decls):
    if decls.get((domain, action)):
        return "PRODUCT"
    if LLM_RE.match(action):
        return "LLM"
    if any(d == domain and c for (d, _a), c in decls.items()):
        return "NEAR"
    return "NONE"


def _fe_for(domain, action, fe):
    hits = list(fe.get((domain, action), []))
    for (d, a), v in fe.items():
        if d == domain and "${" in a and action.startswith(a.split("${")[0]) and a.split("${")[0]:
            hits.extend(v)
    return sorted(set(hits))


def scan_routes(tree, files=None):
    routes = []
    server = tree.read("server/server.js")
    imports = {}
    for m in IMPORT_RE.finditer(server):
        names = ([m.group(1)] if m.group(1) else []) + [n.split(" as ")[-1].strip() for n in (m.group(2) or "").split(",") if n.strip()]
        for n in names:
            imports[n] = "server/" + m.group(3)[2:]
    for m in DYN_IMPORT_RE.finditer(server):
        for n in m.group(1).split(","):
            if n.strip():
                imports[n.split(":")[-1].strip()] = "server/" + m.group(2)[2:]
    mounts = {}
    for m in MOUNT_RE.finditer(server):
        f = imports.get(m.group(3))
        if f:
            mounts.setdefault(f, set()).add(m.group(2).rstrip("/"))
    app_files = {"server/server.js"}
    for m in REGISTER_CALL_RE.finditer(server):
        f = imports.get(m.group(1))
        if f:
            app_files.add(f)
    files = ["server/server.js"] + [p for p in (files if files is not None else server_files(tree)) if p != "server/server.js"]
    for path in files:
        text = server if path == "server/server.js" else tree.read(path)
        for m in ROUTE_RE.finditer(text):
            ident, method, raw = m.group(1), m.group(2).upper(), m.group(4)
            line = _line(text, m.start())
            if ident == "app" or (path in app_files and ident == "app"):
                routes.append({"method": method, "pattern": express_pattern(raw), "file": path, "line": line,
                               "source": "express", "mount": ""})
            elif ident in ("router", "r", "routes", "api") or ident.endswith("Router") or ident.endswith("router"):
                pre = sorted(mounts.get(path, []))
                if pre:
                    for p in pre:
                        routes.append({"method": method, "pattern": express_pattern(p + raw), "file": path, "line": line,
                                       "source": "express-router", "mount": p})
                else:
                    routes.append({"method": method, "pattern": express_pattern(raw), "file": path, "line": line,
                                   "source": "express-router", "mount": "runtime"})
    for path in tree.ls("concord-frontend/app"):
        base = os.path.basename(path)
        rel = os.path.dirname(path)[len("concord-frontend/app"):] or "/"
        if re.match(r"route\.(ts|js)$", base):
            text = tree.read(path)
            methods = sorted(set(NEXT_METHODS_RE.findall(text))) or ["GET"]
            for meth in methods:
                routes.append({"method": meth, "pattern": next_pattern(rel), "file": path, "line": 1,
                               "source": "next-api", "mount": ""})
        elif re.match(r"page\.(tsx|ts|jsx|js)$", base):
            routes.append({"method": "GET", "pattern": next_pattern(rel), "file": path, "line": 1,
                           "source": "next-page", "mount": ""})
    seen, out = set(), []
    for r in sorted(routes, key=lambda r: (r["pattern"], r["method"], r["file"], r["line"])):
        k = (r["method"], r["pattern"], r["mount"] == "runtime")
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


def build(tree, sha):
    files = server_files(tree)
    acts = scan_actions(tree, files)
    decls = scan_declarations(tree)
    fe = scan_fe_callers(tree)
    rows = []
    for (d, a), (f, ln) in sorted(acts.items()):
        rows.append({"domain": d, "action": a, "file": f, "line": ln, "receipt_class": receipt_class(d, a, decls),
                     "fe_callers": _fe_for(d, a, fe)[:4], "fe_caller_count": len(_fe_for(d, a, fe))})
    routes = scan_routes(tree, files)
    return {"sha": sha, "source": tree.desc, "counts": {"actions": len(rows), "routes": len(routes), "server_files": len(files),
                                                        "declarations": len(decls), "fe_call_sites": sum(len(v) for v in fe.values())},
            "actions": rows, "routes": routes}


MAX_BYTES = 200 * 1024


def write(reg, out_dir):
    """Gzipped compact JSON (spec: <= 200 KB per sha). Raises when over the cap."""
    import gzip
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "actions-%s.json.gz" % reg["sha"][:12])
    data = json.dumps(reg, separators=(",", ":"), sort_keys=True).encode("utf-8")
    with open(path, "wb") as f:
        f.write(gzip.compress(data, compresslevel=9, mtime=0))
    if os.path.getsize(path) > MAX_BYTES:
        raise SystemExit("registry %s is %d bytes > %d cap" % (path, os.path.getsize(path), MAX_BYTES))
    return path


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--repo")
    g.add_argument("--src")
    ap.add_argument("--sha", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    if not re.match(r"^[0-9a-fA-F]{7,40}$", a.sha):
        raise SystemExit("--sha must be a hex git sha")
    tree = GitTree(a.repo, a.sha) if a.repo else DirTree(a.src)
    reg = build(tree, a.sha)
    p = write(reg, a.out)
    print("%s: %d actions, %d routes, %d bytes (source %s)" % (p, reg["counts"]["actions"], reg["counts"]["routes"],
                                                              os.path.getsize(p), reg["source"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
