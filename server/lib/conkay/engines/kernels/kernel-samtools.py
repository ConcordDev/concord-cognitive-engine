#!/usr/bin/env python3
"""samtools/bcftools kernel — SXE-28.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel drives the stock samtools
and bcftools CLIs (MIT, separate processes). Health case: a
bundled 5-record SAM is converted, sorted, and indexed by
samtools, and `samtools view -c` must return exactly 5; bcftools
must also answer --version (the pair ships as one entry, as the
catalogue row names them). The general op counts the records of
any SAM text by the same route.

Ops:
  health — request {}
    -> {records, expectedRecords, converged}.
  count — request {sam} (SAM text)
    -> {records}.

Missing either binary is a provisioning defect: exit 3.
"""
import json
import os
import shutil
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


HEALTH_SAM = """@HD\tVN:1.6\tSO:coordinate
@SQ\tSN:chr1\tLN:1000
r001\t0\tchr1\t101\t60\t10M\t*\t0\t0\tATGGCCATTG\tFFFFFFFFFF
r002\t0\tchr1\t201\t60\t10M\t*\t0\t0\tTTTTCCCCAA\tFFFFFFFFFF
r003\t0\tchr1\t301\t60\t10M\t*\t0\t0\tACACACACAC\tFFFFFFFFFF
r004\t0\tchr1\t401\t60\t10M\t*\t0\t0\tGGGTTTCCAA\tFFFFFFFFFF
r005\t0\tchr1\t501\t60\t10M\t*\t0\t0\tCATGCATGCA\tFFFFFFFFFF
"""


def run_count(sam_text):
    for tool in ("samtools", "bcftools"):
        if not shutil.which(tool):
            fail(3, "%s executable not found on PATH (the "
                    "samtools/bcftools pair is not provisioned "
                    "for this engine env)" % tool)
    ver = subprocess.run(["bcftools", "--version"], capture_output=True,
                         text=True, timeout=60)
    if ver.returncode != 0:
        fail(6, "bcftools --version failed (exit %d)" % ver.returncode)
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "samtools-count")
    os.makedirs(work, exist_ok=True)
    sam_path = os.path.join(work, "in.sam")
    bam_path = os.path.join(work, "sorted.bam")
    with open(sam_path, "w") as fh:
        fh.write(sam_text)
    sort = subprocess.run(["samtools", "sort", "-o", bam_path, sam_path],
                          capture_output=True, text=True, timeout=300)
    if sort.returncode != 0:
        fail(6, "samtools sort failed (exit %d)" % sort.returncode)
    idx = subprocess.run(["samtools", "index", bam_path],
                         capture_output=True, text=True, timeout=300)
    if idx.returncode != 0:
        fail(6, "samtools index failed (exit %d)" % idx.returncode)
    view = subprocess.run(["samtools", "view", "-c", bam_path],
                          capture_output=True, text=True, timeout=300)
    if view.returncode != 0:
        fail(6, "samtools view failed (exit %d)" % view.returncode)
    try:
        records = int(view.stdout.strip())
    except ValueError:
        fail(5, "samtools view -c returned no integer count "
                "(garbled output rejected)")
    return {"records": records}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op == "health":
        result = run_count(HEALTH_SAM)
        result["expectedRecords"] = 5
        result["converged"] = result["records"] == 5
    elif op == "count":
        sam = request.get("sam")
        if not isinstance(sam, str) or "@HD" not in sam:
            fail(2, "sam must be SAM text carrying a header")
        result = run_count(sam)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
