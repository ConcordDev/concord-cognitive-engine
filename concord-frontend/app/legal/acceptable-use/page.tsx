import { LegalMarkdown } from '@/components/legal/LegalMarkdown';

export const metadata = {
  title: 'Acceptable Use Policy · Concord',
  description: 'Community guidelines and prohibited content/conduct on Concord.',
};

const CONTENT = `
This Acceptable Use Policy ("AUP") governs what you may and may not do on Concord —
across the knowledge substrate (DTUs), the creator economy, the 3D social world,
real-time voice chat, and the AI features. It is incorporated into our
[Terms of Service](/legal/terms). Violations may lead to content removal, account
suspension or termination, and forfeiture of related economy balances.

## Prohibited content

You may not create, upload, share, or transmit content that:

- Is **illegal** or facilitates illegal activity.
- Constitutes **child sexual abuse material (CSAM)** — zero tolerance. We remove
  it and report it to the National Center for Missing & Exploited Children (NCMEC)
  and relevant authorities.
- Is **hateful, harassing, or threatening**, or incites violence against people
  or groups.
- Is **sexually explicit** where prohibited, or sexualizes minors in any way.
- Is **graphically violent** or gratuitously shocking.
- **Infringes intellectual property** or misappropriates someone's likeness or
  voice without rights (see our [DMCA Policy](/legal/dmca)).
- Contains **malware**, or **doxxes** / exposes others' private information.

## Prohibited conduct

- **Harassment or abuse** of other users — including in real-time voice chat and
  world presence — impersonation, or stalking.
- **Recording other users' voice** without their consent.
- **Cheating / anti-cheat circumvention**, exploits, or disrupting others' play.
- **Economy abuse** — fraud, chargeback fraud, wash trading, royalty-gaming,
  multi-account exploitation, or manipulating the creator-royalty system.
- **Spam**, scraping, or unauthorized automated access.

## AI-specific rules

- Do not use Concord's AI ("brains") to generate prohibited content above.
- No **jailbreaks or prompt-injection** intended to produce harmful, illegal, or
  abusive output, or to exfiltrate other users' data.
- Do not present AI output as a human in a deceptive way, or generate another
  person's likeness/voice without their rights/consent.

## Reporting & enforcement

Report violations to [abuse@concord-os.org](mailto:abuse@concord-os.org) or via
in-app reporting tools. Enforcement is graduated based on severity and history:
**warning → content removal → temporary suspension → termination**, with economy/
royalty forfeiture where abuse involved the economy. Severe violations (e.g. CSAM)
result in immediate termination and reporting. **Repeat infringers** of
intellectual property are terminated per our DMCA policy.

## Appeals

If you believe enforcement was a mistake, contact
[appeals@concord-os.org](mailto:appeals@concord-os.org); we review appeals and
respond within a reasonable time.
`;

export default function AcceptableUsePage() {
  return <LegalMarkdown title="Acceptable Use Policy" updated="June 7, 2026">{CONTENT}</LegalMarkdown>;
}
