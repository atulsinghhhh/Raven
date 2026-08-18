import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProjectId } from '../../src/lib/project-context.js';
import { writeCliConfig } from '../../src/lib/cli-config.js';
import { writeProjectConfig } from '../../src/lib/project-config.js';
import { CliError } from '../../src/lib/errors.js';

describe('resolveProjectId — precedence: --project flag > raven.json > global config', () => {
  let configDir: string;
  let cwd: string;
  let originalCwd: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'raven-cli-home-'));
    cwd = await mkdtemp(join(tmpdir(), 'raven-cli-cwd-'));
    process.env.RAVEN_CONFIG_DIR = configDir;
    originalCwd = process.cwd();
    process.chdir(cwd);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    delete process.env.RAVEN_CONFIG_DIR;
    await rm(configDir, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it('throws a usage CliError when nothing is configured at all', async () => {
    await expect(resolveProjectId()).rejects.toBeInstanceOf(CliError);
    await expect(resolveProjectId()).rejects.toMatchObject({ kind: 'usage' });
  });

  it('falls back to the global config\'s currentProject when nothing else is set', async () => {
    await writeCliConfig({ apiUrl: 'http://x', currentProject: 'proj-global' });
    await expect(resolveProjectId()).resolves.toBe('proj-global');
  });

  it('prefers raven.json over the global config', async () => {
    await writeCliConfig({ apiUrl: 'http://x', currentProject: 'proj-global' });
    await writeProjectConfig({ project: 'proj-local' });
    await expect(resolveProjectId()).resolves.toBe('proj-local');
  });

  it('an explicit --project flag overrides both raven.json and the global config', async () => {
    await writeCliConfig({ apiUrl: 'http://x', currentProject: 'proj-global' });
    await writeProjectConfig({ project: 'proj-local' });
    await expect(resolveProjectId('proj-explicit')).resolves.toBe('proj-explicit');
  });
});
