import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentImageReference,
  appendHistoryLine,
  dshHome,
  mergeProviderSwitchRows,
  parseHistoryLine,
} from '../src/index.js'

describe('mergeProviderSwitchRows', () => {
  it('appends both provider rows when the user layer is empty', () => {
    expect(mergeProviderSwitchRows([], 'volcengine')).toEqual([
      { id: 'image-dashscope', disabled: true },
      { id: 'image-volcengine', disabled: false },
    ])
  })

  it('flips both rows toward dashscope', () => {
    const existing = [
      { id: 'image-dashscope', disabled: true },
      { id: 'image-volcengine', disabled: false },
    ]
    const merged = mergeProviderSwitchRows(existing, 'dashscope')
    expect(merged).toEqual([
      { id: 'image-dashscope', disabled: false },
      { id: 'image-volcengine', disabled: true },
    ])
    // 纯函数：不得改写调用方传入的数组
    expect(existing[0]).toEqual({ id: 'image-dashscope', disabled: true })
  })

  it('updates rows in place and preserves unrelated user fields', () => {
    const existing = [
      { id: 'image-dashscope', disabled: false, custom: 'keep-me' },
      { id: 'tools', disabled: true },
    ]
    const merged = mergeProviderSwitchRows(existing, 'volcengine')
    expect(merged).toHaveLength(3)
    expect(merged[0]).toEqual({ id: 'image-dashscope', disabled: true, custom: 'keep-me' })
    expect(merged[1]).toEqual({ id: 'tools', disabled: true })
    expect(merged[2]).toEqual({ id: 'image-volcengine', disabled: false })
  })

  it('ignores non-object entries instead of crashing', () => {
    const merged = mergeProviderSwitchRows([null, 'garbage', 42, { id: 'x' }], 'dashscope')
    expect(merged).toEqual([
      { id: 'x' },
      { id: 'image-dashscope', disabled: false },
      { id: 'image-volcengine', disabled: true },
    ])
  })
})

describe('dshHome', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prefers $DSH_HOME and resolves it to an absolute path', () => {
    vi.stubEnv('DSH_HOME', 'some/relative/home')
    expect(dshHome()).toBe(resolve('some/relative/home'))
  })

  it('treats blank $DSH_HOME as unset, matching the host resolveDshHome', () => {
    vi.stubEnv('DSH_HOME', '   ')
    expect(dshHome()).toBe(resolve(homedir(), '.dsh'))
  })

  it('expands a leading ~ to the home directory', () => {
    vi.stubEnv('DSH_HOME', '~/custom-dsh')
    expect(dshHome()).toBe(join(homedir(), 'custom-dsh'))
  })
})

describe('历史追加', () => {
  it('无换行的损坏尾行后追加的新记录保持为独立 JSON 行', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ui-mockup-history-'))
    const path = join(dir, 'history.jsonl')
    try {
      await writeFile(path, '{"broken":', 'utf8')
      const record = JSON.stringify({
        time: '2026-09-04T00:00:00.000Z',
        description: 'CRM',
        files: [],
      })
      await appendHistoryLine(path, record)
      expect(await readFile(path, 'utf8')).toBe(`{"broken":\n${record}\n`)
      expect(
        (await readFile(path, 'utf8'))
          .split('\n')
          .map(parseHistoryLine)
          .filter((entry) => entry !== null),
      ).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('空文件和已有换行文件不会产生多余分隔行', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ui-mockup-history-'))
    const path = join(dir, 'history.jsonl')
    try {
      await writeFile(path, '', 'utf8')
      await appendHistoryLine(path, 'first')
      await appendHistoryLine(path, 'second')
      expect(await readFile(path, 'utf8')).toBe('first\nsecond\n')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('并发追加不会把记录内容交错到同一行', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ui-mockup-history-'))
    const path = join(dir, 'history.jsonl')
    try {
      await writeFile(path, '{"broken":', 'utf8')
      const records = Array.from({ length: 20 }, (_, index) => `record-${index}`)
      await Promise.all(records.map((record) => appendHistoryLine(path, record)))
      const lines = (await readFile(path, 'utf8'))
        .split('\n')
        .filter((line) => line.startsWith('record-'))
      expect(new Set(lines)).toEqual(new Set(records))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('只有写权限的历史文件仍可追加新记录', async () => {
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'ui-mockup-history-'))
    const path = join(dir, 'history.jsonl')
    try {
      await writeFile(path, '{"broken":', 'utf8')
      await (await import('node:fs/promises')).chmod(path, 0o200)
      await appendHistoryLine(path, 'record')
      await (await import('node:fs/promises')).chmod(path, 0o600)
      expect(await readFile(path, 'utf8')).toBe('{"broken":\nrecord\n')
    } finally {
      await (await import('node:fs/promises')).chmod(path, 0o600).catch(() => {})
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('Agent 图片引用', () => {
  it('只提供 design/images 语义路径，不暴露资产库绝对路径', () => {
    expect(agentImageReference('mockup-123.png')).toBe('design/images/mockup-123.png')
  })
})
