import json, os, re, time, datetime, fcntl, contextlib
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


def load_config(path=None):
    path = path or os.path.join(WALKER_DIR, "config.json")
    with open(path) as f:
        cfg = json.load(f)
    cfg["_walker_dir"] = WALKER_DIR
    return cfg


def mem_available_mb():
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) // 1024
    except OSError:
        pass
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
