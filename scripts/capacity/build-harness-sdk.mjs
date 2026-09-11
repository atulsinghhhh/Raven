#!/usr/bin/env node
/**
 * Stages the public SDK builds the capacity harness pages import.
 *
 * The harness has to exercise the surface an external developer actually
 * gets, so it loads `@ravenkash/client` — the package you install to join
 * a Livqeno live stream from a browser — plus the `@ravenkash/rtc` and
 * `@ravenkash/chat` it sits on. Nothing here reaches past an export a
 * consumer could not also reach.
 *
 * There is deliberately no bundler in the way. `@ravenkash/rtc` and
 * `@ravenkash/chat` build to self-contained ESM already, and
 * `@ravenkash/client` has exactly two bare imports, both of them those
 * two packages. An import map in the harness HTML resolves them, so the
 * browser executes the published files byte for byte rather than a
 * re-bundled approximation of them.
 *
 * Why not reuse apps/api/test/e2e-harness/vendor: those two committed
 * copies both differ from what the packages build today. A capacity
 * number measured against a stale SDK is a number about code nobody
 * ships, so this rebuilds from source every run unless told not to.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const OUT_DIR = join(HERE, 'harness', 'vendor');

/** Build order matters: client resolves the other two through the workspace link, which points at their dist. */
const PACKAGES = [
  { name: '@ravenkash/rtc', dir: 'packages/sdk', file: 'raven-rtc.js' },
  { name: '@ravenkash/chat', dir: 'packages/chat-sdk', file: 'raven-chat.js' },
  { name: '@ravenkash/client', dir: 'packages/client', file: 'raven-client.js' },
];

export function stageHarnessSdk({ rebuild = true } = {}) {
  if (rebuild) {
    for (const pkg of PACKAGES) {
      execFileSync('pnpm', ['--filter', pkg.name, 'build'], { cwd: REPO, stdio: 'inherit' });
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const staged = [];
  for (const pkg of PACKAGES) {
    for (const [from, to] of [
      ['index.js', pkg.file],
      ['index.js.map', `${pkg.file}.map`],
    ]) {
      copyFileSync(join(REPO, pkg.dir, 'dist', from), join(OUT_DIR, to));
    }
    staged.push(pkg.file);
  }
  return { dir: OUT_DIR, staged };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { dir, staged } = stageHarnessSdk({ rebuild: !process.argv.includes('--no-build') });
  console.log(`staged into ${dir}: ${staged.join(', ')}`);
}
