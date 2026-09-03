import { describe, expect, it } from 'vitest'
import { buildPrompt } from '../src/prompt.js'

describe('buildPrompt', () => {
  it('renders a Balsamiq-style wireframe template with Chinese annotation guidance', () => {
    const prompt = buildPrompt(
      { description: '待办事项主页', fidelity: 'wireframe', platform: 'web' },
      false,
    )
    expect(prompt).toContain('黑白线框图(wireframe)')
    expect(prompt).toContain('中文小字标注用途')
    expect(prompt).toContain('桌面网页端')
    expect(prompt).toContain('待办事项主页')
    expect(prompt).not.toContain('高保真 UI 界面设计稿')
  })

  it('renders a high-fidelity template with the style direction', () => {
    const prompt = buildPrompt(
      {
        description: '图书详情页',
        fidelity: 'high-fidelity',
        platform: 'mobile',
        style: '清新活力',
      },
      false,
    )
    expect(prompt).toContain('高保真 UI 界面设计稿')
    expect(prompt).toContain('清新活力')
    expect(prompt).toContain('中文文案必须准确')
    expect(prompt).toContain('移动端竖屏')
  })

  it('falls back to a default style when none is given', () => {
    const prompt = buildPrompt(
      { description: 'x', fidelity: 'high-fidelity', platform: 'web' },
      false,
    )
    expect(prompt).toContain('极简浅色, 现代简洁')
  })

  it('demands reference consistency in I2I mode', () => {
    const prompt = buildPrompt(
      { description: '搜索结果页', fidelity: 'high-fidelity', platform: 'web' },
      true,
    )
    expect(prompt).toContain('参考图是该网站已确认的视觉风格基准')
    expect(prompt).toContain('不要改变参考图的视觉风格')
  })

  // 图像模型对大段中文正文极易输出乱码(验收实测): 三个模板都要压低文字密度
  it('keeps text density low in every template to reduce garbled output', () => {
    const wireframe = buildPrompt(
      { description: 'x', fidelity: 'wireframe', platform: 'web' },
      false,
    )
    expect(wireframe).toContain('区块内不写大段正文')
    expect(wireframe).toContain('避免长句与生僻字')

    const highFidelity = buildPrompt(
      { description: 'x', fidelity: 'high-fidelity', platform: 'web' },
      false,
    )
    expect(highFidelity).toContain('避免大段密集长文本')

    const reference = buildPrompt(
      { description: 'x', fidelity: 'high-fidelity', platform: 'web' },
      true,
    )
    expect(reference).toContain('文案用简短常见短语')
    expect(reference).toContain('避免大段密集长文本')
  })
})
