#!/usr/bin/env python3
"""IQ-TREE kernel — SXE-28.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel drives the stock iqtree2
CLI (GPL-2, separate process). Health case: a bundled 4-taxon
alignment — the run must complete, report a finite log-likelihood
in its .iqtree report, and its tree must carry exactly the four
input tips. The general op takes a FASTA alignment string by the
same route. A report with no parseable likelihood is rejected
(exit 5), never guessed.

Ops:
  health — request {}
    -> {logLikelihood, tips, converged}.
  tree — request {alignment} (FASTA text, >= 4 taxa)
    -> {logLikelihood, tips}.

Missing iqtree2 is a provisioning defect: exit 3.
"""
import json
import math
import os
import re
import shutil
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


HEALTH_ALN = """>taxonA
ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAGATGGCCATTGTAATGGGCCGC
>taxonB
ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAGATGGCCATTGTAATGGGCCAT
>taxonC
TTTTCCCCAAAAGGGGTTTTCCCCAAAAGGGGTTTTCCCCAAAAGGGGTTTTCCCCAAAA
>taxonD
TTTTCCCCAAAAGGGGTTTTCCCCAAAAGGGGTTTTCCCCAAAAGGGGTTTTCCCCAAAT
"""


def parse_taxa(fasta):
    return [ln[1:].split()[0] for ln in fasta.splitlines()
            if ln.startswith(">")]


def run_tree(fasta):
    iqtree = shutil.which("iqtree2") or shutil.which("iqtree")
    if not iqtree:
        fail(3, "iqtree2 executable not found on PATH (IQ-TREE is "
                "not provisioned for this engine env)")
    taxa = parse_taxa(fasta)
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "iqtree-run")
    os.makedirs(work, exist_ok=True)
    aln_path = os.path.join(work, "aln.fa")
    with open(aln_path, "w") as fh:
        fh.write(fasta)
    proc = subprocess.run([iqtree, "-s", aln_path, "-m", "JC",
                           "--prefix", os.path.join(work, "out"),
                           "-nt", "1", "--redo"],
                          capture_output=True, text=True, timeout=1200)
    if proc.returncode != 0:
        fail(6, "iqtree failed (exit %d)" % proc.returncode)
    report_path = os.path.join(work, "out.iqtree")
    tree_path = os.path.join(work, "out.treefile")
    if not os.path.exists(report_path) or not os.path.exists(tree_path):
        fail(5, "iqtree produced no report/treefile (garbled "
                "output rejected)")
    with open(report_path, errors="replace") as fh:
        report = fh.read()
    m = re.search(r"Log-likelihood of the tree:\s*(-?\d+\.\d+)", report)
    if not m:
        fail(5, "iqtree report carried no log-likelihood (garbled "
                "output rejected)")
    ll = float(m.group(1))
    if not math.isfinite(ll):
        fail(5, "iqtree served a non-finite log-likelihood "
                "(rejected)")
    with open(tree_path, errors="replace") as fh:
        tree = fh.read()
    tips = sum(1 for t in taxa if t in tree)
    return {"logLikelihood": ll, "tips": tips, "_taxa": len(taxa)}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op == "health":
        result = run_tree(HEALTH_ALN)
        taxa = result.pop("_taxa")
        result["converged"] = result["tips"] == taxa == 4
    elif op == "tree":
        aln = request.get("alignment")
        if not isinstance(aln, str) or len(parse_taxa(aln)) < 4:
            fail(2, "alignment must be FASTA text with >= 4 taxa")
        result = run_tree(aln)
        result.pop("_taxa")
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
