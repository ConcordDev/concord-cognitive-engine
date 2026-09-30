# Screenshots

Referenced by the root `README.md`. Captured live from concord-os.org with a
throwaway account, via Playwright:

```bash
cd concord-frontend && npx playwright install chromium   # one-time
CONCORD_URL=https://concord-os.org CONCORD_USER=you@example.com CONCORD_PASS=… \
  node ../scripts/capture-screenshots.mjs
```

`hero-explore.png` is the public `/explore` entry point (no auth). The lens
shots are on a fresh account — empty ledgers and "connecting" feeds are real
first-run state, not seeded or faked. To get data-rich shots, point the script
at an instance with seeded content.
