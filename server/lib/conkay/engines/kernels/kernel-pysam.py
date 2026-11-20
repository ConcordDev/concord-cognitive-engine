#!/usr/bin/env python3
"""ConKay engine kernel: pysam (SXE-37).

Thin adapter over NREL's PySAM (BSD-3-style) PVWatts v8 model.
ENVELOPE class (named in the engine doc): PVWatts has no
closed form short of reimplementing it, so the kernel drives
a synthetic equatorial day the kernel itself constructs
(hourly GHI a pure sine arch peaking at 1000 W/m^2, sun
geometry computed in-kernel by the NOAA series) through a
horizontal 5 kW system and accepts when the peak hourly AC
lands inside the physically forced envelope: nameplate x
[0.58, 0.92], from the derate chain the doc derives (14.08%
system losses, ~0.90 cell-temperature factor at full sun,
96% inverter efficiency — centre ~0.74).

Protocol: one JSON object on stdin {"op": ..., "request": {...}},
one JSON object on stdout. Exit codes: 2 = request out of
envelope, 3 = provisioning defect, 6 = engine failure.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def solar_cos_z(lat_deg, day_of_year, utc_hour):
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
    tst_min = (utc_hour * 60.0 + eqtime) % 1440.0
    ha = math.radians(tst_min / 4.0 - 180.0)
    phi = math.radians(lat_deg)
    return (math.sin(phi) * math.sin(decl)
            + math.cos(phi) * math.cos(decl) * math.cos(ha))


def simulate(request):
    cap_kw = float(request.get("capacityKw", 5.0))
    if not (1.0 <= cap_kw <= 100.0):
        fail(2, "capacityKw out of envelope [1, 100]")
    try:
        import PySAM.Pvwattsv8 as pvwatts
    except ImportError as exc:
        fail(3, "PySAM import failed: %s" % exc)
    gh, dn, df, tdry = [], [], [], []
    for hour in range(24):
        centre = hour + 0.5
        arch = math.sin(math.pi * (centre - 6.0) / 12.0)
        ghi = 1000.0 * arch if 6.0 < centre < 18.0 else 0.0
        cos_z = max(solar_cos_z(0.0, 172, centre), 0.0)
        if ghi > 0.0 and cos_z > 0.02:
            dni = min(950.0, ghi * 0.82 / max(cos_z, 0.08))
            dhi = max(0.0, ghi - dni * cos_z)
        else:
            dni, dhi = 0.0, 0.0
        gh.append(ghi)
        dn.append(dni)
        df.append(dhi)
        tdry.append(25.0 + 4.0 * max(arch, 0.0))
    resource = {
        "lat": 0.0, "lon": 0.0, "tz": 0.0, "elev": 0.0,
        "year": [2026] * 24, "month": [6] * 24, "day": [21] * 24,
        "hour": list(range(24)), "minute": [30] * 24,
        "dn": dn, "df": df, "gh": gh, "tdry": tdry,
        "tdew": [18.0] * 24, "wspd": [1.0] * 24,
        "pressure": [1013.0] * 24,
    }
    try:
        model = pvwatts.new()
        model.SolarResource.assign({"solar_resource_data": resource})
        model.SystemDesign.assign({
            "system_capacity": cap_kw,
            "module_type": 0,
            "array_type": 0,
            "azimuth": 180.0,
            "tilt": 0.0,
            "losses": 14.08,
            "dc_ac_ratio": 1.2,
            "ground_coverage_ratio": 0.4,
            "inv_eff": 96.0,
        })
        model.execute(0)
        ac = [float(v) for v in model.Outputs.ac]
    except Exception as exc:
        fail(6, "PySAM execution failed: %s" % exc)
    peak = max(ac) if ac else 0.0
    return {
        "peakAcW": peak,
        "capacityKw": cap_kw,
        "converged": bool(0.58 * cap_kw * 1000.0 <= peak
                          <= 0.92 * cap_kw * 1000.0),
    }


def main():
    try:
        spec = json.load(sys.stdin)
    except Exception:
        fail(2, "unparsable request")
    op = spec.get("op")
    request = spec.get("request") or {}
    if op == "health":
        result = simulate({})
    elif op == "simulate":
        result = simulate(request)
    else:
        fail(2, "unknown op: %s" % op)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
