import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', 'legacy/**', '**/drizzle/**', '**/*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // docs/09 §10: chỉ dùng Drizzle query builder, cấm nối chuỗi SQL
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='unsafe']",
          message: 'Không dùng sql.unsafe / raw SQL nối chuỗi (docs/09 §10).',
        },
      ],
    },
  },
);
