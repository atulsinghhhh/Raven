import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { configFilePath } from './paths.js';

export const DEFAULT_API_URL = 'http://localhost:4100';

export interface CliConfig {
  apiUrl: string;
  /** Set via `raven projects use <project>` — a global fallback, overridden by a directory's raven.json and by an explicit --project flag. */
  currentProject?: string;
}

const DEFAULTS: CliConfig = { apiUrl: DEFAULT_API_URL };

/** Never contains secrets — safe to print in full via `raven config list`. */
export async function readCliConfig(): Promise<CliConfig> {
  try {
    const raw = await readFile(configFilePath(), 'utf8');
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<CliConfig>) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULTS };
    throw error;
  }
}

export async function writeCliConfig(config: CliConfig): Promise<void> {
  const dir = dirname(configFilePath());
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(configFilePath(), JSON.stringify(config, null, 2));
}

export async function updateCliConfig(patch: Partial<CliConfig>): Promise<CliConfig> {
  const current = await readCliConfig();
  const next = { ...current, ...patch };
  await writeCliConfig(next);
  return next;
}

export const CONFIG_KEYS = ['apiUrl', 'currentProject'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export function isConfigKey(value: string): value is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(value);
}
