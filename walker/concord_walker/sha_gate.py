"""WALK-01 (GB-1544): the sha gate. A run may write status rows only when the
live build is the build it was told to verify: live sha == --expect-sha.

The live sha comes ONLY from /health (buildSha — a git sha of the running
backend tree). The Next.js build id in the served page HTML is a frontend build
id, not a git sha: it is reported as `frontend_build` for the log but can never
satisfy the gate. A mismatch (or no /health sha at all) does not abort the run:
it continues DRY and writes 0 status rows, so a stale deploy can never be
stamped VERIFIED by accident.
"""
import json, re, urllib.request

_HEALTH_KEYS = ("buildSha", "build_sha", "sha", "commit")
_BUILD_ID_RES = (re.compile(r'"buildId"\s*:\s*"([^"]+)"'),
                 # App Router pages only expose chunks/ css/ media/ dirs, which are not build ids
                 re.compile(r"/_next/static/(?!(?:chunks|css|media|webpack|development|images|fonts)/)([^/\"']+)/"))


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


_HEX_RE = re.compile(r"^[0-9a-fA-F]{7,64}$")


def is_hex_sha(v):
    """A git sha (or >=7-char prefix): hex only."""
    return isinstance(v, str) and bool(_HEX_RE.match(v.strip()))


def sha_matches(expect, live):
    """Both must be hex (>=7). Equal, or one a prefix of the other (case-insensitive)."""
    if not (is_hex_sha(expect) and is_hex_sha(live)):
        return False
    e, l = str(expect).strip().lower(), str(live).strip().lower()
    return e.startswith(l) or l.startswith(e)


def _get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "concord-walker-sha-gate"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def live_sha(base_url, fetch=None):
    """(sha, source, frontend_build). sha/source come from /health only (source 'health');
    frontend_build is the HTML Next build id, informational. fetch is injectable for tests."""
    fetch = fetch or _get
    base = base_url.rstrip("/")
    sha = None
    try:
        cand = health_build_sha(json.loads(fetch(base + "/health")))
        if is_hex_sha(cand):
            sha = cand.strip()
    except Exception:
        pass
    fb = None
    try:
        fb = html_build_id(fetch(base + "/"))
    except Exception:
        pass
    return sha, ("health" if sha else None), fb


def gate(expect_sha, base_url, fetch=None):
    """{'ok': bool, 'live': sha|None, 'source': str|None, 'frontend_build': str|None, 'reason': str}.
    ok only when expect_sha is a hex sha AND /health reports a hex sha that matches it."""
    if not is_hex_sha(expect_sha):
        return {"ok": False, "live": None, "source": None, "frontend_build": None,
                "reason": "--expect-sha %r is not a hex git sha (>=7 chars) — run continues dry, 0 status rows" % (expect_sha,)}
    live, source, fb = live_sha(base_url, fetch=fetch)
    if sha_matches(expect_sha, live):
        return {"ok": True, "live": live, "source": source, "frontend_build": fb, "reason": "live sha matches"}
    if live is None:
        why = "/health reports no git sha (frontend build %r never satisfies the gate)" % (fb,)
    else:
        why = "live sha %r != expected %r" % (live, expect_sha)
    return {"ok": False, "live": live, "source": source, "frontend_build": fb,
            "reason": why + " — run continues dry, 0 status rows"}
