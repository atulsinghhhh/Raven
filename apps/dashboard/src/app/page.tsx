import { redirect } from 'next/navigation';

/**
 * The console has no marketing surface — `/` is just the door. Signed-in
 * users land on their project list; everyone else is bounced to /login by
 * the dashboard auth gate one hop later.
 */
export default function RootPage() {
  redirect('/dashboard/projects');
}
