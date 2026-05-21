# hypothesis — Feature Gap vs JASP / GraphPad Prism

Category leader (2026): JASP / GraphPad Prism (statistical analysis). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `hypothesis` domain — zTest, abTest, bayesianInference, powerAnalysis; generic artifact store; ArxivFeed component.

## Has (verified in code)
- Z-test with z-statistic, p-value, reject decision, confidence interval, effect size + magnitude, standard error
- A/B test analysis
- Bayesian inference
- Statistical power analysis
- arXiv research-paper feed for hypothesis sourcing

## Missing — buildable feature backlog
- [ ] `[M]` Full test battery — t-tests, ANOVA, chi-square, regression, correlation
- [ ] `[M]` Data table / CSV import to run tests on real datasets
- [ ] `[S]` Result visualization — distribution plots, CI charts, effect-size forest plots
- [ ] `[S]` Assumption checks (normality, homoscedasticity) before a test
- [ ] `[M]` Hypothesis registry — pre-registration of hypotheses + outcome tracking
- [ ] `[S]` Multiple-comparison correction (Bonferroni, FDR)
- [ ] `[S]` Exportable stats report (APA-formatted)

## Parity
~40% of JASP's feature surface. The four tests it implements (z, A/B, Bayesian, power) are correct and detailed, but a real stats tool needs the full test battery, dataset import, assumption checking, and result visualization — currently it computes a handful of tests on hand-entered parameters.
