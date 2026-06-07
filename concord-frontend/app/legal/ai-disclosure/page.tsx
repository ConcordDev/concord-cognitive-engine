import { LegalMarkdown } from '@/components/legal/LegalMarkdown';

export const metadata = {
  title: 'AI Disclosure · Concord',
  description: 'How Concord uses AI, its limits, and our stance on your data.',
};

const CONTENT = `
Concord uses artificial intelligence throughout the product. This disclosure
explains what the AI does, its limitations, and — importantly — how it relates to
your data. It complements our [Privacy Policy](/legal/privacy) and
[Terms of Service](/legal/terms).

## Where AI is used

- **Chat & reasoning** — conversational assistance, including the **ConKay**
  assistant mode, grounded in your own knowledge (DTUs) and, when enabled, live
  research.
- **Voice** — speech-to-text (your microphone input) and text-to-speech (spoken
  replies).
- **Vision** — understanding images you choose to upload.
- **The world** — non-player characters and ambient simulation.

## AI outputs may be wrong

AI output can be **inaccurate, incomplete, biased, or fabricated** ("hallucinated").
Concord's AI is **not professional advice** — not legal, medical, financial, or
other regulated advice. **Verify anything important before relying on it.** You are
responsible for how you use AI output, and our [Acceptable Use Policy](/legal/acceptable-use)
governs what you may generate.

## Human oversight & no consequential automated decisions

You remain in control. Concord does not use AI to make decisions that produce legal
or similarly significant effects about you without human involvement. You can flag
problematic output via in-app controls or [legal@concord-os.org](mailto:legal@concord-os.org).

## Your data and model training

Concord is built **privacy-first** — "sovereign by design." Consistent with that:

- We do **not** train AI models on your private content.
- Concord's cognitive models run on infrastructure we operate; we do not sell your
  content to third-party AI providers for their own model training.
- Your microphone audio and uploaded images are processed to provide the feature
  you requested and handled per the retention rules in our
  [Privacy Policy](/legal/privacy); voice is treated as sensitive data.

If we ever introduce any optional use of your content to improve models, it will be
**opt-in** with clear, separate consent — never on by default.

## Provenance & artifacts

When the assistant performs a task, it may save a record ("artifact") of the task
and its result to your own knowledge locker so you can revisit what was done. These
artifacts belong to you and follow the same privacy and deletion rules as your other
content.

## Changes

We will update this disclosure as our AI features evolve.
`;

export default function AIDisclosurePage() {
  return <LegalMarkdown title="AI & Automated-Decision Disclosure" updated="June 7, 2026">{CONTENT}</LegalMarkdown>;
}
