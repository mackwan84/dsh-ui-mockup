/** 构建工具提示词所需的最小入参。 */
export interface PromptArgs {
  readonly description: string
  readonly fidelity: 'wireframe' | 'high-fidelity'
  readonly platform: 'web' | 'mobile'
  readonly style?: string
}

/**
 * 组装正向提示词：线框图走 Balsamiq 风黑白线框 + 中文区块标注；
 * 高保真走风格词 + 中文文案完整性约束；参考图模式额外要求与基准图保持一致。
 * @param args - 工具入参。
 * @param hasReference - 是否携带参考图（I2I 风格一致）。
 * @returns 完整提示词。
 */
export function buildPrompt(args: PromptArgs, hasReference: boolean): string {
  const platformText = args.platform === 'mobile' ? '移动端竖屏' : '桌面网页端'
  const base = `目标平台: ${platformText}。界面内容: ${args.description}`
  if (hasReference) {
    return `参考图是该网站已确认的视觉风格基准。请在绘制时与参考图保持一致: 相同的配色体系、品牌色、字体风格、圆角大小、卡片质感与整体视觉语言。仅按目标内容布局, 不要改变参考图的视觉风格。所有中文文案准确清晰无乱码。${base}`
  }
  if (args.fidelity === 'wireframe') {
    return `黑白线框图(wireframe)UI 草图, 类似 Balsamiq 手绘风格。只用灰白色块、细边框与简单占位图形表示元素, 无配色、无阴影、无渐变、无照片。每个区块内用清晰的中文小字标注用途, 例如"导航栏"、"搜索框"、"商品卡片"、"按钮"。完整展示页面布局、信息层级与主要交互入口。${base}`
  }
  const style = args.style !== undefined && args.style.trim() !== '' ? args.style.trim() : '极简浅色, 现代简洁'
  return `高保真 UI 界面设计稿, 设计精细, 整体采用${style}的风格。所有中文文案必须准确、清晰、无乱码、排版专业。配色统一、字体层级分明、组件状态完整、间距合理。${base}`
}
