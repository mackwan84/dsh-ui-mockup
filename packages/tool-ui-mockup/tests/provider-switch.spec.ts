import { describe, expect, it } from 'vitest'
import { mergeProviderSwitchRows } from '../src/index.js'

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
