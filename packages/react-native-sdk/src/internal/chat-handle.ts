import type { LogLevel } from '@raven/rtc';
import type { RavenChatHandle } from '../types';

interface ChatHandleOptions {
  token: string;
  apiUrl?: string;
  chatUrl?: string;
  logLevel?: LogLevel;
  onTokenExpiring?: () => Promise<string> | string;
}

/**
 * Builds `raven.chat` on top of `@raven/chat`'s real client.
 *
 * Two things are worth calling out about this file.
 *
 * First, `@raven/chat` is **resolved at runtime**, not imported
 * statically. It's an optional peer dependency: an app that only wants
 * video shouldn't be forced to bundle a messaging client, and a static
 * import would make it mandatory at bundle time regardless of whether
 * `chatToken` was ever set.
 *
 * Second, the object handed back is the client itself with two methods
 * layered on top — not a wrapper that re-implements or re-exports the
 * API. `chat.on(...)`, `chat.messages.list(...)`, `chat.startTyping()`
 * and everything else are the same functions a web app calls, so the
 * chat documentation applies verbatim on mobile (spec §5: no
 * mobile-specific chat protocol).
 */
export function createChatHandle(options: ChatHandleOptions): RavenChatHandle | undefined {
  const chatModule = loadChatModule();
  if (!chatModule) {
    // Configured for chat but the package isn't installed. Say so once,
    // clearly, rather than throwing from a constructor the developer
    // may not associate with chat at all.
    console.warn(
      '[raven] chatToken was provided but @raven/chat is not installed. ' +
        'Run: npm install @raven/chat — raven.chat will be undefined until then.',
    );
    return undefined;
  }

  const client = chatModule.createChatClient({
    token: options.token,
    apiUrl: options.apiUrl,
    chatUrl: options.chatUrl,
    logLevel: options.logLevel,
    onTokenExpiring: options.onTokenExpiring,
  });

  const handle = client as unknown as RavenChatHandle;
  const baseConnect = client.connect.bind(client);

  // `connect(room)` instead of `connect({ room })`. On web the client is
  // constructed at the point of use and the object form reads naturally
  // alongside other options; on mobile the client is already alive on
  // `raven`, and the only remaining question is which room — so the
  // string form is what an app actually writes (spec §5).
  handle.connect = (room: string) => baseConnect({ room });
  handle.send = (text: string) => client.sendMessage({ text });

  return handle;
}

interface ChatModule {
  createChatClient(config: Record<string, unknown>): {
    connect(options: { room?: string }): Promise<void>;
    sendMessage(options: { text: string }): Promise<unknown>;
  };
}

function loadChatModule(): ChatModule | undefined {
  try {
    // Resolved at runtime on purpose: @raven/chat is an optional peer, and
    // a static import would make an RTC-only app pay for it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@raven/chat');
    return typeof mod?.createChatClient === 'function' ? (mod as ChatModule) : undefined;
  } catch {
    return undefined;
  }
}
