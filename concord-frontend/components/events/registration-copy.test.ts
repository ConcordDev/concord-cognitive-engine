import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_REQUIRED, REGISTRATION_STATUS, registrationStatus } from './registration-copy';

describe('registration copy', () => {
  it('does not call an unpaid registration paid', () => {
    const text = registrationStatus();
    assert.equal(text, 'Registered — unpaid/comped');
    assert.equal(text.includes('Paid'), false);
    assert.equal(REGISTRATION_STATUS, text);
    assert.equal(EMAIL_REQUIRED, 'Email is required.');
  });
});
