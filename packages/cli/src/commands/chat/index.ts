import { Command } from 'commander';
import { registerChatOverviewCommand } from './overview.js';
import { registerChatConversationsCommand } from './conversations.js';
import { registerChatConnectionsCommand } from './connections.js';
import { registerChatPresenceCommand } from './presence.js';

/**
 * `raven chat` — inspection only, deliberately.
 *
 * The CLI authenticates with a developer's session (the same JWT the
 * dashboard uses), and every command here reads a dashboard-facing
 * endpoint. Sending a message or minting a chat token needs a *project
 * API key*, which is a runtime credential your backend holds — not
 * something the CLI stores or should encourage passing around a terminal.
 *
 * So `raven chat send` is absent on purpose. Use `@raven/server` or
 * `raven-sdk` from your backend for that; see docs/cli.md#chat.
 */
export function registerChatCommand(program: Command): void {
  const chat = program.command('chat').description("Inspect a project's chat activity, conversations, and connections");

  registerChatOverviewCommand(chat);
  registerChatConversationsCommand(chat);
  registerChatConnectionsCommand(chat);
  registerChatPresenceCommand(chat);
}
