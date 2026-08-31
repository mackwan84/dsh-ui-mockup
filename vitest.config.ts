import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** workspace 包 exports 指向 lib/ 构建产物；测试直接映射到 src，使 `pnpm test` 不依赖先 build。 */
function workspaceSource(rel: string): string {
  return fileURLToPath(new URL(rel, import.meta.url))
}

export default defineConfig({
  plugins: [
    {
      name: 'strip-missing-primitives-sourcemap',
      enforce: 'pre',
      async load(id) {
        if (!id.includes('@deepseek-ai/dsh-client-ui-primitives/lib/index.js')) return
        // 发布包没有携带 index.js.map；在 Vite 解析无效引用前只移除这条注释。
        return (await readFile(id, 'utf8')).replace(
          /\n\/\/# sourceMappingURL=index\.js\.map\s*$/,
          '',
        )
      },
    },
  ],
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
        find: /^@mackwan84\/dsh-image-volcengine$/,
        replacement: workspaceSource('./packages/image-volcengine/src/index.ts'),
      },
      {
        find: /^@mackwan84\/dsh-tool-ui-mockup$/,
        replacement: workspaceSource('./packages/tool-ui-mockup/src/index.ts'),
      },
    ],
  },
  test: {
    include: ['packages/**/tests/**/*.spec.{ts,tsx}', 'tests/**/*.spec.{ts,tsx}'],
    environment: 'node',
    server: {
      deps: {
        inline: ['@deepseek-ai/dsh-client-ui-primitives'],
      },
    },
  },
})
