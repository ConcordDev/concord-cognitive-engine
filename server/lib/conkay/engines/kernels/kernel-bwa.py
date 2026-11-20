#!/usr/bin/env python3
"""BWA kernel — SXE-28.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel drives the stock bwa CLI
(MIT, separate process): it indexes a bundled 600 bp reference and
aligns reads with bwa mem. The health read is an exact substring
of the reference starting at position 201 (1-based), so the SAM
must place it at exactly that position, mapped, forward strand.
The general op aligns any read by the same route.

Ops:
  health — request {}
    -> {position, expectedPosition, converged}.
  align — request {read}
    -> {position}.

Missing bwa is a provisioning defect: exit 3. A read with no
mapped placement is rejected (exit 5), never guessed.
"""
import json
import os
import shutil
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


REFERENCE = (
    "ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAGATGGCCATTGTAATGGGCCGC"
    "TTTTCCCCAAAAGGGGTTTTCCCCAAAAGGGGTTTTCCCCAAAAGGGGTTTTCCCCAAAA"
    "ACACACACACACACACACACACACACACACACACACACACACACACACACACACACACACAC"
    "GGGTTTCCAAGGGTTTCCAAGGGTTTCCAAGGGTTTCCAAGGGTTTCCAAGGGTTTCCAA"
    "CATGCATGCACATGCATGCACATGCATGCACATGCATGCACATGCATGCACATGCATGCA"
    "AGTCAGTCAGAGTCAGTCAGAGTCAGTCAGAGTCAGTCAGAGTCAGTCAGAGTCAGTCAG"
    "TTGACCTAGGTTGACCTAGGTTGACCTAGGTTGACCTAGGTTGACCTAGGTTGACCTA"
    "CCGTAACGGACCGTAACGGACCGTAACGGACCGTAACGGACCGTAACGGACCGTAACG"
    "GATTACAGATTACAGATTACAGATTACAGATTACAGATTACAGATTACAGATTACAGA"
    "TCAGGCATTATCAGGCATTATCAGGCATTATCAGGCATTATCAGGCATTATCAGGCAT"
)
HEALTH_READ = REFERENCE[200:250]
HEALTH_POS = 201


def run_align(read):
    bwa = shutil.which("bwa")
    if not bwa:
        fail(3, "bwa executable not found on PATH (BWA is not "
                "provisioned for this engine env)")
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "bwa-align")
    os.makedirs(work, exist_ok=True)
    ref_path = os.path.join(work, "ref.fa")
    with open(ref_path, "w") as fh:
        fh.write(">ref\n" + REFERENCE + "\n")
    idx = subprocess.run([bwa, "index", ref_path], capture_output=True,
                         text=True, timeout=300)
    if idx.returncode != 0:
        fail(6, "bwa index failed (exit %d)" % idx.returncode)
    read_path = os.path.join(work, "read.fa")
    with open(read_path, "w") as fh:
        fh.write(">read\n" + read + "\n")
    mem = subprocess.run([bwa, "mem", ref_path, read_path],
                         capture_output=True, text=True, timeout=600)
    if mem.returncode != 0:
        fail(6, "bwa mem failed (exit %d)" % mem.returncode)
    for line in mem.stdout.splitlines():
        if line.startswith("@"):
            continue
        fields = line.split("\t")
        if len(fields) >= 4:
            flag = int(fields[1])
            if flag & 4:
                continue
            return {"position": int(fields[3])}
    fail(5, "bwa mem produced no mapped placement (garbled "
            "output rejected)")


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op == "health":
        result = run_align(HEALTH_READ)
        result["expectedPosition"] = HEALTH_POS
        result["converged"] = result["position"] == HEALTH_POS
    elif op == "align":
        read = request.get("read")
        if not isinstance(read, str) or len(read) < 20 \
                or any(ch not in "ACGTN" for ch in read.upper()):
            fail(2, "read must be an ACGTN string of length >= 20")
        result = run_align(read.upper())
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
