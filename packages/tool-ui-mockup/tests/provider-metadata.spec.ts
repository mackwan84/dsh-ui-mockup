import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROVIDER_ID,
  PROVIDER_REGISTRY,
  providerMetaOf,
  providerOf,
} from '../src/providers.js'

describe('供应商元数据表完整性', () => {
  it('每家已注册供应商的字段完整且 id / patchId 唯一', () => {
    const ids = new Set<string>()
    const patchIds = new Set<string>()
    expect(PROVIDER_REGISTRY.length).toBeGreaterThanOrEqual(2)
    for (const meta of PROVIDER_REGISTRY) {
      expect(meta.id, 'id 非空').toMatch(/^[a-z][a-z0-9-]*$/)
      expect(meta.patchId, `${meta.id} patchId 非空`).toMatch(/^image-/)
      expect(meta.packageName, `${meta.id} 包名形如 npm scope`).toMatch(/^@[^/]+\/dsh-image-/)
      expect(meta.credential, `${meta.id} 凭据名非空`).toMatch(/^[A-Z][A-Z0-9_]*$/)
      expect(meta.probeBaseUrl, `${meta.id} 探测网关是 https 地址`).toMatch(/^https:\/\//)
      expect(meta.probePath, `${meta.id} 探测路径以 / 开头`).toMatch(/^\//)
      expect(meta.nameKey, `${meta.id} 名称词条键非空`).toMatch(/^panel\.provider\./)
      for (const tier of ['wireframe', 'highFidelity', 'draft'] as const) {
        expect(meta.hints[tier][0], `${meta.id} ${tier} 首项为空串（跟随默认）`).toBe('')
        expect(meta.hints[tier].length, `${meta.id} ${tier} 至少一个候选`).toBeGreaterThanOrEqual(2)
      }
      ids.add(meta.id)
      patchIds.add(meta.patchId)
    }
    expect(ids.size, 'id 不重复').toBe(PROVIDER_REGISTRY.length)
    expect(patchIds.size, 'patchId 不重复').toBe(PROVIDER_REGISTRY.length)
  })

  it('默认提供方（安装面回退）在注册表中', () => {
    expect(providerOf(DEFAULT_PROVIDER_ID)).toBeDefined()
  })
})

describe('提供方元数据查找', () => {
  it('注册表命中的 id 返回该家条目', () => {
    for (const meta of PROVIDER_REGISTRY) {
      expect(providerOf(meta.id)).toBe(meta)
    }
  })

  it('未注册 id（含 image 服务未挂载的 unknown）返回 undefined', () => {
    expect(providerOf('unknown')).toBeUndefined()
    expect(providerOf('not-a-provider')).toBeUndefined()
  })

  it('面板用的查找器对未注册 id 回退到默认提供方凭据与精简候选', () => {
    const fallback = providerMetaOf('unknown')
    expect(fallback.id).toBe('unknown')
    expect(fallback.credential).toBe(providerOf(DEFAULT_PROVIDER_ID)?.credential)
    expect(fallback.hints.wireframe).toEqual(['', 'qwen-image-3.0'])
    expect(fallback.hints.highFidelity).toEqual(['', 'qwen-image-3.0-pro'])
    expect(fallback.hints.draft).toEqual(['', 'qwen-image-3.0'])
  })
})
