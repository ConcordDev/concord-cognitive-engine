# Screenshots

Live-instance product screenshots go here (referenced by the root `README.md`).

Capture them by pointing the Playwright script at a running deployment:

```bash
cd concord-frontend && npx playwright install chromium   # one-time
CONCORD_URL=https://your-instance CONCORD_USER=you@example.com CONCORD_PASS=… \
  node ../scripts/capture-screenshots.mjs
```

They aren't committed from CI because the sandbox can't boot the full stack
(GPU brains absent, monolith boot exceeds the harness timeout) and the public
site is auth-gated. The root README's Mermaid diagrams render live on GitHub in
the meantime.
