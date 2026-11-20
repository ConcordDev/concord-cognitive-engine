#!/usr/bin/env python3
"""Biopython kernel — SXE-28.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case: a bundled 60 nt sequence —
Biopython's GC fraction and translation must match the values
computed independently in the kernel by direct counting and the
standard genetic code (exact; band 1e-9 on the fraction, exact
string on the protein). The general op analyses any DNA string by
the same route; a sequence with non-ACGTN letters is a schema
refusal (exit 2).

Ops:
  health — request {}
    -> {lengthN, gcFraction, expectedGcFraction, protein}.
  analyze — request {sequence}
    -> {lengthN, gcFraction, protein}.

No biopython in the driver env is a provisioning defect: exit 3.
"""
import json
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


HEALTH_SEQ = ("ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG"
              "ATGGCCATTGTAATGGGCCGC")

CODON = {}
_BASES = "TCAG"
_AAS = ("FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRR"
        "VVVVAAAADDEEGGGG")
for _i, _a in enumerate(_AAS):
    _codon = _BASES[_i // 16] + _BASES[(_i // 4) % 4] + _BASES[_i % 4]
    CODON[_codon] = _a


def hand_gc(seq):
    gc = sum(1 for ch in seq if ch in "GC")
    return gc / len(seq)


def hand_translate(seq):
    out = []
    for i in range(0, len(seq) - 2, 3):
        out.append(CODON.get(seq[i:i + 3], "X"))
    return "".join(out)


def load_bio():
    try:
        from Bio.Seq import Seq
        from Bio.SeqUtils import gc_fraction
    except Exception as e:
        fail(3, "biopython import failed (%s) - the biopython "
                "driver env is not provisioned" % e)
    return Seq, gc_fraction


def analyse(seq):
    Seq, gc_fraction = load_bio()
    s = Seq(seq)
    return {"lengthN": len(seq),
            "gcFraction": float(gc_fraction(s)),
            "protein": str(s.translate())}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op == "health":
        result = analyse(HEALTH_SEQ)
        result["expectedGcFraction"] = hand_gc(HEALTH_SEQ)
        ok = abs(result["gcFraction"] - result["expectedGcFraction"]) <= 1e-9 \
            and result["protein"] == hand_translate(HEALTH_SEQ)
        result["converged"] = ok
    elif op == "analyze":
        seq = request.get("sequence")
        if not isinstance(seq, str) or not seq \
                or any(ch not in "ACGTN" for ch in seq.upper()):
            fail(2, "sequence must be a non-empty ACGTN string, "
                    "got %r" % (seq,))
        result = analyse(seq.upper())
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
