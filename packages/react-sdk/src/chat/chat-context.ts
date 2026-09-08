'use client';

import { createContext, useContext } from 'react';
import { RavenChatStore } from './chat-store';

export const RavenChatStoreContext = createContext<RavenChatStore | null>(null);

export function useRavenChatStore(): RavenChatStore {
  const store = useContext(RavenChatStoreContext);
  if (!store) {
    throw new Error('@corvidhq/react chat hooks must be used inside a <RavenChat>; see docs/sdk/chat.md#react.');
  }
  return store;
}

/**
 * Kept apart from the RTC store's context on purpose.
 *
 * A page can render `<RavenRoom>` and `<RavenChat>` side by side, a video
 * call with a chat panel, and neither provider should be able to satisfy
 * the other's hooks by accident (spec §45, independent SDKs that work
 * together).
 */
