'use client';

import { useState, FormEvent } from 'react';

import { api } from '@/lib/api/client';

const EFFECTIVE_DATE = 'March 1, 2026';

const TOC = [
  { id: 'compliance', label: '1. Statement of Compliance' },
  { id: 'filing-notice', label: '2. Filing a DMCA Takedown Notice' },
  { id: 'required-info', label: '3. Required Information' },
  { id: 'counter-notification', label: '4. Counter-Notification Process' },
  { id: 'repeat-infringer', label: '5. Repeat Infringer Policy' },
  { id: 'good-faith', label: '6. Good Faith Filing Requirements' },
  { id: 'agent', label: '7. DMCA Agent Contact Information' },
  { id: 'submit-form', label: 'Submit a DMCA Notice' },
];

function SectionHeading({ id, number, title }: { id: string; number: string; title: string }) {
  return (
    <h2 id={id} className="mb-4 mt-12 scroll-mt-24 text-xl font-bold text-neon-cyan">
      {number}. {title}
    </h2>
  );
}

interface DmcaForm {
  claimantName: string;
  claimantEmail: string;
  claimantAddress: string;
  copyrightWork: string;
  infringingUrl: string;
  dtuId: string;
  description: string;
  goodFaithStatement: boolean;
  accuracyStatement: boolean;
  signature: string;
}

const EMPTY_FORM: DmcaForm = {
  claimantName: '',
  claimantEmail: '',
  claimantAddress: '',
  copyrightWork: '',
  infringingUrl: '',
  dtuId: '',
  description: '',
  goodFaithStatement: false,
  accuracyStatement: false,
  signature: '',
};

export default function DmcaPolicyPage() {
  const [form, setForm] = useState<DmcaForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; caseId?: string; error?: string } | null>(
    null,
  );

  function updateField<K extends keyof DmcaForm>(key: K, value: DmcaForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    try {
      const { data } = await api.post('/api/legal/dmca/submit', form);
      setResult({ ok: true, caseId: data.caseId });
      setForm(EMPTY_FORM);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to submit DMCA notice. Please try again.';
      setResult({ ok: false, error: message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article className="max-w-3xl">
      {/* Page title */}
      <header className="mb-10">
        <h1 className="text-3xl font-bold text-white">DMCA Policy</h1>
        <p className="mt-2 text-sm text-zinc-400">Effective Date: {EFFECTIVE_DATE}</p>
        <p className="mt-4 text-zinc-400 leading-relaxed">
          Concord Cognitive Engine (&quot;Concord&quot;) respects the intellectual property rights of
          others and complies with the Digital Millennium Copyright Act of 1998 (the &quot;DMCA&quot;).
          This policy outlines the procedures for reporting alleged copyright infringement and for
          submitting counter-notifications.
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
        {/* 1. Statement of Compliance */}
        <SectionHeading id="compliance" number="1" title="Statement of Compliance" />
        <p>
          Concord complies with the provisions of the Digital Millennium Copyright Act (17 U.S.C.
          Section 512) and responds expeditiously to valid notifications of claimed copyright
          infringement. Upon receiving a proper DMCA takedown notice, we will:
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>Promptly remove or disable access to the allegedly infringing material.</li>
          <li>Notify the user who posted the material that it has been removed.</li>
          <li>Provide the user with information about the counter-notification process.</li>
          <li>
            In appropriate circumstances, terminate the accounts of users who are repeat infringers.
          </li>
        </ul>

        {/* 2. Filing a DMCA Takedown Notice */}
        <SectionHeading id="filing-notice" number="2" title="Filing a DMCA Takedown Notice" />
        <p>
          If you are a copyright owner (or authorized to act on behalf of one) and believe that
          content on Concord infringes your copyright, you may submit a DMCA takedown notice to our
          designated DMCA agent. You may submit your notice via the{' '}
          <a href="#submit-form" className="text-neon-cyan hover:underline">
            submission form below
          </a>{' '}
          or by email to{' '}
          <a href="mailto:dmca@concord-os.org" className="text-neon-cyan hover:underline">
            dmca@concord-os.org
          </a>
          .
        </p>

        {/* 3. Required Information */}
        <SectionHeading id="required-info" number="3" title="Required Information for a Valid Notice" />
        <p>
          To be effective under the DMCA (17 U.S.C. Section 512(c)(3)), your notification must
          include all of the following:
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">Physical or electronic signature</strong> of the
            copyright owner or a person authorized to act on their behalf.
          </li>
          <li>
            <strong className="text-zinc-300">Identification of the copyrighted work</strong>{' '}
            claimed to have been infringed, or, if multiple copyrighted works are covered by a
            single notification, a representative list of such works.
          </li>
          <li>
            <strong className="text-zinc-300">
              Identification of the material that is claimed to be infringing
            </strong>{' '}
            or to be the subject of infringing activity and that is to be removed, and information
            reasonably sufficient to permit us to locate the material. This should include the URL
            or DTU ID of the allegedly infringing content.
          </li>
          <li>
            <strong className="text-zinc-300">Your contact information</strong>, including name,
            address, telephone number, and email address.
          </li>
          <li>
            <strong className="text-zinc-300">A statement of good faith</strong> that you have a
            good faith belief that use of the material in the manner complained of is not authorized
            by the copyright owner, its agent, or the law.
          </li>
          <li>
            <strong className="text-zinc-300">A statement of accuracy</strong> that the information
            in the notification is accurate, and under penalty of perjury, that you are authorized
            to act on behalf of the owner of an exclusive right that is allegedly infringed.
          </li>
        </ol>

        {/* 4. Counter-Notification */}
        <SectionHeading
          id="counter-notification"
          number="4"
          title="Counter-Notification Process"
        />
        <p>
          If you believe your content was removed or disabled by mistake or misidentification, you
          may submit a counter-notification to our DMCA agent. Your counter-notification must
          include:
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-6">
          <li>Your physical or electronic signature.</li>
          <li>
            Identification of the material that has been removed or to which access has been
            disabled, and the location at which the material appeared before it was removed or
            access was disabled.
          </li>
          <li>
            A statement under penalty of perjury that you have a good faith belief that the
            material was removed or disabled as a result of mistake or misidentification of the
            material.
          </li>
          <li>
            Your name, address, and telephone number, and a statement that you consent to the
            jurisdiction of the federal district court for the judicial district in which your
            address is located (or, if your address is outside of the United States, for any
            judicial district in which Concord may be found), and that you will accept service of
            process from the person who filed the original DMCA notification or an agent of such
            person.
          </li>
        </ol>
        <p className="mt-4">
          Upon receipt of a valid counter-notification, we will:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>Provide the original complainant with a copy of the counter-notification.</li>
          <li>
            Inform the complainant that we will replace the removed material or restore access
            within 10 to 14 business days.
          </li>
          <li>
            Restore the removed content within 10 to 14 business days after receiving the
            counter-notification, unless the copyright owner files a court action against the user.
          </li>
        </ul>

        {/* 5. Repeat Infringer Policy */}
        <SectionHeading id="repeat-infringer" number="5" title="Repeat Infringer Policy" />
        <p>
          In accordance with the DMCA and other applicable law, Concord has adopted a policy of
          terminating, in appropriate circumstances, the accounts of users who are deemed to be
          repeat infringers.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-6">
          <li>
            <strong className="text-zinc-300">First Strike:</strong> Written warning and removal of
            infringing content. The user is notified of the DMCA notice and their right to file a
            counter-notification.
          </li>
          <li>
            <strong className="text-zinc-300">Second Strike:</strong> Content removal, 30-day
            suspension from uploading new content, and a formal warning that further infringement
            will result in permanent account termination.
          </li>
          <li>
            <strong className="text-zinc-300">Third Strike:</strong> Permanent termination of the
            user&apos;s account and forfeiture of all Concord Coin balance. The user will be
            prohibited from creating new accounts.
          </li>
        </ul>
        <p className="mt-3">
          Strikes may be removed after 12 months of good standing, or if a counter-notification is
          upheld. We evaluate each case individually and may deviate from this policy in exceptional
          circumstances.
        </p>

        {/* 6. Good Faith Filing */}
        <SectionHeading id="good-faith" number="6" title="Good Faith Filing Requirements" />
        <p>
          Please be aware that under 17 U.S.C. Section 512(f), any person who knowingly materially
          misrepresents that material or activity is infringing, or that material or activity was
          removed or disabled by mistake or misidentification, may be subject to liability for
          damages, including costs and attorneys&apos; fees.
        </p>
        <p className="mt-3">
          Before filing a DMCA notice, please consider whether the use of the copyrighted material
          constitutes fair use. If you are unsure whether the material infringes your copyright, we
          recommend consulting with an attorney before submitting a notice.
        </p>
        <div className="mt-4 rounded-lg border border-sovereignty-warning/30 bg-sovereignty-warning/5 p-4">
          <p className="text-sovereignty-warning text-sm font-medium">
            Filing a false DMCA notice is punishable under federal law. Only submit a notice if you
            have a good faith belief that the material infringes your copyright.
          </p>
        </div>

        {/* 7. DMCA Agent */}
        <SectionHeading id="agent" number="7" title="DMCA Agent Contact Information" />
        <p>Our designated DMCA agent for receiving notifications of claimed infringement is:</p>
        <div className="mt-4 rounded-lg border border-lattice-border bg-lattice-surface p-5">
          <p className="text-zinc-300">
            <strong>DMCA Agent — Concord OS</strong>
          </p>
          <p className="mt-2">
            Email:{' '}
            <a href="mailto:dmca@concord-os.org" className="text-neon-cyan hover:underline">
              dmca@concord-os.org
            </a>
          </p>
          <p className="mt-1">Subject Line: DMCA Takedown Notice</p>
          <p className="mt-3 text-xs text-zinc-400">
            We aim to acknowledge all DMCA notices within 24 hours and take action within 48 hours
            of receiving a valid and complete notice.
          </p>
        </div>

        {/* ── Submission Form ─────────────────────────────────────────── */}
        <h2
          id="submit-form"
          className="mb-4 mt-16 scroll-mt-24 text-xl font-bold text-neon-cyan"
        >
          Submit a DMCA Takedown Notice
        </h2>
        <p className="mb-6">
          Use the form below to submit a DMCA takedown notice electronically. All fields marked with
          an asterisk (*) are required. You may also email your notice directly to{' '}
          <a href="mailto:dmca@concord-os.org" className="text-neon-cyan hover:underline">
            dmca@concord-os.org
          </a>
          .
        </p>

        {/* Success / Error Banner */}
        {result && (
          <div
            className={`mb-6 rounded-lg border p-4 ${
              result.ok
                ? 'border-neon-green/30 bg-neon-green/5 text-neon-green'
                : 'border-sovereignty-danger/30 bg-sovereignty-danger/5 text-sovereignty-danger'
            }`}
          >
            {result.ok ? (
              <p>
                Your DMCA notice has been submitted successfully. Your case ID is{' '}
                <strong className="font-mono">{result.caseId}</strong>. Please save this ID for your
                records. We will review your notice and respond within 48 hours.
              </p>
            ) : (
              <p>{result.error}</p>
            )}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="space-y-6 rounded-xl border border-lattice-border bg-lattice-surface p-6"
        >
          {/* Claimant Info */}
          <fieldset>
            <legend className="mb-4 text-base font-semibold text-zinc-300">
              Claimant Information
            </legend>
            <div className="space-y-4">
              <div>
                <label htmlFor="claimantName" className="mb-1 block text-sm text-zinc-400">
                  Full Legal Name *
                </label>
                <input
                  id="claimantName"
                  type="text"
                  required
                  value={form.claimantName}
                  onChange={(e) => updateField('claimantName', e.target.value)}
                  className="w-full rounded-lg border border-lattice-border bg-lattice-deep px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-neon-cyan/50 focus:ring-1 focus:ring-neon-cyan/30"
                  placeholder="Your full legal name"
                />
              </div>
              <div>
                <label htmlFor="claimantEmail" className="mb-1 block text-sm text-zinc-400">
                  Email Address *
                </label>
                <input
                  id="claimantEmail"
                  type="email"
                  required
                  value={form.claimantEmail}
                  onChange={(e) => updateField('claimantEmail', e.target.value)}
                  className="w-full rounded-lg border border-lattice-border bg-lattice-deep px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-neon-cyan/50 focus:ring-1 focus:ring-neon-cyan/30"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label htmlFor="claimantAddress" className="mb-1 block text-sm text-zinc-400">
                  Mailing Address
                </label>
                <input
                  id="claimantAddress"
                  type="text"
                  value={form.claimantAddress}
                  onChange={(e) => updateField('claimantAddress', e.target.value)}
                  className="w-full rounded-lg border border-lattice-border bg-lattice-deep px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-neon-cyan/50 focus:ring-1 focus:ring-neon-cyan/30"
                  placeholder="123 Main St, City, State, ZIP"
                />
              </div>
            </div>
          </fieldset>

          {/* Copyright Details */}
          <fieldset>
            <legend className="mb-4 text-base font-semibold text-zinc-300">
              Copyright &amp; Infringement Details
            </legend>
            <div className="space-y-4">
              <div>
                <label htmlFor="copyrightWork" className="mb-1 block text-sm text-zinc-400">
                  Description of Copyrighted Work *
                </label>
                <textarea
                  id="copyrightWork"
                  required
                  rows={3}
                  value={form.copyrightWork}
                  onChange={(e) => updateField('copyrightWork', e.target.value)}
                  className="w-full rounded-lg border border-lattice-border bg-lattice-deep px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-neon-cyan/50 focus:ring-1 focus:ring-neon-cyan/30"
                  placeholder="Describe the copyrighted work that has been infringed"
                />
              </div>
              <div>
                <label htmlFor="infringingUrl" className="mb-1 block text-sm text-zinc-400">
                  URL of Infringing Material
                </label>
                <input
                  id="infringingUrl"
                  type="url"
                  value={form.infringingUrl}
                  onChange={(e) => updateField('infringingUrl', e.target.value)}
                  className="w-full rounded-lg border border-lattice-border bg-lattice-deep px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-neon-cyan/50 focus:ring-1 focus:ring-neon-cyan/30"
                  placeholder="https://concord-os.org/..."
                />
              </div>
              <div>
                <label htmlFor="dtuId" className="mb-1 block text-sm text-zinc-400">
                  DTU ID (if known)
                </label>
                <input
                  id="dtuId"
                  type="text"
                  value={form.dtuId}
                  onChange={(e) => updateField('dtuId', e.target.value)}
                  className="w-full rounded-lg border border-lattice-border bg-lattice-deep px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-neon-cyan/50 focus:ring-1 focus:ring-neon-cyan/30 font-mono"
                  placeholder="dtu_..."
                />
              </div>
              <div>
                <label htmlFor="description" className="mb-1 block text-sm text-zinc-400">
                  Detailed Description of Infringement *
                </label>
                <textarea
                  id="description"
                  required
                  rows={4}
                  value={form.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  className="w-full rounded-lg border border-lattice-border bg-lattice-deep px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-neon-cyan/50 focus:ring-1 focus:ring-neon-cyan/30"
                  placeholder="Explain how the material infringes your copyright"
                />
              </div>
            </div>
          </fieldset>

          {/* Sworn Statements */}
          <fieldset>
            <legend className="mb-4 text-base font-semibold text-zinc-300">
              Sworn Statements
            </legend>
            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={form.goodFaithStatement}
                  onChange={(e) => updateField('goodFaithStatement', e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-lattice-border bg-lattice-deep text-neon-cyan accent-neon-cyan"
                />
                <span className="text-sm text-zinc-400">
                  I have a good faith belief that the use of the described material is not authorized
                  by the copyright owner, its agent, or the law. *
                </span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={form.accuracyStatement}
                  onChange={(e) => updateField('accuracyStatement', e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-lattice-border bg-lattice-deep text-neon-cyan accent-neon-cyan"
                />
                <span className="text-sm text-zinc-400">
                  The information in this notification is accurate, and under penalty of perjury, I
                  am authorized to act on behalf of the owner of an exclusive right that is allegedly
                  infringed. *
                </span>
              </label>
            </div>
          </fieldset>

          {/* Signature */}
          <fieldset>
            <legend className="mb-4 text-base font-semibold text-zinc-300">
              Electronic Signature
            </legend>
            <div>
              <label htmlFor="signature" className="mb-1 block text-sm text-zinc-400">
                Type your full legal name as your electronic signature *
              </label>
              <input
                id="signature"
                type="text"
                required
                value={form.signature}
                onChange={(e) => updateField('signature', e.target.value)}
                className="w-full rounded-lg border border-lattice-border bg-lattice-deep px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-neon-cyan/50 focus:ring-1 focus:ring-neon-cyan/30"
                placeholder="Your full legal name"
              />
              <p className="mt-1 text-xs text-zinc-400">
                By typing your name above, you are signing this notice electronically under penalty
                of perjury.
              </p>
            </div>
          </fieldset>

          {/* Submit */}
          <div className="flex items-center justify-between border-t border-lattice-border pt-6">
            <p className="text-xs text-zinc-400 max-w-md">
              Submitting a false DMCA notice is a federal offense. Please review all information
              before submitting.
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="shrink-0 rounded-lg bg-neon-cyan/10 px-6 py-2.5 text-sm font-semibold text-neon-cyan border border-neon-cyan/20 transition-all hover:bg-neon-cyan/20 hover:border-neon-cyan/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting...' : 'Submit DMCA Notice'}
            </button>
          </div>
        </form>

        {/* Closing */}
        <div className="mt-12 border-t border-lattice-border pt-6 text-xs text-zinc-400">
          <p>
            This DMCA Policy was last updated on {EFFECTIVE_DATE}. For questions about this policy,
            contact{' '}
            <a href="mailto:dmca@concord-os.org" className="text-neon-cyan/60 hover:text-neon-cyan">
              dmca@concord-os.org
            </a>
            .
          </p>
        </div>
      </div>
    </article>
  );
}
