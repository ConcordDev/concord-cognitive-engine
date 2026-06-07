import { LegalMarkdown } from '@/components/legal/LegalMarkdown';

export const metadata = {
  title: 'Cookie & Tracking Policy · Concord',
  description: 'How Concord uses cookies, local storage, and similar technologies.',
};

const CONTENT = `
This Cookie & Tracking Policy explains how Concord ("we", "us") uses cookies,
local storage, IndexedDB, and similar technologies on the Concord web and mobile
apps. It should be read alongside our [Privacy Policy](/legal/privacy).

## What these technologies are

Cookies are small text files stored on your device. We also use browser **local
storage** and **IndexedDB** (for offline data and your knowledge substrate) and
**session tokens**. We group them by purpose below.

## Categories we use

### Strictly necessary (no consent required)

These are essential to operate the service and cannot be switched off:

- **Authentication** — a session cookie (\`concord_auth\`) and refresh token
  (\`concord_refresh\`) keep you signed in. Without these the app cannot work.
- **Security / anti-fraud** — signals used to protect your account and the
  creator economy from abuse.
- **Your preferences & local state** — e.g. \`concord_entered\`,
  cookie-consent status, onboarding completion, theme, and the offline DTU cache
  in IndexedDB. These keep the app usable and remember your choices on this device.

### Functional & analytics (consent-gated)

Any non-essential analytics or product-telemetry technologies are **blocked until
you opt in** through our cookie banner, and you can withdraw consent at any time.
Concord is designed privacy-first: we do **not** use cookies for cross-context
behavioural advertising, and we do **not** sell or share your personal information
for advertising.

## Managing your choices

- **Cookie banner.** On first visit you can **Accept all** or **Reject all**
  with equal ease; "Manage preferences" lets you choose by category. Rejecting
  non-essential technologies never blocks core functionality.
- **Global Privacy Control (GPC).** We honour the GPC browser signal as a valid
  opt-out of "sale"/"sharing" under U.S. state privacy laws.
- **Your browser.** You can clear or block cookies in your browser settings;
  doing so for strictly-necessary cookies will sign you out and may break features.
- **Clearing local data.** Clearing site data / IndexedDB removes your offline
  cache; synced content remains in your account.

## Changes

We will update this policy as our technologies change and revise the "Last
updated" date above.

## Contact

Questions: [legal@concord-os.org](mailto:legal@concord-os.org).
`;

export default function CookiesPage() {
  return <LegalMarkdown title="Cookie & Tracking Policy" updated="June 7, 2026">{CONTENT}</LegalMarkdown>;
}
