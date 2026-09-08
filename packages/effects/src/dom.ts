/** Indirection so tests can fake a DOM-less runtime (React Native, a worker) without touching the real global. */
export function hasDocument(): boolean {
  return typeof document !== 'undefined';
}
