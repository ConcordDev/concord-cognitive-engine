"""WALK-05 (GB-1544): per-run RESULTS (md + csv) and the local review page.

RESULTS.md / results.csv carry one row per walked ticket:
id, verdict, recipe, evidence, live_sha — built from the run's reverify.jsonl
plus the ledger rows the run wrote (the ledger is the status of record; the
reverify rows carry the machine detail).

The review page turns a Partial row into a ~15 s human confirm: per category,
each row shows the ticket's expected text, its screenshot pair, and the machine
draft verdict; one key (v / r / c) records VERIFIED / REOPENED / can't-repro.
Decisions are appended by review_server.py to records/human.jsonl in the
WALK-01 union schema — the page itself is static and holds no state.
"""
import csv, html, io, json, os
from .util import ts_et

COLUMNS = ["id", "verdict", "recipe", "evidence", "live_sha"]


def build_rows(run_dir, ledger_rows=(), live_sha="unverified"):
    """One results row per reverify result, in run order."""
    rows = []
    path = os.path.join(run_dir, "reverify.jsonl")
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ev = [e for e in (r.get("evidence") or []) if e]
                rows.append({"id": r.get("id"), "verdict": r.get("verdict"), "recipe": r.get("method") or "",
                             "evidence": "; ".join(ev), "live_sha": live_sha})
    return rows


def write_results(run_dir, rows, rid):
    md = ["# Walker results %s\n" % rid, "| id | verdict | recipe | evidence | live_sha |\n|---|---|---|---|---|\n"]
    for r in rows:
        md.append("| %s | %s | %s | %s | %s |\n" % (r["id"], r["verdict"], r["recipe"],
                                                    (r["evidence"] or "-").replace("|", "/"), r["live_sha"]))
    with open(os.path.join(run_dir, "RESULTS.md"), "w") as f:
        f.write("".join(md))
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLUMNS)
    w.writeheader()
    for r in rows:
        w.writerow({k: r.get(k, "") for k in COLUMNS})
    tmp = os.path.join(run_dir, "results.csv.tmp")
    with open(tmp, "w") as f:
        f.write(buf.getvalue())
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, os.path.join(run_dir, "results.csv"))  # crash-safe publish
    return rows


def human_row(decision, *, live_sha, run_id, evidence_path="", expect_sha=None):
    """One review decision -> one union-schema row for records/human.jsonl.
    decision: {id, call: 'VERIFIED'|'REOPENED'|'CANT_REPRO', category?, evidence_path?}
    A VERIFIED call goes through ledger.make_row's gate (hex live_sha == expect_sha — the review
    server's --live-sha IS the gate-confirmed expect sha, run id, non-empty evidence)."""
    from .ledger import make_row
    call = str(decision.get("call") or "").upper()
    if call == "CANT_REPRO" or call == "CAN'T-REPRO":
        status, result = "NEEDS_HUMAN", "cant_repro"
    elif call in ("VERIFIED", "REOPENED"):
        status, result = call, "human_confirmed"
    else:
        raise ValueError("unknown review call: %r" % (decision.get("call"),))
    ev = evidence_path or decision.get("evidence_path") or ""
    return make_row(tid=decision["id"], status=status, live_sha=live_sha, run_id=run_id, recipe="human-review",
                    result=result, evidence_path=ev, account="human", expect_sha=expect_sha or live_sha)


def review_page(category, items):
    """items: [{id, expected, draft, evidence: [paths]}] -> a standalone HTML page.
    Keys: v = VERIFIED, r = REOPENED, c = can't-repro; each keypress POSTs the
    decision for the row in focus to /decision (review_server.py)."""
    cards = []
    for it in items:
        shots = "".join('<img src="file://%s" alt="evidence">' % html.escape(p) for p in (it.get("evidence") or [])[:2])
        cards.append(
            '<section class="card" data-id="%s" data-evidence="%s" tabindex="0">'
            "<h3>%s</h3><p class=\"expected\">%s</p>"
            "<p class=\"draft\">machine draft: <b>%s</b></p>"
            '<div class="shots">%s</div>'
            '<p class="keys">[v] VERIFIED &nbsp; [r] REOPENED &nbsp; [c] can\'t-repro &nbsp; <span class="state"></span></p>'
            "</section>" % (html.escape(str(it["id"])), html.escape("; ".join((it.get("evidence") or [])[:2])), html.escape(str(it["id"])),
                            html.escape(str(it.get("expected") or "")), html.escape(str(it.get("draft") or "")), shots))
    return """<!doctype html><meta charset="utf-8"><title>Walker review — %s</title>
<style>body{font-family:system-ui;background:#111;color:#eee} .card{border:1px solid #444;margin:1em;padding:1em}
.card:focus{outline:2px solid #6cf} img{max-width:48%%} .state{color:#8f8}</style>
<h1>Walker review — %s</h1><p>Click a card, then press v / r / c. Each keypress writes one human.jsonl row.</p>
%s
<script>
let cur=null;
document.querySelectorAll('.card').forEach(c=>c.addEventListener('click',()=>{cur=c;c.focus()}));
document.addEventListener('keydown',async e=>{
  if(!cur) return;
  const call={'v':'VERIFIED','r':'REOPENED','c':'CANT_REPRO'}[e.key.toLowerCase()];
  if(!call) return;
  const r=await fetch('/decision',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:cur.dataset.id,call,evidence_path:cur.dataset.evidence||''})});
  cur.querySelector('.state').textContent=r.ok?('recorded: '+call):'WRITE FAILED';
});
</script>""" % (html.escape(category), html.escape(category), "\n".join(cards))


def write_review_pages(run_dir, by_category):
    out = []
    rdir = os.path.join(run_dir, "review")
    os.makedirs(rdir, exist_ok=True)
    for cat, items in sorted(by_category.items()):
        p = os.path.join(rdir, "%s.html" % cat.replace("/", "-"))
        with open(p, "w") as f:
            f.write(review_page(cat, items))
        out.append(p)
    return out
