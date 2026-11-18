# math.transforms — FFT, Laplace, Z, wavelets (SX-NUM-14)

Transforms at the JS tier, against the DLMF tables. Code:
`server/lib/conkay/physics/solvers/transforms.js` (registry
solver, L2).

## Targets

- **fft / ifft** — radix-2 FFT for power-of-two lengths,
  direct DFT for other lengths up to 512 (longer non-power-of-
  two lengths name the FFTW tier). Every FFT result carries
  two certificates computed on the call itself: the round-trip
  error and the Parseval relative error.
- **dct** — DCT-II with orthonormal scaling, direct sums.
- **laplace** — F(s) = ∫₀^∞ e^{−st} f(t) dt for an expression
  f, by tanh–sinh quadrature over a window whose tail bound
  is computed from a sampled bound on |f| and reported in the
  result. Three levels must settle or the call refuses; s ≤ 0
  is outside the certified envelope and refused by name.
- **inverse-laplace** — the Abate–Whitt Euler method
  (Fourier-series inversion with binomial Euler averaging,
  A = 25, N = 60, M = 40) over a complex extension of the
  symbolic grammar written for this solver. The catalogue
  reference pair 1/(s+1) → e^{−t} measures to ~1e-12; 1/s →
  1 and 1/(s²+1) → sin t are pinned alongside it.
- **hilbert** — the analytic signal via FFT; the result is
  the envelope (a pure cosine's envelope measures 1 to
  rounding).
- **dwt** — Haar wavelet transform with an exact
  reconstruction certificate in the result. Deeper wavelet
  families are the PyWavelets engine tier, named rather than
  approximated.

## Reference + locator

DLMF transform tables. CI pins: the delta and bin-cosine FFT
cases with certificates < 1e-11; the constant-signal DCT;
Laplace pairs 1 ↔ 1/s and e^{−t} ↔ 1/(s+1) to 1e-9; the
inverse pairs above; Haar reconstruction < 1e-12.

## Replay

Walker: `conkay_solve` math.transforms `{F: "1/(s+1)", t:
[0.5, 1, 2]}`, target `inverse-laplace` → PASS with
e^{−t} at each t within 1e-6; `{f: "1", s: [0]}`, target
`laplace` → NOT_COMPUTED `outside_envelope`. Reachability
via solve.direct rides SC-00 (named foundation); the
MCP/chain paths reach the registry entry as registered.
