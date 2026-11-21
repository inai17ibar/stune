// sTunes の lint ルール。
// 方針: エージェント（や人）に「〜しないこと」と文章で頼む代わりに、ここで機械的に止める。
// エラーメッセージには「代わりに何をするか」と「理由」を書き、根本原因の修正へ誘導する。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const NODE_BUILTINS = [
  'fs', 'fs/promises', 'path', 'os', 'child_process', 'crypto', 'url', 'util', 'stream', 'events',
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'dist-electron/**', 'release/**', 'node_modules/**', 'native/**', 'resources/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---- 共通 ----
  {
    rules: {
      // 既存コードに約60件あるため warning から始め、件数を減らしてから error に上げる
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // ---- Renderer (src/) ----
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // CLAUDE.md の「hooks は early return より前」ルールをここで強制する
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'electron', message: 'Renderer から electron は使えません。main.ts に handleTrusted() で IPC を追加し、preload.ts の window.stune 経由で呼んでください。' },
          ...NODE_BUILTINS.flatMap((name) => [name, `node:${name}`]).map((name) => ({
            name,
            message: 'Renderer では Node API は使えません（contextIsolation 有効）。処理は electron/services/ に置き、IPC 経由で呼んでください。',
          })),
        ],
        patterns: [{
          group: ['**/electron/**', '../electron/*'],
          message: 'Renderer から Main プロセスのコードを import しないでください。共有する型は src/types/ に置き、処理は IPC 経由で呼んでください。',
        }],
      }],
    },
  },

  // ---- Main process (electron/) ----
  {
    files: ['electron/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/src/**', '../src/*'],
          message: 'Main プロセスから Renderer のコードを import しないでください。共有する型は両方から参照できる場所に切り出してください。',
        }],
      }],
      'no-restricted-syntax': ['error',
        {
          selector: "CallExpression[callee.object.name='ipcMain'][callee.property.name=/^(handle|on|once)$/]",
          message: 'ipcMain を直接使わず handleTrusted(channel, handler) を使ってください。送信元ウィンドウの検証（信頼境界）が抜けるのを防ぐためです。',
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: 'new Function は使わないでください。ESM 専用パッケージの読み込みは electron/services/metadata.ts の dynamicImport を再利用してください。',
        },
        {
          selector: "CallExpression[callee.name=/^(exec|execSync)$/]",
          message: 'exec / execSync はシェルを経由するため、パスにメタ文字が入るとコマンドインジェクションになります。execFile / execFileSync / spawn に引数配列で渡してください。',
        },
      ],
    },
  },

  // テストではモックのために any や ipcMain を直接触ってよい
  {
    files: ['**/*.test.ts', '**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-syntax': 'off',
    },
  },
);
