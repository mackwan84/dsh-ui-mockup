/** 构建工具提示词所需的最小入参。 */
export interface PromptArgs {
  readonly description: string
  readonly fidelity: 'wireframe' | 'high-fidelity'
  readonly platform: 'web' | 'mobile'
  readonly style?: string
}

/**
 * 组装正向提示词：线框图走无品牌的黑白手绘线框 + 中文区块标注；
 * 高保真走风格词 + 中文文案完整性约束；参考图模式额外要求与基准图保持一致。
 * @param args - 工具入参。
 * @param hasReference - 是否携带参考图（I2I 风格一致）。
 * @returns 完整提示词。
 */
export function buildPrompt(args: PromptArgs, hasReference: boolean): string {
  const platformText = args.platform === 'mobile' ? '移动端竖屏' : '桌面网页端'
  const visibleContentRules =
    '界面可见文案只用短标题、短标签和短数据，不得照抄用户描述中的长段正文。每个组件只展示一种当前状态，除非用户明确要求状态对比。用户要求图表时绘制数据可视化图表，不绘制同名实体物品；漏斗类图表必须用分层梯形或横条表达阶段数据，禁止使用漏斗物品图标。不要把上述生成说明、风格名或模型名画进界面。'
  const base = `目标平台: ${platformText}。界面内容: ${args.description}。${visibleContentRules}`
  // 三个模板统一压低文字密度: 图像模型对大段中文正文极易输出乱码(验收实测),
  // 而草图阶段本不需要真实文案, 用常见短语占位即可表达信息架构
  if (hasReference) {
    return `参考图是该网站已确认的视觉风格基准。请在绘制时与参考图保持一致: 相同的配色体系、品牌色、字体风格、圆角大小、卡片质感与整体视觉语言。仅按目标内容布局, 不要改变参考图的视觉风格。所有中文文案准确清晰无乱码; 文案用简短常见短语, 避免大段密集长文本。${base}`
  }
  if (args.fidelity === 'wireframe') {
    return `低保真手绘线框风格的黑白线框图(wireframe) UI 草图。只用灰白色块、细边框与简单占位图形表示元素, 无配色、无阴影、无渐变、无照片。每个区块内用清晰的中文小字标注用途, 例如"页面标题"、"搜索"、"列表项"、"主要操作"。区块内不写大段正文: 标题与按钮用简短常见词, 列表与卡片内容用中性短语占位, 避免长句与生僻字。完整展示页面布局、信息层级与主要交互入口。${base}`
  }
  const style =
    args.style !== undefined && args.style.trim() !== '' ? args.style.trim() : '极简浅色, 现代简洁'
  return `高保真 UI 界面设计稿, 设计精细, 整体采用${style}的风格。所有中文文案必须准确、清晰、无乱码、排版专业。正文与列表内容用简短常见短语占位, 避免大段密集长文本。配色统一、字体层级分明、组件样式统一、间距合理。${base}`
}
