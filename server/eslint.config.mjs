import security from 'eslint-plugin-security';

export default [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'coverage/**'],
    plugins: { security },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs'
    },
    rules: {
      ...security.configs.recommended.rules,
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-console': 'off',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-child-process': 'error',
      'security/detect-unsafe-regex': 'error',
      'security/detect-object-injection': 'warn',
      'security/detect-possible-timing-attacks': 'warn'
    }
  }
];
