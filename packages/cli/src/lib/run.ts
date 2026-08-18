import chalk from 'chalk';
import { CliError, ExitCode } from './errors.js';
import { isDebugEnabled } from './logger.js';

/**
 * Wraps every command action — the one place that turns a thrown error
 * into the right exit code plus a readable message instead of a raw
 * stack trace, unless --debug is set.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic pass-through wrapper for commander's variadic action callbacks
export function withErrorHandling(action: (...args: any[]) => Promise<void>) {
  return async (...args: any[]) => {
    try {
      await action(...args);
    } catch (error) {
      printError(error);
      process.exit(error instanceof CliError ? error.exitCode : ExitCode.GeneralFailure);
    }
  };
}

function printError(error: unknown): void {
  if (error instanceof CliError) {
    process.stderr.write(`${chalk.red('Error:')} ${error.message}\n`);
    if (error.suggestion) {
      process.stderr.write(`\n${chalk.dim('Suggestion:')}\n${error.suggestion}\n`);
    }
    if (isDebugEnabled() && error.cause) {
      process.stderr.write(`\n${chalk.dim('Cause (--debug):')}\n${String(error.cause)}\n`);
    }
    return;
  }

  process.stderr.write(`${chalk.red('Error:')} An unexpected error occurred.\n`);
  if (isDebugEnabled()) {
    process.stderr.write(`\n${chalk.dim('Stack (--debug):')}\n${error instanceof Error ? error.stack : String(error)}\n`);
  } else {
    process.stderr.write(`\n${chalk.dim('Re-run with --debug for details.')}\n`);
  }
}
