import security from 'eslint-plugin-security';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import babelParser from '@babel/eslint-parser';

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['node_modules/**', 'public/**'],
    plugins: { security, react, 'react-hooks': reactHooks },
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ['@babel/preset-react']
        }
      }
    },
    settings: {
      react: { version: 'detect' }
    },
    rules: {
      ...security.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'react/no-danger': 'error',
      'react/jsx-no-script-url': 'error',
      'security/detect-unsafe-regex': 'error',
      'react/prop-types': 'off'
    }
  }
];
