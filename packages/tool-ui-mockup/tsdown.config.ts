import { defineConfig } from 'tsdown'

/**
 * 客户端 bundle：产出 lib/client.js，遵循 DSH 浏览器模块系统约定
 * （window.__ModuleLoader__.load 注册工厂 + 模块表 external）。
 * react 等平台模块保持 external，由 DSH 壳的模块表在运行时提供；
 * 其余依赖（含本地源码）inline 进 bundle。
 */
const ID = '@mackwan84/dsh-tool-ui-mockup'

/** 模块表 baseline externals（每个 DSH 客户端 bundle 都隐式 external）。 */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

export default defineConfig({
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2024',
  // 类型声明由 tsc -p tsconfig.client.json --emitDeclarationOnly 单独产出
  // (tsdown 的 dts 与本配置的自定义 outputOptions 组合下不产出 .d.ts)
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (specifier) => EXTERNALS.includes(specifier),
    alwaysBundle: (specifier) => !EXTERNALS.includes(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
