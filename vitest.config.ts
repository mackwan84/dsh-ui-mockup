import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** workspace 包 exports 指向 lib/ 构建产物；测试直接映射到 src，使 `pnpm test` 不依赖先 build。 */
function workspaceSource(rel: string): string {
  return fileURLToPath(new URL(rel, import.meta.url))
}

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@mackwan84\/dsh-image$/,
        replacement: workspaceSource('./packages/image/src/index.ts'),
      },
      {
        find: /^@mackwan84\/dsh-image-dashscope$/,
        replacement: workspaceSource('./packages/image-dashscope/src/index.ts'),
      },
      {
        find: /^@mackwan84\/dsh-tool-ui-mockup$/,
        replacement: workspaceSource('./packages/tool-ui-mockup/src/index.ts'),
      },
    ],
  },
  test: {
    include: ['packages/**/tests/**/*.spec.ts', 'tests/**/*.spec.ts'],
    environment: 'node',
  },
})
