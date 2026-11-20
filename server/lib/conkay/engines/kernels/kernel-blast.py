#!/usr/bin/env python3
"""BLAST+ kernel — SXE-28.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel drives the stock NCBI
BLAST+ tools (public domain, separate processes): it builds a
tiny database from a bundled 3-record FASTA and searches it. The
health query is an exact copy of one record, so the best hit must
be that record at 100% identity over the full query (the plan's
case: BLAST short sequence vs a tiny bundled DB). The general op
searches any nucleotide query against the same database.

Ops:
  health — request {}
    -> {identityPct, hitAccession, converged}.
  search — request {sequence}
    -> {identityPct, hitAccession}.

Missing makeblastdb/blastn is a provisioning defect: exit 3.
A search with no parseable hit row is rejected (exit 5).
"""
import json
import os
import shutil
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


DB_FASTA = """>planted-alpha
ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAGATGGCCATTGTAATGGGCCGC
>other-beta
TTTTCCCCAAAAGGGGTTTTCCCCAAAAGGGGTTTTCCCCAAAAGGGGTTTTCCCCAAAA
>other-gamma
ACACACACACACACACACACACACACACACACACACACACACACACACACACACACACACAC
"""
QUERY = ("ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG"
         "ATGGCCATTGTAATGGGCCGC")


def run_search(query):
    for tool in ("makeblastdb", "blastn"):
        if not shutil.which(tool):
            fail(3, "%s executable not found on PATH (BLAST+ is "
                    "not provisioned for this engine env)" % tool)
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "blast-tiny")
    os.makedirs(work, exist_ok=True)
    db_fa = os.path.join(work, "db.fa")
    q_fa = os.path.join(work, "query.fa")
    with open(db_fa, "w") as fh:
        fh.write(DB_FASTA)
    with open(q_fa, "w") as fh:
        fh.write(">query\n" + query + "\n")
    mk = subprocess.run(["makeblastdb", "-in", db_fa, "-dbtype",
                         "nucl", "-out", os.path.join(work, "db")],
                        capture_output=True, text=True, timeout=300)
    if mk.returncode != 0:
        fail(6, "makeblastdb failed (exit %d)" % mk.returncode)
    proc = subprocess.run(
        ["blastn", "-query", q_fa, "-db", os.path.join(work, "db"),
         "-outfmt", "6 sacc pident length qlen", "-max_target_seqs", "1"],
        capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        fail(6, "blastn failed (exit %d)" % proc.returncode)
    rows = [ln.split("\t") for ln in proc.stdout.strip().splitlines()
            if ln.strip()]
    if not rows or len(rows[0]) < 4:
        fail(5, "blastn produced no parseable hit row (garbled "
                "output rejected)")
    acc, pident, length, qlen = rows[0][0], float(rows[0][1]), \
        int(rows[0][2]), int(rows[0][3])
    return {"identityPct": pident, "hitAccession": acc,
            "_full": length >= qlen}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op == "health":
        result = run_search(QUERY)
        full = result.pop("_full")
        result["converged"] = result["hitAccession"] == "planted-alpha" \
            and result["identityPct"] >= 99.9 and full
    elif op == "search":
        seq = request.get("sequence")
        if not isinstance(seq, str) or len(seq) < 10 \
                or any(ch not in "ACGTN" for ch in seq.upper()):
            fail(2, "sequence must be an ACGTN string of length "
                    ">= 10, got %r" % (seq,))
        result = run_search(seq.upper())
        result.pop("_full")
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
