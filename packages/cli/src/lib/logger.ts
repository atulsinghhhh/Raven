import chalk from 'chalk';

let debugEnabled = false;

export function setDebugEnabled(value: boolean): void {
  debugEnabled = value;
}

export function isDebugEnabled(): boolean {
  return debugEnabled;
}

const SENSITIVE_KEYS = /^(token|accesstoken|secret|key|password|credential|authorization)$/i;

/**
 * Deep-redacts any object before it's allowed near a debug log — the one
 * gate every debug print goes through, so a future call site can't
 * accidentally leak a token/secret by forgetting to redact it manually
 * (Phase 8 spec §29/§45).
 */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.test(key) ? '[redacted]' : redact(val);
    }
    return out;
  }
  return value;
}

/** Debug-only structured logging — never printed unless --debug is set, and always redacted first. */
export function debugLog(message: string, data?: unknown): void {
  if (!debugEnabled) return;
  const suffix = data !== undefined ? ` ${JSON.stringify(redact(data))}` : '';
  process.stderr.write(chalk.dim(`[debug] ${message}${suffix}\n`));
}
