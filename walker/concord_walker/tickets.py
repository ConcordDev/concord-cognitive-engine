"""fix_tickets.jsonl: load, dedupe, id assignment, append in the testers' exact format."""
import json, os, re, shutil, difflib
from .util import file_lock, ts_et, run_id, append_jsonl

TICKET_KEYS = ["id", "lens", "severity", "title", "repro_steps", "expected", "actual",
               "evidence_path", "suspected_area", "status", "tester", "ts"]

# Category keyword sets used to match a walker finding to a human-filed ticket on the same lens.
CATEGORY_WORDS = {
    "contrast": r"contrast|wcag|legib|low.contrast|hard to read|faint|grey on|gray on",
    "escape": r"escape|\besc\b",
    "focus_return": r"focus.{0,30}(return|restore|lost|back)|return.{0,10}focus",
    "focus_trap": r"focus.{0,15}trap|focus (escapes|leaves)|tab.{0,20}(behind|background)",
    "focus_visible": r"focus (ring|indicator|outline|visible)|visible focus|no focus",
    "keyboard": r"keyboard|tab order|not focusable|tabindex|unreachable by tab",
    "unnamed": r"accessible name|aria-label|unlabel|unnamed|no label|icon.only|screen reader",
    "export": r"export|download",
    "delete_confirm": r"(no|without|missing|skips?|lacks?)\b.{0,25}(confirm|prompt|warning|undo)|confirm.{0,30}(delet|remov)|(delet|remov|trash).{0,40}(confirm|undo|instant|immediate)",
    "overflow390": r"(390|mobile|narrow|phone).{0,80}(horizontal(ly)?|sideways|overflow|cut off|clipp|off.?screen|wider|truncat)|(horizontal(ly)?|sideways|overflow|cut off|clipp|off.?screen|wider|truncat).{0,80}(390|mobile|narrow|phone)",
    "timing": r"slow|latency|takes \d|seconds|\d+\s?ms|timeout|timed out|load time|hang",
    "pageerror": r"console|uncaught|exception|typeerror|error boundary|crash",
    "http": r"\b(4\d\d|5\d\d)\b|500|502|503|404|failed request|network error",
    "tab_error": r"something went wrong|error|crash|blank|white screen|404|not found|fails to render",
    "crash": r"crash|aw, snap|renderer|out of memory|oom",
    "reach": r"404|not found|doesn.t load|fails to load|blank page|redirect",
    "hotkey": r"hotkey|keystroke|first key|steal|closes on (first )?(key|typing)",
    "persistence": r"reload|persist|vanish|disappear|lost after",
}


def _norm(s):
    return re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower())


def _text(t):
    parts = [t.get("title"), t.get("actual"), t.get("expected")]
    rs = t.get("repro_steps")
    parts.append(" ".join(rs) if isinstance(rs, list) else rs)
    return _norm(" ".join(p for p in parts if isinstance(p, str)))


class TicketStore:
    def __init__(self, audit_dir, fold=None):
        # WALK-01: with a fold (GB-1544), the read path is the branch fold at a
        # pinned sha (fix_tickets.jsonl + records/*.jsonl); without one, the
        # legacy single-file read stands. self.path stays the main file either
        # way: it is written ONLY by append_tickets (new walker tickets).
        self.path = os.path.join(audit_dir, "fix_tickets.jsonl")
        self.fold = fold
        if fold is not None:
            self.base, self.updates = fold.base, fold.updates
        else:
            self.reload()

    def reload(self):
        if self.fold is not None:
            self.base, self.updates = self.fold.base, self.fold.updates
            return
        self.base, self.updates = {}, {}
        with open(self.path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if d.get("type"):
                    self.updates.setdefault(d.get("id"), []).append(d)
                elif d.get("id") and d["id"] not in self.base:
                    self.base[d["id"]] = d
                elif d.get("id"):
                    # later full record for same id: treat as update of status/fields
                    self.updates.setdefault(d["id"], []).append(d)

    def get(self, tid):
        t = self.base.get(tid)
        if not t:
            return None
        t = dict(t)
        for u in self.updates.get(tid, []):
            if u.get("status") and u.get("type") in (None, "retest_update", "followup", "correction", "record"):
                t["status"] = u["status"]
            t.setdefault("_updates", []).append(u)
        return t

    def status(self, tid):
        t = self.get(tid)
        return str((t or {}).get("status") or "OPEN").strip().upper()

    def lane(self, tid):
        from .fold import lane_of
        return lane_of(self.get(tid))

    def lens_tickets(self, lens):
        return [self.get(i) for i, t in self.base.items() if t.get("lens") == lens]

    def next_id(self, lens, reserved=()):
        mx = 0
        pat = re.compile(r"^FIX-" + re.escape(lens) + r"-(\d+)$")
        for i in list(self.base) + list(reserved):
            m = pat.match(i)
            if m:
                mx = max(mx, int(m.group(1)))
        return "FIX-%s-%03d" % (lens, mx + 1)

    # Findings that describe the whole lens (no specific element) may match on category alone.
    LENS_LEVEL = {"contrast", "overflow390", "unnamed", "focus_visible", "pageerror", "http", "delete_confirm", "reach", "crash", "hotkey"}

    def find_duplicate(self, finding):
        """Return the existing ticket id this finding duplicates, or None.
        Rules (same lens only): title similarity >= 0.72; or category keywords hit AND the finding's
        element (tab/dialog/control name) appears in the ticket; or, for lens-level findings with no
        element, category keywords hit in the ticket TITLE (or anywhere with similarity >= 0.45)."""
        cat = finding["check"]
        words = CATEGORY_WORDS.get(cat)
        elem = _norm(finding.get("element") or "").strip()
        best, best_score = None, 0.0
        for t in self.lens_tickets(finding["lens"]):
            if not t:
                continue
            txt = _text(t)
            sim = difflib.SequenceMatcher(None, _norm(finding["title"]), _norm(t.get("title"))).ratio()
            cat_hit = bool(words and re.search(words, txt))
            cat_title = bool(words and re.search(words, _norm(t.get("title"))))
            elem_hit = bool(elem) and len(elem) >= 3 and re.search(r"\b" + re.escape(elem) + r"\b", txt) is not None
            if sim >= 0.72:
                dup = True
            elif elem:
                dup = cat_hit and elem_hit
            else:
                dup = cat in self.LENS_LEVEL and (cat_title or (cat_hit and sim >= 0.45))
            score = sim + (0.5 if cat_hit else 0) + (0.4 if elem_hit else 0)
            if dup and score > best_score:
                best, best_score = t["id"], score
        return best

    def to_ticket(self, finding, tid, tester):
        ev = finding.get("evidence") or []
        t = {
            "id": tid,
            "lens": finding["lens"],
            "severity": finding.get("severity", "low"),
            "title": finding["title"],
            "repro_steps": finding["repro_steps"],
            "expected": finding["expected"],
            "actual": finding["actual"],
            "evidence_path": "; ".join(ev),
            "suspected_area": finding.get("suspected_area", "%s/%s" % (finding["lens"], finding["check"])),
            "status": "OPEN",
            "tester": tester,
            "ts": ts_et(),
        }
        if finding.get("root_cause"):
            t["root_cause"] = finding["root_cause"]
        return t

    def append_tickets(self, tickets, backup_tag):
        if not tickets:
            return None
        with file_lock(self.path):
            bak = "%s.bak-walker-%s-%s" % (self.path, backup_tag, run_id())
            shutil.copy2(self.path, bak)
            with open(self.path, "a") as f:
                for t in tickets:
                    f.write(json.dumps(t) + "\n")
        self.reload()
        return bak

    def append_update(self, rec):
        with file_lock(self.path):
            with open(self.path, "a") as f:
                f.write(json.dumps(rec) + "\n")
        self.reload()
