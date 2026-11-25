"""ULW v3 W5b (GB-1576): the offline ownership + broadcast code scan.

A heuristic census over a server tree, in the W1 study's section-3 form
(code scans over the walk build): every row is a CANDIDATE for human
confirmation, never a verdict. Two pattern classes:

  id_lookup_no_owner_check — a request-supplied id (req.params / req.body /
      req.query, or a variable destructured from them) reaches an object
      lookup (getDTU / *ById / store-or-DB .get / findOne) inside a route
      handler whose span shows NO ownership comparison (no owner/creator/
      author/userId equality check against the session actor, no
      assert/require-owner helper). The X-05 shape: identity correct,
      ownership absent.
  global_emit_private_payload — a GLOBAL socket emit (an .emit( not scoped
      by .to(room)) or a push onto a global event log whose payload is a
      variable / object (data-shaped), not a constant: a private event
      reaching every listener or the global log.

Ranking is deterministic: pattern signals add score (write-verb route,
result returned to the response, id sourced from the body, private-ish
event name), ties break by file then line. The output is a ranked
file:line JSONL list — the W5b deliverable — produced by the walker CLI:
`walker.py owner-scan --from-repo <checkout> --out <list.jsonl>`.

Pure by design: text in, rows out; the selftest feeds it synthetic trees.
"""
import os, re

ROUTE_RE = re.compile(r"\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['\"]([^'\"]+)['\"]")
LOOKUP_RE = re.compile(r"\b(getDTU|getById|findById|loadById|fetchById|findOne|getOne|loadDTU)\s*\(|\.\s*get\s*\(\s*[^)]*[Ii]d")
REQ_ID_RE = re.compile(r"req\.(params|body|query)\.(\w*[Ii]d\w*|\w*[Uu]ser\w*|slug|key)")
DESTRUCTURE_ID_RE = re.compile(r"(?:const|let|var)\s*\{([^}]*)\}\s*=\s*req\.(params|body|query)")
OWNER_CHECK_RE = re.compile(
    r"(owner|creator|author|userId|actor|createdBy|ownerId)[\w.]*\s*(===|!==|==|!=)\s*[\w.]*"
    r"|[\w.]+\s*(===|!==|==|!=)\s*[\w.]*(req\.user|session|actor|caller)"
    r"|assert\w*[Oo]wner|requireOwner|checkOwner|isOwner|canAccess|hasAccess|authori[sz]e|forbid")
EMIT_RE = re.compile(r"\.emit\s*\(\s*['\"]([^'\"]+)['\"]\s*(?:,\s*(.+))?$")
GLOBAL_LOG_RE = re.compile(r"\b(eventLog\.push|bus\.emit|globalLog|logEvent|publishEvent)\s*\(\s*(.+)$")
PRIVATE_EVENT_RE = re.compile(r"(dm|direct|private|user|message|notification|inbox|mention|whisper)", re.I)
WRITE_METHODS = ("post", "put", "patch", "delete")
ROUTE_SPAN_MAX = 160


def _route_spans(lines):
    """[(start_idx, method, path)] for each route registration in a file."""
    spans = []
    for i, ln in enumerate(lines):
        m = ROUTE_RE.search(ln)
        if m:
            spans.append((i, m.group(1), m.group(2)))
    return spans


def _span_for(spans, idx, n_lines):
    """The route span containing idx: (start, end, method, path) or a
    +/-40-line window when the site sits outside any registration."""
    cur = None
    for (s, method, path) in spans:
        if s <= idx:
            cur = (s, method, path)
        else:
            break
    if cur is None:
        return max(0, idx - 40), min(n_lines, idx + 40), None, None
    start, method, path = cur
    end = n_lines
    for (s, _m, _p) in spans:
        if s > start:
            end = min(s, start + ROUTE_SPAN_MAX)
            break
    else:
        end = min(n_lines, start + ROUTE_SPAN_MAX)
    return start, end, method, path


def _req_id_sources(window_text):
    """Request-id sources in a window: {(source, field)} from direct
    req.*.id reads and destructuring assignments."""
    out = set()
    for m in REQ_ID_RE.finditer(window_text):
        out.add((m.group(1), m.group(2)))
    for m in DESTRUCTURE_ID_RE.finditer(window_text):
        for name in m.group(1).split(","):
            name = name.strip().split(":")[0].strip()
            if name and re.search(r"id|user|slug|key", name, re.I):
                out.add((m.group(2), name))
    return out


def scan_file(relpath, text):
    lines = text.splitlines()
    spans = _route_spans(lines)
    rows = []
    for i, ln in enumerate(lines):
        start, end, method, route = _span_for(spans, i, len(lines))
        window = "\n".join(lines[start:end])
        # --- pattern A: id lookup with no owner check -------------------
        # (a route registration line itself is not a lookup: its .get( is
        # the router's, and its path carries the :id the regex would eat)
        if LOOKUP_RE.search(ln) and not ROUTE_RE.search(ln):
            sources = _req_id_sources(window)
            if sources and not OWNER_CHECK_RE.search(window):
                score, signals = 50, ["id_lookup", "no_owner_check_in_handler"]
                if method in WRITE_METHODS:
                    score += 20
                    signals.append("write_route")
                if any(src == "body" for src, _f in sources):
                    score += 10
                    signals.append("id_from_body")
                if re.search(r"res\.(json|send)\s*\(", window):
                    score += 15
                    signals.append("result_returned")
                rows.append({"kind": "id_lookup_no_owner_check", "score": score,
                             "file": relpath, "line": i + 1,
                             "route": ("%s %s" % (method.upper(), route)) if method else None,
                             "signals": signals,
                             "sources": sorted("%s.%s" % s for s in sources),
                             "snippet": ln.strip()[:160]})
        # --- pattern B: global emit / global log with a data payload ----
        m = EMIT_RE.search(ln)
        if m and re.search(r"\b(socket|client|ws|conn)\.emit\s*\(", ln):
            m = None  # a single-connection emit is scoped by construction
        if m:
            scoped = ".to(" in ln[:m.start()] or (i > 0 and ".to(" in lines[i - 1] and ".emit" in ln)
            payload = (m.group(2) or "").strip()
            if not scoped and payload and not payload.startswith(("'", '"', "`")):
                score, signals = 50, ["global_emit", "data_payload"]
                if PRIVATE_EVENT_RE.search(m.group(1)):
                    score += 15
                    signals.append("private_shaped_event")
                rows.append({"kind": "global_emit_private_payload", "score": score,
                             "file": relpath, "line": i + 1,
                             "route": ("%s %s" % (method.upper(), route)) if method else None,
                             "signals": signals, "event": m.group(1),
                             "snippet": ln.strip()[:160]})
        g = GLOBAL_LOG_RE.search(ln)
        if g:
            payload = g.group(2).strip()
            if payload and not payload.startswith(("'", '"', "`")):
                rows.append({"kind": "global_emit_private_payload", "score": 45,
                             "file": relpath, "line": i + 1,
                             "route": ("%s %s" % (method.upper(), route)) if method else None,
                             "signals": ["global_log_push", "data_payload"],
                             "snippet": ln.strip()[:160]})
    return rows


def scan_tree(root, skip_tests=True):
    """All rows over a server tree, ranked: score desc, file, line.
    node_modules is always skipped; test files are skipped by default
    (they emit and look up by design, and are not shipped behaviour)."""
    rows = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != "node_modules"]
        for fn in sorted(filenames):
            if not fn.endswith(".js"):
                continue
            if skip_tests and (fn.endswith(".test.js") or "/test/" in dirpath.replace(os.sep, "/") + "/"):
                continue
            path = os.path.join(dirpath, fn)
            rel = os.path.relpath(path, root)
            try:
                with open(path, encoding="utf-8", errors="replace") as f:
                    text = f.read()
            except Exception:
                continue
            rows.extend(scan_file(rel, text))
    rows.sort(key=lambda r: (-r["score"], r["file"], r["line"]))
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return rows
