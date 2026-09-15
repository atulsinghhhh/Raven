import { Prisma } from '../../generated/prisma/client';

/** Same bridge as chat/json.util.ts and live-streams/json.util.ts's toJsonInput — small enough to duplicate per module rather than couple them together for it. */
export function toJsonInput(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return value as Prisma.InputJsonValue;
}
