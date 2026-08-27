import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFS,
  clampCount,
  filterHistory,
  parseHistoryLine,
  sanitizeAnchorFileName,
  sanitizeOutputDir,
} from '../src/prefs.js'

describe('sanitizeOutputDir', () => {
  it('accepts plain relative subpaths and trims decoration', () => {
    expect(sanitizeOutputDir('design/images')).toBe('design/images')
    expect(sanitizeOutputDir('./design/images/')).toBe('design/images')
    expect(sanitizeOutputDir('  assets ')).toBe('assets')
  })

  it('rejects empty, absolute and escaping paths', () => {
    expect(sanitizeOutputDir('')).toBeNull()
    expect(sanitizeOutputDir('/etc')).toBeNull()
    expect(sanitizeOutputDir('C:\\tmp')).toBeNull()
    expect(sanitizeOutputDir('../outside')).toBeNull()
    expect(sanitizeOutputDir('design/../..')).toBeNull()
  })
})

describe('clampCount', () => {
  it('clamps into 1..4 and falls back to the default for junk input', () => {
    expect(clampCount(0)).toBe(1)
    expect(clampCount(9)).toBe(4)
    expect(clampCount(2.6)).toBe(3)
    expect(clampCount(undefined)).toBe(DEFAULT_PREFS.defaultCount)
    expect(clampCount(Number.NaN)).toBe(DEFAULT_PREFS.defaultCount)
  })
})

describe('sanitizeAnchorFileName', () => {
  it('accepts bare mockup image file names only', () => {
    expect(sanitizeAnchorFileName('mockup-123-ab.png')).toBe('mockup-123-ab.png')
    expect(sanitizeAnchorFileName(' mockup-x.webp ')).toBe('mockup-x.webp')
  })

  it('rejects paths, traversal, wrong prefixes and extensions', () => {
    expect(sanitizeAnchorFileName('design/images/mockup-a.png')).toBeNull()
    expect(sanitizeAnchorFileName('../../mockup-a.png')).toBeNull()
    expect(sanitizeAnchorFileName('cat.png')).toBeNull()
    expect(sanitizeAnchorFileName('mockup-a.svg')).toBeNull()
    expect(sanitizeAnchorFileName('.')).toBeNull()
    expect(sanitizeAnchorFileName(42)).toBeNull()
  })
})

describe('parseHistoryLine', () => {
  const line = JSON.stringify({
    time: '2026-08-27T03:04:05.000Z',
    files: ['design/images/mockup-1.png'],
    description: '登录页线框',
    model: 'qwen-image-3.0',
    fidelity: 'wireframe',
    platform: 'web',
    size: '1280*720',
    status: 'generated',
  })

  it('parses a full record', () => {
    expect(parseHistoryLine(line)).toMatchObject({
      description: '登录页线框',
      model: 'qwen-image-3.0',
      size: '1280*720',
    })
  })

  it('tolerates legacy records without size and drops corrupt lines', () => {
    expect(parseHistoryLine(line.replace('"size":"1280*720",', ''))?.size).toBeUndefined()
    expect(parseHistoryLine('{oops')).toBeNull()
    expect(parseHistoryLine('')).toBeNull()
    expect(parseHistoryLine(JSON.stringify({ time: 1, description: 'x', files: [] }))).toBeNull()
  })
})

describe('filterHistory', () => {
  const entries: Array<{ time: string; description: string; files: string[] }> = [
    { time: 't1', description: '登录页 LineFrame', files: [] },
    { time: 't2', description: '图书详情页高保真', files: [] },
  ]

  it('matches case-insensitively on description substrings', () => {
    expect(filterHistory([...entries], 'lineframe')).toHaveLength(1)
    expect(filterHistory([...entries], '图书')).toHaveLength(1)
    expect(filterHistory([...entries], '')).toHaveLength(2)
    expect(filterHistory([...entries], undefined)).toHaveLength(2)
  })
})
