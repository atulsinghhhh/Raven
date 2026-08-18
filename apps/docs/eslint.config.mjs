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
];

export default eslintConfig;
