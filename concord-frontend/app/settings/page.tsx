import { redirect } from 'next/navigation';

/**
 * `/settings` used to mount the world-lens settings modal with a mismatched
 * local object, so every volume read 0.00 and Apply would have written that
 * over the account. The account surface is `/lenses/settings`.
 */
export default function SettingsPage() {
  redirect('/lenses/settings');
}
