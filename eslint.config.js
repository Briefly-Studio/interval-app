// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // infra/ is a self-contained AWS CDK project with its own dependency graph — see
    // docs/cdk-infrastructure.md. It is intentionally never linted as part of the mobile app.
    ignores: ['dist/*', 'infra/**'],
  },
]);
