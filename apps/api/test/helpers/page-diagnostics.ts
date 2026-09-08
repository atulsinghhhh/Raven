import type { Page } from 'playwright';

/**
 * Surfaces what a harness page said, so a browser e2e failure is
 * diagnosable instead of a bare `waitForFunction` timeout.
 *
 * The harness pages log every step of a join (`[harness:publisher]
 * joined, connectionState=…`) and every room error, but none of it
 * reaches the test runner by default, so a page that failed to connect
 * and a page that connected and then stalled produce the identical
 * "Timeout 30000ms exceeded" message. That difference is the whole
 * diagnosis.
 *
 * Attached before `goto`, and only printed on failure, so a passing run
 * stays quiet.
 */
export function collectPageDiagnostics(page: Page, label: string): () => string {
  const lines: string[] = [];

  page.on('console', (message) => {
    lines.push(`[${label}:console:${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (err) => {
    lines.push(`[${label}:pageerror] ${err.message}`);
  });
  page.on('requestfailed', (req) => {
    lines.push(`[${label}:requestfailed] ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`);
  });

  return () => (lines.length ? lines.join('\n') : `(no console output from ${label})`);
}

/**
 * Waits for a condition, and on timeout throws with the page's own log
 * attached, not Playwright's message alone.
 */
export async function waitForPage(
  page: Page,
  predicate: () => boolean,
  diagnostics: () => string,
  what: string,
  timeoutMs = 30_000,
): Promise<void> {
  try {
    await page.waitForFunction(predicate, undefined, { timeout: timeoutMs });
  } catch (err) {
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for ${what}.\n\n${diagnostics()}\n\n` +
        `(original: ${(err as Error).message})`,
    );
  }
}
