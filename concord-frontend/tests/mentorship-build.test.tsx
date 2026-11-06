/**
 * Mentorship S2 close-out (B2, queue takeover) — source pins:
 *  S2a: the goals panel states the status/progress contract its buttons
 *       now honour (done sets progress to 100%).
 *  S2b: the profile exit exists in the edit form — a two-step withdraw
 *       wired to the mentor-withdraw macro, with its scope stated.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) =>
  readFileSync(join(process.cwd(), rel), 'utf8');

const directory = read('components/mentorship/MentorDirectoryPanel.tsx');
const goals = read('components/mentorship/MentorshipGoalsPanel.tsx');

describe('mentorship S2 — profile exit (S2b)', () => {
  it('the withdraw control calls the mentor-withdraw macro', () => {
    expect(directory).toContain("lensRun('mentorship', 'mentor-withdraw', {})");
  });

  it('withdrawal is a two-step confirm inside the edit form, existing profiles only', () => {
    expect(directory).toContain('editingExisting && !confirmWithdraw');
    expect(directory).toContain('Withdraw mentor profile');
    expect(directory).toContain('editingExisting && confirmWithdraw');
    expect(directory).toContain('Confirm withdraw');
    expect(directory).toContain('Keep profile');
  });

  it('the confirm states the scope: directory exit, records remain', () => {
    expect(directory).toContain('You leave the directory and your profile page closes.');
    expect(directory).toContain('Reviews and session history stay as records.');
  });

  it('a successful withdrawal closes the form and says so', () => {
    expect(directory).toContain('Mentor profile withdrawn');
    expect(directory).toContain('notifyMentorshipProgramChanged()');
  });
});

describe('mentorship S2 — goal coherence caption (S2a)', () => {
  it('the goals panel states the contract at the status controls', () => {
    expect(goals).toContain('Status and progress move together');
    expect(goals).toContain('marking it done sets progress to 100%');
  });
});
