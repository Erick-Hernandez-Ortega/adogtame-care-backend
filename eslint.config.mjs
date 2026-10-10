// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['eslint.config.mjs'],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    eslintPluginPrettierRecommended,
    {
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.jest,
            },
            sourceType: 'commonjs',
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        rules: {
            curly: ['error', 'all'],
            'lines-between-class-members': ['error', 'always'],
            'padding-line-between-statements': [
                'error',
                {
                    blankLine: 'always',
                    prev: '*',
                    next: ['return', 'if', 'try', 'switch', 'for', 'while'],
                },
                { blankLine: 'always', prev: ['const', 'let'], next: '*' },
                { blankLine: 'always', prev: 'block-like', next: '*' },
                { blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] },
            ],
            '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-floating-promises': 'warn',
            '@typescript-eslint/no-unsafe-argument': 'warn',
            'prettier/prettier': ['error', { endOfLine: 'auto' }],
        },
    },
);
