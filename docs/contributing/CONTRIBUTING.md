# Contributing Guide

## Development Setup

See [`docs/operations/deployment.md`](../operations/deployment.md) for full setup instructions. The short version:

```bash
# Server
cd server && npm install && node migrate.js && node server.js

# Frontend (separate terminal)
cd concord-frontend && npm install
NEXT_PUBLIC_API_URL=http://localhost:5050 npm run dev
```

---

## Branch Naming

| Prefix | Use for |
|---|---|
| `claude/<short-description>` | AI-assisted work |
| `feat/<short-description>` | New features |
| `fix/<short-description>` | Bug fixes |
| `chore/<short-description>` | Maintenance, refactors, deps |

---

## Commit Style

Imperative mood, present tense, no period at the end.

```
add DTU fork endpoint
fix auth bypass in collab routes
migrate energy lens to LensPageShell
update feed-manager polling interval default
```

---

## Adding a New Lens Page

1. **Create the page file:**
   ```
   concord-frontend/app/lenses/{domain}/page.tsx
   ```

2. **Register it** in `concord-frontend/lib/lens-registry.ts` (232 lenses already registered — follow the existing pattern).

3. **Use `LensPageShell`** — do NOT copy-paste boilerplate from other pages:

   ```tsx
   import { LensPageShell } from '@/components/lens/LensPageShell';
   import { useLensData } from '@/hooks/useLensData';
   import { SomeIcon } from 'lucide-react';

   export default function MyLensPage() {
     const domain = 'mylens';
     const { dtus, isLoading, isError } = useLensData(domain);

     return (
       <LensPageShell
         domain={domain}
         title="My Lens"
         headerIcon={<SomeIcon />}
         isLoading={isLoading}
         isError={isError}
       >
         {/* lens content using dtus */}
       </LensPageShell>
     );
   }
   ```

4. **Add a Playwright smoke test** in `concord-frontend/tests/lens-e2e/`.

CI runs `npm run validate-lens-quality` — it will fail if the lens is registered but lacks a `LensPageShell` wrapper.

---

## Adding a Server Route

The server is mid-extraction: `server.js` (70k lines) is being split into `server/routes/` (131 files done). New routes go in the new structure.

**New namespace:**

```js
// server/routes/{namespace}.js
export default function create{Namespace}Router({ STATE, requireAuth, realtimeEmit }) {
  const router = express.Router();

  router.get('/', (req, res) => { /* ... */ });

  router.post('/', requireAuth(), (req, res) => {
    const userId = req.user.id;   // always from the authenticated session
    // ...
  });

  return router;
}
```

**Mount in server.js:**

```js
import create{Namespace}Router from './routes/{namespace}.js';
app.use('/api/{namespace}', create{Namespace}Router({ STATE, requireAuth, realtimeEmit }));
```

**Auth rule:** Every mutation route (POST/PUT/PATCH/DELETE on user data) MUST call `requireAuth()` and derive the actor identity from `req.user.id`. See the auth pattern section below.

---

## Auth Pattern (Critical)

This is the most common quality gap introduced by AI-generated code in this codebase. The CI auth-bypass grep gate will block merges that violate this rule.

```js
// WRONG — auth bypass vulnerability:
app.post('/api/something', (req, res) => {
  const userId = req.body.userId || req.user?.id;  // DO NOT DO THIS
  // An unauthenticated caller can supply any userId in the request body.
});

// CORRECT:
app.post('/api/something', requireAuth(), (req, res) => {
  const userId = req.user.id;  // always from the authenticated JWT session
});
```

**Rule:** Any use of `req.body.userId` on a mutation route requires a `// safe:` comment explaining why the override is intentional (extremely rare — only for admin impersonation flows with explicit checks).

---

## Running Tests

### Server

```bash
cd server

# Run a single test file
node --test tests/auth-security.test.js

# Run all tests with coverage
npx c8 node --test $(ls tests/*.test.js)
```

### Frontend

```bash
cd concord-frontend

# Unit/integration tests with coverage
npm run test:coverage

# E2E tests
npx playwright test
```

### Mobile

```bash
cd concord-mobile
npm run test:coverage
```

---

## CI Gates

All of the following must pass before a PR can merge:

| Gate | Command | Threshold |
|---|---|---|
| Lint | `npm run lint` (server, frontend, mobile) | Zero errors |
| Typecheck | `npm run typecheck` / `npm run type-check` | Zero errors |
| Auth bypass grep | CI scans for `req.body.userId` without `// safe:` on mutation routes | Zero violations |
| Lens quality | `npm run validate-lens-quality` | Zero violations |
| Server coverage | `npx c8 node --test` | ≥45% statements/branches/lines, ≥38% functions |
| Frontend coverage | `npm run test:coverage` | ≥35% statements/lines, ≥38% functions, ≥60% branches |
| Lighthouse CI | `npx lhci autorun` | Accessibility ≥70 (blocks merge); Performance ≥50 (warns) |

---

## PR Checklist

Before opening a pull request:

- [ ] All tests pass locally (`node --test`, `npm run test:coverage`, `npx playwright test`)
- [ ] No new `req.body.userId` without a `// safe:` comment on mutation routes
- [ ] New lens pages use `LensPageShell` (not copy-pasted boilerplate)
- [ ] Coverage thresholds still met (`npx c8` for server, `npm run test:coverage` for frontend)
- [ ] `npm run build` passes in `concord-frontend/`
- [ ] `npm run lint` and `npm run typecheck` pass in each changed workspace
