// esbuild (tsup's bundler) drops a "use client" directive once multiple
// source files are concatenated into one output — it can't prove the
// directive still applies after bundling, so it silently strips it
// rather than risk being wrong. Since every file in this package is
// genuinely client-only, the fix is just to prepend the directive to the
// built output files directly, after tsup is done. Run automatically as
// this package's `onSuccess` hook (see tsup.config.ts).
import { readFileSync, writeFileSync } from 'node:fs';

const DIRECTIVE = "'use client';\n";
const files = ['dist/index.js', 'dist/index.cjs'];

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  if (content.startsWith(DIRECTIVE)) continue;
  writeFileSync(file, DIRECTIVE + content);
  console.log(`[prepend-use-client] added "use client" to ${file}`);
}
