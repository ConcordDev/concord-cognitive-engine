import json, os, re, subprocess, sys, time, datetime, fcntl, contextlib
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
WALKER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def now_et():
    return datetime.datetime.now(ET)


def ts_et():
    """Ticket ts format used by the testers, e.g. 2026-11-13T01:51-05:00"""
    return now_et().strftime("%Y-%m-%dT%H:%M%z")[:-2] + ":" + now_et().strftime("%z")[-2:]


def human_et():
    return now_et().strftime("%Y-%m-%d %-I:%M %p ET")


def run_id():
    return now_et().strftime("%Y%m%d-%H%M%S")


_UNSAFE_FILENAME = re.compile(r"[^A-Za-z0-9._-]+")


def safe_filename(name):
    """A single path component for a lens slug (or similar label).

    Nested slugs like world-creator/anomalies must not become subdirectories:
    '/' and '\\' become '__', other unsafe characters become '_'. Never
    returns empty, '.', or '..', and never contains a path separator.
    """
    s = str(name or "")
    s = s.replace("/", "__").replace("\\", "__")
    s = _UNSAFE_FILENAME.sub("_", s)
    s = s.strip(" .")
    if s in ("", ".", ".."):
        return "slug"
    return s


def lens_result_path(run_dir, slug):
    """Run-dir path for the per-lens result JSON (slug sanitized)."""
    return os.path.join(run_dir, "lens-%s.json" % safe_filename(slug))


def resolve_config_path(cfg_dir, p):
    """Config-relative paths: an absolute path stands; a relative one resolves
    against the walker dir (the tree this code lives in), never the CWD."""
    if not p:
        return p
    return p if os.path.isabs(p) else os.path.join(cfg_dir, p)


def load_config(path=None):
    path = path or os.path.join(WALKER_DIR, "config.json")
    with open(path) as f:
        cfg = json.load(f)
    cfg["_walker_dir"] = WALKER_DIR
    # WALK-02: audit/runs/queue/evidence dirs are config-relative so the tree is
    # portable (Mac = source of truth, box = run host; no host-absolute paths).
    cfg.setdefault("audit_dir", "audit")
    for key in ("audit_dir", "runs_dir", "queue_dir", "evidence_dir"):
        if cfg.get(key):
            cfg[key] = resolve_config_path(WALKER_DIR, cfg[key])
    return cfg


def parse_vm_stat(text):
    """macOS vm_stat output -> available MB (free + inactive + speculative pages).
    Returns None when the text is not a parseable vm_stat dump."""
    if not text:
        return None
    m = re.search(r"page size of (\d+) bytes", text)
    if not m:
        return None
    page = int(m.group(1))
    pages = 0
    seen = False
    for key in ("Pages free", "Pages inactive", "Pages speculative"):
        m = re.search(r"^%s:\s+(\d+)\." % re.escape(key), text, re.M)
        if m:
            pages += int(m.group(1))
            seen = True
    if not seen:
        return None
    return pages * page // (1024 * 1024)


def mem_available_mb(_vm_stat_text=None):
    """Available memory in MB. Linux: /proc/meminfo MemAvailable. macOS has no
    /proc — fall back to vm_stat so the guard returns a finite number there too
    (before WALK-02 it silently returned 2^30, disabling the guard on macOS)."""
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) // 1024
    except OSError:
        pass
    if _vm_stat_text is not None or sys.platform == "darwin":
        text = _vm_stat_text
        if text is None:
            try:
                text = subprocess.run(["vm_stat"], capture_output=True, text=True, timeout=10).stdout
            except Exception:
                text = None
        mb = parse_vm_stat(text)
        if mb is not None:
            return mb
    return 1 << 30


@contextlib.contextmanager
def file_lock(path):
    with open(path + ".lock", "a+") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)


def append_jsonl(path, rec):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with file_lock(path):
        with open(path, "a") as f:
            f.write(json.dumps(rec) + "\n")


def append_text(path, text):
    # the parent dir may not exist yet (e.g. audit/reports on a fresh audit
    # dir): the first judgment of the Nov 16 05:24 live sweep crashed on it.
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with file_lock(path):
        with open(path, "a") as f:
            f.write(text)


SECRETISH = re.compile(r"(?i)(password|passwd|secret|token|api[_-]?key|authorization|cookie|session)[\"']?\s*[:=]\s*\S+")


def scrub(text, limit=160):
    """Neutral, bounded text for tickets: strip secret-ish pairs, quoted bodies and emails."""
    if text is None:
        return ""
    t = str(text)
    t = SECRETISH.sub(r"\1=<redacted>", t)
    t = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "<email>", t)
    t = re.sub(r"\"[^\"]{40,}\"", "\"<text>\"", t)
    t = re.sub(r"'[^']{40,}'", "'<text>'", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:limit]


def control_label(name, limit=48):
    """Control names are UI chrome; long names may be record content, so neutralise them."""
    n = re.sub(r"\s+", " ", (name or "")).strip()
    if not n:
        return "[unnamed control]"
    if len(n) > limit:
        return "[long-label control]"
    return n


class Log:
    def __init__(self, path=None, quiet=False):
        self.path, self.quiet = path, quiet

    def __call__(self, *a):
        msg = now_et().strftime("%H:%M:%S") + " " + " ".join(str(x) for x in a)
        if not self.quiet:
            print(msg, flush=True)
        if self.path:
            with open(self.path, "a") as f:
                f.write(msg + "\n")
