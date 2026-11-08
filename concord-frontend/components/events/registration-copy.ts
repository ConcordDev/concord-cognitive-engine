/** Registration is a list entry. No payment is collected on this form. */

export const REGISTRATION_STATUS = 'Registered — unpaid/comped';

export const EMAIL_REQUIRED = 'Email is required.';

export function registrationStatus(): string {
  return REGISTRATION_STATUS;
}
