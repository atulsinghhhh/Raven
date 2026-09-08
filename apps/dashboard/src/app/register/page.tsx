import { redirect } from 'next/navigation';

/**
 * /signup is the canonical route now. This stub keeps every old link —
 * bookmarks, docs, marketing pages — working instead of 404ing.
 */
export default function RegisterRedirect() {
  redirect('/signup');
}
