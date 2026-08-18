/**
 * Exit codes are part of the CLI's contract with scripts/CI — documented
 * in docs/cli.md#exit-codes. Never renumber these once shipped.
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
 * The one error type every command throws. `suggestion` becomes a
 * "Suggestion: ..." line in the printed error — this is what keeps error
 * output developer-friendly instead of a raw exception dump (Phase 8
 * spec §27). `cause` is only ever surfaced under --debug.
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
  return new CliError('auth', 'Not logged in.', { suggestion: 'Run `raven login`' });
}

export function noProjectSelectedError(): CliError {
  return new CliError('usage', 'No Raven project selected.', {
    suggestion: 'Run `raven init` in this directory, or `raven projects use <project>`',
  });
}
