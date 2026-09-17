import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

async function readText(path: string): Promise<string> {
  return readFile(resolve(root, path), 'utf8')
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readText(path)) as Record<string, unknown>
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('0.3.0 发布元数据', () => {
  it('pack:all 在打包任何工作区前先执行全仓构建', async () => {
    const pkg = await readJson('package.json')
    const packAllScript = (pkg['scripts'] as Record<string, string>)['pack:all']
    expect(packAllScript).toBeTypeOf('string')
    if (!packAllScript) {
      throw new Error('package.json 缺少 scripts.pack:all')
    }
    const fixtureRoot = await mkdtemp(resolve(tmpdir(), 'dsh-pack-all-'))
    temporaryDirectories.push(fixtureRoot)
    const binDirectory = resolve(fixtureRoot, 'bin')
    const invocationLog = resolve(fixtureRoot, 'pnpm-invocations.log')
    await Promise.all([
      mkdir(binDirectory),
      ...[
        'packages/image',
        'packages/image-dashscope',
        'packages/image-volcengine',
        'packages/image-openai-compat',
        'packages/tool-ui-mockup',
        'bundle/ui-mockup',
      ].map((path) => mkdir(resolve(fixtureRoot, path), { recursive: true })),
    ])
    await writeFile(
      resolve(binDirectory, 'pnpm'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> '${invocationLog}'\n`,
      { mode: 0o755 },
    )
    await execFileAsync('/bin/sh', ['-c', packAllScript], {
      cwd: fixtureRoot,
      env: { ...process.env, PATH: `${binDirectory}:${process.env.PATH ?? ''}` },
    })

    const invocations = (await readFile(invocationLog, 'utf8')).trim().split('\n')
    expect(invocations[0]).toBe('build')
    expect(invocations.slice(1)).toEqual([
      'pack --pack-destination ../../dist',
      'pack --pack-destination ../../dist',
      'pack --pack-destination ../../dist',
      'pack --pack-destination ../../dist',
      'pack --pack-destination ../../dist',
      'pack --pack-destination ../../dist',
    ])
  })

  it('六个发布包版本统一为根版本', async () => {
    const rootPackage = await readJson('package.json')
    const version = String(rootPackage['version'])
    const packagePaths = [
      'packages/image/package.json',
      'packages/image-dashscope/package.json',
      'packages/image-volcengine/package.json',
      'packages/image-openai-compat/package.json',
      'packages/tool-ui-mockup/package.json',
      'bundle/ui-mockup/package.json',
    ]
    for (const path of packagePaths) {
      expect((await readJson(path))['version'], path).toBe(version)
    }
  })

  it('组合包为 OpenAI 兼容网关预置可生成的分层默认模型', async () => {
    const patch = await readText('bundle/ui-mockup/cordis.patch.yml')
    expect(patch).toMatch(
      /id: image-openai-compat[\s\S]*?config:\s*\n\s*wireframeModel: gpt-image-2\s*\n\s*highFidelityModel: gpt-image-2\.5-flare/,
    )
  })
})
