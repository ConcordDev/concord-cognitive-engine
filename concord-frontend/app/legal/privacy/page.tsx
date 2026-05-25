'use client';

import Link from 'next/link';

const EFFECTIVE_DATE = 'March 1, 2026';

const TOC = [
  { id: 'information-collected', label: '1. Information We Collect' },
  { id: 'how-we-use', label: '2. How We Use Information' },
  { id: 'data-sharing', label: '3. Data Sharing and Disclosure' },
  { id: 'data-retention', label: '4. Data Retention' },
  { id: 'cookies', label: '5. Cookies and Tracking' },
  { id: 'user-rights', label: '6. Your Rights' },
  { id: 'children', label: '7. Children\'s Privacy' },
  { id: 'international', label: '8. International Data Transfers' },
  { id: 'security', label: '9. Security Measures' },
  { id: 'ccpa', label: '10. California Residents (CCPA)' },
  { id: 'gdpr', label: '11. EU Residents (GDPR)' },
  { id: 'changes', label: '12. Changes to This Policy' },
  { id: 'contact', label: '13. Contact for Privacy Inquiries' },
];

function SectionHeading({ id, number, title }: { id: string; number: string; title: string }) {
  return (
    <h2 id={id} className="mb-4 mt-12 scroll-mt-24 text-xl font-bold text-neon-cyan">
      {number}. {title}
    </h2>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <article className="max-w-3xl">
      {/* Page title */}
      <header className="mb-10">
        <h1 className="text-3xl font-bold text-white">Privacy Policy</h1>
        <p className="mt-2 text-sm text-zinc-400">Effective Date: {EFFECTIVE_DATE}</p>
        <p className="mt-4 text-zinc-400 leading-relaxed">
          Concord Cognitive Engine (&quot;Concord,&quot; &quot;we,&quot; &quot;us,&quot; or
          &quot;our&quot;) is committed to protecting your privacy. This Privacy Policy explains how
          we collect, use, disclose, and safeguard your information when you use the Concord platform
          and associated services (the &quot;Service&quot;). Concord is built on the principle of
          data sovereignty -- your data belongs to you, and we treat it accordingly.
        </p>
      </header>

      {/* Table of Contents */}
      <nav className="mb-10 rounded-xl border border-lattice-border bg-lattice-surface p-6">
        <p className="mb-3 text-sm font-semibold text-zinc-300">Table of Contents</p>
        <ol className="columns-2 gap-6 space-y-1 text-sm">
          {TOC.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className="text-zinc-400 transition-colors hover:text-neon-cyan"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* Sections */}
      <div className="space-y-2 text-sm leading-relaxed text-zinc-400">
        {/* 1. Information We Collect */}
        <SectionHeading id="information-collected" number="1" title="Information We Collect" />

        <h3 className="mt-6 mb-2 text-base font-semibold text-zinc-300">
          1.1 Account Information
        </h3>
        <p>When you create an account, we collect:</p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>Username and display name</li>
          <li>Email address</li>
          <li>Password (stored only as a cryptographic hash -- we never store your plaintext password)</li>
          <li>Account creation date and last login timestamp</li>
          <li>Account role and permissions</li>
        </ul>

        <h3 className="mt-6 mb-2 text-base font-semibold text-zinc-300">
          1.2 Content and DTU Data
        </h3>
        <p>When you use the Service, we store:</p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>Digital Thought Units (DTUs) you create, including their content, metadata, and versioning information</li>
          <li>Content integrity hashes and canonical references</li>
          <li>License terms and usage rights you configure</li>
          <li>Marketplace listings and transaction records</li>
          <li>Comments, annotations, and collaborative contributions</li>
        </ul>

        <h3 className="mt-6 mb-2 text-base font-semibold text-zinc-300">
          1.3 Usage Data
        </h3>
        <p>We automatically collect certain information about your use of the Service:</p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>Pages and features accessed, and time spent on each</li>
          <li>Search queries within the platform</li>
          <li>Concord Coin transactions and balance changes</li>
          <li>Content interaction patterns (views, purchases, downloads)</li>
          <li>Error logs and performance metrics</li>
        </ul>

        <h3 className="mt-6 mb-2 text-base font-semibold text-zinc-300">
          1.4 Device and Technical Information
        </h3>
        <p>We may collect technical information including:</p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>IP address (used for security and rate limiting)</li>
          <li>Browser type and version</li>
          <li>Operating system</li>
          <li>Device identifiers</li>
          <li>Referring URLs and exit pages</li>
          <li>Timezone and locale settings</li>
        </ul>

        {/* 2. How We Use Information */}
        <SectionHeading id="how-we-use" number="2" title="How We Use Information" />
        <p>We use the information we collect for the following purposes:</p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">Service Operation:</strong> To provide, maintain, and
            improve the Concord platform, including the DTU system, marketplace, and Concord Coin
            economy.
          </li>
          <li>
            <strong className="text-zinc-300">Authentication and Security:</strong> To verify your
            identity, protect your account, detect and prevent fraud, abuse, and unauthorized
            access.
          </li>
          <li>
            <strong className="text-zinc-300">Communication:</strong> To send you essential service
            notifications, security alerts, and account-related communications. We will never send
            marketing emails without your explicit opt-in consent.
          </li>
          <li>
            <strong className="text-zinc-300">Content Integrity:</strong> To operate the canonical
            deduplication system, verify content integrity, and enforce licensing terms.
          </li>
          <li>
            <strong className="text-zinc-300">Legal Compliance:</strong> To comply with applicable
            laws, respond to legal requests, enforce our Terms of Service, and protect the rights
            and safety of Concord and its users.
          </li>
          <li>
            <strong className="text-zinc-300">Analytics and Improvement:</strong> To understand how
            the Service is used, identify areas for improvement, and develop new features. Analytics
            data is aggregated and anonymized wherever possible.
          </li>
        </ul>

        {/* 3. Data Sharing and Disclosure */}
        <SectionHeading id="data-sharing" number="3" title="Data Sharing and Disclosure" />
        <p>
          We do not sell your personal data. We may share information in the following limited
          circumstances:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">Public Content:</strong> DTUs you publish to the
            marketplace are accessible to other users according to the license terms you set. Your
            creator profile (username, public bio) is visible to other users.
          </li>
          <li>
            <strong className="text-zinc-300">Service Providers:</strong> We may share information
            with trusted third-party service providers who assist in operating the Service (e.g.,
            hosting, email delivery), subject to confidentiality agreements.
          </li>
          <li>
            <strong className="text-zinc-300">Legal Requirements:</strong> We may disclose
            information when required by law, subpoena, court order, or other legal process, or
            when we believe disclosure is necessary to protect our rights, your safety, or the
            safety of others.
          </li>
          <li>
            <strong className="text-zinc-300">DMCA Proceedings:</strong> In connection with DMCA
            takedown notices and counter-notifications, certain information (such as names and
            contact details of claimants and respondents) may be shared between the parties as
            required by the DMCA process.
          </li>
          <li>
            <strong className="text-zinc-300">Business Transfers:</strong> In the event of a merger,
            acquisition, or sale of assets, your information may be transferred as part of the
            transaction, subject to the same privacy protections described in this policy.
          </li>
          <li>
            <strong className="text-zinc-300">With Your Consent:</strong> We may share information
            with third parties when you give us explicit consent to do so.
          </li>
        </ul>

        {/* 4. Data Retention */}
        <SectionHeading id="data-retention" number="4" title="Data Retention" />
        <p>We retain your information for the following periods:</p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">Account Data:</strong> Retained for the duration of
            your account and for up to 30 days after account deletion to allow for recovery.
          </li>
          <li>
            <strong className="text-zinc-300">Content (DTUs):</strong> Retained until you delete
            them, or until your account is terminated. Content subject to active usage rights
            granted to other users may be retained until those rights expire.
          </li>
          <li>
            <strong className="text-zinc-300">Transaction Records:</strong> Concord Coin transaction
            history is retained for a minimum of 7 years for financial compliance purposes.
          </li>
          <li>
            <strong className="text-zinc-300">Audit Logs:</strong> Security and authentication logs
            are retained for up to 2 years.
          </li>
          <li>
            <strong className="text-zinc-300">Usage Data:</strong> Aggregated usage analytics are
            retained indefinitely. Individual usage data is retained for up to 12 months and then
            anonymized.
          </li>
          <li>
            <strong className="text-zinc-300">Legal Holds:</strong> Data may be retained beyond
            these periods if required by law or in connection with pending legal proceedings.
          </li>
        </ul>

        {/* 5. Cookies and Tracking */}
        <SectionHeading id="cookies" number="5" title="Cookies and Tracking" />
        <p>Concord uses cookies and similar technologies for the following purposes:</p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">Essential Cookies:</strong> Required for
            authentication, security (CSRF protection), and core functionality. These cannot be
            disabled while using the Service.
          </li>
          <li>
            <strong className="text-zinc-300">Authentication Cookies:</strong> Secure, httpOnly
            cookies that maintain your login session. These are encrypted and cannot be read by
            client-side scripts.
          </li>
          <li>
            <strong className="text-zinc-300">Preference Cookies:</strong> Store your display
            preferences (theme, language, layout) for a better user experience.
          </li>
          <li>
            <strong className="text-zinc-300">Analytics Cookies:</strong> Help us understand how the
            Service is used. We use privacy-respecting analytics that do not track users across
            other websites.
          </li>
        </ul>
        <p className="mt-3">
          We do <strong className="text-zinc-300">not</strong> use third-party advertising cookies
          or tracking pixels. We do not engage in cross-site tracking or sell data to advertisers.
        </p>

        {/* 6. Your Rights */}
        <SectionHeading id="user-rights" number="6" title="Your Rights" />
        <p>You have the following rights regarding your personal data:</p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">Right to Access:</strong> You may request a copy of
            the personal data we hold about you at any time.
          </li>
          <li>
            <strong className="text-zinc-300">Right to Correction:</strong> You may update or
            correct your personal information through your account settings, or by contacting us.
          </li>
          <li>
            <strong className="text-zinc-300">Right to Deletion:</strong> You may request deletion
            of your personal data. We will comply within 30 days, subject to legal retention
            requirements and existing obligations.
          </li>
          <li>
            <strong className="text-zinc-300">Right to Portability:</strong> You may export your
            data, including all DTUs and account information, in standard machine-readable formats
            through the Concord export feature or by requesting an export from our support team.
          </li>
          <li>
            <strong className="text-zinc-300">Right to Restriction:</strong> You may request that
            we restrict processing of your personal data in certain circumstances.
          </li>
          <li>
            <strong className="text-zinc-300">Right to Object:</strong> You may object to the
            processing of your personal data for certain purposes, including analytics.
          </li>
        </ul>
        <p className="mt-3">
          To exercise any of these rights, contact us at{' '}
          <a href="mailto:privacy@concord-os.org" className="text-neon-cyan hover:underline">
            privacy@concord-os.org
          </a>
          . We will respond within 30 days.
        </p>

        {/* 7. Children's Privacy */}
        <SectionHeading id="children" number="7" title="Children's Privacy" />
        <p>
          Concord is not directed to children under the age of 13. We do not knowingly collect
          personal information from children under 13 in compliance with the Children&apos;s Online
          Privacy Protection Act (COPPA).
        </p>
        <p className="mt-3">
          If we learn that we have collected personal information from a child under 13 without
          verifiable parental consent, we will delete that information as quickly as possible. If
          you believe we may have collected information from a child under 13, please contact us
          immediately at{' '}
          <a href="mailto:privacy@concord-os.org" className="text-neon-cyan hover:underline">
            privacy@concord-os.org
          </a>
          .
        </p>
        <p className="mt-3">
          Users between 13 and 18 may use the Service with parental or guardian consent and
          supervision, as outlined in our{' '}
          <Link href="/legal/terms" className="text-neon-cyan hover:underline">
            Terms of Service
          </Link>
          .
        </p>

        {/* 8. International Data Transfers */}
        <SectionHeading id="international" number="8" title="International Data Transfers" />
        <p>
          Concord is operated from the United States. If you access the Service from outside the
          United States, your information may be transferred to and processed in the United States
          or other jurisdictions where our servers or service providers are located.
        </p>
        <p className="mt-3">
          We take appropriate safeguards to ensure your data is protected in accordance with this
          Privacy Policy regardless of where it is processed, including:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-6">
          <li>Standard Contractual Clauses (SCCs) for transfers from the EU/EEA</li>
          <li>Data processing agreements with all service providers</li>
          <li>Encryption in transit and at rest for all personal data</li>
          <li>Regular compliance assessments</li>
        </ul>

        {/* 9. Security Measures */}
        <SectionHeading id="security" number="9" title="Security Measures" />
        <p>
          We implement robust technical and organizational measures to protect your data:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">Encryption:</strong> All data is encrypted in transit
            using TLS 1.3 and at rest using AES-256 encryption.
          </li>
          <li>
            <strong className="text-zinc-300">Authentication:</strong> Passwords are hashed using
            bcrypt with appropriate cost factors. Refresh token rotation and token family tracking
            prevent session hijacking.
          </li>
          <li>
            <strong className="text-zinc-300">Access Control:</strong> Role-based access control
            (RBAC) limits data access to authorized personnel. API keys are stored as cryptographic
            hashes.
          </li>
          <li>
            <strong className="text-zinc-300">Rate Limiting:</strong> Aggressive rate limiting
            protects against brute-force attacks and abuse.
          </li>
          <li>
            <strong className="text-zinc-300">Audit Logging:</strong> All authentication events and
            security-relevant actions are logged for monitoring and incident response.
          </li>
          <li>
            <strong className="text-zinc-300">Content Integrity:</strong> Cryptographic hashes
            verify the integrity of all DTU content against tampering.
          </li>
        </ul>
        <p className="mt-3">
          While we take security seriously, no method of transmission over the Internet or method of
          electronic storage is 100% secure. If you discover a vulnerability, please report it to{' '}
          <a href="mailto:security@concord-os.org" className="text-neon-cyan hover:underline">
            security@concord-os.org
          </a>
          .
        </p>

        {/* 10. CCPA */}
        <SectionHeading id="ccpa" number="10" title="California Residents (CCPA)" />
        <p>
          If you are a California resident, you have additional rights under the California Consumer
          Privacy Act (CCPA) and the California Privacy Rights Act (CPRA):
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">Right to Know:</strong> You may request details about
            the categories and specific pieces of personal information we have collected about you,
            the sources of that information, the business purposes for collection, and the
            categories of third parties with whom we share information.
          </li>
          <li>
            <strong className="text-zinc-300">Right to Delete:</strong> You may request deletion of
            personal information we have collected, subject to certain exceptions.
          </li>
          <li>
            <strong className="text-zinc-300">Right to Opt Out of Sale:</strong> We do not sell
            personal information. As such, there is no need to opt out.
          </li>
          <li>
            <strong className="text-zinc-300">Right to Non-Discrimination:</strong> We will not
            discriminate against you for exercising your CCPA rights.
          </li>
          <li>
            <strong className="text-zinc-300">Authorized Agents:</strong> You may designate an
            authorized agent to submit requests on your behalf, subject to verification.
          </li>
        </ul>
        <p className="mt-3">
          To exercise your CCPA rights, contact us at{' '}
          <a href="mailto:privacy@concord-os.org" className="text-neon-cyan hover:underline">
            privacy@concord-os.org
          </a>{' '}
          or call our privacy hotline. We will verify your identity before processing requests.
        </p>

        {/* 11. GDPR */}
        <SectionHeading id="gdpr" number="11" title="EU Residents (GDPR)" />
        <p>
          If you are located in the European Union or European Economic Area, the General Data
          Protection Regulation (GDPR) provides you with additional rights:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">Legal Basis for Processing:</strong> We process your
            data based on: (a) your consent, (b) performance of a contract (the Terms of Service),
            (c) our legitimate interests (security, fraud prevention, service improvement), and (d)
            legal obligations.
          </li>
          <li>
            <strong className="text-zinc-300">Data Protection Officer:</strong> You may contact our
            Data Protection Officer at{' '}
            <a href="mailto:dpo@concord-os.org" className="text-neon-cyan hover:underline">
              dpo@concord-os.org
            </a>
            .
          </li>
          <li>
            <strong className="text-zinc-300">Right to Lodge a Complaint:</strong> You have the
            right to lodge a complaint with your local data protection supervisory authority.
          </li>
          <li>
            <strong className="text-zinc-300">Right to Withdraw Consent:</strong> Where processing
            is based on consent, you may withdraw consent at any time without affecting the
            lawfulness of processing based on consent before withdrawal.
          </li>
          <li>
            <strong className="text-zinc-300">Data Transfers:</strong> When transferring data
            outside the EEA, we rely on Standard Contractual Clauses and supplementary measures to
            ensure adequate protection.
          </li>
        </ul>

        {/* 12. Changes */}
        <SectionHeading id="changes" number="12" title="Changes to This Policy" />
        <p>
          We may update this Privacy Policy from time to time to reflect changes in our practices,
          technologies, or legal requirements. When we make material changes:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-6">
          <li>We will post the updated policy with a new effective date.</li>
          <li>We will notify you via email and/or a prominent notice in the Service.</li>
          <li>For significant changes, we will provide at least 30 days&apos; advance notice.</li>
        </ul>
        <p className="mt-3">
          We encourage you to review this policy periodically. Your continued use of the Service
          after any changes constitutes acceptance of the updated policy.
        </p>

        {/* 13. Contact */}
        <SectionHeading id="contact" number="13" title="Contact for Privacy Inquiries" />
        <p>
          If you have questions, concerns, or requests regarding this Privacy Policy or our data
          practices, please contact us:
        </p>
        <div className="mt-4 rounded-lg border border-lattice-border bg-lattice-surface p-5">
          <p className="text-zinc-300">
            <strong>Concord OS — Privacy Team</strong>
          </p>
          <p className="mt-2">
            Privacy Inquiries:{' '}
            <a href="mailto:privacy@concord-os.org" className="text-neon-cyan hover:underline">
              privacy@concord-os.org
            </a>
          </p>
          <p className="mt-1">
            Data Protection Officer:{' '}
            <a href="mailto:dpo@concord-os.org" className="text-neon-cyan hover:underline">
              dpo@concord-os.org
            </a>
          </p>
          <p className="mt-1">
            DMCA / Copyright:{' '}
            <a href="mailto:dmca@concord-os.org" className="text-neon-cyan hover:underline">
              dmca@concord-os.org
            </a>
          </p>
          <p className="mt-1">
            Security Issues:{' '}
            <a href="mailto:security@concord-os.org" className="text-neon-cyan hover:underline">
              security@concord-os.org
            </a>
          </p>
        </div>

        {/* Closing */}
        <div className="mt-12 border-t border-lattice-border pt-6 text-xs text-zinc-400">
          <p>
            This Privacy Policy was last updated on {EFFECTIVE_DATE}. Previous versions are
            available upon request.
          </p>
        </div>
      </div>
    </article>
  );
}
