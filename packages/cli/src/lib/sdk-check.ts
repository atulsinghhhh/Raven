import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Checks package.json deps/devDeps directly — not node_modules, which can be stale or gitignored but never installed. */
export async function isSdkInPackageJson(cwd: string = process.cwd(), packageName = '@raven/rtc'): Promise<boolean> {
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return Boolean(pkg.dependencies?.[packageName] || pkg.devDependencies?.[packageName]);
  } catch {
    return false;
  }
}
