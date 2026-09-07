import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/chat.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  platform: 'browser',
  treeshake: true,
  minify: false,
  external: ['react', 'react-dom', '@corvidhq/rtc', '@corvidhq/chat'],
  // esbuild strips a source-level "use client" directive once multiple
  // files are bundled together (it can't prove it still applies to the
  // concatenated output) — a `banner` has the same problem when combined
  // with a source-level directive (two directives → both dropped, see
  // scripts/prepend-use-client.mjs for the real fix, run as this
  // package's postbuild step).
  onSuccess: 'node scripts/prepend-use-client.mjs',
});
