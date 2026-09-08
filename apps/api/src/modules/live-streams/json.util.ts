import { Prisma } from '../../generated/prisma/client';

/** Same bridge as chat/json.util.ts's toJsonInput: see that file for why this exists as a named function instead of a cast at each call site. */
export function toJsonInput(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return value as Prisma.InputJsonValue;
}
