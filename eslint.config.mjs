// @ts-check
import eslint from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

/**
 * ESLint 平面配置：
 * - js + ts 推荐规则 + 类型感知规则。类型检查统一指向根 tsconfig（其 paths 把
 *   workspace 包映射到 src），与 `pnpm typecheck` 保持同一解析视图，
 *   避免包内 tsconfig 经 node_modules → lib/ 解析造成的依赖构建产物问题；
 * - 代码格式一律交给 Prettier，eslint-config-prettier 关闭与之冲突的规则；
 * - 只校验本仓库维护的源码，构建产物在 ignores 中排除。
 */
export default tseslint.config(
  {
    ignores: ['dist/', 'coverage/', '**/lib/'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // tsconfig 已开 noUncheckedIndexedAccess, `arr[i]!` 是该模式下的惯用非空收窄写法
      '@typescript-eslint/no-non-null-assertion': 'off',
      // 与 verbatimModuleSyntax 配合: 类型导入显式标注; 内联 style 保留现有混排导入写法
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // 下划线前缀是"有意未用"的既定惯例(接口桩参数)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // 测试与冒烟脚本中大量 async 桩仅是为满足接口签名, 函数体无 await 是设计使然
    files: ['tests/**/*.ts', 'packages/*/tests/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // 纯 JS 工具文件(如本配置)不在任何 tsconfig 内, 关闭类型感知规则
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  eslintConfigPrettier,
)
