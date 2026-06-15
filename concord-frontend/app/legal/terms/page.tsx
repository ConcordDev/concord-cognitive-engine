import { LegalMarkdown } from '@/components/legal/LegalMarkdown';

export const metadata = {
  title: 'Terms of Service · Concord',
  description: 'The terms governing your use of Concord.',
};

const CONTENT = `
These Terms of Service ("Terms") are a binding agreement between you and Concord
Cognitive Engine ("Concord", "we", "us") governing your use of the Concord web app,
mobile app, and 3D world (the "Service"). By using the Service you agree to these
Terms and to our [Privacy Policy](/legal/privacy) and
[Acceptable Use Policy](/legal/acceptable-use).

## 1. Eligibility & accounts

You must be at least 18 years old to use the Service. The Service includes
Concordia, a 3D world with mature, violent content, and is intended for adults
only. By registering you attest that you are 18 or older. Provide accurate
registration information, keep your credentials secure, and you are responsible for
activity under your account. We may suspend or terminate accounts that violate these
Terms.

## 2. Acceptable use

Your use is governed by our [Acceptable Use Policy](/legal/acceptable-use), which is
incorporated here by reference.

## 3. Your content & license

You retain ownership of the content you create ("DTUs", creations, listings). To
operate the Service, you grant Concord a **non-exclusive, worldwide, royalty-free
license to host, store, reproduce, display, and operate** your content as needed to
run the platform (including substrate compression, citation, and — where you choose
— federation). This license lasts only as long as needed to provide the Service and
honour citations/royalties. You warrant you have the rights to the content you post.

## 4. The Concord economy

**Concord Coin (virtual currency).** Concord Coin is a limited, revocable,
non-transferable **license to use a feature of the Service** — not your property and
not legal tender. It has **no real-world monetary value** except through the official
withdrawal path, and may not be sold or traded outside the platform.

**Purchases.** Purchases of Coin or assets (processed by **Stripe**) are **final and
non-refundable** except where the law requires otherwise. Prices and applicable taxes
are shown at purchase.

**Creator royalties.** The Service pays creators through a perpetual-royalty cascade.
These rates are **governance-locked constitutional invariants** of the platform (for
example: the DTU royalty path directs the large majority of a sale to the creator
pool; ancestor royalties halve down a citation chain to a small floor, with a capped
total to ancestors). Citation that triggers royalties requires the parent creator's
consent or a public/licensed work.

**Withdrawals.** Cashing out is subject to a **48-hour hold** on newly-earned credits
(an anti-fraud / anti-refund-exploit measure), possible identity verification (KYC) and
anti-money-laundering checks, minimum thresholds, fees, and your **tax
responsibilities** (we may be required to report payouts). Coin is not a security,
deposit, or investment.

## 5. AI features & disclaimers

The Service includes AI features (see the [AI Disclosure](/legal/ai-disclosure)). AI
output **may be inaccurate** and is **not professional advice**. You are responsible
for verifying and for how you use it.

## 6. Intellectual property

Concord and its underlying software, design, and trademarks are owned by us or our
licensors. Feedback you provide may be used without obligation to you.

## 7. Termination

You may stop using the Service at any time. We may suspend or terminate your access
for violations (including **repeat copyright infringement** — see our
[DMCA Policy](/legal/dmca)). On termination, your license to use Coin and access
content ends; vested royalty obligations and legal retention may persist.

## 8. Disclaimers

The Service is provided **"as is"** and **"as available"**, without warranties of any
kind, to the maximum extent permitted by law. We do not guarantee uninterrupted or
error-free operation.

## 9. Limitation of liability

To the maximum extent permitted by law, Concord is not liable for indirect,
incidental, special, consequential, or punitive damages, and our total liability is
limited to the greater of the amounts you paid us in the 12 months before the claim
or USD 100.

## 10. Indemnification

You agree to indemnify Concord against claims arising from your content or your
violation of these Terms or the law.

## 11. Governing law & disputes

These Terms are governed by the laws of the United States and the state in which
Concord operates, excluding conflict-of-laws rules. **Disputes are resolved by
binding arbitration on an individual basis, with a class-action waiver**, except where
prohibited by law; you may bring qualifying claims in small-claims court, and you may
opt out of arbitration within 30 days of first accepting these Terms by emailing
[legal@concord-os.org](mailto:legal@concord-os.org).

## 12. Changes

We may update these Terms; material changes will be notified in-app and your continued
use constitutes acceptance.

## 13. Miscellaneous

If any provision is unenforceable, the rest remains in effect. These Terms are the
entire agreement between you and Concord regarding the Service. We may assign these
Terms; you may not without our consent.

## 14. Contact

[legal@concord-os.org](mailto:legal@concord-os.org)

---

*These Terms are provided for transparency and are not legal advice.*
`;

export default function TermsPage() {
  return <LegalMarkdown title="Terms of Service" updated="June 7, 2026">{CONTENT}</LegalMarkdown>;
}
