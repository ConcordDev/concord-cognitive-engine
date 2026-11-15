"""WALK-01 (GB-1544): the sha gate. A run may write status rows only when the
live build is the build it was told to verify: live sha == --expect-sha.

The live sha comes from /health (buildSha, added by the WALK-01 server patch)
with the Next.js build id from the served page HTML as fallback. A mismatch (or
no live sha at all) does not abort the run: it continues DRY and writes 0 status
rows, so a stale deploy can never be stamped VERIFIED by accident.
"""
import json, re, urllib.request

_HEALTH_KEYS = ("buildSha", "build_sha", "sha", "commit")
_BUILD_ID_RES = (re.compile(r'"buildId"\s*:\s*"([^"]+)"'),
                 re.compile(r"/_next/static/([^/\"']+)/"))


def health_build_sha(health):
    if not isinstance(health, dict):
        return None
    for k in _HEALTH_KEYS:
        if health.get(k):
            return str(health[k]).strip()
    b = health.get("build")
    if isinstance(b, dict):
        for k in _HEALTH_KEYS:
            if b.get(k):
                return str(b[k]).strip()
    c = health.get("checks")
    if isinstance(c, dict):
        return health_build_sha(c)
    return None


def html_build_id(html):
    if not html:
        return None
    for rx in _BUILD_ID_RES:
        m = rx.search(html)
        if m:
            return m.group(1).strip()
    return None


def sha_matches(expect, live):
    return bool(expect) and bool(live) and str(expect).strip() == str(live).strip()


def _get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "concord-walker-sha-gate"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def live_sha(base_url, fetch=None):
    """(sha, source) — source is 'health', 'html', or None. fetch is injectable for tests."""
    fetch = fetch or _get
    base = base_url.rstrip("/")
    try:
        sha = health_build_sha(json.loads(fetch(base + "/health")))
        if sha:
            return sha, "health"
    except Exception:
        pass
    try:
        bid = html_build_id(fetch(base + "/"))
        if bid:
            return bid, "html"
    except Exception:
        pass
    return None, None


def gate(expect_sha, base_url, fetch=None):
    """{'ok': bool, 'live': sha|None, 'source': str|None, 'reason': str}"""
    if not expect_sha:
        return {"ok": True, "live": None, "source": None, "reason": "no --expect-sha given"}
    live, source = live_sha(base_url, fetch=fetch)
    if sha_matches(expect_sha, live):
        return {"ok": True, "live": live, "source": source, "reason": "live sha matches"}
    return {"ok": False, "live": live, "source": source,
            "reason": "live sha %r != expected %r — run continues dry, 0 status rows" % (live, expect_sha)}
