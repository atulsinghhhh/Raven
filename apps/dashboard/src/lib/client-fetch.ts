'use client';

/**
 * Parses a BFF route's JSON body, whether the response succeeded or came
 * back as the `{code, message}` error shape every route-helpers.ts route
 * sends on failure. Guarded the same way apiFetch (api-client.ts) guards
 * server-side: a body that isn't valid JSON becomes `undefined` instead of
 * an uncaught throw, since one call site's `response.json()` doubling as
 * both its success-payload and its error-payload parse can't otherwise
 * `.catch()` per branch.
 */
export async function readJson<T = unknown>(response: Response): Promise<T | undefined> {
  return response.json().catch(() => undefined);
}

/** Pulls `message` off a parsed BFF error body, falling back when it's missing or unparseable. */
export function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && typeof (payload as { message?: unknown }).message === 'string') {
    return (payload as { message: string }).message;
  }
  return fallback;
}
