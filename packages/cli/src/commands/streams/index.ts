import { Command } from 'commander';
import { registerStreamsListCommand } from './list.js';
import { registerStreamsInspectCommand } from './inspect.js';
import { registerStreamsCreateCommand } from './create.js';
import { registerStreamsUpdateCommand } from './update.js';
import { registerStreamsEndCommand } from './end.js';

/**
 * `raven streams` — lifecycle and inspection, deliberately not credential
 * minting.
 *
 * Like `raven chat`, this authenticates with a developer's session and
 * calls dashboard-facing endpoints. Creating, updating, and ending a
 * stream carry no secret in their response, so they're safe here. Adding
 * or removing a host, or minting a viewer token, mints a real RTC + chat
 * credential — that stays on `@corvidhq/server` / `raven-sdk`, run from
 * your own backend, exactly like `raven chat send` and chat token minting
 * never got a CLI equivalent. See docs/cli.md#live-streaming.
 */
export function registerStreamsCommand(program: Command): void {
  const streams = program.command('streams').description("Inspect and manage a project's live streams");

  registerStreamsListCommand(streams);
  registerStreamsInspectCommand(streams);
  registerStreamsCreateCommand(streams);
  registerStreamsUpdateCommand(streams);
  registerStreamsEndCommand(streams);
}
