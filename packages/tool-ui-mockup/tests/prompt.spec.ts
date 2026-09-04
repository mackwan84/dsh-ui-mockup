import { describe, expect, it } from 'vitest'
import { buildPrompt } from '../src/prompt.js'

describe('buildPrompt', () => {
  it('renders a hand-drawn wireframe template with Chinese annotation guidance', () => {
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

  it('在用户长描述之后重申可见文案和组件状态约束', () => {
    for (const [fidelity, hasReference] of [
      ['wireframe', false],
      ['high-fidelity', false],
      ['high-fidelity', true],
    ] as const) {
      const prompt = buildPrompt(
        { description: '这是一段会重复很多次的客户跟进正文', fidelity, platform: 'web' },
        hasReference,
      )
      expect(prompt.endsWith('不要把上述生成说明、风格名或模型名画进界面。')).toBe(true)
      expect(prompt).toContain('不得照抄用户描述中的长段正文')
      expect(prompt).toContain('每个组件只展示一种当前状态')
    }
  })

  it('线框模板使用中性占位词并要求图表不绘制成同名实体', () => {
    const prompt = buildPrompt(
      { description: 'CRM 商机漏斗', fidelity: 'wireframe', platform: 'web' },
      false,
    )
    expect(prompt).toContain('页面标题')
    expect(prompt).toContain('数据可视化图表')
    expect(prompt).toContain('漏斗类图表必须用分层梯形或横条表达阶段数据')
    expect(prompt).toContain('低保真手绘线框风格')
    // 负向断言只保留有区分度的：旧模板含 Balsamiq 与「商品卡片」示例，
    // 新模板均已移除（「商品名称」「¥99」两版都不含，断言恒真，已剔除）
    expect(prompt).not.toContain('Balsamiq')
    expect(prompt).not.toContain('商品卡片')
  })

  it('高保真模板不再用“状态完整”诱导同页展示多种组件状态', () => {
    const prompt = buildPrompt(
      { description: 'CRM 登录页', fidelity: 'high-fidelity', platform: 'mobile' },
      false,
    )
    expect(prompt).not.toContain('组件状态完整')
    expect(prompt).toContain('每个组件只展示一种当前状态')
  })
})
