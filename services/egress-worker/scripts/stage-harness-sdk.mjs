#!/usr/bin/env node
/**
 * Stages the real, published SDK builds the egress harness page imports —
 * same approach and same reasoning as
 * scripts/capacity/build-harness-sdk.mjs: `@ravenkash/rtc` and
 * `@ravenkash/chat` build to self-contained ESM already, and
 * `@ravenkash/client` has exactly two bare imports, both of them those two
 * packages. An import map in the harness HTML resolves them, so the
 * browser executes the published files byte for byte rather than a
 * re-bundled approximation of them. A separate copy, not a shared import
 * from scripts/capacity, because this is a genuinely separate deployable
 * service — it must be able to stage its own harness without that
 * unrelated dev-only package being present.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const OUT_DIR = join(HERE, '..', 'src', 'harness', 'vendor');

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
