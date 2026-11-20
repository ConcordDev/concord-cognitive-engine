"""Group raw fix_tickets.jsonl rows into shared root causes.

fix_tickets.jsonl is left untouched (each ticket stays raw and deduped).
This module writes audit/root_causes.json and audit/root_causes.md, one
row per cause, and is safe to re-run after every lens.
"""
import json, os, re, tempfile
from .util import human_et, ts_et

SEV_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}

_COUNT_LEAD = re.compile(r"^\s*\d+\s+")
_EXPAND_QUOTED = re.compile(
    r"(['\"])Expand\s+[^'\"]+?\s+sub-lenses\1", re.I)
_ESCAPE_EXPAND = re.compile(
    r"escape doesn't close the .+sub-lenses", re.I)
_OVERFLOW_390 = re.compile(r"off-screen at 390\s*px", re.I)
_CONTRAST = re.compile(r"WCAG AA contrast|text colour pair", re.I)
_EXPORT_NOFILE = re.compile(
    r"produces no file|export[^\n]{0,80}no file|\bno download\b", re.I)
_UNNAMED = re.compile(r"no accessible name|unnamed button", re.I)
_PAIR_ACTUAL = re.compile(
    r"#([0-9a-fA-F]{3,8})\s+on\s+#([0-9a-fA-F]{3,8})", re.I)
_PAIR_EVIDENCE = re.compile(
    r"contrast-([0-9a-fA-F]+)-on-([0-9a-fA-F]+)", re.I)
_WS = re.compile(r"\s+")


def max_severity(sevs):
    best, best_n = "low", -1
    for s in sevs:
        key = (s or "low").strip().lower()
        n = SEV_RANK.get(key, -1)
        if n > best_n:
            best, best_n = key, n
    return best


def _lens_slugs(tickets, extra=None):
    slugs = {str(t.get("lens") or "").strip() for t in tickets if t.get("lens")}
    if extra:
        slugs.update(extra)
    slugs.discard("")
    return slugs


def _strip_lens_prefix(text, slugs):
    text = (text or "").strip()
    for slug in sorted(slugs, key=len, reverse=True):
        pref = slug + "/"
        if text.startswith(pref):
            return text[len(pref):].strip()
        if text == slug:
            return ""
    return text


def _evidence_list(ticket):
    ev = ticket.get("evidence")
    paths = []
    if isinstance(ev, list):
        paths.extend(str(x).strip() for x in ev if x)
    elif ev:
        paths.extend(p.strip() for p in str(ev).split(";") if p.strip())
    ep = ticket.get("evidence_path")
    if ep:
        paths.extend(p.strip() for p in str(ep).split(";") if p.strip())
    # stable unique, first-seen order
    out, seen = [], set()
    for p in paths:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def contrast_pairs(ticket):
    """(#fg, #bg) pairs from actual text and contrast evidence filenames."""
    found = []
    seen = set()
    for m in _PAIR_ACTUAL.finditer(str(ticket.get("actual") or "")):
        pair = ("#" + m.group(1).lower(), "#" + m.group(2).lower())
        if pair not in seen:
            seen.add(pair)
            found.append(pair)
    blob = " ".join(_evidence_list(ticket))
    for m in _PAIR_EVIDENCE.finditer(blob):
        pair = ("#" + m.group(1).lower(), "#" + m.group(2).lower())
        if pair not in seen:
            seen.add(pair)
            found.append(pair)
    return found


def _norm_title(title):
    t = (title or "").strip()
    t = _EXPAND_QUOTED.sub("the Expand sub-lenses menu", t)
    t = _COUNT_LEAD.sub("", t)
    t = _WS.sub(" ", t).strip(" .")
    return t


def _is_ticket(obj):
    """True when obj looks like a raw walker ticket, not an update or junk."""
    if not isinstance(obj, dict):
        return False
    if obj.get("type"):
        return False
    title = (obj.get("title") or "").strip()
    if not title:
        return False
    # A ticket has an id or a lens (or both). A shapeless dict with only
    # a stray title and no identity is still groupable by title, but we
    # require at least one of id/lens so unknown stubs are rejected.
    if not (obj.get("id") or obj.get("lens")):
        return False
    return True


def load_tickets(path):
    """Load fix_tickets.jsonl, skipping empty, malformed, and unknown rows.

    Returns (tickets, skipped) where skipped is a list of {line, reason}.
    An empty or missing file is not an error: tickets=[], skipped=[].
    """
    if not path or not os.path.exists(path):
        return [], []
    tickets, skipped = [], []
    with open(path) as f:
        raw = f.read()
    if raw.strip() == "":
        return [], []
    for i, line in enumerate(raw.splitlines(), 1):
        s = line.strip()
        if not s:
            continue
        try:
            obj = json.loads(s)
        except json.JSONDecodeError as e:
            skipped.append({"line": i, "reason": "malformed json: %s" % e})
            continue
        if not _is_ticket(obj):
            skipped.append({"line": i, "reason": "unknown ticket shape",
                            "id": (obj.get("id") if isinstance(obj, dict) else None)})
            continue
        tickets.append(obj)
    return tickets, skipped


def _signatures_for(ticket, slugs):
    """One or more (signature, title, suspected_area_hint) tuples."""
    title = ticket.get("title") or ""
    lens = (ticket.get("lens") or "").strip()
    area = _strip_lens_prefix(ticket.get("suspected_area") or "", slugs)
    element = (ticket.get("element") or ticket.get("selector") or "").strip()

    if _ESCAPE_EXPAND.search(title):
        return [("escape.sub_lens_expand_menu",
                 "Escape doesn't close the Expand sub-lenses menu/panel",
                 area or "overlay keyboard")]
    if _OVERFLOW_390.search(title):
        return [("overflow.offscreen_390",
                 "Controls off-screen at 390 px with no way to scroll to them",
                 area or "mobile layout")]
    if _CONTRAST.search(title):
        pairs = contrast_pairs(ticket)
        if not pairs:
            return [("contrast.unknown_pair",
                     "Text fails WCAG AA contrast",
                     area or "theme tokens")]
        out = []
        for fg, bg in pairs:
            key = "contrast.%s_on_%s" % (fg.lstrip("#"), bg.lstrip("#"))
            out.append((key,
                        "Text fails WCAG AA contrast: %s on %s" % (fg, bg),
                        area or "theme tokens"))
        return out
    if _EXPORT_NOFILE.search(title):
        slug = lens or "unknown"
        return [("export.no_file.%s" % slug,
                 "%s: %s" % (slug, title),
                 area or "export")]
    if _UNNAMED.search(title):
        return [("a11y.unnamed_control",
                 "Controls have no accessible name",
                 area or "a11y labels")]

    # Generic: group by shared element/selector when present, otherwise
    # a per-lens functional row (normalized title, lens kept in the key).
    norm = _norm_title(title) or "untitled"
    slug = lens or "unknown"
    if element:
        key = "component.%s" % re.sub(r"[^a-zA-Z0-9._-]+", "_", element.lower())[:80]
        return [(key, norm, area or element)]
    key = "lens.%s.%s" % (
        slug, re.sub(r"[^a-zA-Z0-9._-]+", "_", norm.lower())[:80].strip("_"))
    return [(key, "%s: %s" % (slug, title), area or "lens")]


def group_tickets(tickets, slugs=None):
    """Return a list of root-cause row dicts for valid tickets."""
    slugs = _lens_slugs(tickets, slugs)
    buckets = {}
    order = []
    for t in tickets:
        for sig, title, area in _signatures_for(t, slugs):
            if sig not in buckets:
                buckets[sig] = {"signature": sig, "title": title,
                                "area_votes": [], "members": []}
                order.append(sig)
            b = buckets[sig]
            b["members"].append(t)
            if area:
                b["area_votes"].append(area)
    rows = []
    for sig in order:
        b = buckets[sig]
        members = b["members"]
        lenses, seen_l = [], set()
        for t in members:
            lens = (t.get("lens") or "").strip()
            if lens and lens not in seen_l:
                seen_l.add(lens)
                lenses.append(lens)
        ev, seen_e = [], set()
        for t in members:
            for p in _evidence_list(t):
                if p not in seen_e:
                    seen_e.add(p)
                    ev.append(p)
            if len(ev) >= 6:
                break
        votes = {}
        for a in b["area_votes"]:
            votes[a] = votes.get(a, 0) + 1
        area = max(votes, key=lambda k: (votes[k], -len(k))) if votes else ""
        ids = []
        seen_i = set()
        for t in members:
            i = t.get("id")
            if i and i not in seen_i:
                seen_i.add(i)
                ids.append(i)
        rows.append({
            "signature": sig,
            "title": b["title"],
            "severity": max_severity(t.get("severity") for t in members),
            "count": len(ids) if ids else len(members),
            "lenses": lenses,
            "evidence": ev[:6],
            "suspected_area": area,
            "ticket_ids": ids,
        })
    # Stable report order: more members first, then signature.
    rows.sort(key=lambda r: (-r["count"], r["signature"]))
    return rows


def build_report(path, slugs=None):
    tickets, skipped = load_tickets(path)
    rows = group_tickets(tickets, slugs=slugs)
    return {
        "generated_at": ts_et(),
        "source": path,
        "ticket_count": len(tickets),
        "skipped": len(skipped),
        "skipped_detail": skipped,
        "row_count": len(rows),
        "rows": rows,
    }


def render_md(report):
    lines = ["# Walker root causes\n\n",
             "Generated %s. %d ticket(s) → %d root-cause row(s)"
             % (human_et(), report["ticket_count"], report["row_count"])]
    if report["skipped"]:
        lines.append(" (%d skipped)" % report["skipped"])
    lines.append(".\n\n")
    lines.append("| signature | title | severity | count | lenses | suspected_area |\n")
    lines.append("|---|---|---|---:|---|---|\n")
    for r in report["rows"]:
        lenses = ", ".join(r["lenses"]) or "-"
        title = (r["title"] or "").replace("|", "\\|")
        area = (r["suspected_area"] or "-").replace("|", "\\|")
        lines.append("| `%s` | %s | %s | %d | %s | %s |\n" % (
            r["signature"], title, r["severity"], r["count"], lenses, area))
    if not report["rows"]:
        lines.append("\n_No root-cause rows._\n")
    else:
        lines.append("\n")
        for r in report["rows"]:
            lines.append("## `%s`\n\n" % r["signature"])
            lines.append("**%s** — %s — %d ticket(s) — lenses: %s\n\n" % (
                r["title"], r["severity"], r["count"],
                ", ".join(r["lenses"]) or "-"))
            if r.get("evidence"):
                lines.append("Example evidence:\n")
                for p in r["evidence"][:4]:
                    lines.append("- `%s`\n" % p)
                lines.append("\n")
    return "".join(lines)


def _atomic_write(path, text):
    d = os.path.dirname(path) or "."
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-root-causes-", suffix=".tmp", dir=d)
    try:
        with os.fdopen(fd, "w") as f:
            f.write(text)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_root_causes(audit_dir, log=None, slugs=None,
                      tickets_name="fix_tickets.jsonl"):
    """Regenerate root_causes.json and root_causes.md from the ticket file.

    Never raises into the walk: errors are logged and returned as None.
    """
    try:
        src = os.path.join(audit_dir, tickets_name)
        report = build_report(src, slugs=slugs)
        public = {k: v for k, v in report.items() if k != "skipped_detail"}
        # keep skip detail only when something was skipped
        if report["skipped"]:
            public["skipped_detail"] = report["skipped_detail"]
        _atomic_write(os.path.join(audit_dir, "root_causes.json"),
                      json.dumps(public, indent=2) + "\n")
        _atomic_write(os.path.join(audit_dir, "root_causes.md"),
                      render_md(report))
        if log:
            log("root causes: %d row(s) from %d ticket(s)%s" % (
                report["row_count"], report["ticket_count"],
                (", %d skipped" % report["skipped"]) if report["skipped"] else ""))
        return report
    except Exception as e:
        if log:
            log("root causes write failed: %s: %s" % (type(e).__name__, e))
        return None
