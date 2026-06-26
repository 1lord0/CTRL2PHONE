const js = require('@eslint/js');
const typescriptParser = require('@typescript-eslint/parser');
const typescriptPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  js.configs.recommended,
  {
    // Ignore compiled JS files, node_modules, and dist
    ignores: [
      'src/**/*.js',
      'node_modules/**',
      'dist/**'
    ]
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Node / Electron / Browser globals
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        window: 'readonly',
        document: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        __dirname: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin
    },
    rules: {
      // Disable no-undef in TS files as TypeScript compiler handles it better
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { 'vars': 'all', 'args': 'after-used' }],
      'no-console': 'off',
      'semi': ['error', 'always'],
      'quotes': ['warn', 'single', { 'avoidEscape': true }]
    }
  }
];
