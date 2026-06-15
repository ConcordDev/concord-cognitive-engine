import { LegalMarkdown } from '@/components/legal/LegalMarkdown';

export const metadata = {
  title: 'Privacy Policy · Concord',
  description: 'How Concord collects, uses, and protects your data — privacy-first by design.',
};

const CONTENT = `
Concord Cognitive Engine ("Concord", "we", "us") is built on a simple principle:
**sovereign by design — your data stays under your control.** This Privacy Policy
explains what we collect, why, the legal bases, who we share it with, how long we
keep it, and the rights you have. It covers the Concord web app, mobile app, and the
3D world (collectively, the "Service").

> **Our core commitment.** Concord's cognitive models run on infrastructure we
> operate. We do **not** sell your personal information, we do **not** use it for
> cross-context advertising, and we do **not** train AI models on your private
> content. Where this policy and that commitment ever appear to conflict, the
> commitment governs and we will fix the policy.

## 1. Who we are

Concord Cognitive Engine is the controller of your personal data. Contact:
[privacy@concord-os.org](mailto:privacy@concord-os.org). The Service is operated from
the United States; see §9 on international transfers.

## 2. Personal data we collect

| Category | Examples | Source |
|---|---|---|
| **Account** | email, username, hashed password, session/JWT identifiers | you, at signup |
| **Your content (DTUs)** | knowledge you create, citations, creations, marketplace listings — *which may themselves contain personal data you choose to include* | you |
| **Microphone / voice audio** | speech you record for voice chat or the assistant; in the world, real-time voice | you (mic), only when you enable voice |
| **Images** | pictures you upload for AI vision features | you |
| **Precise geolocation** (mobile) | device location, when you grant it | your device |
| **Device & sensor data** (mobile) | Bluetooth (BLE), Wi-Fi P2P, NFC, device identifiers | your device |
| **Payment data** | handled by **Stripe**; we do **not** store full card numbers | Stripe |
| **Usage & presence** | spatial position in the world, activity logs, performance/telemetry | automatically |

### Sensitive data
We treat **voice audio** as sensitive (voiceprints can be biometric identifiers) and
**precise geolocation** as sensitive personal information. We process these only to
provide the feature you asked for, with the consent described below, and we give you
the right to limit their use (§8).

## 3. How and why we use your data (purposes)

- **Provide the Service** — your account, DTUs, the world, voice/vision features.
- **Operate the creator economy** — Concord Coin balances, the perpetual-royalty
  cascade, purchases, and withdrawals.
- **Run AI features** — chat, the ConKay assistant, vision, voice (see our
  [AI Disclosure](/legal/ai-disclosure)).
- **Security, anti-cheat, and anti-fraud** — protecting accounts and the economy.
- **Legal compliance** — tax/AML obligations on withdrawals, responding to lawful
  requests.

## 4. Legal bases (GDPR Art. 6)

- **Contract** — operating your account and the economy.
- **Consent** — microphone/voice, precise geolocation, non-essential cookies, and
  any future optional use of content to improve models. You can withdraw consent at
  any time.
- **Legitimate interests** — security, fraud prevention, and improving the Service
  (balanced against your rights).
- **Legal obligation** — tax/AML on real-money withdrawals.

## 5. Who we share data with

We share only as needed to run the Service, with:

- **Stripe** — payment processing (we never receive your full card number).
- **Infrastructure / hosting & CDN** — to serve the app.
- **STUN/TURN servers** — to establish peer-to-peer voice in the world (these may
  see IP addresses; audio is peer-to-peer and does not flow through our servers).
- **AI processing** — performed on infrastructure we operate; we do not hand your
  private content to third-party AI providers for their own purposes.

We do **not sell** your personal information and do **not share** it for
cross-context behavioural advertising. We may disclose data if required by law or to
protect rights and safety.

## 6. AI and your data

See the [AI Disclosure](/legal/ai-disclosure) for detail. In short: we don't train
on your private content; any future optional use would be **opt-in**; voice and
images are processed to deliver the requested feature and then handled per §7.

## 7. Data retention

- **Account & content** — kept while your account is active; deleted or anonymized
  after closure, subject to legal holds.
- **Voice audio** — retained only as long as needed to provide the feature, then
  deleted on a defined schedule; not used to build voiceprints.
- **DTU lineage** — when you delete a DTU, user-initiated deletion removes it; the
  substrate may retain lineage tombstones to preserve citation integrity, which do
  not expose your deleted content.
- **Payment/tax records** — retained as required by law.

## 8. Your rights

**Everyone:** you can access, export, and delete your data. Concord's **export /
federation feature** is a first-class way to exercise portability — your DTUs and
account data in standard machine-readable formats.

- **EU/EEA/UK (GDPR):** access, rectification, erasure, restriction, objection,
  portability, and withdrawal of consent.
- **California (CCPA/CPRA):** know, delete, correct, **opt out of sale/sharing**
  (we do neither — see our notice), **limit the use of sensitive personal
  information** (voice, precise location), and non-discrimination. We honour the
  **Global Privacy Control (GPC)** signal.

To exercise rights, email [privacy@concord-os.org](mailto:privacy@concord-os.org).
We respond within the timeframes required by law.

## 9. International transfers

The Service is operated from the United States. Where data is transferred from the
EU/EEA/UK, we rely on appropriate safeguards such as the Standard Contractual
Clauses.

## 10. Security

We protect data with encryption in transit, hashed passwords, and secure mobile
storage (iOS Keychain / Android Keystore; WebCrypto on web). No system is perfectly
secure; we maintain a [vulnerability-disclosure process](/legal/security) and will
notify you of breaches as required by law.

## 11. Minors

Concord is an adults-only Service (18+) and is not directed to minors. We do not
knowingly collect data from anyone under 18; if we learn we have, we delete the
account and its data. Contact
[privacy@concord-os.org](mailto:privacy@concord-os.org) to report an underage account.

## 12. Cookies

See our [Cookie & Tracking Policy](/legal/cookies).

## 13. Changes

We'll update this policy as the Service evolves and revise the date above; material
changes will be notified in-app.

## 14. Contact

[privacy@concord-os.org](mailto:privacy@concord-os.org)

---

*This policy is provided in good faith and for transparency. It is not legal advice.*
`;

export default function PrivacyPage() {
  return <LegalMarkdown title="Privacy Policy" updated="June 7, 2026">{CONTENT}</LegalMarkdown>;
}
