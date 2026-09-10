'use client';

import { createContext, useContext } from 'react';
import type { LiveStream, LiveStreamRole } from '@ravenkash/client';

export type RavenLiveStreamStatus = 'connecting' | 'ready' | 'failed';

export interface RavenLiveStreamContextValue {
  status: RavenLiveStreamStatus;
  streamId: string;
  role: LiveStreamRole;
  /** `true` for HOST and CO_HOST. The SDK never infers this; it's only ever what the credentials said. */
  isHost: boolean;
  /** The underlying `LiveStream`, once joined, for whatever the hooks below don't cover. */
  stream?: LiveStream;
  error?: unknown;
  leave(): Promise<void>;
  react(emoji: string): Promise<void>;
}

export const RavenLiveStreamContext = createContext<RavenLiveStreamContextValue | null>(null);

export function useRavenLiveStreamContext(): RavenLiveStreamContextValue {
  const value = useContext(RavenLiveStreamContext);
  if (!value) {
    throw new Error(
      '@ravenkash/react Live Streaming hooks must be used inside a <RavenLiveStream>; see docs/sdk/react.md#live-streaming.',
    );
  }
  return value;
}
