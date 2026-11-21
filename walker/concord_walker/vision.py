"""WALK-04d — before/after screenshot pairs + LLM-vision judge (GB-1544, U12).

For verdicts that need visual evidence (visual / layout / 390 / canvas rows),
the walker's deterministic checks can gather a screenshot but cannot decide
what it shows; those rows used to fall to NEEDS_HUMAN wholesale. This module
adds the machine judge the upgrade plan prices:

- a before/after screenshot pair per judged ticket (arrival + settled view),
  captured with the walker's own LensWalk.shot — no page JavaScript anywhere;
- an LLM-vision verdict against the ticket's `expected`, carrying a
  confidence, the model id, and per-run cap accounting on every row;
- low confidence, an absent pair, a judge error, a reached cap, or a
  spot-check-demoted category all degrade to NEEDS_HUMAN (the Partial path:
  the pair and any draft verdict ride along for the ~15 s human confirm);
- a deterministic 10% human spot-check sampler: if human verdicts disagree
  with the judge on more than 5% of a category's sampled rows, the category
  is demoted back to Partial (see SpotChecker.evaluate).

Fail-closed by construction: with no vision model configured (config
"vision_judge".enabled false, or no endpoint/key in the environment), the
judge is disabled and judge_ticket returns None — the caller keeps exactly
the pre-upgrade NEEDS_HUMAN behaviour. Screenshots live under the audit
evidence tree as always; records carry local paths only, never image bytes.
"""
import base64, hashlib, json, os, random, re, threading, urllib.error, urllib.request

from .util import append_jsonl, scrub, ts_et

FIXED, STILL, HUMAN = "FIXED", "STILL_FAILING", "NEEDS_HUMAN"

_VISUAL_WORDS = re.compile(r"(?i)screenshot|layout|overlap|clipped|canvas|render|looks|visual|"
                           r"aligned|alignment|off-?screen|cut off|hidden behind|obscured|spacing|"
                           r"truncat|wrapped|overflow|badge|icon|image|picture|chart|graph|map\b")
_MOBILE_WORDS = re.compile(r"(?i)390|mobile|phone|narrow")


def _ticket_text(t):
    rs = t.get("repro_steps")
    rs = " ".join(rs) if isinstance(rs, list) else (rs or "")
    return " ".join(str(t.get(k) or "") for k in ("title", "actual", "expected")) + " " + rs


def wants_visual(t):
    """True when the ticket's complaint is about what the surface looks like."""
    return bool(_VISUAL_WORDS.search(_ticket_text(t)))


def wants_mobile(t):
    # Mirrors reverify.wants_mobile (kept local: reverify imports this module).
    return bool(_MOBILE_WORDS.search(_ticket_text(t)))


# --------------------------------------------------------------------------
# Judge client protocol
#
# A client is a callable: client(images_b64, prompt) -> dict with keys
#   verdict:    "MATCHES_EXPECTED" | "DOES_NOT_MATCH" | "UNCERTAIN"
#   confidence: float 0..1
#   rationale:  short string
#   model:      the model id that actually answered (optional)
# The production adapter below speaks an OpenAI-compatible chat-completions
# endpoint; tests inject fakes. Any exception from a client is a judge
# failure, never a walker crash.
# --------------------------------------------------------------------------

_JUDGE_PROMPT = """You are the vision judge for a UI regression walker. A ticket claimed a visual defect was fixed; decide from two screenshots of the same view whether the CURRENT (settled) view matches the ticket's expected state.

Ticket title: {title}
Expected: {expected}
Reported defect (before the claimed fix): {actual}

The FIRST image is the view on arrival; the SECOND is the same view after settling. Judge the SECOND image against Expected. If the defect described is still visible, the answer is DOES_NOT_MATCH. If the view matches Expected, MATCHES_EXPECTED. If the images do not show the relevant surface, or you cannot tell, UNCERTAIN — never guess.

Answer with ONLY a JSON object: {{"verdict": "MATCHES_EXPECTED"|"DOES_NOT_MATCH"|"UNCERTAIN", "confidence": <0..1>, "rationale": "<= 200 chars"}}"""


class JudgeQueue:
    """Serializes judge calls — ONE in flight — with a single retry
    (GB-1581 item 2). In Walk 2, 233 of 312 judge calls died with
    TimeoutError because calls competed with the sweep for the local
    vision endpoint; queued calls at the raised timeout stop the pile-up.
    Counters ride VisionJudge.accounting() for the run record."""

    def __init__(self):
        self._lock = threading.Lock()
        self.in_flight = 0
        self.max_in_flight = 0
        self.retries = 0
        self.queued_calls = 0

    def call(self, client, images, prompt):
        with self._lock:
            self.in_flight += 1
            self.max_in_flight = max(self.max_in_flight, self.in_flight)
            self.queued_calls += 1
            try:
                try:
                    return client(images, prompt)
                except Exception:
                    self.retries += 1
                    return client(images, prompt)
            finally:
                self.in_flight -= 1


class HttpVisionClient:
    """OpenAI-compatible vision endpoint via urllib (stdlib only).

    Endpoint + key come from the environment (WALKER_VISION_URL,
    WALKER_VISION_API_KEY) or the config's vision_judge section; the key is
    never logged and never written anywhere. Model: config/env value; the
    id recorded on each verdict is the one the endpoint reports back when
    it reports one, else the configured id.
    """

    def __init__(self, url, api_key, model, timeout_s=180):
        self.url, self.api_key, self.model, self.timeout_s = url, api_key, model, timeout_s

    def __call__(self, images_b64, prompt):
        content = [{"type": "text", "text": prompt}]
        for b64 in images_b64:
            content.append({"type": "image_url",
                            "image_url": {"url": "data:image/png;base64," + b64}})
        body = json.dumps({"model": self.model, "temperature": 0,
                           "messages": [{"role": "user", "content": content}]}).encode()
        req = urllib.request.Request(self.url, data=body, method="POST", headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + self.api_key})
        with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
        text = data["choices"][0]["message"]["content"]
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            return {"verdict": "UNCERTAIN", "confidence": 0.0,
                    "rationale": "judge returned no JSON", "model": data.get("model") or self.model}
        out = json.loads(m.group(0))
        out["model"] = data.get("model") or self.model
        return out


class VisionJudge:
    """Owns pair capture, judge calls, the per-run cap, and the ledger."""

    def __init__(self, cfg, rec, log, client=None, demoted_categories=()):
        vcfg = cfg.get("vision_judge") or {}
        self.cfg, self.rec, self.log = cfg, rec, log
        self.cap = int(vcfg.get("cap_per_run", 300))
        self.threshold = float(vcfg.get("confidence_threshold", 0.8))
        self.model_cfg = vcfg.get("model") or os.environ.get("WALKER_VISION_MODEL", "")
        self.calls = 0
        self.judged = 0
        self.partial_due_to_cap = 0
        self.demoted = set(demoted_categories or ())
        self.ledger_path = os.path.join(rec.run_dir, "vision.jsonl")
        if client is not None:
            self.client = client
            self.enabled = True
            self.model_id = getattr(client, "model_id", None) or self.model_cfg or "injected-client"
        else:
            url = vcfg.get("url") or os.environ.get("WALKER_VISION_URL", "")
            key = vcfg.get("api_key") or os.environ.get("WALKER_VISION_API_KEY", "")
            self.client = None
            self.enabled = bool(vcfg.get("enabled")) and bool(url) and bool(self.model_cfg)
            if self.enabled:
                self.client = HttpVisionClient(url, key, self.model_cfg,
                                               timeout_s=float(vcfg.get("timeout_s", 180)))
            self.model_id = self.model_cfg
        self.queue = JudgeQueue()

    # ------------------------------------------------------------ capture
    def capture_pair(self, rev, t, mobile):
        """(before_rel, after_rel) for the ticket's lens at its viewport.

        Mirrors reverify._crash_loop's dedicated-LensWalk pattern: arrival
        shot, settle until two consecutive probe frames hash equal (or the
        settle budget runs out), settled shot. Either may be None.
        """
        from .checks import LensWalk
        from .auth import assert_account
        lens = t["lens"]
        acct, admin = rev.account_for(lens)
        lw = LensWalk(rev.b, self.cfg, self.rec, rev.inv[lens], acct, self.log,
                      admin=admin, inv_entry=rev.inv[lens])
        ctx, page, cdp = lw.open(mobile=mobile)
        try:
            if acct:
                assert_account(ctx, self.cfg, acct, "vision pair", self.log)
            lw.nav(page, cdp)
            before = lw.shot(page, "vision-before")
            budget_ms = int(self.cfg.get("thresholds", {}).get("settle_ms_judgment", 15000))
            waited, last = 0, None
            while waited < budget_ms:
                try:
                    probe = page.screenshot(type="jpeg", quality=30, timeout=5000)
                except Exception:
                    break
                h = hashlib.sha256(probe).hexdigest()
                if h == last:
                    break
                last = h
                waited += 400
                page.wait_for_timeout(400)
            after = lw.shot(page, "vision-after")
            return [before, after]
        finally:
            lw._close(ctx)

    def _image_b64(self, rel):
        if not rel:
            return None
        try:
            with open(os.path.join(self.cfg["audit_dir"], rel), "rb") as f:
                return base64.b64encode(f.read()).decode()
        except OSError:
            return None

    # -------------------------------------------------------------- judge
    def judge_ticket(self, rev, t, cat, mobile=False, pair_provider=None):
        """A reverify-shaped verdict dict, or None to keep the HUMAN path.

        None means: judge disabled, or no usable pair could be captured —
        the caller's existing NEEDS_HUMAN return (with its smoke evidence)
        stands unchanged.
        """
        if not self.enabled:
            return None
        tid = t.get("id")
        if cat in self.demoted:
            return {"verdict": HUMAN, "method": "vision judge (category demoted by spot-check)",
                    "category": cat, "evidence": [],
                    "notes": "category %s demoted to Partial by the human spot-check; tester decides" % cat,
                    "vision": {"demoted": True, "category": cat}}
        pair = pair_provider(t) if pair_provider else self.capture_pair(rev, t, mobile)
        if not pair or not pair[0] or not pair[1]:
            return None
        if self.calls >= self.cap:
            self.partial_due_to_cap += 1
            self._ledger(tid, t.get("lens"), cat, None, None, HUMAN, pair, "cap reached")
            return {"verdict": HUMAN, "method": "vision judge (cap reached)", "category": cat,
                    "evidence": pair,
                    "notes": "vision cap %d reached; pair attached for the human confirm" % self.cap,
                    "vision": {"cap_reached": True, "calls": self.calls, "cap": self.cap, "pair": pair}}
        images = [self._image_b64(r) for r in pair]
        if any(i is None for i in images):
            return None
        prompt = _JUDGE_PROMPT.format(title=scrub(t.get("title"), 200),
                                      expected=scrub(t.get("expected"), 300),
                                      actual=scrub(t.get("actual"), 300))
        self.calls += 1  # attempts count against the cap, conservatively
        try:
            out = self.queue.call(self.client, images, prompt)
        except Exception as e:
            self._ledger(tid, t.get("lens"), cat, self.model_id, None, HUMAN, pair, "judge error: %s" % type(e).__name__)
            return {"verdict": HUMAN, "method": "vision judge (error)", "category": cat,
                    "evidence": pair,
                    "notes": "vision judge failed (%s); pair attached for the human confirm" % type(e).__name__,
                    "vision": {"error": type(e).__name__, "pair": pair, "calls": self.calls, "cap": self.cap}}
        verdict_raw = str(out.get("verdict") or "UNCERTAIN").upper()
        try:
            conf = float(out.get("confidence"))
        except (TypeError, ValueError):
            conf = 0.0
        conf = min(1.0, max(0.0, conf))
        model = out.get("model") or self.model_id
        rationale = scrub(out.get("rationale"), 200)
        if verdict_raw == "MATCHES_EXPECTED" and conf >= self.threshold:
            verdict = FIXED
        elif verdict_raw == "DOES_NOT_MATCH" and conf >= self.threshold:
            verdict = STILL
        else:
            verdict = HUMAN
        self.judged += 1
        self._ledger(tid, t.get("lens"), cat, model, conf, verdict, pair, rationale)
        res = {"verdict": verdict, "method": "vision judge (%s)" % model, "category": cat,
               "evidence": pair,
               "notes": "vision %s conf %.2f: %s" % (verdict_raw, conf, rationale),
               "vision": {"model": model, "confidence": conf, "judge_verdict": verdict_raw,
                          "pair": pair, "calls": self.calls, "cap": self.cap}}
        if verdict == HUMAN:
            res["vision"]["draft_verdict"] = ("FIXED" if verdict_raw == "MATCHES_EXPECTED"
                                              else "STILL_FAILING" if verdict_raw == "DOES_NOT_MATCH" else None)
            res["notes"] += "; low confidence or uncertain — draft attached for the human confirm"
        return res

    def _ledger(self, tid, lens, cat, model, conf, verdict, pair, note):
        append_jsonl(self.ledger_path,
                     {"ts": ts_et(), "run": self.rec.rid, "ticket_id": tid, "lens": lens,
                      "category": cat, "model": model, "confidence": conf, "verdict": verdict,
                      "pair": pair, "calls": self.calls, "cap": self.cap, "note": scrub(note, 200)})

    def accounting(self):
        return {"calls": self.calls, "cap": self.cap, "judged": self.judged,
                "partial_due_to_cap": self.partial_due_to_cap,
                "remaining": max(0, self.cap - self.calls),
                "queued_calls": self.queue.queued_calls, "retries": self.queue.retries,
                "max_in_flight": self.queue.max_in_flight}


# --------------------------------------------------------------------------
# Offline re-judge (GB-1581 item 2): re-run the judge over the (screenshot,
# expected) pairs a finished run already saved, with no browser and no new
# capture — the 156 Walk 2 rows that died on judge timeouts are decided
# from their saved pairs once the queue + 180 s timeout are in place.
# --------------------------------------------------------------------------

def load_saved_pairs(run_dir):
    """The run's vision.jsonl rows that carry a usable pair, latest row per
    ticket (a ticket judged twice keeps its most recent pair)."""
    out = {}
    path = os.path.join(run_dir, "vision.jsonl")
    if not os.path.isfile(path):
        return []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            pair = row.get("pair") if isinstance(row, dict) else None
            if row.get("ticket_id") and pair and pair[0] and pair[1]:
                out[row["ticket_id"]] = row
    return [out[k] for k in sorted(out)]


def rejudge_saved_pairs(cfg, run_dir, tickets, log, client=None, only_human=True):
    """Re-judge a finished run's saved pairs. tickets: {tid: ticket dict}
    (title/expected/actual feed the judge prompt). By default only rows
    whose saved verdict was NEEDS_HUMAN are re-judged (the waiting queue);
    only_human=False re-judges every saved pair. Returns a summary dict;
    per-ticket outcomes are appended to <run_dir>/vision-rejudge.jsonl and
    the judge's own ledger lines go there too (the original vision.jsonl
    is never rewritten)."""
    import types
    rows = load_saved_pairs(run_dir)
    rec = types.SimpleNamespace(run_dir=run_dir, rid=os.path.basename(os.path.normpath(run_dir)) + "-rejudge")
    judge = VisionJudge(cfg, rec, log, client=client)
    judge.ledger_path = os.path.join(run_dir, "vision-rejudge.jsonl")
    out_path = judge.ledger_path
    summary = {"rows": len(rows), "rejudged": 0, "skipped_no_ticket": 0, "skipped_verdict": 0,
               "verdicts": {}, "judge_enabled": judge.enabled}
    if not judge.enabled:
        return summary
    for row in rows:
        tid = row["ticket_id"]
        if only_human and row.get("verdict") != HUMAN:
            summary["skipped_verdict"] += 1
            continue
        t = tickets.get(tid)
        if t is None:
            summary["skipped_no_ticket"] += 1
            continue
        pair = row["pair"]
        res = judge.judge_ticket(None, t, row.get("category"), pair_provider=lambda _t, p=pair: p)
        if res is None:
            summary["skipped_no_ticket"] += 1
            continue
        summary["rejudged"] += 1
        summary["verdicts"][res["verdict"]] = summary["verdicts"].get(res["verdict"], 0) + 1
        append_jsonl(out_path, {"ts": ts_et(), "ticket_id": tid, "lens": t.get("lens"),
                                "prior_vision_verdict": row.get("verdict"),
                                "verdict": res["verdict"], "method": res.get("method"),
                                "notes": res.get("notes")})
    summary["accounting"] = judge.accounting()
    return summary


# --------------------------------------------------------------------------
# Human spot-check: deterministic sampler + disagreement evaluation.
# --------------------------------------------------------------------------

def sample_spotcheck(ticket_ids, rate=0.10, seed=1544):
    """The deterministic 10% sample: same ids + seed -> same selection."""
    ids = sorted(set(ticket_ids))
    if not ids:
        return []
    k = int(round(len(ids) * rate))
    k = max(1, min(len(ids), k))
    return sorted(random.Random(seed).sample(ids, k))


def evaluate_spotcheck(judged_rows, human_rows, demote_above=0.05):
    """Compare judge verdicts to human verdicts on the sampled rows.

    judged_rows / human_rows: {"ticket_id", "category", "verdict"}.
    Returns {"per_category": {cat: {"sampled", "disagreements", "rate",
    "demoted"}}, "demoted_categories": [...]} — a category whose sampled
    disagreement rate exceeds demote_above drops back to Partial.
    """
    human = {r["ticket_id"]: r for r in human_rows}
    per = {}
    for r in judged_rows:
        h = human.get(r["ticket_id"])
        if h is None:
            continue
        c = per.setdefault(r.get("category") or "uncategorised",
                           {"sampled": 0, "disagreements": 0})
        c["sampled"] += 1
        if h["verdict"] != r["verdict"]:
            c["disagreements"] += 1
    demoted = []
    for cat, c in per.items():
        c["rate"] = (c["disagreements"] / c["sampled"]) if c["sampled"] else 0.0
        c["demoted"] = c["rate"] > demote_above
        if c["demoted"]:
            demoted.append(cat)
    return {"per_category": per, "demoted_categories": sorted(demoted)}
