import { LegalMarkdown } from '@/components/legal/LegalMarkdown';

export const metadata = {
  title: 'Security & Vulnerability Disclosure · Concord',
  description: 'How to report a security vulnerability to Concord.',
};

const CONTENT = `
We take the security of Concord and our users' data and economy seriously, and we
welcome reports from the security community.

## Reporting a vulnerability

Email **[security@concord-os.org](mailto:security@concord-os.org)** with:

- a description of the issue and its potential impact,
- steps to reproduce (proof-of-concept where possible), and
- the affected URL/endpoint/version.

A machine-readable contact is published at
[\`/.well-known/security.txt\`](/.well-known/security.txt).

## Safe harbor

If you make a good-faith effort to comply with this policy during your research, we
will consider your research authorized, will work with you to understand and resolve
the issue quickly, and will not pursue or support legal action against you. Good
faith means:

- Only test against your **own** account/data; do not access, modify, or destroy
  other users' data, and do not degrade service availability.
- Do not exploit beyond the minimum necessary to demonstrate the issue.
- Give us reasonable time to remediate before public disclosure.
- Never use a finding to manipulate the creator economy or move funds.

## Out of scope

Volumetric DoS, social engineering of staff/users, physical attacks, and findings
that require a compromised device or rooted/jailbroken environment.

## Our commitment

We aim to acknowledge reports within a few business days and to keep you informed
through remediation. At this time we do not run a paid bounty program, but we are
grateful for responsible disclosure and will credit reporters who wish to be named.
`;

export default function SecurityPage() {
  return <LegalMarkdown title="Security & Vulnerability Disclosure" updated="June 7, 2026">{CONTENT}</LegalMarkdown>;
}
