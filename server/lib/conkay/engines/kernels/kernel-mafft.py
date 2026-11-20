#!/usr/bin/env python3
"""MAFFT kernel — SXE-28.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel drives the stock mafft CLI
(separate process). Health case: three bundled homologous
sequences — the alignment must satisfy the invariants any correct
MSA satisfies (same row count, equal row lengths, each row
ungapping to its input) and the kernel counts fully conserved
columns as the served signal. The general op aligns any list of
>= 2 sequences by the same route and checks the same invariants;
a violated invariant is rejected (exit 5), never served.

Ops:
  health — request {}
    -> {rows, alignedLength, conservedColumns, converged}.
  align — request {sequences: [string, ...]}
    -> {rows, alignedLength, conservedColumns}.

Missing mafft is a provisioning defect: exit 3.
"""
import json
import os
import shutil
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


HEALTH_SEQS = [
    "ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG",
    "ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAGATGGC",
    "ATGGCCATTGTAATGGGCCGCGGAAGGGTGCCCGATAG",
]


def run_align(seqs):
    mafft = shutil.which("mafft")
    if not mafft:
        fail(3, "mafft executable not found on PATH (MAFFT is not "
                "provisioned for this engine env)")
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "mafft-align")
    os.makedirs(work, exist_ok=True)
    in_path = os.path.join(work, "in.fa")
    with open(in_path, "w") as fh:
        for i, s in enumerate(seqs):
            fh.write(">seq%d\n%s\n" % (i, s))
    proc = subprocess.run([mafft, "--quiet", "--auto", in_path],
                          capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        fail(6, "mafft failed (exit %d)" % proc.returncode)
    rows = []
    current = None
    for line in proc.stdout.splitlines():
        if line.startswith(">"):
            if current is not None:
                rows.append(current)
            current = ""
        elif current is not None:
            current += line.strip().upper()
    if current is not None:
        rows.append(current)
    if len(rows) != len(seqs) or not rows:
        fail(5, "mafft output row count != input count (garbled "
                "output rejected)")
    width = len(rows[0])
    if any(len(r) != width for r in rows):
        fail(5, "mafft rows have unequal lengths (garbled output "
                "rejected)")
    for row, original in zip(rows, seqs):
        if row.replace("-", "") != original.upper():
            fail(5, "mafft row does not ungap to its input "
                    "(garbled output rejected)")
    conserved = sum(1 for j in range(width)
                    if len({r[j] for r in rows}) == 1 and rows[0][j] != "-")
    return {"rows": len(rows), "alignedLength": width,
            "conservedColumns": conserved}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op == "health":
        result = run_align(HEALTH_SEQS)
        result["converged"] = result["conservedColumns"] > 0
    elif op == "align":
        seqs = request.get("sequences")
        if not isinstance(seqs, list) or len(seqs) < 2 \
                or any(not isinstance(s, str) or not s for s in seqs):
            fail(2, "sequences must be a list of >= 2 non-empty "
                    "strings")
        result = run_align([s.upper() for s in seqs])
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
