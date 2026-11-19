#!/usr/bin/env python3
"""PlasmaPy kernel — SXE-31 (plasma stack, PlasmaPy leg).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health: the electron plasma frequency
and Debye length from PlasmaPy's formulary beside the closed
forms computed independently in the kernel from CODATA constants
(scipy.constants): omega_p = sqrt(n e^2 / (eps0 m_e)),
lambda_D = sqrt(eps0 k_B T / (n e^2)) (band 1e-6 relative — same
constants, so any disagreement is a build defect).

Ops:
  health / formulary — request {densityM3, tempK};
    defaults n = 1e18 m^-3, T = 1.16e6 K (~100 eV).

No plasmapy in the driver env is a provisioning defect: exit 3
naming the import.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_formulary(n_m3, t_k):
    try:
        import astropy.units as u
        from plasmapy.formulary import Debye_length, plasma_frequency
        from scipy import constants as sc
    except Exception as e:
        fail(3, "plasmapy import failed (%s) - the plasmapy driver "
                "env is not provisioned" % e)
    # Electron plasma frequency (PlasmaPy's plasma_frequency with no
    # ion species is the electron frequency).
    wp = plasma_frequency(n_m3 * u.m ** -3)
    wp_hz = float(wp.to(u.rad / u.s).value)
    lam = Debye_length(t_k * u.K, n_m3 * u.m ** -3)
    lam_m = float(lam.to(u.m).value)
    wp_exact = math.sqrt(n_m3 * sc.e ** 2 / (sc.epsilon_0 * sc.m_e))
    lam_exact = math.sqrt(sc.epsilon_0 * sc.k * t_k / (n_m3 * sc.e ** 2))
    rel_wp = abs(wp_hz - wp_exact) / wp_exact
    rel_lam = abs(lam_m - lam_exact) / lam_exact
    return {"omegaP": wp_hz, "expectedOmegaP": wp_exact,
            "debyeM": lam_m, "expectedDebyeM": lam_exact,
            "maxRelError": max(rel_wp, rel_lam),
            "converged": max(rel_wp, rel_lam) < 1e-6}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "formulary"):
        n_m3 = request.get("densityM3", 1e18)
        t_k = request.get("tempK", 1.16e6)
        for name, v in (("densityM3", n_m3), ("tempK", t_k)):
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
                fail(2, "%s must be a positive number, got %r" % (name, v))
        result = run_formulary(float(n_m3), float(t_k))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
