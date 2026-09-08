import { createRequire } from 'node:module';

import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/**
 * eslint-config-next 16 ships a real flat config, so it's imported
 * directly. Routing it through @eslint/eslintrc's FlatCompat (as this
 * file used to) makes the eslintrc validator choke on the config's
 * self-referencing plugin objects and throw "Converting circular
 * structure to JSON" before a single file is read.
 */
const eslintConfig = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  ...coreWebVitals,
  ...typescript,

  /**
   * Pin the React version the plugin thinks it is looking at.
   *
   * eslint-config-next sets `settings.react.version: 'detect'`, and
   * detection reads the filename off the rule context with
   * `context.getFilename()`. ESLint 10 removed that method, so every rule
   * touching the detector (react/display-name, for one) dies with
   * "contextOrFilename.getFilename is not a function" before it lints
   * anything. eslint-plugin-react 7.37.5 is the latest release and peers
   * at eslint <=9.7, so there is no upgrade to move to yet.
   *
   * Handing it a concrete version skips detection altogether, which the
   * plugin documents as the preferred setup regardless. Read from the
   * installed react so it cannot drift out of step with the dependency.
   */
  {
    settings: {
      react: {
        version: createRequire(import.meta.url)('react/package.json').version,
      },
    },
  },
];

export default eslintConfig;
