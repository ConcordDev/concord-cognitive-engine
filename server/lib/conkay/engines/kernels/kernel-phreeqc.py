#!/usr/bin/env python3
"""PHREEQC kernel — SXE-24 (materials/chemistry row, PHREEQC leg).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel drives IPhreeqc through
phreeqpy (PHREEQC is USGS public domain; it runs as a separate
library inside this child process only).

Health case (the plan's): PHREEQC Example 1 — speciation of
seawater with phreeqc.dat. The input below is the manual's
published Example 1 seawater composition. The manual's reported
result for this example is pH ~ 8.22; the kernel serves the
computed pH and requires |pH - 8.22| <= 0.1 (the band covers
database-version variation; the CI lane verifies against the
manual output on first dispatch and records any tighter figure).

Ops:
  health / example1 — request {} (the example is fixed by the
    manual; parameters would change the reference).

No phreeqpy/IPhreeqc in the driver env is a provisioning defect:
exit 3 naming the import.
"""
import json
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


EXAMPLE1 = """SOLUTION 1  Seawater
    temp      %(T)r
    pH        8.22
    pe        8.451
    redox     pe
    units     mmol/kgw
    density   1.023
    Ca        10.3
    Mg        54.1
    Na        469.1
    K         10.2
    Cl        559.0
    Alkalinity 2.4  as HCO3
    S(6)      28.9  as SO4
SELECTED_OUTPUT
    -reset    false
USER_PUNCH
    -headings pH
    10 PUNCH PH
END
"""

EXPECTED_PH = 8.22


def run_example1(temp_c=25.0):
    try:
        import phreeqpy.iphreeqc.phreeqc_dll as phreeqc_mod
    except Exception as e:
        try:
            from phreeqpy.iphreeqc.phreeqc_dll import IPhreeqc
            phreeqc_mod = None
            return _run_with(IPhreeqc, temp_c)
        except Exception:
            fail(3, "phreeqpy import failed (%s) - the phreeqc "
                    "driver env is not provisioned" % e)
    return _run_with(phreeqc_mod.IPhreeqc, temp_c)


def _run_with(cls, temp_c):
    import os
    db = os.environ.get("CONKAY_PHREEQC_DB")
    inst = cls()
    if db:
        inst.load_database(db)
    inst.run_string(EXAMPLE1 % {"T": temp_c})
    errors = inst.get_error_string() if hasattr(inst, "get_error_string") \
        else ""
    if errors and errors.strip():
        fail(6, "IPhreeqc reported errors: %s" % errors.strip().splitlines()[0])
    out = inst.get_selected_output_array()
    if not out or len(out) < 2:
        fail(5, "IPhreeqc selected output was empty (garbled output "
                "rejected)")
    header = [str(h).strip().lower() for h in out[0]]
    if "ph" not in header:
        fail(5, "IPhreeqc selected output carried no pH column")
    ph = float(out[1][header.index("ph")])
    return {"ph": ph, "expectedPh": EXPECTED_PH,
            "absError": abs(ph - EXPECTED_PH),
            "converged": abs(ph - EXPECTED_PH) <= 0.1}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "example1"):
        temp_c = request.get("tempC", 25.0)
        if not isinstance(temp_c, (int, float)) or isinstance(temp_c, bool):
            fail(2, "tempC must be a number, got %r" % (temp_c,))
        result = run_example1(float(temp_c))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
