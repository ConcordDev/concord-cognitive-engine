'use client';

import Link from 'next/link';

const EFFECTIVE_DATE = 'March 1, 2026';

const TOC = [
  { id: 'acceptance', label: '1. Acceptance of Terms' },
  { id: 'eligibility', label: '2. Eligibility' },
  { id: 'accounts', label: '3. Account Terms' },
  { id: 'concord-coin', label: '4. Concord Coin Economy' },
  { id: 'content-ownership', label: '5. Content Ownership & DTUs' },
  { id: 'usage-rights', label: '6. Usage Rights Model' },
  { id: 'canonical-architecture', label: '7. Canonical Architecture' },
  { id: 'acceptable-use', label: '8. Acceptable Use Policy' },
  { id: 'creator-responsibilities', label: '9. Creator Responsibilities' },
  { id: 'intellectual-property', label: '10. Intellectual Property & DMCA' },
  { id: 'limitation-liability', label: '11. Limitation of Liability' },
  { id: 'termination', label: '12. Termination' },
  { id: 'governing-law', label: '13. Governing Law' },
  { id: 'modifications', label: '14. Modification of Terms' },
  { id: 'contact', label: '15. Contact Information' },
];

function SectionHeading({ id, number, title }: { id: string; number: string; title: string }) {
  return (
    <h2 id={id} className="mb-4 mt-12 scroll-mt-24 text-xl font-bold text-neon-cyan">
      {number}. {title}
    </h2>
  );
}

export default function TermsOfServicePage() {
  return (
    <article className="max-w-3xl">
      {/* Page title */}
      <header className="mb-10">
        <h1 className="text-3xl font-bold text-white">Terms of Service</h1>
        <p className="mt-2 text-sm text-zinc-400">Effective Date: {EFFECTIVE_DATE}</p>
        <p className="mt-4 text-zinc-400 leading-relaxed">
          Welcome to Concord Cognitive Engine (&quot;Concord,&quot; &quot;we,&quot; &quot;us,&quot;
          or &quot;our&quot;). These Terms of Service (&quot;Terms&quot;) govern your access to and
          use of the Concord platform, including all associated services, features, content, and
          applications (collectively, the &quot;Service&quot;). By accessing or using the Service,
          you agree to be bound by these Terms.
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
        {/* 1. Acceptance */}
        <SectionHeading id="acceptance" number="1" title="Acceptance of Terms" />
        <p>
          By creating an account, accessing, or using Concord in any way, you acknowledge that you
          have read, understood, and agree to be bound by these Terms, as well as our{' '}
          <Link href="/legal/privacy" className="text-neon-cyan hover:underline">
            Privacy Policy
          </Link>{' '}
          and{' '}
          <Link href="/legal/dmca" className="text-neon-cyan hover:underline">
            DMCA Policy
          </Link>
          . If you do not agree, you must not use the Service.
        </p>
        <p className="mt-3">
          These Terms constitute a legally binding agreement between you and Concord OS. We may
          update these Terms from time to time, and continued use after changes constitutes
          acceptance of the revised Terms.
        </p>

        {/* 2. Eligibility */}
        <SectionHeading id="eligibility" number="2" title="Eligibility" />
        <p>
          You must be at least 13 years of age to use the Service. If you are under 18 (or the age
          of majority in your jurisdiction), you may only use the Service with the consent and
          supervision of a parent or legal guardian who agrees to be bound by these Terms.
        </p>
        <p className="mt-3">
          By using the Service, you represent and warrant that you meet all eligibility requirements.
          We reserve the right to request verification of age at any time and to suspend or terminate
          accounts that do not meet eligibility requirements.
        </p>

        {/* 3. Account Terms */}
        <SectionHeading id="accounts" number="3" title="Account Terms" />
        <p>
          To access most features of the Service, you must create an account. When creating an
          account, you agree to:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            Provide accurate, current, and complete information during registration and keep your
            account information up to date.
          </li>
          <li>
            Create a strong, unique password (minimum 12 characters) and maintain the
            confidentiality of your login credentials.
          </li>
          <li>
            Accept responsibility for all activities that occur under your account, whether or not
            authorized by you.
          </li>
          <li>
            Notify us immediately at{' '}
            <a href="mailto:security@concord-os.org" className="text-neon-cyan hover:underline">
              security@concord-os.org
            </a>{' '}
            if you suspect unauthorized access to your account.
          </li>
          <li>Not create accounts through automated means or maintain multiple accounts.</li>
          <li>
            Not transfer, sell, or assign your account or any account rights to any other person or
            entity.
          </li>
        </ul>
        <p className="mt-3">
          We reserve the right to suspend or terminate accounts that violate these Terms, remain
          inactive for extended periods, or are being used for unauthorized purposes.
        </p>

        {/* 4. Concord Coin Economy */}
        <SectionHeading id="concord-coin" number="4" title="Concord Coin Economy" />
        <p>
          Concord utilizes a virtual currency called &quot;Concord Coin&quot; (CC) to facilitate
          transactions within the platform. By using Concord Coin, you acknowledge and agree to the
          following:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">Virtual Currency:</strong> Concord Coin is a virtual
            currency with no real-world monetary value. It exists solely within the Concord
            ecosystem and cannot be exchanged for fiat currency, cryptocurrency, or any other form
            of real money.
          </li>
          <li>
            <strong className="text-zinc-300">No Cash Value:</strong> Concord Coin has no cash value
            outside the platform. You may not sell, trade, or transfer Concord Coin outside of the
            Concord marketplace.
          </li>
          <li>
            <strong className="text-zinc-300">Exchange Rate:</strong> The exchange rate between
            Concord Coin and any purchase mechanism (including earned credits) is determined solely
            by Concord and is subject to change at any time without prior notice.
          </li>
          <li>
            <strong className="text-zinc-300">Non-Refundable:</strong> Concord Coin purchases and
            transactions are generally non-refundable, except as required by applicable law or as
            specifically stated in our refund policy.
          </li>
          <li>
            <strong className="text-zinc-300">Platform Currency:</strong> Concord Coin may be used
            to purchase usage rights to Digital Thought Units (DTUs), access premium features,
            support creators, and participate in marketplace transactions.
          </li>
          <li>
            <strong className="text-zinc-300">Balance Limitations:</strong> We reserve the right to
            set limits on Concord Coin balances, transaction amounts, and earning rates. Unused
            Concord Coin does not expire, but we reserve the right to modify the economy with
            reasonable notice.
          </li>
          <li>
            <strong className="text-zinc-300">No Guarantee of Value:</strong> We do not guarantee
            that Concord Coin will maintain any particular value or utility. The availability of
            items and services purchasable with Concord Coin may change.
          </li>
        </ul>

        {/* 5. Content Ownership & DTUs */}
        <SectionHeading id="content-ownership" number="5" title="Content Ownership & DTUs" />
        <p>
          Concord employs a content system based on Digital Thought Units (DTUs). Your content
          rights are governed as follows:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">Your Content:</strong> You retain full ownership of
            the original content you create and upload to the platform as DTUs. Concord does not
            claim ownership of your content.
          </li>
          <li>
            <strong className="text-zinc-300">License to Concord:</strong> By uploading content to
            the platform, you grant Concord a non-exclusive, worldwide, royalty-free license to
            host, store, display, reproduce, and distribute your content as necessary to operate
            the Service. This includes making your content available to users who have acquired
            usage rights, indexing for search functionality, and creating necessary technical
            copies (such as caching and backups).
          </li>
          <li>
            <strong className="text-zinc-300">DTU Structure:</strong> Content uploaded to Concord is
            organized as DTUs, which may include metadata, versioning information, integrity
            hashes, and associated licensing terms as defined by the creator.
          </li>
          <li>
            <strong className="text-zinc-300">License Termination:</strong> The license granted to
            Concord for your content will terminate when you permanently delete the content from
            the platform, subject to reasonable time for technical removal and any surviving
            obligations (such as existing usage rights already granted to other users).
          </li>
        </ul>

        {/* 6. Usage Rights Model */}
        <SectionHeading id="usage-rights" number="6" title="Usage Rights Model" />
        <p>
          Concord operates on a usage-rights model rather than traditional ownership transfer. When
          you purchase or otherwise acquire access to a DTU, you are acquiring a license to use that
          content, not ownership of the content itself.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">License Grant:</strong> Each DTU purchase grants you a
            personal, non-exclusive, non-transferable (unless explicitly permitted by the DTU
            license) right to access and use the content according to the license terms set by the
            creator.
          </li>
          <li>
            <strong className="text-zinc-300">License Tiers:</strong> DTUs may be offered under
            different license tiers (e.g., personal use, commercial use, extended rights), each
            with specific permissions and restrictions as defined by the creator.
          </li>
          <li>
            <strong className="text-zinc-300">No Ownership Transfer:</strong> Acquiring usage rights
            to a DTU does not transfer ownership of the underlying intellectual property. The
            original creator retains all ownership rights.
          </li>
          <li>
            <strong className="text-zinc-300">Usage Tracking:</strong> Concord may track usage of
            DTUs for purposes of enforcing license terms, calculating creator royalties, and
            maintaining platform integrity.
          </li>
          <li>
            <strong className="text-zinc-300">Revocation:</strong> Usage rights may be revoked if
            you violate the license terms, these Terms of Service, or if the content is removed due
            to a valid legal claim (such as a DMCA takedown). In cases of revocation due to legal
            claims, we will make reasonable efforts to provide refunds or alternative remedies.
          </li>
        </ul>

        {/* 7. Canonical Architecture */}
        <SectionHeading id="canonical-architecture" number="7" title="Canonical Architecture" />
        <p>
          Concord uses a canonical deduplication architecture to efficiently manage content. You
          understand and agree to the following regarding this system:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">One Canonical Per Content:</strong> When content is
            uploaded to Concord, the system identifies whether identical or substantially identical
            content already exists. If it does, the system may reference the existing canonical
            version rather than storing a duplicate copy.
          </li>
          <li>
            <strong className="text-zinc-300">Deduplication Rights:</strong> By uploading content,
            you consent to Concord&apos;s deduplication process. This means your content may be
            stored as a reference to a canonical version shared with other users who uploaded
            identical content.
          </li>
          <li>
            <strong className="text-zinc-300">Integrity Verification:</strong> Each canonical DTU is
            protected by cryptographic integrity hashes. These hashes ensure content has not been
            tampered with and verify the authenticity of the original upload.
          </li>
          <li>
            <strong className="text-zinc-300">Priority Rights:</strong> In cases of content
            disputes, the earliest verified upload timestamp may be used as evidence of priority,
            though this does not constitute proof of original authorship.
          </li>
          <li>
            <strong className="text-zinc-300">No Impact on Ownership:</strong> Canonical
            deduplication is a technical storage optimization and does not affect content ownership
            or licensing. Each creator retains their rights regardless of whether their content
            references a shared canonical version.
          </li>
        </ul>

        {/* 8. Acceptable Use Policy */}
        <SectionHeading id="acceptable-use" number="8" title="Acceptable Use Policy" />
        <p>
          You agree not to use the Service to:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            Upload, post, or transmit content that infringes upon the intellectual property rights
            of any third party.
          </li>
          <li>
            Distribute malware, viruses, or any other malicious code through the platform.
          </li>
          <li>
            Harass, abuse, threaten, or intimidate other users of the Service.
          </li>
          <li>
            Upload content that is unlawful, defamatory, obscene, or promotes illegal activities.
          </li>
          <li>
            Attempt to gain unauthorized access to other users&apos; accounts, the Service&apos;s
            infrastructure, or any connected systems.
          </li>
          <li>
            Use automated scripts, bots, or scraping tools to access the Service without prior
            written consent.
          </li>
          <li>
            Manipulate the Concord Coin economy through fraudulent means, including but not limited
            to exploiting bugs, creating fake accounts, or engaging in wash trading.
          </li>
          <li>
            Impersonate any person or entity, or falsely represent your affiliation with any person
            or entity.
          </li>
          <li>
            Circumvent or attempt to circumvent any technical measures implemented to protect
            content, enforce licensing, or maintain platform security.
          </li>
          <li>
            Use the Service for any commercial purpose not expressly permitted by these Terms or
            your license agreement.
          </li>
        </ul>
        <p className="mt-3">
          Violation of this Acceptable Use Policy may result in content removal, account suspension
          or termination, forfeiture of Concord Coin balance, and/or legal action.
        </p>

        {/* 9. Creator Responsibilities */}
        <SectionHeading id="creator-responsibilities" number="9" title="Creator Responsibilities" />
        <p>
          If you upload content to Concord as a creator, you have additional responsibilities:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">Original Work:</strong> You represent and warrant that
            all content you upload is your original work, or that you have obtained all necessary
            rights, licenses, and permissions to upload and distribute the content through Concord.
          </li>
          <li>
            <strong className="text-zinc-300">Accurate Metadata:</strong> You agree to provide
            accurate metadata, descriptions, and license terms for all content you upload.
            Misleading metadata may result in content removal and account penalties.
          </li>
          <li>
            <strong className="text-zinc-300">License Compliance:</strong> If your content
            incorporates third-party materials (e.g., samples, libraries, assets), you are
            responsible for ensuring that your use and distribution complies with the applicable
            third-party licenses.
          </li>
          <li>
            <strong className="text-zinc-300">Content Labeling:</strong> You agree to accurately
            label content according to Concord&apos;s content classification system, including
            appropriate content warnings where applicable.
          </li>
          <li>
            <strong className="text-zinc-300">Tax Obligations:</strong> You are solely responsible
            for any tax obligations arising from Concord Coin earnings or transactions. Concord
            does not provide tax advice and is not responsible for determining your tax liability.
          </li>
        </ul>

        {/* 10. Intellectual Property & DMCA */}
        <SectionHeading id="intellectual-property" number="10" title="Intellectual Property & DMCA" />
        <p>
          Concord respects intellectual property rights and complies with the Digital Millennium
          Copyright Act (DMCA). We will respond to valid notices of alleged copyright infringement
          in accordance with the DMCA and our{' '}
          <Link href="/legal/dmca" className="text-neon-cyan hover:underline">
            DMCA Policy
          </Link>
          .
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">DMCA Notices:</strong> If you believe that content on
            Concord infringes your copyright, you may submit a DMCA takedown notice through our{' '}
            <Link href="/legal/dmca" className="text-neon-cyan hover:underline">
              DMCA submission form
            </Link>
            .
          </li>
          <li>
            <strong className="text-zinc-300">Counter-Notifications:</strong> If your content has
            been removed due to a DMCA notice and you believe the removal was in error, you may
            submit a counter-notification as described in our DMCA Policy.
          </li>
          <li>
            <strong className="text-zinc-300">Repeat Infringers:</strong> We maintain a repeat
            infringer policy. Users who are the subject of repeated valid DMCA notices may have
            their accounts terminated.
          </li>
          <li>
            <strong className="text-zinc-300">Concord IP:</strong> The Service, including its
            design, logos, trademarks, code, and all associated intellectual property, is owned by
            Concord OS and is protected by intellectual property laws. You may not use our
            trademarks or branding without prior written consent.
          </li>
        </ul>

        {/* 11. Limitation of Liability */}
        <SectionHeading id="limitation-liability" number="11" title="Limitation of Liability" />
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT
            WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING
            BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
            NON-INFRINGEMENT.
          </li>
          <li>
            CONCORD SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
            PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, USE, GOODWILL, OR
            OTHER INTANGIBLE LOSSES, RESULTING FROM YOUR ACCESS TO OR USE OF (OR INABILITY TO
            ACCESS OR USE) THE SERVICE.
          </li>
          <li>
            CONCORD&apos;S TOTAL AGGREGATE LIABILITY TO YOU FOR ALL CLAIMS ARISING OUT OF OR
            RELATED TO THE SERVICE SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU HAVE PAID TO
            CONCORD IN THE 12 MONTHS PRECEDING THE CLAIM, OR (B) ONE HUNDRED U.S. DOLLARS ($100).
          </li>
          <li>
            CONCORD IS NOT LIABLE FOR THE CONTENT, ACCURACY, OR LEGALITY OF DTUs CREATED OR
            DISTRIBUTED BY USERS. CREATORS ARE SOLELY RESPONSIBLE FOR THE CONTENT THEY UPLOAD.
          </li>
          <li>
            CONCORD DOES NOT GUARANTEE THE AVAILABILITY, RELIABILITY, OR PERFORMANCE OF THE
            SERVICE, INCLUDING THE CONCORD COIN ECONOMY, AND IS NOT LIABLE FOR LOSSES DUE TO
            SYSTEM DOWNTIME, TECHNICAL FAILURES, OR ECONOMY ADJUSTMENTS.
          </li>
        </ul>

        {/* 12. Termination */}
        <SectionHeading id="termination" number="12" title="Termination" />
        <p>
          Either party may terminate this agreement at any time:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">By You:</strong> You may terminate your account at any
            time by contacting support or using the account deletion feature. Upon termination,
            your right to use the Service ceases immediately.
          </li>
          <li>
            <strong className="text-zinc-300">By Concord:</strong> We may suspend or terminate your
            account immediately, without prior notice, if you violate these Terms, engage in
            fraudulent activity, or if required by law. We may also terminate accounts that have
            been inactive for more than 24 months.
          </li>
          <li>
            <strong className="text-zinc-300">Effect of Termination:</strong> Upon termination, your
            Concord Coin balance will be forfeited, your content will be removed (subject to
            existing usage rights granted to other users), and your usage rights to purchased DTUs
            will be revoked. Data may be retained as required by law or for legitimate business
            purposes.
          </li>
          <li>
            <strong className="text-zinc-300">Survival:</strong> Sections regarding intellectual
            property, limitation of liability, governing law, and any other provisions that by
            their nature should survive, will survive termination.
          </li>
        </ul>

        {/* 13. Governing Law */}
        <SectionHeading id="governing-law" number="13" title="Governing Law" />
        <p>
          These Terms shall be governed by and construed in accordance with the laws of the State of
          Delaware, United States, without regard to its conflict of law principles.
        </p>
        <p className="mt-3">
          Any disputes arising out of or related to these Terms or the Service shall be resolved
          through binding arbitration in accordance with the rules of the American Arbitration
          Association, except that either party may seek injunctive or equitable relief in any court
          of competent jurisdiction.
        </p>
        <p className="mt-3">
          You agree that any dispute resolution proceedings will be conducted on an individual basis
          and not in a class, consolidated, or representative action. You waive any right to
          participate in class actions against Concord.
        </p>

        {/* 14. Modifications */}
        <SectionHeading id="modifications" number="14" title="Modification of Terms" />
        <p>
          We reserve the right to modify these Terms at any time. When we make material changes, we
          will:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            Provide at least 30 days&apos; notice before the changes take effect, via email and/or
            a prominent notice within the Service.
          </li>
          <li>
            Post the updated Terms with a new effective date on this page.
          </li>
          <li>
            Give you the opportunity to review the changes before they take effect.
          </li>
        </ul>
        <p className="mt-3">
          Your continued use of the Service after the effective date of any changes constitutes your
          acceptance of the updated Terms. If you do not agree with the changes, you must stop using
          the Service and terminate your account.
        </p>

        {/* 15. Contact */}
        <SectionHeading id="contact" number="15" title="Contact Information" />
        <p>If you have questions about these Terms of Service, please contact us:</p>
        <div className="mt-4 rounded-lg border border-lattice-border bg-lattice-surface p-5">
          <p className="text-zinc-300">
            <strong>Concord OS — Legal Department</strong>
          </p>
          <p className="mt-2">
            Email:{' '}
            <a href="mailto:legal@concord-os.org" className="text-neon-cyan hover:underline">
              legal@concord-os.org
            </a>
          </p>
          <p className="mt-1">
            DMCA Agent:{' '}
            <a href="mailto:dmca@concord-os.org" className="text-neon-cyan hover:underline">
              dmca@concord-os.org
            </a>
          </p>
          <p className="mt-1">
            Security:{' '}
            <a href="mailto:security@concord-os.org" className="text-neon-cyan hover:underline">
              security@concord-os.org
            </a>
          </p>
        </div>

        {/* Closing */}
        <div className="mt-12 border-t border-lattice-border pt-6 text-xs text-zinc-400">
          <p>
            These Terms of Service were last updated on {EFFECTIVE_DATE}. Previous versions of these
            Terms are available upon request.
          </p>
        </div>
      </div>
    </article>
  );
}
