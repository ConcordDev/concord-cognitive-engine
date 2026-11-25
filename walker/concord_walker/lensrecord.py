"""MST-W0-01: lens record schema v2, the build stamp, and the run manifest.

v2 adds (all v1 keys stay unchanged):
  schema_version: 2
  deploy: {backend_sha, frontend_build_id, walker_sha, walker_dirty, base_url, checked_at, walked_at,
           sha_status: ok|missing|mismatch|drift, sha_note}
  findings[]: {id, signature, check, severity, area, title, evidence[], build_sha, walked_at}
  screenshots[]: {path, kind: initial|open|after_escape|m390|mid_task|failure}
  premap_findings[]: {class, control_id, sid, title, evidence[], build_sha, walked_at} (recorded, never filed in Wave 0)
  controls[] / endpoints[] / actions[] / net (MST-W0-02, see netledger.py)

The build stamp is first-class: a missing or mismatched /health buildSha is
FLAGGED (deploy.sha_status != ok), never silently treated as the current build.
contains_commit() answers "does build X contain fix commit Y" with
git merge-base --is-ancestor and returns "unknown" whenever git cannot decide.
v1 records stay readable: load_lens_record() normalizes them (schema_version 1,
no controls, a `v1` marker) so every consumer can take either.

Packet identity (walk-2 gate §16, ULW C30/C32/C27): every record carries ONE
canonical packet_id — {slug}@{backend_sha[:12]}:v{packet_version} — the single
field the packet is cited by (the recipe layer validates this exact shape).
packet_version is the capture generation for the lens: v1 is the first
capture; a re-capture that supersedes a prior packet bumps the version and
names the replaced packet_id in `supersedes`, so an old map is retired by
name, never by drift. `wiring_provenance` records that the record's wiring
(controls/endpoints/actions) was captured on the clean happy path (§12):
fuzz observations file as findings only and never enter capture wiring —
formfuzz runs in the reverify lane, not in the capture walk.
"""
import json, os, subprocess
from .util import human_et, now_et
from . import sha_gate

SCHEMA_VERSION = 2
PACKET_VERSION = 1
WIRING_PROVENANCE = "clean_happy_path"
V1_KEYS = ("slug", "url", "account", "admin", "started", "finished", "elapsed_s", "checks", "timing_desktop",
           "initial_evidence", "perf_metrics", "surface", "console", "budget", "budget_aborted", "new_tickets", "duplicates")


def iso_et():
    return now_et().strftime("%Y-%m-%dT%H:%M:%S%z")


def walker_sha(walker_dir):
    """(sha, dirty) of the walker checkout; (None, None) when git can't tell.
    ULW v3 W4: when the walker dir is not a git checkout (a packaged run dir),
    fall back to a WALKER_SHA file — <walker_dir>/WALKER_SHA, then
    <walker_dir>/code/WALKER_SHA — so the run log stops printing walker=?
    for packaged runs. Dirty is unknown for the file form: None, never a guess."""
    try:
        sha = subprocess.run(["git", "-C", walker_dir, "rev-parse", "HEAD"], capture_output=True, text=True,
                             timeout=10).stdout.strip()
        if sha_gate.is_hex_sha(sha):
            st = subprocess.run(["git", "-C", walker_dir, "status", "--porcelain", "--untracked-files=no", "--", "."],
                                capture_output=True, text=True, timeout=10).stdout.strip()
            return sha, bool(st)
    except Exception:
        pass
    if walker_dir:
        for cand in (os.path.join(walker_dir, "WALKER_SHA"),
                     os.path.join(walker_dir, "code", "WALKER_SHA")):
            try:
                with open(cand) as f:
                    sha = f.read().strip()
                if sha_gate.is_hex_sha(sha):
                    return sha, None
            except Exception:
                continue
    return None, None


def deploy_stamp(base_url, walker_dir=None, expect_sha=None, fetch=None, previous=None):
    """Stamp for one lens record. sha_status:
       ok       /health gave a hex buildSha (and it matches expect_sha when one is given)
       missing  /health gave no hex sha -> flagged; consumers must not treat the record as current
       mismatch expect_sha given and live differs
       drift    the live sha changed since `previous` (a deploy happened mid-run)"""
    sha, _src, fb = sha_gate.live_sha(base_url, fetch=fetch)
    ws, dirty = walker_sha(walker_dir) if walker_dir else (None, None)
    st, note = "ok", None
    if not sha:
        st, note = "missing", "/health reported no hex buildSha; record is NOT tied to a known build"
    elif expect_sha and not sha_gate.sha_matches(expect_sha, sha):
        st, note = "mismatch", "live %s != expected %s" % (sha[:12], str(expect_sha)[:12])
    elif previous and previous.get("backend_sha") and not sha_gate.sha_matches(previous["backend_sha"], sha):
        st, note = "drift", "live sha changed mid-run: %s -> %s" % (previous["backend_sha"][:12], sha[:12])
    return {"backend_sha": sha, "frontend_build_id": fb, "walker_sha": ws, "walker_dirty": dirty,
            "base_url": base_url, "checked_at": human_et(), "walked_at": iso_et(),
            "sha_status": st, "sha_note": note}


def row_stamp(deploy):
    """The compact stamp copied onto every ledger row / finding."""
    d = deploy or {}
    return {"build_sha": (d.get("backend_sha") or None) and d["backend_sha"][:12], "walked_at": d.get("walked_at")}


def packet_id_for(slug, deploy, version=None):
    """The canonical packet ID (gate §16): lens + build + version as ONE
    machine-readable field. The build segment is the record's own deploy
    stamp (12 chars, the row_stamp convention); a record with no build stamp
    names the segment 'unknown' — its deploy.sha_status already flags it as
    not tied to a known build, and the ID stays shape-valid so consumers can
    still cite (and distrust) it by name."""
    d = deploy or {}
    sha = (d.get("backend_sha") or "unknown")[:12]
    return "%s@%s:v%d" % (slug, sha, int(version or PACKET_VERSION))


def apply_supersession(rec, prior):
    """Record that `rec` supersedes the prior packet `prior` (a lens record
    dict or a bare packet_id string): rec names the replaced packet_id in
    `supersedes`, its packet_version becomes the prior's + 1, and its
    packet_id is recomputed. Returns rec. A prior from a DIFFERENT lens is a
    caller error and raises — supersession is per-lens by construction."""
    if isinstance(prior, dict):
        prior_id = prior.get("packet_id") or packet_id_for(prior.get("slug"), prior.get("deploy"),
                                                           prior.get("packet_version"))
        prior_version = int(prior.get("packet_version") or PACKET_VERSION)
        prior_slug = prior.get("slug")
    else:
        prior_id, prior_version, prior_slug = str(prior), None, None
        m = prior_id.rsplit(":v", 1)
        if len(m) == 2 and m[1].isdigit():
            prior_version = int(m[1])
        prior_slug = prior_id.split("@", 1)[0] if "@" in prior_id else None
    if prior_slug and rec.get("slug") and prior_slug != rec.get("slug"):
        raise ValueError("supersession is per-lens: %s cannot supersede %s" % (rec.get("slug"), prior_id))
    rec["supersedes"] = prior_id
    rec["packet_version"] = (prior_version or PACKET_VERSION) + 1
    rec["packet_id"] = packet_id_for(rec.get("slug"), rec.get("deploy"), rec["packet_version"])
    return rec


def contains_commit(repo, build_sha, fix_sha, runner=subprocess.run):
    """True / False / 'unknown'. Never assumes: no repo, a non-hex sha, an object git
    doesn't have, or any git error -> 'unknown'."""
    if not (repo and sha_gate.is_hex_sha(build_sha or "") and sha_gate.is_hex_sha(fix_sha or "")):
        return "unknown"
    try:
        for s in (build_sha, fix_sha):
            r = runner(["git", "-C", repo, "cat-file", "-e", s + "^{commit}"], capture_output=True, timeout=60)
            if r.returncode != 0:
                return "unknown"
        r = runner(["git", "-C", repo, "merge-base", "--is-ancestor", fix_sha, build_sha], capture_output=True, timeout=120)
    except Exception:
        return "unknown"
    if r.returncode == 0:
        return True
    if r.returncode == 1:
        return False
    return "unknown"


def build_verdict(repo, deploy, fix_sha):
    """One line for reverify / packets: 'ran against build X, which does/doesn't contain fix Y'."""
    d = deploy or {}
    b = d.get("backend_sha")
    if not b:
        if not fix_sha:
            return "ran against an UNKNOWN build (no buildSha stamp on this record)"
        return "ran against an UNKNOWN build (no buildSha stamp): cannot say whether fix %s is in it" % fix_sha[:12]
    flag = "" if d.get("sha_status") in (None, "ok") else " [build stamp %s: %s]" % (d.get("sha_status"), d.get("sha_note"))
    if not fix_sha:
        return "ran against build %s (no fix commit named)%s" % (b[:12], flag)
    c = contains_commit(repo, b, fix_sha)
    word = {True: "which CONTAINS", False: "which does NOT contain"}.get(c, "containment UNKNOWN for")
    return "ran against build %s, %s fix commit %s%s" % (b[:12], word, fix_sha[:12], flag)


_KIND = (("fail-", "failure"), ("desktop-initial", "initial"), ("open-", "open"), ("after-escape", "after_escape"), ("m390", "m390"))


def shot_kind(name):
    for pre, kind in _KIND:
        if (name or "").startswith(pre):
            return kind
    return "mid_task"


def findings_v2(filed, slugs, deploy):
    """filed: [(finding, ticket_id, 'new'|'dup')] -> v2 findings[] with signatures."""
    from .root_causes import _signatures_for
    out = []
    st = row_stamp(deploy)
    for f, tid, how in filed:
        t = {"id": tid, "lens": f.get("lens"), "title": f.get("title"), "suspected_area": f.get("suspected_area"),
             "element": f.get("element")}
        try:
            sig = _signatures_for(t, slugs)[0][0]
        except Exception:
            sig = "unknown"
        row = {"id": tid, "signature": sig, "check": f.get("check"), "severity": f.get("severity"),
               "area": f.get("suspected_area"), "title": f.get("title"), "evidence": list(f.get("evidence") or []),
               "filed": how}
        row.update(st)
        out.append(row)
    return out


def upgrade_record(res, deploy, filed, slugs, screenshots, net=None, premap_findings=None, prior=None):
    """Add the v2 keys to a v1 result dict in place (v1 keys untouched).
    `prior` (the lens's previous record, when the finalize path has one)
    records supersession on the new packet (§16); without one the packet is
    its lens's current generation as stamped."""
    res["schema_version"] = SCHEMA_VERSION
    res["deploy"] = deploy
    res["findings"] = findings_v2(filed, slugs, deploy)
    res["screenshots"] = screenshots
    res["premap_findings"] = list(premap_findings or [])
    if net is not None:
        controls, endpoints, actions, summary = net
        res["controls"], res["endpoints"], res["actions"], res["net"] = controls, endpoints, actions, summary
    res["packet_version"] = int(res.get("packet_version") or PACKET_VERSION)
    res["packet_id"] = packet_id_for(res.get("slug"), deploy, res["packet_version"])
    res["wiring_provenance"] = WIRING_PROVENANCE
    if prior is not None:
        apply_supersession(res, prior)
    return res


def load_lens_record(path):
    """Read a lens-<slug>.json of either schema. v1 gets schema_version=1, v1=True, and empty v2 slots."""
    with open(path) as f:
        rec = json.load(f)
    if not isinstance(rec, dict):
        raise ValueError("lens record is not an object: %s" % path)
    if rec.get("schema_version", 1) < 2:
        rec["schema_version"] = 1
        rec["v1"] = True
        rec.setdefault("deploy", {"backend_sha": None, "sha_status": "missing",
                                  "sha_note": "v1 record: no build stamp"})
        rec.setdefault("findings", [])
        rec.setdefault("screenshots", [{"path": rec["initial_evidence"], "kind": "initial"}]
                       if rec.get("initial_evidence") else [])
    # Packet identity (§16): records written before the field existed derive
    # it from slug + deploy stamp at generation v1, so every consumer can
    # cite any record by its canonical ID. A stamped field is never rewritten.
    if not rec.get("packet_id"):
        rec["packet_version"] = int(rec.get("packet_version") or PACKET_VERSION)
        rec["packet_id"] = packet_id_for(rec.get("slug"), rec.get("deploy"), rec["packet_version"])
    return rec


class Manifest:
    """walk-manifest.json: {run_id, schema_version, deploy, lenses:[{slug, status, reason, checks_not_run}]}
    rewritten atomically after every lens so a crash leaves a valid file."""

    def __init__(self, run_dir, rid, total):
        self.path = os.path.join(run_dir, "walk-manifest.json")
        self.prior_sha = None
        self.data = {"run_id": rid, "schema_version": SCHEMA_VERSION, "deploy": None, "total": total,
                     "state": "running", "lenses": []}
        if os.path.exists(self.path):
            try:
                old = json.load(open(self.path))
                if old.get("run_id") == rid:
                    self.prior_sha = old.get("build_sha")      # the build this run started on (resume must match it)
                    self.data["build_sha"] = self.prior_sha
                    self.data["lenses"] = old.get("lenses", [])
                    self.data["resumes"] = old.get("resumes", 0) + 1
            except Exception:
                pass

    def walked_slugs(self):
        return {l["slug"] for l in self.data["lenses"] if l["status"] == "walked"}

    def lens(self, slug, status, reason=None, checks_not_run=None, deploy=None, state=None):
        self.data["lenses"] = [l for l in self.data["lenses"] if l["slug"] != slug]
        row = {"slug": slug, "status": status, "reason": reason, "checks_not_run": checks_not_run or []}
        if state:
            row["state"] = state          # DONE/PARTIAL/CRASHED/... ; `status` ("walked"/"aborted") stays what --resume + start.sh read
        if deploy:
            row.update(row_stamp(deploy))
            row["sha_status"] = deploy.get("sha_status")
        self.data["lenses"].append(row)
        self.save()

    def finish(self, state, deploy=None, note=None):
        self.data["state"] = state
        if deploy:
            self.data["deploy"] = deploy
        if note:
            self.data["note"] = note
        self.save()

    def counts(self):
        walked = sum(1 for l in self.data["lenses"] if l["status"] == "walked")
        return walked, self.data["total"]

    def save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.data, f, indent=1, sort_keys=True)
        os.replace(tmp, self.path)


def checks_not_run(res):
    return sorted(k for k, v in (res.get("checks") or {}).items() if v.get("status") == "NOT_RUN")
