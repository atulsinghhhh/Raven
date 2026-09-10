import { Prisma } from '../../generated/prisma/client';

/**
 * Bridges a validated `Record<string, unknown>` from a DTO to Prisma's
 * `InputJsonValue`. The two describe the same JSON object; Prisma's type
 * is just structurally stricter than TypeScript can prove for an
 * arbitrary record. class-validator's `@IsObject()` has already ruled out
 * arrays and primitives by the time anything reaches here.
 *
 * One helper instead of a cast scattered across five services, so if
 * the bridge ever needs to do real work (size checks, key filtering),
 * there's one place to put it.
 */
export function toJsonInput(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return value as Prisma.InputJsonValue;
}
