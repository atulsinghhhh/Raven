'use client';

import { createContext, useContext } from 'react';
import { RavenStore } from './store';

export const RavenStoreContext = createContext<RavenStore | null>(null);

export function useRavenStore(): RavenStore {
  const store = useContext(RavenStoreContext);
  if (!store) {
    throw new Error('@ravenkash/react hooks must be used inside a <RavenRoom>; see docs/sdk/react.md.');
  }
  return store;
}
