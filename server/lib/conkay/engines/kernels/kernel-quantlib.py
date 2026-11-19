#!/usr/bin/env python3
"""QuantLib kernel — SXE-23 (calculation only; payments untouched).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case (the plan's): a European
call priced by QuantLib's AnalyticEuropeanEngine beside the
closed-form Black-Scholes-Merton value computed independently in
the kernel from math.erf (band 1e-8 relative — the analytic engine
IS the closed form, so any disagreement is a build defect).

Ops:
  health / european-call — request {spot, strike, rate, vol,
    tYears, dividend}; defaults S=K=100, r=5%, sigma=20%, T=1, q=0
    -> call = 10.450583572185565 (the textbook value).

No QuantLib in the driver env is a provisioning defect: exit 3
naming the import.
"""
import json
import math
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def norm_cdf(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def bsm_call(spot, strike, rate, vol, t, div):
    d1 = (math.log(spot / strike) + (rate - div + 0.5 * vol * vol) * t) \
        / (vol * math.sqrt(t))
    d2 = d1 - vol * math.sqrt(t)
    return spot * math.exp(-div * t) * norm_cdf(d1) \
        - strike * math.exp(-rate * t) * norm_cdf(d2)


def run_call(spot, strike, rate, vol, t, div):
    try:
        import QuantLib as ql
    except Exception as e:
        fail(3, "QuantLib import failed (%s) - the quantlib driver "
                "env is not provisioned" % e)
    today = ql.Date(1, 1, 2026)
    ql.Settings.instance().evaluationDate = today
    expiry = today + ql.Period(int(round(t * 365)), ql.Days)
    payoff = ql.PlainVanillaPayoff(ql.Option.Call, strike)
    exercise = ql.EuropeanExercise(expiry)
    option = ql.VanillaOption(payoff, exercise)
    spot_q = ql.QuoteHandle(ql.SimpleQuote(spot))
    rate_c = ql.YieldTermStructureHandle(
        ql.FlatForward(today, rate, ql.Actual365Fixed()))
    div_c = ql.YieldTermStructureHandle(
        ql.FlatForward(today, div, ql.Actual365Fixed()))
    vol_c = ql.BlackVolTermStructureHandle(
        ql.BlackConstantVol(today, ql.NullCalendar(), vol,
                            ql.Actual365Fixed()))
    process = ql.BlackScholesMertonProcess(spot_q, div_c, rate_c, vol_c)
    option.setPricingEngine(ql.AnalyticEuropeanEngine(process))
    price = float(option.NPV())
    expected = bsm_call(spot, strike, rate, vol, t, div)
    rel = abs(price - expected) / abs(expected) if expected else abs(price)
    return {"price": price, "expectedPrice": expected, "relError": rel,
            "converged": rel < 1e-8}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "european-call"):
        vals = {}
        for name, default in (("spot", 100.0), ("strike", 100.0),
                              ("rate", 0.05), ("vol", 0.2),
                              ("tYears", 1.0), ("dividend", 0.0)):
            v = request.get(name, default)
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                fail(2, "%s must be a number, got %r" % (name, v))
            vals[name] = float(v)
        if vals["spot"] <= 0 or vals["strike"] <= 0 or vals["vol"] <= 0 \
                or vals["tYears"] <= 0:
            fail(2, "spot, strike, vol, tYears must be positive")
        result = run_call(vals["spot"], vals["strike"], vals["rate"],
                          vals["vol"], vals["tYears"], vals["dividend"])
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
