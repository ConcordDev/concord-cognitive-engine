"""Run outputs: findings, judgment queue ('needs tester/Zuko'), fixtures + leftovers."""
import json, os
from .util import append_jsonl, append_text, human_et, ts_et, scrub, safe_filename


class RunRecorder:
    def __init__(self, cfg, rid, dry=False):
        self.cfg, self.rid, self.dry = cfg, rid, dry
        self.run_dir = os.path.join(cfg.get("runs_dir") or os.path.join(cfg["_walker_dir"], "runs"), rid)
        os.makedirs(self.run_dir, exist_ok=True)
        self.queue_path = os.path.join(cfg.get("queue_dir") or os.path.join(cfg["_walker_dir"], "queue"), "needs_tester.jsonl")
        self.queue_md = os.path.join(cfg["audit_dir"], "reports", "NEEDS_TESTER_QUEUE.md")
        self.leftover_md = os.path.join(cfg["audit_dir"], "reports", "LEFTOVER_FIXTURES.md")
        self.fixtures_path = os.path.join(self.run_dir, "fixtures.jsonl")
        self.fixtures = {}

    def evidence_dir(self, slug):
        # dry runs keep screenshots inside the run dir so the shared evidence/ tree only gets filed-ticket evidence
        root = os.path.join(self.run_dir, "evidence") if self.dry else (self.cfg.get("evidence_dir") or os.path.join(self.cfg["audit_dir"], "evidence"))
        d = os.path.join(root, safe_filename(slug), "walker-" + self.rid)
        os.makedirs(d, exist_ok=True)
        return d

    def rel(self, path):
        return os.path.relpath(path, self.cfg["audit_dir"])

    def finding(self, rec):
        append_jsonl(os.path.join(self.run_dir, "findings.jsonl"), rec)

    def judgment(self, lens, kind, question, evidence=None, ticket_id=None, account=None):
        if account is None:
            account = self.cfg["accounts"]["t1"]["username"]
        rec = {"ts": ts_et(), "run": self.rid, "lens": lens, "kind": kind, "question": scrub(question, 400),
               "evidence": evidence or [], "ticket_id": ticket_id, "account": account, "status": "NEEDS_TESTER"}
        append_jsonl(os.path.join(self.run_dir, "needs_tester.jsonl"), rec)
        if self.dry:
            return
        append_jsonl(self.queue_path, rec)
        if not os.path.exists(self.queue_md):
            append_text(self.queue_md, "# Needs tester / Zuko queue (lens walker judgment calls)\n\n"
                                       "Walker never auto-decides these. Format: time | lens | kind | ticket | question | evidence.\n\n")
        append_text(self.queue_md, "- %s | %s | %s | %s | %s | %s\n" % (
            human_et(), lens, kind, ticket_id or "-", rec["question"], ", ".join(rec["evidence"]) or "-"))

    # fixtures ------------------------------------------------------------
    def fixture(self, label, lens, state, note=""):
        self.fixtures[label] = {"label": label, "lens": lens, "state": state, "note": scrub(note, 300), "ts": ts_et()}
        append_jsonl(self.fixtures_path, self.fixtures[label])

    def flush_leftovers(self):
        left = [f for f in self.fixtures.values() if f["state"] not in ("deleted", "never_created")]
        if not left:
            return []
        lines = ["\n## Lens walker run %s (%s, %s)\n" % (self.rid, human_et(), self.cfg["accounts"]["t1"]["username"])]
        for f in left:
            lines.append("- %s: fixture '%s' state=%s. %s Needs manual cleanup.\n" % (f["lens"], f["label"], f["state"], f["note"]))
        if not self.dry:
            append_text(self.leftover_md, "".join(lines))
        append_text(os.path.join(self.run_dir, "LEFTOVERS.md"), "".join(lines))
        return left
