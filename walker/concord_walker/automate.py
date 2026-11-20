"""Automation of the formerly human-only ticket classes (precapture item 6). Every function is pure or takes its I/O
as an injected callable, so it is tested offline; the real Playwright/CLI wiring is thin and fails closed.

  lighthouse   parse category/metric thresholds from the ticket text, run the lighthouse CLI when it exists, compare
  cross-acct   t1 creates its own item; t2 must not read/modify it; signed-out must get 401/403/404 or nothing
  visual       theme-surface luminance + baseline pixel diff (same build, same viewport) + box overlap/visibility
  human-only   everything else keeps a per-ticket, exact reason (code_read / other)

States: PASS | FAIL | UNVERIFIED (with a reason) | NEEDS_HUMAN (with the exact reason). A missing tool, missing capture,
timeout or unreadable result is UNVERIFIED - never PASS. Nothing here prints a credential, cookie or token.
"""
import io, json, os, re, shutil, subprocess

# ------------------------------------------------------------------ lighthouse
CATS = {"performance": "performance", "perf": "performance", "accessibility": "accessibility", "a11y": "accessibility",
        "best practices": "best-practices", "best-practices": "best-practices", "seo": "seo"}
_CAT_RX = r"(performance|perf|accessibility|a11y|best[ -]practices|seo)"
_METRICS = {"cls": ("cumulative-layout-shift", 1.0), "lcp": ("largest-contentful-paint", 1.0), "fcp": ("first-contentful-paint", 1.0),
            "tbt": ("total-blocking-time", 1.0), "si": ("speed-index", 1.0)}
_METRIC_RX = re.compile(r"(?i)\b(cls|lcp|fcp|tbt|speed index)\s*(?:under|below|<=?|less than|<)\s*(\d+(?:\.\d+)?)\s*(ms|s)?\b")


def lighthouse_thresholds(text):
    """-> {"categories": {cat: min_score(0-100)}, "metrics": {audit_id: max_value}, "form_factor": "desktop"|"mobile"|None}."""
    t = text or ""
    cats = {}
    for m in re.finditer(r"(?i)((?:\b" + _CAT_RX + r"\b\s*(?:,|and|&|/)?\s*)+)\s*(?:score\s*)?(?:of\s+|at\s+least\s+|above\s+|over\s+|>=?\s*|≥\s*)?(\d{2,3})\s*(\+)?", t):
        n = int(m.group(3))
        if not 1 <= n <= 100:
            continue
        for cm in re.finditer(_CAT_RX, m.group(1), re.I):
            cats[CATS[re.sub(r"\s+", " ", cm.group(1).lower())]] = n
    mets = {}
    for m in _METRIC_RX.finditer(t):
        k = "si" if m.group(1).lower().startswith("speed") else m.group(1).lower()
        v = float(m.group(2))
        unit = (m.group(3) or "").lower()
        mets[_METRICS[k][0]] = v * (1000 if unit == "s" and k != "cls" else 1)
    ff = "desktop" if re.search(r"(?i)\bdesktop\b", t) else ("mobile" if re.search(r"(?i)\bmobile\b|390", t) else None)
    return {"categories": cats, "metrics": mets, "form_factor": ff}


def find_lighthouse(which=shutil.which, env=os.environ):
    """The CLI on PATH, or `npx lighthouse` ONLY when the box opts in (CONCORD_WALKER_ALLOW_NPX=1: npx may download)."""
    p = which("lighthouse")
    if p:
        return [p]
    if env.get("CONCORD_WALKER_ALLOW_NPX") == "1" and which("npx"):
        return [which("npx"), "--no-install", "lighthouse"]
    return None


def run_lighthouse(url, form_factor=None, runner=None, which=shutil.which, env=os.environ, timeout=180):
    """-> {"state": "ok"|"unverified", "lhr": dict|None, "reason": str}. Fail closed: absent tool / timeout / bad JSON."""
    base = find_lighthouse(which, env)
    if not base:
        return {"state": "unverified", "lhr": None, "reason": "lighthouse CLI is not installed on this box (and npx opt-in is off)"}
    cmd = base + [url, "--output=json", "--output-path=stdout", "--quiet", "--chrome-flags=--headless=new --no-sandbox"]
    if form_factor == "desktop":
        cmd.append("--preset=desktop")
    runner = runner or (lambda c, to: subprocess.run(c, capture_output=True, text=True, timeout=to))
    try:
        p = runner(cmd, timeout)
    except Exception as e:                       # timeout / OSError
        return {"state": "unverified", "lhr": None, "reason": "lighthouse did not finish: %s" % type(e).__name__}
    if getattr(p, "returncode", 1) != 0:
        return {"state": "unverified", "lhr": None, "reason": "lighthouse exited %s" % getattr(p, "returncode", "?")}
    try:
        return {"state": "ok", "lhr": json.loads(p.stdout), "reason": ""}
    except Exception:
        return {"state": "unverified", "lhr": None, "reason": "lighthouse output was not JSON"}


def check_lighthouse(lhr, thresholds, requested_path=None):
    """Pure. -> (state, detail). No threshold in the ticket => scores are reported but the verdict is UNVERIFIED."""
    if not isinstance(lhr, dict) or "categories" not in lhr:
        return "UNVERIFIED", "no lighthouse report"
    fin = (lhr.get("finalUrl") or lhr.get("finalDisplayedUrl") or "")
    if requested_path and fin and requested_path.rstrip("/") not in fin.rstrip("/"):
        return "UNVERIFIED", "lighthouse landed on a different page (%s): the page needs a signed-in session lighthouse does not have" % re.sub(r"^https?://[^/]+", "", fin)[:60]
    scores = {k: (round(v["score"] * 100) if v.get("score") is not None else None) for k, v in lhr["categories"].items()}
    th = thresholds or {}
    if not th.get("categories") and not th.get("metrics"):
        return "UNVERIFIED", "ticket states no numeric threshold; scores %s reported only" % scores
    bad, rows = [], []
    for cat, mn in (th.get("categories") or {}).items():
        sc = scores.get(cat)
        if sc is None:
            return "UNVERIFIED", "category %s has no score in the report" % cat
        rows.append("%s %d>=%d" % (cat, sc, mn))
        if sc < mn:
            bad.append("%s %d < %d" % (cat, sc, mn))
    for aid, mx in (th.get("metrics") or {}).items():
        a = (lhr.get("audits") or {}).get(aid)
        if not a or a.get("numericValue") is None:
            return "UNVERIFIED", "audit %s missing from the report" % aid
        rows.append("%s %.3g<=%.3g" % (aid, a["numericValue"], mx))
        if a["numericValue"] > mx:
            bad.append("%s %.3g > %.3g" % (aid, a["numericValue"], mx))
    return ("FAIL", "; ".join(bad)) if bad else ("PASS", "; ".join(rows))


# ------------------------------------------------------------------ cross-account A/B
DENIED = (401, 403, 404)


def ab_isolation(create, fetch_owner, fetch_other, fetch_anon, modify_other=None):
    """create() -> {"path": str, "marker": str}  (t1 writes ITS OWN item, labelled by the walker).
    fetch_*(path, marker) -> {"status": int, "contains": bool|None}. modify_other(path, marker) -> {"status": int} (PUT/PATCH only,
    never DELETE). -> (state, detail). t2 / signed-out reading the marker is FAIL; unreadable evidence is UNVERIFIED."""
    try:
        made = create()
    except Exception as e:
        return "UNVERIFIED", "t1 could not create its own item: %s" % type(e).__name__
    if not made or not made.get("path") or not made.get("marker"):
        return "UNVERIFIED", "t1 create returned no readable path/marker"
    p, mk = made["path"], made["marker"]
    own = fetch_owner(p, mk)
    if not (own and 200 <= (own.get("status") or 0) < 300 and own.get("contains")):
        return "UNVERIFIED", "owner could not read back its own item (status %s) - nothing to isolate" % (own or {}).get("status")
    oth = fetch_other(p, mk)
    if oth is None or oth.get("status") is None or (oth["status"] < 300 and oth.get("contains") is None):
        return "UNVERIFIED", "t2 read result unreadable"
    if oth["status"] < 300 and oth.get("contains"):
        return "FAIL", "t2 READ t1's item (status %s)" % oth["status"]
    if oth["status"] >= 300 and oth["status"] not in DENIED:
        return "UNVERIFIED", "t2 got %s, neither a denial nor an empty read" % oth["status"]
    an = fetch_anon(p, mk)
    if an is None or an.get("status") is None or (an["status"] < 300 and an.get("contains") is None):
        return "UNVERIFIED", "signed-out read result unreadable"
    if an["status"] < 300 and an.get("contains"):
        return "FAIL", "signed-out visitor READ t1's item (status %s)" % an["status"]
    if an["status"] >= 300 and an["status"] not in DENIED:
        return "UNVERIFIED", "signed-out got %s, neither 401/403/404 nor empty" % an["status"]
    if modify_other:
        mo = modify_other(p, mk)
        if mo is None or mo.get("status") is None:
            return "UNVERIFIED", "t2 modify result unreadable"
        if mo["status"] < 300:
            return "FAIL", "t2 MODIFIED t1's item (status %s)" % mo["status"]
        if mo["status"] not in DENIED:
            return "UNVERIFIED", "t2 modify got %s, not a clear denial" % mo["status"]
    return "PASS", "t2 denied/empty (%s), signed-out denied/empty (%s)%s" % (oth["status"], an["status"], ", t2 modify denied" if modify_other else "")


# ------------------------------------------------------------------ visual
def _pil():
    try:
        from PIL import Image
        return Image
    except Exception:
        return None


def mean_luminance(png):
    Image = _pil()
    if Image is None:
        return None
    try:
        im = Image.open(io.BytesIO(png)).convert("L")
        im.thumbnail((64, 64))
        px = list(im.getdata())
    except Exception:
        return None
    return sum(px) / (255.0 * len(px)) if px else None


def theme_surface_check(png, want):
    """The rendered page's surface luminance matches the wanted theme (light > 0.6, dark < 0.35); in between is UNVERIFIED."""
    lum = mean_luminance(png)
    if lum is None:
        return "UNVERIFIED", "cannot decode the screenshot (Pillow absent)"
    if want == "light":
        return ("PASS", "light surfaces (luminance %.2f)" % lum) if lum > 0.6 else (("FAIL", "page is dark (luminance %.2f)" % lum) if lum < 0.35 else ("UNVERIFIED", "mixed surfaces (luminance %.2f)" % lum))
    return ("PASS", "dark surfaces (luminance %.2f)" % lum) if lum < 0.35 else (("FAIL", "page is light (luminance %.2f)" % lum) if lum > 0.6 else ("UNVERIFIED", "mixed surfaces (luminance %.2f)" % lum))


def baseline_key(build_sha, viewport, lens, name):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", "%s__%dx%d__%s__%s" % (build_sha, viewport[0], viewport[1], lens, name))


def diff_ratio(a, b, tol=12):
    Image = _pil()
    if Image is None:
        return None
    try:
        ia, ib = Image.open(io.BytesIO(a)).convert("L"), Image.open(io.BytesIO(b)).convert("L")
    except Exception:
        return None
    if ia.size != ib.size:
        return 1.0
    pa, pb = list(ia.getdata()), list(ib.getdata())
    return sum(1 for x, y in zip(pa, pb) if abs(x - y) > tol) / float(len(pa) or 1)


def baseline_diff(store_dir, key, png, max_changed=0.01):
    """Compare to the walker's own baseline for the SAME build+viewport. First sight records the baseline and is UNVERIFIED
    (a baseline alone proves nothing); a changed ratio over max_changed is FAIL."""
    path = os.path.join(store_dir, key + ".png")
    if not os.path.exists(path):
        os.makedirs(store_dir, exist_ok=True)
        open(path, "wb").write(png)
        return "UNVERIFIED", "baseline recorded for %s; nothing to compare against yet" % key
    r = diff_ratio(open(path, "rb").read(), png)
    if r is None:
        return "UNVERIFIED", "cannot decode screenshots (Pillow absent)"
    return ("PASS", "%.2f%% of pixels changed (<= %.2f%%)" % (r * 100, max_changed * 100)) if r <= max_changed else ("FAIL", "%.2f%% of pixels changed (> %.2f%%)" % (r * 100, max_changed * 100))


def layout_boxes(boxes, vw, vh, min_overlap=0.2):
    """boxes: [{name, x, y, w, h, visible}] of controls that must not overlap or leave the viewport. -> (state, detail)."""
    if not boxes:
        return "UNVERIFIED", "no boxes measured"
    issues = []
    vis = [b for b in boxes if b.get("visible", True)]
    for b in boxes:
        if b.get("visible") is False:
            issues.append("%s is not visible" % b.get("name"))
    for i, a in enumerate(vis):
        if a["x"] < -1 or a["y"] < -1 or a["x"] + a["w"] > vw + 1 or a["y"] + a["h"] > vh + 1:
            issues.append("%s extends outside the %dx%d viewport" % (a.get("name"), vw, vh))
        for b in vis[i + 1:]:
            ox = max(0, min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"]))
            oy = max(0, min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"]))
            small = min(a["w"] * a["h"], b["w"] * b["h"]) or 1
            if ox * oy / small > min_overlap:
                issues.append("%s overlaps %s" % (a.get("name"), b.get("name")))
    return ("FAIL", "; ".join(issues[:4])) if issues else ("PASS", "%d box(es) visible, inside the viewport, no overlap" % len(vis))


# ------------------------------------------------------------------ human-only reasons (per ticket, exact)
HUMAN_REASON = {
    "code_read": "needs a person (or a source grep) to read the served code/DOM for hidden AI-directed text or browser-tooling issues; the walker's hiddentext check covers rendered text only, not a code read",
    "other_with_note": None,    # the rewrite record's own note is the reason
}


def classify_human_only(reason, note=None, expected=""):
    """-> {"route": lighthouse|cross_account|visual|human, "why": str}."""
    if reason == "lighthouse":
        return {"route": "lighthouse", "why": "automated via lighthouse CLI + thresholds parsed from the ticket"}
    if reason == "cross_account":
        return {"route": "cross_account", "why": "automated via t1/t2/signed-out A/B isolation"}
    if reason == "visual":
        if re.search(r"(?i)\b(light|dark)\b", expected or "") or "theme" in (note or "").lower():
            return {"route": "visual", "why": "theme surface luminance + baseline diff"}
        return {"route": "human", "why": (note or "a visual judgement with no stated, measurable criterion (e.g. 'Visual check' -> 'Readable')")}
    if reason == "code_read":
        return {"route": "human", "why": note or HUMAN_REASON["code_read"]}
    return {"route": "human", "why": note or "no predicate can check it"}


def dispatch(route, ticket, env):
    """env: injected capabilities. Returns {"state", "reason"}; a missing capability is UNVERIFIED, never PASS."""
    if route == "lighthouse":
        th = lighthouse_thresholds("%s %s" % (ticket.get("repro_steps"), ticket.get("expected")))
        run = env.get("lighthouse")
        if not run:
            return {"state": "UNVERIFIED", "reason": "no lighthouse runner on this box"}
        r = run(th.get("form_factor"))
        if r.get("state") != "ok":
            return {"state": "UNVERIFIED", "reason": r.get("reason")}
        st, d = check_lighthouse(r["lhr"], th, env.get("requested_path"))
        return {"state": st, "reason": d}
    if route == "cross_account":
        f = env.get("ab")
        if not f:
            return {"state": "UNVERIFIED", "reason": "no t1/t2 sessions available"}
        st, d = ab_isolation(**f)
        return {"state": st, "reason": d}
    if route == "visual":
        shot, want = env.get("screenshot"), env.get("want_theme")
        if not shot or not want:
            return {"state": "UNVERIFIED", "reason": "no screenshot/theme to compare"}
        st, d = theme_surface_check(shot, want)
        return {"state": st, "reason": d}
    return {"state": "NEEDS_HUMAN", "reason": env.get("why") or "no automatable predicate"}
