#!/usr/bin/env python3
"""ConKay engine kernel: pvlib (SXE-37).

Thin adapter over pvlib (BSD-3). Two independent checks:
(1) pvlib's solar position at a fixed place and instant vs
the NOAA solar calculator's closed-form series (fractional
year, declination, equation of time, hour angle) computed
in-kernel — band 0.15 degrees on the zenith; (2) pvlib's
Ineichen clear-sky GHI vs pvlib's simplified Solis clear-sky
GHI at the same instant — two published models with different
parameterisations, band 10% (cross-model agreement is the
acceptance class here; neither model is the other's code).

Protocol: one JSON object on stdin {"op": ..., "request": {...}},
one JSON object on stdout. Exit codes: 2 = request out of
envelope, 3 = provisioning defect, 6 = engine failure.
"""
import json
import math
import sys

LAT = 35.08
LON = -106.65


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def noaa_zenith_deg(day_of_year, utc_hour):
    """NOAA GML solar calculator, closed-form series."""
    gamma = 2.0 * math.pi / 365.0 * (day_of_year - 1
                                     + (utc_hour - 12.0) / 24.0)
    decl = (0.006918 - 0.399912 * math.cos(gamma)
            + 0.070257 * math.sin(gamma)
            - 0.006758 * math.cos(2 * gamma)
            + 0.000907 * math.sin(2 * gamma)
            - 0.002697 * math.cos(3 * gamma)
            + 0.00148 * math.sin(3 * gamma))
    eqtime = 229.18 * (0.000075 + 0.001868 * math.cos(gamma)
                       - 0.032077 * math.sin(gamma)
                       - 0.014615 * math.cos(2 * gamma)
                       - 0.040849 * math.sin(2 * gamma))
    tst_min = (utc_hour * 60.0 + eqtime + 4.0 * LON) % 1440.0
    ha = math.radians(tst_min / 4.0 - 180.0)
    phi = math.radians(LAT)
    cos_z = (math.sin(phi) * math.sin(decl)
             + math.cos(phi) * math.cos(decl) * math.cos(ha))
    cos_z = max(-1.0, min(1.0, cos_z))
    return math.degrees(math.acos(cos_z))


def clear_sky(request):
    tl = float(request.get("linkeTurbidity", 3.0))
    if not (1.0 <= tl <= 8.0):
        fail(2, "linkeTurbidity out of envelope [1, 8]")
    try:
        import pandas as pd
        import pvlib
    except ImportError as exc:
        fail(3, "pvlib import failed: %s" % exc)
    try:
        when = pd.Timestamp("2026-06-21 18:00:00", tz="UTC")
        pos = pvlib.solarposition.get_solarposition(when, LAT, LON)
        zenith = float(pos["apparent_zenith"].iloc[0])
        am_rel = float(pvlib.atmosphere.get_relative_airmass(zenith))
        am_abs = float(pvlib.atmosphere.get_absolute_airmass(am_rel))
        ine = pvlib.clearsky.ineichen(zenith, am_abs, tl, altitude=0.0)
        sol = pvlib.clearsky.simplified_solis(zenith)
        ghi = float(ine["ghi"].iloc[0])
        solis_ghi = float(sol["ghi"].iloc[0])
    except Exception as exc:
        fail(6, "pvlib evaluation failed: %s" % exc)
    expected_zenith = noaa_zenith_deg(172, 18.0)
    z_err = abs(zenith - expected_zenith)
    ghi_diff = (abs(ghi - solis_ghi) / ghi) if ghi > 0 else 1.0
    return {
        "zenithDeg": zenith,
        "expectedZenithDeg": expected_zenith,
        "zenithErrorDeg": z_err,
        "ghiWm2": ghi,
        "solisGhiWm2": solis_ghi,
        "ghiRelDiff": ghi_diff,
        "converged": bool(z_err <= 0.15 and ghi_diff <= 0.10),
    }


def main():
    try:
        spec = json.load(sys.stdin)
    except Exception:
        fail(2, "unparsable request")
    op = spec.get("op")
    request = spec.get("request") or {}
    if op == "health":
        result = clear_sky({})
    elif op == "clear-sky":
        result = clear_sky(request)
    else:
        fail(2, "unknown op: %s" % op)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
