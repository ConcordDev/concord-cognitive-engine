'use client';

/**
 * /auth — Phase P shared sign-in / sign-up page.
 *
 * Mounts the AuthPage component (signin + signup tabs + OAuth) that
 * was already authored but never had a route. Existing /login and
 * /register pages remain as deep-links; /auth is the single
 * canonical entry that hosts the combined form.
 */

import { AuthPage } from '@/components/auth/AuthPage';

export default function AuthRoute() {
  return <AuthPage redirectTo="/" />;
}
