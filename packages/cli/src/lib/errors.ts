/**
 * These are a contract with scripts/CI (docs/cli.md#exit-codes) — don't
 * renumber once shipped.
 */
export const ExitCode = {
  Success: 0,
  GeneralFailure: 1,
  InvalidUsage: 2,
  AuthenticationFailure: 3,
  AuthorizationFailure: 4,
  NotFound: 5,
  NetworkFailure: 6,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export type CliErrorKind =
  | 'usage'
  | 'auth'
  | 'authz'
  | 'not_found'
  | 'network'
  | 'general';

const EXIT_CODE_BY_KIND: Record<CliErrorKind, ExitCodeValue> = {
  usage: ExitCode.InvalidUsage,
  auth: ExitCode.AuthenticationFailure,
  authz: ExitCode.AuthorizationFailure,
  not_found: ExitCode.NotFound,
  network: ExitCode.NetworkFailure,
  general: ExitCode.GeneralFailure,
};

/**
 * The one error type every command throws. `suggestion` prints as a
 * "Suggestion: ..." line instead of a raw stack dump. `cause` only shows
 * up under --debug.
 */
export class CliError extends Error {
  readonly kind: CliErrorKind;
  readonly suggestion?: string;
  readonly cause?: unknown;

  constructor(kind: CliErrorKind, message: string, options?: { suggestion?: string; cause?: unknown }) {
    super(message);
    this.name = 'CliError';
    this.kind = kind;
    this.suggestion = options?.suggestion;
    this.cause = options?.cause;
  }

  get exitCode(): ExitCodeValue {
    return EXIT_CODE_BY_KIND[this.kind];
  }
}

export function notLoggedInError(): CliError {
  return new CliError('auth', 'Not logged in.', {
    // Both paths, because the browser one is useless in CI and a
    // container — which is exactly where this error tends to show up.
    suggestion: 'Run `raven login`, or set RAVEN_TOKEN if there is no browser here (CI, containers, SSH)',
  });
}

export function noProjectSelectedError(): CliError {
  return new CliError('usage', 'No Raven project selected.', {
    suggestion: 'Run `raven init` in this directory, or `raven projects use <project>`',
  });
}
