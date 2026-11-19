"""DevTools read-back capture (ULW C26; WALK-2-READINESS-GATE §10, ruling #12).

The recipe schema's `readback` is the evidence a run ACTUALLY captured through
DevTools/observation — never hand-typed: the endpoints it hit, the statuses they
returned, and the console/page errors the page printed while it ran. This module
builds those rows from the streams the walk already captures (LensWalk's
console_errors / page_errors / bad_responses, or driver-shaped response dicts),
so a recipe verdict can be judged against what the browser really saw.

Rows dedupe by (type, route, message) with an `occurrences` count — a polling
lens that fails the same request forty times files ONE row, not forty. Failed
requests (status >= 400) carry weight "high" and file first, 5xx before 4xx:
a 500 files at higher weight than the warning it printed. The browser's own
console echo of a failed request ("Failed to load resource: ...") is not
double-filed — the http row carries the failure (the same convention
NetLedger._on_console keeps). Sub-400 responses are not evidence rows.
"""
_ECHO_PREFIX = "Failed to load resource"


def _rank(row):
    """File order: http 5xx, http 4xx, console errors, page errors."""
    t = row["type"]
    if t == "http_error":
        return 0 if (row.get("status") or 0) >= 500 else 1
    return 2 if t == "console_error" else 3


def build_readback(console_errors=(), page_errors=(), bad_responses=(), responses=()):
    """Captured streams -> deduped, weighted read-back rows.

    bad_responses: (status, path) tuples as LensWalk records them.
    responses: dicts with method/path/status keys (the repro driver's rows);
    either source may be given, both are merged. Console and page errors are
    scrubbed strings as the walk records them."""
    counts = {}

    def add(type_, route, message, status=None):
        key = (type_, route, message)
        row = counts.get(key)
        if row is None:
            row = {"type": type_, "route": route, "message": message, "occurrences": 0,
                   "weight": "high" if type_ == "http_error" else "normal"}
            if status is not None:
                row["status"] = status
            counts[key] = row
        row["occurrences"] += 1

    for status, path in bad_responses or ():
        try:
            status = int(status)
        except (TypeError, ValueError):
            continue
        if status >= 400:
            add("http_error", path, "HTTP %d" % status, status)
    for r in responses or ():
        try:
            status = int((r or {}).get("status"))
        except (TypeError, ValueError):
            continue
        if status < 400:
            continue
        path = (r or {}).get("path") or ""
        method = (r or {}).get("method") or ""
        add("http_error", ("%s %s" % (method, path)).strip(), "HTTP %d" % status, status)
    for text in console_errors or ():
        text = (text or "").strip()
        if not text or text.startswith(_ECHO_PREFIX):
            continue  # the browser's echo of a failed request; the http row carries it
        add("console_error", None, text)
    for text in page_errors or ():
        text = (text or "").strip()
        if text:
            add("page_error", None, text)

    rows = sorted(counts.values(),
                  key=lambda row: (_rank(row), -row["occurrences"], row["route"] or "", row["message"]))
    return rows
