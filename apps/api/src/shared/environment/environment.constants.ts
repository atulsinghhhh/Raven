import { Environment } from '../../generated/prisma/enums';

export { Environment };

/**
 * What a request gets when nothing says otherwise.
 *
 * Development, on purpose. A wrong guess should land somewhere harmless:
 * a credential that silently defaulted to production would be the one
 * mistake here worth avoiding.
 */
export const DEFAULT_ENVIRONMENT: Environment = Environment.DEVELOPMENT;

export const ALL_ENVIRONMENTS: readonly Environment[] = [
  Environment.DEVELOPMENT,
  Environment.STAGING,
  Environment.PRODUCTION,
] as const;

/**
 * The segment written into an API key's public id, so a developer can tell
 * a production credential from a development one by looking at it: in a
 * log line, a screenshot, or a pasted snippet.
 *
 * Nothing parses this back. The environment is read from the key's row,
 * never from its text, so a forged prefix grants nothing and keys issued
 * before this existed keep working unchanged.
 */
export const ENVIRONMENT_KEY_SEGMENT: Record<Environment, string> = {
  [Environment.DEVELOPMENT]: 'dev',
  [Environment.STAGING]: 'stg',
  [Environment.PRODUCTION]: 'prod',
};

export function isEnvironment(value: unknown): value is Environment {
  return typeof value === 'string' && (ALL_ENVIRONMENTS as readonly string[]).includes(value);
}

/**
 * A project *and* the environment within it: the unit almost every query
 * should be scoped by.
 *
 * Deliberately an object, not two string parameters: `(projectId,
 * environment)` and `(environment, projectId)` are both `(string, string)`
 * to the compiler, and the failure mode of getting them the wrong way
 * round is reading another environment's data. `ChatActor` satisfies this
 * shape, so an authenticated actor can be passed straight through.
 */
export interface ProjectScope {
  projectId: string;
  environment: Environment;
}
